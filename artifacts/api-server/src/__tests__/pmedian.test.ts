import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpawnSyncReturns } from "child_process";

vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "child_process";
import { solve } from "../solver/pmedian.js";
import type { SolveInput } from "../solver/pmedian.js";

const mockSpawnSync = vi.mocked(spawnSync);

const validOutput = {
  status: "optimal",
  openWarehouseIds: ["CHI", "LA"],
  assignments: [{ customerId: "C1", warehouseId: "CHI", distanceMi: 120, band: 0 }],
  objective: 94500000,
  weightedAvgDistanceMi: 412.6,
  bandCoverage: [
    { band: 200, percent: 38 },
    { band: 400, percent: 67 },
  ],
  utilization: [
    { warehouseId: "CHI", city: "Chicago", utilization: 85 },
    { warehouseId: "LA", city: "Los Angeles", utilization: 72 },
  ],
  runTimeSec: 0.4,
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("solve()", () => {
  it("returns parsed SolveOutput when Python exits 0 with valid JSON", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const result = solve(baseInput);
    expect(result.status).toBe("optimal");
    expect(result.openWarehouseIds).toEqual(["CHI", "LA"]);
    expect(result.objective).toBe(94500000);
    expect(result.weightedAvgDistanceMi).toBe(412.6);
    expect(result.runTimeSec).toBe(0.4);
    expect(result.solverUsed).toBe("CBC (PuLP)");
    expect(result.infeasibilityReason).toBeNull();
  });

  it("returns error SolveOutput when Python exits non-zero", () => {
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "solver crashed",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const result = solve(baseInput);
    expect(result.status).toBe("error");
    expect(result.openWarehouseIds).toEqual([]);
    expect(result.assignments).toEqual([]);
    expect(result.objective).toBe(0);
    expect(result.infeasibilityReason).toContain("solver crashed");
  });

  it("returns error SolveOutput when spawnSync throws (e.g. ENOENT)", () => {
    mockSpawnSync.mockReturnValue({
      status: null,
      stdout: "",
      stderr: "",
      error: new Error("spawn python3 ENOENT"),
    } as unknown as SpawnSyncReturns<string>);

    const result = solve(baseInput);
    expect(result.status).toBe("error");
    expect(result.infeasibilityReason).toContain("ENOENT");
  });

  it("returns error SolveOutput when Python exits 0 but stdout is invalid JSON", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: "not valid json {{",
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const result = solve(baseInput);
    expect(result.status).toBe("error");
    expect(result.infeasibilityReason).toContain("Failed to parse solver output");
  });

  it("translates p-median inputs (pValue, capacity, warehouseOverrides) onto Python stdin", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

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

    solve(input);

    const call = mockSpawnSync.mock.calls[0];
    const stdinPayload = JSON.parse(call[2]?.input as string);
    expect(stdinPayload.modelType).toBe("p_median");
    expect(stdinPayload.pValue).toBe(5);
    expect(stdinPayload.distanceBands).toEqual([100, 500, 1000]);
    expect(stdinPayload.uniformCapacity).toBe(50000000);
    expect(stdinPayload.warehouseStatuses).toEqual([{ warehouseId: "CHI", status: "forced_open" }]);
    expect(stdinPayload.gap).toBe(0.01);
    expect(stdinPayload.timeLimitSec).toBe(60);
  });

  it("capacityMode 'none' sends null capacity regardless of a stale uniformCapacity value", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    solve(baseInput);
    const payload = JSON.parse(mockSpawnSync.mock.calls[0][2]?.input as string);
    expect(payload.uniformCapacity).toBeNull();
  });

  it("excludes only non-active warehouseOverrides from warehouseStatuses", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    solve({
      modelId: "p-median-us",
      inputs: {
        ...baseInput.inputs,
        warehouseOverrides: [
          { id: "CHI", status: "active" },
          { id: "LA", status: "inactive" },
        ],
      },
    });
    const payload = JSON.parse(mockSpawnSync.mock.calls[0][2]?.input as string);
    expect(payload.warehouseStatuses).toEqual([{ warehouseId: "LA", status: "inactive" }]);
  });

  it("translates excluded customerOverrides into excludedCustomerIds", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    solve({
      modelId: "p-median-us",
      inputs: {
        ...baseInput.inputs,
        customerOverrides: [
          { id: "C1", status: "excluded" },
          { id: "C2", status: "active" },
        ],
      },
    });
    const payload = JSON.parse(mockSpawnSync.mock.calls[0][2]?.input as string);
    expect(payload.excludedCustomerIds).toEqual(["C1"]);
  });

  it("translates per-warehouse capacity overrides into warehouseCapacities, omitting entries with no capacity", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    solve({
      modelId: "p-median-us",
      inputs: {
        ...baseInput.inputs,
        warehouseOverrides: [
          { id: "CHI", status: "active", capacity: 500000 },
          { id: "LA", status: "forced_open" },
        ],
      },
    });
    const payload = JSON.parse(mockSpawnSync.mock.calls[0][2]?.input as string);
    expect(payload.warehouseCapacities).toEqual({ CHI: 500000 });
  });

  it("translates per-customer demand overrides into customerDemands, omitting entries with no demand", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    solve({
      modelId: "p-median-us",
      inputs: {
        ...baseInput.inputs,
        customerOverrides: [
          { id: "C1", status: "active", demand: 42 },
          { id: "C2", status: "excluded" },
        ],
      },
    });
    const payload = JSON.parse(mockSpawnSync.mock.calls[0][2]?.input as string);
    expect(payload.customerDemands).toEqual({ C1: 42 });
  });

  it("sets spawnSync timeout to timeLimitSec * 1000 + 15000", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    solve({ ...baseInput, inputs: { ...baseInput.inputs, timeLimitSec: 90 } });

    const call = mockSpawnSync.mock.calls[0];
    expect(call[2]?.timeout).toBe(90 * 1000 + 15000);
  });

  it("all SolveOutput fields are present in a successful response", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const result = solve(baseInput);
    const requiredKeys = [
      "status", "openWarehouseIds", "assignments", "objective",
      "weightedAvgDistanceMi", "bandCoverage", "utilization",
      "runTimeSec", "solverUsed", "infeasibilityReason",
    ];
    for (const key of requiredKeys) {
      expect(result).toHaveProperty(key);
    }
  });

  it("sends modelType=p_median for modelId p-median-us", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    solve(baseInput);

    const payload = JSON.parse(mockSpawnSync.mock.calls[0][2]?.input as string);
    expect(payload.modelType).toBe("p_median");
  });
});

