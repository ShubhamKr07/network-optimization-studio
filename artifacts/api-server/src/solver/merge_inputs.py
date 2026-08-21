"""SCN v0.3 Phase B, task B1.3 - id<->index bridge for p-median-us.

`p-median-us` is the sole index-keyed dataset among the four models (DD-2's
correction, verified directly against solve.py): `WAREHOUSES`/`CUSTOMERS`
are `{int_index: {..., "id": str, ...}}` and `DISTANCE` is
`{(int_wh_index, int_cust_index): float}`. Scenario-local network edits
(`addedWarehouses`/`addedCustomers`/`distanceOverrides`, B1.1) are ID-keyed
at the API boundary - students think in IDs, not the dataset's internal
integer indices - so this module is the one place that translates between
the two, rather than every call site doing it ad hoc.

Scope boundary: this is the bridge only. It does not load a dataset, does
not merge distance overrides into `DISTANCE`, and does not append added
entities into `WAREHOUSES`/`CUSTOMERS` - that's B3.1's job
(`load_dataset -> apply overrides -> append added entities`), which will
import `resolve_pmedian_ids_to_indices` from here rather than re-deriving
id<->index resolution itself.

B3.1 adds `build_merged_pmedian_dataset` below: the actual merge pipeline
(`apply distance overrides -> append added entities`, on top of a caller-
supplied base dataset - "load_dataset" itself stays solve.py's job, since
that's already handled by its own module-level load block). Consumed by
`solve_pmedian` in `solve.py` as a per-call, non-mutating drop-in for its
`WAREHOUSES`/`CUSTOMERS`/`DISTANCE` module globals.
"""
from __future__ import annotations

from typing import Any


class UnresolvableIdError(ValueError):
    """Raised when a distanceOverride's fromId does not resolve as a
    warehouse id, or its toId does not resolve as a customer id - whether
    because the id doesn't exist anywhere (neither the base dataset nor
    this scenario's own added entities), or because it exists but only in
    the OTHER role (e.g. a backwards override passing a customer id as
    fromId). Never silently coerced to a wrong/garbage index - B2.1's
    precheck service is the primary place this gets caught before a solve
    is even attempted, but this function must not paper over it either."""


def _resolve_as(entity_id: str, role: str, id_to_index: dict) -> int:
    """Resolve entity_id strictly within one role's id space (warehouse OR
    customer - never "whichever space happens to contain it"). Fix for a
    real review-confirmed bug: probing both maps and returning whichever
    matched let a backwards override (fromId=a customer id, toId=a
    warehouse id) silently resolve to a structurally valid-looking
    (int, int) tuple - e.g. {fromId: "C1", toId: "ALN"} produced (1, 1),
    the SAME key as the real ALN->C1 distance, silently corrupting it once
    merged into DISTANCE. distanceOverrides is a warehouse->customer pair
    by definition (it mirrors DISTANCE's own (warehouse_idx, customer_idx)
    shape), not a generic "any two ids" pair, so fromId must resolve as a
    warehouse and toId must resolve as a customer - even if the id happens
    to also be valid in the other role."""
    if entity_id in id_to_index:
        return id_to_index[entity_id]
    raise UnresolvableIdError(
        f"distanceOverrides references id '{entity_id}' that does not resolve as a {role} - "
        f"not found among {role} ids in the base p-median-us dataset or this scenario's "
        "added entities"
    )


