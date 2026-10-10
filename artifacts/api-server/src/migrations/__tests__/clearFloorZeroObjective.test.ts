// CH4OS-4 — real-Postgres round trip for clearFloorZeroObjective. No vi.mock of
// db: real jsonb, real read-back. EVERY call passes this file's own fixture ids
// (CLAUDE.md: a test suite must never be able to execute a production data
// migration), so a plain `pnpm --filter api-server test` cannot clear rows it
// did not create, whatever DATABASE_URL points at.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { clearFloorZeroObjective } from "../clearFloorZeroObjective.js";

const TEST_USER_ID = `ch4os-clear-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const scenarioIds: number[] = [];

beforeAll(async () => {
  await db.insert(usersTable).values({ id: TEST_USER_ID, email: `${TEST_USER_ID}@example.test` }).onConflictDoNothing();
});

afterAll(async () => {
  if (scenarioIds.length > 0) await db.delete(scenariosTable).where(inArray(scenariosTable.id, scenarioIds));
  await db.delete(usersTable).where(eq(usersTable.id, TEST_USER_ID));
});

const BASE = {
  p: 3, highServiceDistMi: 450, maxDistMi: 3400, avgServiceDistCapMi: 650, gap: 0, timeLimitSec: 120,
  capacityMode: "none", distanceBands: [450, 900, 1800, 3400],
  warehouseOverrides: [], customerOverrides: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};

const ms = (v: unknown) => new Date(v as string | Date).getTime();

// Backdates the epoch so "advanced to now()" is observable, and optionally
// stores a solved result.
async function seed(modelId: string, inputs: Record<string, unknown>, result?: Record<string, unknown>): Promise<number> {
  const [row] = await db.insert(scenariosTable).values({
    name: `ch4os fixture ${scenarioIds.length}`, userId: TEST_USER_ID, modelId, inputs,
  }).returning();
  scenarioIds.push(row!.id);
  await db.update(scenariosTable).set({
    inputsUpdatedAt: sql`now() - interval '1 hour'`,
    updatedAt: sql`now() - interval '1 hour'`,
    ...(result ? { result, solvedAt: sql`now() - interval '30 minutes'` } : {}),
  }).where(eq(scenariosTable.id, row!.id));
  return row!.id;
}

async function readRow(id: number) {
  return (await db.select().from(scenariosTable).where(eq(scenariosTable.id, id)))[0]!;
}

describe("clearFloorZeroObjective — real Postgres", () => {
  it("clears objective on a floor-0 row, bumps the epoch like the input writer, leaves result alone (now stale)", async () => {
    const id = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 0, objective: "coverage" }, { status: "optimal" });
    const before = await readRow(id);
    const report = await clearFloorZeroObjective(db, false, [id]);
    expect(report).toEqual({ matched: [id], dryRun: false });
    const after = await readRow(id);
    const inputs = after.inputs as Record<string, unknown>;
    expect("objective" in inputs).toBe(false);
    expect(inputs.coverageFloorDemand).toBe(0);
    expect(inputs.p).toBe(3);                                   // nothing else in the blob moved
    expect(after.solveInputRevision).toBe(before.solveInputRevision + 1);
    expect(ms(after.inputsUpdatedAt)).toBeGreaterThan(ms(before.inputsUpdatedAt));
    expect(ms(after.updatedAt)).toBeGreaterThan(ms(before.updatedAt));
    expect(after.result).toEqual({ status: "optimal" });
    expect(ms(after.solvedAt)).toBe(ms(before.solvedAt));
    expect(ms(after.inputsUpdatedAt)).toBeGreaterThan(ms(after.solvedAt)); // isStale()'s comparison
  });

  it("leaves positive-floor, already-cleared and other-model rows untouched", async () => {
    const positive = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 500, objective: "min_distance" });
    const cleared = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 0 });
    // Synthetic: proves the model_id predicate, not a real p-median shape.
    const otherModel = await seed("p-median-us", { coverageFloorDemand: 0, objective: "coverage" });
    const before = await Promise.all([positive, cleared, otherModel].map(readRow));
    const report = await clearFloorZeroObjective(db, false, [positive, cleared, otherModel]);
    expect(report.matched).toEqual([]);
    const after = await Promise.all([positive, cleared, otherModel].map(readRow));
    for (let i = 0; i < 3; i++) {
      expect(after[i]!.inputs).toEqual(before[i]!.inputs);
      expect(after[i]!.solveInputRevision).toBe(before[i]!.solveInputRevision);
    }
  });

  it("is idempotent — a second run matches nothing and does not bump again", async () => {
    const id = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 0, objective: "min_distance" });
    await clearFloorZeroObjective(db, false, [id]);
    const mid = await readRow(id);
    const second = await clearFloorZeroObjective(db, false, [id]);
    expect(second.matched).toEqual([]);
    expect((await readRow(id)).solveInputRevision).toBe(mid.solveInputRevision);
  });

  it("dry run reports the ids it would clear and writes nothing", async () => {
    const id = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 0, objective: "coverage" });
    const before = await readRow(id);
    const report = await clearFloorZeroObjective(db, true, [id]);
    expect(report).toEqual({ matched: [id], dryRun: true });
    const after = await readRow(id);
    expect(after.inputs).toEqual(before.inputs);
    expect(after.solveInputRevision).toBe(before.solveInputRevision);
  });

  it("an explicit EMPTY id filter matches nothing — never 'every row'", async () => {
    const id = await seed("max-coverage-us", { ...BASE, coverageFloorDemand: 0, objective: "coverage" });
    const report = await clearFloorZeroObjective(db, false, []);
    expect(report.matched).toEqual([]);
    expect((await readRow(id)).inputs).toHaveProperty("objective", "coverage");   // non-vacuity: a matching row existed
  });
});
