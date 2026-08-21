"""B6.1: golden end-to-end tests proving `addedMines`/`addedStations`/
`laneCostOverrides` (fast-follow of B1.1's schema, resolved via
build_merged_transport_dataset in merge_inputs.py) actually change a real
`solve_transport` solve — not just that the merge helper builds the right
dict in isolation (that's `test_merge_inputs_transport.py`'s job). Mirrors
`test_network_edits.py`/`test_network_edits_brazil.py`'s subprocess
convention exactly."""
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


TRANSPORT_BASE = {
    "modelType": "transport",
    "distanceBands": [500, 1000, 1500, 2000],
    "gap": 0.0,
    "timeLimitSec": 30,
    "capacityFactor": 1.0,
    "singleSource": False,
    "capacityInactive": False,
}


def test_lane_cost_override_flips_optimal_flow_assignment():
    # Base lane costs to CHI (verified directly against costs.json):
    # KY=463.7, WY=1362.6, PA=489.2, IA=397.4 — CHI naturally prefers IA.
    # Isolate to a single station/mine pair via capacityInactive so a
    # lane-cost override deterministically flips which mine serves CHI.
    payload = {
        **TRANSPORT_BASE,
        "capacityInactive": True,
        "stationDemands": {s: 0 for s in ("LAX", "NYC", "HOU", "ATL", "DAL", "PHX", "NYN", "STL", "BAL", "PIT", "SEA", "DEN", "MCI", "SFO")},
    }
    base = run_solver(payload)
    assert base["status"] == "optimal"
    chi_rows = [a for a in base["assignments"] if a["customerId"] == "CHI" and a["flowTons"] > 0]
    assert len(chi_rows) == 1
    assert chi_rows[0]["warehouseId"] == "IA"

    overridden = run_solver({
        **payload,
        "laneCostOverrides": [{"fromId": "WY", "toId": "CHI", "cost": 1.0}],
    })
    assert overridden["status"] == "optimal"
    chi_rows_2 = [a for a in overridden["assignments"] if a["customerId"] == "CHI" and a["flowTons"] > 0]
    assert len(chi_rows_2) == 1
    assert chi_rows_2[0]["warehouseId"] == "WY"
    assert chi_rows_2[0]["distanceMi"] == 1.0


def test_added_mine_with_capacity_can_supply_stations():
    # Isolate to a single station (CHI, demand 6,000,000) served only by a
    # brand-new mine with its own capacity and a lane cost override — no
    # base mine has zero cost, so cost drives the added mine to be used, and
    # capacity from its own record (not mineCapacities) must be sufficient.
    payload = {
        **TRANSPORT_BASE,
        "capacityInactive": True,
        "stationDemands": {s: 0 for s in ("LAX", "NYC", "HOU", "ATL", "DAL", "PHX", "NYN", "STL", "BAL", "PIT", "SEA", "DEN", "MCI", "SFO")},
        "addedMines": [
            {"id": "MN-NEW-1", "city": "Bristol", "state": "VA", "lat": 36.6, "lng": -82.19, "capacity": 10_000_000},
        ],
        "laneCostOverrides": [{"fromId": "MN-NEW-1", "toId": "CHI", "cost": 1.0}],
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"
    chi_rows = [a for a in out["assignments"] if a["customerId"] == "CHI" and a["flowTons"] > 0]
    assert len(chi_rows) == 1
    assert chi_rows[0]["warehouseId"] == "MN-NEW-1"
    assert chi_rows[0]["flowTons"] == 6_000_000


def test_added_mine_capacity_binds_from_its_own_record_not_a_sparse_override():
    # The added mine's capacity (2,000,000) comes only from the addedMines
    # entry itself — no mineCapacities entry is sent for it — yet it must
    # still bind: CHI alone (demand 6,000,000) exceeds it, so with capacity
    # active and only the added mine cost-competitive the model can't fully
    # satisfy CHI's demand from the added mine and must be infeasible if we
    # ALSO disable every base mine's ability to serve CHI (cost so high it's
    # never chosen isn't provable within an LP's tolerance, so instead we
    # remove every base mine from contention by zeroing their capacity via
    # mineCapacities, isolating supply to only the added, capacity-bound
    # mine).
    payload = {
        **TRANSPORT_BASE,
        "capacityInactive": False,
        "stationDemands": {s: 0 for s in ("LAX", "NYC", "HOU", "ATL", "DAL", "PHX", "NYN", "STL", "BAL", "PIT", "SEA", "DEN", "MCI", "SFO")},
        "mineCapacities": {"KY": 0, "WY": 0, "PA": 0, "IA": 0},
        "addedMines": [
            {"id": "MN-NEW-1", "city": "Bristol", "state": "VA", "lat": 36.6, "lng": -82.19, "capacity": 2_000_000},
        ],
        "laneCostOverrides": [{"fromId": "MN-NEW-1", "toId": "CHI", "cost": 1.0}],
    }
    out = run_solver(payload)
    assert out["status"] == "infeasible"


def test_added_station_gets_served_using_its_own_demand_and_only_available_route():
    payload = {
        **TRANSPORT_BASE,
        "capacityInactive": True,
        "stationDemands": {s: 0 for s in ("LAX", "NYC", "CHI", "HOU", "ATL", "DAL", "PHX", "NYN", "STL", "BAL", "PIT", "SEA", "DEN", "MCI", "SFO")},
        "addedStations": [
            {"id": "ST-NEW-1", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81, "demand": 4242},
        ],
        "laneCostOverrides": [{"fromId": "KY", "toId": "ST-NEW-1", "cost": 88.0}],
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"
    st_rows = [a for a in out["assignments"] if a["customerId"] == "ST-NEW-1"]
    assert len(st_rows) == 1
    assert st_rows[0]["warehouseId"] == "KY"
    assert st_rows[0]["flowTons"] == 4242
    assert st_rows[0]["distanceMi"] == 88.0
    # Demand-weighted objective proves the added station's own demand (not
    # some sparse-override or base-dataset fallback) drove the math.
    assert out["objective"] == 4242 * 88.0