def resolve_pmedian_ids_to_indices(
    inputs: dict[str, Any],
    warehouses: dict[int, dict],
    customers: dict[int, dict],
) -> dict[str, Any]:
    """Build the id<->index bridge for p-median-us's scenario-local network
    edits.

    Args:
        inputs: the validated `inputs` blob (or any dict exposing the same
            keys) containing `addedWarehouses`, `addedCustomers`,
            `distanceOverrides` (B1.1's schema). All three are optional -
            missing keys are treated as empty lists.
        warehouses: base dataset, `solve.py`'s `WAREHOUSES`-shaped
            `{int_index: {"id": str, ...}}`. Never mutated.
        customers: base dataset, `solve.py`'s `CUSTOMERS`-shaped
            `{int_index: {"id": str, ...}}`. Never mutated.

    Returns a dict:
        warehouseIdToIndex: id -> index, covering base warehouses AND any
            addedWarehouses (each assigned a synthetic index).
        customerIdToIndex: same, for customers.
        addedWarehouseIndices: id -> synthetic index, addedWarehouses only
            (subset of warehouseIdToIndex - lets a caller distinguish "this
            id is new" from "this id was already in the base dataset").
        addedCustomerIndices: id -> synthetic index, addedCustomers only.
        distanceOverridesByIndex: DISTANCE-shaped `{(int, int): float}`,
            each distanceOverride's (fromId, toId) resolved through the
            (base + added) reverse maps. A later step (B3.1) merges this
            over the base DISTANCE dict.

    Raises:
        UnresolvableIdError: a distanceOverride's fromId does not resolve
            as a warehouse id, or its toId does not resolve as a customer
            id (checked against the base dataset + this scenario's own
            added entities only - never against the other role, so a
            backwards override can't silently produce a coincidentally
            valid-looking index pair).
    """
    added_warehouses = inputs.get("addedWarehouses", []) or []
    added_customers = inputs.get("addedCustomers", []) or []
    distance_overrides = inputs.get("distanceOverrides", []) or []

    # Fresh reverse maps built from the base dataset - warehouses.json/
    # customers.json's real string id, nested inside each index-keyed
    # value. Copied (not aliased) so extending with added entities below
    # never mutates a caller-owned dict.
    warehouse_id_to_index = {wh["id"]: idx for idx, wh in warehouses.items()}
    customer_id_to_index = {c["id"]: idx for idx, c in customers.items()}

    # Synthetic indices: max existing + 1, +2, ... per entity type. Warehouse
    # and customer indices are independent spaces (DISTANCE's key is a
    # positional (wh_index, cust_index) tuple, not a shared namespace), so
    # each gets its own counter - only intra-type collisions matter.
    next_warehouse_index = max(warehouses.keys(), default=0) + 1
    added_warehouse_indices: dict[str, int] = {}
    for wh in added_warehouses:
        wid = wh["id"]
        added_warehouse_indices[wid] = next_warehouse_index
        warehouse_id_to_index[wid] = next_warehouse_index
        next_warehouse_index += 1

    next_customer_index = max(customers.keys(), default=0) + 1
    added_customer_indices: dict[str, int] = {}
    for c in added_customers:
        cid = c["id"]
        added_customer_indices[cid] = next_customer_index
        customer_id_to_index[cid] = next_customer_index
        next_customer_index += 1

    distance_overrides_by_index: dict[tuple[int, int], float] = {}
    for override in distance_overrides:
        # Direction is meaningful, not incidental: distanceOverrides mirrors
        # DISTANCE's own (warehouse_idx, customer_idx) key shape, so fromId
        # must resolve as a warehouse and toId must resolve as a customer -
        # each checked against its own role's map only.
        from_index = _resolve_as(override["fromId"], "warehouse", warehouse_id_to_index)
        to_index = _resolve_as(override["toId"], "customer", customer_id_to_index)
        distance_overrides_by_index[(from_index, to_index)] = override["distance"]

    return {
        "warehouseIdToIndex": warehouse_id_to_index,
        "customerIdToIndex": customer_id_to_index,
        "addedWarehouseIndices": added_warehouse_indices,
        "addedCustomerIndices": added_customer_indices,
        "distanceOverridesByIndex": distance_overrides_by_index,
    }


