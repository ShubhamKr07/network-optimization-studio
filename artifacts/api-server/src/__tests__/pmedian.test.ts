import { describe, it, expect } from "vitest";
import { buildPayload, envelopeToLegacy } from "../solver/pmedian.js";
import type { SolveInput } from "../solver/pmedian.js";
import type { ResultEnvelope } from "../solver/resultEnvelope.js";

// Phase 3.5 (G3.1): buildPayload/envelopeToLegacy are pure translation
// functions now (the async spawn + job lifecycle lives in jobRunner.ts,
// tested separately in jobRunner.test.ts) — no more child_process mocking
// needed to test the translation logic itself.

const baseInput: SolveInput = {
  modelId: "p-median-us",
  inputs: {
    p: 3,
    distanceBands: [200, 400, 800, 1600],
    capacityMode: "none",
    uniformCapacity: null,
    warehouseOverrides: [],
    customerOverrides: [],
    gap: 0,
    timeLimitSec: 120,
  },
};

const transportInput: SolveInput = {
  modelId: "transport-coal",
  inputs: {
    distanceBands: [200, 400, 800, 1600],
    gap: 0,
    timeLimitSec: 120,
    capacityFactor: 1.1,
    singleSource: true,
    capacityInactive: false,
  },
};

describe("buildPayload()", () => {
  it("sends modelType=p_median for modelId p-median-us", () => {
    expect(buildPayload(baseInput).modelType).toBe("p_median");
  });

  it("sends modelType=capacitated_pmedian, warehouseCapacity, pValue, singleSource for modelId p-median-brazil", () => {
    const input: SolveInput = {
      modelId: "p-median-brazil",
      inputs: {
        p: 5,
        distanceBands: [500, 1000, 2000, 4000],
        capacityMode: "uniform",
        uniformCapacity: 20000000,
        warehouseOverrides: [],
        customerOverrides: [],
        gap: 0,
        timeLimitSec: 120,
        singleSource: true,
      },
    };
    const payload = buildPayload(input);
    expect(payload.modelType).toBe("capacitated_pmedian");
    expect(payload.warehouseCapacity).toBe(20000000);
    expect(payload.pValue).toBe(5);
    expect(payload.singleSource).toBe(true);
  });

  it("sends modelType=transport and all transport fields for modelId transport-coal", () => {
    const payload = buildPayload(transportInput);
    expect(payload.modelType).toBe("transport");
    expect(payload.capacityFactor).toBe(1.1);
    expect(payload.singleSource).toBe(true);
    expect(payload.capacityInactive).toBe(false);
  });

  it("translates p-median inputs (pValue, capacity, warehouseOverrides) onto the wire payload", () => {
    const input: SolveInput = {
      modelId: "p-median-us",
      inputs: {
        p: 5,
        distanceBands: [100, 500, 1000],
        capacityMode: "uniform",
        uniformCapacity: 50000000,
        warehouseOverrides: [{ id: "CHI", status: "forced_open" }],
        customerOverrides: [],
        gap: 0.01,
        timeLimitSec: 60,
      },
    };

    const payload = buildPayload(input);
    expect(payload.pValue).toBe(5);
    expect(payload.distanceBands).toEqual([100, 500, 1000]);
    expect(payload.uniformCapacity).toBe(50000000);
    expect(payload.warehouseStatuses).toEqual([{ warehouseId: "CHI", status: "forced_open" }]);
    expect(payload.gap).toBe(0.01);
    expect(payload.timeLimitSec).toBe(60);
  });

  it("capacityMode 'none' sends null capacity regardless of a stale uniformCapacity value", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: { ...baseInput.inputs, capacityMode: "none", uniformCapacity: 999 },
    };
    expect(buildPayload(input).uniformCapacity).toBeNull();
  });

  it("excludes only non-active warehouseOverrides from warehouseStatuses", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: {
        ...baseInput.inputs,
        warehouseOverrides: [
          { id: "CHI", status: "active" },
          { id: "LA", status: "inactive" },
        ],
      },
    };
    expect(buildPayload(input).warehouseStatuses).toEqual([{ warehouseId: "LA", status: "inactive" }]);
  });

  it("translates excluded customerOverrides into excludedCustomerIds", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: {
        ...baseInput.inputs,
        customerOverrides: [
          { id: "C1", status: "excluded" },
          { id: "C2", status: "active" },
        ],
      },
    };
    expect(buildPayload(input).excludedCustomerIds).toEqual(["C1"]);
  });

  it("translates per-warehouse capacity overrides into warehouseCapacities, omitting entries with no capacity", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: {
        ...baseInput.inputs,
        warehouseOverrides: [
          { id: "CHI", status: "active", capacity: 500000 },
          { id: "LA", status: "forced_open" },
        ],
      },
    };
    expect(buildPayload(input).warehouseCapacities).toEqual({ CHI: 500000 });
  });

  it("translates per-customer demand overrides into customerDemands, omitting entries with no demand", () => {
    const input: SolveInput = {
      ...baseInput,
      inputs: {
        ...baseInput.inputs,
        customerOverrides: [
          { id: "C1", status: "active", demand: 42 },
          { id: "C2", status: "excluded" },
        ],
      },
    };
    expect(buildPayload(input).customerDemands).toEqual({ C1: 42 });
  });
});

