// cmp-1 — loadScenarioStepsBatch: the batch sibling of loadScenarioSteps that
// GET /scenarios (the list route) uses, so the Compare feature reads the
// SELECTED step's summary rather than whatever step was last solved.
// Real, unmocked Postgres. Run with a live DATABASE_URL:
//   DATABASE_URL=postgresql://... pnpm --filter api-server exec vitest run \
//     src/services/__tests__/maxCoverageStepsBatch.test.ts
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import app from "../../app.js";
import { loadScenarioStepsBatch, synthesizeStep2Inputs } from "../maxCoverageSteps.js";

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

async function registerAndGetCookie(slug: string): Promise<{ cookie: string; userId: string }> {
  const email = `cmp1-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
  return { cookie, userId: res.body.user.id as string };
}

async function createScenario(cookie: string, name: string) {
  const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
    .send({ name, modelId: "max-coverage-us", inputs: step1Inputs });
  expect(res.status).toBe(201);
  scenarioIds.push(res.body.id);
  return res.body as { id: number; inputs: Record<string, unknown> };
}

async function seedStep1Job(scenarioId: number, userId: string, stepEpoch: number, coveredDemand: number) {
  const [job] = await db.insert(solveJobsTable).values({
    scenarioId,
    userId,
    status: "succeeded",
    inputsHash: `cmp1-step1-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    modelId: "max-coverage-us",
    inputSnapshot: { modelId: "max-coverage-us", inputs: { ...step1Inputs, stepEpoch } },
    result: {
      status: "optimal", solutionStatus: "optimal", quality: "Proven Optimal", runTimeSec: 1.5,
      metrics: { weightedAvgDistance: 635.13 },
      details: { objective: "coverage", coveragePct: 68.4192, coveredDemand },
    },
  }).returning();
  return job;
}

// R2's own posture (maxCoverageStepWorkflow.test.ts) — build a real Step 2
// snapshot through synthesizeStep2Inputs, the same function the enqueue path
// uses, rather than hand-authoring a nested `step2` bag production never
// writes.
async function seedStep2Job(scenarioId: number, userId: string, currentInputs: Record<string, unknown>, coveredDemand: number) {
  const [job] = await db.insert(solveJobsTable).values({
    scenarioId,
    userId,
    status: "succeeded",
    inputsHash: `cmp1-step2-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    modelId: "max-coverage-us",
    inputSnapshot: { modelId: "max-coverage-us", inputs: synthesizeStep2Inputs(currentInputs, coveredDemand) },
    result: {
      status: "optimal", solutionStatus: "optimal", quality: "Proven Optimal", runTimeSec: 2.1,
      metrics: { weightedAvgDistance: 624.33 },
      details: { objective: "min_distance", coveragePct: 68.4192, coveredDemand },
    },
  }).returning();
  return job;
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

describe("cmp-1 — per-scenario epoch correctness (the design point that would bite a shared-epoch filter)", () => {
  it("scenario B's superseded job is rejected even though it shares scenario A's CURRENT epoch value", async () => {
    const { cookie, userId } = await registerAndGetCookie("epoch-mismatch");
    const scenarioA = await createScenario(cookie, "A — stays at epoch 1");
    const scenarioB = await createScenario(cookie, "B — bumped to epoch 2");

    // Bump B's epoch via a real Step 1 PATCH, so B's CURRENT epoch is 2 while
    // A's stays at 1 — the two scenarios now genuinely disagree.
    await request(app).patch(`/api/scenarios/${scenarioB.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, p: 4 } }).expect(200);

    // Seed BOTH scenarios' succeeded Step 1 job at epoch 1. For A this is
    // current; for B it is superseded by the PATCH above. A naive
    // implementation that filtered on ONE shared epoch value (e.g. A's
    // epoch, 1, applied to the whole batch) would wrongly accept B's job too,
    // since 1 === 1 — it has no way to know B's own epoch moved to 2.
    await seedStep1Job(scenarioA.id, userId, 1, 11111);
    await seedStep1Job(scenarioB.id, userId, 1, 22222);

    const [rowA] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenarioA.id));
    const [rowB] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenarioB.id));

    const result = await loadScenarioStepsBatch(userId, [
      { id: scenarioA.id, inputs: rowA!.inputs as Record<string, unknown> },
      { id: scenarioB.id, inputs: rowB!.inputs as Record<string, unknown> },
    ]);

    expect(result.get(scenarioA.id)!.step1.solved).toBe(true);
    expect(result.get(scenarioA.id)!.step1.summary!.coveredDemand).toBe(11111);

    expect(result.get(scenarioB.id)!.step1.solved).toBe(false);
    expect(result.get(scenarioB.id)!.step1.summary).toBeNull();
  });

  it("reflects the correct step per scenario end-to-end through GET /scenarios, including Step 2 staleness", async () => {
    const { cookie, userId } = await registerAndGetCookie("epoch-e2e");
    const scenarioA = await createScenario(cookie, "A — both steps fresh");
    const scenarioB = await createScenario(cookie, "B — step2 settings changed after solving");

    const [rowABefore] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenarioA.id));
    await seedStep1Job(scenarioA.id, userId, 1, 11111);
    await seedStep2Job(scenarioA.id, userId, rowABefore!.inputs as Record<string, unknown>, 11111);

    const [rowBBefore] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenarioB.id));
    await seedStep1Job(scenarioB.id, userId, 1, 22222);
    await seedStep2Job(scenarioB.id, userId, rowBBefore!.inputs as Record<string, unknown>, 22222);
    // Change B's step2 settings WITHOUT touching Step 1 — epoch does not
    // move, but B's step2 job is now stale.
    await request(app).patch(`/api/scenarios/${scenarioB.id}`).set("Cookie", cookie)
      .send({ inputs: { ...step1Inputs, step2: { gap: 0.05, timeLimitSec: 300 } } }).expect(200);

    const res = await request(app).get("/api/scenarios").set("Cookie", cookie).expect(200);
    const apiRowA = res.body.find((s: { id: number }) => s.id === scenarioA.id);
    const apiRowB = res.body.find((s: { id: number }) => s.id === scenarioB.id);

    expect(apiRowA.steps.step1.summary.coveredDemand).toBe(11111);
    expect(apiRowA.steps.step2.solved).toBe(true);
    expect(apiRowA.steps.step2.stale).toBe(false);

    expect(apiRowB.steps.step1.summary.coveredDemand).toBe(22222);
    expect(apiRowB.steps.step2.solved).toBe(true);
    expect(apiRowB.steps.step2.stale).toBe(true);
  });
});

