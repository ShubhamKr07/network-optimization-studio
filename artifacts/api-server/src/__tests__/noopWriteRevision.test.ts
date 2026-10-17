// SCU-2.R1 — a no-op write must not advance solveInputRevision/inputsUpdatedAt,
// for ANY key holding arrays of objects. Real Postgres: jsonb reorders object
// keys on read, Zod re-emits schema order, so a JSON.stringify diff always saw
// "changes". Guards the class (shared applyScenarioInputWrite), not one entity.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { TEMPLATE_VERSION, csvColumns } from "@workspace/import-schema";
import app from "../app.js";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";
import { MODEL_INPUTS } from "./fixtures/importFixtures.js";

beforeEach(() => { setLockedModelsForTests([]); });

const userIds: string[] = [];
const scenarioIds: number[] = [];
afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of userIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

let cookie = "";
beforeAll(async () => {
  const email = `scu-r1-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const reg = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(reg.status).toBe(201);
  userIds.push(reg.body.user.id);
  cookie = (reg.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
});

const BASE = MODEL_INPUTS as Record<string, Record<string, unknown>>;
const CASES = [
  { name: "delivery laneCostOverrides", modelId: "delivery-teaching-us", overrides: { laneCostOverrides: [{ fromId: "W8", toId: "C269", cost: 2 }] } },
  { name: "p-median distanceOverrides", modelId: "p-median-us", overrides: { distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 123.4 }] } },
];

describe.each(CASES)("no-op writes leave the epoch alone: $name", ({ modelId, overrides }) => {
  async function setup() {
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "scu-r1", modelId, inputs: { ...BASE[modelId], ...overrides } });
    expect(res.status).toBe(201);
    scenarioIds.push(res.body.id);
    const read = async () => (await db.select().from(scenariosTable).where(eq(scenariosTable.id, res.body.id)))[0]!;
    return { id: res.body.id as number, read };
  }

  it("header-only warehouses import/apply is a no-op", async () => {
    const { id, read } = await setup();
    const r0 = await read();
    const header = csvColumns("warehouses", TEMPLATE_VERSION).join(",");
    const res = await request(app).post(`/api/scenarios/${id}/import/apply`).set("Cookie", cookie)
      .send({ entity: "warehouses", csvText: `${header}\n`, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    const r1 = await read();
    expect(r1.solveInputRevision).toBe(r0.solveInputRevision);
    expect(r1.inputsUpdatedAt.getTime()).toBe(r0.inputsUpdatedAt.getTime());
  });

  it("GET -> PATCH of the same inputs is a no-op", async () => {
    const { id, read } = await setup();
    const r0 = await read();
    const got = await request(app).get(`/api/scenarios/${id}`).set("Cookie", cookie);
    const res = await request(app).patch(`/api/scenarios/${id}`).set("Cookie", cookie).send({ inputs: got.body.inputs });
    expect(res.status).toBe(200);
    const r1 = await read();
    expect(r1.solveInputRevision).toBe(r0.solveInputRevision);
    expect(r1.inputsUpdatedAt.getTime()).toBe(r0.inputsUpdatedAt.getTime());
  });
});
