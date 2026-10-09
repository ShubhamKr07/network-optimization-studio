// WF-8 — real-Postgres round trip for `roundAll`, the one-off override-
// precision backfill that completes WF-7 (FU-2/D5) for rows written BEFORE
// import started rounding. Follows migrateAllIntegration.test.ts's convention
// exactly: no vi.mock of db anywhere in this file — real Postgres, real jsonb
// column, real read-back, and every call carries an explicit scenario-id
// filter so a plain `pnpm --filter api-server test` can never run the
// unfiltered production backfill against whatever `DATABASE_URL` points at.
//
// `seedScenario`/`storedDistance`/`readRow` are defined here rather than
// imported: migrateAllIntegration.test.ts inlines its own inserts and exports
// nothing, so there was no existing helper to reuse. The plumbing is adapted
// from it (TEST_USER_ID shape, id-collecting `afterAll` teardown, independent
// read-back SELECT rather than trusting the report); the asserted values are
// the brief's, verbatim.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { roundAll } from "../roundOverridePrecision.js";

const TEST_USER_ID = `wf8-round-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const scenarioIds: number[] = [];

beforeAll(async () => {
  await db.insert(usersTable).values({ id: TEST_USER_ID, email: `${TEST_USER_ID}@example.test` })
    .onConflictDoNothing();
});

afterAll(async () => {
  if (scenarioIds.length > 0) {
    await db.delete(scenariosTable).where(inArray(scenariosTable.id, scenarioIds));
  }
  await db.delete(usersTable).where(eq(usersTable.id, TEST_USER_ID));
});

interface SeedOpts {
  modelId: string;
  distanceBands?: number[];
  distanceOverrides?: Array<Record<string, unknown>>;
  laneCostOverrides?: Array<Record<string, unknown>>;
  result?: Record<string, unknown>;
  solveInputRevision?: number;
}

// Everything except `modelId`/`result`/`solveInputRevision` becomes the
// `inputs` blob. Object rest copies only the keys the caller actually passed,
// so an omitted entity is ABSENT from the blob rather than present-and-
// undefined — which is what the "field missing entirely" branch needs to see.
async function seedScenario(opts: SeedOpts): Promise<number> {
  const { modelId, result, solveInputRevision, ...inputs } = opts;
  const [row] = await db.insert(scenariosTable).values({
    name: `wf8 fixture ${scenarioIds.length}`,
    userId: TEST_USER_ID,
    modelId,
    inputs,
  }).returning();
  scenarioIds.push(row!.id);
  if (result !== undefined || solveInputRevision !== undefined) {
    await db.update(scenariosTable)
      .set({
        ...(result !== undefined ? { result, solvedAt: sql`now()` } : {}),
        ...(solveInputRevision !== undefined ? { solveInputRevision } : {}),
      })
      .where(eq(scenariosTable.id, row!.id));
  }
  return row!.id;
}

async function readRow(id: number) {
  return (await db.select().from(scenariosTable).where(eq(scenariosTable.id, id)))[0]!;
}

// Independent SELECT off the real jsonb column — never the report's own view
// of what it computed, which could pass even if the write mangled the blob.
async function storedValue(id: number, key: string, field: string, toId: string): Promise<unknown> {
  const inputs = (await readRow(id)).inputs as Record<string, unknown>;
  const list = inputs[key] as Array<Record<string, unknown>> | undefined;
  return list?.find((o) => o.toId === toId)?.[field];
}

const storedDistance = (id: number, toId: string) => storedValue(id, "distanceOverrides", "distance", toId);
const storedCost = (id: number, toId: string) => storedValue(id, "laneCostOverrides", "cost", toId);

describe("roundOverridePrecision — real-Postgres round trip", () => {
  it("rounds an over-precise override to 4 dp", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200, 400, 800, 1600],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 6.2137119223733395 }] });
    const report = await roundAll(db, false, [id]);
    expect(report.rounded).toEqual([id]);
    expect(await storedDistance(id, "C1")).toBe(6.2137);
  });

  // Production's actual shape (scenario 40): BOTH of its values, under its real
  // bands. Neither crosses, so the real backfill takes the no-refusal path —
  // this is the fixture that says so rather than asserting it in prose.
  it("rounds both of production scenario 40's values under its real bands", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200, 400, 800, 1600],
      distanceOverrides: [
        { fromId: "ALN", toId: "C1", distance: 6.2137119223733395 },
        { fromId: "ALN", toId: "C2", distance: 9.32056788356001 },
      ] });
    const report = await roundAll(db, false, [id]);
    expect(report.refused).toEqual([]);
    expect(report.rounded).toEqual([id]);
    expect(await storedDistance(id, "C1")).toBe(6.2137);
    expect(await storedDistance(id, "C2")).toBe(9.3206);
  });

  it("is idempotent — a second run reports alreadyRounded and writes nothing", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 6.2137119223733395 }] });
    await roundAll(db, false, [id]);
    const second = await roundAll(db, false, [id]);
    expect(second.rounded).toEqual([]);
    expect(second.alreadyRounded).toEqual([id]);
    expect(await storedDistance(id, "C1")).toBe(6.2137);
  });

  // 450.00004 rounds DOWN to exactly 450.0, moving the value from the overflow
  // bucket INTO the 450 band — a real membership change. Do NOT use 449.99996
  // here: it rounds UP to 450.0 but is <= 450 both before and after, so
  // membership does not change and the guard correctly ignores it. That value
  // was this plan's original fixture and would have made this test fail.
  //
  // A SECOND, non-crossing scenario is in scope deliberately. Without it this
  // test passes against a guard that refuses EVERY row — which would pass
  // "refuses a band-crossing row" while breaking the entire backfill. With it,
  // the test is red under both mutations: guard removed (the crossing row gets
  // rounded) and guard over-broad (the safe row gets refused).
  it("REFUSES a row whose value would change which band it is reported in", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [450],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 450.00004 }] });
    const safeId = await seedScenario({ modelId: "p-median-us", distanceBands: [450],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 6.2137119223733395 }] });
    const report = await roundAll(db, false, [id, safeId]);
    expect(report.rounded).toEqual([safeId]);
    expect(report.refused).toHaveLength(1);
    expect(report.refused[0]).toMatchObject({ id });
    expect(report.refused[0]!.reason).toContain("450");
    // Refused means UNCHANGED, not partially written.
    expect(await storedDistance(id, "C1")).toBe(450.00004);
    // And the non-crossing row in the same run WAS rounded.
    expect(await storedDistance(safeId, "C1")).toBe(6.2137);
  });

  it("does NOT refuse a value that rounds onto a boundary from inside the band", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [450],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 449.99996 }] });
    const report = await roundAll(db, false, [id]);
    // 449.99996 and 450.0 are both within the 450 band, so nothing is reported
    // differently and the row is safe to round. This pins the guard against the
    // interval-based implementation, which would have refused it.
    expect(report.refused).toEqual([]);
    expect(report.rounded).toEqual([id]);
    expect(await storedDistance(id, "C1")).toBe(450);
  });

  // Refusal is per-ROW, not per-value: a row carrying one crossing value and
  // one safe value must be written NOT AT ALL, or the operator inherits a row
  // that is half-backfilled and no longer matches either report.
  it("refuses the whole row when only one of its values would cross a band", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [450],
      distanceOverrides: [
        { fromId: "ALN", toId: "C1", distance: 6.2137119223733395 },
        { fromId: "ALN", toId: "C2", distance: 450.00004 },
      ] });
    const report = await roundAll(db, false, [id]);
    expect(report.rounded).toEqual([]);
    expect(report.refused).toHaveLength(1);
    expect(await storedDistance(id, "C1")).toBe(6.2137119223733395);
    expect(await storedDistance(id, "C2")).toBe(450.00004);
  });

  // WF-8 deviation (see the implementation's header): rounding can take a
  // positive value to exactly 0, and every override schema in
  // validation/inputs/** requires `positive()`. Writing it would produce a row
  // the running server can no longer load — the ch4ToMiles lesson ("integer
  // rounding turns valid persisted rows invalid"), reached here by a different
  // route. Refused, not written.
  it("REFUSES a value that would round to zero", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 0.00004 }] });
    const report = await roundAll(db, false, [id]);
    expect(report.rounded).toEqual([]);
    expect(report.refused).toHaveLength(1);
    expect(report.refused[0]!.reason).toMatch(/rounds to 0/);
    expect(await storedDistance(id, "C1")).toBe(0.00004);
  });

  it("does NOT clear result or bump the solve epoch on a row it rounds", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 6.2137119223733395 }],
      result: { status: "optimal" }, solveInputRevision: 7 });
    const before = await readRow(id);
    await roundAll(db, false, [id]);
    const row = await readRow(id);
    expect(row.result).not.toBeNull();
    expect(row.solveInputRevision).toBe(7);
    expect(row.solvedAt).not.toBeNull();
    // Exact, not merely non-null: `solvedAt: sql`now()`` would satisfy
    // `not.toBeNull()` while having re-dated the solve, and a `+ 1` epoch bump
    // would satisfy nothing above if `solveInputRevision` were also reseeded.
    expect(row.result).toEqual(before.result);
    expect(row.solvedAt!.getTime()).toBe(before.solvedAt!.getTime());
    expect(row.inputsUpdatedAt.getTime()).toBe(before.inputsUpdatedAt.getTime());
    // ...and the round DID happen, so none of the above is vacuously true of a
    // no-op implementation.
    expect(await storedDistance(id, "C1")).toBe(6.2137);
  });

  it("a dry run reports what it WOULD do and writes nothing", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 6.2137119223733395 }] });
    const report = await roundAll(db, true, [id]);
    expect(report.dryRun).toBe(true);
    expect(report.rounded).toEqual([id]);
    expect(await storedDistance(id, "C1")).toBe(6.2137119223733395);
    // FU-13's lesson, applied here: a dry run whose list is merely non-empty is
    // not the contract — matching the real run is.
    const real = await roundAll(db, false, [id]);
    expect(real.rounded).toEqual([id]);
    expect(real.dryRun).toBe(false);
    expect(await storedDistance(id, "C1")).toBe(6.2137);
  });

  it("a dry run reports a refusal without writing either row", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [450],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 450.00004 }] });
    const dry = await roundAll(db, true, [id]);
    expect(dry.refused).toHaveLength(1);
    expect(dry.rounded).toEqual([]);
    expect(await storedDistance(id, "C1")).toBe(450.00004);
  });

  it("an empty id filter touches nothing", async () => {
    // An affected row EXISTS and is deliberately left out of scope: without
    // it, this test would also pass against an implementation that read an
    // empty filter as "every row".
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 6.2137119223733395 }] });
    const report = await roundAll(db, false, []);
    expect(report.rounded).toEqual([]);
    expect(report.refused).toEqual([]);
    expect(report.alreadyRounded).toEqual([]);
    expect(await storedDistance(id, "C1")).toBe(6.2137119223733395);
  });

  // The three distance-bearing IMPORT entities WF-7 rounded are `distances`,
  // `laneCosts` and `legDistances`. They persist into only TWO inputs keys:
  // `distanceOverrides` (distances, and legDistances — see services/import.ts's
  // legDistances branch, which diffs and writes `distanceOverrides`) and
  // `laneCostOverrides` (laneCosts). These two tests cover the entities the
  // first six do not, so "handles all three entities" is asserted, not assumed.
  it("rounds a transport-coal laneCostOverrides value (the laneCosts entity)", async () => {
    const id = await seedScenario({ modelId: "transport-coal", distanceBands: [200, 400],
      laneCostOverrides: [{ fromId: "M1", toId: "S1", cost: 6.2137119223733395, estimated: true }] });
    const report = await roundAll(db, false, [id]);
    expect(report.rounded).toEqual([id]);
    expect(await storedCost(id, "S1")).toBe(6.2137);
    // Sibling keys on the same override object survive untouched.
    const inputs = (await readRow(id)).inputs as Record<string, unknown>;
    expect((inputs.laneCostOverrides as Array<Record<string, unknown>>)[0]!.estimated).toBe(true);
  });

  it("rounds a two-echelon distanceOverrides value (the legDistances entity)", async () => {
    const id = await seedScenario({ modelId: "two-echelon-gold-au", distanceBands: [200, 400],
      distanceOverrides: [{ fromId: "R1", toId: "C1", distance: 9.32056788356001 }] });
    const report = await roundAll(db, false, [id]);
    expect(report.rounded).toEqual([id]);
    expect(await storedDistance(id, "C1")).toBe(9.3206);
  });

  it("leaves non-override fields in the blob byte-for-byte alone", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200],
      distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 6.2137119223733395 }] });
    const before = (await readRow(id)).inputs as Record<string, unknown>;
    await roundAll(db, false, [id]);
    const after = (await readRow(id)).inputs as Record<string, unknown>;
    expect(after.distanceBands).toEqual(before.distanceBands);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  });

  it("reports a row with no override fields at all as alreadyRounded, and writes nothing", async () => {
    const id = await seedScenario({ modelId: "p-median-us", distanceBands: [200] });
    const before = (await readRow(id)).inputs;
    const report = await roundAll(db, false, [id]);
    expect(report.alreadyRounded).toEqual([id]);
    expect(report.rounded).toEqual([]);
    expect((await readRow(id)).inputs).toEqual(before);
  });
});
