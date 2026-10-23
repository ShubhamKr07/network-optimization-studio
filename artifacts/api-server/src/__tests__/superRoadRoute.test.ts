import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import app from "../app.js";
import { SUPER_DEFAULT_INPUTS } from "../validation/inputs/superInputs.js";
import { setOrsFetchForTests } from "../services/orsClient.js";
import { validRoadPairs } from "../services/superRoad.js";
import { superInputsSchema } from "../validation/inputs/superInputs.js";

const registeredUserIds: string[] = [];
const scenarioIds: number[] = [];
let cookie = "";

afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of registeredUserIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

async function registerAndGetCookie(): Promise<string> {
  const email = `sm2-9-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}
async function create(modelId: string, inputs: object, c = cookie): Promise<number> {
  const res = await request(app).post("/api/scenarios").set("Cookie", c).send({ name: "sm2-9", modelId, inputs }).expect(201);
  scenarioIds.push(res.body.id);
  return res.body.id;
}
const createJade = () => create("two-echelon-jade-us", {
  p: 2, distanceBands: [200, 400, 800, 1600], gap: 0, timeLimitSec: 120, warehouseOverrides: [], customerOverrides: [],
  plantProductCapability: [], addedPlants: [], addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
});

const tiny = { ...SUPER_DEFAULT_INPUTS, distanceMethod: "road", p: 1,
  products: [{ id: "K", name: "K" }], plants: [{ id: "P", name: "P", lat: 1, lng: 1 }],
  warehouses: [{ id: "W", name: "W", lat: 2, lng: 2, status: "active" }], customers: [{ id: "C", name: "C", lat: 3, lng: 3, status: "active" }],
  plantProducts: [{ plantId: "P", productId: "K", capacity: 10, costPerUnit: 0 }], demand: [{ customerId: "C", productId: "K", demand: 1 }] };
const okFetch = (onCall?: () => Promise<void>) => (async (_u: unknown, init?: RequestInit) => {
  await onCall?.();
  const b = JSON.parse(String(init!.body));
  return new Response(JSON.stringify({ distances: b.sources.map(() => b.destinations.map(() => 42.5)) }));
}) as typeof fetch;
const fetchRoad = (id: number, c = cookie) => request(app).post(`/api/scenarios/${id}/network/road-distances`).set("Cookie", c);
const stored = async (id: number) => (await db.select().from(scenariosTable).where(eq(scenariosTable.id, id)))[0]!;

afterEach(() => { setOrsFetchForTests(null); delete process.env.ORS_API_KEY; });

describe("POST /network/road-distances", () => {
  it("setup", async () => { cookie = await registerAndGetCookie(); });
  it("missing ORS_API_KEY -> 503 road_distances_unavailable, nothing written", async () => {
    const id = await create("super-model", tiny);
    const res = await fetchRoad(id);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("road_distances_unavailable");
    expect(JSON.stringify(res.body)).not.toContain("KEY");
    expect((await stored(id)).inputs).not.toHaveProperty("roadDistances");
  });
  it("another user's scenario and a non-super scenario are 404", async () => {
    process.env.ORS_API_KEY = "KEY"; setOrsFetchForTests(okFetch());
    const id = await create("super-model", tiny);
    expect((await fetchRoad(id, await registerAndGetCookie())).status).toBe(404);
    expect((await fetchRoad(await createJade())).status).toBe(404);
  });
  it("success writes only roadDistances, bumps inputsUpdatedAt, and readiness / payload use the pairs", async () => {
    process.env.ORS_API_KEY = "KEY"; setOrsFetchForTests(okFetch());
    const id = await create("super-model", tiny);
    const before = await stored(id);
    const res = await fetchRoad(id).expect(200);
    const after = await stored(id);
    const inputs = superInputsSchema.parse(after.inputs);
    expect(inputs.roadDistances).toMatchObject({ profile: "driving-hgv", coords: { P: [1, 1], W: [2, 2], C: [3, 3] } });
    expect(inputs.roadDistances!.pairs).toEqual([{ fromId: "P", toId: "W", miles: 42.5 }, { fromId: "W", toId: "C", miles: 42.5 }]);
    expect(after.inputsUpdatedAt.getTime()).toBeGreaterThan(before.inputsUpdatedAt.getTime());
    expect(res.body.scenario.inputs.roadDistances.pairs).toHaveLength(2);
    expect((await request(app).get(`/api/scenarios/${id}/precheck`).set("Cookie", cookie)).body.ok).toBe(true);
  });
  it("429, 403 (daily quota), null and timeout each write nothing", async () => {
    process.env.ORS_API_KEY = "KEY";
    const id = await create("super-model", tiny);
    for (const [f, code, status] of [
      [(async () => new Response("", { status: 429 })) as typeof fetch, "road_distances_quota", 429],
      [(async () => new Response("", { status: 403 })) as typeof fetch, "road_distances_quota", 429],
      [(async () => new Response(JSON.stringify({ distances: [[null]] }))) as typeof fetch, "road_distances_unroutable", 422],
      [(async () => { throw new DOMException("t", "TimeoutError"); }) as typeof fetch, "road_distances_failed", 502],
    ] as const) {
      setOrsFetchForTests(f);
      const res = await fetchRoad(id);
      expect([res.status, res.body.error]).toEqual([status, code]);
      expect((await stored(id)).inputs).not.toHaveProperty("roadDistances");
    }
  });
  it("O6: a null in the warehouse→customer batch -> 422 unroutable naming W→C, nothing persisted", async () => {
    process.env.ORS_API_KEY = "KEY";
    const id = await create("super-model", tiny);
    let n = 0;
    setOrsFetchForTests((async (_u: unknown, init?: RequestInit) => {
      n++;
      const b = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ distances: b.sources.map(() => b.destinations.map(() => (n === 2 ? null : 1))) }));
    }) as typeof fetch);
    const res = await fetchRoad(id);
    expect([res.status, res.body.error]).toEqual([422, "road_distances_unroutable"]);
    expect(res.body.message).toContain("W to C");
    expect((await stored(id)).inputs).not.toHaveProperty("roadDistances");
  });
  it.each([
    ["no warehouses", { warehouses: [] }],
    ["no customers", { customers: [], demand: [] }],
    ["neither", { warehouses: [], customers: [], demand: [] }],
  ])("R8: %s -> 200, no ORS call, empty pairs written", async (_n, over) => {
    process.env.ORS_API_KEY = "KEY";
    const f = vi.fn(okFetch());
    setOrsFetchForTests(f as unknown as typeof fetch);
    const id = await create("super-model", { ...tiny, ...over });
    const res = await fetchRoad(id).expect(200);
    expect(f).not.toHaveBeenCalled();
    expect(res.body.scenario.inputs.roadDistances.pairs).toEqual([]);
  });
  it("O1: a second request while a fetch runs is 409 road_distances_busy and writes nothing", async () => {
    process.env.ORS_API_KEY = "KEY";
    const a = await create("super-model", tiny), b = await create("super-model", tiny);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const inside = new Promise<void>(r => { entered = r; });
    let parked = true;
    setOrsFetchForTests(okFetch(async () => { if (parked) { parked = false; entered(); await gate; } }));
    const firstDone = fetchRoad(a).then(r => r);                         // supertest starts on .then
    await inside;                                                        // request A holds the busy flag
    const second = await fetchRoad(b);
    expect([second.status, second.body.error]).toEqual([409, "road_distances_busy"]);
    expect((await stored(b)).inputs).not.toHaveProperty("roadDistances");
    release();
    expect((await firstDone).status).toBe(200);
    expect((await fetchRoad(b)).status).toBe(200);                       // flag released
  });
  it("a PATCH landing between fetch and write is kept; the moved location's pairs are stale", async () => {
    process.env.ORS_API_KEY = "KEY";
    const id = await create("super-model", tiny);
    setOrsFetchForTests(okFetch(async () => {
      await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie)
        .send({ inputs: { ...tiny, customers: [{ id: "C", name: "C", lat: 3.5, lng: 3, status: "active" }] } }).expect(200);
    }));
    await fetchRoad(id).expect(200);
    const inputs = superInputsSchema.parse((await stored(id)).inputs);
    expect(inputs.customers[0].lat).toBe(3.5);                       // concurrent edit kept
    expect(inputs.roadDistances!.coords.C).toEqual([3, 3]);           // phase-1 snapshot
    expect(validRoadPairs(inputs).map(p => p.toId)).toEqual(["W"]);   // W→C is stale
  });
  it("solve uses the valid road pair and an override still wins", async () => {
    // payload-level proof lives in superRoad.test.ts (buildPayload) and test_super.py (resolution order);
    // here: the route's output is accepted by buildPayload unchanged.
    process.env.ORS_API_KEY = "KEY"; setOrsFetchForTests(okFetch());
    const id = await create("super-model", { ...tiny, distanceOverrides: [{ fromId: "W", toId: "C", miles: 1 }] });
    await fetchRoad(id).expect(200);
    const { buildPayload } = await import("../solver/pmedian.js");
    const payload = buildPayload({ modelId: "super-model", inputs: superInputsSchema.parse((await stored(id)).inputs) }) as Record<string, unknown>;
    expect(payload.roadPairs).toHaveLength(2);
    expect(payload.distanceOverrides).toEqual([{ fromId: "W", toId: "C", miles: 1 }]);
  });
});
