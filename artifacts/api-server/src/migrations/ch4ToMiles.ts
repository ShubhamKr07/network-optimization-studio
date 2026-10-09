import { eq } from "drizzle-orm";
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
  | { ok: true; inputs: Record<string, unknown> }
  | { ok: false; reason: string };

export function migrateInputs(raw: Record<string, unknown>): MigrateResult {
  // Idempotency, keyed on the renamed field's presence. Each row's JSON update
  // must be atomic, or a half-converted row looks unmigrated here and gets
  // converted twice.
  if ("highServiceDistMi" in raw) return { ok: true, inputs: raw };

  const { highServiceDistKm, maxDistKm, avgServiceDistCapKm, stepEpoch, step2, ...rest } =
    raw as Record<string, unknown>;

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

  const candidate: Record<string, unknown> = {
    ...rest,
    highServiceDistMi,
    maxDistMi,
    avgServiceDistCapMi,
    coverageFloorDemand,
    objective: deriveMaxCoverageObjective(coverageFloorDemand),
    distanceBands: bands.length > 0 ? bands : [highServiceDistMi, maxDistMi],
    distanceOverrides: overrides,
  };

  // The guarantee behind the 2 dp choice: only rows the running server can load
  // are written back. A skipped row is a visible one-liner to fix by hand; a
  // written-but-invalid row 422s forever with no indication why.
  const parsed = maxCoverageInputsSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: `validation failed: ${parsed.error.message}` };
  return { ok: true, inputs: parsed.data as Record<string, unknown> };
}

type Db = typeof db;

export interface MigrateReport {
  migrated: number[];
  skipped: Array<{ id: number; reason: string }>;
  alreadyMigrated: number[];
}

// `dryRun` performs the FULL analysis -- selects every row, runs migrateInputs,
// classifies each -- and simply does not write. A dry run that reports zeros
// without inspecting anything cannot reveal a bad row, which is its only job.
export async function migrateAll(database: Db = db, dryRun = false): Promise<MigrateReport> {
  const rows = await database
    .select({ id: scenariosTable.id, inputs: scenariosTable.inputs })
    .from(scenariosTable)
    .where(eq(scenariosTable.modelId, MAX_COVERAGE_MODEL_ID));

  const report: MigrateReport = { migrated: [], skipped: [], alreadyMigrated: [] };

  for (const row of rows) {
    const inputs = (row.inputs ?? {}) as Record<string, unknown>;
    if ("highServiceDistMi" in inputs) { report.alreadyMigrated.push(row.id); continue; }
    const result = migrateInputs(inputs);
    if (!result.ok) { report.skipped.push({ id: row.id, reason: result.reason }); continue; }
    if (!dryRun) {
      await database.update(scenariosTable)
        .set({ inputs: result.inputs, result: null, solvedAt: null })
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
