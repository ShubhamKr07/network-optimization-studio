# simulate.py
"""Discrete-event queue simulator (M2.3): stratified empirical-distribution
replay to candidate worker counts.

R3-R4: a queue slot is held for WALL time; `cpu_tree_sec` is the *capacity*
input (M2.1) and stays there. `EventSample` makes cache-hit/API-overhead/
slot-occupancy behaviour executable -- a cache hit adds to end-to-end latency
and offered API load while consuming zero solver slots.

MP-R3: `strata` is `{stratum_key: (samples, weight)}`. Each event is tagged
by drawing a stratum from the declared weights FIRST, then its service time
is drawn from that cell's own empirical distribution -- never `rng.choice`
over one flat pooled list, which would silently substitute equal population
weights for the declared sensitivity mix.
"""
import heapq
import random
from collections import deque
from dataclasses import dataclass

from benchmark.stats import percentile

@dataclass(frozen=True)
class EventSample:
    cache_class: str            # "hit" | "near_miss" | "cold_miss"
    solver_wall_sec: float      # slot occupancy -- NOT cpu_tree_sec
    api_overhead_sec: float     # measured; non-zero even for cache hits
    consumes_solver_slot: bool

@dataclass
class SimResult:
    p50_wait: float
    p95_wait: float
    p95_end_to_end: float
    max_queue_depth: int
    utilization: float
    observed_stratum_mix: dict

@dataclass
class CandidateResult:
    workers: int
    result: SimResult
    passes: bool


def _draw_stratum(rng, keys, cum_weights, total_weight):
    r = rng.random() * total_weight
    for key, cum in zip(keys, cum_weights):
        if r <= cum:
            return key
    return keys[-1]


def simulate(trace, strata: dict, workers: int, seed: int) -> SimResult:
    """FIFO, `workers` identical servers, discrete-event. Service times are
    sampled from the empirical distribution per stratum -- never a fitted
    mean. Assumes `trace` is already sorted (as `open_loop_trace`/
    `burst_trace` produce it)."""
    rng = random.Random(seed)
    keys = list(strata.keys())
    weights = [strata[k][1] for k in keys]
    total_weight = sum(weights)
    cum_weights = []
    acc = 0.0
    for w in weights:
        acc += w
        cum_weights.append(acc)

    # Min-heap of each server's next-free time. Always assigning the next
    # (temporally ordered) arrival to the earliest-freeing server is the
    # standard, exact technique for simulating an FCFS multi-server queue --
    # service order equals arrival order, so this reproduces true FIFO wait
    # times without a second, separately-maintained event queue.
    free_heap = [0.0] * workers
    heapq.heapify(free_heap)

    waits, end_to_ends = [], []
    stratum_counts = {k: 0 for k in keys}
    total_solver_wall = 0.0
    last_completion = None
    first_arrival = trace[0] if trace else 0.0

    # Start times are non-decreasing in arrival order under FCFS pooled
    # service, so a deque of "not yet started" start times, popped from the
    # front whenever start_time <= current arrival time, gives the exact
    # waiting-queue depth at each arrival.
    pending_starts = deque()
    max_queue_depth = 0

    for t in trace:
        stratum_key = _draw_stratum(rng, keys, cum_weights, total_weight)
        stratum_counts[stratum_key] += 1
        samples, _weight = strata[stratum_key]
        event = rng.choice(samples)

        if event.consumes_solver_slot:
            earliest_free = heapq.heappop(free_heap)
            start = max(earliest_free, t)
            wait = start - t
            completion = start + event.solver_wall_sec
            heapq.heappush(free_heap, completion)
            total_solver_wall += event.solver_wall_sec
            last_completion = (completion if last_completion is None
                               else max(last_completion, completion))
            while pending_starts and pending_starts[0] <= t:
                pending_starts.popleft()
            pending_starts.append(start)
            max_queue_depth = max(max_queue_depth, len(pending_starts))
        else:
            wait = 0.0        # a cache hit never enters the server heap

        end_to_end = event.api_overhead_sec + wait + event.solver_wall_sec
        waits.append(wait)
        end_to_ends.append(end_to_end)

    total_events = len(trace)
    observed_mix = {k: (stratum_counts[k] / total_events if total_events else 0.0)
                    for k in keys}

    if last_completion is None:
        utilization = 0.0                     # an all-hit profile: 0, by definition
    else:
        span = last_completion - first_arrival
        utilization = (total_solver_wall / (workers * span)) if span > 0 else 0.0

    return SimResult(
        p50_wait=percentile(waits, 0.5) if waits else 0.0,
        p95_wait=percentile(waits, 0.95) if waits else 0.0,
        p95_end_to_end=percentile(end_to_ends, 0.95) if end_to_ends else 0.0,
        max_queue_depth=max_queue_depth,
        utilization=utilization,
        observed_stratum_mix=observed_mix,
    )


