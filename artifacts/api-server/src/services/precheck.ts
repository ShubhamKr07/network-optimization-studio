import { WAREHOUSES, CUSTOMERS, BRAZIL_WAREHOUSES, BRAZIL_REGIONS } from "../data/dataset.js";
import { TRANSPORT_COAL_WAREHOUSES, TRANSPORT_COAL_CUSTOMERS } from "../data/transportCoalDataset.js";
import { GOLD_MINES, GOLD_REFINERIES, GOLD_CUSTOMERS } from "../data/twoEchelonDataset.js";
import { JADE_PLANTS, JADE_PRODUCTS, JADE_WAREHOUSES, JADE_CUSTOMERS, JADE_PLANT_PRODUCT_CAPABILITIES } from "../data/jadeDataset.js";
import { CHENS_WAREHOUSES, CHENS_CUSTOMERS } from "../data/chensDataset.js";
import { getReferenceDistances } from "../data/referenceDistances.js";
import type { PMedianInputs } from "../validation/inputs/pMedian.js";
import type { TransportLpInputs } from "../validation/inputs/transportLp.js";
import type { TwoEchelonInputs } from "../validation/inputs/twoEchelon.js";
import type { JadeInputs } from "../validation/inputs/jadeInputs.js";
import type { ChensInputs } from "../validation/inputs/chens.js";
import { getManifest } from "../registry/modelRegistry.js";

/**
 * SCN v0.3 Phase B, task B2.1 - semantic precheck for p-median-us
 * scenario-local network edits (B1.1: addedWarehouses/addedCustomers/
 * distanceOverrides). B1.1's Zod schema already enforces per-field shape
 * (non-empty IDs, positive distances, no duplicate override pairs); this
 * service checks the cross-field/semantic correctness Zod can't express:
 *
 *   (a) completeness    - every active added warehouse has a distance to
 *                          every active customer, and every active
 *                          warehouse has a distance to every active added
 *                          customer (the "vice versa" case: a base
 *                          warehouse needs an override to reach a new
 *                          customer too, since the base dataset's distance
 *                          matrix only ever covers base<->base pairs).
 *   (b) id collision     - every added entity's id is unique against both
 *                          the base dataset and every other added entity
 *                          in the same scenario.
 *   (c) reference integrity - every distanceOverrides pair's fromId
 *                          resolves as a real warehouse (base or added)
 *                          and toId resolves as a real customer (base or
 *                          added) - strict role checking, matching
 *                          merge_inputs.py's resolve_pmedian_ids_to_indices
 *                          (B1.3): a backwards pair (fromId=a customer id)
 *                          is rejected even if that id is valid in the
 *                          other role, not silently coerced. Keys on
 *                          stable IDs only - a city name never resolves
 *                          (this repo's dataset-audit duplicate-city trap:
 *                          city names are NOT unique).
 *
 * Purely a read/validate operation - never writes to the DB, never mutates
 * `inputs`.
 */

// jade-T6 adds "p_range" and "capacity" for two-echelon-jade-us — two
// genuinely new failure categories no prior model's precheck has (p vs.
// forced-open/active warehouse COUNTS, and per-product enabled-plant-
// capacity vs. effective demand; see precheckJadeInputs below). These two
// values are NOT YET reflected in openapi.yaml's PrecheckErrorCode enum
// (out of this task's scope — precheck responses are never schema-validated
// against that generated Zod enum on the way out, so this is inert today,
// not a live contract break) — a follow-up should extend that enum +
// regenerate codegen once JADE's frontend precheck-display work (T11+)
// needs to discriminate on these codes specifically.
// C4.8 (Chapter 4, chens-cosmetics-cn) adds three genuinely new semantic
// failure classes no prior model's precheck has (see precheckChensInputs
// below), all blocking (Chen has no warnings channel — the solve path 422s
// whenever ok is false):
//   - "zero_demand"                total effective demand across active
//                                  customers is <= 0 (nothing to serve).
//   - "no_feasible_route"          an active customer has NO active warehouse
//                                  reachable within maxDistKm after circuity
//                                  (rawKm × 1.17 ≤ maxDistKm).
//   - "coverage_floor_infeasible"  min_distance mode's coverageFloorDemand
//                                  exceeds a cheap NECESSARY upper bound on
//                                  coverable demand (Σ demand of customers with
//                                  ≥1 active warehouse at rawKm × 1.17 ≤
//                                  highServiceDistKm) — the solver stays
//                                  authoritative for the sufficient case.
// These are already present in openapi.yaml's PrecheckError.code enum (added
// by C4.5) — this type is the api-server-side source of truth those codes
// mirror.
export type PrecheckErrorCode =
  | "completeness"
  | "id_collision"
  | "reference_integrity"
  | "p_range"
  | "capacity"
  | "zero_demand"
  | "no_feasible_route"
  | "coverage_floor_infeasible";

export interface PrecheckError {
  code: PrecheckErrorCode;
  message: string;
}

export interface PrecheckResult {
  ok: boolean;
  errors: PrecheckError[];
}

/** Minimal shape this service needs from a dataset entity - just its id. */
export interface PrecheckDatasetEntity {
  id: string;
}

export interface PrecheckDataset {
  warehouses: readonly PrecheckDatasetEntity[];
  customers: readonly PrecheckDatasetEntity[];
  // Bundle 2.2 (B2.2-T1, A3 backend) — whether THIS model's added customers
  // can be individually excluded from the solve (an added customer's own
  // `status` field). Read once from the model registry's manifest
  // capability at the point each PrecheckDataset constant is defined below
  // (never a runtime `modelId === "..."` branch inside the exclusion logic
  // itself) — this is how p-median-us (true) and p-median-brazil (false)
  // diverge despite sharing this exact PrecheckDataset shape and the same
  // buildActivePMedianIds/precheckPMedianInputs functions. Optional: a
  // caller-supplied fake dataset (tests) that omits it behaves as `false`
  // (no filtering), matching pre-Bundle-2.2 behavior exactly.
  supportsAddedCustomerExclusion?: boolean;
}

// `dataset` is a parameter (defaulting to the real p-median-us base
// dataset) rather than an unconditional import of WAREHOUSES/CUSTOMERS
// inside the checks below - this task (B2.1) only ever calls it with the
// default, but B6.x's fast-follow to the other three models can reuse this
// same function against a different model's base dataset without a
// rewrite. No multi-model dispatch is built here - that's still B6.x's job.
const DEFAULT_DATASET: PrecheckDataset = {
  warehouses: WAREHOUSES,
  customers: CUSTOMERS,
  supportsAddedCustomerExclusion: getManifest("p-median-us")?.capabilities.supportsAddedCustomerExclusion ?? false,
};

// SCN v0.3 Phase B, task B6.3 — p-median-brazil's base dataset, shaped for
// this service (`{warehouses: {id}[], customers: {id}[]}`; Brazil's
// "customers" role is filled by its demand regions/states). Exported so
// routes/scenarios.ts's runNetworkEditsPrecheck can pass it as the `dataset`
// argument to precheckPMedianInputs for p-median-brazil scenarios, the same
// way it already calls the function with the (implicit default) p-median-us
// dataset. p-median-brazil shares pMedianInputsSchema/PMedianInputs with
// p-median-us (validation/inputs/pMedian.ts), so no new schema is needed —
// only a different base dataset to check added entities against.
export const BRAZIL_DATASET: PrecheckDataset = {
  warehouses: BRAZIL_WAREHOUSES,
  customers: BRAZIL_REGIONS,
  // Bundle 2.2 (B2.2-T1) — explicit false via the manifest (p-median-brazil's
  // capability), not merely "field absent": an added Brazil customer marked
  // "excluded" must still count active, matching its solver's real behavior.
  supportsAddedCustomerExclusion:
    getManifest("p-median-brazil")?.capabilities.supportsAddedCustomerExclusion ?? false,
};

// SCN v0.3 Phase B, task B6.1 — transport-coal's base dataset, shaped for
// this service (`{warehouses: {id}[], customers: {id}[]}`; transport-coal's
// "warehouses" role is filled by mines, "customers" role by stations).
// Exported so routes/scenarios.ts's runNetworkEditsPrecheck can pass it to
// precheckTransportInputs (this file's own transport-coal-specific check
// function, below — NOT precheckPMedianInputs, since TransportLpInputs has
// a structurally different shape: no warehouseOverrides/customerOverrides
// status arrays at all).
export const TRANSPORT_DATASET: PrecheckDataset = { warehouses: TRANSPORT_COAL_WAREHOUSES, customers: TRANSPORT_COAL_CUSTOMERS };

