import type { PMedianInputs } from "../validation/inputs/pMedian.js";
import type { TransportLpInputs } from "../validation/inputs/transportLp.js";

export type SolveInput =
  | { modelId: "p-median-us" | "p-median-brazil"; inputs: PMedianInputs }
  | { modelId: "transport-coal"; inputs: TransportLpInputs };

// Translates the model's validated `inputs` (DB/contract shape) into the
// flat dict solve.py's dispatcher and per-model solve_* functions read
// (an internal wire format, not part of the public API contract). Used by
// jobRunner.ts to build solve.py's stdin payload.
export function buildPayload(input: SolveInput): Record<string, unknown> {
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

