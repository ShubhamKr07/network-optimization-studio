import { eq, sql } from "drizzle-orm";
import { db, pool, scenariosTable, resultCacheTable } from "@workspace/db";
import { maxCoverageInputsSchema } from "../validation/inputs/maxCoverage.js";
import { deriveMaxCoverageObjective } from "@workspace/units";

// One-off km -> mi migration of persisted max-coverage-us `inputs` (§3.4 of
// docs/superpowers/specs/2026-10-09-ch4-model-interface-overhaul-design.md).
// Running it against production is a separate, human-gated operation -- see
// docs/ops/ch4-miles-migration-runbook.md.
export const MAX_COVERAGE_MODEL_ID = "max-coverage-us";
const MI = 1.609344;

// 2 dp, NOT integers. Integer rounding turns valid persisted rows invalid:
// high=1km/max=1.1km both round to 1 and break the strict inequality, and
// anything under 0.804672 km rounds to 0 and breaks `positive()`.
const toMi = (km: number): number => Math.round((km / MI) * 100) / 100;

export type MigrateResult =
  | { ok: true; inputs: Record<string, unknown>; objectiveFlipped: boolean }
  | { ok: false; reason: string };

// MINOR #3 — a row missing one of these hits `toMi(undefined)` -> NaN -> a
// Zod "expected number, received nan" message that gives no hint a field was
// simply ABSENT. Detect it up front and name the field(s), so the runbook's
// "fix by hand, informed by the reason string" advice is actually followable.
const REQUIRED_SOURCE_NUMERIC_FIELDS = ["highServiceDistKm", "maxDistKm"] as const;

export function migrateInputs(raw: Record<string, unknown>): MigrateResult {
  // Idempotency, keyed on the renamed field's presence. Each row's JSON update
  // must be atomic, or a half-converted row looks unmigrated here and gets
  // converted twice.
  if ("highServiceDistMi" in raw) return { ok: true, inputs: raw, objectiveFlipped: false };

  const missing = REQUIRED_SOURCE_NUMERIC_FIELDS.filter(
    (field) => typeof raw[field] !== "number",
  );
  if (missing.length > 0) {
    return { ok: false, reason: `missing required field(s): ${missing.join(", ")}` };
  }

  const { highServiceDistKm, maxDistKm, avgServiceDistCapKm, stepEpoch, step2, ...rest } =
    raw as Record<string, unknown>;

  // MINOR #2 — the km-era schema allowed `coverageFloorDemand: 0` alongside
  // `objective: "min_distance"` (deriveMaxCoverageObjective(0) always returns
  // "coverage"), so a row like that silently flips which ILP runs. The flip
  // itself is forced -- Task 5 deliberately removed that state's
  // expressibility -- only the SILENCE is the defect this closes: record
  // whether the incoming objective disagrees with the derived one.
  const incomingObjective = typeof rest.objective === "string" ? rest.objective : undefined;

  const highServiceDistMi = toMi(highServiceDistKm as number);
  const maxDistMi = toMi(maxDistKm as number);
  // An old min-distance row has NO cap: the pre-overhaul schema made it
  // coverage-only and synthesizeStep2Inputs destructured it away.
  const avgServiceDistCapMi = avgServiceDistCapKm == null ? 650 : toMi(avgServiceDistCapKm as number);
  const coverageFloorDemand = typeof rest.coverageFloorDemand === "number" ? rest.coverageFloorDemand : 0;

  const rawBands = Array.isArray(rest.distanceBands) ? (rest.distanceBands as number[]) : [];
  const bands = [...new Set(rawBands.map(toMi))].filter(b => b > 0).sort((a, b) => a - b);

  const overrides = Array.isArray(rest.distanceOverrides)
    ? (rest.distanceOverrides as Array<Record<string, unknown>>).map(o => ({
        ...o,
        // EVERY entry. This value is raw km that precheck overlays directly onto
        // the base matrix, and for an added entity it is the only record of that
        // distance. `estimated` is a boolean and does not convert.
        distance: toMi(o.distance as number),
      }))
    : [];

  const derivedObjective = deriveMaxCoverageObjective(coverageFloorDemand);
  const objectiveFlipped = incomingObjective != null && incomingObjective !== derivedObjective;

  const candidate: Record<string, unknown> = {
    ...rest,
    highServiceDistMi,
    maxDistMi,
    avgServiceDistCapMi,
    coverageFloorDemand,
    objective: derivedObjective,
    distanceBands: bands.length > 0 ? bands : [highServiceDistMi, maxDistMi],
    distanceOverrides: overrides,
  };

  // The guarantee behind the 2 dp choice: only rows the running server can load
  // are written back. A skipped row is a visible one-liner to fix by hand; a
  // written-but-invalid row 422s forever with no indication why.
  const parsed = maxCoverageInputsSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: `validation failed: ${parsed.error.message}` };
  return { ok: true, inputs: parsed.data as Record<string, unknown>, objectiveFlipped };
}