describe("cmp-1 — ownership scoping: a batch query never leaks another user's jobs", () => {
  it("reports unsolved when the batch is queried with a DIFFERENT user id than the job owner", async () => {
    const { cookie, userId } = await registerAndGetCookie("owner");
    const scenario = await createScenario(cookie, "owned by A");
    await seedStep1Job(scenario.id, userId, 1, 12345);

    const own = await loadScenarioStepsBatch(userId, [{ id: scenario.id, inputs: scenario.inputs }]);
    expect(own.get(scenario.id)!.step1.solved).toBe(true);

    const { userId: strangerId } = await registerAndGetCookie("stranger");
    const stranger = await loadScenarioStepsBatch(strangerId, [{ id: scenario.id, inputs: scenario.inputs }]);
    expect(stranger.get(scenario.id)!.step1.solved).toBe(false);
    expect(stranger.get(scenario.id)!.step1.summary).toBeNull();
  });
});

describe("cmp-1 — query-count evidence: one query for the whole batch, not N+1", () => {
  it("issues exactly one db.execute call for multiple Chapter 4 scenarios", async () => {
    const { cookie, userId } = await registerAndGetCookie("query-count");
    const scenarios: Array<{ id: number; inputs: Record<string, unknown> }> = [];
    for (let i = 0; i < 5; i++) {
      const s = await createScenario(cookie, `qc-${i}`);
      scenarios.push({ id: s.id, inputs: s.inputs });
    }

    const spy = vi.spyOn(db, "execute");
    try {
      await loadScenarioStepsBatch(userId, scenarios);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("issues zero db.execute calls for an empty scenario list (no query at all, not a zero-row query)", async () => {
    const { userId } = await registerAndGetCookie("query-count-empty");
    const spy = vi.spyOn(db, "execute");
    try {
      const result = await loadScenarioStepsBatch(userId, []);
      expect(result.size).toBe(0);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
