// SCU-2.P2.3 (B2.7, D1) — deliveryCosts through the real routes: apply
// persists into inputs.laneCostOverrides, cost === base removes the override,
// CSV round trip, unknown pair is all-or-nothing. Sibling-model 422s are
// covered for all 7 models by importSchemaRouteParity.test.ts.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { TEMPLATE_VERSION, csvColumns } from "@workspace/import-schema";
import app from "../app.js";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";

beforeEach(() => { setLockedModelsForTests([]); });

const userIds: string[] = [];
const scenarioIds: number[] = [];
afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of userIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

const DELIVERY = { p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120, costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10, laneCostOverrides: [], warehouseOverrides: [], customerOverrides: [] };
const HEADER = csvColumns("deliveryCosts", TEMPLATE_VERSION).join(",");
let cookie = "";

beforeAll(async () => {
  const email = `scu-p2-3-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const reg = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(reg.status).toBe(201);
  userIds.push(reg.body.user.id);
  cookie = (reg.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
});

async function create(laneCostOverrides: Array<{ fromId: string; toId: string; cost: number }> = []): Promise<number> {
  const res = await request(app).post("/api/scenarios").set("Cookie", cookie).send({ name: "scu-p2-3", modelId: "delivery-teaching-us", inputs: { ...DELIVERY, laneCostOverrides } });
  expect(res.status).toBe(201);
  scenarioIds.push(res.body.id);
  return res.body.id;
}
const overridesOf = async (id: number) => (await request(app).get(`/api/scenarios/${id}`).set("Cookie", cookie)).body.inputs.laneCostOverrides;
const applyCsv = (id: number, csvText: string, mode = "all_or_nothing") =>
  request(app).post(`/api/scenarios/${id}/import/apply`).set("Cookie", cookie).send({ entity: "deliveryCosts", csvText, mode });

describe("deliveryCosts routes", () => {
  it("apply upserts into inputs.laneCostOverrides (zero allowed)", async () => {
    const id = await create();
    const res = await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C269,0\n`);
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(await overridesOf(id)).toEqual([{ fromId: "W8", toId: "C269", cost: 0 }]);
  });

  it("a stored REDUNDANT override (cost already equal to base) is hidden from export and removed by an explicit equal-to-base row", async () => {
    const id = await create([{ fromId: "W8", toId: "C269", cost: 1047.7157 }]);
    const before = await request(app).get(`/api/scenarios/${id}/export`).query({ entity: "deliveryCosts", format: "json" }).set("Cookie", cookie);
    expect(before.body.rows).toEqual([]);
    const res = await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C269,1047.7157\n`);
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(await overridesOf(id)).toEqual([]);
  });

  it("a real change advances inputsUpdatedAt + solveInputRevision; a no-op import does not advance the revision (review #9)", async () => {
    const id = await create();
    const read = async () => (await db.select().from(scenariosTable).where(eq(scenariosTable.id, id)))[0]!;
    const r0 = await read();
    expect((await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C269,2\n`)).status).toBe(200);
    const r1 = await read();
    expect(r1.solveInputRevision).toBe(r0.solveInputRevision + 1);
    expect(r1.inputsUpdatedAt.getTime()).toBeGreaterThan(r0.inputsUpdatedAt.getTime());
    const noop = await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C269,2\n`);
    expect(noop.status).toBe(200);
    expect(noop.body.applied).toBe(0);
    const r2 = await read();
    expect(r2.solveInputRevision).toBe(r1.solveInputRevision);
    expect(r2.inputsUpdatedAt.getTime()).toBe(r1.inputsUpdatedAt.getTime());
  });

  it("a cost equal to base removes the override (stays sparse)", async () => {
    const id = await create([{ fromId: "W8", toId: "C269", cost: 1 }]);
    expect((await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C269,1047.7157\n`)).status).toBe(200);
    expect(await overridesOf(id)).toEqual([]);
    const exp = await request(app).get(`/api/scenarios/${id}/export`).query({ entity: "deliveryCosts", format: "json" }).set("Cookie", cookie);
    expect(exp.body).toEqual({ templateVersion: TEMPLATE_VERSION, entity: "deliveryCosts", rows: [] });
  });

  it("CSV export → CSV import into a fresh scenario reproduces the overrides", async () => {
    const source = await create([{ fromId: "W8", toId: "C269", cost: 1 }, { fromId: "W8", toId: "C8", cost: 7 }]);
    const csvText = (await request(app).get(`/api/scenarios/${source}/export`).query({ entity: "deliveryCosts", format: "csv" }).set("Cookie", cookie)).text;
    expect(csvText.startsWith(`${HEADER}\n`)).toBe(true);
    const target = await create();
    expect((await applyCsv(target, csvText)).status).toBe(200);
    expect(await overridesOf(target)).toEqual(await overridesOf(source));
  });

  it("an unknown pair blocks an all-or-nothing apply and changes nothing", async () => {
    const id = await create([{ fromId: "W8", toId: "C269", cost: 1 }]);
    const res = await applyCsv(id, `${HEADER}\n${TEMPLATE_VERSION},W8,C99999,1\n${TEMPLATE_VERSION},W8,C269,2\n`);
    expect(res.status).toBe(422);
    expect(res.body.preview.errors).toHaveLength(1);
    expect(await overridesOf(id)).toEqual([{ fromId: "W8", toId: "C269", cost: 1 }]);
  });

  it("a non-owner gets 404", async () => {
    const id = await create();
    const other = await request(app).post("/api/auth/register").send({ email: `scu-p2-3-x-${Date.now()}@example.test`, password: "correct horse battery" });
    userIds.push(other.body.user.id);
    const otherCookie = (other.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    const res = await request(app).post(`/api/scenarios/${id}/import`).set("Cookie", otherCookie).send({ entity: "deliveryCosts", csvText: `${HEADER}\n` });
    expect(res.status).toBe(404);
  });
});