type Db = typeof db;

export interface MigrateReport {
  migrated: number[];
  skipped: Array<{ id: number; reason: string }>;
  alreadyMigrated: number[];
  // MINOR #2 — ids where the incoming `objective` disagreed with the derived
  // one (an old `min_distance` row with `coverageFloorDemand: 0`, which
  // `deriveMaxCoverageObjective` always maps to "coverage"). The flip is
  // forced and correct; this is only visibility into how many rows it hit.
  objectiveFlipped: number[];
}

// `dryRun` performs the FULL analysis -- selects every row, runs migrateInputs,
// classifies each -- and simply does not write. A dry run that reports zeros
// without inspecting anything cannot reveal a bad row, which is its only job.
export async function migrateAll(database: Db = db, dryRun = false): Promise<MigrateReport> {
  const rows = await database
    .select({ id: scenariosTable.id, inputs: scenariosTable.inputs })
    .from(scenariosTable)
    .where(eq(scenariosTable.modelId, MAX_COVERAGE_MODEL_ID));

  const report: MigrateReport = { migrated: [], skipped: [], alreadyMigrated: [], objectiveFlipped: [] };

  for (const row of rows) {
    const inputs = (row.inputs ?? {}) as Record<string, unknown>;
    if ("highServiceDistMi" in inputs) { report.alreadyMigrated.push(row.id); continue; }
    const result = migrateInputs(inputs);
    if (!result.ok) { report.skipped.push({ id: row.id, reason: result.reason }); continue; }
    if (result.objectiveFlipped) report.objectiveFlipped.push(row.id);
    if (!dryRun) {
      // IMPORTANT #1 — this write must go through the SAME write-authority
      // guarantees `applyScenarioInputWrite` gives every other inputs writer,
      // even though this migration is deliberately NOT routed through that
      // authority (see maxCoverageWriteGuard.test.ts's allow-list comment):
      //   (a) bump `solveInputRevision` so an in-flight kilometre-era
      //       `solve_jobs` job's publication CAS (jobRunner.ts's
      //       `latestSolveJobId = jobId AND solveInputRevision =
      //       enqueuedSolveInputRevision`) fails and the job returns
      //       `superseded` instead of publishing a km-era result onto this
      //       now-miles row -- exactly the designed response to "inputs
      //       changed under a running job", which is literally what this
      //       migration does.
      //   (b) advance `inputsUpdatedAt` from the SAME clock (`now()`, not
      //       `new Date()` -- see lib/db/CLAUDE.md's timestamptz gotcha) so
      //       `isStale()` (`inputsUpdatedAt > solvedAt`) cannot be defeated
      //       by a timezone skew between this process and the database.
      //   (c) null `resultRunId` alongside `result`/`solvedAt`, preserving
      //       the stated invariant (schema/scenarios.ts) that `resultRunId`
      //       is only ever written in the same transaction as a non-null
      //       `result`.
      // No `SELECT ... FOR UPDATE` here -- see the runbook's "Operational
      // mitigation" section for why a code-level lock was not chosen for
      // the lost-update window instead.
      await database.update(scenariosTable)
        .set({
          inputs: result.inputs,
          result: null,
          solvedAt: null,
          resultRunId: null,
          inputsUpdatedAt: sql`now()`,
          solveInputRevision: sql`${scenariosTable.solveInputRevision} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(scenariosTable.id, row.id));
    }
    report.migrated.push(row.id);
  }

  // result_cache is NOT an FK child of scenarios (pk is inputs_hash plus a plain
  // model_id column), so its rows would otherwise strand km payloads forever.
  // solve_jobs rows are deliberately left as history.
  if (!dryRun) {
    await database.delete(resultCacheTable).where(eq(resultCacheTable.modelId, MAX_COVERAGE_MODEL_ID));
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  const report = await migrateAll(db, dryRun);
  console.log(JSON.stringify({ dryRun, ...report }, null, 2));
  await pool.end();
}
