// CH4O-9 review fix (MINOR #1) — real-Postgres round trip for `migrateAll`.
// `ch4ToMiles.test.ts` only ever imports `migrateInputs`; the classification
// branches, the `result`/`solvedAt`/`resultRunId` nulling, the epoch bump
// (Important #1), and the `result_cache` delete all rested on a single
// manual local run against five structurally identical rows that happened
// to all carry empty `distanceOverrides` arrays — so the override-
// conversion path was never exercised end-to-end through a real jsonb
// column either. Follows jadeTransportCostsPersistence.test.ts's convention:
// no vi.mock of db/jobRunner/child_process anywhere in this file — real
// Postgres, real columns, real read-back. Requires a live DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import { migrateAll, MAX_COVERAGE_MODEL_ID } from "../ch4ToMiles.js";

const TEST_USER_ID = `ch4o9-migrate-all-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const scenarioIds: number[] = [];
const jobIds: number[] = [];

afterAll(async () => {
  if (jobIds.length > 0) {
    await db.delete(solveJobsTable).where(inArray(solveJobsTable.id, jobIds));
  }
  if (scenarioIds.length > 0) {
    await db.delete(scenariosTable).where(inArray(scenariosTable.id, scenarioIds));
  }
  // No result_cache teardown here: this test never inserts into that table
  // itself (the real `migrateAll(db)` call does, as its own intentional
  // production behaviour, deleting every max-coverage-us row -- not just
  // this test's -- which belongs to the migration, not to this fixture's
  // cleanup). A blanket `WHERE model_id = ...` delete here would additionally
  // remove legitimate cache rows written by unrelated concurrent work on the
  // shared local nos_dev, which is exactly what a narrow teardown must not do.
  await db.delete(usersTable).where(eq(usersTable.id, TEST_USER_ID));
});

// A km-shaped row carrying a non-empty distanceOverrides entry — the exact
// shape none of the 5 local nos_dev rows had (see the runbook's disclosed
// gap). `estimated: true` must survive untouched; `distance` must convert.
const kmRowWithOverrides = {
  objective: "coverage",
  p: 3,
  highServiceDistKm: 700,
  maxDistKm: 5500,
  avgServiceDistCapKm: 1000,
  gap: 0,
  timeLimitSec: 120,
  capacityMode: "none",
  distanceBands: [700, 1400, 2800, 5500],
  warehouseOverrides: [],
  customerOverrides: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [
    { fromId: "ALN", toId: "C1", distance: 601.894656 },
    { fromId: "aw-x", toId: "C2", distance: 100, estimated: true },
  ],
};

// Deliberately unmigratable: no `highServiceDistKm` at all (MINOR #3's case)
// — hits the up-front missing-field check rather than falling through to a
// cryptic NaN validation message.
const unmigratableRow = {
  objective: "coverage",
  p: 3,
  maxDistKm: 5500,
  avgServiceDistCapKm: 1000,
  gap: 0,
  timeLimitSec: 120,
  capacityMode: "none",
  warehouseOverrides: [],
  customerOverrides: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

describe("migrateAll — real-Postgres round trip", () => {
  beforeAll(async () => {
    await db.insert(usersTable).values({ id: TEST_USER_ID, email: `${TEST_USER_ID}@example.test` })
      .onConflictDoNothing();
  });

  it("converts the migratable row end-to-end and reports the unmigratable one as skipped, naming the missing field", async () => {
    const [migratable] = await db.insert(scenariosTable).values({
      name: "ch4o9 migrateAll fixture — migratable",
      userId: TEST_USER_ID,
      modelId: MAX_COVERAGE_MODEL_ID,
      inputs: kmRowWithOverrides,
    }).returning();
    scenarioIds.push(migratable!.id);

    const [unmigratable] = await db.insert(scenariosTable).values({
      name: "ch4o9 migrateAll fixture — unmigratable",
      userId: TEST_USER_ID,
      modelId: MAX_COVERAGE_MODEL_ID,
      inputs: unmigratableRow,
    }).returning();
    scenarioIds.push(unmigratable!.id);

    // Give the migratable row a real solve_jobs row to point resultRunId at,
    // plus a non-null result/solvedAt and a known, BACKDATED revision/
    // inputsUpdatedAt — so the post-migration assertions prove movement
    // rather than merely observing already-null/already-recent defaults.
    const [job] = await db.insert(solveJobsTable).values({
      scenarioId: migratable!.id,
      userId: TEST_USER_ID,
      status: "succeeded",
      inputsHash: "ch4o9-fixture-hash",
    }).returning();
    jobIds.push(job!.id);

    const BACKDATED = sql`now() - interval '1 hour'`;
    await db.update(scenariosTable)
      .set({
        result: { objective: 123 },
        solvedAt: BACKDATED,
        resultRunId: job!.id,
        solveInputRevision: 5,
        inputsUpdatedAt: BACKDATED,
      })
      .where(eq(scenariosTable.id, migratable!.id));

    const before = (await db.select().from(scenariosTable).where(eq(scenariosTable.id, migratable!.id)))[0]!;
    expect(before.solveInputRevision).toBe(5);

    const report = await migrateAll(db);

    expect(report.migrated).toContain(migratable!.id);
    const skippedEntry = report.skipped.find((s) => s.id === unmigratable!.id);
    expect(skippedEntry).toBeDefined();
    expect(skippedEntry!.reason).toMatch(/missing required field/i);
    expect(skippedEntry!.reason).toContain("highServiceDistKm");

    // The skipped row's core safety guarantee: it was never written. Proven
    // by the control flow (`continue` on `!result.ok` precedes the
    // `.update()` in the same loop iteration), but that proof evaporates the
    // moment someone restructures the loop -- so read the row back for real.
    const skippedAfter = (await db.select().from(scenariosTable).where(eq(scenariosTable.id, unmigratable!.id)))[0]!;
    expect(skippedAfter.inputs).toEqual(unmigratableRow);

    // Independent SELECT off the real column — not the report's own
    // `result.inputs` (that's `migrateInputs`'s pure-function output, which
    // could pass even if the real jsonb write silently mangled it).
    const after = (await db.select().from(scenariosTable).where(eq(scenariosTable.id, migratable!.id)))[0]!;
    const inputs = after.inputs as Record<string, unknown>;

    expect(inputs).not.toHaveProperty("highServiceDistKm");
    expect(inputs.highServiceDistMi).toBeCloseTo(434.96, 2);
    const overrides = inputs.distanceOverrides as Array<{ fromId: string; distance: number; estimated?: boolean }>;
    const converted = overrides.find((o) => o.fromId === "ALN")!;
    expect(converted.distance).toBeCloseTo(374, 2); // 601.894656 km -> mi
    const estimatedOne = overrides.find((o) => o.fromId === "aw-x")!;
    expect(estimatedOne.distance).toBeCloseTo(62.14, 2); // 100 km -> mi
    expect(estimatedOne.estimated).toBe(true); // boolean flag survives untouched

    // IMPORTANT #1 proof — the epoch columns moved, not just `inputs`.
    expect(after.result).toBeNull();
    expect(after.solvedAt).toBeNull();
    expect(after.resultRunId).toBeNull();
    expect(after.solveInputRevision).toBe(6); // was backdated to 5 above
    expect(after.inputsUpdatedAt.getTime()).toBeGreaterThan(before.inputsUpdatedAt.getTime());
  });
});
