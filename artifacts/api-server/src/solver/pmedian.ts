import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type { PMedianInputs } from "../validation/inputs/pMedian.js";
import type { TransportLpInputs } from "../validation/inputs/transportLp.js";
import { ResultEnvelopeSchema, type ResultEnvelope } from "./resultEnvelope.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOLVER_PY = path.resolve(__dirname, "..", "src", "solver", "solve.py");

export type SolveInput =
  | { modelId: "p-median-us" | "p-median-brazil"; inputs: PMedianInputs }
  | { modelId: "transport-coal"; inputs: TransportLpInputs };

// Translates the model's validated `inputs` (DB/contract shape) into the
// flat dict solve.py's dispatcher and per-model solve_* functions read
// (an internal wire format, not part of the public API contract).
function buildPayload(input: SolveInput): Record<string, unknown> {
  if (input.modelId === "transport-coal") {
    const i = input.inputs;
    return {
      modelType: "transport",
      distanceBands: i.distanceBands,
      gap: i.gap,
      timeLimitSec: i.timeLimitSec,
      capacityFactor: i.capacityFactor,
      singleSource: i.singleSource,
      capacityInactive: i.capacityInactive,
    };
  }

  const i = input.inputs;
  const effectiveCapacity = i.capacityMode === "none" ? null : (i.uniformCapacity ?? null);
  const warehouseStatuses = i.warehouseOverrides
    .filter((o) => o.status !== "active")
    .map((o) => ({ warehouseId: o.id, status: o.status }));
  const excludedCustomerIds = i.customerOverrides
    .filter((o) => o.status === "excluded")
    .map((o) => o.id);
  // D1.1: sparse per-entity overrides — only entities with a real capacity/
  // demand value produce an entry. solve_pmedian (p-median-us) applies these
  // in the LP; solve_capacitated_pmedian (Brazil) ignores unknown keys.
  const warehouseCapacities = Object.fromEntries(
    i.warehouseOverrides.filter((o) => o.capacity != null).map((o) => [o.id, o.capacity as number]),
  );
  const customerDemands = Object.fromEntries(
    i.customerOverrides.filter((o) => o.demand != null).map((o) => [o.id, o.demand as number]),
  );

  return {
    modelType: input.modelId === "p-median-brazil" ? "capacitated_pmedian" : "p_median",
    pValue: i.p,
    distanceBands: i.distanceBands,
    uniformCapacity: effectiveCapacity,
    warehouseCapacity: effectiveCapacity ?? undefined,
    warehouseCapacities,
    customerDemands,
    warehouseStatuses,
    excludedCustomerIds,
    gap: i.gap,
    timeLimitSec: i.timeLimitSec,
    singleSource: i.singleSource,
  };
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
  // Chapter 5 transport LP / capacitated models
  flowTons?: number;
  flowFraction?: number;
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

function errorOutput(reason: string): SolveOutput {
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
    infeasibilityReason: reason,
  };
}

// Phase 3.5 (G2.1): solve.py now emits a standardized envelope
// ({status, objective, edges, metrics, details, ...}), validated here
// against the shared Zod schema before anything trusts it. This translates
// it back to the pre-envelope flat SolveOutput shape so routes.ts and the
// frontend are unaffected by the wire-shape refactor — Phase 4/5 will read
// the envelope directly and this shim goes away.
function envelopeToLegacy(env: ResultEnvelope): SolveOutput {
  const details = env.details as { openWarehouseIds?: string[]; assignments?: Assignment[] };
  return {
    status: env.status,
    openWarehouseIds: details.openWarehouseIds ?? [],
    assignments: details.assignments ?? [],
    objective: env.objective,
    weightedAvgDistanceMi: env.metrics.weightedAvgDistance ?? 0,
    bandCoverage: env.metrics.bandCoverage ?? [],
    utilization: env.metrics.utilizationByNode ?? [],
    runTimeSec: env.runTimeSec,
    solverUsed: env.solverUsed,
    infeasibilityReason: env.infeasibilityReason,
  };
}

export function solve(input: SolveInput): SolveOutput {
  const payload = JSON.stringify(buildPayload(input));

  const result = spawnSync("python3", [SOLVER_PY], {
    input: payload,
    encoding: "utf8",
    timeout: input.inputs.timeLimitSec * 1000 + 15000,
  });

  if (result.error || result.status !== 0) {
    const msg = result.stderr || result.error?.message || "python3 process failed";
    return errorOutput(msg.slice(0, 500));
  }

  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    return errorOutput("Failed to parse solver output: " + result.stdout.slice(0, 200));
  }

  const parsed = ResultEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return errorOutput("Solver output failed envelope validation: " + parsed.error.message.slice(0, 300));
  }

  return envelopeToLegacy(parsed.data);
}