def build_merged_pmedian_dataset(
    inputs: dict[str, Any],
    warehouses: dict[int, dict],
    customers: dict[int, dict],
    distance: dict[tuple[int, int], float],
) -> dict[str, Any]:
    """B3.1: `load_dataset -> apply distance overrides -> append added
    entities`, producing merged WAREHOUSES-shaped, CUSTOMERS-shaped, and
    DISTANCE-shaped structures `solve_pmedian` can use as drop-in
    replacements for its module-level globals.

    Per-call, non-mutating: `warehouses`/`customers`/`distance` (the caller's
    base dataset - solve.py's own module-level WAREHOUSES/CUSTOMERS/DISTANCE
    globals) are never written to. Every scenario's `inputs` gets its own
    fresh merged copy, so concurrent solves for other scenarios never see
    one scenario's added entities or distance overrides.

    Args:
        inputs: the validated `inputs` blob (or any dict exposing the same
            keys) containing `addedWarehouses`, `addedCustomers`,
            `distanceOverrides` (B1.1's schema). All three optional, missing
            keys treated as empty lists (same contract as
            `resolve_pmedian_ids_to_indices`, which this calls internally).
        warehouses: base dataset, `solve.py`'s `WAREHOUSES`-shaped
            `{int_index: {"id": str, "city": str, "state": str, "lat":
            float, "lng": float}}`. Never mutated.
        customers: base dataset, `solve.py`'s `CUSTOMERS`-shaped
            `{int_index: {"id": str, "city": str, "state": str, "lat":
            float, "lng": float, "demand": float}}`. Never mutated.
        distance: base dataset, `solve.py`'s `DISTANCE`-shaped
            `{(int_wh_index, int_cust_index): float}`. Never mutated.

    Returns a dict:
        warehouses: `{**warehouses}` plus one entry per `addedWarehouses`
            item at its synthetic index, shaped like an existing
            `warehouses` value (`id`/`city`/`state`/`lat`/`lng` - no
            `capacity`/`status` key, matching the base shape exactly; those
            live in `addedWarehousesById` below instead, since base
            warehouses don't carry them in this dict either - they come
            from solve_pmedian's separate sparse `warehouseCapacities`/
            `warehouseStatuses` override maps).
        customers: same pattern for `addedCustomers`, shaped like an
            existing `customers` value including `demand` (added customers
            DO carry `demand` directly on this dict, unlike warehouses -
            matches B1.1's schema, where `addedCustomerSchema` has no
            separate status/capacity-style sparse-override sibling for
            demand the way warehouses do).
        distance: `{**distance, **<resolved distanceOverridesByIndex>}` -
            the override pairs simply overlay the base dict. This is also
            how an added entity gets ANY distance at all (L4: no
            auto-haversine for added entities - an override IS the
            mechanism, not a separate one).
        addedWarehousesById: `{id: <raw addedWarehouses entry>}` - lets
            `solve_pmedian` resolve an added warehouse's OWN `capacity`/
            `status` (present directly on its `addedWarehouses` record,
            per B1.1's schema) without conflating it with the sparse
            `warehouseCapacities`/`warehouseStatuses` override maps that
            apply to BASE warehouses only. Mirrors B2.1's `precheckPMedianInputs`
            precedent exactly: its own completeness check already treats an
            added warehouse's active/inactive status as coming solely from
            `addedWarehouses[].status`, never layered with
            `warehouseOverrides` - there is no design for a base-style
            override to also apply on top of an added entity's own record.
        addedCustomersById: `{id: <raw addedCustomers entry>}` - same
            reasoning for `demand`, mirroring `precheckPMedianInputs`'s own
            `activeAddedCustomerIds` (unconditionally every added customer,
            never filtered by `customerOverrides`).

    Raises:
        UnresolvableIdError: propagated from `resolve_pmedian_ids_to_indices`
            - a `distanceOverrides` entry references an id that isn't a
            known warehouse (fromId) or customer (toId), base or added.
    """
    bridge = resolve_pmedian_ids_to_indices(inputs, warehouses, customers)

    added_warehouses = inputs.get("addedWarehouses", []) or []
    added_customers = inputs.get("addedCustomers", []) or []

    merged_warehouses = dict(warehouses)
    added_warehouses_by_id: dict[str, dict] = {}
    for wh in added_warehouses:
        idx = bridge["addedWarehouseIndices"][wh["id"]]
        merged_warehouses[idx] = {
            "id": wh["id"],
            "city": wh["city"],
            "state": wh["state"],
            "lat": wh["lat"],
            "lng": wh["lng"],
        }
        added_warehouses_by_id[wh["id"]] = wh

    merged_customers = dict(customers)
    added_customers_by_id: dict[str, dict] = {}
    for c in added_customers:
        idx = bridge["addedCustomerIndices"][c["id"]]
        merged_customers[idx] = {
            "id": c["id"],
            "city": c["city"],
            "lat": c["lat"],
            "lng": c["lng"],
            "demand": c["demand"],
        }
        added_customers_by_id[c["id"]] = c

    merged_distance = {**distance, **bridge["distanceOverridesByIndex"]}

    return {
        "warehouses": merged_warehouses,
        "customers": merged_customers,
        "distance": merged_distance,
        "addedWarehousesById": added_warehouses_by_id,
        "addedCustomersById": added_customers_by_id,
    }
