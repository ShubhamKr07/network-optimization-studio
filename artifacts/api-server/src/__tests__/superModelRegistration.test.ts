import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import app from "../app.js";
import { SUPER_DEFAULT_INPUTS } from "../validation/inputs/superInputs.js";

const registeredUserIds: string[] = [];
const scenarioIds: number[] = [];
let cookie = "";

afterAll(async () => {
  for (const id of scenarioIds) await db.delete(solveJobsTable).where(eq(solveJobsTable.scenarioId, id));
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of registeredUserIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

async function registerAndGetCookie(): Promise<string> {
  const email = `sm-3-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie[0]!.split(";")[0]!;
}

describe("super-model registration", () => {
  it("setup", async () => { cookie = await registerAndGetCookie(); });
  it("creates an empty super-model scenario and round-trips its inputs", async () => {
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "sm-empty", modelId: "super-model", inputs: SUPER_DEFAULT_INPUTS }).expect(201);
    scenarioIds.push(res.body.id);
    expect(res.body.inputs.products).toEqual([]);
    expect(res.body.inputs.distanceMethod).toBe("haversine");
  });
  it("rejects duplicate ids across plants/warehouses/customers with 422", async () => {
    const inputs = { ...SUPER_DEFAULT_INPUTS,
      plants: [{ id: "X", name: "p", lat: 1, lng: 1 }],
      warehouses: [{ id: "X", name: "w", lat: 1, lng: 1, status: "active" }] };
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "sm-dup", modelId: "super-model", inputs });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("X");
  });
  it("rejects an unresolved reference and an over-cap table with 422", async () => {
    const bad = { ...SUPER_DEFAULT_INPUTS, demand: [{ customerId: "nope", productId: "nope", demand: 1 }] };
    expect((await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "sm-ref", modelId: "super-model", inputs: bad })).status).toBe(422);
    const many = { ...SUPER_DEFAULT_INPUTS,
      products: Array.from({ length: 11 }, (_, i) => ({ id: `k${i}`, name: `k${i}` })) };
    expect((await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "sm-cap", modelId: "super-model", inputs: many })).status).toBe(422);
  });
  it("rejects non-finite numbers and the Phase-3-only road method with 422", async () => {
    // JSON cannot carry Infinity; prove it at the schema level instead
    const { superInputsSchema } = await import("../validation/inputs/superInputs.js");
    const base = { ...SUPER_DEFAULT_INPUTS,
      plants: [{ id: "p", name: "p", lat: 1, lng: 1 }], warehouses: [{ id: "w", name: "w", lat: 1, lng: 2, status: "active" }] };
    expect(superInputsSchema.safeParse({ ...base, distanceOverrides: [{ fromId: "p", toId: "w", miles: Infinity }] }).success).toBe(false);
    expect(superInputsSchema.safeParse({ ...base, distanceOverrides: [{ fromId: "p", toId: "w", miles: -Infinity }] }).success).toBe(false);
    const road = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "sm-road", modelId: "super-model", inputs: { ...SUPER_DEFAULT_INPUTS, distanceMethod: "road" } });
    expect(road.status).toBe(422);
  });
  it("GET /api/models lists super-model", async () => {
    const res = await request(app).get("/api/models").set("Cookie", cookie).expect(200);
    expect(res.body.map((m: { id: string }) => m.id)).toContain("super-model");
  });

  it("studio superDefaults.json equals SUPER_DEFAULT_INPUTS (drift guard)", () => {
    const studio = JSON.parse(readFileSync(new URL("../../../studio/src/lib/superDefaults.json", import.meta.url), "utf8"));
    expect(studio).toEqual(SUPER_DEFAULT_INPUTS);
  });

  it("per-entity import/export routes keep rejecting super-model", async () => {
    const c = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "sm-entity", modelId: "super-model", inputs: SUPER_DEFAULT_INPUTS }).expect(201);
    scenarioIds.push(c.body.id);
    const res = await request(app).get(`/api/scenarios/${c.body.id}/export?entity=warehouses&format=json`).set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  it("solving an empty super-model scenario returns 422 with a completeness precheck error", async () => {
    const c = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "sm-solve-empty", modelId: "super-model", inputs: SUPER_DEFAULT_INPUTS }).expect(201);
    scenarioIds.push(c.body.id);
    const res = await request(app).post(`/api/scenarios/${c.body.id}/solve`).set("Cookie", cookie);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Network-edit precheck failed");
    expect(res.body.errors.some((e: { code: string }) => e.code === "completeness")).toBe(true);
  });
});
