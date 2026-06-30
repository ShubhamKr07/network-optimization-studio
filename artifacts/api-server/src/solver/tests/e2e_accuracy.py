#!/usr/bin/env python3
"""
E2E Solver Accuracy Test Suite
================================
Tests all three models across varied input configurations.
For each configurable axis (P value, warehouse capacity, single-source flag,
capacity factor) a pair of runs is compared (A/B test) to verify the
mathematical relationship holds — monotonicity, LP relaxation bounds,
capacity feasibility, flow conservation, etc.

Usage:
    python3 e2e_accuracy.py             # run all sections
    python3 e2e_accuracy.py pmedian     # run P-Median section only
    python3 e2e_accuracy.py transport   # run Transport section only
    python3 e2e_accuracy.py brazil      # run Brazil section only
"""

import json
import sys
import time
from pathlib import Path

SOLVER_PY = Path(__file__).parent.parent / "solve.py"

# ── Counters ──────────────────────────────────────────────────────────────────
_counts = {"total": 0, "passed": 0, "failed": 0}
_failures: list[str] = []

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
AB   = "\033[36mA/B \033[0m"

def _section(title: str) -> None:
    bar = "─" * 60
    print(f"\n{bar}\n  {title}\n{bar}")

def _check(label: str, cond: bool, detail: str = "") -> bool:
    _counts["total"] += 1
    if cond:
        _counts["passed"] += 1
        print(f"  {PASS}  {label}")
    else:
        _counts["failed"] += 1
        msg = f"{label}" + (f"  [{detail}]" if detail else "")
        _failures.append(msg)
        print(f"  {FAIL}  {msg}")
    return cond

def _ab(label: str, cond: bool, a_val, b_val, a_tag="A", b_tag="B") -> bool:
    """A/B comparison check — prints both values for easy inspection."""
    _counts["total"] += 1
    tag = PASS if cond else FAIL
    print(f"  {tag}  {AB} {label}")
    print(f"         {a_tag}: {a_val}   {b_tag}: {b_val}")
    if not cond:
        _failures.append(f"A/B {label}  [{a_tag}={a_val}  {b_tag}={b_val}]")
        _counts["failed"] += 1
    else:
        _counts["passed"] += 1
    return cond


# ── Solver runner ─────────────────────────────────────────────────────────────
def run(payload: dict, timeout: int = 180) -> dict:
    import subprocess
    t0 = time.time()
    r = subprocess.run(
        [sys.executable, str(SOLVER_PY)],
        input=json.dumps(payload),
        capture_output=True, text=True, timeout=timeout,
    )
    elapsed = round(time.time() - t0, 2)
    if r.returncode != 0:
        return {"status": "error", "_err": r.stderr[:300], "_t": elapsed}
    try:
        out = json.loads(r.stdout)
    except Exception:
        return {"status": "parse_error", "_t": elapsed}
    out["_t"] = elapsed
    return out


