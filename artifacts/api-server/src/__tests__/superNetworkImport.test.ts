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
      .set("Content-Type", "application/json").send(JSON.stringify({ products: [], pad: "x".repeat(3 * 1024 * 1024) }));
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
  it("PATCH over 2 MiB is 413 payload_too_large", async () => {
    const id = await createEmptySuper();
    const res = await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie).send({ name: "x".repeat(2 * 1024 * 1024 + 10) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "payload_too_large" });
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
