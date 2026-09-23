# capacity.py
import csv
from dataclasses import dataclass

class SizingError(ValueError):
    pass

@dataclass(frozen=True)
class Calibration:
    plan_id: str
    app_sha: str
    profile_id: str
    gap: float
    target_mean_cpu_sec: float
    slots_per_instance: int
    cores_per_slot: float
    rss_per_slot_bytes: int
    instance_memory_bytes: int
    wall_scale_factor: float

def weighted_mean_service_demand(stats, manifest, gap):
    """L-R2: ONE gap at a time. gap=0 is the mandatory baseline; relaxed gaps
    are separate alternatives, never averaged together. Fails closed on any
    missing or unusable stratum -- silently skipping shrank the estimate."""
    total = 0.0
    for cell in manifest.cells():
        if cell.gap != gap:
            continue
        cs = stats.get(cell.key)
        if cs is None:
            raise SizingError(f"required stratum missing: {cell.key}")
        if not cs.usable:
            raise SizingError(f"stratum unusable ({cs.unusable_reason}): {cell.key}")
        total += cell.weight * cs.mean_cpu_tree_sec
    return total

def required_cores(demand_cpu_sec, arrival_rate_per_sec, parallel_efficiency, headroom):
    """Returns CPU CORES.

    R3-R2: my last fold renamed this to required_solver_slots() in response to
    'topology is instances x slots'. Renaming does not convert units. This
    formula is lambda * E[S_cpu] / (efficiency * (1 - headroom)) -- its units
    are cores, full stop. A solver slot may consume less than, equal to or
    more than one effective core at the measured concurrency point, and memory
    can cap slots before CPU does. Conflating the two can make the plan's
    central output wrong while looking arithmetically fine.
    """
    if not (0 < parallel_efficiency <= 1):
        raise ValueError("parallel_efficiency must be in (0, 1]")
    if not (0 <= headroom < 1):
        raise ValueError("headroom must be in [0, 1)")
    return (demand_cpu_sec * arrival_rate_per_sec) / (parallel_efficiency * (1 - headroom))

def map_to_instances(required_cores, slots_per_instance, cores_per_slot,
                     rss_per_slot_bytes, instance_memory_bytes):
    """Cores + memory -> (instances, slots_per_instance). The ONLY place the
    two units meet. Both inputs come from M2.1b calibration, keyed by
    plan_id + app_sha. Memory-capped slots win when they bind first."""
    import math
    mem_capped = max(1, instance_memory_bytes // rss_per_slot_bytes)
    slots = min(slots_per_instance, mem_capped)
    cores_per_instance = slots * cores_per_slot
    instances = math.ceil(required_cores / cores_per_instance)
    return instances, slots

def load_calibration(path, *, plan_id, app_sha, profile_id, gap):
    with open(path, newline="") as f:
        matches = [r for r in csv.DictReader(f)
                   if r["plan_id"] == plan_id and r["app_sha"] == app_sha
                   and r["profile_id"] == profile_id
                   and float(r["gap"]) == float(gap)]
    if len(matches) != 1:
        raise SizingError(f"expected exactly one calibration row, found {len(matches)}")
    r = matches[0]
    cal = Calibration(plan_id, app_sha, profile_id, float(gap),
                      float(r["target_mean_cpu_sec"]), int(r["slots_per_instance"]),
                      float(r["cores_per_slot"]), int(r["rss_per_slot_bytes"]),
                      int(r["instance_memory_bytes"]), float(r["wall_scale_factor"]))
    if min(cal.target_mean_cpu_sec, cal.slots_per_instance, cal.cores_per_slot,
           cal.rss_per_slot_bytes, cal.instance_memory_bytes,
           cal.wall_scale_factor) <= 0:
        raise SizingError("calibration values must be positive")
    return cal

def size_calibrated_plan(calibration, arrival_rate_per_sec, headroom):
    # Contention is already inside target_mean_cpu_sec AND cores_per_slot --
    # both measured at the operating concurrency (M2.1b Step 3). Do not
    # divide by an efficiency term again.
    cores = required_cores(calibration.target_mean_cpu_sec, arrival_rate_per_sec,
                           parallel_efficiency=1.0, headroom=headroom)
    instances, slots = map_to_instances(
        cores, calibration.slots_per_instance, calibration.cores_per_slot,
        calibration.rss_per_slot_bytes, calibration.instance_memory_bytes)
    return instances, slots, cores
