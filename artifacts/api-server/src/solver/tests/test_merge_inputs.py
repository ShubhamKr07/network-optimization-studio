"""B1.3: id<->index bridge for p-median-us (the sole index-keyed dataset,
DD-2's correction). Tested against the real p-median-us dataset (loaded via
solve.py's module-level WAREHOUSES/CUSTOMERS), per the plan's explicit
instruction - not synthetic fixtures.

The bridge tests above are B1.3's. The `build_merged_pmedian_dataset` tests
below are B3.1's: the full `load_dataset -> apply distance overrides ->
append added entities` pipeline that imports `resolve_pmedian_ids_to_indices`
rather than re-deriving id<->index resolution itself. These are unit/
mechanism tests for the merge helper in isolation - end-to-end golden tests
that exercise it through a real `solve_pmedian` subprocess solve live in
`test_network_edits.py` (mirrors test_overrides.py's convention)."""
import sys
from pathlib import Path

import pytest

SOLVER_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SOLVER_DIR))
import solve as S  # noqa: E402
from merge_inputs import (  # noqa: E402
    UnresolvableIdError,
    build_merged_pmedian_dataset,
    resolve_pmedian_ids_to_indices,
)


def empty_inputs(**overrides):
    base = {"addedWarehouses": [], "addedCustomers": [], "distanceOverrides": []}
    base.update(overrides)
    return base


def test_known_warehouse_and_customer_ids_are_present_in_reverse_maps():
    # ALN is warehouse index 1, C1 is customer index 1 (real dataset).
    result = resolve_pmedian_ids_to_indices(empty_inputs(), S.WAREHOUSES, S.CUSTOMERS)
    assert result["warehouseIdToIndex"]["ALN"] == 1
    assert result["customerIdToIndex"]["C1"] == 1
    # Round-trip against WAREHOUSES/CUSTOMERS themselves, not hardcoded
    # numbers, so this stays correct if the dataset is ever re-extracted.
    for idx, wh in S.WAREHOUSES.items():
        assert result["warehouseIdToIndex"][wh["id"]] == idx
    for idx, c in S.CUSTOMERS.items():
        assert result["customerIdToIndex"][c["id"]] == idx


def test_id_keyed_distance_override_round_trips_to_correct_index_pair():
    # Real pair from the dataset: ALN (warehouse idx 1) -> C1 (customer idx 1).
    inputs = empty_inputs(distanceOverrides=[{"fromId": "ALN", "toId": "C1", "distance": 999.0}])
    result = resolve_pmedian_ids_to_indices(inputs, S.WAREHOUSES, S.CUSTOMERS)
    assert result["distanceOverridesByIndex"] == {(1, 1): 999.0}


def test_unknown_id_in_distance_override_raises_not_silently_resolved():
    inputs = empty_inputs(distanceOverrides=[{"fromId": "NOPE-NOT-REAL", "toId": "C1", "distance": 10.0}])
    with pytest.raises(UnresolvableIdError):
        resolve_pmedian_ids_to_indices(inputs, S.WAREHOUSES, S.CUSTOMERS)


def test_unknown_to_id_in_distance_override_also_raises():
    inputs = empty_inputs(distanceOverrides=[{"fromId": "ALN", "toId": "NOPE-NOT-REAL", "distance": 10.0}])
    with pytest.raises(UnresolvableIdError):
        resolve_pmedian_ids_to_indices(inputs, S.WAREHOUSES, S.CUSTOMERS)


def test_backwards_override_raises_not_silently_resolved_to_coincidental_pair():
    # Fix-brief regression: fromId="C1" (a real customer id) and toId="ALN"
    # (a real warehouse id) is backwards. Before the fix, the old
    # either-map probe resolved this to (1, 1) - the SAME index pair as the
    # real ALN->C1 distance - because C1 happens to be customer index 1 and
    # ALN happens to be warehouse index 1. Must raise, never silently
    # produce that coincidentally-valid-looking tuple.
    inputs = empty_inputs(distanceOverrides=[{"fromId": "C1", "toId": "ALN", "distance": 999.0}])
    with pytest.raises(UnresolvableIdError):
        resolve_pmedian_ids_to_indices(inputs, S.WAREHOUSES, S.CUSTOMERS)


