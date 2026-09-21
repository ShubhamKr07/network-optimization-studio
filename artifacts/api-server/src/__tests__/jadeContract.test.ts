import { describe, it, expect } from "vitest";
import {
  GetDatasetQueryParams,
  GetDatasetResponse,
  ListScenariosResponseItem,
  CreateScenarioBody,
} from "@workspace/api-zod";

// jade-T3.5: contract smoke test — the generated Zod schemas (from
// lib/api-spec/openapi.yaml via orval codegen) accept two-echelon-jade-us's
// new shapes (modelId enum member, Dataset.plants/products/
// plantProductCapabilities, WarehouseCandidate/Customer.name/sourceId,
// Customer.demands, Edge.leg's two new values + Edge.productId,
// SolveMetrics' new optional fields) AND that every existing model's
// pre-JADE shapes still parse unchanged (all new fields are additive/
// optional, per hard rules 1/4 and the plan's "existing 4 datasets stay
// valid" requirement). This is a contract-layer test only — no solver code
// exists yet (that's T4/T5); it does not exercise solve.py or any route.

describe("JADE OpenAPI contract (jade-T3.5)", () => {
  it("accepts two-echelon-jade-us in the GET /dataset modelId query enum", () => {
    const result = GetDatasetQueryParams.safeParse({ modelId: "two-echelon-jade-us" });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown modelId (enum is closed)", () => {
    const result = GetDatasetQueryParams.safeParse({ modelId: "not-a-real-model" });
    expect(result.success).toBe(false);
  });

  it("parses a JADE-shaped Dataset response (plants/products/plantProductCapabilities, name/sourceId, per-product demands)", () => {
    const jadeDataset = {
      warehouses: [
        { id: "wh-11", name: "Phoenix", sourceId: 11, city: "Phoenix", state: "AZ", lat: 33.4484, lng: -112.074 },
      ],
      customers: [
        {
          id: "customer-1",
          name: "Customer 1",
          sourceId: 1,
          city: "Los Angeles",
          state: "CA",
          lat: 34.0522,
          lng: -118.2437,
          demand: 100,
          demands: { "product-1": 40, "product-2": 60 },
        },
      ],
      plants: [
        { id: "plant-1", sourceId: 1, name: "Plant 1", city: "Long Beach", state: "CA", lat: 33.77, lng: -118.19 },
      ],
      products: [{ id: "product-1", sourceId: 1, name: "Product Family 1" }],
      plantProductCapabilities: [{ plantId: "plant-1", productId: "product-1", capacity: 210000000 }],
    };
    const result = GetDatasetResponse.safeParse(jadeDataset);
    expect(result.success).toBe(true);
  });

  it("still parses the existing p-median-us-shaped Dataset response with none of the new optional fields present", () => {
    const pMedianDataset = {
      warehouses: [{ id: "ALN", city: "Allentown", state: "PA", lat: 40.6, lng: -75.5 }],
      customers: [{ id: "C1", city: "Springfield", state: "IL", lat: 39.8, lng: -89.6, demand: 500 }],
    };
    const result = GetDatasetResponse.safeParse(pMedianDataset);
    expect(result.success).toBe(true);
  });

  it("accepts a Scenario with modelId two-echelon-jade-us and a result envelope using the new leg values + productId + metrics fields", () => {
    const jadeScenario = {
      id: 1,
      name: "JADE scenario",
      modelId: "two-echelon-jade-us",
      inputs: { p: 2 },
      result: {
        status: "optimal",
        objective: 254060828.6157,
        runTimeSec: 1.2,
        quality: "Proven optimal",
        edges: [
          { fromId: "plant-1", toId: "wh-11", flow: 100, distance: 50, leg: "plant_to_warehouse", productId: "product-1" },
          { fromId: "wh-11", toId: "customer-1", flow: 100, distance: 20, leg: "warehouse_to_customer" },
        ],
        metrics: {
          openFacilityIds: ["wh-11", "wh-14"],
          totalDemand: 1545308,
          inboundCost: 1000,
          outboundCost: 2000,
        },
        details: {},
        solverUsed: "CBC",
        infeasibilityReason: null,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      solvedAt: new Date().toISOString(),
      stale: false,
      resultRunId: null,
    };
    const result = ListScenariosResponseItem.safeParse(jadeScenario);
    expect(result.success).toBe(true);
  });

  it("still parses an existing single-echelon Scenario result with no leg/productId/new-metrics fields", () => {
    const pMedianScenario = {
      id: 2,
      name: "P-median scenario",
      modelId: "p-median-us",
      inputs: {},
      result: {
        status: "optimal",
        objective: 123,
        runTimeSec: 0.5,
        quality: "Proven optimal",
        edges: [{ fromId: "ALN", toId: "C1", flow: 500, distance: 10 }],
        metrics: {},
        details: {},
        solverUsed: "CBC",
        infeasibilityReason: null,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      solvedAt: new Date().toISOString(),
      stale: false,
      resultRunId: null,
    };
    const result = ListScenariosResponseItem.safeParse(pMedianScenario);
    expect(result.success).toBe(true);
  });

  it("still accepts CreateScenarioBody for every pre-existing modelId (enum growth is additive)", () => {
    for (const modelId of ["p-median-us", "transport-coal", "p-median-brazil", "two-echelon-gold-au"] as const) {
      const result = CreateScenarioBody.safeParse({ name: "x", modelId, inputs: {} });
      expect(result.success).toBe(true);
    }
  });

  it("accepts CreateScenarioBody for two-echelon-jade-us", () => {
    const result = CreateScenarioBody.safeParse({ name: "JADE", modelId: "two-echelon-jade-us", inputs: {} });
    expect(result.success).toBe(true);
  });
});
