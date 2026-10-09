"""pytest tests for Al's Athletics — Max Coverage (Chapter 4) in solve.py.

Subprocess-invoked (`python3 solve.py` via stdin) — validates the RAW envelope
end to end, exactly as the async job runner drives it.

CH4O-8 (§2.1): this model is MILES-canonical. The dataset is Chapter 3's
integer-mile matrix re-keyed, and the defaults are round teaching numbers
(p 3, highServiceDistMi 450, maxDistMi 3400, avgServiceDistCapMi 650), NOT
conversions of the old km seeds. Every golden below was therefore RE-READ off a
real `solve.py` invocation, never divided out of its km predecessor -- the
round defaults flip the high-service/max-distance predicates for some pairs, so
the covered demand and the open set can legitimately differ, and a hand-divided
number would assert something no solve ever produced. Each golden carries the
command that produced it. Measured 2026-10-09; total effective demand is
78026333 (unchanged -- demands were never converted).

§2.1: this dataset's stored distances ARE the effective distances -- no unit
conversion and no circuity factor -- so a distanceOverride's raw value survives
unmodified into the reported edge distance.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
import solve  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SOLVE = os.path.join(HERE, "..", "solve.py")
# tests -> solver -> src -> api-server -> artifacts -> repo root
_DATASET = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "..",
                                         "solvers", "max-coverage-us", "dataset"))
with open(os.path.join(_DATASET, "customers.json")) as _f:
    ALL_CUSTOMER_IDS = list(json.load(_f).keys())


def run(payload):
    r = subprocess.run(["python3", SOLVE], input=json.dumps(payload),
                       capture_output=True, text=True)
    assert r.stdout, f"solve.py produced no stdout; stderr={r.stderr}"
    return json.loads(r.stdout)


# CH4O-5 -- `avgServiceDistCapMi` and `coverageFloorDemand` are BOTH
# unconditionally required (the cap binds in both objectives; the floor IS the
# mode discriminator), and `objective` is never an input: solve_max_coverage
# derives the mode locally from the floor. BASE is therefore the coverage case
# (floor 0); the only tests that spread an `objective` in are
# TestModeDerivedFromFloor's, which send a DELIBERATELY WRONG one to prove it
# is ignored.
BASE = {"modelType": "max_coverage_us", "p": 3, "highServiceDistMi": 450, "maxDistMi": 3400,
        "avgServiceDistCapMi": 650, "coverageFloorDemand": 0,
        "gap": 0.0, "timeLimitSec": 60, "warehouseOverrides": [], "customerOverrides": [],
        "addedWarehouses": [], "addedCustomers": [], "distanceOverrides": []}


def _assert_coverage_fields(r):                                      # D22 4-dp policy, both modes
    cov = r["details"]["coveragePct"]
    assert r["details"]["uncoveredPct"] == pytest.approx(round(100 - cov, 4), abs=1e-3)
    bands = {b["band"]: b["percent"] for b in r["metrics"]["bandCoverage"]}
    assert bands[r["details"]["highServiceDistMi"]] == pytest.approx(cov, abs=1e-3)   # high-service band == coveragePct
    assert bands[r["details"]["maxDistMi"]] == pytest.approx(100.0, abs=1e-3)         # max-dist band == 100


def test_coverage_golden():
    # CH4O-8 goldens, read off a real solve (NOT converted from the km values):
    #   cd artifacts/api-server/src/solver && echo '{"modelType":"max_coverage_us",
    #   "p":3,"highServiceDistMi":450,"maxDistMi":3400,"avgServiceDistCapMi":650,
    #   "coverageFloorDemand":0,"gap":0.0,"timeLimitSec":60,"warehouseOverrides":[],
    #   "customerOverrides":[],"addedWarehouses":[],"addedCustomers":[],
    #   "distanceOverrides":[]}' | python3 solve.py | python3 -m json.tool
    # -> coveredDemand 54946145, coveragePct 70.42, openWarehouseIds
    #    {DAL, LA, PIT}, weightedAvgDistance 394.65.
    r = run(BASE)
    assert r["status"] == "optimal"
    assert r["details"]["coveredDemand"] == 54946145
    assert r["details"]["coveragePct"] == pytest.approx(70.42, abs=1e-3)
    assert r["objective"] == pytest.approx(r["details"]["coveragePct"], abs=1e-3)     # coverage objective == coveragePct
    _assert_coverage_fields(r)
    assert set(r["details"]["openWarehouseIds"]) == {"DAL", "LA", "PIT"}
    assert set(r["metrics"]["openFacilityIds"]) == {"DAL", "LA", "PIT"}
    assert r["metrics"]["weightedAvgDistance"] == pytest.approx(394.65, abs=0.05)
    served = [e["toId"] for e in r["edges"]]
    assert len(served) == len(set(served)) == 200                    # exactly-one per active customer
    assert all(e["fromId"] in set(r["details"]["openWarehouseIds"]) for e in r["edges"])  # open linkage
    assert all(e["distance"] <= 3400 for e in r["edges"])            # max-distance feasibility (longest served edge: 1197 mi)


def test_min_distance_golden():
    # Same command as test_coverage_golden with "coverageFloorDemand":54946145
    # (the coverage run's own achieved coveredDemand, per the brief's rule):
    # -> objective 30269639699.0, weightedAvgDistance 387.94, open {DAL,LA,PIT}.
    # Sanity (not a golden): 387.94 <= the coverage run's 394.65, and <= the 650
    # cap -- so the cap does NOT bind here, which is what makes
    # TestCapBindsInBothModes' loose case a real no-op check.
    r = run({**BASE, "coverageFloorDemand": 54946145})
    assert r["status"] == "optimal"
    assert r["objective"] == pytest.approx(30269639699.0, abs=0.05)
    assert r["metrics"]["weightedAvgDistance"] == pytest.approx(387.94, abs=0.05)
    _assert_coverage_fields(r)                                        # coverage fields present + 4-dp in min-distance mode too
    assert set(r["details"]["openWarehouseIds"]) == {"DAL", "LA", "PIT"}


def test_floor_infeasible():
    r = run({**BASE, "coverageFloorDemand": 500100100})
    assert r["status"] == "infeasible"


def test_edge_flow_is_integer_demand():
    # D30: demand is the integer domain -- edge flow is the exact integer
    # customer demand, and coveredDemand is an exact integer sum.
    r = run(BASE)
    assert all(isinstance(e["flow"], int) for e in r["edges"])
    assert isinstance(r["details"]["coveredDemand"], int)


def test_forced_open_zero_demand_added_wh():
    # A forced-open ADDED warehouse with no distances (unreachable) still opens
    # and appears in both openWarehouseIds and openFacilityIds with zero flow
    # -- proves forced-open resolution AND that an added warehouse is openable.
    added = {"id": "wh-999", "displayCode": "NEW", "city": "Nowhere", "state": "",
             "lat": 35.0, "lng": 100.0, "status": "forced_open"}
    r = run({**BASE, "p": 4, "addedWarehouses": [added]})
    assert r["status"] == "optimal"
    assert "wh-999" in r["details"]["openWarehouseIds"]
    assert "wh-999" in r["metrics"]["openFacilityIds"]
    assert not any(e["fromId"] == "wh-999" for e in r["edges"])      # zero flow (unreachable)


def test_inactive_wh_absent():
    # A normally-open warehouse marked inactive is never opened.
    r = run({**BASE, "warehouseOverrides": [{"id": "DAL", "status": "inactive"}]})
    assert r["status"] == "optimal"
    assert "DAL" not in r["details"]["openWarehouseIds"]
    assert not any(e["fromId"] == "DAL" for e in r["edges"])


def test_excluded_customer_absent():
    r = run({**BASE, "customerOverrides": [{"id": "C1", "status": "excluded"}]})
    assert r["status"] == "optimal"
    assert not any(e["toId"] == "C1" for e in r["edges"])
    assert len(r["edges"]) == 199                                    # one fewer active customer


def test_customer_demand_override_changes_covered():
    # Overriding a covered customer's demand upward increases coveredDemand
    # (integer demand override folded into the merged customers dict).
    forced = [{"id": w, "status": "forced_open"} for w in ("DAL", "LA", "PIT")]
    base = run({**BASE, "avgServiceDistCapMi": 100000,
                "warehouseOverrides": forced})
    covered0 = base["details"]["coveredDemand"]
    served = next(e for e in base["edges"] if e["distance"] <= 450)   # a high-service (covered) customer
    cid = served["toId"]
    orig = next(e["flow"] for e in base["edges"] if e["toId"] == cid)
    r = run({**BASE, "avgServiceDistCapMi": 100000,
             "warehouseOverrides": forced,
             "customerOverrides": [{"id": cid, "status": "active", "demand": orig + 1000000}]})
    assert r["status"] == "optimal"
    assert r["details"]["coveredDemand"] == covered0 + 1000000


def test_distance_override_changes_assignment():
    # With the open set pinned via forced-open, making an assigned pair cheaper
    # keeps it assigned but changes the reported edge distance. §2.1: the
    # override's raw value survives UNMODIFIED (no unit conversion, no circuity
    # factor).
    # CH4O-5 -- floor 1, not 0: a ZERO floor now derives COVERAGE mode, whose
    # objective does not minimise distance, so the "cheapest stays assigned"
    # assertion below would no longer be testing anything. 1 is slack against
    # the ~53M demand any feasible assignment covers, so the problem solved is
    # the same unconstrained min-distance one this test has always used.
    forced = [{"id": w, "status": "forced_open"} for w in ("DAL", "LA", "PIT")]
    base = run({**BASE, "coverageFloorDemand": 1,
                "warehouseOverrides": forced})
    e0 = next(e for e in base["edges"] if e["toId"] == "C1")
    w0 = e0["fromId"]
    r = run({**BASE, "coverageFloorDemand": 1,
             "warehouseOverrides": forced,
             "distanceOverrides": [{"fromId": w0, "toId": "C1", "distance": 10}]})
    assert r["status"] == "optimal"
    e1 = next(e for e in r["edges"] if e["toId"] == "C1")
    assert e1["fromId"] == w0                                         # still cheapest, assignment stable
    assert e1["distance"] == 10                                       # §2.1: raw == effective, no adjustment
    assert e1["distance"] != e0["distance"]


def test_all_excluded_infeasible():
    # Zero effective demand -> infeasible (before any solver run).
    excl = [{"id": cid, "status": "excluded"} for cid in ALL_CUSTOMER_IDS]
    r = run({**BASE, "customerOverrides": excl})
    assert r["status"] == "infeasible"
    assert "zero" in (r["infeasibilityReason"] or "").lower()


# ---------------------------------------------------------------------------
# Step 7b: dataset load-failure containment. This model's data loads eagerly
# at `import solve`, so post-import monkeypatching the dataset dir CANNOT set
# _LOAD_ERRORS. Instead drive `_safe_load` directly with `_load_json` patched
# to raise (populating _LOAD_ERRORS["max-coverage-us"]), restore in a
# finally, and assert: (1) solve(max_coverage_us) returns a schema-valid error
# envelope via _load_error_envelope, and (2) a sibling solve(p_median) still
# runs in the same process (one broken model never takes down the others).
# ---------------------------------------------------------------------------
_ENVELOPE_KEYS = ("status", "objective", "runTimeSec", "quality", "edges",
                  "metrics", "details", "solverUsed", "infeasibilityReason")


def _assert_envelope_shape(env):
    for key in _ENVELOPE_KEYS:
        assert key in env, f"missing envelope key: {key}"
    assert env["status"] in ("optimal", "infeasible", "error")


def test_max_coverage_load_failure_is_contained():
    saved_errors = dict(solve._LOAD_ERRORS)
    original_load_json = solve._load_json
    try:
        def _boom(model_id, filename):
            raise OSError(f"simulated failure loading {model_id}/{filename}")

        solve._load_json = _boom
        # Directly populate _LOAD_ERRORS for this model (the containment
        # path _safe_load feeds), leaving every other model untouched.
        solve._safe_load("max-coverage-us", "warehouses.json")
        assert "max-coverage-us" in solve._LOAD_ERRORS

        # (1) max-coverage-us returns a schema-valid error envelope, not a crash.
        mc = solve.solve({
            "modelType": "max_coverage_us", "p": 3,
            "highServiceDistMi": 450, "maxDistMi": 3400, "avgServiceDistCapMi": 650,
            "coverageFloorDemand": 0, "gap": 0.0, "timeLimitSec": 60,
        })
        _assert_envelope_shape(mc)
        assert mc["status"] == "error"
        assert mc["infeasibilityReason"]  # carries the real load-failure message

        # (2) A sibling model still runs in the same process.
        pm = solve.solve({
            "modelType": "p_median", "pValue": 3,
            "distanceBands": [200, 400, 800, 1600], "gap": 0.0, "timeLimitSec": 30,
        })
        _assert_envelope_shape(pm)
        assert pm["status"] == "optimal"
    finally:
        solve._load_json = original_load_json
        solve._LOAD_ERRORS.clear()
        solve._LOAD_ERRORS.update(saved_errors)


# ---------------------------------------------------------------------------
# MIG-11: the floor-zero equivalence check -- the one assertion in this
# migration that is not our own solver marking its own homework.
# ---------------------------------------------------------------------------
def test_slack_floor_equals_pmedian():
    """MIG-11 -- min-distance with a SLACK coverage floor IS the p-median
    problem: same objective, same p, coverage constraint slack. The two
    reach it through different code and different dataset handling, so a
    mangled distance conversion breaks the equality.

    CH4O-5 -- the floor is 1, not 0: a zero floor now derives COVERAGE mode,
    so the p-median equivalence is only reachable at the smallest positive
    floor. 1 is slack against the tens of millions of demand any feasible
    assignment covers, and the loose 100000 mi cap cannot bind either, so the
    problem solved here is identical to the old floor-0 min-distance one.

    CH4O-8 -- the assertion is now EXACT, not ratio-scaled. Both chapters are
    miles-canonical over the same integer-mile matrix, so the two objectives are
    the same integer rather than differing by 1.609344. Measured 2026-10-09 via
    the two solve.py commands this test issues: both 29873735731, difference 0.
    An exact equality is the strongest form of this check and the one a mangled
    re-keying would break.
    """
    mc = run({**BASE, "coverageFloorDemand": 1, "avgServiceDistCapMi": 100000})
    pm = run({"modelType": "p_median", "pValue": 3, "distanceBands": [200, 400, 800, 1600],
              "capacityMode": "none", "uniformCapacity": None, "warehouseStatuses": [],
              "gap": 0.0, "timeLimitSec": 120, "singleSource": False,
              "capacityInactive": False, "capacityFactor": 1.0})

    assert mc["status"] == "optimal"
    assert pm["status"] == "optimal"
    # Verified 2026-09-27: solve_pmedian puts openWarehouseIds under
    # ["details"], NOT at the top level -- an earlier draft of this plan read
    # it top-level and would have raised KeyError before asserting anything.
    assert set(mc["details"]["openWarehouseIds"]) == {"BAL", "DAL", "LA"}
    assert set(mc["details"]["openWarehouseIds"]) == set(pm["details"]["openWarehouseIds"])
    assert mc["objective"] == pm["objective"] == 29873735731


def test_min_distance_at_achieved_coverage_is_always_feasible():
    """The coverage solution satisfies the min-distance model's constraints by
    construction: same p, same maxDistMi, the SAME average-distance cap (CH4O-5
    -- it now binds in both modes), and a floor equal to the coverage the
    maximisation actually achieved. An infeasible result here is a defect.

    CH4O-5 -- both runs are plain `BASE` spreads now: the mode is derived from
    the floor, so the only difference between them IS the floor.
    """
    step1 = run(BASE)
    floor = step1["details"]["coveredDemand"]
    step2 = run({**BASE, "coverageFloorDemand": floor})
    assert step2["status"] == "optimal"
    assert step2["details"]["coveredDemand"] >= floor
    assert step2["metrics"]["weightedAvgDistance"] <= step1["metrics"]["weightedAvgDistance"]


class TestCapBindsInBothModes:
    """The average-distance cap is a constraint in min_distance mode too.

    A loose cap must leave the known min-distance optimum untouched -- its own
    weighted average is 387.94 mi, so the 650 mi default cap cannot bind. That
    is the sanity check distinguishing a real modelling error from an expected
    change. CH4O-8: the default cap is ALREADY loose enough here (387.94 << 650),
    so the loose case keeps BASE's own 650 rather than needing a special wider
    value -- verified by solving at cap 650 and getting the identical
    weighted average and open set as test_min_distance_golden.
    """

    def test_loose_cap_leaves_min_distance_optimum_unchanged(self):
        r = run({**BASE, "coverageFloorDemand": 54946145, "avgServiceDistCapMi": 650})
        assert r["status"] == "optimal"
        assert r["metrics"]["weightedAvgDistance"] == pytest.approx(387.94, abs=0.05)
        assert set(r["details"]["openWarehouseIds"]) == {"DAL", "LA", "PIT"}

    def test_cap_below_the_true_minimum_is_infeasible_not_reshaped(self):
        # CH4O-5 review finding (Minor) -- in min_distance mode the cap
        # constrains the SAME expression the objective minimises
        # (`sum(adj*dem*a) <= cap*total` vs `minimize sum(adj*dem*a)`), so a
        # cap set below the true achievable minimum can only ever make the
        # problem infeasible -- it can never reshape the optimum to a
        # different, cap-satisfying solution the way a cap in coverage mode
        # can. (In coverage mode the cap constrains distance while the
        # objective maximises covered demand -- two different expressions --
        # so there a tight cap genuinely CAN force a different open set.)
        # The previous version of this test had an `if optimal / else
        # infeasible` branch for exactly this case; the `optimal` branch was
        # unreachable by construction and the test was a duplicate of
        # `test_cap_below_any_feasible_average_is_infeasible` with a
        # different number. This version asserts the real, single-branch
        # property directly.
        loose = run({**BASE, "coverageFloorDemand": 54946145, "avgServiceDistCapMi": 650})
        tight_cap = loose["metrics"]["weightedAvgDistance"] - 20
        r = run({**BASE, "coverageFloorDemand": 54946145, "avgServiceDistCapMi": tight_cap})
        assert r["status"] == "infeasible"

    def test_cap_below_any_feasible_average_is_infeasible(self):
        r = run({**BASE, "coverageFloorDemand": 54946145, "avgServiceDistCapMi": 1.0})
        assert r["status"] == "infeasible"


class TestModeDerivedFromFloor:
    """`details.objective` reports what RAN, derived from the floor locally --
    never forwarded from inp["objective"]. If the echo forwarded the input while
    the math branched on the floor, a mismatch would label the envelope one model
    and compute the other, invisibly."""

    def test_zero_floor_runs_coverage(self):
        r = run({**BASE, "coverageFloorDemand": 0, "objective": "min_distance"})
        assert r["details"]["objective"] == "coverage"

    def test_positive_floor_runs_min_distance(self):
        r = run({**BASE, "coverageFloorDemand": 54946145, "objective": "coverage"})
        assert r["details"]["objective"] == "min_distance"