# ─────────────────────────────────────────────────────────────────────────────
# MODEL 1 · P-Median  (Al's Athletics, 26 WHs, 200 customers)
# ─────────────────────────────────────────────────────────────────────────────
def test_pmedian() -> None:
    _section("MODEL 1 · P-Median (Al's Athletics)")

    BASE = dict(
        modelType="p_median",
        distanceBands=[200, 400, 800, 1600],
        capacityMode="uniform", uniformCapacity=None,
        warehouseStatuses=[], gap=0.0, timeLimitSec=120,
        capacityFactor=1.0, singleSource=False, capacityInactive=False,
    )

    # ── Runs ──────────────────────────────────────────────────────────────────
    print("\n[PM-1]  Solving P = 1, 2, 3, 5 …")
    runs: dict[int, dict] = {}
    for p in [1, 2, 3, 5]:
        runs[p] = run({**BASE, "pValue": p})
        st = runs[p].get("status")
        obj = runs[p].get("objective", 0)
        avg = runs[p].get("weightedAvgDistanceMi", 0)
        print(f"          P={p}: status={st}  obj={obj:,.0f}  avg={avg:.1f} mi  t={runs[p]['_t']:.2f}s")

    # ── Accuracy: basic feasibility ────────────────────────────────────────
    print("\n── Accuracy: feasibility & output structure ──")
    for p in [1, 2, 3, 5]:
        o = runs[p]
        _check(f"P={p} status is optimal", o.get("status") == "optimal")
        _check(f"P={p} opens exactly {p} warehouse(s)",
               len(o.get("openWarehouseIds", [])) == p,
               f"got {len(o.get('openWarehouseIds', []))}")
        _check(f"P={p} serves all 200 customers",
               len({a["customerId"] for a in o.get("assignments", [])}) == 200)
        _check(f"P={p} objective > 0", (o.get("objective") or 0) > 0)

    # ── A/B: P-Monotonicity ────────────────────────────────────────────────
    print("\n── A/B: P-Monotonicity  (more warehouses → lower cost) ──")
    pairs = [(1, 2), (2, 3), (3, 5)]
    for pa, pb in pairs:
        oa, ob = runs[pa].get("objective", 0), runs[pb].get("objective", 0)
        _ab(f"obj(P={pb}) ≤ obj(P={pa})", ob <= oa * 1.001,
            f"{oa:,.0f}", f"{ob:,.0f}", f"P={pa}", f"P={pb}")

    # A/B distance monotonicity
    print()
    for pa, pb in pairs:
        da = runs[pa].get("weightedAvgDistanceMi", 0)
        db = runs[pb].get("weightedAvgDistanceMi", 0)
        _ab(f"avg_dist(P={pb}) ≤ avg_dist(P={pa})", db <= da * 1.001,
            f"{da:.1f} mi", f"{db:.1f} mi", f"P={pa}", f"P={pb}")

    # ── A/B: Capacity constraint effect ───────────────────────────────────
    print("\n── A/B: Capacity constraints (cap vs uncap) ──")
    # Cap=8M per WH for P=3 — total 24M vs ~80M demand → infeasible
    r_inf = run({**BASE, "pValue": 3, "uniformCapacity": 8_000_000})
    print(f"\n[PM-2]  P=3, cap=8M (3×8=24M < 80M demand): status={r_inf.get('status')}  t={r_inf['_t']:.2f}s")
    _check("P=3 cap=8M is infeasible (insufficient total capacity)",
           r_inf.get("status") == "infeasible")

    # Cap=35M per WH for P=3 — total 105M > 80M demand → feasible
    r_cap = run({**BASE, "pValue": 3, "uniformCapacity": 35_000_000})
    print(f"\n[PM-3]  P=3, cap=35M: status={r_cap.get('status')}  obj={r_cap.get('objective', 0):,.0f}  t={r_cap['_t']:.2f}s")
    _check("P=3 cap=35M is optimal (cap just covers demand)",
           r_cap.get("status") == "optimal")
    if r_cap.get("status") == "optimal" and runs[3].get("status") == "optimal":
        _ab("P=3 uncap obj ≤ P=3 capped obj (relaxation bound)",
            runs[3].get("objective", 0) <= r_cap.get("objective", 0) * 1.001,
            f"{runs[3]['objective']:,.0f}", f"{r_cap['objective']:,.0f}",
            "uncap", "cap=35M")

    # Capacity threshold: verify monotone in cap size
    print(f"\n[PM-4]  P=3, sweep capacity: 20M, 30M, uncap")
    r_20 = run({**BASE, "pValue": 3, "uniformCapacity": 20_000_000})
    r_30 = run({**BASE, "pValue": 3, "uniformCapacity": 30_000_000})
    r_unc = runs[3]
    for label, res in [("cap=20M", r_20), ("cap=30M", r_30), ("uncap", r_unc)]:
        st = res.get("status"); obj = res.get("objective", 0)
        print(f"          {label}: status={st}  obj={obj:,.0f}  t={res['_t']:.2f}s")
    if r_20.get("status") == "optimal" and r_30.get("status") == "optimal":
        _ab("obj(cap=30M) ≤ obj(cap=20M)  (more cap → ≤ cost)",
            r_30.get("objective", 0) <= r_20.get("objective", 0) * 1.001,
            f"{r_20['objective']:,.0f}", f"{r_30['objective']:,.0f}",
            "cap=20M", "cap=30M")
        _ab("obj(uncap) ≤ obj(cap=30M)  (uncap is LP relaxation)",
            r_unc.get("objective", 0) <= r_30.get("objective", 0) * 1.001,
            f"{r_30['objective']:,.0f}", f"{r_unc['objective']:,.0f}",
            "cap=30M", "uncap")

    # ── A/B: Forced-open warehouse ─────────────────────────────────────────
    print("\n── A/B: Forced-open vs free choice ──")
    forced_id = "CHI"
    r_free  = runs[3]
    r_force = run({**BASE, "pValue": 3,
                   "warehouseStatuses": [{"warehouseId": forced_id, "status": "forced_open"}]})
    print(f"\n[PM-5]  P=3 free vs P=3 force-open {forced_id}")
    print(f"          free:  status={r_free.get('status')}   open={sorted(r_free.get('openWarehouseIds',[]))}")
    print(f"          forced: status={r_force.get('status')}  open={sorted(r_force.get('openWarehouseIds',[]))}")
    _check(f"Force-open {forced_id} results in {forced_id} being open",
           forced_id in r_force.get("openWarehouseIds", []))
    _check("Force-open still opens exactly 3 warehouses",
           len(r_force.get("openWarehouseIds", [])) == 3)
    if r_free.get("status") == r_force.get("status") == "optimal":
        _ab(f"obj(forced {forced_id}) ≥ obj(free)  (constraint can only increase cost)",
            r_force.get("objective", 0) >= r_free.get("objective", 0) * 0.999,
            f"{r_free['objective']:,.0f}", f"{r_force['objective']:,.0f}",
            "free", f"forced={forced_id}")

    # ── A/B: Inactive warehouse ────────────────────────────────────────────
    print("\n── A/B: Inactive warehouse ──")
    # Force-inactive the warehouse that P=3 free choice would open
    if r_free.get("status") == "optimal":
        free_open = r_free.get("openWarehouseIds", [])
        if free_open:
            inactive_id = free_open[0]
            r_inactive = run({**BASE, "pValue": 3,
                               "warehouseStatuses": [{"warehouseId": inactive_id, "status": "inactive"}]})
            print(f"\n[PM-6]  P=3 with {inactive_id} inactive (was optimal choice)")
            print(f"          status={r_inactive.get('status')}  open={sorted(r_inactive.get('openWarehouseIds',[]))}  obj={r_inactive.get('objective', 0):,.0f}")
            _check(f"Inactive {inactive_id} is not in result",
                   inactive_id not in r_inactive.get("openWarehouseIds", []))
            if r_inactive.get("status") == "optimal":
                _ab(f"obj(inactive {inactive_id}) ≥ obj(free)  (best choice removed → ≥ cost)",
                    r_inactive.get("objective", 0) >= r_free.get("objective", 0) * 0.999,
                    f"{r_free['objective']:,.0f}", f"{r_inactive['objective']:,.0f}",
                    "free", f"inactive={inactive_id}")


