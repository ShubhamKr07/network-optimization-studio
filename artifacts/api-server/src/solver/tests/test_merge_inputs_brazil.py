"""SCN v0.3 Phase B, task B6.3 — `build_merged_brazil_dataset` (merge_inputs.py),
the `p-median-brazil` fast-follow of B3.1's `build_merged_pmedian_dataset`.

`p-median-brazil` is already ID-keyed end to end (`BRAZIL_WAREHOUSES`/
`BRAZIL_REGIONS` are `{str_id: {...}}`, `_brazil_distances()` is
`{(str_wh_id, str_region_id): float}`), DD-2's correction — so unlike
p-median-us, no id<->index bridge (B1.3) is exercised here. These are unit/
mechanism tests for the merge helper in isolation, tested against the real
p-median-brazil dataset (loaded via solve.py's module-level BRAZIL_WAREHOUSES/
BRAZIL_REGIONS, per this repo's standing convention for `test_merge_inputs.py`
— not synthetic fixtures). End-to-end golden tests that exercise this through
a real `solve_capacitated_pmedian` subprocess solve live in
`test_network_edits_brazil.py` (mirrors `test_network_edits.py`'s convention
for p-median-us)."""
import sys
from pathlib import Path

import pytest

SOLVER_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SOLVER_DIR))
import solve as S  # noqa: E402
from merge_inputs import UnresolvableIdError, build_merged_brazil_dataset  # noqa: E402


def empty_inputs(**overrides):
    base = {"addedWarehouses": [], "addedCustomers": [], "distanceOverrides": []}
    base.update(overrides)
    return base


def brazil_distance():
    return S._brazil_distances()


def test_merged_dataset_with_empty_inputs_is_a_copy_not_the_same_object():
    merged = build_merged_brazil_dataset(empty_inputs(), S.BRAZIL_WAREHOUSES, S.BRAZIL_REGIONS, brazil_distance())
    assert merged["warehouses"] == S.BRAZIL_WAREHOUSES
    assert merged["warehouses"] is not S.BRAZIL_WAREHOUSES
    assert merged["regions"] == S.BRAZIL_REGIONS
    assert merged["regions"] is not S.BRAZIL_REGIONS
    assert merged["distance"] == brazil_distance()
    assert merged["addedWarehousesById"] == {}
    assert merged["addedCustomersById"] == {}


def test_added_warehouse_is_keyed_by_its_own_id_no_synthetic_index():
    inputs = empty_inputs(addedWarehouses=[
        {"id": "WH-NEW-1", "city": "Reno", "state": "NV", "lat": -10.0, "lng": -50.0, "status": "active"},
    ])
    merged = build_merged_brazil_dataset(inputs, S.BRAZIL_WAREHOUSES, S.BRAZIL_REGIONS, brazil_distance())
    assert "WH-NEW-1" in merged["warehouses"]
    assert merged["warehouses"]["WH-NEW-1"]["id"] == "WH-NEW-1"
    assert merged["warehouses"]["WH-NEW-1"]["city"] == "Reno"
    assert merged["warehouses"]["WH-NEW-1"]["state"] == "NV"
    assert merged["addedWarehousesById"]["WH-NEW-1"]["status"] == "active"
    # Base dataset itself never mutated.
    assert "WH-NEW-1" not in S.BRAZIL_WAREHOUSES


def test_added_customer_is_keyed_by_its_own_id_with_demand_and_name_from_city():
    inputs = empty_inputs(addedCustomers=[
        {"id": "CUST-NEW-1", "city": "Nova Cidade", "state": "XX", "lat": -8.0, "lng": -40.0, "demand": 12345},
    ])
    merged = build_merged_brazil_dataset(inputs, S.BRAZIL_WAREHOUSES, S.BRAZIL_REGIONS, brazil_distance())
    assert "CUST-NEW-1" in merged["regions"]
    assert merged["regions"]["CUST-NEW-1"]["demand"] == 12345
    # regions have no separate "city" key — addedCustomers' city becomes name.
    assert merged["regions"]["CUST-NEW-1"]["name"] == "Nova Cidade"
    assert merged["addedCustomersById"]["CUST-NEW-1"]["demand"] == 12345
    assert "CUST-NEW-1" not in S.BRAZIL_REGIONS


