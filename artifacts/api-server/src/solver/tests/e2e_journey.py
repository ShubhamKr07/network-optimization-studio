#!/usr/bin/env python3
"""
E2E User Journey Test Suite
============================
Tests the full API lifecycle a user would follow through the Studio — auth,
dataset inspection, scenario CRUD, async solving, cloning — for three of the
lab problem types.

STANDALONE SCRIPT, not pytest-discovered (no `test_*.py` name) —
`python3 -m pytest tests/ -x` does NOT run this. Run it directly:

    python3 e2e_journey.py                              # default local dev server
    python3 e2e_journey.py http://localhost:3001         # explicit base URL
    python3 e2e_journey.py <BASE_URL> [section]          # section: auth|dataset|pmedian|transport|brazil

A13a repair (2026-09-24): this script was fully non-runnable before this
fix — it authenticated via `POST /login {userId}`, the legacy endpoint
removed in Phase 1 (A1.1, `db7b9db`), so it 401'd on the very first request
and never reached any solver/scenario code (see CLAUDE.md's e2e_journey.py
gotcha). Rewritten onto the current contract:

  - Auth: `POST /auth/register` + `POST /auth/login` (argon2), session cookie,
    `GET /auth/user`, `POST /auth/logout` — the real Phase-1 auth surface.
  - Scenarios: `{name, modelId, inputs}` (post-D0 opaque-inputs shape), not
    the pre-D0 flat `{problemType, pValue, warehouseStatuses, ...}` fields.
  - Solve: async — `POST /scenarios/:id/solve` returns `202 {jobId}`
    (G3.1), polled via `GET /scenarios/:id/solve-jobs/:jobId` until a
    terminal `status`, then the published envelope is read back from
    `GET /scenarios/:id` (`result.status/objective/edges/metrics/...`,
    the G2.1/Phase4-prereq standardized envelope) — not the old synchronous
    `{result: {assignments, openWarehouseIds, weightedAvgDistanceMi}}` shape.

Two prior journeys are DELIBERATELY DROPPED, not merely left broken, because
their endpoints no longer exist in this codebase:
  - `POST /scenarios/compare` — removed in SCN v0.3 Phase 3.2 (commit
    `c045548`); Compare.tsx and its route are gone.
  - `/progress` (XP/level/streak/badges) — removed in Phase 1 de-gamification
    (A3.1, commit `cd642fc`); there is no gamification subsystem to test.
Re-adding either journey would require inventing behavior this app no
longer has — out of scope for an auth+shape repair.
"""

import json
import sys
import time
import urllib.request
import urllib.error
from typing import Any

# ── Config ───────────────────────────────────────────────────────────────────
# The old default pointed at a long-dead Replit deployment. Default to the
# documented local-dev api-server address (CLAUDE.md: `PORT=3001 pnpm
# --filter api-server run dev`); override via argv for a real target.
DEFAULT_URL = "http://localhost:3001"
BASE_URL    = (sys.argv[1].rstrip("/") if len(sys.argv) > 1 and sys.argv[1].startswith("http") else DEFAULT_URL)
SECTION     = (sys.argv[2].lower() if len(sys.argv) > 2 else
               (sys.argv[1].lower() if len(sys.argv) > 1 and not sys.argv[1].startswith("http") else "all"))
