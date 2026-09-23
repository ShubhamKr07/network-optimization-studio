# test_simulate.py
import pytest
from benchmark.measure import Observation
from benchmark.simulate import simulate, candidate_worker_counts, build_event_samples

from benchmark.simulate import EventSample

def _ev(wall, api=0.0, cls="cold_miss", slot=True):
    # F-R2: the Canonical API takes EventSample, not bare floats. Passing
    # floats either dies with AttributeError or leaves cache_class /
    # api_overhead_sec / consumes_solver_slot with no exercised path -- which
    # IS the "20/60/20 not replayable" defect R3-R4 was recorded as fixing.
    return EventSample(cache_class=cls, solver_wall_sec=wall,
                       api_overhead_sec=api, consumes_solver_slot=slot)

def test_single_server_queue_grows_when_overloaded():
    trace = [i * 1.0 for i in range(100)]                       # 1 job/s
    r = simulate(trace, {"only": ([_ev(2.0)], 1.0)}, workers=1, seed=0)
    assert r.p95_wait > 50                      # unstable, queue grows without bound
    assert r.utilization > 0.99

def test_enough_servers_keeps_wait_near_zero():
    trace = [i * 1.0 for i in range(100)]
    r = simulate(trace, {"only": ([_ev(2.0)], 1.0)}, workers=4, seed=0)
    assert r.p95_wait < 1.0

def test_cache_hit_costs_api_time_but_no_solver_slot():
    # F-R2 / R3-R4's promised-but-absent test.
    trace = [i * 1.0 for i in range(100)]
    r = simulate(trace, {"hit": ([_ev(0.0, api=0.3, cls="hit", slot=False)], 1.0)},
                 workers=1, seed=0)
    assert r.utilization == 0                   # never enters the server heap
    assert r.p95_wait == 0
    assert r.p95_end_to_end == pytest.approx(0.3)   # API cost still counted

def test_candidate_worker_counts_returns_all_counts_and_flags_passers():
    # This test has now been wrong TWICE. Round 1 was impossible (SLO 1.0 s
    # below a 2.0 s service time). Round 2 was merely false: at 1 arrival/s
    # with deterministic 2 s service, offered work is exactly 2 server-seconds
    # per second, so TWO workers already give zero wait and 2.0 s end-to-end.
    # The smallest passer is 2, not 3. Both errors came from asserting a
    # number instead of deriving it -- so assert the property, not the digit.
    trace = [i * 1.0 for i in range(200)]
    cands = candidate_worker_counts(trace, {"only": ([_ev(2.0)], 1.0)},
                                    slo_p95_end_to_end_sec=2.5, max_workers=8)
    assert [c.workers for c in cands] == list(range(1, 9))   # ALL counts, ascending
    first_pass = next(c for c in cands if c.passes)
    assert first_pass.workers == 2
    assert not cands[0].passes                               # 1 worker is overloaded

def test_queue_wait_slo_variant_is_also_available():
    trace = [i * 1.0 for i in range(200)]
    cands = candidate_worker_counts(trace, {"only": ([_ev(2.0)], 1.0)},
                                    slo_p95_queue_wait_sec=0.5, max_workers=8)
    assert next(c for c in cands if c.passes).result.p95_wait <= 0.5

def test_stratified_replay_respects_declared_weights():
    # MP-R3: a flat sample list silently substitutes equal population weights
    # for the declared sensitivity mix.
    # F-R16: the round-3 band was +/-5 events on sigma=4.4 -- about +/-1.1
    # sigma, so roughly one implementation in four fails an assertion that
    # asserts nothing about correctness. 10k events puts +/-0.005 past 3.5 sigma.
    trace = [i * 1.0 for i in range(10_000)]
    strata = {"fast": ([_ev(0.1)], 0.98), "slow": ([_ev(50.0)], 0.02)}
    r = simulate(trace, strata, workers=4, seed=0)
    assert 0.015 < r.observed_stratum_mix["slow"] < 0.025

def test_event_builder_scales_target_wall_and_requires_measured_api_cost():
    rows = [Observation(cell_key="a|forced_open|-|0.0",
                        case_key="a|forced_open|-|c1", gap=0.0,
                        wall_sec=2.0, cpu_tree_sec=1.0,
                        harness_overhead_sec=0.1, python_peak_rss=1,
                        cbc_peak_rss=1, objective=1.0,
                        solution_status="optimal",
                        termination_reason="optimality_proven", ok=True)]
    classes = {rows[0].case_key: "cold_miss"}
    events = build_event_samples(
        rows, classes, {"cold_miss": 0.2}, wall_scale_factor=1.5)
    assert events[0].solver_wall_sec == pytest.approx(3.0)
    assert events[0].api_overhead_sec == pytest.approx(0.2)
    with pytest.raises(ValueError, match="api overhead"):
        build_event_samples(rows, classes, {}, wall_scale_factor=1.5)