def test_merged_distance_overlays_override_onto_base_without_dropping_other_pairs():
    base_dist = brazil_distance()
    assert base_dist[("ANP", "SP")] == 609.1
    inputs = empty_inputs(distanceOverrides=[{"fromId": "ANP", "toId": "SP", "distance": 1.0}])
    merged = build_merged_brazil_dataset(inputs, S.BRAZIL_WAREHOUSES, S.BRAZIL_REGIONS, base_dist)
    assert merged["distance"][("ANP", "SP")] == 1.0
    # An unrelated pair is untouched.
    assert merged["distance"][("ANP", "RJ")] == base_dist[("ANP", "RJ")]
    # Base distance dict itself never mutated.
    assert base_dist[("ANP", "SP")] == 609.1


def test_merged_distance_supplies_the_only_route_to_an_added_entity():
    inputs = empty_inputs(
        addedWarehouses=[
            {"id": "WH-NEW-1", "city": "Reno", "state": "NV", "lat": -10.0, "lng": -50.0, "status": "active"},
        ],
        addedCustomers=[
            {"id": "CUST-NEW-1", "city": "Nova Cidade", "state": "XX", "lat": -8.0, "lng": -40.0, "demand": 1200},
        ],
        distanceOverrides=[{"fromId": "WH-NEW-1", "toId": "CUST-NEW-1", "distance": 15.0}],
    )
    merged = build_merged_brazil_dataset(inputs, S.BRAZIL_WAREHOUSES, S.BRAZIL_REGIONS, brazil_distance())
    assert merged["distance"][("WH-NEW-1", "CUST-NEW-1")] == 15.0
    # No auto-haversine fallback for pairs with no override — simply absent.
    assert ("WH-NEW-1", "SP") not in merged["distance"]


def test_unknown_from_id_in_distance_override_raises_not_silently_resolved():
    inputs = empty_inputs(distanceOverrides=[{"fromId": "NOPE-NOT-REAL", "toId": "SP", "distance": 10.0}])
    with pytest.raises(UnresolvableIdError):
        build_merged_brazil_dataset(inputs, S.BRAZIL_WAREHOUSES, S.BRAZIL_REGIONS, brazil_distance())


def test_unknown_to_id_in_distance_override_also_raises():
    inputs = empty_inputs(distanceOverrides=[{"fromId": "ANP", "toId": "NOPE-NOT-REAL", "distance": 10.0}])
    with pytest.raises(UnresolvableIdError):
        build_merged_brazil_dataset(inputs, S.BRAZIL_WAREHOUSES, S.BRAZIL_REGIONS, brazil_distance())


def test_backwards_override_raises_not_silently_resolved():
    # fromId is a real region id, toId is a real warehouse id — backwards.
    inputs = empty_inputs(distanceOverrides=[{"fromId": "SP", "toId": "ANP", "distance": 999.0}])
    with pytest.raises(UnresolvableIdError):
        build_merged_brazil_dataset(inputs, S.BRAZIL_WAREHOUSES, S.BRAZIL_REGIONS, brazil_distance())


def test_two_calls_for_two_different_scenarios_do_not_leak_into_each_other():
    inputs_a = empty_inputs(addedWarehouses=[
        {"id": "WH-A", "city": "Reno", "state": "NV", "lat": -10.0, "lng": -50.0, "status": "active"},
    ])
    inputs_b = empty_inputs(addedWarehouses=[
        {"id": "WH-B", "city": "Boise", "state": "ID", "lat": -12.0, "lng": -52.0, "status": "active"},
    ])
    merged_a = build_merged_brazil_dataset(inputs_a, S.BRAZIL_WAREHOUSES, S.BRAZIL_REGIONS, brazil_distance())
    merged_b = build_merged_brazil_dataset(inputs_b, S.BRAZIL_WAREHOUSES, S.BRAZIL_REGIONS, brazil_distance())
    assert "WH-A" in merged_a["warehouses"] and "WH-B" not in merged_a["warehouses"]
    assert "WH-B" in merged_b["warehouses"] and "WH-A" not in merged_b["warehouses"]
    assert "WH-A" not in S.BRAZIL_WAREHOUSES
    assert "WH-B" not in S.BRAZIL_WAREHOUSES
