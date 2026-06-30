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
SECTION     = (sys.argv[2].lower() if len(sys.argv) > 2 else
               (sys.argv[1].lower() if len(sys.argv) > 1 and not sys.argv[1].startswith("http") else "all"))
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


def _d(body: Any) -> dict:
    """Safely coerce a response body to dict (returns {} for non-dict responses)."""
    return body if isinstance(body, dict) else {}


# ── HTTP client ───────────────────────────────────────────────────────────────
def _request(method: str, path: str, body: dict | None = None,
             timeout: int = 240) -> tuple[int, Any]:
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


def GET(path: str, **kw):    return _request("GET",    path, **kw)
def POST(path: str, body: dict | None = None, **kw): return _request("POST",  path, body, **kw)
def PATCH(path: str, body: dict | None = None, **kw): return _request("PATCH", path, body, **kw)
def DELETE(path: str, **kw): return _request("DELETE", path, **kw)


# ── Helpers ───────────────────────────────────────────────────────────────────
def _solve(scenario_id: int, timeout: int = 240) -> dict:
    _step(f"Solving scenario {scenario_id} …")
    t0 = time.time()
    status, body = POST(f"/scenarios/{scenario_id}/solve", timeout=timeout)
    elapsed = round(time.time() - t0, 1)
    b = _d(body)
    result = _d(b.get("result"))
    sol_st = result.get("status", "?")
    obj    = result.get("objective", 0)
    avg    = result.get("weightedAvgDistanceMi", 0)
    n_open = len(b.get("openWarehouseIds") or result.get("openWarehouseIds") or [])
    print(f"     HTTP {status}  solver={sol_st}  obj={obj:,.0f}  avg={avg:.1f} mi  open={n_open}  t={elapsed}s")
    return b


def _res(scenario: dict) -> dict:
    return _d(scenario.get("result"))


def _assignments(scenario: dict) -> list:
    return _res(scenario).get("assignments") or []


def _cleanup(ids: list[int]) -> None:
    for sid in ids:
        DELETE(f"/scenarios/{sid}")
    if ids:
        print(f"     Cleaned up scenarios: {ids}")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 0 · Auth
# ─────────────────────────────────────────────────────────────────────────────
def journey_auth() -> None:
    global _session_cookie
    _section("JOURNEY 0 · Authentication")

    _step("Health check (/api/healthz)")
    status, body = GET("/healthz")
    b = _d(body)
    _check("GET /api/healthz returns 200", status == 200,    f"HTTP {status}")
    _check("Health body has status=ok",    b.get("status") == "ok", str(body)[:100])

    _step(f"Login as {TEST_USER!r}")
    status, body = POST("/login", {"userId": TEST_USER})
    b = _d(body)
    _check("POST /api/login returns 200",  status == 200, f"HTTP {status}")
    _check("Login body ok=true",           b.get("ok") is True)
    _check("Login returns userId",         b.get("userId") == TEST_USER)
    _check("Session cookie is set",        _session_cookie is not None)

    _step("Verify session via /auth/user")
    status, body = GET("/auth/user")
    b = _d(body)
    _check("GET /auth/user returns 200",   status == 200, f"HTTP {status}")
    _check("Returned user.id matches",
           _d(b.get("user")).get("id") == TEST_USER)

    _step("Login validation — empty userId")
    status, _ = POST("/login", {"userId": ""})
    _check("Empty userId → 400",           status == 400, f"HTTP {status}")

    _step("Login validation — missing userId key")
    status, _ = POST("/login", {})
    _check("Missing userId → 400",         status == 400, f"HTTP {status}")

    _step("Logout")
    status, body = POST("/logout")
    b = _d(body)
    _check("POST /logout returns 200",     status == 200, f"HTTP {status}")
    _check("Logout body ok=true",          b.get("ok") is True)

    _step("Session cleared after logout")
    status, body = GET("/auth/user")
    b = _d(body)
    _check("User is null after logout",    b.get("user") is None)

    # Re-login so subsequent journeys have a session
    POST("/login", {"userId": TEST_USER})
    print(f"     Re-logged in as {TEST_USER!r}")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 1 · Dataset