def candidate_worker_counts(trace, strata, *, slo_p95_end_to_end_sec=None,
                            slo_p95_queue_wait_sec=None,
                            max_workers: int, seed: int = 0) -> list:
    """Runs `simulate` at every count 1..max_workers with the SAME seed, so
    candidates differ only in `workers`. Returns every count in ascending
    order -- never only passers, so a near-miss stays visible. `max_workers`
    is a count of concurrent SOLVER SLOTS, not instances -- the caller
    supplies `max_workers = 100 * slots_per_instance` to explore a
    100-instance fleet."""
    results = []
    for workers in range(1, max_workers + 1):
        result = simulate(trace, strata, workers=workers, seed=seed)
        passes = True
        if slo_p95_end_to_end_sec is not None:
            passes = passes and result.p95_end_to_end <= slo_p95_end_to_end_sec
        if slo_p95_queue_wait_sec is not None:
            passes = passes and result.p95_wait <= slo_p95_queue_wait_sec
        results.append(CandidateResult(workers=workers, result=result, passes=passes))
    return results


def build_event_samples(observations, cache_class_by_case_key,
                        api_overhead_by_cache_class,
                        *, wall_scale_factor: float) -> list:
    """Behaviour, the only statement of it (R6-6): use `kind == "campaign"`
    rows with `resource_complete=True` only (failed-but-complete attempts
    included -- they occupied a slot; determinism rows never); map each row
    to its `cache_class` via `cache_class_by_case_key`, raising `ValueError`
    when a `case_key` has no assignment; `wall_scale_factor` must be
    positive; `solver_wall_sec = wall_sec * wall_scale_factor` for non-hit
    classes and `0.0` for `cache_class == "hit"`; `api_overhead_sec` comes
    from `api_overhead_by_cache_class`, raising `ValueError` mentioning "api
    overhead" when a class is absent -- never defaulted to zero, which would
    silently make cache hits free; `consumes_solver_slot = (cache_class !=
    "hit")`."""
    if wall_scale_factor <= 0:
        raise ValueError("wall_scale_factor must be positive")

    events = []
    for o in observations:
        if o.kind != "campaign" or not o.resource_complete:
            continue
        if o.case_key not in cache_class_by_case_key:
            raise ValueError(
                f"case_key {o.case_key!r} has no cache_class assignment")
        cache_class = cache_class_by_case_key[o.case_key]
        if cache_class not in api_overhead_by_cache_class:
            raise ValueError(
                f"missing measured api overhead for cache_class {cache_class!r}")
        api_overhead = api_overhead_by_cache_class[cache_class]
        if cache_class == "hit":
            solver_wall_sec = 0.0
            consumes_solver_slot = False
        else:
            solver_wall_sec = o.wall_sec * wall_scale_factor
            consumes_solver_slot = True
        events.append(EventSample(
            cache_class=cache_class, solver_wall_sec=solver_wall_sec,
            api_overhead_sec=api_overhead, consumes_solver_slot=consumes_solver_slot))
    return events