describe("envelopeToLegacy()", () => {
  const optimalEnvelope: ResultEnvelope = {
    status: "optimal",
    objective: 94500000,
    runTimeSec: 0.4,
    quality: "Optimal",
    edges: [{ fromId: "CHI", toId: "C1", flow: 205375, distance: 120, band: 0 }],
    metrics: {
      utilizationByNode: [
        { warehouseId: "CHI", city: "Chicago", utilization: 85 },
        { warehouseId: "LA", city: "Los Angeles", utilization: 72 },
      ],
      bandCoverage: [
        { band: 200, percent: 38 },
        { band: 400, percent: 67 },
      ],
      weightedAvgDistance: 412.6,
    },
    details: {
      openWarehouseIds: ["CHI", "LA"],
      assignments: [{ customerId: "C1", warehouseId: "CHI", distanceMi: 120, band: 0 }],
    },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("translates all fields for an optimal result", () => {
    const result = envelopeToLegacy(optimalEnvelope);
    expect(result.status).toBe("optimal");
    expect(result.openWarehouseIds).toEqual(["CHI", "LA"]);
    expect(result.assignments).toEqual([{ customerId: "C1", warehouseId: "CHI", distanceMi: 120, band: 0 }]);
    expect(result.objective).toBe(94500000);
    expect(result.weightedAvgDistanceMi).toBe(412.6);
    expect(result.bandCoverage).toEqual([{ band: 200, percent: 38 }, { band: 400, percent: 67 }]);
    expect(result.utilization).toEqual([
      { warehouseId: "CHI", city: "Chicago", utilization: 85 },
      { warehouseId: "LA", city: "Los Angeles", utilization: 72 },
    ]);
    expect(result.runTimeSec).toBe(0.4);
    expect(result.solverUsed).toBe("CBC (PuLP)");
    expect(result.infeasibilityReason).toBeNull();
  });

  it("preserves transport-specific flowTons/flowFraction via details.assignments", () => {
    const transportEnvelope: ResultEnvelope = {
      status: "optimal",
      objective: 50840650000,
      runTimeSec: 0.3,
      quality: "Optimal",
      edges: [{ fromId: "MINE1", toId: "STN1", flow: 7000000, distance: 450, band: 0 }],
      metrics: { utilizationByNode: [], bandCoverage: [], weightedAvgDistance: 696.4 },
      details: {
        openWarehouseIds: [],
        assignments: [
          { customerId: "STN1", warehouseId: "MINE1", distanceMi: 450, band: 0, flowTons: 7000000, flowFraction: 1.0 },
        ],
      },
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: null,
    };

    const result = envelopeToLegacy(transportEnvelope);
    expect(result.objective).toBe(50840650000);
    expect(result.weightedAvgDistanceMi).toBe(696.4);
    const first = result.assignments[0] as unknown as Record<string, unknown>;
    expect(first.flowTons).toBe(7000000);
    expect(first.flowFraction).toBe(1.0);
    expect(first.warehouseId).toBe("MINE1");
    expect(first.customerId).toBe("STN1");
  });

  it("defaults empty arrays/zero when an infeasible envelope's details/metrics are empty", () => {
    const infeasibleEnvelope: ResultEnvelope = {
      status: "infeasible",
      objective: 0,
      runTimeSec: 0.1,
      quality: "Infeasible",
      edges: [],
      metrics: {},
      details: {},
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: "Demand exceeds capacity.",
    };

    const result = envelopeToLegacy(infeasibleEnvelope);
    expect(result.status).toBe("infeasible");
    expect(result.openWarehouseIds).toEqual([]);
    expect(result.assignments).toEqual([]);
    expect(result.objective).toBe(0);
    expect(result.weightedAvgDistanceMi).toBe(0);
    expect(result.bandCoverage).toEqual([]);
    expect(result.utilization).toEqual([]);
    expect(result.infeasibilityReason).toBe("Demand exceeds capacity.");
  });

  it("all SolveOutput fields are present in a successful translation", () => {
    const result = envelopeToLegacy(optimalEnvelope);
    const requiredKeys = [
      "status", "openWarehouseIds", "assignments", "objective",
      "weightedAvgDistanceMi", "bandCoverage", "utilization",
      "runTimeSec", "solverUsed", "infeasibilityReason",
    ];
    for (const key of requiredKeys) {
      expect(result).toHaveProperty(key);
    }
  });
});