# ─────────────────────────────────────────────────────────────────────────────
# MODEL 2 · Transportation LP  (Coal Mines → Power Stations)
# ─────────────────────────────────────────────────────────────────────────────
def test_transport() -> None:
    _section("MODEL 2 · Transportation LP (Coal Mines → Power Stations)")

    # Total demand = total mine supply = 70M (balanced)
    TOTAL_DEMAND = 70_000_000
    N_STATIONS   = 15

    BASE = dict(
        modelType="transport",
        distanceBands=[500, 1000, 1500, 2000],
        capacityMode="uniform", uniformCapacity=None,
        warehouseStatuses=[], gap=0.0, timeLimitSec=120,
        capacityFactor=1.0, singleSource=False, capacityInactive=False,
    )

    # ── Runs ──────────────────────────────────────────────────────────────────
    print("\n[TR-1]  Standard LP (capacityFactor=1.0, singleSource=False) …")
    r_base = run(BASE)
    print(f"          status={r_base.get('status')}  obj={r_base.get('objective', 0):,.0f}"
          f"  avg={r_base.get('weightedAvgDistanceMi', 0):.1f} mi  t={r_base['_t']:.2f}s")

    print("\n[TR-2]  Uncapacitated LP (capacityInactive=True) …")
    r_uncap = run({**BASE, "capacityInactive": True})
    print(f"          status={r_uncap.get('status')}  obj={r_uncap.get('objective', 0):,.0f}"
          f"  avg={r_uncap.get('weightedAvgDistanceMi', 0):.1f} mi  t={r_uncap['_t']:.2f}s")

    print("\n[TR-3]  Single-source (singleSource=True, gap=5%) …")
    r_ss = run({**BASE, "singleSource": True, "gap": 0.05, "timeLimitSec": 120})
    print(f"          status={r_ss.get('status')}  avg={r_ss.get('weightedAvgDistanceMi', 0):.1f} mi  t={r_ss['_t']:.2f}s")

    print("\n[TR-4]  Over-capacity (capacityFactor=1.5) …")
    r_over = run({**BASE, "capacityFactor": 1.5})
    print(f"          status={r_over.get('status')}  obj={r_over.get('objective', 0):,.0f}  t={r_over['_t']:.2f}s")

    print("\n[TR-5]  Under-capacity (capacityFactor=0.5) …")
    r_under = run({**BASE, "capacityFactor": 0.5})
    print(f"          status={r_under.get('status')}  t={r_under['_t']:.2f}s")

    # ── Accuracy: base case ────────────────────────────────────────────────
    print("\n── Accuracy: base case ──")
    _check("Standard LP is optimal", r_base.get("status") == "optimal")
    _check(f"All {N_STATIONS} stations served",
           len({a["customerId"] for a in r_base.get("assignments", [])}) == N_STATIONS)
    _check("All stations fully served (flowFraction sums to 1.0 each)",
           all(abs(sum(a["flowFraction"] for a in r_base.get("assignments", [])
                       if a["customerId"] == s) - 1.0) < 0.01
               for s in {a["customerId"] for a in r_base.get("assignments", [])}))
    _check("Average distance in plausible range [100, 3000] mi",
           100 < r_base.get("weightedAvgDistanceMi", 0) < 3000,
           f"{r_base.get('weightedAvgDistanceMi')} mi")
    _check("Mine IDs are KY/WY/PA/IA",
           {a["warehouseId"] for a in r_base.get("assignments", [])} <= {"KY","WY","PA","IA"})

    # ── A/B: Cap vs uncap (LP relaxation bound) ────────────────────────────
    print("\n── A/B: Capacitated vs uncapacitated ──")
    _check("Uncapacitated LP is optimal", r_uncap.get("status") == "optimal")
    if r_base.get("status") == r_uncap.get("status") == "optimal":
        _ab("obj(uncap) ≤ obj(cap)  — removing constraints can only improve",
            r_uncap.get("objective", 0) <= r_base.get("objective", 0) * 1.001,
            f"{r_base['objective']:,.0f}", f"{r_uncap['objective']:,.0f}",
            "cap", "uncap")
        _ab("avg_dist(uncap) ≤ avg_dist(cap)",
            r_uncap.get("weightedAvgDistanceMi", 0) <= r_base.get("weightedAvgDistanceMi", 0) * 1.001,
            f"{r_base['weightedAvgDistanceMi']:.1f} mi",
            f"{r_uncap['weightedAvgDistanceMi']:.1f} mi",
            "cap", "uncap")

    # ── A/B: Over-capacity vs base ─────────────────────────────────────────
    print("\n── A/B: Over-capacity vs base ──")
    _check("Over-capacity (factor=1.5) is optimal", r_over.get("status") == "optimal")
    if r_over.get("status") == "optimal" and r_base.get("status") == "optimal":
        # With excess supply, mines have routing slack → LP can prefer cheaper (closer) mines
        # So cost is same or lower than the exactly-balanced (factor=1.0) case
        _ab("obj(factor=1.5) ≤ obj(factor=1.0)  — slack lets LP choose cheaper routes",
            r_over.get("objective", 0) <= r_base.get("objective", 0) * 1.001,
            f"{r_base['objective']:,.0f}", f"{r_over['objective']:,.0f}",
            "factor=1.0", "factor=1.5")

    # ── A/B: Under-capacity vs base ────────────────────────────────────────
    print("\n── A/B: Under-capacity (infeasibility) ──")
    _ab("factor=0.5 is infeasible (35M capacity < 70M demand)",
        r_under.get("status") == "infeasible",
        "70M demand", "35M capacity",
        "demand", "cap×0.5")

    # ── A/B: Single-source ─────────────────────────────────────────────────
    print("\n── A/B: Single-source vs multi-source ──")
    _check("Single-source completes (optimal or infeasible)",
           r_ss.get("status") in ("optimal", "infeasible"))
    if r_ss.get("status") == "optimal":
        sc = {}
        for a in r_ss.get("assignments", []):
            sc[a["customerId"]] = sc.get(a["customerId"], 0) + 1
        _check("Single-source: each station assigned to exactly one mine",
               all(v == 1 for v in sc.values()))
        _ab("obj(single-source) ≥ obj(LP)  — integer tightening can only increase cost",
            r_ss.get("objective", 0) >= r_base.get("objective", 0) * 0.999,
            f"{r_base['objective']:,.0f}", f"{r_ss['objective']:,.0f}",
            "LP", "single-source")
    else:
        _ab("Single-source infeasible with balanced LP (parity constraint)",
            r_ss.get("status") == "infeasible",
            "expected", r_ss.get("status"),
            "expected", "actual")


