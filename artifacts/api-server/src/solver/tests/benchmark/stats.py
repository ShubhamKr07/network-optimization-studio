# stats.py
import random
from dataclasses import dataclass

@dataclass
class CellStats:
    n_cases: int
    n_obs: int
    n_success: int
    usable: bool
    unusable_reason: str | None = None
    # decision metrics -- these carry uncertainty (L-R1)
    mean_cpu_tree_sec: float = 0.0
    mean_cpu_ci: tuple = (0.0, 0.0)
    p95_wall: float = 0.0
    p95_wall_ci: tuple = (0.0, 0.0)
    failure_rate: float = 0.0
    failure_rate_ci: tuple = (0.0, 0.0)
    objective_delta_vs_gap0: float | None = None
    objective_delta_ci: tuple | None = None
    objective_pairs_excluded: int = 0
    # descriptive -- point estimates, backed by raw rows
    p50_wall: float = 0.0
    mean_python_peak_rss: float = 0.0
    mean_cbc_peak_rss: float = 0.0

def mean(xs):
    return sum(xs) / len(xs)

def relative_half_width(ci, point):
    lo, hi = ci
    return abs(hi - lo) / 2 / abs(point) if point else float("inf")

def percentile(xs, q):
    s = sorted(xs)
    if not s:
        return float("nan")
    if len(s) == 1:
        return s[0]
    pos = q * (len(s) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)

def bootstrap_ci(xs, stat, *, reps=2000, alpha=0.05, seed=0):   # keyword-only, as declared
    rng = random.Random(seed)
    draws = [stat([rng.choice(xs) for _ in xs]) for _ in range(reps)]
    return percentile(draws, alpha / 2), percentile(draws, 1 - alpha / 2)

def objective_deltas(observations):
    """Return raw signed objective deltas and excluded-pair counts per
    non-zero-gap cell. case_key is stable across gaps; cell_key is not."""
    campaign = [o for o in observations if o.kind == "campaign"]
    baseline = {o.case_key: o for o in campaign if o.gap == 0.0}
    values, excluded = {}, {}
    for row in campaign:
        if row.gap == 0.0:
            continue
        values.setdefault(row.cell_key, [])
        excluded.setdefault(row.cell_key, 0)
        base = baseline.get(row.case_key)
        if (base is None or not base.ok or not row.ok or
                base.objective is None or row.objective is None):
            excluded[row.cell_key] += 1
            continue
        values[row.cell_key].append(row.objective - base.objective)
    return values, excluded

def corpus_frequency(observations, manifest):
    """Report declared generator weight separately from realised allocation."""
    rows = [o for o in observations if o.kind == "campaign"]
    total = len(rows)
    counts = {}
    for row in rows:
        stratum = row.cell_key.rsplit("|", 1)[0]
        counts[stratum] = counts.get(stratum, 0) + 1
    out = {}
    for s in manifest.strata:
        fam = s["edit_family"] if s["edit_family"] is not None else "-"
        key = f'{s["model_id"]}|{s["regime"]}|{fam}'
        out[key] = {"declared_weight": s["weight"],
                    "observation_share": counts.get(key, 0) / total if total else 0.0}
    return out

def aggregate(observations, *, min_cases):
    by_cell = {}
    for o in observations:
        if o.kind != "campaign":
            continue
        by_cell.setdefault(o.cell_key, []).append(o)
    delta_values, delta_excluded = objective_deltas(observations)
    out = {}
    for key, rows in by_cell.items():
        ok = [r for r in rows if r.ok]
        n_cases = len({r.case_key for r in rows})
        # L-R1: an all-failure or under-sampled cell is reported as UNUSABLE,
        # never crashed on (round 1 indexed walls[0] on an empty list) and
        # never returned as zero demand (which would shrink sizing silently).
        censored = [r for r in rows if not r.resource_complete]
        if not ok or n_cases < min_cases or censored:
            out[key] = CellStats(n_cases=n_cases, n_obs=len(rows), n_success=len(ok),
                                 usable=False,
                                 unusable_reason=("resource demand censored"
                                                  if censored else
                                                  "no successes" if not ok else
                                                  f"only {n_cases} distinct cases"))
            continue
        # Failures consumed slots and CPU too. Successful-only distributions
        # understate demand exactly when failure/timeout rates rise.
        walls = [r.wall_sec for r in rows]
        cpus = [r.cpu_tree_sec for r in rows]
        deltas = delta_values.get(key, [])
        # L-R1: uncertainty ONLY on decision metrics. p50, RSS and corpus
        # frequency are descriptive -- point estimates plus raw rows suffice.
        out[key] = CellStats(
            n_cases=n_cases, n_obs=len(rows), n_success=len(ok), usable=True,
            mean_cpu_tree_sec=mean(cpus),
            mean_cpu_ci=bootstrap_ci(cpus, mean),
            p95_wall=percentile(walls, 0.95),
            p95_wall_ci=bootstrap_ci(walls, lambda s: percentile(s, 0.95)),
            # F-R4: (n - ok)/n is EXACTLY 0.1 for 9/10; 1 - ok/n gives
            # 0.09999999999999998 and fails an equality assertion on first run.
            failure_rate=(len(rows) - len(ok)) / len(rows),
            failure_rate_ci=bootstrap_ci([0.0 if r.ok else 1.0 for r in rows], mean),
            objective_delta_vs_gap0=mean(deltas) if deltas else None,
            objective_delta_ci=(bootstrap_ci(deltas, mean) if deltas else None),
            objective_pairs_excluded=delta_excluded.get(key, 0),
            p50_wall=percentile(walls, 0.5),                       # descriptive
            mean_python_peak_rss=mean([r.python_peak_rss for r in rows]), # descriptive
            mean_cbc_peak_rss=mean([r.cbc_peak_rss for r in rows]),       # descriptive
        )
    return out