_run_id     = int(time.time())
TEST_EMAIL  = f"journey_test_{_run_id}@example.test"
TEST_PASSWORD = "journey-test-pw-12345"

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
             timeout: int = 30) -> tuple[int, Any]:
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
def _solve_and_wait(scenario_id: int, poll_timeout: int = 180) -> dict:
    """POST the async solve route, poll the job to a terminal state, then read
    the published result back from the scenario row. Returns the job-poll
    body's terminal snapshot merged with `result` (the full envelope)."""
    _step(f"POST /scenarios/{scenario_id}/solve (enqueue)")
    status, body = POST(f"/scenarios/{scenario_id}/solve")
    b = _d(body)
    if not _check("Solve enqueue → 202", status == 202, f"HTTP {status} {b}"):
        return {"status": "enqueue_failed"}
    job_id = b.get("jobId")
    _check("Enqueue response has jobId", job_id is not None)

    t0 = time.time()
    job: dict = {}
    while time.time() - t0 < poll_timeout:
        jstatus, jbody = GET(f"/scenarios/{scenario_id}/solve-jobs/{job_id}")
        job = _d(jbody)
        if jstatus == 200 and job.get("status") in ("succeeded", "failed"):
            break
        time.sleep(0.5)
    elapsed = round(time.time() - t0, 1)

    terminal = job.get("status", "?")
    print(f"     job={job_id}  terminal={terminal}  t={elapsed}s")
    _check(f"Job {job_id} reaches a terminal state within {poll_timeout}s",
           terminal in ("succeeded", "failed"), f"last status={terminal}")

    scen_status, scen_body = GET(f"/scenarios/{scenario_id}")
    scen = _d(scen_body)
    _check("GET scenario after solve → 200", scen_status == 200, f"HTTP {scen_status}")
    result = scen.get("result") or {}
    if result:
        print(f"     result.status={result.get('status')}  objective={result.get('objective')}  "
              f"edges={len(result.get('edges') or [])}")
    return {**job, "result": result, "scenario": scen}


def _open_facility_ids(result: dict) -> set:
    """The envelope has no top-level `openWarehouseIds` (that was the
    pre-envelope shape) — derive the open facility set from unique
    `edges[].fromId` instead, exactly as the frontend's compareDiff.ts does."""
    return {e.get("fromId") for e in (result.get("edges") or [])}


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

    _step(f"Register {TEST_EMAIL!r}")
    status, body = POST("/auth/register", {"email": TEST_EMAIL, "password": TEST_PASSWORD})
    b = _d(body)
    _check("POST /api/auth/register → 201", status == 201, f"HTTP {status} {b}")
    _check("Register returns user.email",  _d(b.get("user")).get("email") == TEST_EMAIL)
    _check("Register returns user.role",   _d(b.get("user")).get("role") == "student")
    _check("Session cookie is set",        _session_cookie is not None)

    _step("Verify session via /auth/user")
    status, body = GET("/auth/user")
    b = _d(body)
    _check("GET /auth/user returns 200",   status == 200, f"HTTP {status}")
    _check("Returned user.email matches",
           _d(b.get("user")).get("email") == TEST_EMAIL)

    _step("Register validation — password too short")
    status, _ = POST("/auth/register", {"email": f"short_{_run_id}@example.test", "password": "x"})
    _check("Short password → 400",         status == 400, f"HTTP {status}")

    _step("Register validation — duplicate email")
    status, _ = POST("/auth/register", {"email": TEST_EMAIL, "password": TEST_PASSWORD})
    _check("Duplicate email → 409",        status == 409, f"HTTP {status}")

    _step("Logout")
    status, body = POST("/auth/logout")
    b = _d(body)
    _check("POST /auth/logout returns 200", status == 200, f"HTTP {status}")
    _check("Logout body success=true",      b.get("success") is True)

    _step("Session cleared after logout")
    status, body = GET("/auth/user")
    b = _d(body)
    _check("User is null after logout",    b.get("user") is None)

    _step("Login with wrong password")
    status, _ = POST("/auth/login", {"email": TEST_EMAIL, "password": "definitely-wrong"})
    _check("Wrong password → 401",         status == 401, f"HTTP {status}")

    _step(f"Login as {TEST_EMAIL!r}")
    status, body = POST("/auth/login", {"email": TEST_EMAIL, "password": TEST_PASSWORD})
    b = _d(body)
    _check("POST /api/auth/login → 200",   status == 200, f"HTTP {status}")
    _check("Login returns user.email",     _d(b.get("user")).get("email") == TEST_EMAIL)
    _check("Session cookie is set again",  _session_cookie is not None)
    print(f"     Logged in as {TEST_EMAIL!r}")


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 1 · Dataset
# ─────────────────────────────────────────────────────────────────────────────
def journey_dataset() -> None:
    _section("JOURNEY 1 · Dataset Inspection (p-median-us)")

    _step("Fetch /api/dataset (p-median-us — the only model with no ?modelId param)")
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

    _step("GET /api/models lists the registered models")
    status, body = GET("/models")
    models = body if isinstance(body, list) else []
    _check("GET /models returns 200",      status == 200, f"HTTP {status}")
    model_ids = {m.get("id") for m in models}
    for mid in ["p-median-us", "transport-coal", "p-median-brazil"]:
        _check(f"Model '{mid}' registered", mid in model_ids)


