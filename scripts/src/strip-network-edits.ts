import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { db, pool, scenariosTable } from "@workspace/db";

// SCN v0.3 Phase B — B7.1: rollback strip script (DD-8's "antidote packaged
// with the medicine", ships in the same PR/commit as B1.1's schema
// extension, per the plan's explicit RP-B gate). Removes the three
// network-edit key families from `inputs` so a code rollback to pre-B1.1
// solves scenarios against the bare dataset only, instead of silently
// solving against edits the reverted code doesn't understand. Bumps
// `inputsUpdatedAt` on every scenario it actually modifies so those
// scenarios surface as **stale** afterward (X1.1's existing derived
// `Scenario.stale` guard) — an honest, visible downgrade rather than a
// silent one.
//
// Modeled on ./migrate-scenario-inputs.ts (same db/pool import style), but
// this script never touches schema (no ALTER TABLE) — it only rewrites the
// `inputs` jsonb blob's contents.
//
// Scope: p-median-us only (this repo's Phase B pilot model). MODEL_IDS is a
// list, not a single hardcoded string, specifically so B6.x's fast-follow to
// the other models can extend it without restructuring this script.
export const MODEL_IDS = ["p-median-us"];

export const NETWORK_EDIT_KEYS = ["addedWarehouses", "addedCustomers", "distanceOverrides"] as const;

// DD-8's .default([]) means these keys are present (but empty) on nearly
// every scenario saved after B1.1 lands — routes/scenarios.ts persists the
// Zod *output*, not the raw input, so `addedWarehouses: []` etc. get written
// even when the student made zero network edits. Checking key presence
// alone would make --dry-run's count meaningless and false-stale nearly
// every scenario on a real strip run. Check that the array actually has
// content instead.
export function hasNetworkEdits(inputs: Record<string, unknown>): boolean {
  return NETWORK_EDIT_KEYS.some((key) => Array.isArray(inputs[key]) && (inputs[key] as unknown[]).length > 0);
}

export function stripNetworkEdits(inputs: Record<string, unknown>): Record<string, unknown> {
  const stripped = { ...inputs };
  for (const key of NETWORK_EDIT_KEYS) {
    delete stripped[key];
  }
  return stripped;
}

export interface StripSummary {
  // Count of affected scenarios per "userId / modelId" — matches the plan's
  // "per user/model" wording for --dry-run's report.
  byUserModel: Map<string, number>;
  affectedCount: number;
}

function summarize(rows: { userId: string; modelId: string }[]): StripSummary {
  const byUserModel = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.userId} / ${row.modelId}`;
    byUserModel.set(key, (byUserModel.get(key) ?? 0) + 1);
  }
  return { byUserModel, affectedCount: rows.length };
}

// Core, testable logic — separated from the CLI entrypoint below so tests
// can exercise it against a mocked `@workspace/db` without triggering the
// process-level side effects (pool.end()/process.exit()) a real CLI run has.
export async function run(options: { dryRun: boolean }): Promise<StripSummary> {
  const rows = await db.select().from(scenariosTable).where(inArray(scenariosTable.modelId, MODEL_IDS));

  const affected = rows.filter((row) => hasNetworkEdits(row.inputs));
  const summary = summarize(affected);

  if (options.dryRun) {
    console.log(`[dry-run] ${summary.affectedCount} scenario(s) would be stripped of network edits:`);
    for (const [key, count] of summary.byUserModel) {
      console.log(`  ${key}: ${count}`);
    }
    return summary;
  }

  for (const row of affected) {
    await db.update(scenariosTable)
      .set({
        inputs: stripNetworkEdits(row.inputs),
        inputsUpdatedAt: new Date(),
      })
      .where(eq(scenariosTable.id, row.id));
  }

  console.log(`Stripped network edits from ${summary.affectedCount} scenario(s).`);
  return summary;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const dryRun = process.argv.includes("--dry-run");
  run({ dryRun })
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      return pool.end().finally(() => process.exit(1));
    });
}
