# capacity_report.py
"""Phase 2 capacity-model driver: consumes a REAL benchmark-aggregates.csv
(produced by `cli.py run` against real CBC solves) and computes the
pure-computation capacity quantities defined in capacity.py, for the M-campaign
report.

Deliberately NOT named `test_*.py` and NOT part of `pytest benchmark/ -q` --
same convention as `real_solve_smoke.py`: it reads real measurement output,
it does not run real solves itself, but it is a one-off analysis driver, not
a unit-tested library module.

Everything computed here is either:
  (a) REAL -- derived directly from benchmark-aggregates.csv (a real campaign
      run), e.g. weighted mean CPU service demand, descriptive weighted p95.
  (b) ASSUMED and clearly labeled -- parallel_efficiency, headroom, illustrative
      box sizes. Never presented as measured. M2.1b (real calibration) requires
      Render infra and is explicitly out of scope for this local run.

Run directly:
    cd artifacts/api-server/src/solver/tests/benchmark
    python3 capacity_report.py --aggregates <path> --manifest corpus/manifest.json
"""
import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # tests/ for benchmark pkg

from benchmark.corpus import load_manifest, Manifest, Cell, Case  # noqa: E402
from benchmark.capacity import (weighted_mean_service_demand, required_cores,
                                 SizingError)  # noqa: E402
from benchmark.stats import CellStats  # noqa: E402

# ---------------------------------------------------------------------------
# Declared, NOT measured. The 50x50/hr load assumption taken as true per the
# programme decision (2026-09-22): 2,500 submissions/hr = 0.694/s, open-loop,
# sustained. See spec Sec 1.2.
ARRIVAL_RATE_PER_SEC = 0.694

# Sensitivity grid over ASSUMED (uncalibrated) parallel_efficiency/headroom.
# M2.1b (real concurrency-sweep calibration on a target Render plan) is the
# ONLY thing that can replace these with measured values; it requires Render
# infra and is out of scope for this local, no-infra run.
ASSUMED_EFFICIENCY_GRID = (1.0, 0.85, 0.7)
ASSUMED_HEADROOM_GRID = (0.20, 0.30)

# Illustrative box sizes for a naive "cores / box_size" divisor -- NOT a
# calibrated instances/slots mapping (that needs cores_per_slot + memory
# from M2.1b, which does not exist here). Purely for giving the reader a
# sense of scale; never advertised as a sizing answer.
ILLUSTRATIVE_BOX_CORES = (1, 2, 4, 8)

# JADE re-measure deliverable (M1.5 Step 5b) comparators, cited verbatim from
# the plan/spec text -- not re-derived, only compared against.
JADE_SPIKE_CLAIM_SEC = (0.6, 3.5)
JADE_PARENT_CLAIM_SEC = 13.0


def _load_aggregates(path):
    """Reconstruct the subset of CellStats fields capacity.py actually reads
    (usable, mean_cpu_tree_sec) from the real aggregates CSV, keyed by
    cell_key -- exactly what weighted_mean_service_demand() consumes."""
    stats = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            usable = row["usable"] == "True"
            stats[row["cell_key"]] = CellStats(
                n_cases=int(row["n_cases"]), n_obs=int(row["n_obs"]),
                n_success=int(row["n_success"]), usable=usable,
                unusable_reason=row["unusable_reason"] or None,
                mean_cpu_tree_sec=float(row["mean_cpu_tree_sec"]) if row["mean_cpu_tree_sec"] else 0.0,
                p95_wall=float(row["p95_wall"]) if row["p95_wall"] else 0.0,
            )
    return stats


def _excluded_manifest(manifest, excludes):
    """Drop the named strata (each 'model_id|regime|edit_family') and
    RENORMALIZE the remaining stratum weights to sum to 1, so sizing runs
    over the usable corpus mass. Returns (new_manifest, dropped, dropped_mass).

    This is an EXPLICIT, product-owner-approved exclusion of a stratum whose
    corpus cases are defective (not a silent skip — weighted_mean_service_demand
    fails closed on unusable strata by design). Used to ship a sizing number
    over usable mass when a known-bad stratum would otherwise block it; the
    excluded stratum and the mass it represented are printed, never hidden."""
    def stratum_id(s):
        return f"{s['model_id']}|{s['regime']}|{s.get('edit_family') or '-'}"
    keep, dropped = [], []
    for s in manifest.strata:
        (dropped if stratum_id(s) in excludes else keep).append(s)
    dropped_mass = sum(s["weight"] for s in dropped)
    kept_mass = sum(s["weight"] for s in keep)
    if kept_mass <= 0:
        raise SizingError("exclusion removed all corpus mass")
    renorm = [{**s, "weight": s["weight"] / kept_mass} for s in keep]
    return (Manifest(manifest.version, renorm, manifest.gaps),
            [stratum_id(s) for s in dropped], dropped_mass)


