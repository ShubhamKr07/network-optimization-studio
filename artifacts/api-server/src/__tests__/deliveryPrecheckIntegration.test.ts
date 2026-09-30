// ch5-del-6 — real-DB, real enqueueScenarioSolve integration test for the
// delivery-teaching-us precheck. routes.test.ts vi.mocks both
// ../solver/jobRunner.js (enqueueScenarioSolve -> a mock) and @workspace/db,
// so the real precheck never runs there and a W999 in the response could
// only come from the test's own mock. This file follows
// solveExportIntegration.test.ts's convention instead: no vi.mock of
// jobRunner/db/child_process anywhere in this file. Requires a live
// DATABASE_URL (same requirement as that file and routes.test.ts).
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
  const email = `ch5-del-6-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie[0]!.split(";")[0]!;
}

// Task 8's default-inputs object, repeated inline: the api-server cannot
// import from the studio.
const deliveryDefaults = {
  p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120,
  costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10,
  laneCostOverrides: [],
};

describe("delivery-teaching-us precheck through the real solve route", () => {
  it("returns 422 (not a queued job) for an override with an unknown warehouse id", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "bad override", modelId: "delivery-teaching-us",
              inputs: { ...deliveryDefaults, laneCostOverrides: [{ fromId: "W999", toId: "C1", cost: 1 }] } })
      .expect(201);
    scenarioIds.push(created.body.id);
    const res = await request(app).post(`/api/scenarios/${created.body.id}/solve`).set("Cookie", cookie);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Network-edit precheck failed");
    expect(JSON.stringify(res.body.errors)).toContain("W999");
    // Nothing was queued: the precheck runs inside enqueueScenarioSolve before any job row.
    const jobs = await db.select().from(solveJobsTable).where(eq(solveJobsTable.scenarioId, created.body.id));
    expect(jobs).toHaveLength(0);
  });
});
