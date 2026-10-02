// ch9-tc-4 (fix round) — real-DB, real-route round trip proving the
// transportCosts jsonb persistence the mocked routes.test.ts suite cannot
// structurally cover: a mocked `db.update`/`db.insert` return value is
// AUTHORED BY THE TEST, so a test that only inspects the mocked return can
// pass even if the production write path silently stripped the field on
// the way into the real jsonb column. Follows
// jadeCoefficientPrecheckIntegration.test.ts's convention exactly: no
// vi.mock of db/jobRunner/child_process anywhere in this file — real HTTP
// app, real Postgres. Requires a live DATABASE_URL (same requirement as
// that file and routes.test.ts).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import app from "../app.js";

const registeredUserIds: string[] = [];
const scenarioIds: number[] = [];

afterAll(async () => {
  for (const id of scenarioIds) {
    await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  }
  for (const id of registeredUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

async function registerAndGetCookie(): Promise<string> {
  const email = `ch9-tc-4-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie[0]!.split(";")[0]!;
}

// routes.test.ts's jadeInputs fixture, repeated inline (api-server test
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

const RATES = { icTransCost: 0.09, icMinTrans: 5, obTransCost: 0.15, obMinTrans: 0 };

describe("two-echelon-jade-us transportCosts — real-DB persistence round trip", () => {
  it("a PATCH setting all four fields survives a real jsonb write, and a later PATCH omitting the key reverts to genuinely absent", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "ch9-tc-4 persistence", modelId: "two-echelon-jade-us", inputs: jadeDefaults })
      .expect(201);
    scenarioIds.push(created.body.id);
    expect(created.body.inputs.transportCosts).toBeUndefined();

    // Set all four fields.
    const patched = await request(app).patch(`/api/scenarios/${created.body.id}`).set("Cookie", cookie)
      .send({ inputs: { ...created.body.inputs, transportCosts: RATES } });
    expect(patched.status).toBe(200);

    // Independent GET -- a fresh SELECT off the real row, not the PATCH
    // response the same request produced.
    const readAfterSet = await request(app).get(`/api/scenarios/${created.body.id}`).set("Cookie", cookie);
    expect(readAfterSet.status).toBe(200);
    expect(readAfterSet.body.inputs.transportCosts).toEqual(RATES);

    // Reset: PATCH with the key omitted entirely.
    const { transportCosts, ...withoutRates } = readAfterSet.body.inputs as Record<string, unknown>;
    const reset = await request(app).patch(`/api/scenarios/${created.body.id}`).set("Cookie", cookie)
      .send({ inputs: withoutRates });
    expect(reset.status).toBe(200);

    const readAfterReset = await request(app).get(`/api/scenarios/${created.body.id}`).set("Cookie", cookie);
    expect(readAfterReset.status).toBe(200);
    // Genuinely absent -- not merely different from RATES, and not the
    // textbook literals either (a silent "helpfully" default-fill would
    // also make this assertion fail).
    expect(readAfterReset.body.inputs.transportCosts).toBeUndefined();
    expect("transportCosts" in readAfterReset.body.inputs).toBe(false);
  });

  it("clone preserves a real persisted transportCosts object byte-for-byte", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({
        name: "ch9-tc-4 clone source",
        modelId: "two-echelon-jade-us",
        inputs: { ...jadeDefaults, transportCosts: RATES },
      })
      .expect(201);
    scenarioIds.push(created.body.id);

    const cloned = await request(app).post(`/api/scenarios/${created.body.id}/clone`).set("Cookie", cookie);
    expect(cloned.status).toBe(201);
    scenarioIds.push(cloned.body.id);

    // Independent GET of the clone, not the clone response itself.
    const readClone = await request(app).get(`/api/scenarios/${cloned.body.id}`).set("Cookie", cookie);
    expect(readClone.status).toBe(200);
    expect(readClone.body.inputs.transportCosts).toEqual(RATES);
  });
});
