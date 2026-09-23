# test_stats.py
import pytest
from benchmark.corpus import Manifest
from benchmark.measure import Observation
from benchmark.stats import (percentile, bootstrap_ci, aggregate,
                             objective_deltas, corpus_frequency)

def _obs(key, wall, cpu, case="c0", ok=True, kind="campaign", gap=0.0,
         objective=1.0, resource_complete=True):
    # cell_key ends in gap; case_key deliberately does not.
    stratum = key.rsplit("|", 1)[0]
    return Observation(cell_key=key, case_key=f"{stratum}|{case}", gap=gap, wall_sec=wall,
                       cpu_tree_sec=cpu, harness_overhead_sec=0.01,
                       python_peak_rss=1000, cbc_peak_rss=2000, objective=objective,
                       solution_status="optimal", termination_reason="optimality_proven",
                       ok=ok, resource_complete=resource_complete,
                       error=None, kind=kind)

def test_percentile_linear_interpolation():
    assert percentile([1, 2, 3, 4], 0.5) == 2.5
    assert percentile([1], 0.95) == 1

def test_bootstrap_ci_brackets_the_point_estimate():
    xs = [1.0] * 50 + [9.0] * 50
    lo, hi = bootstrap_ci(xs, lambda s: percentile(s, 0.95), reps=500, seed=3)
    assert lo <= percentile(xs, 0.95) <= hi

def test_aggregate_excludes_determinism_rows():
    rows = [_obs("k", 1.0, 0.5, case=f"c{i}") for i in range(10)]
    rows += [_obs("k", 99.0, 99.0, case="c0", kind="determinism") for _ in range(10)]
    stats = aggregate(rows, min_cases=1)
    assert stats["k"].n_obs == 10
    assert stats["k"].n_cases == 10           # 10 DISTINCT cases, not 10 repeats
    assert stats["k"].p95_wall < 2.0          # determinism outliers not included

def test_aggregate_reports_failure_rate():
    rows = [_obs("k", 1.0, 0.5, case=f"c{i}") for i in range(9)]
    rows += [_obs("k", 0.0, 0.0, case="c9", ok=False)]
    assert aggregate(rows, min_cases=1)["k"].failure_rate == pytest.approx(0.1)

def test_all_failure_cell_is_unusable_not_a_crash():
    # L-R1: round 1 indexed walls[0] on an empty list here.
    rows = [_obs("k", 0.0, 0.0, case=f"c{i}", ok=False) for i in range(5)]
    cs = aggregate(rows, min_cases=1)["k"]
    assert cs.usable is False and "no successes" in cs.unusable_reason

def test_under_sampled_cell_is_unusable():
    rows = [_obs("k", 1.0, 0.5, case=f"c{i}") for i in range(3)]
    cs = aggregate(rows, min_cases=30)["k"]
    assert cs.usable is False and "distinct cases" in cs.unusable_reason

def test_failed_attempt_with_complete_telemetry_counts_as_demand():
    rows = [_obs("a|forced_open|-|0.0", 1.0, 1.0, case="c1"),
            _obs("a|forced_open|-|0.0", 3.0, 3.0, case="c2", ok=False)]
    cs = aggregate(rows, min_cases=1)["a|forced_open|-|0.0"]
    assert cs.usable is True
    assert cs.mean_cpu_tree_sec == pytest.approx(2.0)
    assert cs.failure_rate == pytest.approx(0.5)

def test_censored_resource_row_makes_cell_unusable():
    rows = [_obs("a|forced_open|-|0.0", 1.0, 1.0, case="c1"),
            _obs("a|forced_open|-|0.0", 5.0, 0.0, case="c2", ok=False,
                 resource_complete=False)]
    cs = aggregate(rows, min_cases=1)["a|forced_open|-|0.0"]
    assert cs.usable is False and "censored" in cs.unusable_reason

def test_objective_deltas_keep_every_gap_and_count_exclusions():
    rows = []
    for case, base in (("c1", 100.0), ("c2", 120.0), ("c3", 140.0)):
        rows.append(_obs("a|forced_open|-|0.0", 1, 1, case=case,
                         gap=0.0, objective=base))
        rows.append(_obs("a|forced_open|-|0.005", 1, 1, case=case,
                         gap=0.005, objective=base + 1))
        rows.append(_obs("a|forced_open|-|0.02", 1, 1, case=case,
                         gap=0.02, objective=base + 4,
                         ok=(case != "c3")))
    values, excluded = objective_deltas(rows)
    assert values["a|forced_open|-|0.005"] == [1.0, 1.0, 1.0]
    assert values["a|forced_open|-|0.02"] == [4.0, 4.0]
    assert excluded["a|forced_open|-|0.02"] == 1

def test_corpus_frequency_separates_weight_from_observation_allocation():
    manifest = Manifest(1, [
        {"model_id": "a", "regime": "forced_open", "edit_family": None,
         "weight": 0.9, "cases": []},
        {"model_id": "b", "regime": "free_choice", "edit_family": "demand",
         "weight": 0.1, "cases": []}], [0.0])
    rows = [_obs("a|forced_open|-|0.0", 1, 1, case="a1"),
            _obs("b|free_choice|demand|0.0", 1, 1, case="b1"),
            _obs("b|free_choice|demand|0.0", 1, 1, case="b2")]
    freq = corpus_frequency(rows, manifest)
    assert freq["a|forced_open|-"]["declared_weight"] == pytest.approx(0.9)
    assert freq["a|forced_open|-"]["observation_share"] == pytest.approx(1 / 3)
