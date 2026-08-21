"""B3.1: golden end-to-end tests proving `addedWarehouses`/`addedCustomers`/
`distanceOverrides` (B1.1's schema, resolved via B1.3's bridge, merged by
B3.1's `build_merged_pmedian_dataset`) actually change a real `solve_pmedian`
solve — not just that the merge helper builds the right dict in isolation
(that's `test_merge_inputs.py`'s job). Mirrors `test_overrides.py`'s
subprocess convention exactly. Deliberately not exhaustive — B3.2 extends
this file/`test_overrides.py` more thoroughly."""
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
        timeout=60,
    )
    assert result.returncode == 0, f"Solver exited {result.returncode}: {result.stderr}"
    return flatten_envelope(json.loads(result.stdout))


# ALN->C1 = 374mi, ATL->C1 = 625mi (base dataset) — C1 naturally prefers ALN.
DISTANCE_OVERRIDE_BASE = {
    "pValue": 2,
    "distanceBands": [200, 400, 800, 1600],
    "uniformCapacity": None,
    "warehouseStatuses": [
        {"warehouseId": "ALN", "status": "forced_open"},
        {"warehouseId": "ATL", "status": "forced_open"},
    ],
    "excludedCustomerIds": [f"C{n}" for n in range(1, 201) if n != 1],
    "gap": 0.0,
    "timeLimitSec": 120,
}


def test_distance_override_flips_assignment_to_the_artificially_closer_warehouse():
    base = run_solver(DISTANCE_OVERRIDE_BASE)
    assert base["status"] == "optimal"
    base_assignment = next(a for a in base["assignments"] if a["customerId"] == "C1")
    assert base_assignment["warehouseId"] == "ALN"
    assert base_assignment["distanceMi"] == 374

    overridden = run_solver({
        **DISTANCE_OVERRIDE_BASE,
        "distanceOverrides": [{"fromId": "ATL", "toId": "C1", "distance": 1.0}],
    })
    assert overridden["status"] == "optimal"
    overridden_assignment = next(a for a in overridden["assignments"] if a["customerId"] == "C1")
    assert overridden_assignment["warehouseId"] == "ATL"
    assert overridden_assignment["distanceMi"] == 1.0


ADDED_WAREHOUSE_BASE = {
    "pValue": 1,
    "distanceBands": [200, 400, 800, 1600],
    "uniformCapacity": None,
    "warehouseStatuses": [],
    "excludedCustomerIds": [f"C{n}" for n in range(1, 201) if n not in (1, 2)],
    "gap": 0.0,
    "timeLimitSec": 120,
}


def test_added_warehouse_wins_p_slot_over_every_existing_warehouse_when_genuinely_closer():
    payload = {
        **ADDED_WAREHOUSE_BASE,
        "addedWarehouses": [
            {"id": "WH-NEW-1", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81,
             "status": "active"},
        ],
        "distanceOverrides": [
            {"fromId": "WH-NEW-1", "toId": "C1", "distance": 1.0},
            {"fromId": "WH-NEW-1", "toId": "C2", "distance": 1.0},
        ],
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"
    assert out["openWarehouseIds"] == ["WH-NEW-1"]
    assert {a["warehouseId"] for a in out["assignments"]} == {"WH-NEW-1"}
    assert {a["customerId"] for a in out["assignments"]} == {"C1", "C2"}


def test_added_warehouse_capacity_binds_from_its_own_record_not_a_sparse_override():
    # WH-NEW-1's capacity (30000) comes only from the addedWarehouses entry
    # itself — no warehouseCapacities entry is sent for it — yet it should
    # still bind: C1 alone (demand 205375) exceeds it, so with only WH-NEW-1
    # available the model must be infeasible.
    payload = {
        **ADDED_WAREHOUSE_BASE,
        "excludedCustomerIds": [f"C{n}" for n in range(1, 201) if n != 1],
        "addedWarehouses": [
            {"id": "WH-NEW-1", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81,
             "capacity": 30000, "status": "forced_open"},
        ],
        "distanceOverrides": [{"fromId": "WH-NEW-1", "toId": "C1", "distance": 1.0}],
    }
    out = run_solver(payload)
    assert out["status"] == "infeasible"


def test_added_customer_gets_served_using_its_own_demand_and_only_available_route():
    payload = {
        **ADDED_WAREHOUSE_BASE,
        "excludedCustomerIds": [f"C{n}" for n in range(1, 201)],  # exclude every base customer
        "warehouseStatuses": [{"warehouseId": "ALN", "status": "forced_open"}],
        "addedCustomers": [
            {"id": "CUST-NEW-1", "city": "Fresno", "lat": 36.74, "lng": -119.77, "demand": 4242},
        ],
        "distanceOverrides": [{"fromId": "ALN", "toId": "CUST-NEW-1", "distance": 88.0}],
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"
    assert out["assignments"] == [
        {"customerId": "CUST-NEW-1", "warehouseId": "ALN", "distanceMi": 88.0, "band": 0},
    ]
    # Demand-weighted objective proves the added customer's own demand (not
    # some sparse-override or base-dataset fallback) drove the math.
    assert out["objective"] == 4242 * 88.0
