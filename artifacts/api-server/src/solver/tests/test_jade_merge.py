"""pytest tests for build_merged_jade_dataset (jade-T4).

Mirrors the style of test_merge_inputs_two_echelon.py, adapted for JADE's
genuinely different shape: three merged entity types (plants/warehouses/
customers) plus a fixed products axis, a plant x product capability matrix,
and two leg-tagged distance namespaces sharing one flat distances.json.
"""
import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from merge_inputs import build_merged_jade_dataset, UnresolvableIdError  # noqa: E402
import solve as solve_mod  # noqa: E402

PLANTS = solve_mod.JADE_PLANTS
WAREHOUSES = solve_mod.JADE_WAREHOUSES
CUSTOMERS = solve_mod.JADE_CUSTOMERS
CAPABILITY = solve_mod.JADE_CAPABILITY
PRODUCT_IDS = list(solve_mod.JADE_PRODUCTS.keys())
DISTANCE = solve_mod._jade_distances()


def _merge(inputs):
    return build_merged_jade_dataset(inputs, PLANTS, WAREHOUSES, CUSTOMERS, CAPABILITY, PRODUCT_IDS, DISTANCE)


def test_empty_inputs_yields_base_counts():
    merged = _merge({})
    assert len(merged["plants"]) == 4
    assert len(merged["warehouses"]) == 25
    assert len(merged["customers"]) == 100
    assert len(merged["capability"]) == 16


def test_disabled_cell_yields_zero():
    merged = _merge({"capabilityOverrides": [{"plantId": "plant-1", "productId": "product-1", "enabled": False}]})
    assert merged["capability"][("plant-1", "product-1")] == 0


def test_enabled_cell_yields_full_capacity():
    merged = _merge({"capabilityOverrides": [{"plantId": "plant-2", "productId": "product-1", "enabled": True}]})
    assert merged["capability"][("plant-2", "product-1")] == 210_000_000
    # other cells on that plant untouched
    assert merged["capability"][("plant-2", "product-2")] == 210_000_000


def test_added_warehouse_adds_row_and_distance_rows():
    merged = _merge({
        "addedWarehouses": [{"id": "test-wh", "city": "Testville", "state": "ZZ",
                             "lat": 40.0, "lng": -90.0, "status": "active"}],
        "distanceOverrides": [
            {"leg": "plant_to_warehouse", "fromId": "plant-1", "toId": "test-wh", "distance": 111.0},
            {"leg": "warehouse_to_customer", "fromId": "test-wh", "toId": "customer-1", "distance": 22.0},
        ],
    })
    assert "test-wh" in merged["warehouses"]
    assert len(merged["warehouses"]) == 26
    assert merged["distance"][("plant-1", "test-wh")] == 111.0
    assert merged["distance"][("test-wh", "customer-1")] == 22.0


def test_added_plant_defaults_all_capability_disabled():
    merged = _merge({
        "addedPlants": [{"id": "plant-x", "city": "X", "state": "ZZ", "lat": 40.0, "lng": -90.0}],
    })
    assert "plant-x" in merged["plants"]
    assert len(merged["plants"]) == 5
    assert all(merged["capability"][("plant-x", k)] == 0 for k in PRODUCT_IDS)


def test_added_plant_capability_can_be_enabled():
    merged = _merge({
        "addedPlants": [{"id": "plant-x", "city": "X", "state": "ZZ", "lat": 40.0, "lng": -90.0}],
        "capabilityOverrides": [{"plantId": "plant-x", "productId": "product-2", "enabled": True}],
    })
    assert merged["capability"][("plant-x", "product-2")] == 210_000_000
    assert merged["capability"][("plant-x", "product-1")] == 0
    assert merged["capability"][("plant-x", "product-3")] == 0
    assert merged["capability"][("plant-x", "product-4")] == 0


def test_excluded_customer_removed():
    merged = _merge({"excludedCustomerIds": ["customer-1"]})
    assert "customer-1" not in merged["customers"]
    assert len(merged["customers"]) == 99


def test_added_customer_present_with_demands():
    merged = _merge({
        "addedCustomers": [{"id": "test-cust", "city": "X", "state": "ZZ", "lat": 40.0, "lng": -90.0,
                            "demands": {"product-1": 10.0, "product-2": 0.0, "product-3": 0.0, "product-4": 0.0}}],
    })
    assert merged["customers"]["test-cust"]["demands"]["product-1"] == 10.0
    assert merged["customers"]["test-cust"]["demand"] == 10.0
    assert len(merged["customers"]) == 101


def test_added_customer_excluded_still_removed():
    merged = _merge({
        "addedCustomers": [{"id": "test-cust", "city": "X", "state": "ZZ", "lat": 40.0, "lng": -90.0,
                            "demands": {"product-1": 10.0, "product-2": 0.0, "product-3": 0.0, "product-4": 0.0}}],
        "excludedCustomerIds": ["test-cust"],
    })
    assert "test-cust" not in merged["customers"]


def test_distance_override_wrong_leg_rejected():
    # wh-1 -> customer-1 is a real warehouse->customer pair, but tagging it
    # as plant_to_warehouse must be rejected, not silently coerced.
    with pytest.raises(UnresolvableIdError):
        _merge({
            "distanceOverrides": [
                {"leg": "plant_to_warehouse", "fromId": "wh-1", "toId": "customer-1", "distance": 5.0},
            ],
        })


def test_distance_override_unknown_leg_rejected():
    with pytest.raises(UnresolvableIdError):
        _merge({
            "distanceOverrides": [
                {"leg": "mine_to_refinery", "fromId": "plant-1", "toId": "wh-1", "distance": 5.0},
            ],
        })


def test_distance_override_to_excluded_customer_still_resolves():
    # An override referencing a customer excluded THIS scenario must still
    # validate as "a customer" (role-membership check runs before exclusion
    # filtering) -- not raise UnresolvableIdError.
    merged = _merge({
        "excludedCustomerIds": ["customer-1"],
        "distanceOverrides": [
            {"leg": "warehouse_to_customer", "fromId": "wh-1", "toId": "customer-1", "distance": 999.0},
        ],
    })
    assert merged["distance"][("wh-1", "customer-1")] == 999.0
    assert "customer-1" not in merged["customers"]


def test_base_dict_unmutated():
    plants_before = copy.deepcopy(PLANTS)
    warehouses_before = copy.deepcopy(WAREHOUSES)
    customers_before = copy.deepcopy(CUSTOMERS)
    capability_before = dict(CAPABILITY)
    distance_before = dict(DISTANCE)

    _merge({
        "addedPlants": [{"id": "plant-x", "city": "X", "state": "ZZ", "lat": 40.0, "lng": -90.0}],
        "addedWarehouses": [{"id": "test-wh", "city": "X", "state": "ZZ",
                             "lat": 40.0, "lng": -90.0, "status": "active"}],
        "addedCustomers": [{"id": "test-cust", "city": "X", "state": "ZZ", "lat": 40.0, "lng": -90.0,
                            "demands": {"product-1": 10.0, "product-2": 0.0, "product-3": 0.0, "product-4": 0.0}}],
        "capabilityOverrides": [{"plantId": "plant-1", "productId": "product-1", "enabled": False}],
        "excludedCustomerIds": ["customer-1"],
        "distanceOverrides": [
            {"leg": "plant_to_warehouse", "fromId": "plant-1", "toId": "test-wh", "distance": 1.0},
        ],
    })

    assert PLANTS == plants_before
    assert WAREHOUSES == warehouses_before
    assert CUSTOMERS == customers_before
    assert CAPABILITY == capability_before
    assert DISTANCE == distance_before