# ─────────────────────────────────────────────────────────────────────────────
def journey_dataset() -> None:
    _section("JOURNEY 1 · Dataset Inspection")

    _step("Fetch /api/dataset")
    status, body = GET("/dataset")
    b = _d(body)
    _check("GET /dataset returns 200",     status == 200, f"HTTP {status}")
    whs = b.get("warehouses") or []
    cus = b.get("customers")  or []
    _check("Response has warehouses key",  isinstance(whs, list))
    _check("Response has customers key",   isinstance(cus, list))
    _check("26 warehouse candidates",      len(whs) == 26, f"got {len(whs)}")
    _check("200 customers",                len(cus) == 200, f"got {len(cus)}")

    wh_ids = {w.get("id") for w in whs}
    for wid in ["CHI", "LA", "DAL", "ATL", "SEA"]:
        _check(f"Warehouse {wid} present", wid in wh_ids)

    if whs:
        first = whs[0]
        for field in ["id", "city", "state", "lat", "lng"]:
            _check(f"Warehouse has field '{field}'", field in first)
    if cus:
        first_c = cus[0]
        for field in ["id", "lat", "lng", "demand"]:
            _check(f"Customer has field '{field}'", field in first_c)

    total_demand = sum(c.get("demand", 0) for c in cus)
    _check("Total customer demand > 0",    total_demand > 0, f"got {total_demand:,}")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 2 · P-Median Lab  (Al's Athletics)
# ─────────────────────────────────────────────────────────────────────────────
def journey_pmedian() -> None:
    _section("JOURNEY 2 · P-Median Lab (Al's Athletics)")
    created: list[int] = []

    # ── Create base scenario (P=3, uncapacitated) ────────────────────────────
    _step("Create base scenario: P=3, uncapacitated")
    status, scen = POST("/scenarios", {
        "name":              "Journey · P-Median P=3",
        "problemType":       "p_median",
        "pValue":            3,
        "distanceBands":     [200, 400, 800, 1600],
        "gap":               0.0,
        "timeLimitSec":      120,
        "capacityMode":      "uniform",
        "uniformCapacity":   None,
        "warehouseStatuses": [],
    })
    b = _d(scen)
    _check("Create P=3 scenario → 201",    status == 201, f"HTTP {status}")
    _check("Has id",                       "id" in b)
    _check("name stored",                  b.get("name") == "Journey · P-Median P=3")
    _check("problemType = p_median",       b.get("problemType") == "p_median")
    _check("pValue = 3",                   b.get("pValue") == 3)
    _check("result is null (unsolved)",    b.get("result") is None)
    base_id = b["id"]
    created.append(base_id)

    # ── Fetch by ID ───────────────────────────────────────────────────────────
    _step(f"GET /scenarios/{base_id}")
    status, fetched = GET(f"/scenarios/{base_id}")
    _check("GET /scenarios/:id → 200",     status == 200, f"HTTP {status}")
    _check("Fetched ID matches",           _d(fetched).get("id") == base_id)

    # ── Solve P=3 ────────────────────────────────────────────────────────────
    s3 = _solve(base_id)
    r3 = _res(s3)
    _check("P=3: status optimal",          r3.get("status") == "optimal",       r3.get("status","?"))
    _check("P=3: exactly 3 WHs open",      len(r3.get("openWarehouseIds") or []) == 3,
           str(r3.get("openWarehouseIds")))
    _check("P=3: 200 customers served",
           len({a["customerId"] for a in r3.get("assignments") or []}) == 200)
    _check("P=3: objective > 0",           (r3.get("objective") or 0) > 0)
    _check("P=3: avg distance > 0",        (r3.get("weightedAvgDistanceMi") or 0) > 0)
    _check("P=3: result persisted in DB",
           _d(GET(f"/scenarios/{base_id}")[1]).get("result") is not None)
    obj_p3 = r3.get("objective") or 0

    # ── Update P to 5 and re-solve ────────────────────────────────────────────
    _step("PATCH pValue=5 → re-solve")
    status, patched = PATCH(f"/scenarios/{base_id}", {"pValue": 5, "name": "Journey · P-Median P=5"})
    _check("PATCH → 200",                  status == 200,  f"HTTP {status}")
    _check("pValue updated to 5",          _d(patched).get("pValue") == 5)

    s5 = _solve(base_id)
    r5 = _res(s5)
    _check("P=5: status optimal",          r5.get("status") == "optimal",       r5.get("status","?"))
    _check("P=5: exactly 5 WHs open",      len(r5.get("openWarehouseIds") or []) == 5,
           str(r5.get("openWarehouseIds")))
    obj_p5 = r5.get("objective") or 0
    avg_p5 = r5.get("weightedAvgDistanceMi") or 0
    _check("A/B obj(P=5) < obj(P=3)  — more WHs → lower cost",
           obj_p5 < obj_p3 * 1.001,
           f"P=5={obj_p5:,.0f}  P=3={obj_p3:,.0f}")

    # ── New scenario: CHI forced-open (P=3) ──────────────────────────────────
    _step("New scenario: P=3 with CHI forced-open")
    status, forced_scen = POST("/scenarios", {
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
    _check("Create forced-open scenario → 201", status == 201, f"HTTP {status}")
    forced_id = _d(forced_scen)["id"]
    created.append(forced_id)

    sf = _solve(forced_id)
    rf = _res(sf)
    _check("Forced-open: status optimal",  rf.get("status") == "optimal",       rf.get("status","?"))
    _check("Forced-open: CHI in open WHs", "CHI" in (rf.get("openWarehouseIds") or []))
    _check("Forced-open: exactly 3 WHs",   len(rf.get("openWarehouseIds") or []) == 3)
    obj_forced = rf.get("objective") or 0
    _check("A/B obj(forced CHI) ≥ obj(free P=3)  — forced site costs ≥ free",
           obj_forced >= obj_p3 * 0.999,
           f"forced={obj_forced:,.0f}  free={obj_p3:,.0f}")

    # ── New scenario: one WH inactive (P=3) ──────────────────────────────────
    _step("New scenario: P=3 with one WH inactive")
    open_ids = r5.get("openWarehouseIds") or []
    if open_ids:
        inactive_wh = open_ids[0]
        status, inact_scen = POST("/scenarios", {
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
        _check(f"Create inactive-{inactive_wh} scenario → 201", status == 201, f"HTTP {status}")
        inactive_id = _d(inact_scen)["id"]
        created.append(inactive_id)

        si = _solve(inactive_id)
        ri = _res(si)
        _check("Inactive: status optimal",     ri.get("status") == "optimal")
        _check(f"Inactive: {inactive_wh} NOT in open WHs",
               inactive_wh not in (ri.get("openWarehouseIds") or []))
        obj_inactive = ri.get("objective") or 0
        _check("A/B obj(inactive) ≥ obj(free P=3)  — best choice removed → ≥ cost",
               obj_inactive >= obj_p3 * 0.999,
               f"inactive={obj_inactive:,.0f}  free={obj_p3:,.0f}")

    # ── Clone the P=5 scenario ────────────────────────────────────────────────
    _step(f"Clone scenario {base_id}")
    status, clone = POST(f"/scenarios/{base_id}/clone")
    c = _d(clone)
    _check("Clone → 201",                  status == 201, f"HTTP {status}")
    _check("Clone name has '(copy)'",      "(copy)" in (c.get("name") or ""))
    _check("Clone has new ID",             c.get("id") != base_id)
    _check("Clone result is null",         c.get("result") is None)
    _check("Clone inherits pValue=5",      c.get("pValue") == 5)
    clone_id = c["id"]
    created.append(clone_id)

    sc = _solve(clone_id)
    rc = _res(sc)
    _check("Clone solve: optimal",         rc.get("status") == "optimal")
    _check("Clone solve: 5 WHs",           len(rc.get("openWarehouseIds") or []) == 5)
    obj_clone = rc.get("objective") or 0
    _check("Clone obj ≈ parent obj  (same config)",
           abs(obj_clone - obj_p5) / max(obj_p5, 1) < 0.01,
           f"clone={obj_clone:,.0f}  parent={obj_p5:,.0f}")

    # ── Compare base (P=5 result) vs forced-open (P=3 result) ────────────────
    _step("Compare base vs forced-open")
    status, cmp = POST("/scenarios/compare", {"scenarioIds": [base_id, forced_id]})
    b_cmp = _d(cmp)
    _check("Compare → 200",                status == 200, f"HTTP {status}")
    scenarios_cmp = b_cmp.get("scenarios") or []
    _check("Compare returns 2 entries",    len(scenarios_cmp) == 2, f"got {len(scenarios_cmp)}")
    cmp_ids = {s.get("scenarioId") for s in scenarios_cmp}
    _check("Compare has base_id",          base_id   in cmp_ids)
    _check("Compare has forced_id",        forced_id in cmp_ids)
    for s in scenarios_cmp:
        _check(f"Entry {s.get('scenarioId')}: has weightedAvgDistanceMi",
               "weightedAvgDistanceMi" in s)
        _check(f"Entry {s.get('scenarioId')}: has openSites list",
               isinstance(s.get("openSites"), list))

    # ── Compare validation error ──────────────────────────────────────────────
    _step("Compare validation: <2 IDs → 400")
    status, _ = POST("/scenarios/compare", {"scenarioIds": [base_id]})
    _check("Compare with 1 ID → 400",      status == 400, f"HTTP {status}")

    # ── 404 on missing scenario ───────────────────────────────────────────────
    _step("GET /scenarios/9999999 → 404")
    status, _ = GET("/scenarios/9999999")
    _check("Missing scenario → 404",       status == 404, f"HTTP {status}")

    # ── List scenarios (spot check) ───────────────────────────────────────────
    _step("List all scenarios")
    status, all_sc = GET("/scenarios")
    _check("GET /scenarios → 200",         status == 200, f"HTTP {status}")
    all_ids = {s.get("id") for s in (all_sc if isinstance(all_sc, list) else [])}
    _check("Created scenarios appear in list",
           all(sid in all_ids for sid in created))

    # ── Cleanup ───────────────────────────────────────────────────────────────
    _step("Cleanup P-Median scenarios")
    _cleanup(created)
    for sid in created:
        st, _ = GET(f"/scenarios/{sid}")
        _check(f"Scenario {sid} deleted → 404", st == 404, f"HTTP {st}")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 3 · Transport LP Lab  (Coal Mines → Power Stations)
# ─────────────────────────────────────────────────────────────────────────────
def journey_transport() -> None:
    _section("JOURNEY 3 · Transport LP Lab (Coal Mines → Power Stations)")
    created: list[int] = []

    # ── Create base Transport scenario ────────────────────────────────────────
    _step("Create base Transport LP scenario")
    status, scen = POST("/scenarios", {
        "name":              "Journey · Transport Base LP",
        "problemType":       "transport",
        "pValue":            1,
        "distanceBands":     [500, 1000, 1500, 2000],
        "gap":               0.0,
        "timeLimitSec":      120,
        "capacityMode":      "uniform",
        "uniformCapacity":   None,
        "capacityFactor":    1.0,
        "singleSource":      False,
        "capacityInactive":  False,
        "warehouseStatuses": [],
    })
    b = _d(scen)
    _check("Create Transport → 201",       status == 201, f"HTTP {status}")
    _check("problemType = transport",      b.get("problemType") == "transport")
    _check("capacityFactor = 1.0",         b.get("capacityFactor") == 1.0)
    _check("singleSource = False",         b.get("singleSource") is False)
    base_id = b["id"]
    created.append(base_id)

    # ── Solve standard LP ─────────────────────────────────────────────────────
    s_base = _solve(base_id)
    rb = _res(s_base)
    _check("Base LP: status optimal",      rb.get("status") == "optimal",       rb.get("status","?"))
    assigns = rb.get("assignments") or []
    station_ids = {a["customerId"] for a in assigns}
    mine_ids    = {a["warehouseId"] for a in assigns}
    _check("Base LP: 15 stations served",  len(station_ids) == 15, f"got {len(station_ids)}")
    _check("Base LP: mine IDs ⊆ KY/WY/PA/IA", mine_ids <= {"KY","WY","PA","IA"})
    _check("Base LP: avg distance in [100, 3000] mi",
           100 < (rb.get("weightedAvgDistanceMi") or 0) < 3000)
    for stn in station_ids:
        ff_sum = sum(a.get("flowFraction", 0) for a in assigns if a["customerId"] == stn)
        _check(f"Station {stn}: flowFraction sums to 1.0",
               abs(ff_sum - 1.0) < 0.01, f"{ff_sum:.3f}")
    obj_base = rb.get("objective") or 0

    # ── Clone → uncapacitated (LP relaxation) ─────────────────────────────────
    _step("Clone → set capacityInactive=True → solve uncapacitated LP")
    _, clone_uncap = POST(f"/scenarios/{base_id}/clone")
    uncap_id = _d(clone_uncap)["id"]
    created.append(uncap_id)
    PATCH(f"/scenarios/{uncap_id}", {
        "name": "Journey · Transport Uncapacitated",
        "capacityInactive": True,
    })
    su = _solve(uncap_id)
    ru = _res(su)
    _check("Uncap LP: status optimal",     ru.get("status") == "optimal")
    obj_uncap = ru.get("objective") or 0
    _check("A/B obj(uncap) ≤ obj(cap)  — LP relaxation bound",
           obj_uncap <= obj_base * 1.001,
           f"uncap={obj_uncap:,.0f}  cap={obj_base:,.0f}")
    _check("A/B avg_dist(uncap) ≤ avg_dist(cap)",
           (ru.get("weightedAvgDistanceMi") or 0) <= (rb.get("weightedAvgDistanceMi") or 0) * 1.001)

    # ── Clone → over-capacity (factor=1.5) ────────────────────────────────────
    _step("Clone → set capacityFactor=1.5 → solve")
    _, clone_oc = POST(f"/scenarios/{base_id}/clone")
    oc_id = _d(clone_oc)["id"]
    created.append(oc_id)
    PATCH(f"/scenarios/{oc_id}", {
        "name": "Journey · Transport Over-Cap (1.5×)",
        "capacityFactor": 1.5,
    })
    so = _solve(oc_id)
    ro = _res(so)
    _check("Over-cap: status optimal",     ro.get("status") == "optimal",       ro.get("status","?"))
    obj_oc = ro.get("objective") or 0
    _check("A/B obj(1.5×) ≤ obj(1.0×)  — slack lets LP pick cheaper routes",
           obj_oc <= obj_base * 1.001,
           f"oc={obj_oc:,.0f}  base={obj_base:,.0f}")

    # ── Clone → under-capacity (factor=0.5, must be infeasible) ──────────────
    _step("Clone → set capacityFactor=0.5 → expect infeasible")
    _, clone_uc = POST(f"/scenarios/{base_id}/clone")
    uc_id = _d(clone_uc)["id"]
    created.append(uc_id)
    PATCH(f"/scenarios/{uc_id}", {
        "name": "Journey · Transport Under-Cap (0.5×)",
        "capacityFactor": 0.5,
    })
    suc = _solve(uc_id)
    ruc = _res(suc)
    _check("Under-cap (0.5×): status infeasible  — 35M < 70M demand",
           ruc.get("status") == "infeasible", ruc.get("status","?"))

    # ── Clone → single-source (parity makes it infeasible) ───────────────────
    _step("Clone → set singleSource=True → solve (expect infeasible due to parity)")
    _, clone_ss = POST(f"/scenarios/{base_id}/clone")
    ss_id = _d(clone_ss)["id"]
    created.append(ss_id)
    PATCH(f"/scenarios/{ss_id}", {
        "name": "Journey · Transport Single-Source",
        "singleSource": True,
        "gap": 0.05,
    })
    sss = _solve(ss_id, timeout=200)
    rss = _res(sss)
    _check("Single-source: status optimal or infeasible",
           rss.get("status") in ("optimal", "infeasible"), rss.get("status","?"))
    if rss.get("status") == "infeasible":
        _check("Single-source infeasible (parity constraint — expected)", True)
    else:
        _check("A/B obj(SS) ≥ obj(LP)  — integer ≥ LP relaxation",
               (rss.get("objective") or 0) >= obj_base * 0.999)

    # ── Compare base LP vs uncapacitated ─────────────────────────────────────
    _step("Compare base LP vs uncapacitated")
    status, cmp = POST("/scenarios/compare", {"scenarioIds": [base_id, uncap_id]})
    _check("Compare Transport → 200",      status == 200, f"HTTP {status}")
    _check("Compare returns 2 entries",    len(_d(cmp).get("scenarios") or []) == 2)

    # ── Cleanup ───────────────────────────────────────────────────────────────
    _step("Cleanup Transport scenarios")
    _cleanup(created)
    for sid in created:
        st, _ = GET(f"/scenarios/{sid}")
        _check(f"Scenario {sid} deleted → 404", st == 404, f"HTTP {st}")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 4 · Brazil Capacitated P-Median Lab
# ─────────────────────────────────────────────────────────────────────────────
def journey_brazil() -> None:
    _section("JOURNEY 4 · Brazil Capacitated P-Median Lab")
    created: list[int] = []

    # ── Base: P=3, default cap=20M → infeasible (3×20M < 98.7M) ─────────────
    _step("Create Brazil P=3 scenario (expect infeasible: 3×20M=60M < 98.7M demand)")
    status, scen = POST("/scenarios", {
        "name":              "Journey · Brazil P=3",
        "problemType":       "capacitated_pmedian",
        "pValue":            3,
        "distanceBands":     [500, 1000, 2000, 4000],
        "gap":               0.05,
        "timeLimitSec":      180,
        "capacityMode":      "uniform",
        "uniformCapacity":   None,
        "singleSource":      False,
        "warehouseStatuses": [],
    })
    b = _d(scen)
    _check("Create Brazil P=3 → 201",      status == 201, f"HTTP {status}")
    _check("problemType = capacitated_pmedian", b.get("problemType") == "capacitated_pmedian")
    p3_id = b["id"]
    created.append(p3_id)

    sp3 = _solve(p3_id)
    r3 = _res(sp3)
    _check("Brazil P=3: status infeasible  — 3×20M < 98.7M",
           r3.get("status") == "infeasible", r3.get("status","?"))

    # ── P=7, singleSource=False → optimal (notebook default) ──────────────────
    _step("Create Brazil P=7 scenario (notebook default, cap=20M)")
    status, scen7 = POST("/scenarios", {
        "name":              "Journey · Brazil P=7",
        "problemType":       "capacitated_pmedian",
        "pValue":            7,
        "distanceBands":     [500, 1000, 2000, 4000],
        "gap":               0.05,
        "timeLimitSec":      180,
        "capacityMode":      "uniform",
        "uniformCapacity":   None,
        "singleSource":      False,
        "warehouseStatuses": [],
    })
    _check("Create Brazil P=7 → 201",      status == 201, f"HTTP {status}")
    p7_id = _d(scen7)["id"]
    created.append(p7_id)

    sp7 = _solve(p7_id)
    r7 = _res(sp7)
    _check("Brazil P=7: status optimal",   r7.get("status") == "optimal",       r7.get("status","?"))
    _check("Brazil P=7: 7 WHs open",       len(r7.get("openWarehouseIds") or []) == 7,
           str(r7.get("openWarehouseIds")))
    assigns7 = r7.get("assignments") or []
    region_ids = {a["customerId"] for a in assigns7}
    _check("Brazil P=7: 25 regions served", len(region_ids) == 25, f"got {len(region_ids)}")
    _check("Brazil P=7: DF region present", "DF" in region_ids)
    _check("Brazil P=7: SE region present", "SE" in region_ids)
    _check("Brazil P=7: RR absent (removed in notebook)", "RR" not in region_ids)
    _check("Brazil P=7: TO absent (removed in notebook)", "TO" not in region_ids)
    obj_p7 = r7.get("objective") or 0
    avg_p7 = r7.get("weightedAvgDistanceMi") or 0

    # ── P=3 monotone check already done. P=5 vs P=7 via clone ────────────────
    _step("Clone P=7 → set P=5 → verify feasible (5×20M=100M ≥ 98.7M)")
    _, clone5 = POST(f"/scenarios/{p7_id}/clone")
    p5_id = _d(clone5)["id"]
    created.append(p5_id)
    PATCH(f"/scenarios/{p5_id}", {"name": "Journey · Brazil P=5", "pValue": 5})
    sp5 = _solve(p5_id)
    r5 = _res(sp5)
    _check("Brazil P=5: status optimal",   r5.get("status") == "optimal",       r5.get("status","?"))
    obj_p5 = r5.get("objective") or 0
    avg_p5 = r5.get("weightedAvgDistanceMi") or 0
    _check("A/B obj(P=7) ≤ obj(P=5)  — more WHs → lower cost",
           obj_p7 <= obj_p5 * 1.001,
           f"P=7={obj_p7:,.0f}  P=5={obj_p5:,.0f}")
    _check("A/B avg_dist(P=7) ≤ avg_dist(P=5)",
           avg_p7 <= avg_p5 * 1.001,
           f"P=7={avg_p7:.1f}  P=5={avg_p5:.1f}")

    # ── Clone P=7 → singleSource=True → infeasible (SP demand 29M > 20M) ─────
    _step("Clone P=7 → singleSource=True → expect infeasible (SP 29M > cap 20M)")
    _, clone_ss = POST(f"/scenarios/{p7_id}/clone")
    ss_id = _d(clone_ss)["id"]
    created.append(ss_id)
    PATCH(f"/scenarios/{ss_id}", {
        "name": "Journey · Brazil SS+20M Infeasible",
        "singleSource": True,
    })
    sss = _solve(ss_id)
    rss = _res(sss)
    _check("Brazil SS+20M: status infeasible",
           rss.get("status") == "infeasible", rss.get("status","?"))
    _check("Infeasibility reason names São Paulo",
           "Paulo" in (rss.get("infeasibilityReason") or ""))

    # ── Clone P=7 → P=10 (monotone in P) ─────────────────────────────────────
    _step("Clone P=7 → set P=10 → solve (P-monotonicity)")
    _, clone10 = POST(f"/scenarios/{p7_id}/clone")
    p10_id = _d(clone10)["id"]
    created.append(p10_id)
    PATCH(f"/scenarios/{p10_id}", {"name": "Journey · Brazil P=10", "pValue": 10})
    sp10 = _solve(p10_id)
    r10 = _res(sp10)
    _check("Brazil P=10: status optimal",  r10.get("status") == "optimal",      r10.get("status","?"))
    _check("Brazil P=10: exactly 10 WHs",  len(r10.get("openWarehouseIds") or []) == 10,
           str(r10.get("openWarehouseIds")))
    obj_p10 = r10.get("objective") or 0
    avg_p10 = r10.get("weightedAvgDistanceMi") or 0
    _check("A/B obj(P=10) ≤ obj(P=7)",    obj_p10 <= obj_p7 * 1.001,
           f"P=10={obj_p10:,.0f}  P=7={obj_p7:,.0f}")
    _check("A/B avg_dist(P=10) ≤ avg_dist(P=7)",
           avg_p10 <= avg_p7 * 1.001,
           f"P=10={avg_p10:.1f}  P=7={avg_p7:.1f}")

    # ── Compare P=7 vs P=10 ──────────────────────────────────────────────────
    _step("Compare P=7 vs P=10")
    status, cmp = POST("/scenarios/compare", {"scenarioIds": [p7_id, p10_id]})
    _check("Compare Brazil → 200",         status == 200, f"HTTP {status}")
    cmp_scenarios = _d(cmp).get("scenarios") or []
    _check("Compare returns 2 entries",    len(cmp_scenarios) == 2)
    cmp_ids = {s.get("scenarioId") for s in cmp_scenarios}
    _check("Compare has P=7 id",           p7_id  in cmp_ids)
    _check("Compare has P=10 id",          p10_id in cmp_ids)

    # ── Cleanup ───────────────────────────────────────────────────────────────
    _step("Cleanup Brazil scenarios")
    _cleanup(created)
    for sid in created:
        st, _ = GET(f"/scenarios/{sid}")
        _check(f"Scenario {sid} deleted → 404", st == 404, f"HTTP {st}")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 5 · Progress Tracking
# ─────────────────────────────────────────────────────────────────────────────
def journey_progress() -> None:
    global _session_cookie
    _section("JOURNEY 5 · User Progress Tracking")

    _step("GET initial progress")
    status, prog = GET("/progress")
    p = _d(prog)
    _check("GET /progress → 200",          status == 200, f"HTTP {status}")
    _check("userId matches",               p.get("userId") == TEST_USER)
    _check("Initial XP = 0",              p.get("xp") == 0)
    _check("Initial level = 1",           p.get("level") == 1)
    _check("Initial streakDays = 0",      p.get("streakDays") == 0)
    _check("earnedBadges is a list",      isinstance(p.get("earnedBadges"), list))

    _step("PATCH progress: XP=150, level=2, streak=3, 2 badges")
    status, updated = PATCH("/progress", {
        "xp":          150,
        "level":       2,
        "streakDays":  3,
        "lastSolveDate": "2026-06-30",
        "earnedBadges": ["first_solve", "chapter_5_explorer"],
    })
    u = _d(updated)
    _check("PATCH /progress → 200",       status == 200, f"HTTP {status}")
    _check("XP updated to 150",           u.get("xp") == 150)
    _check("Level updated to 2",          u.get("level") == 2)
    _check("Streak updated to 3",         u.get("streakDays") == 3)
    _check("Badge first_solve present",   "first_solve" in (u.get("earnedBadges") or []))
    _check("Badge chapter_5_explorer",    "chapter_5_explorer" in (u.get("earnedBadges") or []))

    _step("Re-fetch progress to verify persistence")
    status, refetch = GET("/progress")
    r = _d(refetch)
    _check("Re-fetch → 200",              status == 200, f"HTTP {status}")
    _check("XP persisted = 150",          r.get("xp") == 150)
    _check("Level persisted = 2",         r.get("level") == 2)
    _check("Badges persisted",            "first_solve" in (r.get("earnedBadges") or []))

    _step("PATCH solvedScenarios")
    status, updated2 = PATCH("/progress", {
        "solvedScenarios": {
            "p_median":            {"completed": True, "bestP": 5},
            "transport":           {"completed": True},
            "capacitated_pmedian": {"completed": True, "bestP": 7},
        },
    })
    u2 = _d(updated2)
    ss = u2.get("solvedScenarios") or {}
    _check("PATCH solvedScenarios → 200", status == 200, f"HTTP {status}")
    _check("solvedScenarios.p_median",    "p_median" in ss)
    _check("solvedScenarios.transport",   "transport" in ss)
    _check("solvedScenarios.capacitated_pmedian", "capacitated_pmedian" in ss)

    _step("Progress endpoint requires auth (test unauthenticated)")
    saved_cookie = _session_cookie
    _session_cookie = None
    status, _ = GET("/progress")
    _check("No cookie → 401",             status == 401, f"HTTP {status}")
    _session_cookie = saved_cookie


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────
JOURNEYS: dict[str, Any] = {
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
        journey_auth()
        if SECTION != "auth":
            JOURNEYS[SECTION]()
    else:
        print(f"Unknown section '{SECTION}'. Choose: {', '.join(JOURNEYS)} or 'all'")
        sys.exit(1)

    _step("Final logout")
    status, b = POST("/logout")
    _check("Final logout → 200",           status == 200, f"HTTP {status}")

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
