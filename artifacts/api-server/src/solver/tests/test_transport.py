"""pytest tests for the Transportation LP model (Chapter 5 Coal LP) in solve.py."""
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
from _envelope_compat import flatten_envelope  # noqa: E402
from solve import solve_transport  # noqa: E402

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
    return flatten_envelope(json.loads(result.stdout))


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


# ── Per-mine capacity override (mineCapacities) ────────────────────────────────

def test_mine_capacity_override_binds():
    # KY's base capacity is 25,000,000 tons. The coal dataset is perfectly
    # balanced (70M total supply == 70M total demand), so with capacityFactor=1.0
    # every mine is pinned at 100% and reducing any one mine's cap makes the
    # whole model infeasible. To demonstrate the override *binding* while
    # staying feasible we give the system slack via capacityFactor=1.5
    # (total cap = 105M > 70M demand), then override KY down to 5,000,000 --
    # far below the 8.5M tons KY normally ships with that slack -- so the
    # override must visibly reduce KY's outbound flow versus an unoverridden
    # solve. The override is applied BEFORE the capacityFactor multiplier
    # (effective_cap = 5M * 1.5 = 7.5M), matching the plan's documented
    # semantics for mineCapsacities.
    base = solve_transport({
        "capacityFactor": 1.5, "singleSource": False, "capacityInactive": False,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
    })
    base_ky_flow = sum(e["flow"] for e in base["edges"] if e["fromId"] == "KY")
    assert base_ky_flow > 7_500_000  # sanity: KY normally ships more than the override cap

    overridden = solve_transport({
        "capacityFactor": 1.5, "singleSource": False, "capacityInactive": False,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
        "mineCapacities": {"KY": 5_000_000},
    })
    ky_flow = sum(e["flow"] for e in overridden["edges"] if e["fromId"] == "KY")
    assert ky_flow <= 7_500_000 + 1  # +1 for rounding (flow_tons = round(flow_val))
    assert overridden["status"] == "optimal"

def test_mine_capacity_override_absent_matches_base():
    # No mineCapacities key at all must solve byte-identically to today.
    result = solve_transport({
        "capacityFactor": 1.0, "singleSource": False, "capacityInactive": False,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
    })
    assert result["status"] == "optimal"
    assert result["objective"] > 0  # smoke check -- the real byte-identical
    # comparison against the textbook's published answer is e2e_accuracy.py's
    # job, run separately per this plan's Global Constraints


# ── Per-station demand override (stationDemands) ──────────────────────────────

def test_station_demand_override_changes_equality_and_total():
    # CHI's base demand is 6,000,000 tons. Override it to 12,000,000 --
    # total flow into CHI, and total_demand-derived avg_dist, must both
    # reflect the new value. The coal dataset is perfectly balanced (70M
    # supply == 70M demand), so raising CHI's demand to 12M (76M total)
    # would exceed the 70M supply at capacityFactor=1.0 and report
    # infeasible; capacityFactor=1.5 gives slack (105M cap > 76M demand)
    # so the demand override can actually be met.
    base = solve_transport({
        "capacityFactor": 1.5, "singleSource": False, "capacityInactive": False,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
    })
    base_chi_flow = sum(e["flow"] for e in base["edges"] if e["toId"] == "CHI")
    assert base_chi_flow == 6_000_000

    overridden = solve_transport({
        "capacityFactor": 1.5, "singleSource": False, "capacityInactive": False,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
        "stationDemands": {"CHI": 12_000_000},
    })
    assert overridden["status"] == "optimal"
    chi_flow = sum(e["flow"] for e in overridden["edges"] if e["toId"] == "CHI")
    assert abs(chi_flow - 12_000_000) <= 1  # rounding
    # avg distance = objective / total_demand -- total_demand must include
    # the overridden 12M for CHI, not the base 6M, so this must differ from
    # a naive (wrong) recompute that ignored the override.
    assert overridden["metrics"]["weightedAvgDistance"] != base["metrics"]["weightedAvgDistance"]

def test_station_demand_override_with_single_source_stays_consistent():
    # Regression guard for the "two solver sites" risk the design doc calls
    # out: the demand equality AND the single-source big-M link must both
    # use the same effective (overridden) demand, or this could produce an
    # inconsistent/wrong-but-not-obviously-broken model.
    result = solve_transport({
        "capacityFactor": 1.0, "singleSource": True, "capacityInactive": True,
        "distanceBands": [500, 1000, 1500, 2000], "gap": 0, "timeLimitSec": 30,
        "stationDemands": {"LAX": 2_000_000},
    })
    assert result["status"] == "optimal"
    lax_flow = sum(e["flow"] for e in result["edges"] if e["toId"] == "LAX")
    assert abs(lax_flow - 2_000_000) <= 1