def test_correctly_ordered_override_with_synthetic_added_warehouse_still_resolves():
    # Confirms the direction-aware fix doesn't regress a legitimate
    # warehouse(added, synthetic index)->customer(base) override.
    max_wh_index = max(S.WAREHOUSES.keys())
    inputs = empty_inputs(
        addedWarehouses=[
            {"id": "WH-NEW-1", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81, "status": "active"},
        ],
        distanceOverrides=[{"fromId": "WH-NEW-1", "toId": "C1", "distance": 42.5}],
    )
    result = resolve_pmedian_ids_to_indices(inputs, S.WAREHOUSES, S.CUSTOMERS)
    assert result["distanceOverridesByIndex"] == {(max_wh_index + 1, 1): 42.5}


def test_added_warehouse_gets_synthetic_index_beyond_existing_max():
    max_wh_index = max(S.WAREHOUSES.keys())
    inputs = empty_inputs(addedWarehouses=[
        {"id": "WH-NEW-1", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81, "status": "active"},
    ])
    result = resolve_pmedian_ids_to_indices(inputs, S.WAREHOUSES, S.CUSTOMERS)
    assert result["addedWarehouseIndices"]["WH-NEW-1"] == max_wh_index + 1
    assert result["warehouseIdToIndex"]["WH-NEW-1"] == max_wh_index + 1
    # Never collides with an existing dataset index.
    assert max_wh_index + 1 not in S.WAREHOUSES


def test_added_customer_gets_synthetic_index_beyond_existing_max():
    max_cust_index = max(S.CUSTOMERS.keys())
    inputs = empty_inputs(addedCustomers=[
        {"id": "CUST-NEW-1", "city": "Fresno", "lat": 36.74, "lng": -119.77, "demand": 1200},
    ])
    result = resolve_pmedian_ids_to_indices(inputs, S.WAREHOUSES, S.CUSTOMERS)
    assert result["addedCustomerIndices"]["CUST-NEW-1"] == max_cust_index + 1
    assert result["customerIdToIndex"]["CUST-NEW-1"] == max_cust_index + 1
    assert max_cust_index + 1 not in S.CUSTOMERS


def test_multiple_added_entities_get_distinct_non_colliding_synthetic_indices():
    max_wh_index = max(S.WAREHOUSES.keys())
    max_cust_index = max(S.CUSTOMERS.keys())
    inputs = empty_inputs(
        addedWarehouses=[
            {"id": "WH-A", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81, "status": "active"},
            {"id": "WH-B", "city": "Boise", "state": "ID", "lat": 43.61, "lng": -116.20, "status": "active"},
        ],
        addedCustomers=[
            {"id": "CUST-A", "city": "Fresno", "lat": 36.74, "lng": -119.77, "demand": 1200},
            {"id": "CUST-B", "city": "Tucson", "lat": 32.22, "lng": -110.97, "demand": 800},
            {"id": "CUST-C", "city": "Boulder", "lat": 40.01, "lng": -105.27, "demand": 500},
        ],
    )
    result = resolve_pmedian_ids_to_indices(inputs, S.WAREHOUSES, S.CUSTOMERS)

    wh_indices = [result["addedWarehouseIndices"]["WH-A"], result["addedWarehouseIndices"]["WH-B"]]
    assert wh_indices == [max_wh_index + 1, max_wh_index + 2]
    assert len(set(wh_indices)) == len(wh_indices)
    assert not (set(wh_indices) & set(S.WAREHOUSES.keys()))

    cust_indices = [
        result["addedCustomerIndices"]["CUST-A"],
        result["addedCustomerIndices"]["CUST-B"],
        result["addedCustomerIndices"]["CUST-C"],
    ]
    assert cust_indices == [max_cust_index + 1, max_cust_index + 2, max_cust_index + 3]
    assert len(set(cust_indices)) == len(cust_indices)
    assert not (set(cust_indices) & set(S.CUSTOMERS.keys()))


