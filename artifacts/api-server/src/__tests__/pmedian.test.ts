import { describe, it, expect } from "vitest";
import { buildPayload } from "../solver/pmedian.js";
import type { SolveInput } from "../solver/pmedian.js";

// Phase 3.5 (G3.1): buildPayload is a pure translation function now (the
// async spawn + job lifecycle lives in jobRunner.ts, tested separately in
// jobRunner.test.ts) — no more child_process mocking needed to test the
// translation logic itself. Phase 4 retired envelopeToLegacy() entirely —
// jobRunner now stores solve.py's envelope as-is; nothing translates it
// back to a flat shape anymore (see resultEnvelope.test.ts for the
// envelope's own shape validation).

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
    mineCapacities: {},
    stationDemands: {},
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

  it("forwards mineCapacities/stationDemands for transport-coal", () => {
    const input: SolveInput = {
      modelId: "transport-coal",
      inputs: {
        distanceBands: [500, 1000, 1500, 2000],
        gap: 0,
        timeLimitSec: 120,
        capacityFactor: 1.1,
        singleSource: true,
        capacityInactive: false,
        mineCapacities: { KY: 1000000 },
        stationDemands: { CHI: 12000000 },
      },
    };
    const payload = buildPayload(input);
    expect(payload.mineCapacities).toEqual({ KY: 1000000 });
    expect(payload.stationDemands).toEqual({ CHI: 12000000 });
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