describe("solve() — transport LP", () => {
  const transportOutput = {
    status: "optimal",
    openWarehouseIds: [],
    assignments: [
      { customerId: "STN1", warehouseId: "MINE1", distanceMi: 450, band: 0, flowTons: 7000000, flowFraction: 1.0 },
      { customerId: "STN2", warehouseId: "MINE2", distanceMi: 800, band: 1, flowTons: 4000000, flowFraction: 0.5 },
    ],
    objective: 50840650000,
    weightedAvgDistanceMi: 696.4,
    bandCoverage: [],
    utilization: [],
    runTimeSec: 0.3,
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("passes modelType=transport and all transport fields to Python stdin", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(transportOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    solve(transportInput);

    const payload = JSON.parse(mockSpawnSync.mock.calls[0][2]?.input as string);
    expect(payload.modelType).toBe("transport");
    expect(payload.capacityFactor).toBe(1.1);
    expect(payload.singleSource).toBe(true);
    expect(payload.capacityInactive).toBe(false);
  });

  it("returns transport solver output with flow assignments intact", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(transportOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const result = solve(transportInput);
    expect(result.status).toBe("optimal");
    expect(result.objective).toBe(50840650000);
    expect(result.weightedAvgDistanceMi).toBe(696.4);
    expect(result.assignments).toHaveLength(2);
  });

  it("transport assignment entries carry flowTons and flowFraction", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(transportOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const result = solve(transportInput);
    const first = result.assignments[0] as unknown as Record<string, unknown>;
    expect(first.flowTons).toBe(7000000);
    expect(first.flowFraction).toBe(1.0);
    expect(first.warehouseId).toBe("MINE1");
    expect(first.customerId).toBe("STN1");
  });

  it("returns error output when transport solver fails", () => {
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "transport model infeasible",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const result = solve(transportInput);
    expect(result.status).toBe("error");
    expect(result.infeasibilityReason).toContain("transport model infeasible");
  });
});

// ── Brazil capacitated p-median solver ────────────────────────────────────
describe("solve() — Brazil capacitated p-median", () => {
  const brazilInput: SolveInput = {
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

  const brazilInfeasibleOutput = {
    status: "infeasible",
    openWarehouseIds: [],
    assignments: [],
    objective: 0,
    weightedAvgDistanceMi: 0,
    bandCoverage: [],
    utilization: [],
    runTimeSec: 0.1,
    solverUsed: "CBC (PuLP)",
    infeasibilityReason:
      "Demand region São Paulo (29,029,226) exceeds single-warehouse capacity (20,000,000). Relax single-sourcing.",
  };

  const brazilOptimalOutput = {
    status: "optimal",
    openWarehouseIds: ["SAO", "RIO", "CUR", "REC", "MAN"],
    assignments: [
      { customerId: "SP", warehouseId: "SAO", distanceMi: 12, flowFraction: 0.69 },
      { customerId: "SP", warehouseId: "CUR", distanceMi: 234, flowFraction: 0.31 },
    ],
    objective: 8500000000,
    weightedAvgDistanceMi: 287.3,
    bandCoverage: [{ band: 500, percent: 12 }],
    utilization: [{ warehouseId: "SAO", city: "São Paulo", utilization: 100 }],
    runTimeSec: 1.2,
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("passes modelType=capacitated_pmedian, warehouseCapacity, pValue, singleSource to Python", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(brazilInfeasibleOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    solve(brazilInput);

    const payload = JSON.parse(mockSpawnSync.mock.calls[0][2]?.input as string);
    expect(payload.modelType).toBe("capacitated_pmedian");
    expect(payload.warehouseCapacity).toBe(20000000);
    expect(payload.pValue).toBe(5);
    expect(payload.singleSource).toBe(true);
  });

  it("returns infeasible status when singleSource=true and large region exceeds cap", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(brazilInfeasibleOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const result = solve(brazilInput);
    expect(result.status).toBe("infeasible");
    expect(result.infeasibilityReason).toMatch(/São Paulo/);
    expect(result.objective).toBe(0);
    expect(result.assignments).toHaveLength(0);
  });

  it("returns optimal result with flowFraction when singleSource=false", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(brazilOptimalOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const result = solve({ ...brazilInput, inputs: { ...brazilInput.inputs, singleSource: false } });
    expect(result.status).toBe("optimal");
    expect(result.weightedAvgDistanceMi).toBe(287.3);
    expect(result.openWarehouseIds).toHaveLength(5);
    expect(result.assignments).toHaveLength(2);
    const first = result.assignments[0] as unknown as Record<string, unknown>;
    expect(first.flowFraction).toBeCloseTo(0.69, 2);
  });

  it("returns error when Python exits non-zero for Brazil model", () => {
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "brazil model crashed",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const result = solve(brazilInput);
    expect(result.status).toBe("error");
    expect(result.infeasibilityReason).toContain("brazil model crashed");
  });

  it("all SolveOutput fields present for Brazil infeasible result", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(brazilInfeasibleOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const result = solve(brazilInput);
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
