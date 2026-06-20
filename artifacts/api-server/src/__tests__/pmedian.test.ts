import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpawnSyncReturns } from "child_process";

vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "child_process";
import { solve } from "../solver/pmedian.js";

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

const baseInput = {
  pValue: 3,
  distanceBands: [200, 400, 800, 1600],
  capacityMode: "uniform" as const,
  uniformCapacity: null,
  warehouseStatuses: [],
  gap: 0,
  timeLimitSec: 120,
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

  it("passes input fields as JSON on stdin to Python", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    const input = {
      pValue: 5,
      distanceBands: [100, 500, 1000],
      capacityMode: "per_wh" as const,
      uniformCapacity: 50000000,
      warehouseStatuses: [{ warehouseId: "CHI", status: "forced_open" }],
      gap: 0.01,
      timeLimitSec: 60,
    };

    solve(input);

    const call = mockSpawnSync.mock.calls[0];
    const stdinPayload = JSON.parse(call[2]?.input as string);
    expect(stdinPayload.pValue).toBe(5);
    expect(stdinPayload.distanceBands).toEqual([100, 500, 1000]);
    expect(stdinPayload.capacityMode).toBe("per_wh");
    expect(stdinPayload.uniformCapacity).toBe(50000000);
    expect(stdinPayload.warehouseStatuses).toEqual([{ warehouseId: "CHI", status: "forced_open" }]);
    expect(stdinPayload.gap).toBe(0.01);
    expect(stdinPayload.timeLimitSec).toBe(60);
  });

  it("sets spawnSync timeout to timeLimitSec * 1000 + 15000", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(validOutput),
      stderr: "",
      error: undefined,
    } as unknown as SpawnSyncReturns<string>);

    solve({ ...baseInput, timeLimitSec: 90 });

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
});