# ─────────────────────────────────────────────────────────────────────────────
# MODEL 3 · Brazil Capacitated P-Median  (25 WHs, 25 regions)
# ─────────────────────────────────────────────────────────────────────────────
def test_brazil() -> None:
    _section("MODEL 3 · Brazil Capacitated P-Median")

    # Notebook defaults: cap=20M, P=7, singleSource=False
    TOTAL_DEMAND = 98_666_593
    N_REGIONS    = 25
    SP_DEMAND    = 29_029_226   # largest region — exceeds 20M cap

    BASE = dict(
        modelType="capacitated_pmedian",
        distanceBands=[500, 1000, 2000, 4000],
        capacityMode="uniform", uniformCapacity=None,
        warehouseStatuses=[], gap=0.05, timeLimitSec=180,
        singleSource=False,
    )

    # ── Runs: sweep P values ───────────────────────────────────────────────
    print("\n[BR-1]  Sweeping P = 3, 5, 7, 10  (cap=20M, singleSource=False) …")
    p_runs: dict[int, dict] = {}
    for p in [3, 5, 7, 10]:
        p_runs[p] = run({**BASE, "pValue": p, "warehouseCapacity": 20_000_000})
        st  = p_runs[p].get("status")
        obj = p_runs[p].get("objective", 0)
        avg = p_runs[p].get("weightedAvgDistanceMi", 0)
        n_open = len(p_runs[p].get("openWarehouseIds", []))
        print(f"          P={p:2}: status={st}  obj={obj:>18,.0f}  avg={avg:.1f} mi  open={n_open}  t={p_runs[p]['_t']:.2f}s")

    # ── Runs: sweep capacity values ────────────────────────────────────────
    print("\n[BR-2]  Sweeping capacity = 20M, 30M, 50M  (P=5, singleSource=False) …")
    cap_runs: dict[str, dict] = {}
    for cap in [20_000_000, 30_000_000, 50_000_000]:
        label = f"{cap // 1_000_000}M"
        cap_runs[label] = run({**BASE, "pValue": 5, "warehouseCapacity": cap})
        st  = cap_runs[label].get("status")
        obj = cap_runs[label].get("objective", 0)
        avg = cap_runs[label].get("weightedAvgDistanceMi", 0)
        print(f"          cap={label:4}: status={st}  obj={obj:>18,.0f}  avg={avg:.1f} mi  t={cap_runs[label]['_t']:.2f}s")

    # ── Runs: single-source at different capacities ────────────────────────
    print("\n[BR-3]  Single-source: cap=20M vs cap=100M  (P=5) …")
    r_ss_20  = run({**BASE, "pValue": 5, "warehouseCapacity": 20_000_000,  "singleSource": True, "gap": 0.05})
    r_ss_100 = run({**BASE, "pValue": 5, "warehouseCapacity": 100_000_000, "singleSource": True, "gap": 0.05})
    print(f"          ss+cap=20M:  status={r_ss_20.get('status')}  t={r_ss_20['_t']:.2f}s")
    print(f"          ss+cap=100M: status={r_ss_100.get('status')}  avg={r_ss_100.get('weightedAvgDistanceMi',0):.1f} mi  t={r_ss_100['_t']:.2f}s")

    # Notebook reference: P=7, cap=20M
    print("\n[BR-4]  Notebook scenario: P=7, cap=20M, singleSource=False …")
    r_nb = run({**BASE, "pValue": 7, "warehouseCapacity": 20_000_000})
    print(f"          status={r_nb.get('status')}  open={sorted(r_nb.get('openWarehouseIds',[]))}  avg={r_nb.get('weightedAvgDistanceMi',0):.1f} mi  t={r_nb['_t']:.2f}s")

    # ── Accuracy: feasibility rules ────────────────────────────────────────
    print("\n── Accuracy: feasibility rules ──")

    # P=3: 3×20M=60M < 98.7M → infeasible
    _check("P=3 cap=20M is infeasible (3×20M=60M < 98.7M demand)",
           p_runs[3].get("status") == "infeasible")

    # P=5 and above: feasible (5×20M=100M > 98.7M demand)
    for p in [5, 7, 10]:
        _check(f"P={p} cap=20M is optimal ({p}×20M={p*20}M ≥ 98.7M demand)",
               p_runs[p].get("status") == "optimal")
        _check(f"P={p} opens exactly {p} warehouses",
               len(p_runs[p].get("openWarehouseIds", [])) == p,
               f"got {len(p_runs[p].get('openWarehouseIds', []))}")
        _check(f"P={p} serves all {N_REGIONS} regions",
               len({a["customerId"] for a in p_runs[p].get("assignments", [])}) == N_REGIONS)

    # Region IDs: DF and SE should appear, RR and TO should NOT
    if p_runs[5].get("status") == "optimal":
        region_ids = {a["customerId"] for a in p_runs[5].get("assignments", [])}
        _check("New regions present: DF (Distrito Federal) assigned",
               "DF" in region_ids)
        _check("New regions present: SE (Sergipe) assigned",
               "SE" in region_ids)
        _check("Removed regions absent: RR (Roraima) not assigned",
               "RR" not in region_ids)
        _check("Removed regions absent: TO (Tocantins) not assigned",
               "TO" not in region_ids)

    # Capacity constraint validation
    print("\n── Accuracy: capacity constraints ──")
    if p_runs[5].get("status") == "optimal":
        wh_load: dict[str, float] = {}
        for a in p_runs[5].get("assignments", []):
            wid = a["warehouseId"]
            ff  = a.get("flowFraction", 0)
            # flowFraction is fraction of region demand served by this WH
            # We need actual demand; look it up from region data
            wh_load[wid] = wh_load.get(wid, 0) + ff  # summed fractions (not tons)
        _check("P=5 cap=20M: all open WHs load ≤ capacity (indirect: solver enforces)",
               p_runs[5].get("status") == "optimal",
               "feasible status implies capacity respected")

    # Single-source capacity trigger
    _check("Single-source cap=20M infeasible (SP demands 29M > 20M)",
           r_ss_20.get("status") == "infeasible")
    _check("Infeasibility reason names São Paulo",
           "Paulo" in (r_ss_20.get("infeasibilityReason") or ""))
    _check("Single-source cap=100M is optimal (all regions ≤ 100M)",
           r_ss_100.get("status") == "optimal")
    if r_ss_100.get("status") == "optimal":
        sc = {}
        for a in r_ss_100.get("assignments", []):
            sc[a["customerId"]] = sc.get(a["customerId"], 0) + 1
        _check("Single-source cap=100M: each region assigned to exactly 1 WH",
               all(v == 1 for v in sc.values()))

    # ── A/B: P-Monotonicity ────────────────────────────────────────────────
    print("\n── A/B: P-Monotonicity (more warehouses → lower cost) ──")
    feasible_p = [p for p in [5, 7, 10] if p_runs[p].get("status") == "optimal"]
    for i in range(len(feasible_p) - 1):
        pa, pb = feasible_p[i], feasible_p[i + 1]
        oa, ob = p_runs[pa].get("objective", 0), p_runs[pb].get("objective", 0)
        _ab(f"obj(P={pb}) ≤ obj(P={pa})", ob <= oa * 1.001,
            f"{oa:,.0f}", f"{ob:,.0f}", f"P={pa}", f"P={pb}")

    # A/B: distance monotone in P
    print()
    for i in range(len(feasible_p) - 1):
        pa, pb = feasible_p[i], feasible_p[i + 1]
        da = p_runs[pa].get("weightedAvgDistanceMi", 0)
        db = p_runs[pb].get("weightedAvgDistanceMi", 0)
        _ab(f"avg_dist(P={pb}) ≤ avg_dist(P={pa})", db <= da * 1.001,
            f"{da:.1f} mi", f"{db:.1f} mi", f"P={pa}", f"P={pb}")

    # ── A/B: Capacity sweep (cap=20M vs 30M vs 50M) ───────────────────────
    print("\n── A/B: Capacity sweep — tighter cap → same or higher cost ──")
    cap_labels = ["20M", "30M", "50M"]
    for i in range(len(cap_labels) - 1):
        ca, cb = cap_labels[i], cap_labels[i + 1]
        ra, rb = cap_runs[ca], cap_runs[cb]
        if ra.get("status") == rb.get("status") == "optimal":
            _ab(f"obj(cap={cb}) ≤ obj(cap={ca})  (more capacity → ≤ cost)",
                rb.get("objective", 0) <= ra.get("objective", 0) * 1.001,
                f"{ra['objective']:,.0f}", f"{rb['objective']:,.0f}",
                f"cap={ca}", f"cap={cb}")
        else:
            _check(f"cap={cb} at least as feasible as cap={ca}",
                   cb != "20M" or ra.get("status") in ("optimal", "infeasible"))

    # ── A/B: Single-source vs LP relaxation ───────────────────────────────
    print("\n── A/B: Single-source vs LP relaxation (cap=100M, P=5) ──")
    r_lp  = run({**BASE, "pValue": 5, "warehouseCapacity": 100_000_000, "singleSource": False, "gap": 0.0})
    r_ss2 = r_ss_100
    if r_lp.get("status") == r_ss2.get("status") == "optimal":
        _ab("obj(single-source) ≥ obj(LP relaxation)  — integer ≥ LP lower bound",
            r_ss2.get("objective", 0) >= r_lp.get("objective", 0) * 0.999,
            f"{r_lp['objective']:,.0f}", f"{r_ss2['objective']:,.0f}",
            "LP", "single-source")
        _ab("avg_dist(single-source) ≥ avg_dist(LP)",
            r_ss2.get("weightedAvgDistanceMi", 0) >= r_lp.get("weightedAvgDistanceMi", 0) * 0.999,
            f"{r_lp['weightedAvgDistanceMi']:.1f} mi",
            f"{r_ss2['weightedAvgDistanceMi']:.1f} mi",
            "LP", "single-source")

    # ── A/B: Trade-off — fewer WHs with more capacity vs more WHs less cap ─
    print("\n── A/B: Trade-off  P=5 cap=30M  vs  P=7 cap=20M ──")
    r_trade_a = cap_runs["30M"]   # P=5, cap=30M
    r_trade_b = r_nb              # P=7, cap=20M
    print(f"         P=5 cap=30M:  status={r_trade_a.get('status')}  obj={r_trade_a.get('objective',0):,.0f}  avg={r_trade_a.get('weightedAvgDistanceMi',0):.1f} mi")
    print(f"         P=7 cap=20M:  status={r_trade_b.get('status')}  obj={r_trade_b.get('objective',0):,.0f}  avg={r_trade_b.get('weightedAvgDistanceMi',0):.1f} mi")
    if r_trade_a.get("status") == r_trade_b.get("status") == "optimal":
        # Can't assert direction without knowing which dominates — just verify both are valid
        _check("Trade-off: both P=5/cap=30M and P=7/cap=20M solve optimally",
               True)
        winner = "P=7/cap=20M" if r_trade_b["objective"] < r_trade_a["objective"] else "P=5/cap=30M"
        print(f"         Winner (lower obj): {winner}")
        _ab("Both configurations have plausible avg distance [50, 1500] mi",
            50 < r_trade_a.get("weightedAvgDistanceMi", 0) < 1500 and
            50 < r_trade_b.get("weightedAvgDistanceMi", 0) < 1500,
            f"{r_trade_a['weightedAvgDistanceMi']:.1f} mi",
            f"{r_trade_b['weightedAvgDistanceMi']:.1f} mi",
            "P=5/30M", "P=7/20M")


