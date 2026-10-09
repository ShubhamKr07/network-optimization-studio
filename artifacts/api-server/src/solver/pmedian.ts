import type { PMedianInputs } from "../validation/inputs/pMedian.js";
import type { TransportLpInputs } from "../validation/inputs/transportLp.js";
import type { TwoEchelonInputs } from "../validation/inputs/twoEchelon.js";
import type { JadeInputs } from "../validation/inputs/jadeInputs.js";
import type { MaxCoverageInputs } from "../validation/inputs/maxCoverage.js";
import type { DeliveryInputs } from "../validation/inputs/delivery.js";
import { getManifest } from "../registry/modelRegistry.js";

export type SolveInput =
  | { modelId: "p-median-us" | "p-median-brazil"; inputs: PMedianInputs }
  | { modelId: "transport-coal"; inputs: TransportLpInputs }
  | { modelId: "two-echelon-gold-au"; inputs: TwoEchelonInputs }
  | { modelId: "two-echelon-jade-us"; inputs: JadeInputs }
  | { modelId: "max-coverage-us"; inputs: MaxCoverageInputs }
  | { modelId: "delivery-teaching-us"; inputs: DeliveryInputs };

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
      // B6.1: pass transportLp.ts's scenario-local network-edit arrays
      // straight through by their exact schema names — merge_inputs.py's
      // build_merged_transport_dataset reads them via
      // inp.get("addedMines"/"addedStations"/"laneCostOverrides", []), so
      // absent/empty here is byte-identical to today's behavior (mirrors
      // p-median's addedWarehouses/addedCustomers/distanceOverrides
      // passthrough below).
      addedMines: i.addedMines,
      addedStations: i.addedStations,
      laneCostOverrides: i.laneCostOverrides,
    };
  }

  if (input.modelId === "two-echelon-gold-au") {
    const i = input.inputs;
    // Bundle 2.2 (B2.2-T1, A3 backend) — an added customer can be marked
    // Excluded on the schema, but this model's solver only honors it when
    // the manifest advertises supportsAddedCustomerExclusion (true for
    // two-echelon-gold-au). Read from the registry, never hardcoded as
    // modelId === "two-echelon-gold-au" here (this repo's most-documented
    // recurring bug class) — the gate is the capability, not the string.
    const supportsAddedCustomerExclusion =
      getManifest(input.modelId)?.capabilities.supportsAddedCustomerExclusion ?? false;
    return {
      modelType: "two_echelon",
      bomRatio: i.bomRatio,
      refineryStatuses: i.refineryOverrides
        .filter((o) => o.status !== "active")
        .map((o) => ({ refineryId: o.id, status: o.status })),
      excludedCustomerIds: [
        ...i.customerOverrides.filter((o) => o.status === "excluded").map((o) => o.id),
        ...(supportsAddedCustomerExclusion
          ? i.addedCustomers.filter((c) => c.status === "excluded").map((c) => c.id)
          : []),
      ],
      customerDemands: Object.fromEntries(
        i.customerOverrides.filter((o) => o.demand != null).map((o) => [o.id, o.demand as number]),
      ),
      distanceBands: i.distanceBands,
      gap: i.gap,
      timeLimitSec: i.timeLimitSec,
      // B6.2: pass twoEchelon.ts's scenario-local network-edit arrays
      // straight through by their exact schema names — merge_inputs.py's
      // build_merged_two_echelon_dataset reads them via inp.get(
      // "addedRefineries"/"addedCustomers"/"distanceOverrides", []), so
      // absent/empty here is byte-identical to today's behavior (mirrors
      // transport-coal's addedMines/addedStations/laneCostOverrides
      // passthrough above).
      addedRefineries: i.addedRefineries,
      addedCustomers: i.addedCustomers,
      distanceOverrides: i.distanceOverrides,
    };
  }

  if (input.modelId === "two-echelon-jade-us") {
    const i = input.inputs;
    // jade-T5: same capability-gate pattern as two-echelon-gold-au/p-median
    // above — never hardcode modelId === "two-echelon-jade-us" here (this
    // repo's most-documented recurring bug class). Manifest sets
    // supportsAddedCustomerExclusion: true for this model.
    const supportsAddedCustomerExclusion =
      getManifest(input.modelId)?.capabilities.supportsAddedCustomerExclusion ?? false;
    return {
      modelType: "two_echelon_jade",
      p: i.p,
      distanceBands: i.distanceBands,
      gap: i.gap,
      timeLimitSec: i.timeLimitSec,
      warehouseStatuses: i.warehouseOverrides
        .filter((o) => o.status !== "active")
        .map((o) => ({ warehouseId: o.id, status: o.status })),
      excludedCustomerIds: [
        ...i.customerOverrides.filter((o) => o.status === "excluded").map((o) => o.id),
        ...(supportsAddedCustomerExclusion
          ? i.addedCustomers.filter((c) => c.status === "excluded").map((c) => c.id)
          : []),
      ],
      // Nested per-product override: solve_jade's get_demands() layers this
      // onto a base customer's own `demands` dict (sparse -- omitted product
      // keys inherit the base value), matching customerOverrideSchema's own
      // sparse shape exactly.
      customerDemands: Object.fromEntries(
        i.customerOverrides.filter((o) => o.demands != null).map((o) => [o.id, o.demands]),
      ),
      // Wire name is `capabilityOverrides` (merge_inputs.py's
      // build_merged_jade_dataset reads inp.get("capabilityOverrides", []))
      // -- the schema field is named `plantProductCapability` to match the
      // plan's public vocabulary; buildPayload is exactly the translation
      // boundary where a schema name and a wire name are allowed to differ.
      capabilityOverrides: i.plantProductCapability,
      // jade-T5: pass jadeInputs.ts's scenario-local network-edit arrays
      // straight through by their exact schema names -- merge_inputs.py's
      // build_merged_jade_dataset reads them via inp.get("addedPlants"/
      // "addedWarehouses"/"addedCustomers"/"distanceOverrides", []), so
      // absent/empty here is byte-identical to today's behavior (mirrors
      // every prior model's added-entity passthrough). Never inlines the
      // base dataset -- only validated edits + params cross the wire
      // (plan's Global Constraints payload/merge boundary).
      addedPlants: i.addedPlants,
      addedWarehouses: i.addedWarehouses,
      addedCustomers: i.addedCustomers,
      distanceOverrides: i.distanceOverrides,
      // ch9-tc — the four editable transportation rates (spec §3.2 point 4).
      // Same key name on both sides, so this is a pure passthrough, not a
      // translation; `undefined` when the scenario never set them, which
      // solve_jade reads as "use the textbook constants" (byte-identical to
      // the pre-change payload for every existing scenario).
      transportCosts: i.transportCosts,
    };
  }

  if (input.modelId === "max-coverage-us") {
    const i = input.inputs;
    // C4.6: Chapter 4 Al's Athletics — Max Coverage. Dispatch on modelType
    // "max_coverage_us" (D16, MIG-21: the wire value is deliberately a
    // DIFFERENT string from the public model id); the base dataset is NEVER
    // inlined — only the validated scalar params + sparse edits cross the
    // wire, and merge_inputs.py's build_merged_max_coverage_dataset (C4.3)
    // reads the edit arrays by their exact schema names
    // (inp.get("warehouseOverrides"/"customerOverrides"/"addedWarehouses"/
    // "addedCustomers"/"distanceOverrides", [])). Direct-id like
    // two-echelon/transport (DD-2), so the override arrays pass straight
    // through WITHOUT the p-median warehouseStatuses/excludedCustomerIds
    // reshaping below — the Python merge resolves status/exclusion/demand
    // itself. CH4O-5 — avgServiceDistCapMi and coverageFloorDemand are now
    // UNCONDITIONALLY required by maxCoverageInputsSchema (the cap binds in
    // both objectives; the floor is the mode discriminator), so both are
    // always present on validated inputs and are passed unconditionally.
    // `objective` is still forwarded for traceability, but solve.py ignores
    // it and re-derives the mode from the floor itself.
    return {
      modelType: "max_coverage_us",
      objective: i.objective,
      p: i.p,
      highServiceDistMi: i.highServiceDistMi,
      maxDistMi: i.maxDistMi,
      avgServiceDistCapMi: i.avgServiceDistCapMi,
      coverageFloorDemand: i.coverageFloorDemand,
      gap: i.gap,
      timeLimitSec: i.timeLimitSec,
      distanceBands: i.distanceBands,
      warehouseOverrides: i.warehouseOverrides,
      customerOverrides: i.customerOverrides,
      addedWarehouses: i.addedWarehouses,
      addedCustomers: i.addedCustomers,
      distanceOverrides: i.distanceOverrides,
    };
  }

  if (input.modelId === "delivery-teaching-us") {
    const i = input.inputs;
    // Chapter 5 (ch5-del-4) — dispatch on modelType "delivery" (matches
    // solve.py's `if model_type == 'delivery':` landed in ch5-del-3). This
    // branch MUST sit before the unguarded p-median fallthrough below (its
    // "whatever is left" else), or this model silently dispatches as
    // p_median and returns a plausible wrong answer with no error anywhere.
    return {
      modelType: "delivery",
      pValue: i.p,
      distanceBands: i.distanceBands,
      gap: i.gap,
      timeLimitSec: i.timeLimitSec,
      costAdjustEnabled: i.costAdjustEnabled,
      distanceThreshold: i.distanceThreshold,
      costPerMile: i.costPerMile,
      costPerMileOver: i.costPerMileOver,
      laneCostOverrides: i.laneCostOverrides,
      // §14 — only deviations from default travel: an `active` warehouse
      // and a null/absent demand are the defaults and are not sent.
      customerDemands: Object.fromEntries(
        i.customerOverrides.filter(o => o.demand != null).map(o => [o.id, o.demand as number]),
      ),
      excludedCustomerIds: i.customerOverrides
        .filter(o => o.status === "excluded").map(o => o.id),
      warehouseStatuses: i.warehouseOverrides
        .filter(o => o.status !== "active")
        .map(o => ({ warehouseId: o.id, status: o.status })),
    };
  }

  const i = input.inputs;
  const effectiveCapacity = i.capacityMode === "none" ? null : (i.uniformCapacity ?? null);
  const warehouseStatuses = i.warehouseOverrides
    .filter((o) => o.status !== "active")
    .map((o) => ({ warehouseId: o.id, status: o.status }));
  // Bundle 2.2 (B2.2-T1, A3 backend) — this p-median block is SHARED by
  // p-median-us AND p-median-brazil (input.modelId discriminates only
  // above, at the branch level). An added customer's `status` field is
  // schema-legal for both (pMedianInputsSchema is one shared schema), but
  // only a model whose manifest sets `capabilities.
  // supportsAddedCustomerExclusion: true` (p-median-us) actually excludes
  // it from the solve — Brazil's manifest sets this false, so a Brazil
  // added customer marked "excluded" is still served. Read from the
  // registry, never a hardcoded `modelId === "p-median-us"` branch here.
  const supportsAddedCustomerExclusion =
    getManifest(input.modelId)?.capabilities.supportsAddedCustomerExclusion ?? false;
  const excludedCustomerIds = [
    ...i.customerOverrides.filter((o) => o.status === "excluded").map((o) => o.id),
    ...(supportsAddedCustomerExclusion
      ? i.addedCustomers.filter((c) => c.status === "excluded").map((c) => c.id)
      : []),
  ];
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

