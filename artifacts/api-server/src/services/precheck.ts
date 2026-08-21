import { WAREHOUSES, CUSTOMERS, BRAZIL_WAREHOUSES, BRAZIL_REGIONS } from "../data/dataset.js";
import { TRANSPORT_COAL_WAREHOUSES, TRANSPORT_COAL_CUSTOMERS } from "../data/transportCoalDataset.js";
import type { PMedianInputs } from "../validation/inputs/pMedian.js";
import type { TransportLpInputs } from "../validation/inputs/transportLp.js";

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

export type PrecheckErrorCode = "completeness" | "id_collision" | "reference_integrity";

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
}

// `dataset` is a parameter (defaulting to the real p-median-us base
// dataset) rather than an unconditional import of WAREHOUSES/CUSTOMERS
// inside the checks below - this task (B2.1) only ever calls it with the
// default, but B6.x's fast-follow to the other three models can reuse this
// same function against a different model's base dataset without a
// rewrite. No multi-model dispatch is built here - that's still B6.x's job.
const DEFAULT_DATASET: PrecheckDataset = { warehouses: WAREHOUSES, customers: CUSTOMERS };

// SCN v0.3 Phase B, task B6.3 — p-median-brazil's base dataset, shaped for
// this service (`{warehouses: {id}[], customers: {id}[]}`; Brazil's
// "customers" role is filled by its demand regions/states). Exported so
// routes/scenarios.ts's runNetworkEditsPrecheck can pass it as the `dataset`
// argument to precheckPMedianInputs for p-median-brazil scenarios, the same
// way it already calls the function with the (implicit default) p-median-us
// dataset. p-median-brazil shares pMedianInputsSchema/PMedianInputs with
// p-median-us (validation/inputs/pMedian.ts), so no new schema is needed —
// only a different base dataset to check added entities against.
export const BRAZIL_DATASET: PrecheckDataset = { warehouses: BRAZIL_WAREHOUSES, customers: BRAZIL_REGIONS };

// SCN v0.3 Phase B, task B6.1 — transport-coal's base dataset, shaped for
// this service (`{warehouses: {id}[], customers: {id}[]}`; transport-coal's
// "warehouses" role is filled by mines, "customers" role by stations).
// Exported so routes/scenarios.ts's runNetworkEditsPrecheck can pass it to
// precheckTransportInputs (this file's own transport-coal-specific check
// function, below — NOT precheckPMedianInputs, since TransportLpInputs has
// a structurally different shape: no warehouseOverrides/customerOverrides
// status arrays at all).
export const TRANSPORT_DATASET: PrecheckDataset = { warehouses: TRANSPORT_COAL_WAREHOUSES, customers: TRANSPORT_COAL_CUSTOMERS };

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
export function buildActivePMedianIds(
  inputs: {
    addedWarehouses?: readonly (PrecheckDatasetEntity & { status?: string })[];
    addedCustomers?: readonly PrecheckDatasetEntity[];
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
  const activeAddedCustomerIds = addedCustomers.map((c) => c.id);
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
  // addedWarehouses/addedCustomers (addedCustomers has no status field -
  // v1 has no way to add a customer and mark it excluded in the same
  // breath - so every added customer counts as active). Computed via the
  // shared helper above (identical result to the inline block this
  // replaced) so B4.3's export stub-generator reuses the same "active"
  // definition instead of reimplementing it.
  const { activeWarehouseIds, activeCustomerIds } = buildActivePMedianIds(inputs, dataset);
  // Every added customer counts as active (addedCustomers has no status
  // field) — needed separately below for the "vice versa" required set.
  const activeAddedCustomerIds = addedCustomers.map((c) => c.id);

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