# ─────────────────────────────────────────────────────────────────────────────
# JOURNEY 2 · P-Median Lab  (Al's Athletics)
# ─────────────────────────────────────────────────────────────────────────────
def journey_pmedian() -> None:
    _section("JOURNEY 2 · P-Median Lab (Al's Athletics)")
    created: list[int] = []

    base_inputs = {
        "p": 3,
        "distanceBands": [200, 400, 800, 1600],
        "capacityMode": "none",
        "uniformCapacity": None,
        "warehouseOverrides": [],
        "customerOverrides": [],
        "gap": 0,
        "timeLimitSec": 120,
        "addedWarehouses": [],
        "addedCustomers": [],
        "distanceOverrides": [],
    }

    # ── Create base scenario (P=3, uncapacitated) ────────────────────────────
    _step("Create base scenario: P=3, uncapacitated")
    status, scen = POST("/scenarios", {
        "name": "Journey · P-Median P=3",
        "modelId": "p-median-us",
        "inputs": base_inputs,
    })
    b = _d(scen)
    _check("Create P=3 scenario → 201",    status == 201, f"HTTP {status} {b}")
    _check("Has id",                       "id" in b)
    _check("name stored",                  b.get("name") == "Journey · P-Median P=3")
    _check("modelId = p-median-us",        b.get("modelId") == "p-median-us")
    _check("inputs.p = 3",                 _d(b.get("inputs")).get("p") == 3)
    _check("result is null (unsolved)",    b.get("result") is None)
    base_id = b["id"]
    created.append(base_id)

    # ── Fetch by ID ───────────────────────────────────────────────────────────
    _step(f"GET /scenarios/{base_id}")
    status, fetched = GET(f"/scenarios/{base_id}")
    _check("GET /scenarios/:id → 200",     status == 200, f"HTTP {status}")
    _check("Fetched ID matches",           _d(fetched).get("id") == base_id)

    # ── Solve P=3 (async: enqueue → poll → read back) ────────────────────────
    outcome3 = _solve_and_wait(base_id)
    r3 = outcome3.get("result") or {}
    _check("P=3: job terminal status succeeded", outcome3.get("status") == "succeeded",
           outcome3.get("status", "?"))
    _check("P=3: envelope status optimal", r3.get("status") == "optimal", r3.get("status", "?"))
    open3 = _open_facility_ids(r3)
    _check("P=3: exactly 3 WHs open",      len(open3) == 3, str(open3))
    customer_ids3 = {e.get("toId") for e in (r3.get("edges") or [])}
    _check("P=3: 200 customers served",    len(customer_ids3) == 200, f"got {len(customer_ids3)}")
    _check("P=3: objective > 0",           (r3.get("objective") or 0) > 0)
    _check("P=3: weightedAvgDistance > 0",
           ((r3.get("metrics") or {}).get("weightedAvgDistance") or 0) > 0)
    obj_p3 = r3.get("objective") or 0

    # ── Update P to 5 and re-solve ────────────────────────────────────────────
    _step("PATCH inputs.p=5 → re-solve")
    patched_inputs = {**base_inputs, "p": 5}
    status, patched = PATCH(f"/scenarios/{base_id}", {"inputs": patched_inputs})
    _check("PATCH → 200",                  status == 200,  f"HTTP {status}")
    _check("inputs.p updated to 5",        _d(patched).get("inputs", {}).get("p") == 5)
    _check("PATCH marks scenario stale (result exists, inputs changed)",
           _d(patched).get("stale") is True)

    outcome5 = _solve_and_wait(base_id)
    r5 = outcome5.get("result") or {}
    _check("P=5: envelope status optimal", r5.get("status") == "optimal", r5.get("status", "?"))
    open5 = _open_facility_ids(r5)
    _check("P=5: exactly 5 WHs open",      len(open5) == 5, str(open5))
    obj_p5 = r5.get("objective") or 0
    _check("A/B obj(P=5) < obj(P=3)  — more WHs → lower cost",
           obj_p5 < obj_p3 * 1.001,
           f"P=5={obj_p5:,.0f}  P=3={obj_p3:,.0f}")
    _check("Re-solve clears staleness",    outcome5.get("scenario", {}).get("stale") is False)

    # ── New scenario: CHI forced-open (P=3) ──────────────────────────────────
    _step("New scenario: P=3 with CHI forced-open")
    forced_inputs = {
        **base_inputs,
        "warehouseOverrides": [{"id": "CHI", "status": "forced_open"}],
    }
    status, forced_scen = POST("/scenarios", {
        "name": "Journey · P-Median CHI Forced",
        "modelId": "p-median-us",
        "inputs": forced_inputs,
    })
    _check("Create forced-open scenario → 201", status == 201, f"HTTP {status}")
    forced_id = _d(forced_scen)["id"]
    created.append(forced_id)

    outcome_f = _solve_and_wait(forced_id)
    rf = outcome_f.get("result") or {}
    _check("Forced-open: envelope status optimal", rf.get("status") == "optimal", rf.get("status", "?"))
    open_f = _open_facility_ids(rf)
    _check("Forced-open: CHI in open WHs", "CHI" in open_f, str(open_f))
    _check("Forced-open: exactly 3 WHs",   len(open_f) == 3, str(open_f))
    obj_forced = rf.get("objective") or 0
    _check("A/B obj(forced CHI) ≥ obj(free P=3)  — forced site costs ≥ free",
           obj_forced >= obj_p3 * 0.999,
           f"forced={obj_forced:,.0f}  free={obj_p3:,.0f}")

    # ── Clone the P=5 scenario ────────────────────────────────────────────────
    _step(f"Clone scenario {base_id}")
    status, clone = POST(f"/scenarios/{base_id}/clone")
    c = _d(clone)
    _check("Clone → 201",                  status == 201, f"HTTP {status}")
    _check("Clone name has '(copy)'",      "(copy)" in (c.get("name") or ""))
    _check("Clone has new ID",             c.get("id") != base_id)
    _check("Clone inherits p=5",           _d(c.get("inputs")).get("p") == 5)
    clone_id = c["id"]
    created.append(clone_id)

    outcome_c = _solve_and_wait(clone_id)
    rc = outcome_c.get("result") or {}
    _check("Clone solve: optimal",         rc.get("status") == "optimal")
    _check("Clone solve: 5 WHs",           len(_open_facility_ids(rc)) == 5)
    obj_clone = rc.get("objective") or 0
    _check("Clone obj ≈ parent obj  (same config)",
           abs(obj_clone - obj_p5) / max(obj_p5, 1) < 0.01,
           f"clone={obj_clone:,.0f}  parent={obj_p5:,.0f}")

    # ── Ownership: 404 on missing/cross-user scenario ─────────────────────────
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

    base_inputs = {
        "distanceBands": [500, 1000, 1500, 2000],
        "gap": 0,
        "timeLimitSec": 120,
        "capacityFactor": 1.0,
        "singleSource": False,
        "capacityInactive": False,
    }

    _step("Create base Transport LP scenario")
    status, scen = POST("/scenarios", {
        "name": "Journey · Transport Base LP",
        "modelId": "transport-coal",
        "inputs": base_inputs,
    })
    b = _d(scen)
    _check("Create Transport → 201",       status == 201, f"HTTP {status} {b}")
    _check("modelId = transport-coal",     b.get("modelId") == "transport-coal")
    base_id = b["id"]
    created.append(base_id)

    outcome = _solve_and_wait(base_id)
    rb = outcome.get("result") or {}
    _check("Base LP: envelope status optimal", rb.get("status") == "optimal", rb.get("status", "?"))
    edges = rb.get("edges") or []
    station_ids = {e.get("toId") for e in edges}
    mine_ids    = {e.get("fromId") for e in edges}
    _check("Base LP: 15 stations served",  len(station_ids) == 15, f"got {len(station_ids)}")
    _check("Base LP: mine IDs ⊆ KY/WY/PA/IA", mine_ids <= {"KY", "WY", "PA", "IA"}, str(mine_ids))
    avg_dist = (rb.get("metrics") or {}).get("weightedAvgDistance") or 0
    _check("Base LP: avg distance in [100, 3000] mi", 100 < avg_dist < 3000, f"got {avg_dist}")
    obj_base = rb.get("objective") or 0

    # ── Clone → uncapacitated (LP relaxation) ─────────────────────────────────
    _step("Clone → set capacityInactive=True → solve uncapacitated LP")
    _, clone_uncap = POST(f"/scenarios/{base_id}/clone")
    uncap_id = _d(clone_uncap)["id"]
    created.append(uncap_id)
    PATCH(f"/scenarios/{uncap_id}", {
        "inputs": {**base_inputs, "capacityInactive": True},
    })
    outcome_u = _solve_and_wait(uncap_id)
    ru = outcome_u.get("result") or {}
    _check("Uncap LP: envelope status optimal", ru.get("status") == "optimal")
    obj_uncap = ru.get("objective") or 0
    _check("A/B obj(uncap) ≤ obj(cap)  — LP relaxation bound",
           obj_uncap <= obj_base * 1.001,
           f"uncap={obj_uncap:,.0f}  cap={obj_base:,.0f}")

    # ── Clone → under-capacity (factor=0.5, must be infeasible) ──────────────
    _step("Clone → set capacityFactor=0.5 → expect infeasible")
    _, clone_uc = POST(f"/scenarios/{base_id}/clone")
    uc_id = _d(clone_uc)["id"]
    created.append(uc_id)
    PATCH(f"/scenarios/{uc_id}", {
        "inputs": {**base_inputs, "capacityFactor": 0.5},
    })
    outcome_uc = _solve_and_wait(uc_id)
    ruc = outcome_uc.get("result") or {}
    _check("Under-cap (0.5×): envelope status infeasible  — capacity < demand",
           ruc.get("status") == "infeasible", ruc.get("status", "?"))

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

    base_inputs = {
        "p": 7,
        "distanceBands": [500, 1000, 2000, 4000],
        "capacityMode": "uniform",
        "uniformCapacity": 20_000_000,
        "warehouseOverrides": [],
        "customerOverrides": [],
        "gap": 0.05,
        "timeLimitSec": 180,
        "singleSource": False,
        "addedWarehouses": [],
        "addedCustomers": [],
        "distanceOverrides": [],
    }

    # ── P=3, default cap=20M → infeasible (3×20M < 98.7M demand) ─────────────
    _step("Create Brazil P=3 scenario (expect infeasible: 3×20M=60M < 98.7M demand)")
    status, scen = POST("/scenarios", {
        "name": "Journey · Brazil P=3",
        "modelId": "p-median-brazil",
        "inputs": {**base_inputs, "p": 3},
    })
    b = _d(scen)
    _check("Create Brazil P=3 → 201",      status == 201, f"HTTP {status} {b}")
    _check("modelId = p-median-brazil",    b.get("modelId") == "p-median-brazil")
    p3_id = b["id"]
    created.append(p3_id)

    outcome3 = _solve_and_wait(p3_id)
    r3 = outcome3.get("result") or {}
    _check("Brazil P=3: envelope status infeasible  — 3×20M < 98.7M",
           r3.get("status") == "infeasible", r3.get("status", "?"))

    # ── P=7, default cap=20M → optimal (notebook default) ─────────────────────
    _step("Create Brazil P=7 scenario (notebook default, cap=20M)")
    status, scen7 = POST("/scenarios", {
        "name": "Journey · Brazil P=7",
        "modelId": "p-median-brazil",
        "inputs": base_inputs,
    })
    _check("Create Brazil P=7 → 201",      status == 201, f"HTTP {status}")
    p7_id = _d(scen7)["id"]
    created.append(p7_id)

    outcome7 = _solve_and_wait(p7_id)
    r7 = outcome7.get("result") or {}
    _check("Brazil P=7: envelope status optimal or feasible",
           r7.get("status") in ("optimal", "feasible"), r7.get("status", "?"))
    open7 = _open_facility_ids(r7)
    _check("Brazil P=7: 7 WHs open",       len(open7) == 7, str(open7))
    edges7 = r7.get("edges") or []
    region_ids = {e.get("toId") for e in edges7}
    _check("Brazil P=7: 25 regions served", len(region_ids) == 25, f"got {len(region_ids)}")
    _check("Brazil P=7: DF region present", "DF" in region_ids)
    _check("Brazil P=7: SE region present", "SE" in region_ids)
    _check("Brazil P=7: RR absent (removed in notebook)", "RR" not in region_ids)
    _check("Brazil P=7: TO absent (removed in notebook)", "TO" not in region_ids)
    obj_p7 = r7.get("objective") or 0

    # ── Clone P=7 → set P=5 → verify feasible (5×20M=100M ≥ 98.7M) ───────────
    _step("Clone P=7 → set P=5 → verify feasible (5×20M=100M ≥ 98.7M)")
    _, clone5 = POST(f"/scenarios/{p7_id}/clone")
    p5_id = _d(clone5)["id"]
    created.append(p5_id)
    PATCH(f"/scenarios/{p5_id}", {"name": "Journey · Brazil P=5", "inputs": {**base_inputs, "p": 5}})
    outcome5 = _solve_and_wait(p5_id)
    r5 = outcome5.get("result") or {}
    _check("Brazil P=5: envelope status optimal or feasible",
           r5.get("status") in ("optimal", "feasible"), r5.get("status", "?"))
    obj_p5 = r5.get("objective") or 0
    _check("A/B obj(P=7) ≤ obj(P=5)  — more WHs → lower cost",
           obj_p7 <= obj_p5 * 1.001,
           f"P=7={obj_p7:,.0f}  P=5={obj_p5:,.0f}")

    # ── Clone P=7 → P=10 (monotone in P) ─────────────────────────────────────
    _step("Clone P=7 → set P=10 → solve (P-monotonicity)")
    _, clone10 = POST(f"/scenarios/{p7_id}/clone")
    p10_id = _d(clone10)["id"]
    created.append(p10_id)
    PATCH(f"/scenarios/{p10_id}", {"name": "Journey · Brazil P=10", "inputs": {**base_inputs, "p": 10}})
    outcome10 = _solve_and_wait(p10_id)
    r10 = outcome10.get("result") or {}
    _check("Brazil P=10: envelope status optimal or feasible",
           r10.get("status") in ("optimal", "feasible"), r10.get("status", "?"))
    _check("Brazil P=10: exactly 10 WHs", len(_open_facility_ids(r10)) == 10,
           str(_open_facility_ids(r10)))
    obj_p10 = r10.get("objective") or 0
    _check("A/B obj(P=10) ≤ obj(P=7)",    obj_p10 <= obj_p7 * 1.001,
           f"P=10={obj_p10:,.0f}  P=7={obj_p7:,.0f}")

    # ── Cleanup ───────────────────────────────────────────────────────────────
    _step("Cleanup Brazil scenarios")
    _cleanup(created)
    for sid in created:
        st, _ = GET(f"/scenarios/{sid}")
        _check(f"Scenario {sid} deleted → 404", st == 404, f"HTTP {st}")


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────
JOURNEYS: dict[str, Any] = {
    "auth":      journey_auth,
    "dataset":   journey_dataset,
    "pmedian":   journey_pmedian,
    "transport": journey_transport,
    "brazil":    journey_brazil,
}


def main() -> None:
    print(f"\n  Base URL : {BASE_URL}")
    print(f"  Test user: {TEST_EMAIL}")
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
    status, b = POST("/auth/logout")
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
