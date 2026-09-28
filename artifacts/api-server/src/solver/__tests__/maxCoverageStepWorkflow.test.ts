// CH4-23/CH4-26 — real, unmocked Postgres. Run with a live DATABASE_URL:
//   DATABASE_URL=postgresql://... pnpm --filter api-server exec vitest run \
//     src/solver/__tests__/maxCoverageStepWorkflow.test.ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import app from "../../app.js";
import { synthesizeStep2Inputs } from "../../services/maxCoverageSteps.js";

const scenarioIds: number[] = [];
const registeredUserIds: string[] = [];

const step1Inputs = {
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
  distanceOverrides: [],
};

async function registerAndGetCookie(): Promise<string> {
  const email = `ch4-2s-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  registeredUserIds.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}

async function createScenario(cookie: string) {
  const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
    .send({ name: "two-step fixture", modelId: "max-coverage-us", inputs: step1Inputs });
  expect(res.status).toBe(201);
  scenarioIds.push(res.body.id);
  return res.body;
}

async function readEpoch(scenarioId: number): Promise<number> {
  const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenarioId));
  return (row!.inputs as Record<string, unknown>).stepEpoch as number;
}

afterAll(async () => {
  if (scenarioIds.length > 0) {
    await db.delete(solveJobsTable).where(inArray(solveJobsTable.scenarioId, scenarioIds));
    await db.delete(scenariosTable).where(inArray(scenariosTable.id, scenarioIds));
  }
  if (registeredUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, registeredUserIds));
  }
});

describe("CH4-26 — epoch authority across every inputs writer", () => {
  it("create forces stepEpoch = 1", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    expect(await readEpoch(scenario.id)).toBe(1);
  });

  it("a Step 1 PATCH bumps the epoch", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4 } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);
  });

  it("a step2-only PATCH does not bump the epoch", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, step2: { gap: 0.01, timeLimitSec: 60 } } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(1);
  });

  it("a distanceBands-only PATCH does not bump the epoch", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, distanceBands: [700, 1400, 5500] } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(1);
  });

  // CH4-23 — the integrity case. A forged OLD epoch must not be stored, or a
  // superseded job's snapshot would match the current epoch and present as
  // current. Asserted by reading the PERSISTED row back, not the response.
  it("discards a client-supplied stepEpoch and never lowers the stored value", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4 } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4, stepEpoch: 1 } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 5, stepEpoch: 1 } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(3);
  });

  it("clone reinitializes the epoch to 1 while preserving the parameters", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4, step2: { gap: 0.01, timeLimitSec: 60 } } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);

    const cloned = await request(app).post(`/api/scenarios/${scenario.id}/clone`).set("Cookie", cookie).expect(201);
    scenarioIds.push(cloned.body.id);
    expect(await readEpoch(cloned.body.id)).toBe(1);
    expect(cloned.body.inputs.p).toBe(4);
    expect(cloned.body.inputs.step2).toEqual({ gap: 0.01, timeLimitSec: 60 });
  });

  it("a bands-only write through the dedicated endpoint leaves the epoch untouched", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4 } }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);

    await request(app).patch(`/api/scenarios/${scenario.id}/distance-bands`).set("Cookie", cookie)
      .send({ distanceBands: [700, 1400, 5500] }).expect(200);
    expect(await readEpoch(scenario.id)).toBe(2);
  });

  // Two overlapping Step 1 edits must yield two DISTINCT consecutive epochs.
  // A read-modify-write in application code would let both read n and write
  // n+1, losing one bump and leaving a superseded job looking current.
  it("two concurrent Step 1 PATCHes produce two distinct consecutive epochs", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await Promise.all([
      request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
        .send({ inputs: { ...step1Inputs, p: 4 } }),
      request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
        .send({ inputs: { ...step1Inputs, p: 5 } }),
    ]);
    expect(await readEpoch(scenario.id)).toBe(3);
  });
});

describe("R8 — combined name-and-inputs PATCHes are atomic", () => {
  it("applies both when the write succeeds", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ name: "renamed together", inputs: { ...step1Inputs, p: 4 } }).expect(200);

    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(row!.name).toBe("renamed together");
    expect((row!.inputs as Record<string, unknown>).p).toBe(4);
    expect(await readEpoch(scenario.id)).toBe(2);
  });

  // The half that actually proves atomicity: a rejected inputs payload must
  // leave the NAME untouched too. Asserted against the persisted row — the
  // response status alone cannot distinguish "rolled back" from "name applied
  // anyway".
  //
  // Deviation from the plan's literal payload (CH4-2s-2): the plan's example
  // (`coverageFloorDemand: 1` alongside `objective: "coverage"`) does not
  // actually violate maxCoverageInputsSchema — `coverageFloorDemand` is a
  // plain optional field there, only REQUIRED (not forbidden) under
  // `objective: "min_distance"` (maxCoverage.ts's superRefine). Verified via
  // a direct `safeParse` before writing this test. Swapped in
  // `highServiceDistKm: 9999`, which genuinely violates the schema's
  // `highServiceDistKm < maxDistKm` cross-field invariant, to keep the
  // regression's actual purpose (a rejected write leaves nothing applied)
  // intact against the real schema.
  it("applies NEITHER when the inputs half is rejected", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [before] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ name: "must not stick", inputs: { ...step1Inputs, p: 4, highServiceDistKm: 9999 } })
      .expect(422);

    const [after] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(after!.name).toBe(before!.name);
    expect((after!.inputs as Record<string, unknown>).p).toBe(3);
    expect(await readEpoch(scenario.id)).toBe(1);
  });

  // CH4-2s-3 — the guard from Task 3 makes `coverageFloorDemand` genuinely
  // rejectable (it was a plain valid optional field before this task), so the
  // atomicity property above deserves its own case against the field CH4-25
  // actually exists to reject, not just an unrelated schema violation.
  it("applies NEITHER when the inputs half carries a rejected coverageFloorDemand", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [before] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ name: "must not stick", inputs: { ...step1Inputs, p: 4, coverageFloorDemand: 1 } })
      .expect(422);

    const [after] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(after!.name).toBe(before!.name);
    expect((after!.inputs as Record<string, unknown>).p).toBe(3);
    expect((after!.inputs as Record<string, unknown>).coverageFloorDemand).toBeUndefined();
    expect(await readEpoch(scenario.id)).toBe(1);
  });
});

describe("CH4-24/CH4-25 — the floor is rejected literally, not stripped", () => {
  it("422s a PATCH carrying coverageFloorDemand and leaves the row untouched", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4, coverageFloorDemand: 1 } })
      .expect(422);

    // Read the PERSISTED row back: a stripping bug and a rejecting guard are
    // indistinguishable from the response alone. If the guard had merely
    // stripped, `p` would now be 4 and the epoch 2.
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    const inputs = row!.inputs as Record<string, unknown>;
    expect(inputs.p).toBe(3);
    expect(inputs.coverageFloorDemand).toBeUndefined();
    expect(inputs.stepEpoch).toBe(1);
  });

  it("422s a PATCH carrying objective min_distance", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, objective: "min_distance", coverageFloorDemand: 53385024 } })
      .expect(422);
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect((row!.inputs as Record<string, unknown>).objective).toBe("coverage");
  });

  it("422s a create carrying a floor", async () => {
    const cookie = await registerAndGetCookie();
    await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "rejected", modelId: "max-coverage-us", inputs: { ...step1Inputs, coverageFloorDemand: 1 } })
      .expect(422);
  });
});

describe("CH4-9/CH4-11 — step derivation and the one-active-job guard", () => {
  // R7 — DETERMINISTIC, not timing-dependent. An earlier draft fired two
  // POSTs and asserted exactly [202, 409]; that races the dispatcher, because
  // the first job can finish before the second request takes the lock, making
  // [202, 202] a legitimate outcome and the test flaky. Seed the active job
  // instead, so the guard is the only variable.
  it("409s with the in-flight jobId when a Chapter 4 job is already active", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    const [seeded] = await db.insert(solveJobsTable).values({
      scenarioId: scenario.id,
      userId: owner!.userId,
      status: "queued",
      inputsHash: "seeded-active",
      modelId: "max-coverage-us",
      inputSnapshot: { modelId: "max-coverage-us", inputs: { ...step1Inputs, stepEpoch: 1 } },
    }).returning();

    const res = await request(app).post(`/api/scenarios/${scenario.id}/solve`).set("Cookie", cookie).expect(409);
    expect(res.body.jobId).toBe(seeded.id);

    await db.delete(solveJobsTable).where(eq(solveJobsTable.id, seeded.id));
  });

  // The database is the backstop: even if a future caller forgets the
  // in-transaction check, the partial unique index must refuse the row.
  it("the database itself rejects a second active Chapter 4 job", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    const values = (hash: string) => ({
      scenarioId: scenario.id,
      userId: owner!.userId,
      status: "queued" as const,
      inputsHash: hash,
      modelId: "max-coverage-us",
      inputSnapshot: { modelId: "max-coverage-us", inputs: { ...step1Inputs, stepEpoch: 1 } },
    });

    const [first] = await db.insert(solveJobsTable).values(values("dup-a")).returning();
    await expect(db.insert(solveJobsTable).values(values("dup-b"))).rejects.toThrow();
    await db.delete(solveJobsTable).where(eq(solveJobsTable.id, first.id));
  });

  // R1 — the other five models keep their existing semantics. This is the
  // regression that fails loudly if the index or the guard is ever unscoped.
  it("leaves non-Chapter-4 enqueue semantics untouched (two active p-median jobs are legal)", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "p-median two active", modelId: "p-median-us",
      inputs: {
        p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
        warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
        addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
      },
    }).expect(201);
    scenarioIds.push(created.body.id);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, created.body.id));

    const values = (hash: string) => ({
      scenarioId: created.body.id as number,
      userId: owner!.userId,
      status: "queued" as const,
      inputsHash: hash,
      modelId: "p-median-us",
    });

    const [a] = await db.insert(solveJobsTable).values(values("pm-a")).returning();
    const [b] = await db.insert(solveJobsTable).values(values("pm-b")).returning();
    expect(a.id).not.toBe(b.id);

    await db.delete(solveJobsTable).where(inArray(solveJobsTable.id, [a.id, b.id]));
  });

  it("a scenario with no succeeded Step 1 job targets Step 1", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const res = await request(app).post(`/api/scenarios/${scenario.id}/solve`).set("Cookie", cookie).expect(202);
    const [job] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, res.body.jobId));
    const snapshot = job!.inputSnapshot as { inputs: Record<string, unknown> };
    expect(snapshot.inputs.objective).toBe("coverage");
    expect(snapshot.inputs.coverageFloorDemand).toBeUndefined();
    expect(snapshot.inputs.stepEpoch).toBe(1);
  });
});

describe("CH4-12/CH4-13/CH4-14 — the steps read path", () => {
  it("reports both steps unsolved for a fresh scenario", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const res = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(res.body.steps).toEqual({
      step1: { solved: false, stale: false, jobId: null, summary: null },
      step2: { solved: false, stale: false, jobId: null, summary: null },
    });
  });

  it("omits steps entirely for another model", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "p-median", modelId: "p-median-us",
      inputs: {
        p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
        warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
        addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
      },
    }).expect(201);
    scenarioIds.push(created.body.id);
    const res = await request(app).get(`/api/scenarios/${created.body.id}`).set("Cookie", cookie).expect(200);
    expect(res.body.steps).toBeUndefined();
  });

  it("404s the step-result endpoint for an unsolved step", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).get(`/api/scenarios/${scenario.id}/steps/1/result`).set("Cookie", cookie).expect(404);
  });

  // Hard rule #5 — a non-owner gets 404, never 403, so a scenario id cannot
  // be enumerated through this endpoint.
  it("404s the step-result endpoint for a non-owner", async () => {
    const owner = await registerAndGetCookie();
    const stranger = await registerAndGetCookie();
    const scenario = await createScenario(owner);
    await request(app).get(`/api/scenarios/${scenario.id}/steps/1/result`).set("Cookie", stranger).expect(404);
    await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", stranger).expect(404);
  });

  it("404s an out-of-range step", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    await request(app).get(`/api/scenarios/${scenario.id}/steps/3/result`).set("Cookie", cookie).expect(404);
  });

  // Acceptance row 13 — the CROSS-MODEL half. A p-median scenario has no step
  // concept; its owner must still get 404, not a 500 from dereferencing a null
  // `steps`. This is the case the route's `modelId !== "max-coverage-us"`
  // guard exists for, and nothing was proving it.
  it("404s the step-result endpoint for a non-Chapter-4 scenario, even for its owner", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "cross-model", modelId: "p-median-us",
      inputs: {
        p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
        warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
        addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
      },
    }).expect(201);
    scenarioIds.push(created.body.id);
    await request(app).get(`/api/scenarios/${created.body.id}/steps/1/result`).set("Cookie", cookie).expect(404);
  });

  // A job carrying a SUPERSEDED epoch must not be selected: that is what
  // "clearing a step" means. Seeded directly so the test does not depend on a
  // real CBC run.
  it("ignores a succeeded job whose snapshot carries a superseded epoch", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await db.insert(solveJobsTable).values({
      scenarioId: scenario.id,
      userId: owner!.userId,
      status: "succeeded",
      inputsHash: "seeded-superseded",
      modelId: "max-coverage-us",
      inputSnapshot: { modelId: "max-coverage-us", inputs: { ...step1Inputs, stepEpoch: 1 } },
      result: {
        status: "optimal", solutionStatus: "optimal", quality: "Proven Optimal", runTimeSec: 1.5,
        metrics: { weightedAvgDistance: 635.13 },
        details: { objective: "coverage", coveragePct: 68.4192, coveredDemand: 53385024 },
      },
    });

    const before = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(before.body.steps.step1.solved).toBe(true);
    expect(before.body.steps.step1.summary.coveredDemand).toBe(53385024);
    expect(before.body.steps.step1.summary.coveragePct).toBeCloseTo(68.4192, 4);
    expect(before.body.steps.step1.summary.distanceUnit).toBe("km");

    // A Step 1 edit bumps the epoch to 2 — the seeded job is now superseded.
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4 } }).expect(200);

    const after = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(after.body.steps.step1.solved).toBe(false);
    expect(after.body.steps.step1.summary).toBeNull();
  });

  // Acceptance row 7 — CH4-2 says a Step 1 edit drops BOTH results, not just
  // Step 2's. An earlier draft only asserted Step 1, which would pass even if
  // Step 2 survived the epoch bump and kept presenting a result computed
  // against a configuration that no longer exists.
  it("a Step 1 edit clears BOTH steps, not only Step 1", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await seedStep1Job(scenario.id, owner!.userId, 1);
    await seedStep2Job(scenario.id, owner!.userId, row!.inputs as Record<string, unknown>);

    const before = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(before.body.steps.step1.solved).toBe(true);
    expect(before.body.steps.step2.solved).toBe(true);

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4 } }).expect(200);

    const after = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(after.body.steps.step1.solved).toBe(false);
    expect(after.body.steps.step2.solved).toBe(false);
    expect(after.body.steps.step2.summary).toBeNull();
    expect(await readEpoch(scenario.id)).toBe(2);
  });

  // Acceptance row 8 — bands are a reporting lens. The epoch assertion alone
  // (Task 2) does not prove SOLVE VALIDITY survives: a bands edit must leave
  // both steps still solved, not merely leave the counter intact.
  it("a distanceBands-only change alters neither the epoch nor either step's validity", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await seedStep1Job(scenario.id, owner!.userId, 1);
    await seedStep2Job(scenario.id, owner!.userId, row!.inputs as Record<string, unknown>);

    await request(app).patch(`/api/scenarios/${scenario.id}/distance-bands`).set("Cookie", cookie)
      .send({ distanceBands: [700, 1400, 5500] }).expect(200);

    const after = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(after.body.steps.step1.solved).toBe(true);
    expect(after.body.steps.step2.solved).toBe(true);
    expect(after.body.steps.step2.stale).toBe(false);
    expect(await readEpoch(scenario.id)).toBe(1);
  });

  // A Step 1 snapshot is `validation.data` — it RETAINS step2 and stepEpoch
  // (see A3). Seeding it literally is therefore faithful to production, unlike
  // the Step 2 case below.
  async function seedStep1Job(scenarioId: number, userId: string, stepEpoch: number) {
    const [job] = await db.insert(solveJobsTable).values({
      scenarioId,
      userId,
      status: "succeeded",
      inputsHash: `seeded-step1-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      modelId: "max-coverage-us",
      inputSnapshot: { modelId: "max-coverage-us", inputs: { ...step1Inputs, stepEpoch } },
      result: {
        status: "optimal", solutionStatus: "optimal", quality: "Proven Optimal", runTimeSec: 1.5,
        metrics: { weightedAvgDistance: 635.13 },
        details: { objective: "coverage", coveragePct: 68.4192, coveredDemand: 53385024 },
      },
    }).returning();
    return job;
  }

  // R2 — the snapshot is built through synthesizeStep2Inputs, the SAME
  // function the enqueue path uses. An earlier draft hand-authored a snapshot
  // carrying a nested `step2` bag, which production never stores; that test
  // passed while the projection it was meant to prove was broken.
  async function seedStep2Job(scenarioId: number, userId: string, currentInputs: Record<string, unknown>) {
    const [job] = await db.insert(solveJobsTable).values({
      scenarioId,
      userId,
      status: "succeeded",
      inputsHash: `seeded-step2-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      modelId: "max-coverage-us",
      inputSnapshot: {
        modelId: "max-coverage-us",
        inputs: synthesizeStep2Inputs(currentInputs, 53385024),
      },
      result: {
        status: "optimal", solutionStatus: "optimal", quality: "Proven Optimal", runTimeSec: 2.1,
        metrics: { weightedAvgDistance: 624.33 },
        details: { objective: "min_distance", coveragePct: 68.4192, coveredDemand: 53385024 },
      },
    }).returning();
    return job;
  }

  it("reports a freshly-synthesized Step 2 job as fresh when no step2 bag exists (inherited defaults)", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await seedStep2Job(scenario.id, owner!.userId, row!.inputs as Record<string, unknown>);

    const res = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(res.body.steps.step2.solved).toBe(true);
    // This is the assertion that fails against the old nested-step2 projection.
    expect(res.body.steps.step2.stale).toBe(false);
  });

  it("reports a Step 2 job solved with EXPLICIT step2 settings as fresh", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, step2: { gap: 0.05, timeLimitSec: 60 } } }).expect(200);
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await seedStep2Job(scenario.id, owner!.userId, row!.inputs as Record<string, unknown>);

    const res = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(res.body.steps.step2.stale).toBe(false);
  });

  it("flags Step 2 stale only after its effective settings change, without moving the epoch", async () => {
    const cookie = await registerAndGetCookie();
    const scenario = await createScenario(cookie);
    const [owner] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    await seedStep2Job(scenario.id, owner!.userId, row!.inputs as Record<string, unknown>);
    expect((await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)).body.steps.step2.stale).toBe(false);

    // A step2-only save does NOT bump the epoch, so the job stays selected —
    // it just becomes stale.
    await request(app).patch(`/api/scenarios/${scenario.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, step2: { gap: 0.05, timeLimitSec: 120 } } }).expect(200);

    const stale = await request(app).get(`/api/scenarios/${scenario.id}`).set("Cookie", cookie).expect(200);
    expect(stale.body.steps.step2.solved).toBe(true);
    expect(stale.body.steps.step2.stale).toBe(true);
    expect(stale.body.steps.step1.stale).toBe(false);
    expect(await readEpoch(scenario.id)).toBe(1);
  });
});
