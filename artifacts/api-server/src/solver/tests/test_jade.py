"""pytest tests for the JADE multi-product two-echelon model (Chapter 9) in
solve.py.

Ground truth (spec §2.7, hard rule 2): forced wh-11 (Phoenix) + wh-14 (New
York), P=2, capability diagonal, bands [200,400,800,1600] -> status optimal,
objective 254060828.6157 (Watson et al. JADE case notebook, scenario_1).
Independently re-derived analytically during planning: single-source +
diagonal capability means the model decomposes per customer into "cheaper of
the two forced-open warehouses, summed inbound+outbound cost" -- a plain
Python re-computation of that decomposition (no PuLP) reproduces
254060828.6157 to 10 decimal places, cross-checking the full PuLP model
below independently of CBC.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
from solve import solve_jade  # noqa: E402
import solve as solve_mod  # noqa: E402

GROUND_TRUTH_INPUTS = {
    "p": 2, "distanceBands": [200, 400, 800, 1600], "gap": 0, "timeLimitSec": 60,
    "warehouseStatuses": [
        {"warehouseId": "wh-11", "status": "forced_open"},
        {"warehouseId": "wh-14", "status": "forced_open"},
    ],
}


def _all_base_customer_ids():
    return list(solve_mod.JADE_CUSTOMERS.keys())


def test_ground_truth_objective_and_facilities():
    result = solve_jade(GROUND_TRUTH_INPUTS)
    assert result["status"] == "optimal"
    assert abs(result["objective"] - 254060828.6157) / 254060828.6157 < 1e-6
    assert set(result["metrics"]["openFacilityIds"]) == {"wh-11", "wh-14"}
    assert set(result["details"]["openWarehouseIds"]) == {"wh-11", "wh-14"}


def test_single_source_per_customer():
    result = solve_jade(GROUND_TRUTH_INPUTS)
    assert result["status"] == "optimal"
    per_customer_wh = {}
    for row in result["details"]["assignments"]:
        per_customer_wh.setdefault(row["customerId"], set()).add(row["warehouseId"])
    assert per_customer_wh, "expected per-product outbound assignment rows"
    assert all(len(whs) == 1 for whs in per_customer_wh.values()), \
        "single-source: every customer's products must be served by exactly one warehouse"
    # every outbound edge (already aggregated per-customer) must also match
    # the per-product assignment's warehouse
    outbound_by_customer = {e["toId"]: e["fromId"] for e in result["edges"] if e["leg"] == "warehouse_to_customer"}
    for cid, whs in per_customer_wh.items():
        assert outbound_by_customer[cid] == next(iter(whs))


def test_excluded_customer_absent_from_outbound_edges():
    inputs = dict(GROUND_TRUTH_INPUTS)
    inputs["excludedCustomerIds"] = ["customer-1"]
    result = solve_jade(inputs)
    assert result["status"] == "optimal"
    assert all(e["toId"] != "customer-1" for e in result["edges"] if e["leg"] == "warehouse_to_customer")
    assert all(row["customerId"] != "customer-1" for row in result["details"]["assignments"])


def test_forced_open_and_inactive_honored():
    inputs = {
        "p": 2, "distanceBands": [200, 400, 800, 1600], "gap": 0, "timeLimitSec": 60,
        "warehouseStatuses": [
            {"warehouseId": "wh-11", "status": "forced_open"},
            {"warehouseId": "wh-14", "status": "inactive"},
        ],
    }
    result = solve_jade(inputs)
    assert result["status"] == "optimal"
    assert "wh-11" in result["metrics"]["openFacilityIds"]
    assert "wh-14" not in result["metrics"]["openFacilityIds"]


def test_forced_open_exceeds_p_infeasible():
    inputs = {
        "p": 1, "distanceBands": [200, 400, 800, 1600], "gap": 0, "timeLimitSec": 30,
        "warehouseStatuses": [
            {"warehouseId": "wh-11", "status": "forced_open"},
            {"warehouseId": "wh-14", "status": "forced_open"},
        ],
    }
    result = solve_jade(inputs)
    assert result["status"] == "infeasible"
    assert "forced" in result["infeasibilityReason"].lower()


def test_all_warehouses_inactive_infeasible():
    statuses = [{"warehouseId": wid, "status": "inactive"} for wid in solve_mod.JADE_WAREHOUSES.keys()]
    result = solve_jade({
        "p": 1, "distanceBands": [200, 400, 800, 1600], "gap": 0, "timeLimitSec": 30,
        "warehouseStatuses": statuses,
    })
    assert result["status"] == "infeasible"
    assert "active" in result["infeasibilityReason"].lower()


def test_no_capable_plant_for_demanded_product_infeasible():
    inputs = dict(GROUND_TRUTH_INPUTS)
    inputs["capabilityOverrides"] = [{"plantId": "plant-1", "productId": "product-1", "enabled": False}]
    result = solve_jade(inputs)
    assert result["status"] == "infeasible"
    assert "product-1" in result["infeasibilityReason"]


def test_capability_toggle_changes_supplying_plant():
    baseline = solve_jade(GROUND_TRUTH_INPUTS)
    assert baseline["status"] == "optimal"
    baseline_supplier = {e["fromId"] for e in baseline["edges"]
                         if e["leg"] == "plant_to_warehouse" and e["toId"] == "wh-11" and e["productId"] == "product-1"}
    assert baseline_supplier == {"plant-1"}

    toggled_inputs = dict(GROUND_TRUTH_INPUTS)
    # plant-4 (Long Beach) is much closer to wh-11 (Phoenix) than plant-1
    # (Ashland, KY) -- enabling it should switch the supplying plant and
    # strictly lower the objective.
    toggled_inputs["capabilityOverrides"] = [{"plantId": "plant-4", "productId": "product-1", "enabled": True}]
    toggled = solve_jade(toggled_inputs)
    assert toggled["status"] == "optimal"
    toggled_supplier = {e["fromId"] for e in toggled["edges"]
                        if e["leg"] == "plant_to_warehouse" and e["toId"] == "wh-11" and e["productId"] == "product-1"}
    assert toggled_supplier == {"plant-4"}
    assert toggled["objective"] < baseline["objective"]


def test_band_overflow_present_not_absorbed():
    # Under the default [200,400,800,1600] bands, the ground-truth optimal
    # assignment (each customer routed to whichever of wh-11/wh-14 is
    # cheaper) happens to keep every chosen outbound leg within 1600mi -- so
    # a narrower band set (matching Ch10's test_band_overflow_not_absorbed
    # pattern) is used here to force a real overflow case: 16 of the 100
    # customers' cheapest-warehouse distance exceeds 1200mi (independently
    # verified against the raw distance matrix during planning).
    inputs = dict(GROUND_TRUTH_INPUTS)
    inputs["distanceBands"] = [200, 400, 800, 1200]
    result = solve_jade(inputs)
    assert result["status"] == "optimal"
    coverage = result["metrics"]["bandCoverage"]
    overflow = [c for c in coverage if c["band"] == -1]
    assert len(overflow) == 1, "outbound distances beyond 1500mi must appear as a distinct overflow entry"
    assert overflow[0]["percent"] > 0


def test_avg_distance_not_derived_from_objective():
    result = solve_jade(GROUND_TRUTH_INPUTS)
    naive_avg = result["objective"] / result["metrics"]["totalDemand"]
    real_avg = result["metrics"]["weightedAvgDistance"]
    assert abs(naive_avg - real_avg) > 1


def test_min_charge_below_breakpoint_and_above():
    # Isolated single-warehouse/single-customer scenario: inbound distance
    # 200mi -> 0.07*200=14 (above the $10 min charge, rate governs);
    # outbound distance 10mi -> 0.12*10=1.2 (below the $10 min charge, the
    # flat minimum governs instead). Expected objective = 100*14 + 100*10 = 2400.
    result = solve_jade({
        "p": 1, "distanceBands": [200, 400, 800, 1600], "gap": 0, "timeLimitSec": 30,
        "excludedCustomerIds": _all_base_customer_ids(),
        "addedWarehouses": [{"id": "test-wh", "city": "Testville", "state": "ZZ",
                             "lat": 40.0, "lng": -90.0, "status": "forced_open"}],
        "addedCustomers": [{"id": "test-cust", "city": "Testville", "state": "ZZ", "lat": 40.0, "lng": -90.0,
                            "demands": {"product-1": 100.0, "product-2": 0.0, "product-3": 0.0, "product-4": 0.0}}],
        "distanceOverrides": [
            {"leg": "plant_to_warehouse", "fromId": "plant-1", "toId": "test-wh", "distance": 200.0},
            {"leg": "warehouse_to_customer", "fromId": "test-wh", "toId": "test-cust", "distance": 10.0},
        ],
    })
    assert result["status"] == "optimal", result.get("infeasibilityReason")
    assert abs(result["objective"] - 2400.0) < 1e-6


def test_capacity_binds_and_overflow_routes_to_alternate_plant(monkeypatch):
    # Structural capacity test: lower plant-1's product-1 capacity (via
    # module-state monkeypatch, since the public capabilityOverrides
    # mechanism only toggles 0/210_000_000, not an arbitrary partial value)
    # below the isolated customer's demand, while enabling an alternate
    # plant. The LP must cap plant-1's inbound flow at the lowered value and
    # route the remainder through the alternate plant, staying feasible.
    reduced_cap = dict(solve_mod.JADE_CAPABILITY)
    reduced_cap[("plant-1", "product-1")] = 200.0
    monkeypatch.setattr(solve_mod, "JADE_CAPABILITY", reduced_cap)

    result = solve_jade({
        "p": 1, "distanceBands": [200, 400, 800, 1600], "gap": 0, "timeLimitSec": 30,
        "excludedCustomerIds": _all_base_customer_ids(),
        "addedWarehouses": [{"id": "test-wh", "city": "Testville", "state": "ZZ",
                             "lat": 40.0, "lng": -90.0, "status": "forced_open"}],
        "addedCustomers": [{"id": "test-cust", "city": "Testville", "state": "ZZ", "lat": 40.0, "lng": -90.0,
                            "demands": {"product-1": 500.0, "product-2": 0.0, "product-3": 0.0, "product-4": 0.0}}],
        "capabilityOverrides": [{"plantId": "plant-4", "productId": "product-1", "enabled": True}],
        "distanceOverrides": [
            {"leg": "plant_to_warehouse", "fromId": "plant-1", "toId": "test-wh", "distance": 300.0},
            {"leg": "plant_to_warehouse", "fromId": "plant-4", "toId": "test-wh", "distance": 300.0},
            {"leg": "warehouse_to_customer", "fromId": "test-wh", "toId": "test-cust", "distance": 50.0},
        ],
    })
    assert result["status"] == "optimal", result.get("infeasibilityReason")
    inbound = {e["fromId"]: e["flow"] for e in result["edges"] if e["leg"] == "plant_to_warehouse"}
    assert inbound.get("plant-1", 0) <= 201  # capacity actually caps plant-1's inbound flow
    assert inbound.get("plant-4", 0) > 0     # overflow routed through the alternate enabled plant
    assert inbound.get("plant-1", 0) + inbound.get("plant-4", 0) == pytest.approx(500, abs=1)


def test_flow_balance_generalizes():
    # The spec's constraint 2 (flow conservation at warehouse per product) is
    # written summed over PLANTS (`lpSum(flow_pw[pl, w, k] for pl in
    # plants)`), not per (plant, warehouse, product) pair -- mirroring
    # Ch10's test_flow_balance_generalizes over-constraining guard. A
    # per-pair bug would force EACH capable plant to independently supply
    # the customer's FULL demand, doubling total inbound flow with no error
    # raised. This test adds a synthetic 2nd plant (via the real
    # addedPlants/capabilityOverrides input surface, not solve.py module
    # monkeypatching) capable of the same product and asserts total inbound
    # flow equals total outbound flow, never ~2x it.
    result = solve_jade({
        "p": 1, "distanceBands": [200, 400, 800, 1600], "gap": 0, "timeLimitSec": 30,
        "excludedCustomerIds": _all_base_customer_ids(),
        "addedPlants": [{"id": "plant-5-test", "city": "Testville", "state": "ZZ", "lat": 40.0, "lng": -90.0}],
        "addedWarehouses": [{"id": "test-wh", "city": "Testville", "state": "ZZ",
                             "lat": 40.0, "lng": -90.0, "status": "forced_open"}],
        "addedCustomers": [{"id": "test-cust", "city": "Testville", "state": "ZZ", "lat": 40.0, "lng": -90.0,
                            "demands": {"product-1": 300.0, "product-2": 0.0, "product-3": 0.0, "product-4": 0.0}}],
        "capabilityOverrides": [{"plantId": "plant-5-test", "productId": "product-1", "enabled": True}],
        "distanceOverrides": [
            {"leg": "plant_to_warehouse", "fromId": "plant-1", "toId": "test-wh", "distance": 100.0},
            {"leg": "plant_to_warehouse", "fromId": "plant-5-test", "toId": "test-wh", "distance": 100.0},
            {"leg": "warehouse_to_customer", "fromId": "test-wh", "toId": "test-cust", "distance": 50.0},
        ],
    })
    assert result["status"] == "optimal", result.get("infeasibilityReason")
    total_inbound = sum(e["flow"] for e in result["edges"] if e["leg"] == "plant_to_warehouse")
    total_outbound = sum(e["flow"] for e in result["edges"] if e["leg"] == "warehouse_to_customer")
    assert total_outbound == pytest.approx(300, abs=1)
    assert total_inbound == pytest.approx(300, abs=1), (
        f"total_inbound={total_inbound} should equal total_outbound={total_outbound}; "
        "a per-(plant,warehouse,product) balance bug would give ~2x"
    )
    assert total_inbound < 1.5 * total_outbound
