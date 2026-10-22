import os, sys
tests_dir = os.path.dirname(os.path.abspath(__file__))
solver_dir = os.path.dirname(tests_dir)
sys.path.insert(0, tests_dir); sys.path.insert(0, solver_dir)
import solve as solve_mod
from solve import _solve_two_echelon_core

RATES = {"icTransCost": 0.07, "icMinTrans": 10.0, "obTransCost": 0.12, "obMinTrans": 10.0}

def _tiny(plant_cost, capability=None):
    # 2 plants, 2 warehouses, 2 customers, 1 product; p=1
    dist = {("P1","W1"): 100, ("P1","W2"): 300, ("P2","W1"): 300, ("P2","W2"): 100,
            ("W1","C1"): 100, ("W1","C2"): 200, ("W2","C1"): 200, ("W2","C2"): 100}
    return _solve_two_echelon_core(
        plants=["P1","P2"], warehouses=["W1","W2"], customers=["C1","C2"], product_ids=["K"],
        demands={"C1": {"K": 100.0}, "C2": {"K": 100.0}},
        capability=capability or {("P1","K"): 1e6, ("P2","K"): 1e6},
        plant_cost=plant_cost, dist=dist, get_bounds=lambda w: (0, 1), p=1,
        distance_bands=[], gap=0.0, time_limit=60, rates=RATES,
        wh_label=lambda w: w, problem_uid="test-core")

def test_plant_cost_term_adds_exactly_flow_times_cost():
    base = _tiny({})
    costed = _tiny({("P1","K"): 5.0, ("P2","K"): 5.0})
    m = costed["metrics"]
    assert base["status"] == costed["status"] == "optimal"
    assert abs(m["plantVariableCost"] - 200 * 5.0) < 1e-6
    assert abs(costed["objective"] - (base["objective"] + 1000.0)) < 1e-4
    assert abs(m["totalCost"] - (m["inboundCost"] + m["outboundCost"] + m["plantVariableCost"])) <= 0.011  # each term rounded to cents

def test_plant_cost_changes_sourcing():
    # P1 made expensive -> all inbound flow comes from P2
    r = _tiny({("P1","K"): 100.0, ("P2","K"): 0.0})
    pw = [e for e in r["edges"] if e["leg"] == "plant_to_warehouse"]
    assert {e["fromId"] for e in pw} == {"P2"}

def test_capacity_cap_binds():
    r = _tiny({}, capability={("P1","K"): 150.0, ("P2","K"): 1e6})
    by_plant = {}
    for e in r["edges"]:
        if e["leg"] == "plant_to_warehouse":
            by_plant[e["fromId"]] = by_plant.get(e["fromId"], 0) + e["flow"]
    assert by_plant.get("P1", 0) <= 150

def test_capacity_shortfall_reason():
    r = _tiny({}, capability={("P1","K"): 50.0, ("P2","K"): 50.0})
    assert r["status"] == "infeasible"
    assert "capacity" in r["infeasibilityReason"].lower()

def test_weighted_average_distances_unrounded():
    r = _tiny({})
    m = r["metrics"]
    assert m["avgDistPlantToWh"] == 100.0 and m["avgDistWhToCustomer"] == 150.0
