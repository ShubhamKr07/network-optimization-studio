# report.py
import csv
from benchmark.stats import corpus_frequency

RAW_HEADER = ["run_id", "cell_key", "case_key", "case_id", "model_id", "regime",
              "edit_family", "gap", "kind", "wall_sec", "cpu_tree_sec",
              "harness_overhead_sec", "python_peak_rss", "cbc_peak_rss",
              "objective", "solution_status", "termination_reason", "ok",
              "resource_complete", "error"]

AGGREGATE_HEADER = ["run_id", "cell_key", "model_id", "regime", "edit_family", "gap",
                    "corpus_weight", "observation_share", "n_cases", "n_obs",
                    "n_success", "usable", "unusable_reason", "mean_cpu_tree_sec",
                    "mean_cpu_ci_low", "mean_cpu_ci_high", "p95_wall",
                    "p95_wall_ci_low", "p95_wall_ci_high", "failure_rate",
                    "failure_rate_ci_low", "failure_rate_ci_high",
                    "objective_delta_vs_gap0", "objective_delta_ci_low",
                    "objective_delta_ci_high", "objective_pairs_excluded",
                    "p50_wall", "mean_python_peak_rss", "mean_cbc_peak_rss"]


def _split_cell_key(cell_key):
    model_id, regime, edit_family, gap = cell_key.rsplit("|", 3)
    return model_id, regime, edit_family, gap


def write_raw(observations, path, *, run_id: str) -> None:
    """Rows are written in the order given -- the caller (measured order from
    run_campaign, or campaign rows followed by an appended determinism batch
    from the CLI's --determinism-cell) controls drift-analysability, not this
    writer (L-R1: no timestamp column invented; case_key is mandatory for
    paired re-analysis)."""
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=RAW_HEADER)
        writer.writeheader()
        for o in observations:
            model_id, regime, edit_family, _gap = _split_cell_key(o.cell_key)
            case_id = o.case_key.rsplit("|", 1)[1]
            writer.writerow({
                "run_id": run_id, "cell_key": o.cell_key, "case_key": o.case_key,
                "case_id": case_id, "model_id": model_id, "regime": regime,
                "edit_family": edit_family, "gap": o.gap, "kind": o.kind,
                "wall_sec": o.wall_sec, "cpu_tree_sec": o.cpu_tree_sec,
                "harness_overhead_sec": o.harness_overhead_sec,
                "python_peak_rss": o.python_peak_rss, "cbc_peak_rss": o.cbc_peak_rss,
                "objective": o.objective, "solution_status": o.solution_status,
                "termination_reason": o.termination_reason, "ok": o.ok,
                "resource_complete": o.resource_complete, "error": o.error,
            })


def write_aggregates(stats, observations, manifest, path, *, run_id: str) -> None:
    """`corpus_weight` is the declared generator weight; `observation_share`
    is the realised sampling allocation after sequential stopping (M-R9).
    Neither is student prevalence, and the two are NEVER conflated into one
    column."""
    freq = corpus_frequency(observations, manifest)
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=AGGREGATE_HEADER)
        writer.writeheader()
        for cell_key, cs in stats.items():
            model_id, regime, edit_family, gap = _split_cell_key(cell_key)
            stratum_key = f"{model_id}|{regime}|{edit_family}"
            share = freq.get(stratum_key, {})
            mean_cpu_lo, mean_cpu_hi = cs.mean_cpu_ci
            p95_lo, p95_hi = cs.p95_wall_ci
            fail_lo, fail_hi = cs.failure_rate_ci
            if cs.objective_delta_ci is not None:
                delta_lo, delta_hi = cs.objective_delta_ci
            else:
                delta_lo, delta_hi = None, None
            writer.writerow({
                "run_id": run_id, "cell_key": cell_key, "model_id": model_id,
                "regime": regime, "edit_family": edit_family, "gap": gap,
                "corpus_weight": share.get("declared_weight"),
                "observation_share": share.get("observation_share"),
                "n_cases": cs.n_cases, "n_obs": cs.n_obs, "n_success": cs.n_success,
                "usable": cs.usable, "unusable_reason": cs.unusable_reason,
                "mean_cpu_tree_sec": cs.mean_cpu_tree_sec,
                "mean_cpu_ci_low": mean_cpu_lo, "mean_cpu_ci_high": mean_cpu_hi,
                "p95_wall": cs.p95_wall, "p95_wall_ci_low": p95_lo,
                "p95_wall_ci_high": p95_hi, "failure_rate": cs.failure_rate,
                "failure_rate_ci_low": fail_lo, "failure_rate_ci_high": fail_hi,
                "objective_delta_vs_gap0": cs.objective_delta_vs_gap0,
                "objective_delta_ci_low": delta_lo, "objective_delta_ci_high": delta_hi,
                "objective_pairs_excluded": cs.objective_pairs_excluded,
                "p50_wall": cs.p50_wall,
                "mean_python_peak_rss": cs.mean_python_peak_rss,
                "mean_cbc_peak_rss": cs.mean_cbc_peak_rss,
            })
