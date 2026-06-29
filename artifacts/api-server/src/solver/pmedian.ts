import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOLVER_PY = path.resolve(__dirname, "..", "src", "solver", "solve.py");

export interface SolveInput {
  pValue: number;
  distanceBands: number[];
  capacityMode: "uniform" | "per_wh";
  uniformCapacity: number | null;
  warehouseStatuses: Array<{ warehouseId: string; status: string }>;
  gap?: number;
  timeLimitSec?: number;
  solver?: string;
  // Chapter 5 transport LP fields
  modelType?: "p_median" | "transport";
  capacityFactor?: number;
  singleSource?: boolean;
  capacityInactive?: boolean;
}

export interface SolverInfo {
  id: string;
  name: string;
  available: boolean;
}

export function listSolvers(): SolverInfo[] {
  const result = spawnSync("python3", [SOLVER_PY, "--list-solvers"], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.error || result.status !== 0) return [];
  try {
    return JSON.parse(result.stdout) as SolverInfo[];
  } catch {
    return [];
  }
}

export interface Assignment {
  customerId: string;
  warehouseId: string;
  distanceMi: number;
  band: number;
}

export interface WarehouseUtilization {
  warehouseId: string;
  city: string;
  utilization: number;
}

export interface BandCoverage {
  band: number;
  percent: number;
}

export interface SolveOutput {
  status: "optimal" | "infeasible" | "error";
  openWarehouseIds: string[];
  assignments: Assignment[];
  objective: number;
  weightedAvgDistanceMi: number;
  bandCoverage: BandCoverage[];
  utilization: WarehouseUtilization[];
  runTimeSec: number;
  solverUsed: string;
  infeasibilityReason: string | null;
}

export function solve(input: SolveInput): SolveOutput {
  const payload = JSON.stringify({
    pValue: input.pValue,
    distanceBands: input.distanceBands,
    capacityMode: input.capacityMode,
    uniformCapacity: input.uniformCapacity ?? null,
    warehouseStatuses: input.warehouseStatuses,
    gap: input.gap ?? 0,
    timeLimitSec: input.timeLimitSec ?? 120,
    solver: input.solver ?? "cbc",
    modelType: input.modelType ?? "p_median",
    capacityFactor: input.capacityFactor ?? 1.0,
    singleSource: input.singleSource ?? false,
    capacityInactive: input.capacityInactive ?? false,
  });

  const result = spawnSync("python3", [SOLVER_PY], {
    input: payload,
    encoding: "utf8",
    timeout: (input.timeLimitSec ?? 120) * 1000 + 15000,
  });

  if (result.error || result.status !== 0) {
    const msg = result.stderr || result.error?.message || "python3 process failed";
    return {
      status: "error",
      openWarehouseIds: [],
      assignments: [],
      objective: 0,
      weightedAvgDistanceMi: 0,
      bandCoverage: [],
      utilization: [],
      runTimeSec: 0,
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: msg.slice(0, 500),
    };
  }

  try {
    return JSON.parse(result.stdout) as SolveOutput;
  } catch {
    return {
      status: "error",
      openWarehouseIds: [],
      assignments: [],
      objective: 0,
      weightedAvgDistanceMi: 0,
      bandCoverage: [],
      utilization: [],
      runTimeSec: 0,
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: "Failed to parse solver output: " + result.stdout.slice(0, 200),
    };
  }
}
