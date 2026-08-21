"""B6.2: golden end-to-end tests proving `addedRefineries`/`addedCustomers`/
`distanceOverrides` (fast-follow of B1.1's schema, resolved via
build_merged_two_echelon_dataset in merge_inputs.py) actually change a real
`solve_two_echelon` solve — not just that the merge helper builds the right
dict in isolation (that's `test_merge_inputs_two_echelon.py`'s job). Mirrors
`test_network_edits_transport.py`'s subprocess convention exactly.

`e2e_accuracy.py` (hard rule #2) is untouched by this file and re-run
directly (not via `pytest tests/ -x`, which does not discover it) after
every solve.py change in this task."""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _envelope_compat import flatten_envelope  # noqa: E402

SOLVER_PY = Path(__file__).parent.parent / "solve.py"

# Real base-dataset customer ids (solvers/two-echelon-gold-au/dataset/
# customers.json) — demand sums to 7,400,000 kg, matching CLAUDE.md's own
# note. Hardcoded here (not read off the dataset file) since these golden
# tests are meant to catch a real regression against the KNOWN real dataset,
# same convention test_two_echelon.py's own ground-truth tests already use.
CUSTOMER_IDS = [
    "sydney", "melbourne", "brisbane", "adelaide", "canberra",
    "newcastle", "sunshine-coast", "townsville", "cairns", "bendigo",
]


def run_solver(payload: dict) -> dict:
    result = subprocess.run(
        [sys.executable, str(SOLVER_PY)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, f"Solver exited {result.returncode}: {result.stderr}"
    return flatten_envelope(json.loads(result.stdout))


TWO_ECHELON_BASE = {
    "modelType": "two_echelon",
    "distanceBands": [500, 1000, 1500, 2000, 2600],
    "gap": 0.0,
    "timeLimitSec": 30,
    "bomRatio": 1.1,  # notebook's scenario 1 -- base case selects cunnamulla
}


def test_base_case_selects_cunnamulla_sanity_check():
    # Re-asserts test_two_echelon.py's own ground truth as this file's own
    # "before" baseline, via the real subprocess/envelope path these golden
    # tests exercise (not a duplicate of that file's coverage — a different
    # invocation path, same real solve.py).
    base = run_solver(TWO_ECHELON_BASE)
    assert base["status"] == "optimal"
    assert base["openWarehouseIds"] == ["cunnamulla"]


def test_distance_override_flips_which_refinery_opens():
    # A single mine->refinery leg override, made catastrophically expensive
    # for the refinery the base case would otherwise pick, flips the "exactly
    # one open" choice to the other candidate — proving a leg-distance
    # override changes the optimal SOLUTION, not just the merged dict (that's
    # test_merge_inputs_two_echelon.py's job).
    overridden = run_solver({
        **TWO_ECHELON_BASE,
        "distanceOverrides": [{"fromId": "kalgoorlie", "toId": "cunnamulla", "distance": 999999}],
    })
    assert overridden["status"] == "optimal"
    assert overridden["openWarehouseIds"] == ["daggar-hills"]


def test_added_refinery_can_win_the_single_open_slot():
    # A brand-new refinery with both legs made deliberately far cheaper than
    # either base candidate wins the "exactly one refinery open" slot over
    # BOTH existing refineries — proving an added refinery is a real,
    # meaningful competitor, not a hollow feature with no way to actually be
    # selected.
    payload = {
        **TWO_ECHELON_BASE,
        "addedRefineries": [
            {"id": "ref-super", "city": "Perfect Town", "state": "WA", "lat": -30.75, "lng": 121.47, "status": "active"},
        ],
        "distanceOverrides": [
            {"fromId": "kalgoorlie", "toId": "ref-super", "distance": 1.0},
            *[{"fromId": "ref-super", "toId": c, "distance": 1.0} for c in CUSTOMER_IDS],
        ],
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"
    assert out["openWarehouseIds"] == ["ref-super"]
    # Every customer served by the newly-added refinery, not either base one.
    assert len(out["assignments"]) == len(CUSTOMER_IDS)
    assert all(a["warehouseId"] == "ref-super" for a in out["assignments"])


def test_added_refinery_forced_open_wins_even_when_more_distant():
    # Own-record status wins for an added refinery (forced_open), same as a
    # base refinery's refineryStatuses override — proves the "own-record
    # wins" precedent (B3.1/B6.1) actually applies to two-echelon's added
    # refineries too, not just p-median/transport's added entities.
    payload = {
        **TWO_ECHELON_BASE,
        "addedRefineries": [
            {"id": "ref-forced", "city": "Middle of Nowhere", "state": "WA", "lat": -30.75, "lng": 121.47, "status": "forced_open"},
        ],
        "distanceOverrides": [
            {"fromId": "kalgoorlie", "toId": "ref-forced", "distance": 500.0},
            *[{"fromId": "ref-forced", "toId": c, "distance": 1000.0} for c in CUSTOMER_IDS],
        ],
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"
    assert out["openWarehouseIds"] == ["ref-forced"]


def test_added_refinery_forced_open_plus_base_forced_open_is_infeasible():
    # Two forced-open refineries (one base, one added) violates "exactly one
    # open" — the SAME infeasibility rule base-only forced-open pairs
    # already trigger (test_two_forced_open_infeasible in
    # test_two_echelon.py), now proven to also cover an added refinery.
    payload = {
        **TWO_ECHELON_BASE,
        "refineryStatuses": [{"refineryId": "cunnamulla", "status": "forced_open"}],
        "addedRefineries": [
            {"id": "ref-forced", "city": "Middle of Nowhere", "state": "WA", "lat": -30.75, "lng": 121.47, "status": "forced_open"},
        ],
        "distanceOverrides": [
            {"fromId": "kalgoorlie", "toId": "ref-forced", "distance": 500.0},
            *[{"fromId": "ref-forced", "toId": c, "distance": 1000.0} for c in CUSTOMER_IDS],
        ],
    }
    out = run_solver(payload)
    assert out["status"] == "infeasible"
    assert "forced" in out["infeasibilityReason"].lower()


def test_added_customer_gets_served_using_its_own_demand_and_only_available_route():
    # An added customer with its own demand and per-refinery distance
    # overrides is served through whichever refinery ends up open, using its
    # OWN demand (not any base-dataset fallback) and the exact overridden
    # distance for that leg.
    payload = {
        **TWO_ECHELON_BASE,
        "addedCustomers": [
            {"id": "perth", "city": "Perth", "state": "WA", "lat": -31.95, "lng": 115.86, "demand": 100000},
        ],
        "distanceOverrides": [
            {"fromId": "cunnamulla", "toId": "perth", "distance": 50.0},
            {"fromId": "daggar-hills", "toId": "perth", "distance": 1.0},
        ],
    }
    out = run_solver(payload)
    assert out["status"] == "optimal"
    # Base case (no perturbation to refinery choice) still selects cunnamulla.
    assert out["openWarehouseIds"] == ["cunnamulla"]
    perth_rows = [a for a in out["assignments"] if a["customerId"] == "perth"]
    assert len(perth_rows) == 1
    assert perth_rows[0]["warehouseId"] == "cunnamulla"
    assert perth_rows[0]["flowKg"] == 100000
    assert perth_rows[0]["distanceMi"] == 50.0
