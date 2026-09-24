# test_trace.py
from benchmark.trace import open_loop_trace, burst_trace

def test_open_loop_trace_rate_is_within_3_sigma():
    # M-R3: sustained = 0.694/s for 3600s -> mean count = 2500, sigma~=sqrt(2500)=50
    # 3 sigma ~= 150.
    offsets = open_loop_trace(0.694, 3600, seed=1)
    assert abs(len(offsets) - 2500) < 150

def test_open_loop_trace_is_reproducible_with_same_seed():
    a = open_loop_trace(0.694, 3600, seed=1)
    b = open_loop_trace(0.694, 3600, seed=1)
    assert a == b

def test_open_loop_trace_offsets_are_sorted_and_within_duration():
    offsets = open_loop_trace(0.694, 3600, seed=2)
    assert offsets == sorted(offsets)
    assert all(0 <= o < 3600 for o in offsets)

def test_burst_trace_is_n_identical_offsets():
    offsets = burst_trace(50, 10.0)
    assert offsets == [10.0] * 50
