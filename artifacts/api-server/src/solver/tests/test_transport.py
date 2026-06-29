"""pytest tests for the Transportation LP model (Chapter 5 Coal LP) in solve.py."""
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

SOLVER_PY = Path(__file__).parent.parent / "solve.py"

ATHLETICS_WH_IDS = {"CHI", "LA", "ATL", "BOS", "DAL", "DEN", "IND", "KC", "MSP"}

TRANSPORT_BASE = {
    "pValue": 1,
    "distanceBands": [500, 1000, 2000],
    "capacityMode": "uniform",
    "uniformCapacity": None,
    "warehouseStatuses": [],
    "gap": 0.0,
    "timeLimitSec": 120,
    "modelType": "transport",
    "capacityFactor": 1.0,
    "singleSource": False,
    "capacityInactive": False,
}


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


# ── Output schema ──────────────────────────────────────────────────────────────

class TestTransportOutputSchema:
    def test_status_is_optimal(self):
        out = run_solver(TRANSPORT_BASE)
        assert out["status"] == "optimal"

    def test_assignments_non_empty(self):
        out = run_solver(TRANSPORT_BASE)
        assert len(out["assignments"]) > 0

    def test_each_assignment_has_flow_fields(self):
        out = run_solver(TRANSPORT_BASE)
        for a in out["assignments"]:
            assert "warehouseId" in a, "missing warehouseId (mine)"
            assert "customerId" in a, "missing customerId (station)"
            assert "flowTons" in a, "missing flowTons"
            assert "flowFraction" in a, "missing flowFraction"
            assert "distanceMi" in a, "missing distanceMi"

    def test_flow_tons_are_positive(self):
        out = run_solver(TRANSPORT_BASE)
        for a in out["assignments"]:
            assert a["flowTons"] > 0, f"Non-positive flow: {a}"

    def test_distance_mi_are_positive(self):
        out = run_solver(TRANSPORT_BASE)
        for a in out["assignments"]:
            assert a["distanceMi"] > 0, f"Non-positive distance: {a}"

    def test_flow_fractions_between_zero_and_one(self):
        out = run_solver(TRANSPORT_BASE)
        for a in out["assignments"]:
            assert 0 < a["flowFraction"] <= 1.0 + 1e-6, (
                f"Fraction {a['flowFraction']} out of range for {a}"
            )

    def test_objective_positive(self):
        out = run_solver(TRANSPORT_BASE)
        assert out["objective"] > 0

    def test_weighted_avg_distance_positive(self):
        out = run_solver(TRANSPORT_BASE)
        assert out["weightedAvgDistanceMi"] > 0

    def test_infeasibility_reason_null_on_success(self):
        out = run_solver(TRANSPORT_BASE)
        assert out["infeasibilityReason"] is None

    def test_run_time_non_negative(self):
        out = run_solver(TRANSPORT_BASE)
        assert out["runTimeSec"] >= 0


# ── Uses coal dataset, not athletics ──────────────────────────────────────────

class TestTransportDataset:
    def test_mine_ids_are_not_athletics_warehouse_ids(self):
        out = run_solver(TRANSPORT_BASE)
        mine_ids = {a["warehouseId"] for a in out["assignments"]}
        overlap = mine_ids & ATHLETICS_WH_IDS
        assert len(overlap) == 0, (
            f"Transport result contains Athletics IDs as mines: {overlap}"
        )

    def test_all_power_stations_receive_coal(self):
        """Every power station must be served (demand must be met)."""
        out = run_solver(TRANSPORT_BASE)
        station_ids = {a["customerId"] for a in out["assignments"]}
        # Coal dataset has 15 power stations
        assert len(station_ids) == 15, (
            f"Expected 15 stations served, got {len(station_ids)}: {station_ids}"
        )

    def test_each_station_demand_fully_met(self):
        """flowFraction is the fraction of a station's demand served by one mine.
        Per-station fractions must sum to 1.0 (all demand is satisfied)."""
        out = run_solver(TRANSPORT_BASE)
        fractions_by_station = defaultdict(float)
        for a in out["assignments"]:
            fractions_by_station[a["customerId"]] += a["flowFraction"]
        for station, total in fractions_by_station.items():
            assert abs(total - 1.0) < 0.01, (
                f"Station {station} fractions sum to {total:.4f}, expected 1.0"
            )


# ── Capacity factor ────────────────────────────────────────────────────────────

class TestCapacityFactor:
    def test_capacity_factor_1_1_objective_leq_base(self):
        """More mine capacity → looser constraints → objective can only improve."""
        base = run_solver(TRANSPORT_BASE)
        slack = run_solver({**TRANSPORT_BASE, "capacityFactor": 1.1})
        assert base["status"] == "optimal"
        assert slack["status"] == "optimal"
        assert slack["objective"] <= base["objective"] + 1, (
            f"Slack objective {slack['objective']} > base {base['objective']}"
        )

    def test_capacity_inactive_objective_leq_base(self):
        """Removing capacity constraints gives the global LP lower bound."""
        base = run_solver(TRANSPORT_BASE)
        uncapped = run_solver({**TRANSPORT_BASE, "capacityInactive": True})
        assert base["status"] == "optimal"
        assert uncapped["status"] == "optimal"
        assert uncapped["objective"] <= base["objective"] + 1

    def test_capacity_inactive_vs_factor_1_1_ordering(self):
        """Uncapacitated ≤ +10% capacity ≤ base capacity (relaxation hierarchy)."""
        base = run_solver(TRANSPORT_BASE)
        slack = run_solver({**TRANSPORT_BASE, "capacityFactor": 1.1})
        uncapped = run_solver({**TRANSPORT_BASE, "capacityInactive": True})
        if all(o["status"] == "optimal" for o in [base, slack, uncapped]):
            assert uncapped["objective"] <= slack["objective"] + 1
            assert slack["objective"] <= base["objective"] + 1

    def test_tight_capacity_completes_without_crash(self):
        """Very tight capacity (0.5×) may be infeasible — just ensure no crash."""
        out = run_solver({**TRANSPORT_BASE, "capacityFactor": 0.5})
        assert out["status"] in ("optimal", "infeasible")
        assert "assignments" in out


# ── Single source ──────────────────────────────────────────────────────────────

class TestSingleSource:
    def test_single_source_each_station_from_exactly_one_mine(self):
        out = run_solver({**TRANSPORT_BASE, "singleSource": True})
        assert out["status"] in ("optimal", "infeasible")
        if out["status"] != "optimal":
            return
        mines_per_station = defaultdict(set)
        for a in out["assignments"]:
            mines_per_station[a["customerId"]].add(a["warehouseId"])
        for station, mines in mines_per_station.items():
            assert len(mines) == 1, (
                f"Station {station} receives from {len(mines)} mines in single-source mode"
            )

    def test_single_source_objective_geq_lp_relaxation(self):
        """Single-source (ILP) is more constrained than LP → objective ≥ LP."""
        lp = run_solver(TRANSPORT_BASE)
        ss = run_solver({**TRANSPORT_BASE, "singleSource": True})
        if lp["status"] == "optimal" and ss["status"] == "optimal":
            assert ss["objective"] >= lp["objective"] - 1

    def test_single_source_flow_fractions_are_binary(self):
        """In single-source mode each assignment fraction must be 0 or 1."""
        out = run_solver({**TRANSPORT_BASE, "singleSource": True})
        if out["status"] == "optimal":
            for a in out["assignments"]:
                is_binary = abs(a["flowFraction"] - 1.0) < 0.01
                assert is_binary, (
                    f"Single-source fraction should be 1.0, got {a['flowFraction']}"
                )
