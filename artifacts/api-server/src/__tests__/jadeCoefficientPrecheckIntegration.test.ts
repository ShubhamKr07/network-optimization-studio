// ch9-tc-3 — real-DB, real enqueueScenarioSolve integration test proving the
// new coefficient_range precheck guard is actually wired into the production
// solve path, not just unit-tested against precheckJadeInputs directly (a
// direct unit test alone doesn't prove jobRunner.ts:410's
// runNetworkEditsPrecheckForModel call and routes/scenarios.ts:557-559's
// 422 mapping are reached for two-echelon-jade-us specifically). Follows
// deliveryPrecheckIntegration.test.ts's convention exactly: no vi.mock of
// jobRunner/db/child_process anywhere in this file — real HTTP app, real
// Postgres. Requires a live DATABASE_URL (same requirement as that file and
// routes.test.ts).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import app from "../app.js";

const registeredUserIds: string[] = [];
const scenarioIds: number[] = [];

afterAll(async () => {
  if (scenarioIds.length > 0) {
    for (const id of scenarioIds) {
      await db.delete(solveJobsTable).where(eq(solveJobsTable.scenarioId, id));
    }
    for (const id of scenarioIds) {
      await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
    }
  }
  for (const id of registeredUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

async function registerAndGetCookie(): Promise<string> {
  const email = `ch9-tc-3-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie[0]!.split(";")[0]!;
}

// Routes.test.ts's jadeInputs fixture, repeated inline (api-server test
// files don't import studio defaults).
const jadeDefaults = {
  p: 2,
  distanceBands: [200, 400, 800, 1600],
  gap: 0,
  timeLimitSec: 120,
  warehouseOverrides: [],
  customerOverrides: [],
  plantProductCapability: [],
  addedPlants: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

describe("two-echelon-jade-us coefficient_range precheck through the real solve route", () => {
  it("returns 422 (not a queued job) for a huge-but-finite demand override that overflows the objective", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({
        name: "overflow demand",
        modelId: "two-echelon-jade-us",
        inputs: {
          ...jadeDefaults,
          // customer-1 is a real base customer (solvers/two-echelon-jade-us/
          // dataset/customers.json). No distance override or added entity
          // is needed at all: even the textbook default obMinTrans=10
          // charge, times this demand, overflows a double
          // (10 * 1e308 > Number.MAX_VALUE) -- the hazard the review flagged
          // predates any transportCosts override.
          customerOverrides: [{ id: "customer-1", status: "active", demands: { "product-1": 1e308 } }],
        },
      })
      .expect(201);
    scenarioIds.push(created.body.id);

    const res = await request(app).post(`/api/scenarios/${created.body.id}/solve`).set("Cookie", cookie);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Network-edit precheck failed");
    expect(res.body.errors.some((e: { code: string }) => e.code === "coefficient_range")).toBe(true);
    // Nothing was queued: the precheck runs inside enqueueScenarioSolve's
    // locked transaction before any job row is inserted, so the worker
    // dispatch boundary was never reached either.
    const jobs = await db.select().from(solveJobsTable).where(eq(solveJobsTable.scenarioId, created.body.id));
    expect(jobs).toHaveLength(0);
  });
});
