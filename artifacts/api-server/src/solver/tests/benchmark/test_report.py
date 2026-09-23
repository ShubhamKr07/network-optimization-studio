# test_report.py
import csv
from benchmark.measure import Observation
from benchmark.corpus import Manifest
from benchmark.stats import aggregate
from benchmark.report import write_raw, write_aggregates

RAW_HEADER = ["run_id", "cell_key", "case_key", "case_id", "model_id", "regime",
              "edit_family", "gap", "kind", "wall_sec", "cpu_tree_sec",
              "harness_overhead_sec", "python_peak_rss", "cbc_peak_rss",
              "objective", "solution_status", "termination_reason", "ok",
              "resource_complete", "error"]

AGG_HEADER = ["run_id", "cell_key", "model_id", "regime", "edit_family", "gap",
              "corpus_weight", "observation_share", "n_cases", "n_obs",
              "n_success", "usable", "unusable_reason", "mean_cpu_tree_sec",
              "mean_cpu_ci_low", "mean_cpu_ci_high", "p95_wall",
              "p95_wall_ci_low", "p95_wall_ci_high", "failure_rate",
              "failure_rate_ci_low", "failure_rate_ci_high",
              "objective_delta_vs_gap0", "objective_delta_ci_low",
              "objective_delta_ci_high", "objective_pairs_excluded",
              "p50_wall", "mean_python_peak_rss", "mean_cbc_peak_rss"]

def _obs(cell_key="a|forced_open|-|0.0", case="c1", ok=True, kind="campaign",
         gap=0.0, resource_complete=True, error=None):
    return Observation(cell_key=cell_key, case_key=f"a|forced_open|-|{case}", gap=gap,
                       wall_sec=1.0, cpu_tree_sec=0.5, harness_overhead_sec=0.01,
                       python_peak_rss=100, cbc_peak_rss=200,
                       objective=1.0 if ok else None,
                       solution_status="optimal" if ok else None,
                       termination_reason="optimality_proven" if ok else None,
                       ok=ok, resource_complete=resource_complete,
                       error=error, kind=kind)

def _manifest():
    return Manifest(1, [{"model_id": "a", "regime": "forced_open",
                         "edit_family": None, "weight": 1.0, "cases": []}], [0.0])

def test_raw_header_matches_exactly(tmp_path):
    rows = [_obs(case="c1"), _obs(case="c2", kind="determinism"),
            _obs(case="c3", ok=False, resource_complete=False, error="timeout")]
    path = tmp_path / "raw.csv"
    write_raw(rows, str(path), run_id="run-1")
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == RAW_HEADER
        data = list(reader)
    assert data[0]["run_id"] == "run-1"
    kinds = {r["case_key"].rsplit("|", 1)[1]: r["kind"] for r in data}
    assert kinds["c2"] == "determinism"
    resource_flags = {r["case_key"].rsplit("|", 1)[1]: r["resource_complete"] for r in data}
    assert resource_flags["c3"] == "False"

def test_aggregate_header_and_weight_vs_share_separate(tmp_path):
    rows = [_obs(case="c1"), _obs(case="c2")]
    manifest = _manifest()
    stats = aggregate(rows, min_cases=1)
    path = tmp_path / "agg.csv"
    write_aggregates(stats, rows, manifest, str(path), run_id="run-1")
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == AGG_HEADER
        data = list(reader)
    assert len(data) == 1
    row = data[0]
    assert row["run_id"] == "run-1"
    assert float(row["corpus_weight"]) == 1.0
    assert float(row["observation_share"]) == 1.0
    assert row["corpus_weight"] != row["objective_delta_vs_gap0"]  # never conflated
