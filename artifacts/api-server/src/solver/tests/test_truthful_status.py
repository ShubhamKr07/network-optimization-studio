"""B2: solve.py emits truthful solutionStatus/terminationReason from CBC's
own captured log/.sol evidence (cbc_termination.py's parse_cbc_termination),
never a hardcoded "optimal". Three cases, matching the task's literal DoD:
  - a gap-stopped solve  -> feasible / gap_limit
  - a proven solve       -> optimal  / optimality_proven
  - an infeasible solve  -> infeasible / infeasible

Each case is a real subprocess invocation of solve.py (not a unit-level
monkeypatch) so this exercises the exact same code path production uses --
mirrors test_overrides.py's/test_cbc_termination.py's own conventions.
"""
import json
import subprocess
import sys
from pathlib import Path

SOLVER_PY = Path(__file__).parent.parent / "solve.py"


def run_solver(payload: dict, timeout: int = 200) -> dict:
    result = subprocess.run(
        [sys.executable, str(SOLVER_PY)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    assert result.returncode == 0, f"Solver exited {result.returncode}: {result.stderr}"
    return json.loads(result.stdout)


class TestGapStoppedSolve:
    """P-median-brazil P=5 cap=20M gap=0.05 -- the exact scenario the design
    spec's Section 1 (and cbc_termination.py's own module docstring) cites as
    a real, reproducible gap-limited stop: CBC finds and proves a solution
    within the requested 5% gap, but does NOT prove global optimality."""

    def test_gap_stopped_reports_feasible_gap_limit(self):
        payload = dict(
            modelType="capacitated_pmedian", pValue=5, warehouseCapacity=20_000_000,
            distanceBands=[500, 1000, 2000, 4000], capacityMode="uniform",
            uniformCapacity=None, warehouseStatuses=[], gap=0.05, timeLimitSec=180,
            singleSource=False,
        )
        out = run_solver(payload)
        assert out["solutionStatus"] == "feasible"
        assert out["terminationReason"] == "gap_limit"
        # legacy `status` is the truthful projection -- never "optimal" for a
        # gap-limited stop (the exact defect B2 fixes).
        assert out["status"] == "feasible"
        assert out["status"] != "optimal"
        assert out["achievedGap"] is not None
        assert 0 < out["achievedGap"] < 0.05  # real gap tighter than the requested 5%
        assert out["solverIncumbentObjective"] is not None
        assert out["solverBestBound"] is not None
        # objective derivation itself is untouched by B2 (§2.9) -- still a
        # real, positive, usable objective value.
        assert out["objective"] > 0


class TestProvenSolve:
    """A small, fast, gap=0.0 p-median solve -- CBC proves global optimality
    (no gap tolerance to exploit at all)."""

    def test_proven_optimal_reports_optimal(self):
        payload = dict(
            modelType="p_median", pValue=3, distanceBands=[200, 400, 800, 1600],
            capacityMode="uniform", uniformCapacity=None, warehouseStatuses=[],
            gap=0.0, timeLimitSec=60, capacityFactor=1.0, singleSource=False,
            capacityInactive=False,
        )
        out = run_solver(payload)
        assert out["solutionStatus"] == "optimal"
        assert out["terminationReason"] == "optimality_proven"
        assert out["status"] == "optimal"
        assert out["achievedGap"] is None
        # a genuinely proven optimum never synthesizes a bound (cbc_termination
        # .py's own documented convention -- CBC prints none for a clean proof).
        assert out["solverBestBound"] is None
        assert out["solverIncumbentObjective"] is not None
        assert out["objective"] > 0


class TestInfeasibleSolve:
    """P=3, uniformCapacity=8M -- 3x8M=24M total capacity is well under the
    ~80M total demand this dataset requires; a deterministic, fast
    infeasibility (matches e2e_accuracy.py's own PM-2 case)."""

    def test_infeasible_reports_infeasible(self):
        payload = dict(
            modelType="p_median", pValue=3, distanceBands=[200, 400, 800, 1600],
            capacityMode="uniform", uniformCapacity=8_000_000, warehouseStatuses=[],
            gap=0.0, timeLimitSec=60, capacityFactor=1.0, singleSource=False,
            capacityInactive=False,
        )
        out = run_solver(payload)
        assert out["solutionStatus"] == "infeasible"
        assert out["terminationReason"] == "infeasible"
        assert out["status"] == "infeasible"
        assert out["achievedGap"] is None
        assert out["solverIncumbentObjective"] is None
        assert out["solverBestBound"] is None
        assert out["infeasibilityReason"]