// Chapter 4 (chens-cosmetics-cn) — Chen's base dataset, shaped for this
// service (25 candidate warehouses + 197 customers). Chen shares p-median's
// warehouse/customer role structure and reuses buildPMedianIdSpaces for the
// `distances` import entity's reference-integrity check (import.ts) AND the
// shared structural checks (id_collision/reference_integrity/completeness)
// precheckChensInputs delegates to precheckPMedianInputs for. On top of the
// two-role PrecheckDataset shape, Chen's own semantic precheck (C4.8) needs
// two extra pieces of base data no other model's precheck reads:
//   - customerDemands — base integer demand by customer id (D30), for the
//     effective-demand map (zero_demand + coverage-floor upper bound).
//   - baseDistanceKm  — the full base RAW-km distance matrix keyed
//     "fromId|toId" (25×197), overlaid at precheck time by this scenario's
//     distanceOverrides, for the circuity-adjusted feasibility thresholds.
//     Built from getReferenceDistances (the same immutable per-model matrix
//     GET /models/:id/reference-distances serves), NOT re-loaded here.
export interface ChensPrecheckDataset extends PrecheckDataset {
  customerDemands: Record<string, number>;
  baseDistanceKm: Record<string, number>;
}

export const CHENS_DATASET: ChensPrecheckDataset = {
  warehouses: CHENS_WAREHOUSES,
  customers: CHENS_CUSTOMERS,
  supportsAddedCustomerExclusion:
    getManifest("chens-cosmetics-cn")?.capabilities.supportsAddedCustomerExclusion ?? false,
  customerDemands: Object.fromEntries(CHENS_CUSTOMERS.map((c) => [c.id, c.demand])),
  baseDistanceKm: Object.fromEntries(
    (getReferenceDistances("chens-cosmetics-cn")?.pairs ?? []).map((p) => [p.fromId + "|" + p.toId, p.distance]),
  ),
};

// C4.8 — the circuity factor solve_chens applies to every raw stored/estimated
// km before comparing against the distance thresholds (D8). Precheck must
// apply the SAME factor to both thresholds or it would approve scenarios the
// solver then declares infeasible (raw km < threshold but raw × 1.17 > it).
const CHENS_CIRCUITY = 1.17;

/**
 * C4.8 (Chapter 4, chens-cosmetics-cn) — semantic precheck for Chen's coverage
 * / min-distance service-level model. Runs TypeScript-side in the API server
 * BEFORE solver dispatch (this is NOT the Python `build_merged_chens_dataset`
 * merge) — it builds an effective view from base data + this scenario's sparse
 * edits and rejects mathematically-doomed scenarios cheaply, so CBC isn't paid
 * to prove infeasibility the expensive way.
 *
 * Chen shares p-median's exact warehouse/customer override + added-entity +
 * distanceOverride shape, so the three STRUCTURAL checks (id_collision,
 * reference_integrity, completeness) are delegated verbatim to
 * precheckPMedianInputs rather than re-implemented. On top of those it adds
 * four Chen-specific semantic checks:
 *   - p_range                    forcedOpenCount ≤ p ≤ active candidate count
 *                                (reuse `p_range`, D18 — NOT a new code).
 *   - zero_demand                total effective demand ≤ 0.
 *   - no_feasible_route          an active customer with no active warehouse at
 *                                rawKm × 1.17 ≤ maxDistKm (a hard assignment
 *                                constraint in BOTH objective modes).
 *   - coverage_floor_infeasible  (min_distance only) coverageFloorDemand
 *                                exceeds Σ demand of customers with ≥1 active
 *                                warehouse at rawKm × 1.17 ≤ highServiceDistKm
 *                                — a NECESSARY upper bound (the shared p limit
 *                                may still prevent covering them all together;
 *                                the solver stays authoritative).
 *
 * The effective view:
 *   - active candidate set   base warehouses not "inactive" per
 *                            warehouseOverrides, plus added warehouses not
 *                            "inactive" (forced_open counts active) — via the
 *                            shared buildActivePMedianIds.
 *   - active customer set    base customers not "excluded", plus added
 *                            customers not "excluded" — same helper.
 *   - effective demand       added customer's own demand, else customerOverride
 *                            demand, else base demand.
 *   - raw-distance lookup    base matrix (baseDistanceKm) overlaid by this
 *                            scenario's distanceOverrides (which C4.7's
 *                            estimator has already filled for added entities);
 *                            a pair absent from both is treated as unreachable
 *                            (completeness reports the real cause separately).
 *
 * Purely a read/validate operation — never writes to the DB, never mutates
 * `inputs`.
 */
