import { describe, it, expect } from "vitest";
import {
  GetDatasetQueryParams,
  CreateScenarioBody,
  PrecheckScenarioResponse,
  ExportScenarioQueryParams,
  ExportScenarioResponse,
} from "@workspace/api-zod";

// C4.5: contract-layer smoke test — the generated Zod schemas (from
// lib/api-spec/openapi.yaml via orval codegen) reflect the Chen's Cosmetics
// (chens-cosmetics-cn) model-add contract changes:
//   - chens-cosmetics-cn is a valid modelId enum member everywhere it appears;
//   - PrecheckError.code carries the COMPLETE 8-value taxonomy (the 3 legacy
//     codes + p_range/capacity that already existed server-side + Chen's 3 new
//     codes) and round-trips through the generated client;
//   - the ExportEnvelope (response) entity enum is a superset of the export
//     REQUEST-parameter entity enum — i.e. every entity you can request can be
//     represented in the response envelope (request<->response entity parity),
//     after adding the 4 output entities assignments/openWarehouses/
//     costSummary/serviceStats that were missing from the response side.
// This is a contract-layer test only — it exercises no route/solver code.

describe("Chen's Cosmetics OpenAPI contract (C4.5)", () => {
  it("accepts chens-cosmetics-cn in the GET /dataset modelId query enum", () => {
    expect(GetDatasetQueryParams.safeParse({ modelId: "chens-cosmetics-cn" }).success).toBe(true);
  });

  it("accepts CreateScenarioBody for chens-cosmetics-cn (enum growth is additive)", () => {
    expect(
      CreateScenarioBody.safeParse({ name: "Chen", modelId: "chens-cosmetics-cn", inputs: {} }).success,
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

  it("round-trips all 8 PrecheckError.code values through the generated client", () => {
    const codes = [
      "completeness",
      "id_collision",
      "reference_integrity",
      "p_range",
      "capacity",
      "zero_demand",
      "no_feasible_route",
      "coverage_floor_infeasible",
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
    // The generated enum is exactly these 8 (no more, no fewer).
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
});
