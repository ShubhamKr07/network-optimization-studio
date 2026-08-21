"""B1.3: id<->index bridge for p-median-us (the sole index-keyed dataset,
DD-2's correction). Tested against the real p-median-us dataset (loaded via
solve.py's module-level WAREHOUSES/CUSTOMERS), per the plan's explicit
instruction - not synthetic fixtures.

Scope: this is the bridge only (resolve_pmedian_ids_to_indices). B3.1 owns
the full load -> apply overrides -> append entities pipeline that imports
this function; it is not built here."""
import sys
from pathlib import Path

import pytest

SOLVER_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SOLVER_DIR))
import solve as S  # noqa: E402
from merge_inputs import UnresolvableIdError, resolve_pmedian_ids_to_indices  # noqa: E402


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
