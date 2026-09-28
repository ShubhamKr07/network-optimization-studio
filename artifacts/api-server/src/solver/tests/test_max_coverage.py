"""pytest tests for Al's Athletics — Max Coverage (Chapter 4) in solve.py.

Subprocess-invoked (`python3 solve.py` via stdin) — validates the RAW envelope
end to end, exactly as the async job runner drives it. Ground-truth goldens
were reproduced against the real on-disk dataset on 2026-09-28 (ch4-mig-4
cutover): coverage `coveredDemand == 53385024`, `coveragePct == 68.4192`,
`weightedAvgDistance == 635.13`; both coverage and min-distance modes select
`{DAL, LA, PIT}`. Total effective demand is 78026333.

MIG-6: this dataset's stored distances ARE the effective distances -- the
solver applies no circuity factor, so a distanceOverride's raw value survives
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


BASE = {"modelType": "max_coverage_us", "p": 3, "highServiceDistKm": 700, "maxDistKm": 5500,
        "gap": 0.0, "timeLimitSec": 60, "warehouseOverrides": [], "customerOverrides": [],
        "addedWarehouses": [], "addedCustomers": [], "distanceOverrides": []}


def _assert_coverage_fields(r):                                      # D22 4-dp policy, both modes
    cov = r["details"]["coveragePct"]
    assert r["details"]["uncoveredPct"] == pytest.approx(round(100 - cov, 4), abs=1e-3)
    bands = {b["band"]: b["percent"] for b in r["metrics"]["bandCoverage"]}
    assert bands[r["details"]["highServiceDistKm"]] == pytest.approx(cov, abs=1e-3)   # high-service band == coveragePct
    assert bands[r["details"]["maxDistKm"]] == pytest.approx(100.0, abs=1e-3)         # max-dist band == 100


def test_coverage_golden():
    r = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 1000})
    assert r["status"] == "optimal"
    assert r["details"]["coveredDemand"] == 53385024
    assert r["details"]["coveragePct"] == pytest.approx(68.4192, abs=1e-3)
    assert r["objective"] == pytest.approx(r["details"]["coveragePct"], abs=1e-3)     # coverage objective == coveragePct
    _assert_coverage_fields(r)
    assert set(r["details"]["openWarehouseIds"]) == {"DAL", "LA", "PIT"}
    assert set(r["metrics"]["openFacilityIds"]) == {"DAL", "LA", "PIT"}
    assert r["metrics"]["weightedAvgDistance"] == pytest.approx(635.13, abs=0.05)
    served = [e["toId"] for e in r["edges"]]
    assert len(served) == len(set(served)) == 200                    # exactly-one per active customer
    assert all(e["fromId"] in set(r["details"]["openWarehouseIds"]) for e in r["edges"])  # open linkage
    assert all(e["distance"] <= 5500 for e in r["edges"])            # non-vacuous max-distance feasibility


def test_min_distance_golden():
    r = run({**BASE, "objective": "min_distance", "coverageFloorDemand": 53385024})
    assert r["status"] == "optimal"
    assert r["objective"] == pytest.approx(48714263031.75, abs=0.05)
    assert r["metrics"]["weightedAvgDistance"] == pytest.approx(624.33, abs=0.05)
    _assert_coverage_fields(r)                                        # coverage fields present + 4-dp in min-distance mode too
    assert set(r["details"]["openWarehouseIds"]) == {"DAL", "LA", "PIT"}


def test_floor_infeasible():
    r = run({**BASE, "objective": "min_distance", "coverageFloorDemand": 500100100})
    assert r["status"] == "infeasible"


def test_edge_flow_is_integer_demand():
    # D30: demand is the integer domain -- edge flow is the exact integer
    # customer demand, and coveredDemand is an exact integer sum.
    r = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 1000})
    assert all(isinstance(e["flow"], int) for e in r["edges"])
    assert isinstance(r["details"]["coveredDemand"], int)


def test_forced_open_zero_demand_added_wh():
    # A forced-open ADDED warehouse with no distances (unreachable) still opens
    # and appears in both openWarehouseIds and openFacilityIds with zero flow
    # -- proves forced-open resolution AND that an added warehouse is openable.
    added = {"id": "wh-999", "displayCode": "NEW", "city": "Nowhere", "state": "",
             "lat": 35.0, "lng": 100.0, "status": "forced_open"}
    r = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 1000, "p": 4,
             "addedWarehouses": [added]})
    assert r["status"] == "optimal"
    assert "wh-999" in r["details"]["openWarehouseIds"]
    assert "wh-999" in r["metrics"]["openFacilityIds"]
    assert not any(e["fromId"] == "wh-999" for e in r["edges"])      # zero flow (unreachable)


def test_inactive_wh_absent():
    # A normally-open warehouse marked inactive is never opened.
    r = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 1000,
             "warehouseOverrides": [{"id": "DAL", "status": "inactive"}]})
    assert r["status"] == "optimal"
    assert "DAL" not in r["details"]["openWarehouseIds"]
    assert not any(e["fromId"] == "DAL" for e in r["edges"])


def test_excluded_customer_absent():
    r = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 1000,
             "customerOverrides": [{"id": "C1", "status": "excluded"}]})
    assert r["status"] == "optimal"
    assert not any(e["toId"] == "C1" for e in r["edges"])
    assert len(r["edges"]) == 199                                    # one fewer active customer


def test_customer_demand_override_changes_covered():
    # Overriding a covered customer's demand upward increases coveredDemand
    # (integer demand override folded into the merged customers dict).
    forced = [{"id": w, "status": "forced_open"} for w in ("DAL", "LA", "PIT")]
    base = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 100000,
                "warehouseOverrides": forced})
    covered0 = base["details"]["coveredDemand"]
    served = next(e for e in base["edges"] if e["distance"] <= 700)   # a high-service (covered) customer
    cid = served["toId"]
    orig = next(e["flow"] for e in base["edges"] if e["toId"] == cid)
    r = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 100000,
             "warehouseOverrides": forced,
             "customerOverrides": [{"id": cid, "status": "active", "demand": orig + 1000000}]})
    assert r["status"] == "optimal"
    assert r["details"]["coveredDemand"] == covered0 + 1000000


def test_distance_override_changes_assignment():
    # With the open set pinned via forced-open, making an assigned pair cheaper
    # keeps it assigned but changes the reported edge distance. MIG-6: the
    # override's raw value survives UNMODIFIED (no circuity factor).
    forced = [{"id": w, "status": "forced_open"} for w in ("DAL", "LA", "PIT")]
    base = run({**BASE, "objective": "min_distance", "coverageFloorDemand": 0,
                "warehouseOverrides": forced})
    e0 = next(e for e in base["edges"] if e["toId"] == "C1")
    w0 = e0["fromId"]
    r = run({**BASE, "objective": "min_distance", "coverageFloorDemand": 0,
             "warehouseOverrides": forced,
             "distanceOverrides": [{"fromId": w0, "toId": "C1", "distance": 10}]})
    assert r["status"] == "optimal"
    e1 = next(e for e in r["edges"] if e["toId"] == "C1")
    assert e1["fromId"] == w0                                         # still cheapest, assignment stable
    assert e1["distance"] == 10                                       # MIG-6: raw == effective, no adjustment
    assert e1["distance"] != e0["distance"]


def test_all_excluded_infeasible():
    # Zero effective demand -> infeasible (before any solver run).
    excl = [{"id": cid, "status": "excluded"} for cid in ALL_CUSTOMER_IDS]
    r = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 1000,
             "customerOverrides": excl})
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
            "modelType": "max_coverage_us", "objective": "coverage", "p": 3,
            "highServiceDistKm": 700, "maxDistKm": 5500, "avgServiceDistCapKm": 1000,
            "gap": 0.0, "timeLimitSec": 60,
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
MI2KM = 1.609344


def test_floor_zero_equals_pmedian():
    """MIG-11 -- min-distance with coverageFloorDemand=0 IS the p-median
    problem: same objective, same p, coverage constraint slack. The two
    reach it through different code and different dataset handling, so a
    mangled distance conversion breaks the equality.

    The assertion is unit-aware: Chapter 4 is km-canonical and Chapter 3 is
    mile-canonical, so the objectives differ by exactly 1.609344. Measured
    2026-09-27: relative difference 9.8e-15, so 1e-9 is ample.
    """
    mc = run({**BASE, "objective": "min_distance", "coverageFloorDemand": 0})
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
    assert mc["objective"] / MI2KM == pytest.approx(pm["objective"], rel=1e-9)


def test_step2_is_always_feasible():
    """Step 1's own solution satisfies Step 2's constraints by construction:
    same p, same maxDistKm, no average-distance cap, and a floor equal to the
    coverage Step 1 actually achieved. An infeasible Step 2 is a defect.

    Deviation from the task brief (hard rule #8): the brief's snippet reads
    `step1 = run(BASE)`, but this file's `BASE` dict (unlike the brief's
    apparent assumption) carries no default `objective` key -- every other
    test in this file always spreads one in explicitly, and calling
    solve.py with no `objective` at all raises an uncaught KeyError inside
    solve_max_coverage (`mode = inp["objective"]`), which the process
    boundary degrades to a bare `{failureReason, failureStage}` message with
    no `details` key. That is a real "run(BASE) alone is underspecified"
    gap in the brief, not a solver defect, so the smallest correct fix is to
    spell out Step 1 as the "coverage" objective explicitly -- identical to
    `test_coverage_golden`'s payload -- which is also the only reading that
    reproduces the brief's own expected numbers (635.13 -> 624.33 km).
    """
    step1 = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 1000})
    floor = step1["details"]["coveredDemand"]
    step2 = run({**BASE, "objective": "min_distance", "coverageFloorDemand": floor})
    assert step2["status"] == "optimal"
    assert step2["details"]["coveredDemand"] >= floor
    assert step2["metrics"]["weightedAvgDistance"] <= step1["metrics"]["weightedAvgDistance"]
