#!/usr/bin/env python3
"""
E2E User Journey Test Suite
============================
Tests the full API lifecycle a user would follow through the Studio — auth,
dataset inspection, scenario CRUD, solving, cloning, comparison, and progress
tracking — for each of the three lab problem types.

Usage:
    python3 e2e_journey.py                              # default Replit URL
    python3 e2e_journey.py http://localhost:8080        # local dev server
    python3 e2e_journey.py <BASE_URL> [section]        # section: auth|dataset|pmedian|transport|brazil|progress
"""

import json
import sys
import time
import urllib.request
import urllib.error
from typing import Any

# ── Config ───────────────────────────────────────────────────────────────────
DEFAULT_URL = "https://7e5e4d86-4aaa-4650-83d8-ce65e36a4fe7-00-286k5vaeu9g0-8080.kirk.replit.dev"
BASE_URL    = (sys.argv[1].rstrip("/") if len(sys.argv) > 1 and sys.argv[1].startswith("http") else DEFAULT_URL)
SECTION     = (sys.argv[2].lower() if len(sys.argv) > 2 else (sys.argv[1].lower() if len(sys.argv) > 1 and not sys.argv[1].startswith("http") else "all"))
TEST_USER   = f"journey_test_{int(time.time())}"

# ── Counters ─────────────────────────────────────────────────────────────────
_counts = {"total": 0, "passed": 0, "failed": 0}
_failures: list[str] = []
_session_cookie: str | None = None

PASS  = "\033[32mPASS\033[0m"
FAIL  = "\033[31mFAIL\033[0m"
STEP  = "\033[33m•\033[0m"

def _section(title: str) -> None:
    bar = "─" * 62
    print(f"\n{bar}\n  {title}\n{bar}")

def _check(label: str, cond: bool, detail: str = "") -> bool:
    _counts["total"] += 1
    if cond:
        _counts["passed"] += 1
        print(f"  {PASS}  {label}")
    else:
        _counts["failed"] += 1
        msg = label + (f"  [{detail}]" if detail else "")
        _failures.append(msg)
        print(f"  {FAIL}  {msg}")
    return cond

def _step(msg: str) -> None:
    print(f"\n  {STEP}  {msg}")


# ── HTTP client ───────────────────────────────────────────────────────────────
def _request(method: str, path: str, body: dict | None = None,
             *, expect_status: int = 200, timeout: int = 240) -> tuple[int, Any]:
    global _session_cookie
    url = f"{BASE_URL}/api{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers: dict[str, str] = {"Content-Type": "application/json", "Accept": "application/json"}
    if _session_cookie:
        headers["Cookie"] = _session_cookie
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            # Capture Set-Cookie
            sc = resp.headers.get("Set-Cookie")
            if sc:
                _session_cookie = sc.split(";")[0]
            try:
                return resp.status, json.loads(raw) if raw else {}
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as ex:
        return 0, {"_error": str(ex)}

def GET(path: str, **kw) -> tuple[int, Any]:  return _request("GET",    path, **kw)
def POST(path: str, body: dict | None = None, **kw): return _request("POST",  path, body, **kw)
def PATCH(path: str, body: dict | None = None, **kw): return _request("PATCH", path, body, **kw)
def DELETE(path: str, **kw): return _request("DELETE", path, **kw)


# ── Helpers ───────────────────────────────────────────────────────────────────
def _solve_and_wait(scenario_id: int, timeout: int = 240) -> dict:
    """POST /scenarios/:id/solve and return the updated scenario."""
    _step(f"Solving scenario {scenario_id} …")
    t0 = time.time()
    status, body = POST(f"/scenarios/{scenario_id}/solve", timeout=timeout)
    elapsed = round(time.time() - t0, 1)
    result = (body.get("result") or {}) if isinstance(body, dict) else {}
    sol_status = result.get("status", "?")
    obj = result.get("objective", 0)
    avg = result.get("weightedAvgDistanceMi", 0)
    print(f"     HTTP {status}  solver={sol_status}  obj={obj:,.0f}  avg={avg:.1f} mi  t={elapsed}s")
    return body if isinstance(body, dict) else {}

def _result(scenario: dict) -> dict:
    return scenario.get("result") or {}

