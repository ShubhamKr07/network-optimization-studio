import type { PMedianInputs } from "../validation/inputs/pMedian.js";
import type { TransportLpInputs } from "../validation/inputs/transportLp.js";
import type { TwoEchelonInputs } from "../validation/inputs/twoEchelon.js";

export type SolveInput =
  | { modelId: "p-median-us" | "p-median-brazil"; inputs: PMedianInputs }
  | { modelId: "transport-coal"; inputs: TransportLpInputs }
  | { modelId: "two-echelon-gold-au"; inputs: TwoEchelonInputs };

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
      mineCapacities: i.mineCapacities,
      stationDemands: i.stationDemands,
    };
  }

  if (input.modelId === "two-echelon-gold-au") {
    const i = input.inputs;
    return {
      modelType: "two_echelon",
      bomRatio: i.bomRatio,
      refineryStatuses: i.refineryOverrides
        .filter((o) => o.status !== "active")
        .map((o) => ({ refineryId: o.id, status: o.status })),
      excludedCustomerIds: i.customerOverrides
        .filter((o) => o.status === "excluded").map((o) => o.id),
      customerDemands: Object.fromEntries(
        i.customerOverrides.filter((o) => o.demand != null).map((o) => [o.id, o.demand as number]),
      ),
      distanceBands: i.distanceBands,
      gap: i.gap,
      timeLimitSec: i.timeLimitSec,
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
  //
  // Task 27 fix: under capacityMode "none", a per-warehouse capacity
  // override is the closer structural analog to an added warehouse's own
  // `capacity` field (task 24) than the uniform mechanism is — both are a
  // single warehouse's explicit capacity value, keyed by id. "none" must
  // mean no per-warehouse capacity constraint reaches solve.py from ANY
  // source (uniform/effectiveCapacity, per-warehouse override here, or an
  // added warehouse's own record), so the filter below also requires
  // capacityMode !== "none" — producing an empty dict in that mode, same
  // sparse-omission convention this dict already uses for "no override".
  const warehouseCapacities = Object.fromEntries(
    i.warehouseOverrides
      .filter((o) => o.capacity != null && i.capacityMode !== "none")
      .map((o) => [o.id, o.capacity as number]),
  );
  const customerDemands = Object.fromEntries(
    i.customerOverrides.filter((o) => o.demand != null).map((o) => [o.id, o.demand as number]),
  );

  // Task 24: pass B1.1's scenario-local network-edit arrays straight through
  // by their exact schema names — merge_inputs.py (B1.3/B3.1) reads them via
  // inp.get("addedWarehouses"/"addedCustomers"/"distanceOverrides", []), so
  // absent/empty here is byte-identical to today's behavior. Forwarded to
  // BOTH p-median-us and p-median-brazil (this shared block): solve_pmedian
  // (p-median-us) is fully wired to consume them; solve_capacitated_pmedian
  // (Brazil) doesn't read them yet (B6.3), same "harmless no-op, ignores
  // unknown keys" precedent as warehouseCapacities/customerDemands above.
  //
  // Product decision (capacityMode vs added-warehouse capacity, flagged by
  // B3.1's review): capacityMode is a scenario-wide toggle already enforced
  // on BASE warehouses (effectiveCapacity above nulls out uniformCapacity
  // when capacityMode is "none"). Left alone, solve_pmedian's
  // addedWarehousesById lookup binds an added warehouse's own `capacity`
  // regardless of capacityMode — "none" would silently mean "no capacity
  // constraints, except ones a student just added," contradicting what the
  // toggle claims to do. Stripping it here (data, not a new solve.py
  // branch — hard rule #6) keeps capacityMode a real, uniform switch across
  // base AND added warehouses; "uniform"/"per_wh" leave an added
  // warehouse's capacity exactly as authored, since it's the student's own
  // per-facility fact in those modes, not implied by the global mode.
  const addedWarehouses =
    i.capacityMode === "none"
      ? i.addedWarehouses.map((w) => ({ ...w, capacity: null }))
      : i.addedWarehouses;

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
    addedWarehouses,
    addedCustomers: i.addedCustomers,
    distanceOverrides: i.distanceOverrides,
  };
}

