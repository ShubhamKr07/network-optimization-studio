# trace.py
"""Arrival trace generators for the queue simulator (M2.2).

M-R3: sustained profile = 0.694/s over 10 800s (3h), Poisson arrivals, seed
recorded. Burst profile = 50 submissions at one instant, run as a separate
profile.
"""
import math
import random

def open_loop_trace(rate_per_sec, duration_sec, seed, distribution="poisson"):
    """Open-loop Poisson arrival trace: exponential inter-arrival times,
    accumulated until duration_sec. Returns sorted submission offsets in
    seconds, all strictly less than duration_sec.
    """
    if distribution != "poisson":
        raise ValueError(f"unsupported distribution: {distribution}")
    if rate_per_sec <= 0:
        raise ValueError("rate_per_sec must be positive")
    rng = random.Random(seed)
    offsets = []
    t = 0.0
    while True:
        u = rng.random()
        # avoid log(0) -- u is in [0, 1); random() can return 0.0
        u = u if u > 0.0 else 1e-12
        inter_arrival = -math.log(1 - u) / rate_per_sec
        t += inter_arrival
        if t >= duration_sec:
            break
        offsets.append(t)
    return offsets

def burst_trace(n, at_sec):
    """n identical, synchronized submission offsets at at_sec."""
    return [at_sec] * n
