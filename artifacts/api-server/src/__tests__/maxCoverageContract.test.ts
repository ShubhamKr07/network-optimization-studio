import { describe, it, expect } from "vitest";
import {
  GetDatasetQueryParams,
  CreateScenarioBody,
  PrecheckScenarioResponse,
  ExportScenarioQueryParams,
  ExportScenarioResponse,
} from "@workspace/api-zod";
import { maxCoverageInputsSchema } from "../validation/inputs/maxCoverage.js";
import {
  COST_SUMMARY_TEMPLATE_VERSION,
  buildCostSummaryRows,
  toCostSummaryJsonRow,
} from "../services/templates.js";
import type { ResultEnvelope } from "../solver/resultEnvelope.js";

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
    const v3Entities = new Set(["assignments", "flows", "serviceStats"]);

    for (const entity of requestEntities) {
      let envelope: Record<string, unknown>;
      if (v1Entities.has(entity)) {
        envelope = { templateVersion: 1, entity, rows: [] };
      } else if (v2Entities.has(entity)) {
        envelope = { templateVersion: 2, entity, unit: "km", rows: [] };
      } else if (entity === "costSummary") {
        // CH4O-P1 — costSummary left the shared v3 for its own grid-local
        // COST_SUMMARY_TEMPLATE_VERSION. Read from the CONSTANT the route
        // emits, never a literal: the literal `3` here is what let the
        // emitter reach v4 while the spec still declared v3 (hard rule #1
        // breach, found at whole-branch review). Pinned from the constant,
        // the next bump fails this test until openapi.yaml is bumped too.
        envelope = { templateVersion: COST_SUMMARY_TEMPLATE_VERSION, entity, unit: "km", rows: [] };
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

  // CH4O-P1 — the parity check above validates EMPTY `rows: []`, so it can
  // see a version drift but never a row-SHAPE drift. That is precisely how
  // Task 11's three new costSummary columns reached the emitter (CSV and
  // JSON) without ever reaching openapi.yaml: this file was the schema's
  // only consumer in the repo, and it hand-authored a shape the production
  // writer never produces (the repo's standing gotcha). Assert against what
  // `buildCostSummaryRows` + `toCostSummaryJsonRow` ACTUALLY return.
  it("accepts a populated max-coverage-us costSummary row built by the real emitter, carrying the three v4 fields", () => {
    const chapter4Result = {
      status: "optimal",
      solutionStatus: "optimal",
      terminationReason: "optimality_proven",
      // Coverage mode: the objective IS a percent (objectiveDimension ->
      // "percent"), which is why it never converts under `unit=`.
      objective: 87.5,
      runTimeSec: 1.2,
      quality: "Proven optimal",
      edges: [{ fromId: "ALN", toId: "C1", flow: 205375, distance: 42, band: 0 }],
      metrics: {
        utilizationByNode: [{ warehouseId: "ALN", city: "Allentown", utilization: 0.41 }],
        bandCoverage: [{ band: 300, percent: 87.5 }],
        weightedAvgDistance: 310.25,
      },
      // The three source fields solve.py puts on `details` for this model —
      // the ONLY reason the three row columns are ever non-null.
      details: { objective: "coverage", highServiceDistMi: 300, coveragePct: 87.5, coveredDemand: 1750000 },
      solverUsed: "CBC",
      infeasibilityReason: null,
    } as ResultEnvelope;

    const jsonRow = toCostSummaryJsonRow(
      buildCostSummaryRows(chapter4Result, "mi", "mi", "max-coverage-us")[0]!,
    );
    // Non-vacuity: the three fields are OPTIONAL in the contract, so a parse
    // of a row that silently lost them would still succeed. Prove the real
    // emitter populated them before parsing.
    expect(jsonRow.highServiceDist).toBe(300);
    expect(jsonRow.coveragePct).toBe(87.5);
    expect(jsonRow.coveredDemand).toBe(1750000);

    const parsed = ExportScenarioResponse.safeParse({
      templateVersion: COST_SUMMARY_TEMPLATE_VERSION,
      entity: "costSummary",
      unit: "mi",
      rows: [jsonRow],
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    // The load-bearing assertion. A successful parse ALONE proves nothing
    // about the three columns: orval emits plain `zod.object(...)`, which
    // STRIPS unknown keys instead of rejecting them, so this envelope parsed
    // green against the old spec that declared only 8 properties. The three
    // must SURVIVE the round trip — that is what fails if openapi.yaml ever
    // falls behind the emitter again.
    const parsedRow = (parsed.success ? parsed.data.rows[0] : undefined) as
      | Record<string, unknown>
      | undefined;
    expect(parsedRow).toMatchObject({
      highServiceDist: 300,
      coveragePct: 87.5,
      coveredDemand: 1750000,
    });

    // The envelope's templateVersion is a CLOSED literal (enum [4], not
    // [3, 4]) — an emitter that drifted back off the constant is rejected
    // rather than quietly accepted.
    expect(
      ExportScenarioResponse.safeParse({
        templateVersion: 3, entity: "costSummary", unit: "mi", rows: [jsonRow],
      }).success,
    ).toBe(false);
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