export function precheckChensInputs(
  inputs: ChensInputs,
  dataset: ChensPrecheckDataset = CHENS_DATASET,
): PrecheckResult {
  // Structural checks (id_collision / reference_integrity / completeness) —
  // Chen's edit shape is p-median's, so reuse rather than duplicate.
  const errors: PrecheckError[] = [...precheckPMedianInputs(inputs as unknown as PMedianInputs, dataset).errors];

  const warehouseOverrides = inputs.warehouseOverrides ?? [];
  const addedWarehouses = inputs.addedWarehouses ?? [];
  const addedCustomers = inputs.addedCustomers ?? [];
  const customerOverrides = inputs.customerOverrides ?? [];
  const distanceOverrides = inputs.distanceOverrides ?? [];

  const { activeWarehouseIds, activeCustomerIds } = buildActivePMedianIds(inputs, dataset);

  // --- p_range: forcedOpenCount <= p <= active candidate count (D18) --------
  const forcedOpenCount =
    warehouseOverrides.filter((o) => o.status === "forced_open").length +
    addedWarehouses.filter((w) => w.status === "forced_open").length;
  if (inputs.p < forcedOpenCount) {
    errors.push({
      code: "p_range",
      message: `p (${inputs.p}) is less than the number of forced-open warehouses (${forcedOpenCount})`,
    });
  }
  if (inputs.p > activeWarehouseIds.length) {
    errors.push({
      code: "p_range",
      message: `p (${inputs.p}) exceeds the number of active warehouses (${activeWarehouseIds.length})`,
    });
  }

  // --- effective demand map -------------------------------------------------
  const addedDemandById = new Map(addedCustomers.map((c) => [c.id, c.demand]));
  const overrideDemandById = new Map(
    customerOverrides.filter((o) => o.demand != null).map((o) => [o.id, o.demand as number]),
  );
  const effectiveDemand = (custId: string): number => {
    if (addedDemandById.has(custId)) return addedDemandById.get(custId)!;
    if (overrideDemandById.has(custId)) return overrideDemandById.get(custId)!;
    return dataset.customerDemands[custId] ?? 0;
  };

  // --- zero_demand (D15): nothing to serve ----------------------------------
  const totalDemand = activeCustomerIds.reduce((sum, id) => sum + effectiveDemand(id), 0);
  if (totalDemand <= 0) {
    errors.push({
      code: "zero_demand",
      message: `Total effective demand across active customers is ${totalDemand} (nothing to serve)`,
    });
  }

  // --- raw-distance lookup: base matrix overlaid by distanceOverrides -------
  // distanceOverrides win over the base value (a user/estimator override on a
  // base pair replaces it, and every added-entity pair lives ONLY here).
  const rawKm = new Map<string, number>(Object.entries(dataset.baseDistanceKm));
  for (const o of distanceOverrides) rawKm.set(o.fromId + "|" + o.toId, o.distance);

  const isReachable = (whId: string, custId: string, thresholdKm: number): boolean => {
    const raw = rawKm.get(whId + "|" + custId);
    return raw !== undefined && raw * CHENS_CIRCUITY <= thresholdKm;
  };

  // --- no_feasible_route: every active customer needs a reachable active WH
  // within maxDistKm after circuity (a hard assignment constraint in BOTH
  // objective modes). -------------------------------------------------------
  for (const custId of activeCustomerIds) {
    const reachable = activeWarehouseIds.some((whId) => isReachable(whId, custId, inputs.maxDistKm));
    if (!reachable) {
      errors.push({
        code: "no_feasible_route",
        message: `Customer '${custId}' has no active warehouse within maxDistKm (${inputs.maxDistKm} km) after circuity`,
      });
    }
  }

  // --- coverage_floor_infeasible (min_distance only): coverageFloorDemand vs
  // a cheap NECESSARY upper bound on coverable demand. coverageFloorDemand is
  // only present in min_distance mode (undefined in coverage mode → skipped).
  if (inputs.objective === "min_distance" && inputs.coverageFloorDemand != null) {
    let coverableDemand = 0;
    for (const custId of activeCustomerIds) {
      const coverable = activeWarehouseIds.some((whId) => isReachable(whId, custId, inputs.highServiceDistKm));
      if (coverable) coverableDemand += effectiveDemand(custId);
    }
    if (inputs.coverageFloorDemand > coverableDemand) {
      errors.push({
        code: "coverage_floor_infeasible",
        message: `coverageFloorDemand (${inputs.coverageFloorDemand}) exceeds the ${coverableDemand} demand coverable within highServiceDistKm (${inputs.highServiceDistKm} km) after circuity`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Builds the strict per-role id spaces (base dataset + this scenario's added
 * entities) that both this service's own reference-integrity check and
 * B4.1's `import.ts` distances-entity parsing need: fromId must resolve as a
 * warehouse, toId must resolve as a customer - never "whichever role happens
 * to contain it" (see this file's header comment on (c) reference
 * integrity). Exported so `import.ts` doesn't re-implement this rule with
 * different semantics - same category of check, one source of truth.
 * Parameter is a minimal structural shape (not `PMedianInputs` itself) so
 * callers that only have `{id}` refs (not full added-entity rows) can use it
 * too.
 */
export function buildPMedianIdSpaces(
  addedEntities: {
    addedWarehouses?: readonly PrecheckDatasetEntity[];
    addedCustomers?: readonly PrecheckDatasetEntity[];
  },
  dataset: PrecheckDataset = DEFAULT_DATASET,
): { warehouseIdSpace: Set<string>; customerIdSpace: Set<string> } {
  const warehouseIdSpace = new Set(dataset.warehouses.map((w) => w.id));
  for (const w of addedEntities.addedWarehouses ?? []) warehouseIdSpace.add(w.id);
  const customerIdSpace = new Set(dataset.customers.map((c) => c.id));
  for (const c of addedEntities.addedCustomers ?? []) customerIdSpace.add(c.id);
  return { warehouseIdSpace, customerIdSpace };
}

/**
 * Builds the "who's active" id lists (base entities not excluded/inactive
 * per this scenario's overrides, plus every added entity — addedCustomers
 * has no status field, so every added customer counts as active) both this
 * service's own (a) completeness check and B4.3's export stub-generator
 * need. Exported (alongside buildPMedianIdSpaces above) so callers outside
 * this file reuse the exact same "active" definition rather than
 * reimplementing it slightly differently. Parameter shape is a minimal
 * structural type (not `PMedianInputs` itself) for the same reason
 * buildPMedianIdSpaces takes one - callers with only override/added-entity
 * arrays (not a full validated PMedianInputs) can use it too.
 */
/**
 * Bundle 2.2 (B2.2-T1, A3 backend) — an added customer's own `status` field
 * (pMedian.ts/twoEchelon.ts's addedCustomerSchema) is only honored as an
 * "active" filter when the model's manifest capability
 * `supportsAddedCustomerExclusion` is true. Shared by
 * buildActivePMedianIds/buildActiveTwoEchelonIds and their respective
 * precheck functions' own "vice versa" required-set computation below, so
 * both places apply the exact same rule rather than risking one being
 * gated and the other not (which would otherwise contradict each other in
 * precheckPMedianInputs' completeness check).
 */
function filterActiveAddedCustomers<T extends PrecheckDatasetEntity & { status?: string }>(
  addedCustomers: readonly T[],
  supportsAddedCustomerExclusion: boolean | undefined,
): T[] {
  if (!supportsAddedCustomerExclusion) return [...addedCustomers];
  return addedCustomers.filter((c) => c.status !== "excluded");
}

export function buildActivePMedianIds(
  inputs: {
    addedWarehouses?: readonly (PrecheckDatasetEntity & { status?: string })[];
    addedCustomers?: readonly (PrecheckDatasetEntity & { status?: string })[];
    warehouseOverrides?: readonly { id: string; status?: string }[];
    customerOverrides?: readonly { id: string; status?: string }[];
  },
  dataset: PrecheckDataset = DEFAULT_DATASET,
): { activeWarehouseIds: string[]; activeCustomerIds: string[] } {
  const warehouseOverrides = inputs.warehouseOverrides ?? [];
  const customerOverrides = inputs.customerOverrides ?? [];
  const addedWarehouses = inputs.addedWarehouses ?? [];
  const addedCustomers = inputs.addedCustomers ?? [];

  const warehouseStatusById = new Map(warehouseOverrides.map((o) => [o.id, o.status]));
  const customerStatusById = new Map(customerOverrides.map((o) => [o.id, o.status]));

  const activeBaseWarehouseIds = dataset.warehouses
    .map((w) => w.id)
    .filter((id) => warehouseStatusById.get(id) !== "inactive");
  const activeAddedWarehouseIds = addedWarehouses
    .filter((w) => w.status !== "inactive")
    .map((w) => w.id);
  const activeWarehouseIds = [...activeBaseWarehouseIds, ...activeAddedWarehouseIds];

  const activeBaseCustomerIds = dataset.customers
    .map((c) => c.id)
    .filter((id) => customerStatusById.get(id) !== "excluded");
  const activeAddedCustomerIds = filterActiveAddedCustomers(
    addedCustomers,
    dataset.supportsAddedCustomerExclusion,
  ).map((c) => c.id);
  const activeCustomerIds = [...activeBaseCustomerIds, ...activeAddedCustomerIds];

  return { activeWarehouseIds, activeCustomerIds };
}

export function precheckPMedianInputs(
  inputs: PMedianInputs,
  dataset: PrecheckDataset = DEFAULT_DATASET,
): PrecheckResult {
  const errors: PrecheckError[] = [];

  const baseWarehouseIds = new Set(dataset.warehouses.map((w) => w.id));
  const baseCustomerIds = new Set(dataset.customers.map((c) => c.id));

  const addedWarehouses = inputs.addedWarehouses ?? [];
  const addedCustomers = inputs.addedCustomers ?? [];
  const distanceOverrides = inputs.distanceOverrides ?? [];
  const warehouseOverrides = inputs.warehouseOverrides ?? [];
  const customerOverrides = inputs.customerOverrides ?? [];

  // --- (b) ID collision -----------------------------------------------
  const addedWarehouseIds = new Set<string>();
  for (const w of addedWarehouses) {
    if (baseWarehouseIds.has(w.id)) {
      errors.push({
        code: "id_collision",
        message: `Added warehouse id '${w.id}' collides with an existing base-dataset warehouse id`,
      });
    } else if (addedWarehouseIds.has(w.id)) {
      errors.push({
        code: "id_collision",
        message: `Added warehouse id '${w.id}' is duplicated across addedWarehouses`,
      });
    }
    addedWarehouseIds.add(w.id);
  }

  const addedCustomerIds = new Set<string>();
  for (const c of addedCustomers) {
    if (baseCustomerIds.has(c.id)) {
      errors.push({
        code: "id_collision",
        message: `Added customer id '${c.id}' collides with an existing base-dataset customer id`,
      });
    } else if (addedCustomerIds.has(c.id)) {
      errors.push({
        code: "id_collision",
        message: `Added customer id '${c.id}' is duplicated across addedCustomers`,
      });
    }
    addedCustomerIds.add(c.id);
  }

  // --- (c) reference integrity -----------------------------------------
  // Strict per-role sets: fromId must resolve as a warehouse id, toId must
  // resolve as a customer id - never "whichever role happens to contain
  // it" (that would silently accept a backwards pair). Built via the shared
  // helper above (identical result to the inline union this replaced: base
  // ids + every added id, collisions included - collisions are already
  // reported by the id_collision loop, not silently dropped here).
  const { warehouseIdSpace, customerIdSpace } = buildPMedianIdSpaces(inputs, dataset);

  for (const o of distanceOverrides) {
    if (!warehouseIdSpace.has(o.fromId)) {
      errors.push({
        code: "reference_integrity",
        message: `distanceOverrides fromId '${o.fromId}' does not reference a known warehouse (base dataset or this scenario's added warehouses)`,
      });
    }
    if (!customerIdSpace.has(o.toId)) {
      errors.push({
        code: "reference_integrity",
        message: `distanceOverrides toId '${o.toId}' does not reference a known customer (base dataset or this scenario's added customers)`,
      });
    }
  }

  // --- (a) completeness --------------------------------------------------
  // "Active" per the brief: for base entities, not excluded/inactive per
  // this scenario's overrides; for added entities, present in
  // addedWarehouses/addedCustomers, with an added customer's own `status`
  // additionally respected when this model's manifest capability
  // supportsAddedCustomerExclusion is true (Bundle 2.2, B2.2-T1 — p-median-us
  // yes, p-median-brazil no, despite sharing this exact function). Computed
  // via the shared helper above (identical result to the inline block this
  // replaced) so B4.3's export stub-generator reuses the same "active"
  // definition instead of reimplementing it.
  const { activeWarehouseIds, activeCustomerIds } = buildActivePMedianIds(inputs, dataset);
  // Same gated "active" rule as buildActivePMedianIds above — needed
  // separately below for the "vice versa" required set. Must stay
  // consistent with activeCustomerIds' own added-customer filtering, or an
  // excluded added customer would be dropped from activeCustomerIds but
  // still demanded (as a "vice versa" requirement) here.
  const activeAddedCustomerIds = filterActiveAddedCustomers(
    addedCustomers,
    dataset.supportsAddedCustomerExclusion,
  ).map((c) => c.id);

  const overrideKeys = new Set(distanceOverrides.map((o) => o.fromId + "|" + o.toId));

  // A pair needs an explicit override iff at least one side is "added" -
  // base<->base pairs are guaranteed covered by the base dataset's own
  // distance matrix (an invariant of the dataset itself, not something
  // this service re-verifies). For each active warehouse, the set of
  // customers it's REQUIRED to have an override for is: every active
  // customer, if the warehouse itself is added; otherwise just the active
  // ADDED customers (the "vice versa" direction - a base warehouse still
  // needs a new route to reach a brand-new customer).
  for (const whId of activeWarehouseIds) {
    const isAddedWarehouse = addedWarehouseIds.has(whId);
    const required = isAddedWarehouse ? activeCustomerIds : activeAddedCustomerIds;
    const missing = required.filter((custId) => !overrideKeys.has(whId + "|" + custId));
    if (missing.length > 0) {
      errors.push({
        code: "completeness",
        message: `${whId} missing distances to ${missing.length} customer${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

// SCN v0.3 Phase B, task B6.2 — two-echelon-gold-au's base dataset, shaped
// for THIS model's own three-entity-type precheck (mine/refinery/customer,
// not the two-role PrecheckDataset shape every other model above uses —
// this model has a genuinely third role, the fixed mine, that the two-role
// shape has no field for). Exported so routes/scenarios.ts's
// runNetworkEditsPrecheck can pass it to precheckTwoEchelonInputs.
export interface TwoEchelonPrecheckDataset {
  mines: readonly PrecheckDatasetEntity[];
  refineries: readonly PrecheckDatasetEntity[];
  customers: readonly PrecheckDatasetEntity[];
  // Bundle 2.2 (B2.2-T1, A3 backend) — see PrecheckDataset's own field of
  // the same name above for the full rationale. two-echelon-gold-au's
  // manifest sets this true.
  supportsAddedCustomerExclusion?: boolean;
}

export const TWO_ECHELON_DATASET: TwoEchelonPrecheckDataset = {
  mines: GOLD_MINES,
  refineries: GOLD_REFINERIES,
  customers: GOLD_CUSTOMERS,
  supportsAddedCustomerExclusion:
    getManifest("two-echelon-gold-au")?.capabilities.supportsAddedCustomerExclusion ?? false,
};

/**
 * SCN v0.3 Phase B, task B6.2 — the two-echelon-gold-au analogue of
 * buildPMedianIdSpaces/buildTransportIdSpaces above: base mine/refinery/
 * customer ids + this scenario's added refineries/customers (no
 * addedMines — the mine is fixed, never overridable). Extracted from the
 * start (not inlined and extracted later), mirroring buildTransportIdSpaces'
 * own precedent — a future import.ts entity for this model's leg-distance
 * grid reuses this exact id-space rule rather than recomputing it a
 * possibly-divergent way.
 */
export function buildTwoEchelonIdSpaces(
  addedEntities: {
    addedRefineries?: readonly PrecheckDatasetEntity[];
    addedCustomers?: readonly PrecheckDatasetEntity[];
  },
  dataset: TwoEchelonPrecheckDataset = TWO_ECHELON_DATASET,
): { mineIdSpace: Set<string>; refineryIdSpace: Set<string>; customerIdSpace: Set<string> } {
  const mineIdSpace = new Set(dataset.mines.map((m) => m.id));
  const refineryIdSpace = new Set(dataset.refineries.map((r) => r.id));
  for (const r of addedEntities.addedRefineries ?? []) refineryIdSpace.add(r.id);
  const customerIdSpace = new Set(dataset.customers.map((c) => c.id));
  for (const c of addedEntities.addedCustomers ?? []) customerIdSpace.add(c.id);
  return { mineIdSpace, refineryIdSpace, customerIdSpace };
}

/**
 * SCN v0.3 Phase B, task B6.2 — the two-echelon-gold-au analogue of
 * buildActivePMedianIds above: base refineries not inactive per
 * refineryOverrides, plus added refineries not inactive per their own
 * status; base customers not excluded per customerOverrides, plus every
 * added customer (addedCustomerSchema has no status field, same precedent
 * as p-median's own added customers — every added customer counts as
 * active). Extracted so precheckTwoEchelonInputs' own completeness check
 * AND templates.ts's B6.2 leg-distance stub generator (a later part of this
 * task) share the exact same "active" definition, mirroring
 * buildActivePMedianIds' own reuse across precheck.ts and templates.ts.
 */
export function buildActiveTwoEchelonIds(
  inputs: {
    addedRefineries?: readonly (PrecheckDatasetEntity & { status?: string })[];
    addedCustomers?: readonly (PrecheckDatasetEntity & { status?: string })[];
    refineryOverrides?: readonly { id: string; status?: string }[];
    customerOverrides?: readonly { id: string; status?: string }[];
  },
  dataset: TwoEchelonPrecheckDataset = TWO_ECHELON_DATASET,
): { activeRefineryIds: string[]; activeCustomerIds: string[] } {
  const refineryOverrides = inputs.refineryOverrides ?? [];
  const customerOverrides = inputs.customerOverrides ?? [];
  const addedRefineries = inputs.addedRefineries ?? [];
  const addedCustomers = inputs.addedCustomers ?? [];

  const refineryStatusById = new Map(refineryOverrides.map((o) => [o.id, o.status]));
  const activeBaseRefineryIds = dataset.refineries
    .map((r) => r.id)
    .filter((id) => refineryStatusById.get(id) !== "inactive");
  const activeAddedRefineryIds = addedRefineries
    .filter((r) => r.status !== "inactive")
    .map((r) => r.id);
  const activeRefineryIds = [...activeBaseRefineryIds, ...activeAddedRefineryIds];

  const customerStatusById = new Map(customerOverrides.map((o) => [o.id, o.status]));
  const activeBaseCustomerIds = dataset.customers
    .map((c) => c.id)
    .filter((id) => customerStatusById.get(id) !== "excluded");
  const activeAddedCustomerIds = filterActiveAddedCustomers(
    addedCustomers,
    dataset.supportsAddedCustomerExclusion,
  ).map((c) => c.id);
  const activeCustomerIds = [...activeBaseCustomerIds, ...activeAddedCustomerIds];

  return { activeRefineryIds, activeCustomerIds };
}

/**
 * SCN v0.3 Phase B, task B6.2 — semantic precheck for two-echelon-gold-au
 * scenario-local network edits (addedRefineries/addedCustomers/
 * distanceOverrides, twoEchelon.ts's B6.2 schema). Own function, NOT a call
 * into precheckPMedianInputs/precheckTransportInputs: this model has a
 * genuinely different shape from both — THREE entity types (mine/refinery/
 * customer, not two) and TWO legs sharing one flat distanceOverrides array,
 * where a pair's leg is resolved by which id-space each side belongs to
 * (mirrors merge_inputs.py's build_merged_two_echelon_dataset exactly, not
 * re-derived differently here).
 *
 * Same three checks, same codes, same "IDs only, never city names"
 * discipline:
 *   (a) completeness        - every active added refinery needs a distance
 *                              from the (fixed) mine AND to every active
 *                              customer; every active refinery (base or
 *                              added) needs a distance to every active
 *                              added customer (the "vice versa" direction,
 *                              refinery role = warehouse role in the other
 *                              models' precedent).
 *   (b) id collision         - every added refinery/customer's id is unique
 *                              against the base dataset (refineries,
 *                              customers, AND the mine — a refinery/mine id
 *                              collision would make merge_inputs.py's own
 *                              id-space membership check ambiguous) and
 *                              every other added entity in the same
 *                              scenario.
 *   (c) reference integrity  - every distanceOverrides pair must resolve as
 *                              EITHER a mine->refinery leg OR a refinery->
 *                              customer leg (base dataset or this
 *                              scenario's added refineries/customers) -
 *                              strict role checking, matching merge_inputs.
 *                              py's build_merged_two_echelon_dataset (a
 *                              backwards or leg-skipping pair is rejected
 *                              even if both ids are individually valid).
 *
 * Purely a read/validate operation - never writes to the DB, never mutates
 * `inputs`.
 */
export function precheckTwoEchelonInputs(
  inputs: TwoEchelonInputs,
  dataset: TwoEchelonPrecheckDataset = TWO_ECHELON_DATASET,
): PrecheckResult {
  const errors: PrecheckError[] = [];

  const baseMineIds = new Set(dataset.mines.map((m) => m.id));
  const baseRefineryIds = new Set(dataset.refineries.map((r) => r.id));
  const baseCustomerIds = new Set(dataset.customers.map((c) => c.id));

  const addedRefineries = inputs.addedRefineries ?? [];
  const addedCustomers = inputs.addedCustomers ?? [];
  const distanceOverrides = inputs.distanceOverrides ?? [];

  // --- (b) ID collision -----------------------------------------------
  const addedRefineryIds = new Set<string>();
  for (const r of addedRefineries) {
    if (baseRefineryIds.has(r.id)) {
      errors.push({
        code: "id_collision",
        message: `Added refinery id '${r.id}' collides with an existing base-dataset refinery id`,
      });
    } else if (baseMineIds.has(r.id)) {
      errors.push({
        code: "id_collision",
        message: `Added refinery id '${r.id}' collides with the mine id`,
      });
    } else if (addedRefineryIds.has(r.id)) {
      errors.push({
        code: "id_collision",
        message: `Added refinery id '${r.id}' is duplicated across addedRefineries`,
      });
    }
    addedRefineryIds.add(r.id);
  }

  const addedCustomerIds = new Set<string>();
  for (const c of addedCustomers) {
    if (baseCustomerIds.has(c.id)) {
      errors.push({
        code: "id_collision",
        message: `Added customer id '${c.id}' collides with an existing base-dataset customer id`,
      });
    } else if (addedCustomerIds.has(c.id)) {
      errors.push({
        code: "id_collision",
        message: `Added customer id '${c.id}' is duplicated across addedCustomers`,
      });
    }
    addedCustomerIds.add(c.id);
  }

  // --- (c) reference integrity -----------------------------------------
  // Built via the shared helper above — every pair must cleanly resolve as
  // ONE of the two adjacent-leg shapes, never "whichever role happens to
  // contain it" (mirrors merge_inputs.py's build_merged_two_echelon_dataset
  // exactly).
  const { mineIdSpace, refineryIdSpace, customerIdSpace } = buildTwoEchelonIdSpaces(inputs, dataset);
  for (const o of distanceOverrides) {
    const isMineToRefinery = mineIdSpace.has(o.fromId) && refineryIdSpace.has(o.toId);
    const isRefineryToCustomer = refineryIdSpace.has(o.fromId) && customerIdSpace.has(o.toId);
    if (!isMineToRefinery && !isRefineryToCustomer) {
      errors.push({
        code: "reference_integrity",
        message: `distanceOverrides pair (fromId '${o.fromId}', toId '${o.toId}') does not resolve as a mine->refinery leg or a refinery->customer leg (base dataset or this scenario's added refineries/customers)`,
      });
    }
  }

  // --- (a) completeness --------------------------------------------------
  // "Active" per the same rule precheckPMedianInputs/precheckTransportInputs
  // already establish: base refineries not inactive per refineryOverrides,
  // plus added refineries not inactive per their own status; base customers
  // not excluded per customerOverrides, plus every added customer, with an
  // added customer's own `status` additionally respected when this model's
  // manifest capability supportsAddedCustomerExclusion is true (Bundle 2.2,
  // B2.2-T1 — two-echelon-gold-au is true).
  const { activeRefineryIds, activeCustomerIds } = buildActiveTwoEchelonIds(inputs, dataset);
  // Same gated "active" rule as buildActiveTwoEchelonIds above — needed
  // separately below for the "vice versa" required set. Must stay
  // consistent with activeCustomerIds' own added-customer filtering, same
  // reasoning as precheckPMedianInputs' own local duplicate above.
  const activeAddedCustomerIds = filterActiveAddedCustomers(
    addedCustomers,
    dataset.supportsAddedCustomerExclusion,
  ).map((c) => c.id);

  const overrideKeys = new Set(distanceOverrides.map((o) => o.fromId + "|" + o.toId));

  for (const refId of activeRefineryIds) {
    const isAddedRefinery = addedRefineryIds.has(refId);

    // refinery -> customer leg: base<->base pairs are guaranteed covered by
    // the base dataset's own distance matrix (an invariant of the dataset,
    // not re-verified here) — a pair needs an explicit override iff at
    // least one side is "added" (mirrors precheckPMedianInputs' own
    // warehouse<->customer completeness rule exactly, refinery role =
    // warehouse role).
    const requiredCustomers = isAddedRefinery ? activeCustomerIds : activeAddedCustomerIds;
    const missingCustomers = requiredCustomers.filter((custId) => !overrideKeys.has(refId + "|" + custId));
    if (missingCustomers.length > 0) {
      errors.push({
        code: "completeness",
        message: `${refId} missing distances to ${missingCustomers.length} customer${missingCustomers.length === 1 ? "" : "s"}: ${missingCustomers.join(", ")}`,
      });
    }

    // mine -> refinery leg: only an ADDED refinery needs this at all — a
    // base refinery already has a base-dataset distance to the (single)
    // fixed mine, same "base<->base already covered" invariant as above.
    if (isAddedRefinery) {
      const missingMines = [...mineIdSpace].filter((mineId) => !overrideKeys.has(mineId + "|" + refId));
      if (missingMines.length > 0) {
        errors.push({
          code: "completeness",
          message: `${refId} missing distances from ${missingMines.length} mine${missingMines.length === 1 ? "" : "s"}: ${missingMines.join(", ")}`,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * SCN v0.3 Phase B, task B6.1 — semantic precheck for transport-coal
 * scenario-local network edits (addedMines/addedStations/
 * laneCostOverrides, transportLp.ts's B6.1 schema). Own function, NOT a
 * call into precheckPMedianInputs: TransportLpInputs has no
 * warehouseOverrides/customerOverrides status arrays at all (mines/
 * stations have no forced-open/inactive/excluded concept anywhere in this
 * LP — verified against solve_transport and mines.json/stations.json, same
 * finding merge_inputs.py's build_merged_transport_dataset already made),
 * so "active" here trivially means every base entity PLUS every added
 * entity, with no status filtering step — structurally simpler than
 * precheckPMedianInputs, not just a renamed copy.
 *
 * Same three checks, same codes, same "IDs only, never city names"
 * discipline:
 *   (a) completeness        - every active added mine has a lane cost to
 *                              every station, and every mine has a lane
 *                              cost to every active added station (the
 *                              "vice versa" direction).
 *   (b) id collision         - every added entity's id is unique against
 *                              both the base dataset and every other added
 *                              entity in the same scenario.
 *   (c) reference integrity  - every laneCostOverrides pair's fromId
 *                              resolves as a real mine (base or added) and
 *                              toId resolves as a real station (base or
 *                              added) - strict role checking, matching
 *                              merge_inputs.py's build_merged_transport_
 *                              dataset (a backwards pair is rejected even
 *                              if the id is valid in the other role).
 *
 * Purely a read/validate operation - never writes to the DB, never mutates
 * `inputs`.
 */
/**
 * Task 30 (B6.1 stage 4) — the transport-coal analogue of
 * buildPMedianIdSpaces above: base mine/station ids + this scenario's added
 * mines/stations. Extracted (not left inline inside precheckTransportInputs,
 * where it originally lived — see the prior stage's report follow-up #2) so
 * `import.ts`'s new `laneCosts` composite-key entity and mines/stations
 * add-mode logic have one shared source of truth for this id-space set,
 * instead of recomputing it a third, possibly-divergent way. Parameter is a
 * minimal structural shape (not `TransportLpInputs` itself), mirroring
 * buildPMedianIdSpaces's own reasoning — callers that only have `{id}` refs
 * can use it too.
 */
export function buildTransportIdSpaces(
  addedEntities: {
    addedMines?: readonly PrecheckDatasetEntity[];
    addedStations?: readonly PrecheckDatasetEntity[];
  },
  dataset: PrecheckDataset = TRANSPORT_DATASET,
): { mineIdSpace: Set<string>; stationIdSpace: Set<string> } {
  const mineIdSpace = new Set(dataset.warehouses.map((m) => m.id));
  for (const m of addedEntities.addedMines ?? []) mineIdSpace.add(m.id);
  const stationIdSpace = new Set(dataset.customers.map((s) => s.id));
  for (const s of addedEntities.addedStations ?? []) stationIdSpace.add(s.id);
  return { mineIdSpace, stationIdSpace };
}

export function precheckTransportInputs(
  inputs: TransportLpInputs,
  dataset: PrecheckDataset = TRANSPORT_DATASET,
): PrecheckResult {
  const errors: PrecheckError[] = [];

  const baseMineIds = new Set(dataset.warehouses.map((m) => m.id));
  const baseStationIds = new Set(dataset.customers.map((s) => s.id));

  const addedMines = inputs.addedMines ?? [];
  const addedStations = inputs.addedStations ?? [];
  const laneCostOverrides = inputs.laneCostOverrides ?? [];

  // --- (b) ID collision -----------------------------------------------
  const addedMineIds = new Set<string>();
  for (const m of addedMines) {
    if (baseMineIds.has(m.id)) {
      errors.push({
        code: "id_collision",
        message: `Added mine id '${m.id}' collides with an existing base-dataset mine id`,
      });
    } else if (addedMineIds.has(m.id)) {
      errors.push({
        code: "id_collision",
        message: `Added mine id '${m.id}' is duplicated across addedMines`,
      });
    }
    addedMineIds.add(m.id);
  }

  const addedStationIds = new Set<string>();
  for (const s of addedStations) {
    if (baseStationIds.has(s.id)) {
      errors.push({
        code: "id_collision",
        message: `Added station id '${s.id}' collides with an existing base-dataset station id`,
      });
    } else if (addedStationIds.has(s.id)) {
      errors.push({
        code: "id_collision",
        message: `Added station id '${s.id}' is duplicated across addedStations`,
      });
    }
    addedStationIds.add(s.id);
  }

  // --- (c) reference integrity -----------------------------------------
  // Built via the shared helper above (identical result to the inline
  // `mineIdSpace`/`stationIdSpace` construction this replaced) — see the
  // helper's own doc comment.
  const { mineIdSpace, stationIdSpace } = buildTransportIdSpaces(inputs, dataset);

  for (const o of laneCostOverrides) {
    if (!mineIdSpace.has(o.fromId)) {
      errors.push({
        code: "reference_integrity",
        message: `laneCostOverrides fromId '${o.fromId}' does not reference a known mine (base dataset or this scenario's added mines)`,
      });
    }
    if (!stationIdSpace.has(o.toId)) {
      errors.push({
        code: "reference_integrity",
        message: `laneCostOverrides toId '${o.toId}' does not reference a known station (base dataset or this scenario's added stations)`,
      });
    }
  }

  // --- (a) completeness --------------------------------------------------
  // No status filtering at all (unlike precheckPMedianInputs) — every base
  // + added mine/station is unconditionally "active" here.
  const activeMineIds = [...baseMineIds, ...addedMines.map((m) => m.id)];
  const activeStationIds = [...baseStationIds, ...addedStations.map((s) => s.id)];
  const activeAddedStationIds = addedStations.map((s) => s.id);

  const overrideKeys = new Set(laneCostOverrides.map((o) => o.fromId + "|" + o.toId));

  // A pair needs an explicit override iff at least one side is "added" -
  // base<->base pairs are guaranteed covered by the base dataset's own
  // cost matrix. For each mine, the set of stations it's REQUIRED to have
  // an override for is: every station, if the mine itself is added;
  // otherwise just the added stations (the "vice versa" direction).
  for (const mineId of activeMineIds) {
    const isAddedMine = addedMineIds.has(mineId);
    const required = isAddedMine ? activeStationIds : activeAddedStationIds;
    const missing = required.filter((stId) => !overrideKeys.has(mineId + "|" + stId));
    if (missing.length > 0) {
      errors.push({
        code: "completeness",
        message: `${mineId} missing lane costs to ${missing.length} station${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// jade-T6 — semantic precheck for two-echelon-jade-us (Chapter 9, JADE
// Investment Decision: plant -> warehouse -> customer, multi-product,
// single-source). Own function, NOT a call into any of the above: this
// model combines FOUR things no prior precheck function handles together —
//   - a THIRD addable entity type (addedPlants), unlike two-echelon-gold-au's
//     fixed single mine (never addable) — so plant<->warehouse completeness
//     needs the SAME bidirectional "vice versa" treatment as p-median's own
//     warehouse<->customer completeness, not the one-directional
//     mine->refinery rule two-echelon-gold-au could get away with (its mine
//     never needs a distance TO it, only added refineries need one FROM it).
//   - a PRODUCTS axis: customerOverrides/addedCustomers carry per-product
//     demand keyed by canonical product id, so a demand key that isn't one
//     of the known product ids is its own reference-integrity failure mode
//     no other model has.
//   - an explicit `leg` field on distanceOverrides, checked against the
//     ACTUAL id-space membership of fromId/toId as defense in depth (per
//     jadeInputs.ts's own file header), rather than two-echelon-gold-au's
//     purely id-space-inferred leg.
//   - two genuinely new failure classes: p vs. forced-open/active warehouse
//     COUNTS, and per-product ENABLED PLANT CAPACITY vs. effective demand
//     (this model's supply side is a plant x product capability matrix, not
//     a per-warehouse capacity scalar) — see the new "p_range"/"capacity"
//     codes above.
//
//   (a) id collision          - GLOBAL across all three added entity types:
//                                 every added plant/warehouse/customer id is
//                                 checked against ALL THREE base namespaces
//                                 (not just its own role) and every OTHER
//                                 added entity of ANY type in this scenario
//                                 (not just same-type) — the plan's own
//                                 interface calls this out explicitly as
//                                 "global id collisions across added
//                                 entities", broader than every other
//                                 model's same-role-only check above.
//   (b) known product ids    - every customerOverrides[].demands /
//                                 addedCustomers[].demands key must be one
//                                 of the dataset's own canonical product ids
//                                 (never a hardcoded literal duplicated from
//                                 jadeInputs.ts's own closed product-id set).
//   (c) reference integrity  - every distanceOverrides pair's declared
//                                 `leg` must match the ACTUAL role of its
//                                 fromId/toId: plant_to_warehouse needs a
//                                 plant fromId + a warehouse toId;
//                                 warehouse_to_customer needs a warehouse
//                                 fromId + a customer toId (base dataset or
//                                 this scenario's added entities) — a
//                                 mismatched leg is rejected even if both
//                                 ids are individually valid in some role.
//   (d) completeness          - added-entity distance completeness on BOTH
//                                 legs, applied symmetrically around the
//                                 shared warehouse role: for every active
//                                 warehouse, if it's added it needs a
//                                 distance from every active plant AND to
//                                 every active customer; if it's base, it
//                                 only needs the "vice versa" distances
//                                 to/from this scenario's active ADDED
//                                 plants/customers (base<->base pairs are
//                                 already covered by the base dataset's own
//                                 distances.json).
//   (e) p range               - forced_open count <= p <= active warehouse
//                                 count — no other model's precheck
//                                 validates p against counts at all.
//   (f) plant capacity        - for every product with positive effective
//                                 demand (summed over active customers,
//                                 overrides applied), the sum of ENABLED
//                                 plant-product capacity (base cells
//                                 overridden by plantProductCapability,
//                                 added plants defaulting every cell to
//                                 disabled/0) must be >= that demand —
//                                 otherwise the LP is infeasible by
//                                 construction and CBC would just prove
//                                 infeasibility the expensive way.
//
// Purely a read/validate operation - never writes to the DB, never mutates
// `inputs`.

export interface JadePrecheckDataset {
  plants: readonly PrecheckDatasetEntity[];
  warehouses: readonly PrecheckDatasetEntity[];
  customers: readonly (PrecheckDatasetEntity & { demands?: Record<string, number> })[];
  productIds: readonly string[];
  // Optional display names for a friendlier capacity-error message; falls
  // back to the bare canonical id when absent (e.g. a test's fake dataset).
  productNames?: Record<string, string>;
  capabilityCells: readonly { plantId: string; productId: string; capacity: number }[];
  // See PrecheckDataset's own field of the same name above for the full
  // rationale (Bundle 2.2, B2.2-T1). two-echelon-jade-us's manifest sets
  // this true.
  supportsAddedCustomerExclusion?: boolean;
}

export const JADE_DATASET: JadePrecheckDataset = {
  plants: JADE_PLANTS,
  warehouses: JADE_WAREHOUSES,
  customers: JADE_CUSTOMERS,
  productIds: JADE_PRODUCTS.map((p) => p.id),
  productNames: Object.fromEntries(JADE_PRODUCTS.map((p) => [p.id, p.name])),
  capabilityCells: JADE_PLANT_PRODUCT_CAPABILITIES,
  supportsAddedCustomerExclusion:
    getManifest("two-echelon-jade-us")?.capabilities.supportsAddedCustomerExclusion ?? false,
};

/**
 * jade-T6 — the JADE analogue of buildPMedianIdSpaces/buildTwoEchelonIdSpaces
 * above: base plant/warehouse/customer ids + this scenario's added
 * plants/warehouses/customers. Exported so a future import.ts entity for
 * this model's leg-distance grid (T7) reuses this exact id-space rule
 * rather than recomputing it a possibly-divergent way.
 */
export function buildJadeIdSpaces(
  addedEntities: {
    addedPlants?: readonly PrecheckDatasetEntity[];
    addedWarehouses?: readonly PrecheckDatasetEntity[];
    addedCustomers?: readonly PrecheckDatasetEntity[];
  },
  dataset: JadePrecheckDataset = JADE_DATASET,
): { plantIdSpace: Set<string>; warehouseIdSpace: Set<string>; customerIdSpace: Set<string> } {
  const plantIdSpace = new Set(dataset.plants.map((p) => p.id));
  for (const p of addedEntities.addedPlants ?? []) plantIdSpace.add(p.id);
  const warehouseIdSpace = new Set(dataset.warehouses.map((w) => w.id));
  for (const w of addedEntities.addedWarehouses ?? []) warehouseIdSpace.add(w.id);
  const customerIdSpace = new Set(dataset.customers.map((c) => c.id));
  for (const c of addedEntities.addedCustomers ?? []) customerIdSpace.add(c.id);
  return { plantIdSpace, warehouseIdSpace, customerIdSpace };
}

/**
 * jade-T6 — the JADE analogue of buildActivePMedianIds/buildActiveTwoEchelonIds
 * above. Plants have NO force-open/inactive concept anywhere in this model
 * (solve_jade has no facility variable for plants — only warehouses get
 * one, confirmed directly against solve.py/jadeInputs.ts's own file-header
 * comment), so every base + added plant is unconditionally "active" — a
 * genuinely different rule from the warehouse/customer "active" rules this
 * function also computes (which DO respect status/exclusion).
 */
export function buildActiveJadeIds(
  inputs: {
    addedPlants?: readonly PrecheckDatasetEntity[];
    addedWarehouses?: readonly (PrecheckDatasetEntity & { status?: string })[];
    addedCustomers?: readonly (PrecheckDatasetEntity & { status?: string })[];
    warehouseOverrides?: readonly { id: string; status?: string }[];
    customerOverrides?: readonly { id: string; status?: string }[];
  },
  dataset: JadePrecheckDataset = JADE_DATASET,
): { activePlantIds: string[]; activeWarehouseIds: string[]; activeCustomerIds: string[] } {
  const addedPlants = inputs.addedPlants ?? [];
  const addedWarehouses = inputs.addedWarehouses ?? [];
  const addedCustomers = inputs.addedCustomers ?? [];
  const warehouseOverrides = inputs.warehouseOverrides ?? [];
  const customerOverrides = inputs.customerOverrides ?? [];

  const activePlantIds = [...dataset.plants.map((p) => p.id), ...addedPlants.map((p) => p.id)];

  const warehouseStatusById = new Map(warehouseOverrides.map((o) => [o.id, o.status]));
  const activeBaseWarehouseIds = dataset.warehouses
    .map((w) => w.id)
    .filter((id) => warehouseStatusById.get(id) !== "inactive");
  const activeAddedWarehouseIds = addedWarehouses.filter((w) => w.status !== "inactive").map((w) => w.id);
  const activeWarehouseIds = [...activeBaseWarehouseIds, ...activeAddedWarehouseIds];

  const customerStatusById = new Map(customerOverrides.map((o) => [o.id, o.status]));
  const activeBaseCustomerIds = dataset.customers
    .map((c) => c.id)
    .filter((id) => customerStatusById.get(id) !== "excluded");
  const activeAddedCustomerIds = filterActiveAddedCustomers(
    addedCustomers,
    dataset.supportsAddedCustomerExclusion,
  ).map((c) => c.id);
  const activeCustomerIds = [...activeBaseCustomerIds, ...activeAddedCustomerIds];

  return { activePlantIds, activeWarehouseIds, activeCustomerIds };
}

export function precheckJadeInputs(
  inputs: JadeInputs,
  dataset: JadePrecheckDataset = JADE_DATASET,
): PrecheckResult {
  const errors: PrecheckError[] = [];

  const addedPlants = inputs.addedPlants ?? [];
  const addedWarehouses = inputs.addedWarehouses ?? [];
  const addedCustomers = inputs.addedCustomers ?? [];
  const warehouseOverrides = inputs.warehouseOverrides ?? [];
  const customerOverrides = inputs.customerOverrides ?? [];
  const distanceOverrides = inputs.distanceOverrides ?? [];
  const plantProductCapability = inputs.plantProductCapability ?? [];

  // --- (a) ID collision, GLOBAL across all three added entity types --------
  const baseIds = new Set<string>([
    ...dataset.plants.map((p) => p.id),
    ...dataset.warehouses.map((w) => w.id),
    ...dataset.customers.map((c) => c.id),
  ]);
  const seenAddedIds = new Map<string, "plant" | "warehouse" | "customer">();
  function checkGlobalIdCollision(id: string, role: "plant" | "warehouse" | "customer") {
    if (baseIds.has(id)) {
      errors.push({
        code: "id_collision",
        message: `Added ${role} id '${id}' collides with an existing base-dataset id`,
      });
    } else if (seenAddedIds.has(id)) {
      errors.push({
        code: "id_collision",
        message: `Added ${role} id '${id}' is duplicated across added entities (already used by an added ${seenAddedIds.get(id)})`,
      });
    }
    seenAddedIds.set(id, role);
  }
  for (const p of addedPlants) checkGlobalIdCollision(p.id, "plant");
  for (const w of addedWarehouses) checkGlobalIdCollision(w.id, "warehouse");
  for (const c of addedCustomers) checkGlobalIdCollision(c.id, "customer");

  // --- (b) known product ids -------------------------------------------
  const knownProductIds = new Set(dataset.productIds);
  for (const o of customerOverrides) {
    for (const productId of Object.keys(o.demands ?? {})) {
      if (!knownProductIds.has(productId)) {
        errors.push({
          code: "reference_integrity",
          message: `customerOverrides for '${o.id}' has a demand entry for unknown product id '${productId}'`,
        });
      }
    }
  }
  for (const c of addedCustomers) {
    for (const productId of Object.keys(c.demands ?? {})) {
      if (!knownProductIds.has(productId)) {
        errors.push({
          code: "reference_integrity",
          message: `addedCustomers '${c.id}' has a demand entry for unknown product id '${productId}'`,
        });
      }
    }
  }

  // --- (c) reference integrity: leg vs. actual id-space membership --------
  const { plantIdSpace, warehouseIdSpace, customerIdSpace } = buildJadeIdSpaces(
    { addedPlants, addedWarehouses, addedCustomers },
    dataset,
  );
  for (const o of distanceOverrides) {
    if (o.leg === "plant_to_warehouse") {
      if (!plantIdSpace.has(o.fromId)) {
        errors.push({
          code: "reference_integrity",
          message: `distanceOverrides fromId '${o.fromId}' does not reference a known plant for leg 'plant_to_warehouse' (base dataset or this scenario's added plants)`,
        });
      }
      if (!warehouseIdSpace.has(o.toId)) {
        errors.push({
          code: "reference_integrity",
          message: `distanceOverrides toId '${o.toId}' does not reference a known warehouse for leg 'plant_to_warehouse' (base dataset or this scenario's added warehouses)`,
        });
      }
    } else {
      // o.leg === "warehouse_to_customer" — the only other Zod-enum value.
      if (!warehouseIdSpace.has(o.fromId)) {
        errors.push({
          code: "reference_integrity",
          message: `distanceOverrides fromId '${o.fromId}' does not reference a known warehouse for leg 'warehouse_to_customer' (base dataset or this scenario's added warehouses)`,
        });
      }
      if (!customerIdSpace.has(o.toId)) {
        errors.push({
          code: "reference_integrity",
          message: `distanceOverrides toId '${o.toId}' does not reference a known customer for leg 'warehouse_to_customer' (base dataset or this scenario's added customers)`,
        });
      }
    }
  }

  // --- (d) completeness: both legs, symmetric around the warehouse role ---
  const { activePlantIds, activeWarehouseIds, activeCustomerIds } = buildActiveJadeIds(
    { addedPlants, addedWarehouses, addedCustomers, warehouseOverrides, customerOverrides },
    dataset,
  );
  const addedWarehouseIds = new Set(addedWarehouses.map((w) => w.id));
  const addedPlantIdSet = new Set(addedPlants.map((p) => p.id));
  const activeAddedPlantIds = activePlantIds.filter((id) => addedPlantIdSet.has(id));
  const activeAddedCustomerIds = filterActiveAddedCustomers(
    addedCustomers,
    dataset.supportsAddedCustomerExclusion,
  ).map((c) => c.id);

  const overrideKeys = new Set(distanceOverrides.map((o) => `${o.leg}|${o.fromId}|${o.toId}`));

  for (const whId of activeWarehouseIds) {
    const isAddedWarehouse = addedWarehouseIds.has(whId);

    // plant -> warehouse leg: base<->base pairs are guaranteed covered by
    // the base dataset's own distance matrix — a pair needs an explicit
    // override iff at least one side is "added".
    const requiredPlants = isAddedWarehouse ? activePlantIds : activeAddedPlantIds;
    const missingPlants = requiredPlants.filter(
      (plantId) => !overrideKeys.has(`plant_to_warehouse|${plantId}|${whId}`),
    );
    if (missingPlants.length > 0) {
      errors.push({
        code: "completeness",
        message: `${whId} missing distances from ${missingPlants.length} plant${missingPlants.length === 1 ? "" : "s"}: ${missingPlants.join(", ")}`,
      });
    }

    // warehouse -> customer leg: same "vice versa" rule, mirroring
    // precheckPMedianInputs' own warehouse<->customer completeness exactly.
    const requiredCustomers = isAddedWarehouse ? activeCustomerIds : activeAddedCustomerIds;
    const missingCustomers = requiredCustomers.filter(
      (custId) => !overrideKeys.has(`warehouse_to_customer|${whId}|${custId}`),
    );
    if (missingCustomers.length > 0) {
      errors.push({
        code: "completeness",
        message: `${whId} missing distances to ${missingCustomers.length} customer${missingCustomers.length === 1 ? "" : "s"}: ${missingCustomers.join(", ")}`,
      });
    }
  }

  // --- (e) p range: forced_open <= p <= active warehouse count -------------
  const forcedOpenCount =
    warehouseOverrides.filter((o) => o.status === "forced_open").length +
    addedWarehouses.filter((w) => w.status === "forced_open").length;
  if (inputs.p < forcedOpenCount) {
    errors.push({
      code: "p_range",
      message: `p (${inputs.p}) is less than the number of forced-open warehouses (${forcedOpenCount})`,
    });
  }
  if (inputs.p > activeWarehouseIds.length) {
    errors.push({
      code: "p_range",
      message: `p (${inputs.p}) exceeds the number of active warehouses (${activeWarehouseIds.length})`,
    });
  }

  // --- (f) sufficient enabled plant capacity per product -------------------
  // Enabled -> the dataset's own largest observed capability-cell capacity
  // (the notebook's uncapacitated "can-make" sentinel, 210000000 in the real
  // package) — derived from the data, never a hardcoded magic number, so a
  // future dataset regeneration with a different sentinel stays correct
  // automatically. A cell not present in dataset.capabilityCells (e.g. an
  // added plant x any product) defaults to disabled/0, matching
  // build_merged_jade_dataset's own "added plant defaults every capability
  // cell to disabled" rule.
  const capacityOverrideByPair = new Map(
    plantProductCapability.map((o) => [`${o.plantId}|${o.productId}`, o.enabled]),
  );
  const baseCapacityByPair = new Map(
    dataset.capabilityCells.map((c) => [`${c.plantId}|${c.productId}`, c.capacity]),
  );
  const sentinelCapacity = dataset.capabilityCells.reduce((max, c) => Math.max(max, c.capacity), 0);

  const customerDemandsById = new Map(dataset.customers.map((c) => [c.id, c.demands ?? {}]));
  const addedCustomerById = new Map(addedCustomers.map((c) => [c.id, c]));
  const customerOverrideById = new Map(customerOverrides.map((o) => [o.id, o]));
  const activeCustomerIdSet = new Set(activeCustomerIds);

  for (const productId of dataset.productIds) {
    let totalDemand = 0;
    for (const custId of activeCustomerIdSet) {
      const added = addedCustomerById.get(custId);
      if (added) {
        // `added.demands` is typed with the 4 fixed canonical product keys
        // (jadeDemandsSchema in jadeInputs.ts), but this loop iterates
        // `dataset.productIds` (a plain `readonly string[]`, which a fake
        // test dataset could shape differently) — a generic string index
        // is intentional here, not a type-safety gap.
        totalDemand += (added.demands as Record<string, number> | undefined)?.[productId] ?? 0;
        continue;
      }
      const override = customerOverrideById.get(custId);
      const overrideDemand = override?.demands?.[productId];
      totalDemand += overrideDemand !== undefined ? overrideDemand : customerDemandsById.get(custId)?.[productId] ?? 0;
    }
    if (totalDemand <= 0) continue;

    let totalCapacity = 0;
    for (const plantId of activePlantIds) {
      const key = `${plantId}|${productId}`;
      const override = capacityOverrideByPair.get(key);
      const capacity =
        override !== undefined ? (override ? sentinelCapacity : 0) : baseCapacityByPair.get(key) ?? 0;
      totalCapacity += capacity;
    }

    if (totalCapacity < totalDemand) {
      const label = dataset.productNames?.[productId];
      const productDisplay = label ? `${productId} (${label})` : productId;
      errors.push({
        code: "capacity",
        message: `${productDisplay} has effective demand ${totalDemand} but only ${totalCapacity} enabled plant capacity`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
