import { describe, it, expect } from "vitest";
import {
  GetDatasetQueryParams,
  CreateScenarioBody,
  PrecheckScenarioResponse,
  ExportScenarioQueryParams,
  ExportScenarioResponse,
} from "@workspace/api-zod";
import { maxCoverageInputsSchema } from "../validation/inputs/maxCoverage.js";

// C4.5: contract-layer smoke test — the generated Zod schemas (from
// lib/api-spec/openapi.yaml via orval codegen) reflect the Chapter 4
// (max-coverage-us) model-add contract changes:
//   - max-coverage-us is a valid modelId enum member everywhere it appears;
//   - PrecheckError.code carries the COMPLETE 10-value taxonomy (the 3 legacy
//     codes + p_range/capacity that already existed server-side + this
//     model's 4 new codes + ch9-tc's coefficient_range) and round-trips
//     through the generated client;
//   - the ExportEnvelope (response) entity enum is a superset of the export
//     REQUEST-parameter entity enum — i.e. every entity you can request can be
//     represented in the response envelope (request<->response entity parity),
//     after adding the 4 output entities assignments/openWarehouses/
//     costSummary/serviceStats that were missing from the response side.
// This is a contract-layer test only — it exercises no route/solver code.

describe("max-coverage-us OpenAPI contract (C4.5)", () => {
  it("accepts max-coverage-us in the GET /dataset modelId query enum", () => {
    expect(GetDatasetQueryParams.safeParse({ modelId: "max-coverage-us" }).success).toBe(true);
  });

  it("accepts CreateScenarioBody for max-coverage-us (enum growth is additive)", () => {
    expect(
      CreateScenarioBody.safeParse({ name: "Max Coverage", modelId: "max-coverage-us", inputs: {} }).success,
    ).toBe(true);
  });

  it("still accepts CreateScenarioBody for every pre-existing modelId", () => {
    for (const modelId of [
      "p-median-us",
      "transport-coal",
      "p-median-brazil",
      "two-echelon-gold-au",
      "two-echelon-jade-us",
    ] as const) {
      expect(CreateScenarioBody.safeParse({ name: "x", modelId, inputs: {} }).success).toBe(true);
    }
  });

  it("round-trips all 10 PrecheckError.code values through the generated client", () => {
    const codes = [
      "completeness",
      "id_collision",
      "reference_integrity",
      "p_range",
      "capacity",
      "zero_demand",
      "no_feasible_route",
      "coverage_floor_infeasible",
      // ch9-tc-2 (9e73f6b) added this to openapi.yaml's PrecheckError.code
      // enum; this test's hardcoded list wasn't updated in that commit.
      "coefficient_range",
      // CH4O-6 — avg_distance_cap_infeasible's sibling to coverage_floor_infeasible.
      "avg_distance_cap_infeasible",
    ];
    for (const code of codes) {
      const result = PrecheckScenarioResponse.safeParse({
        ok: false,
        errors: [{ code, message: "x" }],
      });
      expect(result.success, `PrecheckError.code should accept "${code}"`).toBe(true);
    }
    // Enum is closed: an unknown code must be rejected.
    expect(
      PrecheckScenarioResponse.safeParse({ ok: false, errors: [{ code: "not_a_code", message: "x" }] })
        .success,
    ).toBe(false);
    // The generated enum is exactly these 10 (no more, no fewer).
    expect([...ExportScenarioQueryParams.shape.entity.options].length).toBeGreaterThan(0); // sanity: enum introspection works
    expect([...(PrecheckScenarioResponse.shape.errors.element.shape.code.options as string[])].sort()).toEqual(
      [...codes].sort(),
    );
  });

  it("request<->response entity parity: every export request entity is accepted by ExportEnvelope.entity", () => {
    // T5 (SCND scaling — Chen bands & units): the response envelope is now
    // three versioned families (v1 unitless, v2 unit-bearing input, v3
    // unit-bearing output) per spec Part E — a single flat
    // {templateVersion:1, entity, rows} shape no longer describes every
    // entity, so each entity is asserted against its own family's shape.
    const requestEntities = ExportScenarioQueryParams.shape.entity.options as readonly string[];
    const v1Entities = new Set([
      "warehouses", "customers", "mines", "stations", "refineries",
      "plants", "plantCapabilities", "openWarehouses",
    ]);
    const v2Entities = new Set(["distances", "laneCosts", "legDistances"]);
    const v3Entities = new Set(["assignments", "flows", "costSummary", "serviceStats"]);

    for (const entity of requestEntities) {
      let envelope: Record<string, unknown>;
      if (v1Entities.has(entity)) {
        envelope = { templateVersion: 1, entity, rows: [] };
      } else if (v2Entities.has(entity)) {
        envelope = { templateVersion: 2, entity, unit: "km", rows: [] };
      } else if (v3Entities.has(entity)) {
        envelope = { templateVersion: 3, entity, unit: "km", rows: [] };
      } else {
        throw new Error(`entity "${entity}" is not classified into any export envelope family — update this test`);
      }
      const result = ExportScenarioResponse.safeParse(envelope);
      expect(result.success, `ExportEnvelope should accept entity "${entity}" as v${envelope.templateVersion}`).toBe(true);
    }
    // Concretely covers the 4 output entities added in C4.5.
    for (const entity of ["assignments", "openWarehouses", "costSummary", "serviceStats"]) {
      expect(requestEntities.includes(entity)).toBe(true);
    }
  });

  it("v1 envelopes carry no `unit` property at all", () => {
    const result = ExportScenarioResponse.safeParse({ templateVersion: 1, entity: "warehouses", rows: [] });
    expect(result.success).toBe(true);
    expect(result.success && result.data).not.toHaveProperty("unit");
  });

  // MIG-8: p's maximum is 26, declared in four places (manifest, this Zod
  // schema, and the two `pMax={...}` UI call sites in Workspace.tsx) — all
  // four must change together, each with its own regression. This is the
  // Zod declaration's regression. Verified by deliberately breaking it:
  // changing `.max(26)` to `.max(25)` in validation/inputs/maxCoverage.ts
  // makes the `p: 26` assertion below fail (`success` becomes `false`)
  // while every other test in this file stays green.
  it("accepts p=26 and rejects p=27 (MIG-8, the Zod declaration)", () => {
    const base = {
      p: 3,
      highServiceDistMi: 700,
      maxDistMi: 5500,
      avgServiceDistCapMi: 1000,
      coverageFloorDemand: 0,
      gap: 0,
      timeLimitSec: 120,
      capacityMode: "none" as const,
      distanceBands: [700, 5500],
    };
    expect(maxCoverageInputsSchema.safeParse({ ...base, p: 26 }).success).toBe(true);
    expect(maxCoverageInputsSchema.safeParse({ ...base, p: 27 }).success).toBe(false);
  });
});
