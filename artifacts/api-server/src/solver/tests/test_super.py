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


import json, math
from merge_inputs import haversine_mi, build_super_dataset
from solve import solve_super
REPO = os.path.abspath(os.path.join(solver_dir, "..", "..", "..", ".."))
SAMPLE = os.path.join(REPO, "artifacts", "studio", "public", "samples", "super-model-sample.json")

def test_haversine_known_pair():
    # Los Angeles -> New York City, great-circle ~ 2445 mi with R=3959
    d = haversine_mi(33.974044, -118.248849, 40.75012, -73.997846)
    assert 2430 < d < 2460

def _mini_inputs(**kw):
    base = dict(p=1, gap=0, timeLimitSec=60, distanceMethod="haversine", circuityFactor=1.17,
        transportCosts=dict(RATES),
        products=[{"id": "K", "name": "K"}],
        plants=[{"id": "P1", "name": "P1", "lat": 40.0, "lng": -100.0}],
        warehouses=[{"id": "W1", "name": "W1", "lat": 40.0, "lng": -99.0, "status": "active"}],
        customers=[{"id": "C1", "name": "C1", "lat": 40.0, "lng": -98.0, "status": "active"},
                   {"id": "C2", "name": "C2", "lat": 41.0, "lng": -98.0, "status": "excluded"}],
        plantProducts=[{"plantId": "P1", "productId": "K", "capacity": 1000, "costPerUnit": 2}],
        demand=[{"customerId": "C1", "productId": "K", "demand": 10},
                {"customerId": "C2", "productId": "K", "demand": 99}],
        distanceOverrides=[])
    base.update(kw); return base

def test_distance_resolution_precedence():
    ds = build_super_dataset(_mini_inputs(distanceOverrides=[{"fromId": "P1", "toId": "W1", "miles": 7}]))
    assert ds["dist"][("P1","W1")] == 7
    hv = haversine_mi(40.0, -99.0, 40.0, -98.0)
    assert abs(ds["dist"][("W1","C1")] - hv) < 1e-9
    ds2 = build_super_dataset(_mini_inputs(distanceMethod="circuity", circuityFactor=1.5))
    assert abs(ds2["dist"][("W1","C1")] - hv * 1.5) < 1e-9
    assert "C2" not in ds["customers"] and "C2" not in ds["demands"]

def test_solve_super_mini():
    r = solve_super(_mini_inputs())
    assert r["status"] == "optimal"
    assert abs(r["metrics"]["plantVariableCost"] - 20) < 1e-6

def test_sample_network_reproduces_ch9_golden():
    inp = json.load(open(SAMPLE))
    r = solve_super(inp)
    assert r["status"] == "optimal"
    assert abs(r["objective"] - 254060828.6157) / 254060828.6157 < 1e-6
    assert set(r["details"]["openWarehouseIds"]) == {"wh-11", "wh-14"}
