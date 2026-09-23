# test_measure.py
import time
from benchmark.measure import measure_once, normalize_maxrss
from benchmark.corpus import Cell, Case

def _cell(gap=0.0):
    return Cell("p-median-us", "forced_open", None, gap, 1.0,
                (Case("c1", {"modelType": "p_median"}),))

def _fake_solve(inp):
    return {"objective": 1234.0, "solutionStatus": "optimal",
            "terminationReason": "optimality_proven"}

def test_measure_once_captures_tree_cpu_and_separate_peaks():
    cell = _cell()
    obs = measure_once(cell, cell.cases[0], solve_fn=_fake_solve)
    assert obs.ok is True
    assert obs.cpu_tree_sec > 0            # user+sys across Python AND CBC
    assert obs.python_peak_rss > 0
    assert obs.cbc_peak_rss >= 0           # 0 when no child was spawned
    assert obs.harness_overhead_sec >= 0
    assert obs.cell_key == cell.key
    assert obs.case_key == "p-median-us|forced_open|-|c1"

def test_case_key_is_stable_across_gaps():
    # L-R4: objective deltas pair the same case across gaps, so the key must
    # NOT include gap.
    a, b = _cell(0.0), _cell(0.02)
    assert a.cases[0].case_key(a) == b.cases[0].case_key(b)

def test_measure_once_records_failure_without_raising():
    def boom(inp): raise RuntimeError("cbc exploded")
    cell = _cell()
    obs = measure_once(cell, cell.cases[0], solve_fn=boom)
    assert obs.ok is False
    assert "cbc exploded" in obs.error
    assert obs.objective is None
    assert obs.cpu_tree_sec >= 0           # resources still recorded on failure

def test_timeout_marks_resource_demand_censored():
    def hangs(inp):
        time.sleep(1)
    cell = _cell()
    obs = measure_once(cell, cell.cases[0], solve_fn=hangs, timeout_sec=0.01)
    assert obs.ok is False
    assert obs.resource_complete is False  # zero is not mistaken for zero demand
    assert obs.error == "timeout"

def test_normalize_maxrss_units():
    assert normalize_maxrss(1024, "Linux") == 1024 * 1024   # KB -> bytes
    assert normalize_maxrss(1024, "Darwin") == 1024         # already bytes