def test_added_entity_id_resolves_through_extended_map_when_referenced_by_distance_override():
    max_wh_index = max(S.WAREHOUSES.keys())
    max_cust_index = max(S.CUSTOMERS.keys())
    inputs = empty_inputs(
        addedWarehouses=[
            {"id": "WH-NEW-1", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81, "status": "active"},
        ],
        addedCustomers=[
            {"id": "CUST-NEW-1", "city": "Fresno", "lat": 36.74, "lng": -119.77, "demand": 1200},
        ],
        distanceOverrides=[
            {"fromId": "WH-NEW-1", "toId": "CUST-NEW-1", "distance": 42.5},
            # Also cross-reference: added warehouse to a base-dataset customer.
            {"fromId": "WH-NEW-1", "toId": "C1", "distance": 55.5},
        ],
    )
    result = resolve_pmedian_ids_to_indices(inputs, S.WAREHOUSES, S.CUSTOMERS)
    assert result["distanceOverridesByIndex"][(max_wh_index + 1, max_cust_index + 1)] == 42.5
    assert result["distanceOverridesByIndex"][(max_wh_index + 1, 1)] == 55.5


def test_base_dataset_dicts_are_not_mutated():
    wh_keys_before = set(S.WAREHOUSES.keys())
    cust_keys_before = set(S.CUSTOMERS.keys())
    inputs = empty_inputs(addedWarehouses=[
        {"id": "WH-NEW-1", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81, "status": "active"},
    ])
    resolve_pmedian_ids_to_indices(inputs, S.WAREHOUSES, S.CUSTOMERS)
    assert set(S.WAREHOUSES.keys()) == wh_keys_before
    assert set(S.CUSTOMERS.keys()) == cust_keys_before


# ---------------------------------------------------------------------------
# B3.1 — build_merged_pmedian_dataset (the merge pipeline itself)
# ---------------------------------------------------------------------------

def test_merged_dataset_with_empty_inputs_is_a_copy_not_the_same_object():
    merged = build_merged_pmedian_dataset(empty_inputs(), S.WAREHOUSES, S.CUSTOMERS, S.DISTANCE)
    assert merged["warehouses"] == S.WAREHOUSES
    assert merged["warehouses"] is not S.WAREHOUSES
    assert merged["customers"] == S.CUSTOMERS
    assert merged["customers"] is not S.CUSTOMERS
    assert merged["distance"] == S.DISTANCE
    assert merged["distance"] is not S.DISTANCE
    assert merged["addedWarehousesById"] == {}
    assert merged["addedCustomersById"] == {}


def test_merged_warehouses_includes_added_warehouse_at_synthetic_index():
    max_wh_index = max(S.WAREHOUSES.keys())
    inputs = empty_inputs(addedWarehouses=[
        {"id": "WH-NEW-1", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81,
         "capacity": 50000, "status": "active"},
    ])
    merged = build_merged_pmedian_dataset(inputs, S.WAREHOUSES, S.CUSTOMERS, S.DISTANCE)
    new_idx = max_wh_index + 1
    assert new_idx in merged["warehouses"]
    assert merged["warehouses"][new_idx]["id"] == "WH-NEW-1"
    assert merged["warehouses"][new_idx]["city"] == "Reno"
    assert merged["warehouses"][new_idx]["state"] == "NV"
    assert merged["warehouses"][new_idx]["lat"] == 39.53
    assert merged["warehouses"][new_idx]["lng"] == -119.81
    # Own-record resolution (get_capacity/get_bounds in solve.py), not a
    # sparse-override-map lookup - the raw added-entity record round-trips.
    assert merged["addedWarehousesById"]["WH-NEW-1"]["capacity"] == 50000
    assert merged["addedWarehousesById"]["WH-NEW-1"]["status"] == "active"
    # Base dataset itself never mutated.
    assert max_wh_index in S.WAREHOUSES
    assert new_idx not in S.WAREHOUSES


