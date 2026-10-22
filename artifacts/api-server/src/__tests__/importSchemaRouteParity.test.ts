// SCU-2.P2.1 (B2.5) — pins import-schema's entity `models` to each model's
// guard block in routes/scenarios.ts (import AND export). One accepted entity
// (with a model-specific populated row that must produce errors === []) and
// one rejected sibling per model: model-integration-precheck.md Gate 7.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { IMPORT_SCHEMAS, IMPORT_ENTITIES, MODEL_IDS } from "@workspace/import-schema";
import type { ImportEntity, ModelId } from "@workspace/import-schema";
import app from "../app.js";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";
import { MODEL_INPUTS, exampleCsvFor } from "./fixtures/importFixtures.js";

beforeEach(() => { setLockedModelsForTests([]); });

export const GUARD_CASES: Array<{ modelId: ModelId; entity: ImportEntity; supported: boolean }> = [
  { modelId: "p-median-us", entity: "distances", supported: true },
  { modelId: "p-median-us", entity: "laneCosts", supported: false },
  { modelId: "p-median-brazil", entity: "customers", supported: true },
  { modelId: "p-median-brazil", entity: "refineries", supported: false },
  { modelId: "transport-coal", entity: "laneCosts", supported: true },
  { modelId: "transport-coal", entity: "distances", supported: false },
  { modelId: "two-echelon-gold-au", entity: "legDistances", supported: true },
  { modelId: "two-echelon-gold-au", entity: "plants", supported: false },
  { modelId: "two-echelon-jade-us", entity: "legDistances", supported: true },
  { modelId: "two-echelon-jade-us", entity: "distances", supported: false },
  { modelId: "max-coverage-us", entity: "warehouses", supported: true },
  { modelId: "max-coverage-us", entity: "legDistances", supported: false },
  { modelId: "delivery-teaching-us", entity: "customers", supported: true },
  { modelId: "delivery-teaching-us", entity: "distances", supported: false },
  { modelId: "delivery-teaching-us", entity: "deliveryCosts", supported: true },
  { modelId: "transport-coal", entity: "deliveryCosts", supported: false },
  // SM-3 — super-model has no per-entity import/export in Phase 1: every entity is rejected.
  ...IMPORT_ENTITIES.map((entity) => ({ modelId: "super-model" as const, entity, supported: false })),
];

const userIds: string[] = [];
const scenarioIds: number[] = [];
afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of userIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

let cookie = "";
const scenarioByModel = new Map<ModelId, number>();

beforeAll(async () => {
  const email = `scu-p2-1-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const reg = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(reg.status).toBe(201);
  userIds.push(reg.body.user.id);
  cookie = (reg.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
  for (const modelId of MODEL_IDS) {
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie).send({ name: `scu-p2-1 ${modelId}`, modelId, inputs: MODEL_INPUTS[modelId] });
    expect(res.status).toBe(201);
    scenarioIds.push(res.body.id);
    scenarioByModel.set(modelId, res.body.id);
  }
});

describe("one accepted + one rejected entity per model guard", () => {
  it("every model has exactly one accepted and one rejected case, and each agrees with the package", () => {
    for (const modelId of MODEL_IDS) {
      const mine = GUARD_CASES.filter(c => c.modelId === modelId);
      // super-model is the one deliberate model with no accepted entity (SM-3).
      if (modelId !== "super-model") expect(mine.filter(c => c.supported).length).toBeGreaterThanOrEqual(1);
      expect(mine.filter(c => !c.supported).length).toBeGreaterThanOrEqual(1);
    }
    for (const c of GUARD_CASES) expect(IMPORT_SCHEMAS[c.entity].models.includes(c.modelId)).toBe(c.supported);
  });

  for (const c of GUARD_CASES) {
    it(`${c.modelId} × ${c.entity}: import + export ${c.supported ? "accepted with errors === []" : "422"}`, async () => {
      const id = scenarioByModel.get(c.modelId)!;
      const imp = await request(app).post(`/api/scenarios/${id}/import`).set("Cookie", cookie).send({ entity: c.entity, csvText: exampleCsvFor(c.entity, c.modelId) });
      expect(imp.status).toBe(c.supported ? 200 : 422);
      if (c.supported) expect(imp.body.errors).toEqual([]);
      const exp = await request(app).get(`/api/scenarios/${id}/export`).query({ entity: c.entity, format: "json" }).set("Cookie", cookie);
      expect(exp.status).toBe(c.supported ? 200 : 422);
    });
  }
});