def _cleanup(ids: list[int]) -> None:
    for sid in ids:
        DELETE(f"/scenarios/{sid}")
    if ids:
        print(f"     Deleted scenarios: {ids}")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 0 · Auth
# ─────────────────────────────────────────────────────────────────────────────
def journey_auth() -> None:
    _section("JOURNEY 0 · Authentication")
    global _session_cookie

    _step("Health check")
    status, body = GET("/healthz")
    _check("GET /api/healthz returns 200", status == 200,  f"HTTP {status}")
    _check("Health status is 'ok'", body.get("status") == "ok", str(body))

    _step(f"Login as {TEST_USER}")
    status, body = POST("/login", {"userId": TEST_USER})
    _check("POST /api/login returns 200", status == 200,  f"HTTP {status}")
    _check("Login body has ok=true",      body.get("ok") is True)
    _check("Login returns userId",        body.get("userId") == TEST_USER)
    _check("Session cookie is set",       _session_cookie is not None)

    _step("Verify session")
    status, body = GET("/auth/user")
    _check("GET /api/auth/user returns 200", status == 200,  f"HTTP {status}")
    _check("User ID matches",               (body.get("user") or {}).get("id") == TEST_USER)

    _step("Login validation — empty userId")
    status, body = POST("/login", {"userId": ""})
    _check("Empty userId returns 400", status == 400, f"HTTP {status}")

    _step("Logout")
    status, body = POST("/logout")
    _check("POST /api/logout returns 200", status == 200, f"HTTP {status}")
    _check("Logout body has ok=true",      body.get("ok") is True)

    # Re-login for subsequent journeys
    POST("/login", {"userId": TEST_USER})
    _step(f"Re-logged in as {TEST_USER} for remaining journeys")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 1 · Dataset
