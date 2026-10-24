import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { SUPER_NETWORK_MAX_BYTES } from "@workspace/import-schema";
import app from "../app.js";
import { SUPER_CAPS, SUPER_DEFAULT_INPUTS, superInputsSchema } from "../validation/inputs/superInputs.js";


const registeredUserIds: string[] = [];
const scenarioIds: number[] = [];
let cookie = "";

afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of registeredUserIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

async function registerAndGetCookie(): Promise<string> {
  const email = `sm2-3-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}
async function create(modelId: string, inputs: object, c = cookie): Promise<number> {
  const res = await request(app).post("/api/scenarios").set("Cookie", c).send({ name: "sm2-3", modelId, inputs }).expect(201);
  scenarioIds.push(res.body.id);
  return res.body.id;
}
const createEmptySuper = () => create("super-model", SUPER_DEFAULT_INPUTS);
const imp = (id: number, mode: string, network: object, c = cookie) =>
  request(app).post(`/api/scenarios/${id}/network/import?mode=${mode}`).set("Cookie", c).send(network);

/** A network at the §3.3 caps for `products` products: 20 plants, 50 warehouses, as many customers as
 *  whCustProd allows (≤ 500), every plant→WH and WH→customer pair overridden, every plant×product and
 *  customer×product row filled, 20-character location ids and full-precision floats. String lengths are unbounded
 *  in the schema, so this is a defined realistic worst case, not a proof for every network. */
function capsNetwork(products: number) {
  const f = (i: number) => Math.sqrt(i + 2) * 97.31;          // ~17 significant digits, deterministic
  const loc = (p: string, i: number) => ({ id: `${p}-${i}`.padEnd(20, "x"), city: "Springfield", state: "MO",
    lat: 25 + (f(i) % 24), lng: -124 + (f(i + 7) % 57) });
  const nCust = Math.min(SUPER_CAPS.customers, Math.floor(SUPER_CAPS.whCustProd / (SUPER_CAPS.warehouses * products)));
  const plants = Array.from({ length: SUPER_CAPS.plants }, (_, i) => loc("plant", i + 1));
  const warehouses = Array.from({ length: SUPER_CAPS.warehouses }, (_, i) => ({ ...loc("wh", i + 1), status: "active" }));
  const customers = Array.from({ length: nCust }, (_, i) => ({ ...loc("customer", i + 1), status: "active" }));
  const prods = Array.from({ length: products }, (_, i) => ({ id: `product-${i + 1}`, name: `Product ${i + 1}` }));
  let k = 0;
  return {
    ...SUPER_DEFAULT_INPUTS, p: 10, products: prods, plants, warehouses, customers,
    plantProducts: plants.flatMap(p => prods.map(q => ({ plantId: p.id, productId: q.id, capacity: f(k++) * 1e6, costPerUnit: f(k++) }))),
    demand: customers.flatMap(c => prods.map(q => ({ customerId: c.id, productId: q.id, demand: f(k++) * 100 }))),
    distanceOverrides: [
      ...plants.flatMap(a => warehouses.map(b => ({ fromId: a.id, toId: b.id, miles: f(k++) * 10 }))),
      ...warehouses.flatMap(a => customers.map(b => ({ fromId: a.id, toId: b.id, miles: f(k++) * 10 }))),
    ],
  };
}
const COMBOS = [1, 2, 5, 10];   // customers 500, 500, 200, 100; overrides 26,000, 26,000, 11,000, 6,000

let largestDoc: ReturnType<typeof capsNetwork>;

describe("SM2-3 max-size network vs SUPER_NETWORK_MAX_BYTES", () => {
  it("setup", async () => { cookie = await registerAndGetCookie(); });
  it("every boundary combination is valid at the caps; the largest fits the limit and imports", async () => {
    const sized = COMBOS.map(n => {
      const doc = capsNetwork(n);
      expect(superInputsSchema.safeParse(doc).success).toBe(true);
      const bytes = Buffer.byteLength(JSON.stringify(doc));
      console.log(`SM2-3 caps network, ${n} product(s), ${doc.customers.length} customers, ${doc.distanceOverrides.length} overrides: ${bytes} bytes`);
      return { n, doc, bytes };
    });
    const largest = sized.reduce((a, b) => (b.bytes > a.bytes ? b : a));
    console.log(`SM2-3 largest: ${largest.n} product(s), ${largest.bytes} bytes; SUPER_NETWORK_MAX_BYTES ${SUPER_NETWORK_MAX_BYTES}`);
    largestDoc = largest.doc;
    expect(largest.bytes).toBeLessThan(SUPER_NETWORK_MAX_BYTES);
    const id = await createEmptySuper();
    const res = await imp(id, "replace", largest.doc);
    expect(res.status).toBe(200);
    expect(res.body.scenario.inputs.distanceOverrides).toHaveLength(largest.doc.distanceOverrides.length);
  });
  it("R2: the Studio's Save path (PATCH, same Super body limit) accepts the largest network too", async () => {
    const id = await createEmptySuper();
    const res = await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie).send({ inputs: largestDoc });
    expect(res.status).toBe(200);
  });
});
