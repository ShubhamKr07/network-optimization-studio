# test_capacity.py
import pytest
from benchmark.capacity import (weighted_mean_service_demand, required_cores,
                                map_to_instances, size_calibrated_plan,
                                load_calibration, Calibration, SizingError)
from benchmark.stats import CellStats
from benchmark.corpus import Manifest

def _cs(cpu):                       # keyword construction -- see Canonical API
    return CellStats(n_cases=200, n_obs=200, n_success=200, usable=True,
                     mean_cpu_tree_sec=cpu)

def _stats(a_cpu, b_cpu):
    return {"a|forced_open|-|0.0": _cs(a_cpu), "b|free_choice|demand|0.0": _cs(b_cpu)}

def _stratum(model, regime, fam, weight):
    return {"model_id": model, "regime": regime, "edit_family": fam, "weight": weight,
            "cases": [{"case_id": f"{model}-{i}", "inputs": {}} for i in range(200)]}

def _manifest():
    return Manifest(1, [_stratum("a", "forced_open", None, 0.9),
                        _stratum("b", "free_choice", "demand", 0.1)], [0.0])

def test_weighted_mean_uses_declared_weights_not_raw_average():
    d = weighted_mean_service_demand(_stats(1.0, 11.0), _manifest(), gap=0.0)
    assert d == pytest.approx(0.9 * 1.0 + 0.1 * 11.0)   # 2.0, not the unweighted 6.0

def test_missing_required_stratum_fails_closed():
    incomplete = {"a|forced_open|-|0.0": _cs(1.0)}      # 'b' absent
    with pytest.raises(SizingError, match="required stratum missing"):
        weighted_mean_service_demand(incomplete, _manifest(), gap=0.0)

def test_required_cores_accounts_for_efficiency_and_headroom():
    cores = required_cores(demand_cpu_sec=2.0, arrival_rate_per_sec=0.694,
                           parallel_efficiency=0.8, headroom=0.3)
    assert cores == pytest.approx((2.0 * 0.694) / (0.8 * 0.7))

def test_cores_and_slots_are_different_units():
    # R3-R2: 4 cores of demand is NOT 4 slots. At 0.5 cores/slot it is 8 slots.
    instances, slots = map_to_instances(
        required_cores=4.0, slots_per_instance=8, cores_per_slot=0.5,
        rss_per_slot_bytes=200_000_000, instance_memory_bytes=4_000_000_000)
    assert slots == 8                 # memory allows 20, plan allows 8
    assert instances == 1             # 8 slots x 0.5 cores = 4 cores

def test_memory_caps_slots_before_cpu_does():
    instances, slots = map_to_instances(
        required_cores=4.0, slots_per_instance=8, cores_per_slot=0.5,
        rss_per_slot_bytes=1_500_000_000, instance_memory_bytes=4_000_000_000)
    assert slots == 2                 # only 2 slots fit in memory
    assert instances == 4             # 2 x 0.5 = 1 core/instance -> 4 instances

def test_rare_slow_stratum_beyond_p95_still_enters_themean():
    # 2% of load at 100 CPU-s sits beyond p95 yet dominates compute
    m = Manifest(1, [_stratum("fast", "forced_open", None, 0.98),
                     _stratum("slow", "free_choice", None, 0.02)], [0.0])
    d = weighted_mean_service_demand(
        {"fast|forced_open|-|0.0": _cs(0.5), "slow|free_choice|-|0.0": _cs(100.0)},
        m, gap=0.0)
    assert d == pytest.approx(0.98 * 0.5 + 0.02 * 100.0)   # 2.49 — slow stratum is most of it

def test_final_sizing_uses_target_plan_cpu_demand_once():
    cal = Calibration(plan_id="worker-pro", app_sha="abc", profile_id="representative",
                      gap=0.0, target_mean_cpu_sec=2.0, slots_per_instance=8,
                      cores_per_slot=0.5, rss_per_slot_bytes=200_000_000,
                      instance_memory_bytes=4_000_000_000, wall_scale_factor=1.2)
    instances, slots, cores = size_calibrated_plan(
        cal, arrival_rate_per_sec=0.7, headroom=0.3)
    assert cores == pytest.approx(2.0)       # 2.0 * 0.7 / (1 - 0.3)
    assert (instances, slots) == (1, 8)

def test_calibration_loader_requires_one_exact_identity(tmp_path):
    header = ("plan_id,app_sha,profile_id,gap,target_mean_cpu_sec,"
              "slots_per_instance,cores_per_slot,rss_per_slot_bytes,"
              "instance_memory_bytes,wall_scale_factor\n")
    row = "worker-pro,abc,representative,0.0,2.0,8,0.5,200000000,4000000000,1.2\n"
    path = tmp_path / "cal.csv"
    path.write_text(header + row)
    assert load_calibration(path, plan_id="worker-pro", app_sha="abc",
                            profile_id="representative", gap=0).target_mean_cpu_sec == 2.0
    with pytest.raises(SizingError, match="exactly one"):
        load_calibration(path, plan_id="worker-pro", app_sha="wrong",
                         profile_id="representative", gap=0)
    path.write_text(header + row + row)
    with pytest.raises(SizingError, match="exactly one"):
        load_calibration(path, plan_id="worker-pro", app_sha="abc",
                         profile_id="representative", gap=0)
