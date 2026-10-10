import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool, scenariosTable } from "@workspace/db";

// CH4OS-4 — one-off: every pre-CH4OS floor-0 max-coverage-us row carries a
// server-derived `objective: "coverage"`. Per the spec's decision (2026-10-10
// §8) it is CLEARED, so those students choose an objective before re-solving.
// Running it against production is a separate, human-gated operation —
// docs/ops/ch4-objective-clear-runbook.md. Run AFTER nos-api and nos-studio
// are deployed: until then a row still holding "coverage" keeps solving as
// Model 1, which is a valid choice.

export interface ClearObjectiveReport {
  /** Ids this run cleared — or, under dryRun, would clear. Ascending. */
  matched: number[];
  dryRun: boolean;
}

type Db = typeof db;

/**
 * Selects `model_id = 'max-coverage-us' AND (inputs->>'coverageFloorDemand')::int = 0
 * AND inputs ? 'objective'`, removes the `objective` key, and bumps the solve
 * epoch exactly as services/scenarioInputWrite.ts does (`updated_at` and
 * `inputs_updated_at` = DB now(), `solve_input_revision + 1`), so the cached
 * result reads stale and an in-flight solve's publication CAS stops matching.
 * `result` and `result_cache` are untouched (stale, not deleted); the cache key
 * hashes the whole inputs blob, so a cleared row can never be served an old
 * entry.
 *
 * Idempotent by construction: `inputs ? 'objective'` matches nothing on a
 * second run. One UPDATE statement, so a row is cleared entirely or not at all.
 *
 * `scenarioIds` narrows the scan. Tests MUST pass their own fixture ids; an
 * EMPTY array means "no rows", never "every row". The unfiltered scan exists
 * only for the CLI entry point below.
 */
export async function clearFloorZeroObjective(
  database: Db = db,
  dryRun = false,
  scenarioIds?: number[],
): Promise<ClearObjectiveReport> {
  if (scenarioIds != null && scenarioIds.length === 0) return { matched: [], dryRun };
  const scope = and(
    eq(scenariosTable.modelId, "max-coverage-us"),
    sql`(${scenariosTable.inputs}->>'coverageFloorDemand')::int = 0`,
    sql`${scenariosTable.inputs} ? 'objective'`,
    scenarioIds == null ? undefined : inArray(scenariosTable.id, scenarioIds),
  );
  const rows = dryRun
    ? await database.select({ id: scenariosTable.id }).from(scenariosTable).where(scope)
    : await database.update(scenariosTable)
      .set({
        inputs: sql`${scenariosTable.inputs} - 'objective'`,
        updatedAt: sql`now()`,
        inputsUpdatedAt: sql`now()`,
        solveInputRevision: sql`${scenariosTable.solveInputRevision} + 1`,
      })
      .where(scope)
      .returning({ id: scenariosTable.id });
  return { matched: rows.map((r) => r.id).sort((a, b) => a - b), dryRun };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  const report = await clearFloorZeroObjective(db, dryRun);
  console.log(JSON.stringify({ ...report, count: report.matched.length }, null, 2));
  await pool.end();
}
