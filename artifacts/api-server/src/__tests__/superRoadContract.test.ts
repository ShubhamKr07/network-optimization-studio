import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import app from "../app.js";
import { SUPER_DEFAULT_INPUTS, superInputsSchema, type RoadDistances } from "../validation/inputs/superInputs.js";
import { applyScenarioInputWrite } from "../services/scenarioInputWrite.js";

const sample = JSON.parse(readFileSync(new URL("../../../studio/public/samples/super-model-sample.json", import.meta.url), "utf8"));
const registeredUserIds: string[] = [];
const scenarioIds: number[] = [];
let cookie = "";

afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of registeredUserIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

async function registerAndGetCookie(): Promise<string> {
  const email = `sm2-7-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}
async function create(modelId: string, inputs: object, c = cookie): Promise<number> {
  const res = await request(app).post("/api/scenarios").set("Cookie", c).send({ name: "sm2-7", modelId, inputs }).expect(201);
  scenarioIds.push(res.body.id);
  return res.body.id;
}
const createEmptySuper = () => create("super-model", SUPER_DEFAULT_INPUTS);
const imp = (id: number, mode: string, network: object, c = cookie) =>
  request(app).post(`/api/scenarios/${id}/network/import?mode=${mode}`).set("Cookie", c).send(network);
const get = async (id: number) => (await request(app).get(`/api/scenarios/${id}`).set("Cookie", cookie)).body;

const road = (miles = 5): RoadDistances => ({ fetchedAt: "2026-10-23T00:00:00.000Z", profile: "driving-hgv" as const,
  coords: { [sample.plants[0].id]: [sample.plants[0].lat, sample.plants[0].lng] as [number, number], [sample.warehouses[0].id]: [sample.warehouses[0].lat, sample.warehouses[0].lng] as [number, number] },
  pairs: [{ fromId: sample.plants[0].id, toId: sample.warehouses[0].id, miles }] });
const stored = async (id: number) => (await db.select().from(scenariosTable).where(eq(scenariosTable.id, id)))[0]!.inputs as Record<string, unknown>;
/** R7: seeds through the REAL shared writer (the same call Task 9's route makes), never a direct row update. */
const seedRoad = async (id: number, value: RoadDistances) => {
  const current = await stored(id);
  const out = await db.transaction(tx => applyScenarioInputWrite(tx, { scenarioId: id, userId: registeredUserIds[0]!, nextInputs: current, roadDistances: { set: value } }));
  expect(out.kind).toBe("ok");
};

describe("SM2-7 roadDistances is server-written only", () => {
  it("setup", async () => { cookie = await registerAndGetCookie(); });
  it("R7: the shared writer's { set } stores a schema-valid cache and bumps inputsUpdatedAt", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const before = (await db.select().from(scenariosTable).where(eq(scenariosTable.id, id)))[0]!;
    await seedRoad(id, road(5));
    const after = (await db.select().from(scenariosTable).where(eq(scenariosTable.id, id)))[0]!;
    expect(superInputsSchema.parse(after.inputs).roadDistances).toEqual(road(5));
    expect(after.inputsUpdatedAt.getTime()).toBeGreaterThan(before.inputsUpdatedAt.getTime());
    expect((await get(id)).stale).toBe(false);                          // never solved: nothing to be stale against
  });
  it("R7: an invalid { set } value is refused by validation and writes nothing", async () => {
    const id = await createEmptySuper();
    const out = await db.transaction(tx => applyScenarioInputWrite(tx, { scenarioId: id, userId: registeredUserIds[0]!,
      nextInputs: SUPER_DEFAULT_INPUTS, roadDistances: { set: { ...road(5), profile: "driving-car" } as unknown as RoadDistances } }));
    expect(out.kind).toBe("invalid");
    expect((await stored(id)).roadDistances).toBeUndefined();
  });
  it("POST create drops a client roadDistances", async () => {
    const id = await create("super-model", { ...SUPER_DEFAULT_INPUTS, distanceMethod: "road", roadDistances: road() });
    expect((await stored(id)).roadDistances).toBeUndefined();
    expect((await stored(id)).distanceMethod).toBe("road");
  });
  it("PATCH cannot set, change or clear it; the persisted value is carried", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    await seedRoad(id, road(5));
    const inputs = (await get(id)).inputs;
    await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie).send({ inputs: { ...inputs, roadDistances: road(999) } }).expect(200);
    expect((await stored(id)).roadDistances).toEqual(road(5));
    const { roadDistances: _r, ...without } = inputs;
    await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie).send({ inputs: { ...without, p: 3 } }).expect(200);
    expect((await stored(id)).roadDistances).toEqual(road(5));
  });
  it("merge-import keeps it; replace-import clears it", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    await seedRoad(id, road(5));
    await imp(id, "merge", { p: 3 }).expect(200);
    expect((await stored(id)).roadDistances).toEqual(road(5));
    await imp(id, "replace", sample).expect(200);
    expect((await stored(id)).roadDistances).toBeUndefined();
  });
  it("clone copies the server-written cache", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    await seedRoad(id, road(5));
    const res = await request(app).post(`/api/scenarios/${id}/clone`).set("Cookie", cookie).expect(201);
    scenarioIds.push(res.body.id);
    expect((await stored(res.body.id)).roadDistances).toEqual(road(5));
  });
  it("the network document has no roadDistances: export omits it, import rejects it", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    await seedRoad(id, road(5));
    const exp = await request(app).get(`/api/scenarios/${id}/network/export?format=json`).set("Cookie", cookie).expect(200);
    expect(exp.body).not.toHaveProperty("roadDistances");
    expect((await imp(id, "merge", { roadDistances: road(1) })).status).toBe(422);
  });
  it("a schema-valid roadDistances round-trips through superInputsSchema; a wrong profile does not", () => {
    expect(superInputsSchema.safeParse({ ...SUPER_DEFAULT_INPUTS, roadDistances: road() }).success).toBe(true);
    expect(superInputsSchema.safeParse({ ...SUPER_DEFAULT_INPUTS, roadDistances: { ...road(), profile: "driving-car" } }).success).toBe(false);
  });
});
