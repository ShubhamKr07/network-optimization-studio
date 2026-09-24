# runner.py
import random
from benchmark.measure import measure_once

def run_campaign(manifest, *, min_cases=30, max_cases=200, ci_width=0.10,
                 warmup=3, seed=0, measure=measure_once):
    """L-R1: warm-ups run and are DISCARDED BEFORE the measured schedule is
    randomized -- the round-1 code shuffled them together, so a 'warm-up'
    could execute after measured rows. Each observation uses a DISTINCT Case
    (MP-R1). Stopping is sequential: at least `min_cases`, stop when the
    bootstrap CI half-width on mean CPU demand is within `ci_width` relative,
    cap at `max_cases` -- 200 is a ceiling, not a quota."""
    from benchmark.stats import bootstrap_ci, relative_half_width, mean
    rng = random.Random(seed)

    # R3-R3 (a): ONE shared case cohort per stratum, reused across every gap,
    # so paired objective deltas always have full overlap. Shuffling each gap
    # independently would leave gap=0 and the relaxed gaps holding different
    # case subsets, and the pairing would quietly thin out or bias.
    cohort = {}
    for cell in manifest.cells():
        stratum = (cell.model_id, cell.regime, cell.edit_family)
        if stratum not in cohort:
            cases = list(cell.cases)
            rng.shuffle(cases)
            cohort[stratum] = cases[:max_cases]

    for cell in manifest.cells():                       # warm-ups FIRST, discarded
        for case in list(cell.cases)[:warmup]:
            measure(cell, case)

    # Schedule a CASE GROUP, not independent (cell, case) rows. Every selected
    # case is measured at every sibling gap before readiness is evaluated.
    # Independently shuffling rows and merely stopping siblings together still
    # retains different case sets across gaps when the stop boundary is hit.
    cells_by_stratum = {}
    for cell in manifest.cells():
        cells_by_stratum.setdefault(
            (cell.model_id, cell.regime, cell.edit_family), []).append(cell)
    schedule = [(stratum, case) for stratum, cases in cohort.items()
                for case in cases]
    rng.shuffle(schedule)

    # F-R6: stop per STRATUM, not per cell. Round 3's code added only
    # cell.key and checked CI width alone, so gap=0 could stop at 40 retained
    # cases while gap=0.02 ran to 200 -- and the paired objective delta, the
    # gap alternative's ONLY quality evidence, would thin to 40 pairs
    # silently. The shared cohort fixes which cases are SCHEDULED; this fixes
    # which are RETAINED.
    kept, by_cell, stopped_strata = [], {}, set()
    for stratum, case in schedule:
        if stratum in stopped_strata:
            continue

        # Randomise order within the group to avoid a fixed gap-order bias,
        # but complete the whole group atomically for paired retention.
        siblings = list(cells_by_stratum[stratum])
        rng.shuffle(siblings)
        for cell in siblings:
            obs = measure(cell, case)
            obs.kind = "campaign"
            kept.append(obs)
            by_cell.setdefault(cell.key, []).append(obs)

        def ready(key):
            rows = by_cell.get(key, [])
            if len(rows) < min_cases:
                return False
            # Failed attempts with complete telemetry consumed compute and are
            # service demand. Censored rows cannot justify stopping early.
            if any(not o.resource_complete for o in rows):
                return False
            cpus = [o.cpu_tree_sec for o in rows]
            return bool(cpus) and relative_half_width(
                bootstrap_ci(cpus, mean), mean(cpus)) <= ci_width

        if all(ready(c.key) for c in siblings):
            stopped_strata.add(stratum)         # after the complete case group
    return kept

def run_determinism(cell, case, *, reps=30, measure=measure_once):
    """The ONLY place a fixed case_id is executed repeatedly."""
    rows = []
    for _ in range(reps):
        obs = measure(cell, case)
        obs.kind = "determinism"
        rows.append(obs)
    return rows