def _alt_free_choice_manifest(manifest):
    """M-R9 free-choice-frequency sensitivity: an ALTERNATE declared Manifest
    whose stratum weights shift mass toward free_choice, reusing the SAME
    strata/cases (only `weight` changes). This is a sensitivity INPUT, never
    a forecast of real student behaviour (M-R9 / corpus != prevalence)."""
    n = len(manifest.strata)
    n_forced = sum(1 for s in manifest.strata if s["regime"] == "forced_open")
    n_free = n - n_forced
    # Illustrative alternate split: forced_open aggregate weight 0.2,
    # free_choice aggregate weight 0.8 (vs. the declared equal-weight 1/n
    # each), redistributed evenly within each regime. This is the same
    # qualitative shift the spec's 20/60/20 hypothesis gestures at
    # (forced_open a minority of traffic), NOT a claim about its exact split.
    forced_w = 0.2 / n_forced if n_forced else 0.0
    free_w = 0.8 / n_free if n_free else 0.0
    alt_strata = []
    for s in manifest.strata:
        w = forced_w if s["regime"] == "forced_open" else free_w
        alt_strata.append({**s, "weight": w})
    return Manifest(manifest.version, alt_strata, manifest.gaps)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--aggregates", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--exclude-stratum", action="append", default=[],
                        metavar="model_id|regime|edit_family",
                        help="Drop this stratum from SIZING (sections 1/3/4) and "
                             "renormalize remaining weights. Explicit, printed exclusion "
                             "for a known-defective stratum. Repeatable.")
    args = parser.parse_args(argv)

    full_manifest = load_manifest(args.manifest, min_cases_per_cell=1)
    stats = _load_aggregates(args.aggregates)

    print("=" * 78)
    print("SCND Measurement -- Phase 2 capacity model (pure computation)")
    print(f"arrival_rate_per_sec (ASSUMED, 50x50/hr programme decision) = {ARRIVAL_RATE_PER_SEC}")
    print("=" * 78)

    # Sizing (sections 1/3/4) runs over `manifest`; descriptive/re-measure
    # (sections 2/5) always use the FULL manifest. When strata are excluded,
    # print exactly what was dropped and the mass it carried -- never silent.
    manifest = full_manifest
    if args.exclude_stratum:
        manifest, dropped, dropped_mass = _excluded_manifest(full_manifest, set(args.exclude_stratum))
        print("\n--- EXCLUSION (explicit, product-owner-approved; sizing over usable mass) ---")
        print(f"  dropped strata: {dropped}")
        print(f"  removed corpus mass (pre-renorm, summed over strata): {dropped_mass:.4f}")
        print(f"  remaining {len(manifest.strata)} strata renormalized to sum=1 for sizing.")
        print("  Reason: defective corpus cases (distanceOverrides toId uses bare city")
        print("  codes, not full CITY,STATE customer ids). Descriptive sections below")
        print("  (2, 5) still use the FULL manifest and report the stratum as unusable.")

    # ---- 1. REAL: weighted mean CPU service demand per gap -----------------
    print("\n--- 1. Weighted mean CPU service demand (REAL, corpus-declared weights) ---")
    demand_by_gap = {}
    for gap in manifest.gaps:
        try:
            d = weighted_mean_service_demand(stats, manifest, gap)
            demand_by_gap[gap] = d
            print(f"  gap={gap}: E[S_cpu] = {d:.4f} CPU-sec/job")
        except SizingError as e:
            demand_by_gap[gap] = None
            print(f"  gap={gap}: unknown -- SizingError: {e}")

    # ---- 2. Descriptive: corpus-weighted p95 wall (NEVER a sizing input) ---
    print("\n--- 2. Descriptive weighted p95 wall (REAL; NEVER used for sizing) ---")
    for gap in full_manifest.gaps:
        total_w, total = 0.0, 0.0
        missing = []
        for cell in full_manifest.cells():
            if cell.gap != gap:
                continue
            cs = stats.get(cell.key)
            if cs is None or not cs.usable:
                missing.append(cell.key)
                continue
            total += cell.weight * cs.p95_wall
            total_w += cell.weight
        if missing:
            print(f"  gap={gap}: partial (missing/unusable: {missing}) "
                  f"weighted_p95_wall(over usable mass {total_w:.3f}) = {total:.4f}s")
        else:
            print(f"  gap={gap}: weighted_p95_wall = {total:.4f}s")

    # ---- 3. Free-choice-frequency sensitivity (M-R9) ------------------------
    print("\n--- 3. Free-choice-frequency sensitivity (ASSUMED alternate weights, gap=0) ---")
    alt_manifest = _alt_free_choice_manifest(manifest)
    base = demand_by_gap.get(0.0)
    try:
        alt = weighted_mean_service_demand(stats, alt_manifest, 0.0)
        if base:
            rel = (alt - base) / base
            print(f"  declared-weight E[S_cpu](gap=0) = {base:.4f}")
            print(f"  alt-weight(forced=0.2/free=0.8) E[S_cpu](gap=0) = {alt:.4f}")
            print(f"  relative change = {rel:+.2%}  (sensitivity input, NOT a forecast)")
        else:
            print("  base demand unknown -- cannot compute relative change")
    except SizingError as e:
        print(f"  unknown -- SizingError: {e}")

    # ---- 4. Required cores at assumed rate, sensitivity grid ---------------
    print("\n--- 4. Required CORES at assumed 50x50/hr rate (ASSUMED efficiency/headroom) ---")
    print("  UNCALIBRATED: parallel_efficiency and headroom are declared assumptions,")
    print("  not measured (M2.1b calibration needs Render infra, out of scope here).")
    d0 = demand_by_gap.get(0.0)
    if d0 is None:
        print("  gap=0 demand unknown -- cannot compute required cores")
    else:
        print(f"  {'efficiency':>10} {'headroom':>9} {'cores':>10}")
        for eff in ASSUMED_EFFICIENCY_GRID:
            for hr in ASSUMED_HEADROOM_GRID:
                cores = required_cores(d0, ARRIVAL_RATE_PER_SEC, eff, hr)
                print(f"  {eff:>10.2f} {hr:>9.2f} {cores:>10.3f}")

        print("\n  Illustrative box-count divisor (NOT a calibrated instances/slots")
        print("  mapping -- map_to_instances() needs cores_per_slot + memory from")
        print("  M2.1b, which does not exist here):")
        eff, hr = 0.85, 0.30   # a single illustrative point from the grid above
        cores = required_cores(d0, ARRIVAL_RATE_PER_SEC, eff, hr)
        print(f"  (at efficiency={eff}, headroom={hr} -> {cores:.3f} cores)")
        for box in ILLUSTRATIVE_BOX_CORES:
            import math
            n_boxes = math.ceil(cores / box)
            print(f"    {box}-core boxes @ 100% naive utilization -> {n_boxes} box(es)")

    # ---- 5. JADE re-measure deliverable (M1.5 Step 5b) ----------------------
    print("\n--- 5. JADE forced_open gap=0 re-measure vs. prior claims (F-R20) ---")
    jade_key_prefix = "two-echelon-jade-us|forced_open"
    matched = [k for k in stats if k.startswith(jade_key_prefix) and k.endswith("|0.0")]
    if not matched:
        print("  unknown -- no matching cell in aggregates")
    for k in matched:
        cs = stats[k]
        if not cs.usable:
            print(f"  {k}: unusable ({cs.unusable_reason})")
            continue
        p95 = cs.p95_wall
        print(f"  {k}: p95_wall = {p95:.3f}s "
              f"(spike claim {JADE_SPIKE_CLAIM_SEC[0]}-{JADE_SPIKE_CLAIM_SEC[1]}s, "
              f"parent claim ~{JADE_PARENT_CLAIM_SEC}s)")
        if JADE_SPIKE_CLAIM_SEC[0] <= p95 <= JADE_SPIKE_CLAIM_SEC[1]:
            print("    -> supports the SPIKE claim")
        elif abs(p95 - JADE_PARENT_CLAIM_SEC) <= 2.0:
            print("    -> supports the PARENT claim")
        else:
            print("    -> supports NEITHER prior claim")

    print("\n" + "=" * 78)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