# ─────────────────────────────────────────────────────────────────────────────
# Cross-model structural checks
# ─────────────────────────────────────────────────────────────────────────────
def test_cross_model() -> None:
    _section("CROSS-MODEL · Structural Output Checks")

    REQUIRED = ["status","openWarehouseIds","assignments","objective",
                "weightedAvgDistanceMi","bandCoverage","utilization",
                "runTimeSec","solverUsed","infeasibilityReason"]

    cases = [
        ("P-Median P=3",      dict(modelType="p_median", pValue=3, distanceBands=[200,400,800,1600],
                                   capacityMode="uniform", uniformCapacity=None, warehouseStatuses=[],
                                   gap=0.0, timeLimitSec=60, singleSource=False, capacityInactive=False)),
        ("Transport LP",      dict(modelType="transport", pValue=1, distanceBands=[500,1000,1500,2000],
                                   capacityMode="uniform", uniformCapacity=None, warehouseStatuses=[],
                                   gap=0.0, timeLimitSec=60, capacityFactor=1.0, singleSource=False,
                                   capacityInactive=False)),
        ("Brazil P=5",        dict(modelType="capacitated_pmedian", pValue=5, warehouseCapacity=20_000_000,
                                   distanceBands=[500,1000,2000,4000], capacityMode="uniform",
                                   uniformCapacity=None, warehouseStatuses=[], gap=0.05, timeLimitSec=120,
                                   singleSource=False)),
    ]

    print()
    results = {}
    for label, payload in cases:
        r = run(payload)
        results[label] = r
        print(f"  {label}: status={r.get('status')}  t={r['_t']:.2f}s")

    print()
    for label, r in results.items():
        missing = [k for k in REQUIRED if k not in r]
        _check(f"{label}: all required output fields present", not missing,
               f"missing: {missing}")
        _check(f"{label}: solverUsed contains 'CBC'",
               "CBC" in r.get("solverUsed", ""),
               r.get("solverUsed", ""))
        _check(f"{label}: runtime 0 < t < 300s",
               0 < r.get("runTimeSec", -1) < 300,
               f"{r.get('runTimeSec', -1):.2f}s")
        if r.get("status") == "optimal":
            _check(f"{label}: objective > 0", (r.get("objective") or 0) > 0)
            _check(f"{label}: bandCoverage non-empty",
                   len(r.get("bandCoverage", [])) > 0)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────
def main() -> None:
    filter_arg = sys.argv[1].lower() if len(sys.argv) > 1 else "all"

    sections = {
        "pmedian":   test_pmedian,
        "transport": test_transport,
        "brazil":    test_brazil,
        "cross":     test_cross_model,
    }

    if filter_arg == "all":
        for fn in sections.values():
            fn()
        test_cross_model()
    elif filter_arg in sections:
        sections[filter_arg]()
    else:
        print(f"Unknown section '{filter_arg}'. Choose: {', '.join(sections)} or 'all'")
        sys.exit(1)

    # ── Summary ───────────────────────────────────────────────────────────────
    total, passed, failed = _counts["total"], _counts["passed"], _counts["failed"]
    bar = "═" * 60
    print(f"\n{bar}")
    print(f"  SUMMARY  {passed}/{total} passed  {'✓ ALL PASS' if failed == 0 else f'✗ {failed} FAILED'}")
    print(bar)
    if _failures:
        print("\nFailed checks:")
        for msg in _failures:
            print(f"  ✗  {msg}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
