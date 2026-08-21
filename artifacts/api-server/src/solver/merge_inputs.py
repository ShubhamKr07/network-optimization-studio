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
"""
from __future__ import annotations

from typing import Any


class UnresolvableIdError(ValueError):
    """Raised when a distanceOverride references an id that resolves to
    neither the base dataset nor this scenario's own added entities. Never
    silently coerced to a wrong/garbage index - B2.1's precheck service is
    the primary place this gets caught before a solve is even attempted,
    but this function must not paper over it either."""


def _resolve_id(entity_id: str, warehouse_id_to_index: dict, customer_id_to_index: dict) -> int:
    if entity_id in warehouse_id_to_index:
        return warehouse_id_to_index[entity_id]
    if entity_id in customer_id_to_index:
        return customer_id_to_index[entity_id]
    raise UnresolvableIdError(
        f"distanceOverrides references unknown id '{entity_id}' - not found in the base "
        "p-median-us dataset or in this scenario's addedWarehouses/addedCustomers"
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
        UnresolvableIdError: a distanceOverride's fromId/toId is neither in
            the base dataset nor in this scenario's own added entities.
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
        from_index = _resolve_id(override["fromId"], warehouse_id_to_index, customer_id_to_index)
        to_index = _resolve_id(override["toId"], warehouse_id_to_index, customer_id_to_index)
        distance_overrides_by_index[(from_index, to_index)] = override["distance"]

    return {
        "warehouseIdToIndex": warehouse_id_to_index,
        "customerIdToIndex": customer_id_to_index,
        "addedWarehouseIndices": added_warehouse_indices,
        "addedCustomerIndices": added_customer_indices,
        "distanceOverridesByIndex": distance_overrides_by_index,
    }
