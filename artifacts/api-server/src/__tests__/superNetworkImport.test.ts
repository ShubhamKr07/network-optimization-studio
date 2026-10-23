import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { db, usersTable, scenariosTable } from "@workspace/db";
import app from "../app.js";
import { SUPER_DEFAULT_INPUTS } from "../validation/inputs/superInputs.js";

const sample = JSON.parse(readFileSync(new URL("../../../studio/public/samples/super-model-sample.json", import.meta.url), "utf8"));
const registeredUserIds: string[] = [];
const scenarioIds: number[] = [];
let cookie = "";

afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of registeredUserIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

async function registerAndGetCookie(): Promise<string> {
  const email = `sm-6-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}
async function create(modelId: string, inputs: object, c = cookie): Promise<number> {
  const res = await request(app).post("/api/scenarios").set("Cookie", c).send({ name: "sm-6", modelId, inputs }).expect(201);
  scenarioIds.push(res.body.id);
  return res.body.id;
}
const createEmptySuper = () => create("super-model", SUPER_DEFAULT_INPUTS);
const createJade = () => create("two-echelon-jade-us", {
  p: 2, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 120, warehouseOverrides: [], customerOverrides: [],
  plantProductCapability: [], addedPlants: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
});
const imp = (id: number, mode: string, network: object, c = cookie) =>
  request(app).post(`/api/scenarios/${id}/network/import?mode=${mode}`).set("Cookie", c).send(network);
const get = async (id: number) => (await request(app).get(`/api/scenarios/${id}`).set("Cookie", cookie)).body;

describe("super-model network import/export", () => {
  it("setup", async () => { cookie = await registerAndGetCookie(); });
  it("the sample is unmodified and carries zero-mile overrides", () => {
    expect(sample.distanceOverrides.some((o: { miles: number }) => o.miles === 0)).toBe(true);
    expect(JSON.stringify(sample).length).toBeGreaterThan(102_400); // above express.json()'s 100 KB default;
  });
  it("replace imports the full unmodified sample into an empty scenario", async () => {
    const id = await createEmptySuper();
    const res = await imp(id, "replace", sample);
    expect(res.status).toBe(200);
    expect(res.body.scenario.inputs.customers).toHaveLength(100);
    expect(res.body.scenario.inputs.distanceOverrides).toHaveLength(sample.distanceOverrides.length);
  });
  it("replace empties tables absent from the document", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const res = await imp(id, "replace", { products: sample.products });
    expect(res.body.scenario.inputs.customers).toEqual([]);
    expect(res.body.scenario.inputs.p).toBe(1);
  });
  it("merge upserts by id and never deletes", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const renamed = { ...sample.customers[0], name: "Renamed" };
    const res = await imp(id, "merge", { customers: [renamed] }).expect(200);
    expect(res.body.scenario.inputs.customers).toHaveLength(100);
    expect(res.body.scenario.inputs.customers.find((c: { id: string }) => c.id === renamed.id).name).toBe("Renamed");
  });
  it("a bad row writes nothing (atomic) and returns row-level errors", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const before = (await get(id)).inputs;
    const res = await imp(id, "merge", { demand: [{ customerId: "ghost", productId: "product-1", demand: 1 }] });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("ghost");
    expect((await get(id)).inputs).toEqual(before);
  });
  it("an unknown top-level key is 422", async () => {
    const id = await createEmptySuper();
    expect((await imp(id, "replace", { bogus: 1 })).status).toBe(422);
  });
  it("missing or bad mode -> 400; malformed JSON -> 400; oversize -> 413", async () => {
    const id = await createEmptySuper();
    expect((await request(app).post(`/api/scenarios/${id}/network/import`).set("Cookie", cookie).send(sample)).status).toBe(400);
    expect((await imp(id, "upsert", {})).status).toBe(400);
    expect((await request(app).post(`/api/scenarios/${id}/network/import?mode=replace`).set("Cookie", cookie)
      .set("Content-Type", "application/json").send("{nope")).status).toBe(400);
    const big = await request(app).post(`/api/scenarios/${id}/network/import?mode=replace`).set("Cookie", cookie)
      .set("Content-Type", "application/json").send(JSON.stringify({ products: [], pad: "x".repeat(4 * 1024 * 1024 + 10) }));
    expect(big.status).toBe(413);
  });
  it("unauthenticated -> 401", async () => {
    const id = await createEmptySuper();
    expect((await request(app).post(`/api/scenarios/${id}/network/import?mode=replace`).send({})).status).toBe(401);
  });
  it("another user's scenario and a non-super scenario both 404 (import and export)", async () => {
    const id = await createEmptySuper();
    const other = await registerAndGetCookie();
    expect((await imp(id, "replace", sample, other)).status).toBe(404);
    expect((await request(app).get(`/api/scenarios/${id}/network/export?format=json`).set("Cookie", other)).status).toBe(404);
    const jadeId = await createJade();
    expect((await imp(jadeId, "replace", sample)).status).toBe(404);
    expect((await request(app).get(`/api/scenarios/${jadeId}/network/export?format=json`).set("Cookie", cookie)).status).toBe(404);
    // a non-owner probing must not learn the row exists, and nothing was written
    expect((await get(id)).inputs.customers).toEqual([]);
  });
  it("import marks a solved scenario stale", async () => {
    const id = await createEmptySuper();
    await db.update(scenariosTable).set({ result: { objective: 1 } as never, solvedAt: new Date(Date.now() - 5000) }).where(eq(scenariosTable.id, id));
    await imp(id, "replace", sample).expect(200);
    expect((await get(id)).stale).toBe(true);
  });
  it("export -> replace import round-trips identical inputs", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const exp = await request(app).get(`/api/scenarios/${id}/network/export?format=json`).set("Cookie", cookie).expect(200);
    const id2 = await createEmptySuper();
    const res = await imp(id2, "replace", exp.body).expect(200);
    expect(res.body.scenario.inputs).toEqual((await get(id)).inputs);
    expect((await request(app).get(`/api/scenarios/${id}/network/export`).set("Cookie", cookie)).status).toBe(400);
  });
  it("SM2-3: a doc-schema failure carries document-row issues", async () => {
    const id = await createEmptySuper();
    const res = await imp(id, "replace", { customers: [{ id: "c", name: "c", lat: 1, lng: 1 }, { id: "d", name: "d", lat: 999, lng: 1 }] });
    expect(res.status).toBe(422);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.issues).toContainEqual(expect.objectContaining({ path: ["customers", 1, "lat"] }));
  });
  it("SM2-3: replace whole-network issues index the imported rows", async () => {
    const id = await createEmptySuper();
    const res = await imp(id, "replace", { ...sample, demand: [sample.demand[0], { customerId: "ghost", productId: "product-1", demand: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.issues).toContainEqual({ path: ["demand", 1, "customerId"], message: 'Unknown customer "ghost"' });
  });
  it("SM2-3: merge issues are translated from merged rows to imported rows", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const res = await imp(id, "merge", { demand: [{ customerId: "customer-1", productId: "nope", demand: 1 }] });
    expect(res.status).toBe(422);
    // merged index is sample.demand.length (400); the document index is 0
    expect(res.body.issues).toContainEqual({ path: ["demand", 0, "productId"], message: 'Unknown product "nope"' });
    expect(res.body.issues.some((i: { path: unknown[] }) => i.path[1] === sample.demand.length)).toBe(false);
  });
  it("SM2-3: the 422 error text names document rows, like issues", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const res = await imp(id, "merge", { demand: [{ customerId: "customer-1", productId: "nope", demand: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("demand row 1:");
    expect(res.body.error).not.toContain(`row ${sample.demand.length + 1}`);
  });
  it("SM2-3 (P3): a replaced row keeps its merged index; a new row's issue still maps to ITS document row", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const replaced = { ...sample.demand.find((d: { customerId: string; productId: string }) => d.customerId === "customer-2" && d.productId === "product-1"), demand: 5 };
    const res = await imp(id, "merge", { demand: [replaced, { customerId: "customer-1", productId: "nope", demand: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.issues).toContainEqual({ path: ["demand", 1, "productId"], message: 'Unknown product "nope"' });
  });
  it("SM2-3 (P3): an issue on a kept existing row is table-level, and mixed tables each map", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const res = await imp(id, "merge", {
      plants: [{ id: "customer-1", name: "clash", lat: 1, lng: 1 }],                 // collides with an EXISTING customer id
      demand: [{ customerId: "customer-3", productId: "nope", demand: 1 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.issues).toContainEqual({ path: ["customers"], message: 'Existing customers row 1: Duplicate location id "customer-1"' });
    expect(res.body.issues).toContainEqual({ path: ["demand", 0, "productId"], message: 'Unknown product "nope"' });
  });
  it.each([
    ["products", { products: [{ id: "k", name: "a" }, { id: "k", name: "b" }] }, ["products", 1, "id"]],
    ["plants vs customers", { plants: [{ id: "x", name: "p", lat: 1, lng: 1 }], customers: [{ id: "x", name: "c", lat: 1, lng: 1 }] }, ["customers", 0, "id"]],
    ["plantProducts", { plantProducts: [{ plantId: "plant-1", productId: "product-1", capacity: 1, costPerUnit: 0 }, { plantId: "plant-1", productId: "product-1", capacity: 2, costPerUnit: 0 }] }, ["plantProducts", 1]],
    ["demand", { demand: [{ customerId: "customer-1", productId: "product-1", demand: 1 }, { customerId: "customer-1", productId: "product-1", demand: 2 }] }, ["demand", 1]],
    ["distanceOverrides", { distanceOverrides: [{ fromId: "wh-1", toId: "customer-1", miles: 1 }, { fromId: "wh-1", toId: "customer-1", miles: 2 }] }, ["distanceOverrides", 1]],
  ])("SM2-3 (R4): merge rejects a duplicate %s key inside the document, writes nothing", async (_t, doc, path) => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const before = (await get(id)).inputs;
    const res = await imp(id, "merge", doc);
    expect(res.status).toBe(422);
    expect(res.body.issues.map((i: { path: unknown[] }) => i.path)).toContainEqual(path);
    expect((await get(id)).inputs).toEqual(before);
  });
  it("SM2-3 (P1): ids containing the old '|' delimiter neither collide nor merge into each other", async () => {
    const id = await createEmptySuper();
    const doc = {
      products: [{ id: "b|c", name: "x" }, { id: "c", name: "y" }],
      plants: [{ id: "a", name: "a", lat: 1, lng: 1 }, { id: "a|b", name: "ab", lat: 2, lng: 2 }],
      warehouses: [{ id: "w|x", name: "w", lat: 3, lng: 3, status: "active" }, { id: "w", name: "w2", lat: 4, lng: 4, status: "active" }],
      customers: [{ id: "x|y", name: "c", lat: 5, lng: 5, status: "active" }, { id: "y", name: "c2", lat: 6, lng: 6, status: "active" }],
      // "a"+"b|c" and "a|b"+"c" were the same string under `${a}|${b}`
      plantProducts: [{ plantId: "a", productId: "b|c", capacity: 1, costPerUnit: 0 }, { plantId: "a|b", productId: "c", capacity: 2, costPerUnit: 0 }],
      demand: [{ customerId: "x|y", productId: "c", demand: 1 }, { customerId: "y", productId: "b|c", demand: 2 }],
      distanceOverrides: [{ fromId: "w", toId: "x|y", miles: 1 }, { fromId: "w|x", toId: "y", miles: 2 }],
    };
    const res = await imp(id, "replace", doc);
    expect(res.status).toBe(200);                                       // superRefine no longer reports false duplicates
    const merged = await imp(id, "merge", { plantProducts: [{ plantId: "a", productId: "b|c", capacity: 9, costPerUnit: 0 }] }).expect(200);
    expect(merged.body.scenario.inputs.plantProducts).toEqual([
      { plantId: "a", productId: "b|c", capacity: 9, costPerUnit: 0 }, { plantId: "a|b", productId: "c", capacity: 2, costPerUnit: 0 }]);
  });
});

describe("SM-12 body limits", () => {
  it("PATCH accepts the full sample-sized inputs and persists them", async () => {
    const id = await createEmptySuper();
    await imp(id, "replace", sample).expect(200);
    const inputs = (await get(id)).inputs; // what Studio Save sends back
    expect(JSON.stringify({ inputs }).length).toBeGreaterThan(102_400);
    const res = await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie).send({ inputs });
    expect(res.status).toBe(200);
    expect((await get(id)).inputs.customers).toHaveLength(sample.customers.length);
  });
  it("a non-super PATCH just over 2 MiB is 413 payload_too_large", async () => {
    const id = await createJade();
    const res = await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie).send({ name: "x".repeat(2 * 1024 * 1024 + 10) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "payload_too_large" });
  });
  it("SM2-3: a super PATCH between 2 and 4 MiB passes the body parser; over 4 MiB is 413", async () => {
    const id = await createEmptySuper();
    const mid = await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie).send({ name: "x".repeat(3 * 1024 * 1024) });
    expect(mid.status).not.toBe(413);                                   // name length is rejected (or not) by the route, not the parser
    const big = await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie).send({ name: "x".repeat(4 * 1024 * 1024 + 10) });
    expect(big.status).toBe(413);
    expect(big.body).toEqual({ error: "payload_too_large" });
  });
  it("SM2-3: a super network import between 2 and 4 MiB is not 413", async () => {
    const id = await createEmptySuper();
    const res = await imp(id, "replace", { pad: "x".repeat(3 * 1024 * 1024) });
    expect(res.status).toBe(422);                                       // unknown key "pad", after the parser accepted 3 MiB
  });
  it("a >100 KiB body to a non-scenario route is 413, not 500", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "a@b.test", password: "x".repeat(110_000) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "payload_too_large" });
  });
  it("unauthenticated large PATCH/POST is 401 before the body is parsed", async () => {
    // Declare a 3 MiB Content-Length but send no body: body-parser would 413 on the header alone,
    // so only an auth check that runs BEFORE the parser yields 401. (Sending a real 2 MiB body
    // races the early response and flakes with ECONNRESET.)
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const status = (method: string, path: string) => new Promise<number>((resolve, reject) => {
      const r = httpRequest({ port, method, path, headers: { "content-type": "application/json", "content-length": String(3 * 1024 * 1024) } },
        (res) => { res.resume(); resolve(res.statusCode!); });
      r.on("error", reject);
      r.flushHeaders();
    });
    try {
      expect(await status("PATCH", "/api/scenarios/1")).toBe(401);
      expect(await status("POST", "/api/scenarios")).toBe(401);
    } finally { server.closeAllConnections(); server.close(); }
  });
});
