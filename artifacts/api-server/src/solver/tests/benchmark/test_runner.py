# test_runner.py
from benchmark.corpus import Manifest, Cell
from benchmark.runner import run_campaign, run_determinism

from benchmark.measure import Observation

def _obs(cell, case):
    return Observation(cell_key=cell.key, case_key=case.case_key(cell), gap=cell.gap,
                       wall_sec=1.0, cpu_tree_sec=0.5, harness_overhead_sec=0.01,
                       python_peak_rss=100, cbc_peak_rss=200, objective=1.0,
                       solution_status="optimal", termination_reason="optimality_proven",
                       ok=True)

def _fake_measure_factory(log):
    def _m(cell, case, solve_fn=None, timeout_sec=300):
        log.append((cell.key, case.case_id))
        return _obs(cell, case)
    return _m

def _stratum(model, regime, fam, weight, n=8):
    return {"model_id": model, "regime": regime, "edit_family": fam, "weight": weight,
            "cases": [{"case_id": f"{model}-{i}", "inputs": {}} for i in range(n)]}

def _manifest(gaps=(0.0,)):
    return Manifest(1, [_stratum("a", "forced_open", None, 0.5),
                        _stratum("b", "free_choice", "demand", 0.5)], list(gaps))

def test_warmups_all_execute_before_any_measured_row():
    log = []
    obs = run_campaign(_manifest(), min_cases=99, max_cases=4, warmup=2, seed=1,
                       measure=_fake_measure_factory(log))
    assert len(obs) == 2 * 4                       # 2 cells x 4 measured
    assert len(log) == 2 * 2 + 2 * 4               # warm-ups executed, not kept
    assert all(o.kind == "campaign" for o in obs)
    # R6-5: the ORDER property the test is named for. Measured rows are kept
    # in call order, so they must be exactly the tail of the call log -- every
    # call before that tail is a warm-up, and no warm-up sits among them.
    measured = [(o.cell_key, o.case_key.rsplit("|", 1)[1]) for o in obs]
    assert log[-len(measured):] == measured
    assert len(log) - len(measured) == 2 * 2

def test_campaign_case_ids_are_distinct_within_a_cell():
    # MP-R1: 4 measured rows in a cell are 4 DISTINCT cases, never repeats.
    obs = run_campaign(_manifest(), min_cases=99, max_cases=4, warmup=0, seed=1,
                       measure=_fake_measure_factory([]))
    for key in {o.cell_key for o in obs}:
        keys = [o.case_key for o in obs if o.cell_key == key]
        assert len(keys) == len(set(keys)) == 4

def test_measured_schedule_is_globally_interleaved():
    # R3-R3: draining one cell at a time lets drift align with a cell.
    log = []
    run_campaign(_manifest(), min_cases=99, max_cases=4, warmup=0, seed=3,
                 measure=_fake_measure_factory(log))
    cells = [c for c, _ in log]
    assert cells != sorted(cells)                  # not grouped by cell

def test_all_gaps_of_a_stratum_stop_together():
    # F-R6: constant cpu_tree_sec -> CI width 0 -> immediate readiness. If a
    # cell could stop alone, the retained sets would diverge. They must not.
    log = []
    obs = run_campaign(_manifest(gaps=(0.0, 0.02)), min_cases=2, max_cases=6,
                       warmup=0, seed=11, measure=_fake_measure_factory(log))
    ret = lambda g: {o.case_key for o in obs if o.gap == g and o.cell_key.startswith("a|")}
    assert ret(0.0) == ret(0.02)

def test_same_case_cohort_across_gaps():
    # R3-R3: paired objective deltas need full overlap between gaps.
    log = []
    run_campaign(_manifest(gaps=(0.0, 0.02)), min_cases=99, max_cases=3, warmup=0,
                 seed=5, measure=_fake_measure_factory(log))
    at = lambda g: {cid for (k, cid) in log if k.endswith(f"|{g}") and k.startswith("a|")}
    assert at("0.0") == at("0.02")

def test_seed_is_reproducible():
    l1, l2 = [], []
    run_campaign(_manifest(), min_cases=99, max_cases=4, warmup=0, seed=7,
                 measure=_fake_measure_factory(l1))
    run_campaign(_manifest(), min_cases=99, max_cases=4, warmup=0, seed=7,
                 measure=_fake_measure_factory(l2))
    assert l1 == l2

def test_determinism_rows_are_tagged_and_separate():
    cell = _manifest().cells()[0]
    rows = run_determinism(cell, cell.cases[0], reps=3, measure=_fake_measure_factory([]))
    assert len(rows) == 3
    assert all(r.kind == "determinism" for r in rows)
    assert len({r.case_key for r in rows}) == 1    # ONE case, repeated