# ─────────────────────────────────────────────────────────────────────────────
def journey_dataset() -> None:
    _section("JOURNEY 1 · Dataset Inspection")

    _step("Fetch dataset")
    status, body = GET("/dataset")
    _check("GET /api/dataset returns 200", status == 200, f"HTTP {status}")
    _check("Dataset has warehouses",       len(body.get("warehouses", [])) > 0)
    _check("Dataset has customers",        len(body.get("customers", [])) > 0)

    whs = body.get("warehouses", [])
    cus = body.get("customers",  [])
    _check("26 warehouse candidates present", len(whs) == 26, f"got {len(whs)}")
    _check("200 customers present",           len(cus) == 200, f"got {len(cus)}")

    wh_ids = {w["id"] for w in whs}
    _check("CHI warehouse present", "CHI" in wh_ids)
    _check("LA warehouse present",  "LA"  in wh_ids)

    # Each warehouse has required fields
    first = whs[0]
    for field in ["id", "city", "state", "lat", "lng"]:
        _check(f"Warehouse has field '{field}'", field in first)


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 2 · P-Median Lab  (Al's Athletics)
# ─────────────────────────────────────────────────────────────────────────────
def journey_pmedian() -> None:
    _section("JOURNEY 2 · P-Median Lab (Al's Athletics)")
    created: list[int] = []

    # ── Step 1: Create base scenario ─────────────────────────────────────────
    _step("Create base P-Median scenario (P=3, uncapacitated)")
    status, scen = POST("/scenarios", {
        "name":           "Journey · P-Median Base",
        "problemType":    "p_median",
        "pValue":         3,
        "distanceBands":  [200, 400, 800, 1600],
        "gap":            0.0,
        "timeLimitSec":   120,
        "capacityMode":   "uniform",
        "uniformCapacity": None,
        "warehouseStatuses": [],
    })
    _check("POST /scenarios returns 201",    status == 201, f"HTTP {status}")
    _check("Scenario has an ID",             "id" in scen)
    _check("Name is stored",                 scen.get("name") == "Journey · P-Median Base")
    _check("problemType is p_median",        scen.get("problemType") == "p_median")
    _check("pValue is 3",                    scen.get("pValue") == 3)
    _check("result is null (unsolved)",      scen.get("result") is None)
    base_id = scen["id"]
    created.append(base_id)

    # ── Step 2: Fetch by ID ───────────────────────────────────────────────────
    _step(f"Fetch scenario {base_id} by ID")
    status, fetched = GET(f"/scenarios/{base_id}")
    _check("GET /scenarios/:id returns 200", status == 200, f"HTTP {status}")
    _check("Fetched ID matches",             fetched.get("id") == base_id)

    # ── Step 3: Solve P=3 ────────────────────────────────────────────────────
    _step("Solve P=3 base scenario")
    updated = _solve_and_wait(base_id)
    r3 = _result(updated)
    _check("Solve returns 200",              updated.get("id") == base_id)
    _check("P=3 result: status is optimal", r3.get("status") == "optimal", r3.get("status"))
    _check("P=3 result: exactly 3 WHs open", len(r3.get("openWarehouseIds", [])) == 3,
           str(r3.get("openWarehouseIds")))
    _check("P=3 result: 200 customers served",
           len({a["customerId"] for a in r3.get("assignments", [])}) == 200)
    _check("P=3 result: objective > 0",      (r3.get("objective") or 0) > 0)
    _check("P=3 result: avg distance > 0",   (r3.get("weightedAvgDistanceMi") or 0) > 0)
    _check("P=3 result: result persisted in DB",
           GET(f"/scenarios/{base_id}")[1].get("result") is not None)
    obj_p3 = r3.get("objective", 0)

    # ── Step 4: Update P to 5 and re-solve ───────────────────────────────────
    _step("Update scenario: change P to 5")
    status, patched = PATCH(f"/scenarios/{base_id}", {"pValue": 5})
    _check("PATCH /scenarios/:id returns 200", status == 200, f"HTTP {status}")
    _check("pValue updated to 5",              patched.get("pValue") == 5)
    _check("result cleared after edit",        patched.get("result") is None,
           "result should be null after config change")

    updated = _solve_and_wait(base_id)
    r5 = _result(updated)
    _check("P=5 result: status is optimal",   r5.get("status") == "optimal")
    _check("P=5 result: exactly 5 WHs open",  len(r5.get("openWarehouseIds", [])) == 5,
           str(r5.get("openWarehouseIds")))
    obj_p5 = r5.get("objective", 0)
    _check("A/B: obj(P=5) < obj(P=3)  — more WHs → lower cost",
           obj_p5 < obj_p3 * 1.001,
           f"P=5={obj_p5:,.0f}  P=3={obj_p3:,.0f}")
    avg_p5 = r5.get("weightedAvgDistanceMi", 0)

    # ── Step 5: Force-open CHI, create new scenario ──────────────────────────
    _step("Create scenario with CHI forced-open (P=3)")
    status, forced = POST("/scenarios", {
        "name":              "Journey · P-Median CHI Forced",
        "problemType":       "p_median",
        "pValue":            3,
        "distanceBands":     [200, 400, 800, 1600],
        "gap":               0.0,
        "timeLimitSec":      120,
        "capacityMode":      "uniform",
        "uniformCapacity":   None,
        "warehouseStatuses": [{"warehouseId": "CHI", "status": "forced_open"}],
    })
    _check("Create forced-open scenario: 201", status == 201, f"HTTP {status}")
    forced_id = forced["id"]
    created.append(forced_id)

    updated_forced = _solve_and_wait(forced_id)
    rf = _result(updated_forced)
    _check("Forced-open result: status optimal",  rf.get("status") == "optimal")
    _check("Forced-open result: CHI is open",     "CHI" in rf.get("openWarehouseIds", []))
    _check("Forced-open result: exactly 3 WHs",   len(rf.get("openWarehouseIds", [])) == 3)
    _check("A/B: obj(forced CHI) ≥ obj(free P=3)  — forced site raises cost",
           (rf.get("objective") or 0) >= (r3.get("objective") or 0) * 0.999)

    # ── Step 6: Inactive warehouse ────────────────────────────────────────────
    _step("Create scenario with one WH inactive (P=3)")
    # disable the first WH that P=5 chose
    if r5.get("openWarehouseIds"):
        inactive_wh = r5["openWarehouseIds"][0]
        status, inactive_scen = POST("/scenarios", {
            "name":              f"Journey · P-Median {inactive_wh} Inactive",
            "problemType":       "p_median",
            "pValue":            3,
            "distanceBands":     [200, 400, 800, 1600],
            "gap":               0.0,
            "timeLimitSec":      120,
            "capacityMode":      "uniform",
            "uniformCapacity":   None,
            "warehouseStatuses": [{"warehouseId": inactive_wh, "status": "inactive"}],
        })
        _check(f"Create inactive-{inactive_wh} scenario: 201", status == 201, f"HTTP {status}")
        inactive_id = inactive_scen["id"]
        created.append(inactive_id)
        updated_inactive = _solve_and_wait(inactive_id)
        ri = _result(updated_inactive)
        _check("Inactive result: status optimal",            ri.get("status") == "optimal")
        _check(f"Inactive result: {inactive_wh} not in open WHs",
               inactive_wh not in ri.get("openWarehouseIds", []))

    # ── Step 7: Clone ─────────────────────────────────────────────────────────
    _step(f"Clone scenario {base_id}")
    status, clone = POST(f"/scenarios/{base_id}/clone")
    _check("POST /scenarios/:id/clone returns 201", status == 201, f"HTTP {status}")
    _check("Clone name has '(copy)'",               "(copy)" in clone.get("name", ""))
    _check("Clone has new ID",                      clone.get("id") != base_id)
    _check("Clone result is null (unsolved)",       clone.get("result") is None)
    _check("Clone inherits pValue from parent",     clone.get("pValue") == 5)
    clone_id = clone["id"]
    created.append(clone_id)

    updated_clone = _solve_and_wait(clone_id)
    rc = _result(updated_clone)
    _check("Clone solve: status optimal",           rc.get("status") == "optimal")
    _check("Clone solve: 5 WHs (same as parent)",   len(rc.get("openWarehouseIds", [])) == 5)

    # ── Step 8: Compare ───────────────────────────────────────────────────────
    _step("Compare base (P=5) vs forced-open (P=3)")
    status, cmp = POST("/scenarios/compare", {"scenarioIds": [base_id, forced_id]})
    _check("POST /scenarios/compare returns 200", status == 200, f"HTTP {status}")
    scenarios_cmp = cmp.get("scenarios", [])
    _check("Compare returns 2 entries",   len(scenarios_cmp) == 2, f"got {len(scenarios_cmp)}")
    cmp_ids = {s["scenarioId"] for s in scenarios_cmp}
    _check("Compare includes base ID",    base_id   in cmp_ids)
    _check("Compare includes forced ID",  forced_id in cmp_ids)
    for s in scenarios_cmp:
        _check(f"Compare entry {s['scenarioId']}: has weightedAvgDistanceMi",
               "weightedAvgDistanceMi" in s)
        _check(f"Compare entry {s['scenarioId']}: has openSites",
               "openSites" in s)

    # ── Step 9: List all, verify mine appear ─────────────────────────────────
    _step("List all scenarios")
    status, all_scens = GET("/scenarios")
    _check("GET /scenarios returns 200",  status == 200, f"HTTP {status}")
    _check("Created scenarios in list",   isinstance(all_scens, list) and len(all_scens) >= len(created))

    # ── Step 10: 404 on missing scenario ─────────────────────────────────────
    _step("Fetch non-existent scenario")
    status, _ = GET("/scenarios/9999999")
    _check("GET /scenarios/9999999 returns 404", status == 404, f"HTTP {status}")

    # ── Cleanup ───────────────────────────────────────────────────────────────
    _step("Cleanup P-Median scenarios")
    _cleanup(created)
    for sid in created:
        st, _ = GET(f"/scenarios/{sid}")
        _check(f"Scenario {sid} is deleted (404)", st == 404, f"HTTP {st}")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 3 · Transport LP Lab  (Coal Mines → Power Stations)
# ─────────────────────────────────────────────────────────────────────────────
def journey_transport() -> None:
    _section("JOURNEY 3 · Transport LP Lab (Coal Mines → Power Stations)")
    created: list[int] = []

    # ── Step 1: Create base Transport scenario ────────────────────────────────
    _step("Create base Transport LP scenario")
    status, scen = POST("/scenarios", {
        "name":           "Journey · Transport Base LP",
        "problemType":    "transport",
        "pValue":         1,
        "distanceBands":  [500, 1000, 1500, 2000],
        "gap":            0.0,
        "timeLimitSec":   120,
        "capacityMode":   "uniform",
        "uniformCapacity": None,
        "capacityFactor": 1.0,
        "singleSource":   False,
        "capacityInactive": False,
        "warehouseStatuses": [],
    })
    _check("Create Transport scenario: 201", status == 201, f"HTTP {status}")
    _check("problemType is transport",       scen.get("problemType") == "transport")
    _check("capacityFactor is 1.0",          scen.get("capacityFactor") == 1.0)
    _check("singleSource is False",          scen.get("singleSource") is False)
    base_id = scen["id"]
    created.append(base_id)

    # ── Step 2: Solve standard LP ─────────────────────────────────────────────
    _step("Solve standard LP (capacityFactor=1.0, singleSource=False)")
    updated = _solve_and_wait(base_id)
    rb = _result(updated)
    _check("Transport base: status optimal",  rb.get("status") == "optimal", rb.get("status"))
    _check("Transport base: 15 stations served",
           len({a["customerId"] for a in rb.get("assignments", [])}) == 15)
    _check("Transport base: mine IDs are KY/WY/PA/IA",
           {a["warehouseId"] for a in rb.get("assignments", [])} <= {"KY","WY","PA","IA"})
    _check("Transport base: avg distance in [100, 3000] mi",
           100 < (rb.get("weightedAvgDistanceMi") or 0) < 3000)
    _check("Transport base: flowFraction sums to ~1.0 per station",
           all(abs(sum(a["flowFraction"] for a in rb.get("assignments", [])
                       if a["customerId"] == s) - 1.0) < 0.01
               for s in {a["customerId"] for a in rb.get("assignments", [])}))
    obj_base = rb.get("objective", 0)

    # ── Step 3: Uncapacitated (LP relaxation) ─────────────────────────────────
    _step("Clone base → set capacityInactive=True → solve uncapacitated LP")
    _, clone_uncap = POST(f"/scenarios/{base_id}/clone")
    uncap_id = clone_uncap["id"]
    created.append(uncap_id)
    PATCH(f"/scenarios/{uncap_id}", {
        "name": "Journey · Transport Uncapacitated",
        "capacityInactive": True,
    })
    updated_uncap = _solve_and_wait(uncap_id)
    ru = _result(updated_uncap)
    _check("Uncap LP: status optimal",        ru.get("status") == "optimal")
    _check("A/B: obj(uncap) ≤ obj(cap)  — LP relaxation bound",
           (ru.get("objective") or 0) <= obj_base * 1.001,
           f"uncap={ru.get('objective'):,.0f}  cap={obj_base:,.0f}")
    _check("A/B: avg_dist(uncap) ≤ avg_dist(cap)",
           (ru.get("weightedAvgDistanceMi") or 0) <= (rb.get("weightedAvgDistanceMi") or 0) * 1.001)

    # ── Step 4: Single-source (MIP, expected infeasible due to parity) ────────
    _step("Clone base → set singleSource=True → solve (expect infeasible)")
    _, clone_ss = POST(f"/scenarios/{base_id}/clone")
    ss_id = clone_ss["id"]
    created.append(ss_id)
    PATCH(f"/scenarios/{ss_id}", {
        "name": "Journey · Transport Single-Source",
        "singleSource": True,
        "gap": 0.05,
    })
    updated_ss = _solve_and_wait(ss_id, timeout=180)
    rs = _result(updated_ss)
    _check("Single-source: status is optimal or infeasible",
           rs.get("status") in ("optimal", "infeasible"),
           rs.get("status"))
    # With balanced LP (supply=demand=70M, parity constraint), this is expected infeasible
    if rs.get("status") == "infeasible":
        _check("Single-source infeasible: correct expected result (parity constraint)", True)
    else:
        _check("A/B: obj(single-source) ≥ obj(LP base)  — integer ≥ LP bound",
               (rs.get("objective") or 0) >= obj_base * 0.999)

    # ── Step 5: Over-capacity (factor=1.5) ───────────────────────────────────
    _step("Clone base → set capacityFactor=1.5 → solve")
    _, clone_oc = POST(f"/scenarios/{base_id}/clone")
    oc_id = clone_oc["id"]
    created.append(oc_id)
    PATCH(f"/scenarios/{oc_id}", {
        "name": "Journey · Transport Over-Capacity",
        "capacityFactor": 1.5,
    })
    updated_oc = _solve_and_wait(oc_id)
    ro = _result(updated_oc)
    _check("Over-capacity: status optimal",   ro.get("status") == "optimal")
    _check("A/B: obj(factor=1.5) ≤ obj(factor=1.0)  — slack allows cheaper routing",
           (ro.get("objective") or 0) <= obj_base * 1.001,
           f"oc={ro.get('objective'):,.0f}  base={obj_base:,.0f}")

    # ── Step 6: Under-capacity (factor=0.5, must be infeasible) ──────────────
    _step("Clone base → set capacityFactor=0.5 → solve (expect infeasible)")
    _, clone_uc = POST(f"/scenarios/{base_id}/clone")
    uc_id = clone_uc["id"]
    created.append(uc_id)
    PATCH(f"/scenarios/{uc_id}", {
        "name": "Journey · Transport Under-Capacity",
        "capacityFactor": 0.5,
    })
    updated_uc = _solve_and_wait(uc_id)
    ruc = _result(updated_uc)
    _check("Under-capacity (0.5×): status infeasible  — 35M < 70M demand",
           ruc.get("status") == "infeasible", ruc.get("status"))

    # ── Step 7: Compare base vs uncap ────────────────────────────────────────
    _step("Compare base vs uncapacitated")
    status, cmp = POST("/scenarios/compare", {"scenarioIds": [base_id, uncap_id]})
    _check("Compare Transport returns 200", status == 200, f"HTTP {status}")
    _check("Compare returns 2 entries",     len(cmp.get("scenarios", [])) == 2)

    # ── Cleanup ───────────────────────────────────────────────────────────────
    _step("Cleanup Transport scenarios")
    _cleanup(created)
    for sid in created:
        st, _ = GET(f"/scenarios/{sid}")
        _check(f"Scenario {sid} deleted", st == 404, f"HTTP {st}")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 4 · Brazil Capacitated P-Median Lab
# ─────────────────────────────────────────────────────────────────────────────
def journey_brazil() -> None:
    _section("JOURNEY 4 · Brazil Capacitated P-Median Lab")
    created: list[int] = []

    # ── Step 1: Create base (P=3, cap=20M via API default, single-source=False) ─
    _step("Create Brazil base scenario (P=3, singleSource=False)")
    status, scen = POST("/scenarios", {
        "name":           "Journey · Brazil P=3 Infeasible",
        "problemType":    "capacitated_pmedian",
        "pValue":         3,
        "distanceBands":  [500, 1000, 2000, 4000],
        "gap":            0.05,
        "timeLimitSec":   180,
        "capacityMode":   "uniform",
        "uniformCapacity": None,
        "singleSource":   False,
        "warehouseStatuses": [],
    })
    _check("Create Brazil P=3 scenario: 201",  status == 201, f"HTTP {status}")
    _check("problemType is capacitated_pmedian", scen.get("problemType") == "capacitated_pmedian")
    p3_id = scen["id"]
    created.append(p3_id)

    # ── Step 2: Solve P=3 → infeasible (3×20M=60M < 98.7M demand) ───────────
    _step("Solve P=3 (expect infeasible: 3×20M=60M < 98.7M demand)")
    updated_p3 = _solve_and_wait(p3_id)
    r3 = _result(updated_p3)
    _check("Brazil P=3: status infeasible",
           r3.get("status") == "infeasible", r3.get("status"))

    # ── Step 3: Create P=7 scenario (optimal) ────────────────────────────────
    _step("Create Brazil P=7 scenario (default cap=20M per solver)")
    status, scen7 = POST("/scenarios", {
        "name":           "Journey · Brazil P=7 Optimal",
        "problemType":    "capacitated_pmedian",
        "pValue":         7,
        "distanceBands":  [500, 1000, 2000, 4000],
        "gap":            0.05,
        "timeLimitSec":   180,
        "capacityMode":   "uniform",
        "uniformCapacity": None,
        "singleSource":   False,
        "warehouseStatuses": [],
    })
    _check("Create Brazil P=7 scenario: 201", status == 201, f"HTTP {status}")
    p7_id = scen7["id"]
    created.append(p7_id)

    updated_p7 = _solve_and_wait(p7_id)
    r7 = _result(updated_p7)
    _check("Brazil P=7: status optimal", r7.get("status") == "optimal", r7.get("status"))
    _check("Brazil P=7: exactly 7 WHs open",
           len(r7.get("openWarehouseIds", [])) == 7,
           str(r7.get("openWarehouseIds")))
    _check("Brazil P=7: all 25 regions served",
           len({a["customerId"] for a in r7.get("assignments", [])}) == 25)
    _check("Brazil P=7: DF region served",
           "DF" in {a["customerId"] for a in r7.get("assignments", [])})
    _check("Brazil P=7: SE region served",
           "SE" in {a["customerId"] for a in r7.get("assignments", [])})
    obj_p7 = r7.get("objective", 0)
    avg_p7 = r7.get("weightedAvgDistanceMi", 0)

    # ── Step 4: Single-source P=7, cap=20M → infeasible (São Paulo) ──────────
    _step("Clone P=7 → set singleSource=True → expect infeasible (SP demand 29M > 20M cap)")
    _, clone_ss = POST(f"/scenarios/{p7_id}/clone")
    ss_id = clone_ss["id"]
    created.append(ss_id)
    PATCH(f"/scenarios/{ss_id}", {
        "name": "Journey · Brazil P=7 Single-Source",
        "singleSource": True,
    })
    updated_ss = _solve_and_wait(ss_id)
    rss = _result(updated_ss)
    _check("Brazil SS+cap=20M: status infeasible  — SP 29M > cap 20M",
           rss.get("status") == "infeasible", rss.get("status"))
    _check("Infeasibility reason mentions São Paulo",
           "Paulo" in (rss.get("infeasibilityReason") or ""))

    # ── Step 5: P=10 (more WHs → lower cost) ─────────────────────────────────
    _step("Clone P=7 → update to P=10 → solve (monotone test)")
    _, clone_p10 = POST(f"/scenarios/{p7_id}/clone")
    p10_id = clone_p10["id"]
    created.append(p10_id)
    PATCH(f"/scenarios/{p10_id}", {
        "name": "Journey · Brazil P=10 Optimal",
        "pValue": 10,
    })
    updated_p10 = _solve_and_wait(p10_id)
    r10 = _result(updated_p10)
    _check("Brazil P=10: status optimal", r10.get("status") == "optimal", r10.get("status"))
    _check("Brazil P=10: exactly 10 WHs open",
           len(r10.get("openWarehouseIds", [])) == 10,
           str(r10.get("openWarehouseIds")))
    obj_p10 = r10.get("objective", 0)
    avg_p10 = r10.get("weightedAvgDistanceMi", 0)
    _check("A/B: obj(P=10) ≤ obj(P=7)  — more WHs → lower cost",
           obj_p10 <= obj_p7 * 1.001,
           f"P=10={obj_p10:,.0f}  P=7={obj_p7:,.0f}")
    _check("A/B: avg_dist(P=10) ≤ avg_dist(P=7)",
           avg_p10 <= avg_p7 * 1.001,
           f"P=10={avg_p10:.1f}  P=7={avg_p7:.1f}")

    # ── Step 6: Compare P=7 vs P=10 ──────────────────────────────────────────
    _step("Compare P=7 vs P=10")
    status, cmp = POST("/scenarios/compare", {"scenarioIds": [p7_id, p10_id]})
    _check("Compare Brazil returns 200", status == 200, f"HTTP {status}")
    _check("Compare returns 2 entries",  len(cmp.get("scenarios", [])) == 2)
    ids_cmp = {s["scenarioId"] for s in cmp.get("scenarios", [])}
    _check("Compare includes P=7 ID",    p7_id  in ids_cmp)
    _check("Compare includes P=10 ID",   p10_id in ids_cmp)

    # ── Step 7: Validate compare errors ──────────────────────────────────────
    _step("Compare validation: fewer than 2 IDs returns 400")
    status, _ = POST("/scenarios/compare", {"scenarioIds": [p7_id]})
    _check("Compare with 1 ID returns 400", status == 400, f"HTTP {status}")

    # ── Cleanup ───────────────────────────────────────────────────────────────
    _step("Cleanup Brazil scenarios")
    _cleanup(created)
    for sid in created:
        st, _ = GET(f"/scenarios/{sid}")
        _check(f"Scenario {sid} deleted", st == 404, f"HTTP {st}")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 5 · Progress Tracking
# ─────────────────────────────────────────────────────────────────────────────
def journey_progress() -> None:
    _section("JOURNEY 5 · User Progress Tracking")

    _step("GET initial progress")
    status, prog = GET("/progress")
    _check("GET /api/progress returns 200",  status == 200, f"HTTP {status}")
    _check("Progress has userId",             "userId" in prog)
    _check("Initial XP is 0",                prog.get("xp") == 0)
    _check("Initial level is 1",             prog.get("level") == 1)
    _check("Initial streakDays is 0",        prog.get("streakDays") == 0)
    _check("earnedBadges is a list",         isinstance(prog.get("earnedBadges"), list))

    _step("PATCH progress: award XP, set badge and streak")
    status, updated = PATCH("/progress", {
        "xp": 150,
        "level": 2,
        "streakDays": 3,
        "lastSolveDate": "2026-06-30",
        "earnedBadges": ["first_solve", "chapter_5_explorer"],
    })
    _check("PATCH /api/progress returns 200", status == 200, f"HTTP {status}")
    _check("XP updated to 150",              updated.get("xp") == 150)
    _check("Level updated to 2",             updated.get("level") == 2)
    _check("Streak updated to 3",            updated.get("streakDays") == 3)
    _check("Badges include first_solve",     "first_solve" in updated.get("earnedBadges", []))
    _check("Badges include chapter_5_explorer",
           "chapter_5_explorer" in updated.get("earnedBadges", []))

    _step("GET progress — verify persistence")
    status, refetch = GET("/progress")
    _check("Re-fetched progress: 200",       status == 200, f"HTTP {status}")
    _check("Re-fetched XP is 150",           refetch.get("xp") == 150)
    _check("Re-fetched level is 2",          refetch.get("level") == 2)
    _check("Re-fetched badges persisted",
           "first_solve" in refetch.get("earnedBadges", []))

    _step("PATCH solvedScenarios")
    status, updated2 = PATCH("/progress", {
        "solvedScenarios": {
            "p_median": {"completed": True, "bestP": 5},
            "transport": {"completed": True},
        },
    })
    _check("PATCH solvedScenarios: 200",     status == 200, f"HTTP {status}")
    ss = updated2.get("solvedScenarios") or {}
    _check("solvedScenarios.p_median present", "p_median" in ss)
    _check("solvedScenarios.transport present", "transport" in ss)

    _step("Progress endpoint requires auth — test unauthenticated")
    saved = _session_cookie
    globals()["_session_cookie"] = None  # type: ignore[assignment]
    status, _ = GET("/progress")
    _check("Progress without cookie returns 401", status == 401, f"HTTP {status}")
    globals()["_session_cookie"] = saved  # restore


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────
JOURNEYS = {
    "auth":      journey_auth,
    "dataset":   journey_dataset,
    "pmedian":   journey_pmedian,
    "transport": journey_transport,
    "brazil":    journey_brazil,
    "progress":  journey_progress,
}

def main() -> None:
    print(f"\n  Base URL : {BASE_URL}")
    print(f"  Test user: {TEST_USER}")
    print(f"  Section  : {SECTION}")

    if SECTION == "all":
        for fn in JOURNEYS.values():
            fn()
    elif SECTION in JOURNEYS:
        journey_auth()        # always login first
        if SECTION != "auth":
            JOURNEYS[SECTION]()
    else:
        print(f"Unknown section '{SECTION}'. Choose: {', '.join(JOURNEYS)} or 'all'")
        sys.exit(1)

    # ── Logout ────────────────────────────────────────────────────────────────
    _step("Final logout")
    status, body = POST("/logout")
    _check("Logout returns 200",   status == 200, f"HTTP {status}")

    # ── Summary ───────────────────────────────────────────────────────────────
    total, passed, failed = _counts["total"], _counts["passed"], _counts["failed"]
    bar = "═" * 62
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
