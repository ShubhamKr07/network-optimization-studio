"""pytest tests for the Chen's Cosmetics coverage model (Chapter 4) in solve.py.

Subprocess-invoked (`python3 solve.py` via stdin) — validates the RAW envelope
end to end, exactly as the async job runner drives it. Ground-truth goldens
(D3/D22) are the model's own optimal values, reproduced by replicating the
notebook's coverage / min-distance LP locally with PuLP during planning:
coverage `coveredDemand == 131645389`, `coveragePct ≈ 66.0639`; min-distance
`objective ≈ 123834216789.27`, `weightedAvgDistance ≈ 621.44`; both select
`{wh-40, wh-69, wh-102}`. Total effective demand is 199269881.
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
                                         "solvers", "chens-cosmetics-cn", "dataset"))
with open(os.path.join(_DATASET, "customers.json")) as _f:
    ALL_CUSTOMER_IDS = list(json.load(_f).keys())


def run(payload):
    r = subprocess.run(["python3", SOLVE], input=json.dumps(payload),
                       capture_output=True, text=True)
    assert r.stdout, f"solve.py produced no stdout; stderr={r.stderr}"
    return json.loads(r.stdout)


BASE = {"modelType": "chens", "p": 3, "highServiceDistKm": 600, "maxDistKm": 5000,
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
    assert r["details"]["coveredDemand"] == 131645389
    assert r["details"]["coveragePct"] == pytest.approx(66.0639, abs=1e-3)
    assert r["objective"] == pytest.approx(r["details"]["coveragePct"], abs=1e-3)     # coverage objective == coveragePct
    _assert_coverage_fields(r)
    assert set(r["details"]["openWarehouseIds"]) == {"wh-40", "wh-69", "wh-102"}
    assert set(r["metrics"]["openFacilityIds"]) == {"wh-40", "wh-69", "wh-102"}
    assert r["metrics"]["weightedAvgDistance"] <= 1000
    served = [e["toId"] for e in r["edges"]]
    assert len(served) == len(set(served)) == 197                    # exactly-one per active customer
    assert all(e["fromId"] in set(r["details"]["openWarehouseIds"]) for e in r["edges"])  # open linkage
    assert all(e["distance"] <= 5000 for e in r["edges"])            # non-vacuous max-distance feasibility (adjusted)


def test_min_distance_golden():
    r = run({**BASE, "objective": "min_distance", "coverageFloorDemand": 131645389})
    assert r["status"] == "optimal"
    assert r["objective"] == pytest.approx(123834216789.27, abs=0.05)
    assert r["metrics"]["weightedAvgDistance"] == pytest.approx(621.44, abs=0.05)
    _assert_coverage_fields(r)                                        # coverage fields present + 4-dp in min-distance mode too
    assert set(r["details"]["openWarehouseIds"]) == {"wh-40", "wh-69", "wh-102"}


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
             "warehouseOverrides": [{"id": "wh-40", "status": "inactive"}]})
    assert r["status"] == "optimal"
    assert "wh-40" not in r["details"]["openWarehouseIds"]
    assert not any(e["fromId"] == "wh-40" for e in r["edges"])


def test_excluded_customer_absent():
    r = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 1000,
             "customerOverrides": [{"id": "cs-1", "status": "excluded"}]})
    assert r["status"] == "optimal"
    assert not any(e["toId"] == "cs-1" for e in r["edges"])
    assert len(r["edges"]) == 196                                    # one fewer active customer


def test_customer_demand_override_changes_covered():
    # Overriding a covered customer's demand upward increases coveredDemand
    # (integer demand override folded into the merged customers dict).
    forced = [{"id": w, "status": "forced_open"} for w in ("wh-40", "wh-69", "wh-102")]
    base = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 100000,
                "warehouseOverrides": forced})
    covered0 = base["details"]["coveredDemand"]
    served = next(e for e in base["edges"] if e["distance"] <= 600)   # a high-service (covered) customer
    cid = served["toId"]
    orig = next(e["flow"] for e in base["edges"] if e["toId"] == cid)
    r = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 100000,
             "warehouseOverrides": forced,
             "customerOverrides": [{"id": cid, "status": "active", "demand": orig + 1000000}]})
    assert r["status"] == "optimal"
    assert r["details"]["coveredDemand"] == covered0 + 1000000


def test_distance_override_changes_assignment():
    # With the open set pinned via forced-open, making an assigned pair cheaper
    # keeps it assigned but changes the reported (adjusted) edge distance.
    forced = [{"id": w, "status": "forced_open"} for w in ("wh-40", "wh-69", "wh-102")]
    base = run({**BASE, "objective": "min_distance", "coverageFloorDemand": 0,
                "warehouseOverrides": forced})
    e0 = next(e for e in base["edges"] if e["toId"] == "cs-1")
    w0 = e0["fromId"]
    r = run({**BASE, "objective": "min_distance", "coverageFloorDemand": 0,
             "warehouseOverrides": forced,
             "distanceOverrides": [{"fromId": w0, "toId": "cs-1", "distance": 10}]})
    assert r["status"] == "optimal"
    e1 = next(e for e in r["edges"] if e["toId"] == "cs-1")
    assert e1["fromId"] == w0                                         # still cheapest, assignment stable
    assert e1["distance"] == pytest.approx(round(10 * 1.17, 2))       # raw 10 km -> adjusted 11.7 km
    assert e1["distance"] != e0["distance"]


def test_all_excluded_infeasible():
    # Zero effective demand -> infeasible (before any solver run).
    excl = [{"id": cid, "status": "excluded"} for cid in ALL_CUSTOMER_IDS]
    r = run({**BASE, "objective": "coverage", "avgServiceDistCapKm": 1000,
             "customerOverrides": excl})
    assert r["status"] == "infeasible"
    assert "zero" in (r["infeasibilityReason"] or "").lower()


# ---------------------------------------------------------------------------
# Step 7b: dataset load-failure containment. Chen data loads eagerly at
# `import solve`, so post-import monkeypatching the dataset dir CANNOT set
# _LOAD_ERRORS. Instead drive `_safe_load` directly with `_load_json` patched
# to raise (populating _LOAD_ERRORS["chens-cosmetics-cn"]), restore in a
# finally, and assert: (1) solve(chens) returns a schema-valid error envelope
# via _load_error_envelope, and (2) a sibling solve(p_median) still runs in
# the same process (one broken model never takes down the others).
# ---------------------------------------------------------------------------
_ENVELOPE_KEYS = ("status", "objective", "runTimeSec", "quality", "edges",
                  "metrics", "details", "solverUsed", "infeasibilityReason")


def _assert_envelope_shape(env):
    for key in _ENVELOPE_KEYS:
        assert key in env, f"missing envelope key: {key}"
    assert env["status"] in ("optimal", "infeasible", "error")


def test_chens_load_failure_is_contained():
    saved_errors = dict(solve._LOAD_ERRORS)
    original_load_json = solve._load_json
    try:
        def _boom(model_id, filename):
            raise OSError(f"simulated failure loading {model_id}/{filename}")

        solve._load_json = _boom
        # Directly populate _LOAD_ERRORS for the Chen model (the containment
        # path _safe_load feeds), leaving every other model untouched.
        solve._safe_load("chens-cosmetics-cn", "warehouses.json")
        assert "chens-cosmetics-cn" in solve._LOAD_ERRORS

        # (1) Chen returns a schema-valid error envelope, not a crash.
        chen = solve.solve({
            "modelType": "chens", "objective": "coverage", "p": 3,
            "highServiceDistKm": 600, "maxDistKm": 5000, "avgServiceDistCapKm": 1000,
            "gap": 0.0, "timeLimitSec": 60,
        })
        _assert_envelope_shape(chen)
        assert chen["status"] == "error"
        assert chen["infeasibilityReason"]  # carries the real load-failure message

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
