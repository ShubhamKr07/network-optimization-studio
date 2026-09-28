// CH4-23/CH4-26 — real, unmocked Postgres. Run with a live DATABASE_URL:
//   DATABASE_URL=postgresql://... pnpm --filter api-server exec vitest run \
//     src/solver/__tests__/maxCoverageStepWorkflow.test.ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import app from "../../app.js";

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
});
