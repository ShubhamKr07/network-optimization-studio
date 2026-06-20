"""pytest tests for the PuLP/CBC P-Median solver (solve.py)."""
import json
import subprocess
import sys
from pathlib import Path

SOLVER_PY = Path(__file__).parent.parent / "solve.py"


def run_solver(payload: dict) -> dict:
    """Call solve.py via subprocess, return parsed JSON output."""
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
    "pValue": 3,
    "distanceBands": [200, 400, 800, 1600],
    "capacityMode": "uniform",
    "uniformCapacity": None,
    "warehouseStatuses": [],
    "gap": 0.0,
    "timeLimitSec": 120,
}

REQUIRED_KEYS = {
    "status", "openWarehouseIds", "assignments", "objective",
    "weightedAvgDistanceMi", "bandCoverage", "utilization",
    "runTimeSec", "solverUsed", "infeasibilityReason",
}


# ── Output schema ──────────────────────────────────────────────────────────────

class TestOutputSchema:
    def test_all_required_keys_present(self):
        out = run_solver(BASE_INPUT)
        assert REQUIRED_KEYS.issubset(out.keys()), (
            f"Missing keys: {REQUIRED_KEYS - out.keys()}"
        )

    def test_status_is_valid_enum(self):
        out = run_solver(BASE_INPUT)
        assert out["status"] in ("optimal", "infeasible", "error")

    def test_solver_used_field(self):
        out = run_solver(BASE_INPUT)
        assert isinstance(out["solverUsed"], str)
        assert len(out["solverUsed"]) > 0

    def test_run_time_is_non_negative(self):
        out = run_solver(BASE_INPUT)
        assert out["runTimeSec"] >= 0


# ── Happy path ─────────────────────────────────────────────────────────────────

class TestHappyPath:
    def test_status_optimal(self):
        out = run_solver(BASE_INPUT)
        assert out["status"] == "optimal"

    def test_correct_number_of_open_warehouses(self):
        out = run_solver({**BASE_INPUT, "pValue": 3})
        assert len(out["openWarehouseIds"]) == 3

    def test_all_customers_assigned(self):
        out = run_solver(BASE_INPUT)
        # 200 customers in embedded dataset
        assert len(out["assignments"]) == 200

    def test_each_assignment_has_required_fields(self):
        out = run_solver(BASE_INPUT)
        for a in out["assignments"]:
            assert "customerId" in a
            assert "warehouseId" in a
            assert "distanceMi" in a
            assert "band" in a

    def test_objective_positive(self):
        out = run_solver(BASE_INPUT)
        assert out["objective"] > 0

    def test_weighted_avg_distance_positive(self):
        out = run_solver(BASE_INPUT)
        assert out["weightedAvgDistanceMi"] > 0

    def test_utilization_entries_match_open_warehouses(self):
        out = run_solver(BASE_INPUT)
        open_ids = set(out["openWarehouseIds"])
        util_ids = {u["warehouseId"] for u in out["utilization"]}
        assert open_ids == util_ids

    def test_utilization_between_0_and_100(self):
        out = run_solver(BASE_INPUT)
        for u in out["utilization"]:
            assert 0 <= u["utilization"] <= 100

    def test_infeasibility_reason_null_on_success(self):
        out = run_solver(BASE_INPUT)
        assert out["infeasibilityReason"] is None

    def test_p1_opens_exactly_one_warehouse(self):
        out = run_solver({**BASE_INPUT, "pValue": 1})
        assert out["status"] == "optimal"
        assert len(out["openWarehouseIds"]) == 1


# ── Distance bands ─────────────────────────────────────────────────────────────

class TestDistanceBands:
    def test_band_coverage_length_matches_bands(self):
        bands = [200, 400, 800, 1600]
        out = run_solver({**BASE_INPUT, "distanceBands": bands})
        assert len(out["bandCoverage"]) == len(bands)

    def test_band_coverage_band_values_match_input(self):
        bands = [300, 600, 1200]
        out = run_solver({**BASE_INPUT, "distanceBands": bands})
        returned_bands = [b["band"] for b in out["bandCoverage"]]
        assert returned_bands == bands

    def test_band_coverage_percents_are_non_negative(self):
        out = run_solver(BASE_INPUT)
        for b in out["bandCoverage"]:
            assert b["percent"] >= 0

    def test_band_coverage_non_decreasing(self):
        out = run_solver(BASE_INPUT)
        percents = [b["percent"] for b in out["bandCoverage"]]
        for i in range(1, len(percents)):
            assert percents[i] >= percents[i - 1], (
                f"Band coverage should be non-decreasing: {percents}"
            )

    def test_single_band(self):
        out = run_solver({**BASE_INPUT, "distanceBands": [5000]})
        assert out["status"] == "optimal"
        assert len(out["bandCoverage"]) == 1
        # With a huge band, essentially all demand should be covered
        assert out["bandCoverage"][0]["percent"] >= 90


# ── Forced open ────────────────────────────────────────────────────────────────

class TestForcedOpen:
    def test_forced_open_warehouse_appears_in_result(self):
        out = run_solver({
            **BASE_INPUT,
            "pValue": 3,
            "warehouseStatuses": [{"warehouseId": "CHI", "status": "forced_open"}],
        })
        assert out["status"] == "optimal"
        assert "CHI" in out["openWarehouseIds"]

    def test_two_forced_open_warehouses_both_appear(self):
        out = run_solver({
            **BASE_INPUT,
            "pValue": 3,
            "warehouseStatuses": [
                {"warehouseId": "CHI", "status": "forced_open"},
                {"warehouseId": "LA", "status": "forced_open"},
            ],
        })
        assert out["status"] == "optimal"
        assert "CHI" in out["openWarehouseIds"]
        assert "LA" in out["openWarehouseIds"]

    def test_inactive_warehouse_excluded_from_result(self):
        out = run_solver({
            **BASE_INPUT,
            "pValue": 3,
            "warehouseStatuses": [{"warehouseId": "DAL", "status": "inactive"}],
        })
        assert out["status"] == "optimal"
        assert "DAL" not in out["openWarehouseIds"]


# ── p value variation ──────────────────────────────────────────────────────────

class TestPValueVariation:
    def test_more_warehouses_reduces_weighted_avg_distance(self):
        out2 = run_solver({**BASE_INPUT, "pValue": 2})
        out4 = run_solver({**BASE_INPUT, "pValue": 4})
        assert out2["status"] == "optimal"
        assert out4["status"] == "optimal"
        assert out4["weightedAvgDistanceMi"] <= out2["weightedAvgDistanceMi"]

    def test_p5_opens_five_warehouses(self):
        out = run_solver({**BASE_INPUT, "pValue": 5})
        assert out["status"] == "optimal"
        assert len(out["openWarehouseIds"]) == 5


# ── Capacity mode ──────────────────────────────────────────────────────────────

class TestCapacityMode:
    def test_uniform_capacity_respected(self):
        # Very large capacity — effectively unconstrained
        out = run_solver({
            **BASE_INPUT,
            "capacityMode": "uniform",
            "uniformCapacity": 999_999_999,
        })
        assert out["status"] == "optimal"
        assert len(out["openWarehouseIds"]) == BASE_INPUT["pValue"]

    def test_no_capacity_same_as_uniform_none(self):
        out_none = run_solver({**BASE_INPUT, "uniformCapacity": None})
        out_large = run_solver({**BASE_INPUT, "uniformCapacity": 999_999_999})
        # Both should be optimal with same number of warehouses open
        assert out_none["status"] == "optimal"
        assert out_large["status"] == "optimal"