def test_merged_customers_includes_added_customer_at_synthetic_index_with_demand():
    max_cust_index = max(S.CUSTOMERS.keys())
    inputs = empty_inputs(addedCustomers=[
        {"id": "CUST-NEW-1", "city": "Fresno", "lat": 36.74, "lng": -119.77, "demand": 1200},
    ])
    merged = build_merged_pmedian_dataset(inputs, S.WAREHOUSES, S.CUSTOMERS, S.DISTANCE)
    new_idx = max_cust_index + 1
    assert new_idx in merged["customers"]
    assert merged["customers"][new_idx]["id"] == "CUST-NEW-1"
    assert merged["customers"][new_idx]["demand"] == 1200
    assert merged["addedCustomersById"]["CUST-NEW-1"]["demand"] == 1200
    assert new_idx not in S.CUSTOMERS


def test_merged_distance_overlays_overrides_onto_base_without_dropping_other_pairs():
    # ALN (idx 1) -> C1 (idx 1) is 374mi in the base dataset.
    assert S.DISTANCE[(1, 1)] == 374
    inputs = empty_inputs(distanceOverrides=[{"fromId": "ALN", "toId": "C1", "distance": 999.0}])
    merged = build_merged_pmedian_dataset(inputs, S.WAREHOUSES, S.CUSTOMERS, S.DISTANCE)
    assert merged["distance"][(1, 1)] == 999.0
    # An unrelated pair is untouched.
    assert merged["distance"][(2, 1)] == S.DISTANCE[(2, 1)]
    # Base DISTANCE itself never mutated.
    assert S.DISTANCE[(1, 1)] == 374


def test_merged_distance_supplies_the_only_route_to_an_added_entity():
    max_wh_index = max(S.WAREHOUSES.keys())
    max_cust_index = max(S.CUSTOMERS.keys())
    inputs = empty_inputs(
        addedWarehouses=[
            {"id": "WH-NEW-1", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81, "status": "active"},
        ],
        addedCustomers=[
            {"id": "CUST-NEW-1", "city": "Fresno", "lat": 36.74, "lng": -119.77, "demand": 1200},
        ],
        distanceOverrides=[
            {"fromId": "WH-NEW-1", "toId": "CUST-NEW-1", "distance": 15.0},
        ],
    )
    merged = build_merged_pmedian_dataset(inputs, S.WAREHOUSES, S.CUSTOMERS, S.DISTANCE)
    assert merged["distance"][(max_wh_index + 1, max_cust_index + 1)] == 15.0
    # No auto-haversine fallback for pairs with no override (L4) - simply
    # absent from the merged dict, same as any other unknown pair.
    assert (max_wh_index + 1, 2) not in merged["distance"]


def test_two_calls_for_two_different_scenarios_do_not_leak_into_each_other():
    # Concurrent solves for other scenarios must never see one scenario's
    # added entities - this is the whole point of "per-call, not a global
    # mutation" (the task brief's explicit constraint).
    inputs_a = empty_inputs(addedWarehouses=[
        {"id": "WH-A", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81, "status": "active"},
    ])
    inputs_b = empty_inputs(addedWarehouses=[
        {"id": "WH-B", "city": "Boise", "state": "ID", "lat": 43.61, "lng": -116.20, "status": "active"},
    ])
    merged_a = build_merged_pmedian_dataset(inputs_a, S.WAREHOUSES, S.CUSTOMERS, S.DISTANCE)
    merged_b = build_merged_pmedian_dataset(inputs_b, S.WAREHOUSES, S.CUSTOMERS, S.DISTANCE)

    a_ids = {wh["id"] for wh in merged_a["warehouses"].values()}
    b_ids = {wh["id"] for wh in merged_b["warehouses"].values()}
    assert "WH-A" in a_ids and "WH-B" not in a_ids
    assert "WH-B" in b_ids and "WH-A" not in b_ids
    assert "WH-A" not in {wh["id"] for wh in S.WAREHOUSES.values()}
    assert "WH-B" not in {wh["id"] for wh in S.WAREHOUSES.values()}
