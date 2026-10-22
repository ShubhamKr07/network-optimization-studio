// SM-4 — real solve -> real costSummary export for super-model. Real HTTP app,
// real Postgres, real solve.py via the job runner (same convention as
// solveExportIntegration.test.ts). The envelope is validated against the
// regenerated @workspace/api-zod schema, pinned to the constant, with a
// populated row built by the production emitter (never a hand-built fixture).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import { ExportScenarioResponse } from "@workspace/api-zod";
import app from "../app.js";
import { SUPER_DEFAULT_INPUTS } from "../validation/inputs/superInputs.js";
import { COST_SUMMARY_TEMPLATE_VERSION } from "../services/templates.js";

// distanceOverrides are omitted on purpose: the committed sample's 2600 rows
// (~230 KB) exceed express.json()'s 100 KB default (-> 500 via the error
// handler) and 25 of them are 0-mile wh/customer pairs the schema's
// `positive()` rejects. Haversine computes the same distances server-side.
const { distanceOverrides: _omit, ...sample } = JSON.parse(
  readFileSync(new URL("../../../studio/public/samples/super-model-sample.json", import.meta.url), "utf8"),
);
const userIds: string[] = [];
const scenarioIds: number[] = [];

afterAll(async () => {
  for (const id of scenarioIds) await db.delete(solveJobsTable).where(eq(solveJobsTable.scenarioId, id));
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of userIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

describe("super-model costSummary export (real solve)", () => {
  it("exports v-constant envelope with the six two-echelon columns (JSON + CSV)", async () => {
    const email = `sm-4-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const reg = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
    expect(reg.status).toBe(201);
    userIds.push(reg.body.user.id);
    const cookie = (reg.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;

    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "sm-4 export", modelId: "super-model", inputs: { ...SUPER_DEFAULT_INPUTS, ...sample } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as number;
    scenarioIds.push(id);

    const solve = await request(app).post(`/api/scenarios/${id}/solve`).set("Cookie", cookie);
    expect(solve.status).toBe(202);
    const jobId = solve.body.jobId as number;
    const deadline = Date.now() + 150_000;
    let status = "";
    while (Date.now() < deadline) {
      const r = await request(app).get(`/api/scenarios/${id}/solve-jobs/${jobId}`).set("Cookie", cookie);
      status = r.body.status;
      if (status === "succeeded" || status === "failed") break;
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(status).toBe("succeeded");

    const json = await request(app).get(`/api/scenarios/${id}/export?entity=costSummary&format=json`).set("Cookie", cookie);
    expect(json.status).toBe(200);
    expect(json.body.templateVersion).toBe(COST_SUMMARY_TEMPLATE_VERSION);
    const row = json.body.rows[0];
    // Non-vacuity: the six fields are optional in the contract, so prove the
    // real emitter populated them before parsing.
    for (const k of ["totalCost", "inboundCost", "outboundCost", "plantVariableCost", "avgDistPlantToWh", "avgDistWhToCustomer"]) {
      expect(typeof row[k], k).toBe("number");
    }
    const parsed = ExportScenarioResponse.safeParse(json.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    // Strip-not-reject: the columns must SURVIVE the round trip.
    const out = (parsed.data as { rows: Array<Record<string, unknown>> }).rows[0]!;
    expect(out.totalCost).toBe(row.totalCost);
    expect(out.avgDistWhToCustomer).toBe(row.avgDistWhToCustomer);

    const csv = await request(app).get(`/api/scenarios/${id}/export?entity=costSummary&format=csv`).set("Cookie", cookie);
    expect(csv.status).toBe(200);
    const header = csv.text.split("\n")[0]!;
    for (const c of ["total_cost", "plant_variable_cost", "avg_dist_plant_to_wh", "avg_dist_wh_to_customer"]) {
      expect(header).toContain(c);
    }
    expect(csv.text.split("\n")[1]!.split(",")[0]).toBe(String(COST_SUMMARY_TEMPLATE_VERSION));
  }, 170_000);
});
