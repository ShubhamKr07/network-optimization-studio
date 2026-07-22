"""D1.1: per-warehouse capacity overrides, per-customer demand overrides, and
customer exclusions in solve_pmedian (p-median-us). Brazil's
solve_capacitated_pmedian is out of scope for this task — it has no working
warehouse/customer table UI to drive overrides yet."""
import json
import subprocess
import sys
from pathlib import Path

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
    return json.loads(result.stdout)


BASE_INPUT = {
    "pValue": 1,
    "distanceBands": [200, 400, 800, 1600],
    "uniformCapacity": None,
    "warehouseStatuses": [{"warehouseId": "ALN", "status": "forced_open"}],
    "excludedCustomerIds": [f"C{n}" for n in range(1, 201) if n not in (1, 2)],
    "gap": 0.0,
    "timeLimitSec": 120,
}

# ALN->C1 = 374mi, ALN->C2 = 2041mi (base dataset). demand(C1)=205375, demand(C2)=535923.


def test_demand_override_shifts_objective_as_hand_computed():
    base = run_solver(BASE_INPUT)
    assert base["status"] == "optimal"

    overridden = run_solver({**BASE_INPUT, "customerDemands": {"C1": 100000}})
    assert overridden["status"] == "optimal"

    expected_delta = (100000 - 205375) * 374
    assert overridden["objective"] - base["objective"] == expected_delta


def test_per_warehouse_capacity_binds_and_is_not_exceeded():
    payload = {
        **BASE_INPUT,
        "pValue": 2,
        "warehouseStatuses": [
            {"warehouseId": "ALN", "status": "forced_open"},
            {"warehouseId": "ATL", "status": "forced_open"},
        ],
        "excludedCustomerIds": [f"C{n}" for n in range(1, 201) if n not in (1, 3)],
        "warehouseCapacities": {"ALN": 300000},
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"

    aln_demand = sum(
        (205375 if a["customerId"] == "C1" else 147786)
        for a in out["assignments"]
        if a["warehouseId"] == "ALN"
    )
    assert aln_demand <= 300000


def test_excluded_customer_absent_from_assignments():
    payload = {
        **BASE_INPUT,
        "excludedCustomerIds": [f"C{n}" for n in range(1, 201) if n not in (1, 2, 3)] + ["C2"],
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"
    customer_ids = {a["customerId"] for a in out["assignments"]}
    assert "C2" not in customer_ids
    assert customer_ids == {"C1", "C3"}
