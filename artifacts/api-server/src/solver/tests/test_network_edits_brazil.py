"""SCN v0.3 Phase B, task B6.3 — golden end-to-end tests proving
`addedWarehouses`/`addedCustomers`/`distanceOverrides` (B1.1's schema, merged
by `build_merged_brazil_dataset`) actually change a real
`solve_capacitated_pmedian` (p-median-brazil) solve — not just that the merge
helper builds the right dict in isolation (that's `test_merge_inputs_brazil.py`'s
job). Mirrors `test_network_edits.py`'s subprocess convention exactly.

`p-median-brazil`'s base solve function has NO forced-open/inactive/excluded
mechanism for BASE warehouses/regions at all (no `warehouseStatuses`/
`excludedCustomerIds` handling — D1.1's per-warehouse override table was
never built for this model, confirmed by reading solve_capacitated_pmedian
directly). So unlike `test_network_edits.py`, these tests can't "force open"
two specific BASE warehouses to make the P selection deterministic — instead
they use ADDED warehouses' own `forced_open`/`inactive` status (which B6.3
DID wire up) to pin the facility selection, keeping every assertion
deterministic without depending on which base warehouses the solver happens
to pick."""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _envelope_compat import flatten_envelope  # noqa: E402

SOLVER_PY = Path(__file__).parent.parent / "solve.py"


def run_solver(payload: dict) -> dict:
    result = subprocess.run(
        [sys.executable, str(SOLVER_PY)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, f"Solver exited {result.returncode}: {result.stderr}"
    return flatten_envelope(json.loads(result.stdout))


BASE_INPUT = {
    "modelType": "capacitated_pmedian",
    "pValue": 2,
    "warehouseCapacity": 200_000_000,  # deliberately far above total Brazil demand
    "singleSource": False,             # LP relaxation — keeps assertions simple
    "gap": 0.0,
    "timeLimitSec": 60,
    "distanceBands": [500, 1000, 2000, 4000],
    "addedWarehouses": [
        {"id": "WH-A", "city": "A-City", "state": "XX", "lat": -10.0, "lng": -50.0, "status": "forced_open"},
        {"id": "WH-B", "city": "B-City", "state": "XX", "lat": -12.0, "lng": -52.0, "status": "forced_open"},
    ],
    # WH-A is the only one with a real distance to SP — WH-B's is the 9999
    # missing-pair sentinel (same as p-median-us) until overridden below.
    "distanceOverrides": [{"fromId": "WH-A", "toId": "SP", "distance": 50.0}],
}


def test_distance_override_flips_assignment_to_the_artificially_closer_warehouse():
    base = run_solver(BASE_INPUT)
    assert base["status"] == "optimal"
    base_assignment = next(a for a in base["assignments"] if a["customerId"] == "SP")
    assert base_assignment["warehouseId"] == "WH-A"
    assert base_assignment["distanceMi"] == 50.0

    overridden = run_solver({
        **BASE_INPUT,
        "distanceOverrides": BASE_INPUT["distanceOverrides"] + [
            {"fromId": "WH-B", "toId": "SP", "distance": 1.0},
        ],
    })
    assert overridden["status"] == "optimal"
    overridden_assignment = next(a for a in overridden["assignments"] if a["customerId"] == "SP")
    assert overridden_assignment["warehouseId"] == "WH-B"
    assert overridden_assignment["distanceMi"] == 1.0


ADDED_WAREHOUSE_BASE = {
    "modelType": "capacitated_pmedian",
    "pValue": 1,
    "warehouseCapacity": 200_000_000,
    "singleSource": False,
    "gap": 0.0,
    "timeLimitSec": 60,
    "distanceBands": [500, 1000, 2000, 4000],
}


def test_forced_open_added_warehouse_wins_the_only_p_slot():
    payload = {
        **ADDED_WAREHOUSE_BASE,
        "addedWarehouses": [
            {"id": "WH-NEW-1", "city": "Nova", "state": "XX", "lat": -10.0, "lng": -50.0, "status": "forced_open"},
        ],
        "distanceOverrides": [],
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"
    assert out["openWarehouseIds"] == ["WH-NEW-1"]
    # Every region ends up assigned to the one open facility.
    assert {a["warehouseId"] for a in out["assignments"]} == {"WH-NEW-1"}


def test_inactive_added_warehouse_never_opens_even_when_every_base_warehouse_could():
    payload = {
        **ADDED_WAREHOUSE_BASE,
        "pValue": 25,  # exactly the number of real p-median-brazil base warehouses
        "addedWarehouses": [
            {"id": "WH-NEW-2", "city": "Nova2", "state": "XX", "lat": -10.0, "lng": -50.0, "status": "inactive"},
        ],
        "distanceOverrides": [],
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"
    assert len(out["openWarehouseIds"]) == 25
    assert "WH-NEW-2" not in out["openWarehouseIds"]


def test_added_customer_gets_served_using_its_own_demand_and_only_available_route():
    payload = {
        **ADDED_WAREHOUSE_BASE,
        "addedWarehouses": [
            {"id": "WH-ONLY", "city": "Only", "state": "XX", "lat": -10.0, "lng": -50.0, "status": "forced_open"},
        ],
        "addedCustomers": [
            {"id": "REG-NEW-1", "city": "New Region", "state": "XX", "lat": -8.0, "lng": -48.0, "demand": 4242},
        ],
        "distanceOverrides": [{"fromId": "WH-ONLY", "toId": "REG-NEW-1", "distance": 88.0}],
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"
    reg_assignment = next(a for a in out["assignments"] if a["customerId"] == "REG-NEW-1")
    assert reg_assignment == {
        "customerId": "REG-NEW-1", "warehouseId": "WH-ONLY", "distanceMi": 88.0,
        "band": 0, "flowFraction": 1.0,
    }
