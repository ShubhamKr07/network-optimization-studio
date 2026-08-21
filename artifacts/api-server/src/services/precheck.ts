import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import type { PMedianInputs } from "../validation/inputs/pMedian.js";

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
  // it" (that would silently accept a backwards pair).
  const warehouseIdSpace = new Set([...baseWarehouseIds, ...addedWarehouseIds]);
  const customerIdSpace = new Set([...baseCustomerIds, ...addedCustomerIds]);

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
  // breath - so every added customer counts as active).
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
