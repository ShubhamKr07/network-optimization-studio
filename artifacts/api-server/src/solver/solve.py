#!/usr/bin/env python3
"""P-Median, Transportation LP, and Capacitated P-Median solvers.
Reads JSON from stdin, writes the SolverProcessMessage (A3) to fd 3."""
import sys, json, time, math, os

# ---------------------------------------------------------------------------
# A3 -- fd 3 is the Node<->Python IPC channel jobRunner.ts's spawn() opens as
# an extra stdio pipe. Mark it close-on-exec BEFORE any subprocess (CBC,
# spawned later by PuLP inside a solve_* call) can inherit it: an inherited
# fd3 held open by a grandchild process would block Node from ever seeing
# EOF on that pipe once solve.py itself exits. Must run at import time --
# before any solve() call, i.e. before CBC is ever spawned. Best-effort: fd 3
# is genuinely absent for a manual/dev invocation
# (`echo ... | python3 solve.py`, no Node driving it) -- _write_process_
# message() below falls back to stdout in that case, so a missing fd 3 here
# is expected and not fatal.
try:
    import fcntl
    _fd3_flags = fcntl.fcntl(3, fcntl.F_GETFD)
    fcntl.fcntl(3, fcntl.F_SETFD, _fd3_flags | fcntl.FD_CLOEXEC)
except (OSError, ImportError):
    pass

from pulp import (LpProblem, LpMinimize, LpVariable, lpSum,
                  LpConstraint, LpConstraintEQ, LpConstraintLE, LpConstraintGE,
                  LpStatus, value, PULP_CBC_CMD)
from merge_inputs import (
    build_merged_pmedian_dataset,
    build_merged_brazil_dataset,
    build_merged_transport_dataset,
    build_merged_two_echelon_dataset,
    build_merged_jade_dataset,
    build_merged_chens_dataset,
)
from cbc_termination import solve_with_capture

# ---------------------------------------------------------------------------
# Canonical datasets live in solvers/<model-id>/dataset/*.json (C1.1/C1.2).
# All three models' data is small enough to load eagerly at import time —
# no per-request modelId-driven lazy loading yet (Phase 3.5's model registry
# will replace this whole loading block with a proper registry lookup).
# ---------------------------------------------------------------------------
_SOLVERS_ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))),
    "solvers",
)

def _load_json(model_id, filename):
    with open(os.path.join(_SOLVERS_ROOT, model_id, "dataset", filename)) as f:
        return json.load(f)

# ---------------------------------------------------------------------------
# Dataset load-failure containment (Phase H, H4). A single corrupt/missing
# dataset file used to crash solve.py at import time, taking down EVERY
# model — not just the one whose dataset was broken. _safe_load wraps each
# module-level load so a failure is captured into _LOAD_ERRORS keyed by
# model_id; the affected model's solve_* function then returns an error
# envelope instead of crashing, while the OTHER models keep working.
_LOAD_ERRORS = {}

def _safe_load(model_id, filename, default=None):
    try:
        return _load_json(model_id, filename)
    except Exception as e:  # noqa: BLE001 — intentionally broad: any IO/JSON failure
        _LOAD_ERRORS[model_id] = f"Failed to load {model_id}/{filename}: {e}"
        return default

# ---------------------------------------------------------------------------
# Dataset: Al's Athletics — P-Median (26 warehouses, 200 customers)
# Source: Watson et al. "Supply Chain Network Design" Ch.5 Exercise 5 notebook
# solvers/p-median-us/dataset/
# ---------------------------------------------------------------------------
_WH_DATA  = _safe_load("p-median-us", "warehouses.json", default={})
_CU_DATA  = _safe_load("p-median-us", "customers.json", default={})
_DIST_RAW = _safe_load("p-median-us", "distances.json", default={})

WAREHOUSES     = {int(k): v for k, v in _WH_DATA.items()}
CUSTOMERS      = {int(k): v for k, v in _CU_DATA.items()}
DISTANCE       = {(int(k.split(',')[0]), int(k.split(',')[1])): v for k, v in _DIST_RAW.items()}
TOTAL_DEMAND   = sum(c['demand'] for c in CUSTOMERS.values())
WH_STRING_TO_NUM = {v['id']: int(k) for k, v in _WH_DATA.items()}

# ---------------------------------------------------------------------------
# Dataset: Coal Mines → Power Stations (Chapter 5 Transportation LP)
# Source: Watson et al. "Supply Chain Network Design" Ch.5 Exercise 5 notebook
# solvers/transport-coal/dataset/
# ---------------------------------------------------------------------------
COAL_MINES      = _safe_load("transport-coal", "mines.json", default={})
POWER_STATIONS  = _safe_load("transport-coal", "stations.json", default={})
_TRANSPORT_COSTS_RAW = _safe_load("transport-coal", "costs.json", default={})

# ---------------------------------------------------------------------------
# Dataset: Brazil Facility Location (Chapter 5 Capacitated P-Median)
# Source: Watson et al. "Supply Chain Network Design" Ch.5 Exercise 6 notebook
# 25 candidate warehouse cities, 25 demand regions (states)
# solvers/p-median-brazil/dataset/
# ---------------------------------------------------------------------------
BRAZIL_WAREHOUSES   = _safe_load("p-median-brazil", "warehouses.json", default={})
BRAZIL_REGIONS      = _safe_load("p-median-brazil", "states.json", default={})
_BRAZIL_DIST_RAW    = _safe_load("p-median-brazil", "distances.json", default={})
BRAZIL_TOTAL_DEMAND = sum(r["demand"] for r in BRAZIL_REGIONS.values())

# ---------------------------------------------------------------------------
# Dataset: Chapter 10 Two-Echelon Gold Refinery (Australia)
# Source: Notebook_Mining_Problem_Chapter_10_Network_Design_Book.ipynb
# 1 gold mine -> 2 candidate refineries -> 10 customers
# solvers/two-echelon-gold-au/dataset/
# ---------------------------------------------------------------------------
GOLD_MINES      = _safe_load("two-echelon-gold-au", "mines.json")
GOLD_REFINERIES = _safe_load("two-echelon-gold-au", "refineries.json")
GOLD_CUSTOMERS  = _safe_load("two-echelon-gold-au", "customers.json")
_GOLD_DIST_RAW  = _safe_load("two-echelon-gold-au", "distances.json")

# Notebook's cost divisor: kg -> truckloads (the objective divides each leg's
# distance*flow by TRUCKLOAD_KG, so the objective is NOT in kg-km and must
# never be divided by demand to derive an average distance -- see
# test_avg_distance_not_derived_from_objective).
TRUCKLOAD_KG = 44000

def _transport_distances():
    """Mine→station distances in miles, precomputed at extraction time
    (haversine × circuity — see scripts/extract-datasets.py)."""
    return {tuple(k.split(',')): v for k, v in _TRANSPORT_COSTS_RAW.items()}

def _brazil_distances():
    """Warehouse→region distances in miles, precomputed at extraction time
    (haversine × circuity — see scripts/extract-datasets.py)."""
    return {tuple(k.split(',')): v for k, v in _BRAZIL_DIST_RAW.items()}

def _gold_distances():
    return {(k.split(',')[0], k.split(',')[1]): v for k, v in _GOLD_DIST_RAW.items()}

# ---------------------------------------------------------------------------
# Dataset: JADE Investment Decision (Chapter 9 Multi-Product Two-Echelon)
# Source: JADE_case_Chapter_9_Network_Design_Book.ipynb
# 4 plants -> 25 warehouses -> 100 customers, 4 products, plant x product
# capability (can-make) matrix. solvers/two-echelon-jade-us/dataset/
# ---------------------------------------------------------------------------
JADE_PLANTS     = _safe_load("two-echelon-jade-us", "plants.json", default={})
JADE_PRODUCTS   = _safe_load("two-echelon-jade-us", "products.json", default={})
JADE_WAREHOUSES = _safe_load("two-echelon-jade-us", "warehouses.json", default={})
JADE_CUSTOMERS  = _safe_load("two-echelon-jade-us", "customers.json", default={})
_JADE_CAP_RAW   = _safe_load("two-echelon-jade-us", "plant_product_capability.json", default=[])
_JADE_DIST_RAW  = _safe_load("two-echelon-jade-us", "distances.json", default={})

JADE_CAPABILITY = {(c["plantId"], c["productId"]): c["capacity"] for c in _JADE_CAP_RAW}

# JADE cost coefficients (spec §2.3) -- named constants, not bare literals.
JADE_OB_RATE    = 0.12        # $ per ton-mile, warehouse -> customer
JADE_OB_MIN     = 10.0        # $ per ton minimum charge, warehouse -> customer
JADE_IC_RATE    = 0.07        # $ per ton-mile, plant -> warehouse
JADE_IC_MIN     = 10.0        # $ per ton minimum charge, plant -> warehouse
JADE_OPEN_BIG_M = 10_000_000  # big-M for the open-if-used constraint (spec §2.5.4)

def _jade_distances():
    """Plant->warehouse and warehouse->customer distances in miles, one flat
    dict keyed by (fromId, toId) spanning both legs (same one-dict-two-legs
    convention as two-echelon-gold-au's _gold_distances())."""
    return {tuple(k.split(',')): v for k, v in _JADE_DIST_RAW.items()}

# ---------------------------------------------------------------------------
# Dataset: Chen's Cosmetics — China coverage model (Chapter 4)
# Source: ChensCosmeticsV1 Step 3.ipynb (Watson et al. Ch.4)
# 25 candidate warehouses -> 197 customers; distances are RAW km (circuity
# ×1.17 applied in solve_chens only, D8). Direct-id keyed (wh-<n>/cs-<n>),
# distances keyed by "wh-15,cs-1" (like two-echelon), NOT ordinals.
# solvers/chens-cosmetics-cn/dataset/
# ---------------------------------------------------------------------------
_CHENS_WH_RAW   = _safe_load("chens-cosmetics-cn", "warehouses.json", default={})
_CHENS_CU_RAW   = _safe_load("chens-cosmetics-cn", "customers.json", default={})
_CHENS_DIST_RAW = _safe_load("chens-cosmetics-cn", "distances.json", default={})

WAREHOUSES_CHENS = dict(_CHENS_WH_RAW)
CUSTOMERS_CHENS  = dict(_CHENS_CU_RAW)
DISTANCE_CHENS   = {(k.split(',')[0], k.split(',')[1]): v for k, v in _CHENS_DIST_RAW.items()}

# ---------------------------------------------------------------------------
# B2: truthful CBC termination evidence, shared by every model. Production
# used to call PULP_CBC_CMD(msg=False) with no logPath, discarding CBC's own
# log into /dev/null and then trusting pulp.LpStatus[prob.status] alone --
# which, per cbc_termination.py's module docstring, collapses a genuinely
# gap-limited or time-limited-with-incumbent stop into the same LpStatusOptimal
# a truly proven optimum gets. `_run_cbc` instead runs the solve through the
# P0R.1 spike's capture-and-classify pipeline (unique per-solve logPath +
# .sol capture -> parse_cbc_termination), returning a CBCCaptureResult whose
# `lpStatus` mirrors the exact same pulp.LpStatus[prob.status] value every
# existing call site already branches on (e.g. status_str == "Infeasible"),
# so no other post-solve branching needs to change -- only what gets reported
# as the envelope's solutionStatus/terminationReason.
# ---------------------------------------------------------------------------
def _run_cbc(prob, gap, time_limit, *, problem_uid=None, msg=False):
    # A3 -- Node owns the per-solve temp dir now (mkdtemp'd in jobRunner.ts,
    # passed via NOS_SOLVE_WORKDIR so it never touches the model-math
    # payload). solve_with_capture()'s own base_tmp_dir already accepted an
    # override; None (env var unset -- direct pytest calls of solve_pmedian()
    # etc, or a manual/dev invocation with no Node driving it) falls back to
    # its existing tempfile.gettempdir() default, so behavior for every
    # non-Node caller is unchanged.
    base_tmp_dir = os.environ.get("NOS_SOLVE_WORKDIR") or None
    return solve_with_capture(
        prob, gapRel=gap, timeLimit=time_limit, msg=msg, problem_uid=problem_uid,
        base_tmp_dir=base_tmp_dir)

# ---------------------------------------------------------------------------
# Standardized result envelope (Phase 3.5, G2.1; B2 adds truthful status).
# `details` deliberately retains the pre-envelope `assignments`/
# `openWarehouseIds` shape verbatim (not just the new generic `edges` view)
# -- a pure refactor of where each already-computed value lives, not a
# re-derivation, so no numeric value changes. `edges` is the new
# model-agnostic view Phase 4/5 render from.
#
# B2: `solution_status` (one of cbc_termination.SOLUTION_STATUSES, or the
# pre-existing "error" for a load/dispatch failure that never reached a
# solve attempt at all) is now the argument every caller passes -- the
# legacy `status` field is derived from it via `_STATUS_PROJECTION`, never
# hardcoded to "optimal" again. `terminationReason`/`achievedGap`/
# `solverIncumbentObjective`/`solverBestBound` are additive, nullable, and
# come straight from CBC's own captured evidence (`_run_cbc`'s
# CBCCaptureResult) wherever a solve was actually attempted; solver-math
# derivation of `objective` itself is untouched (hard rule #6 / §2.9).
# ---------------------------------------------------------------------------
_STATUS_PROJECTION = {
    "optimal": "optimal",
    "feasible": "feasible",
    "infeasible": "infeasible",
    "no_solution": "no_solution",
    "unbounded": "unbounded",
}

def _envelope(solution_status, quality, objective, run_time, edges, metrics, details,
              infeasibility_reason=None, termination_reason=None, achieved_gap=None,
              solver_incumbent_objective=None, solver_best_bound=None):
    status = _STATUS_PROJECTION.get(solution_status, solution_status)
    return {
        "status": status,
        "solutionStatus": solution_status,
        "terminationReason": termination_reason,
        "achievedGap": achieved_gap,
        "solverIncumbentObjective": solver_incumbent_objective,
        "solverBestBound": solver_best_bound,
        "objective": objective,
        "runTimeSec": round(run_time, 2),
        "quality": quality,
        "edges": edges,
        "metrics": metrics,
        "details": details,
        "solverUsed": "CBC (PuLP)",
        "infeasibilityReason": infeasibility_reason,
    }

# Empty envelope slot constants reused by every model's error/infeasible path
# (two-echelon's solve_two_echelon introduced these references; behavior-
# preserving shorthands for the inline dicts the three existing models already
# emit on their error/infeasible branches — no numeric value changes).
_EMPTY_METRICS = {"utilizationByNode": [], "bandCoverage": [], "weightedAvgDistance": 0}
_EMPTY_DETAILS = {"openWarehouseIds": [], "assignments": []}

def _load_error_envelope(model_id, run_time=0.0):
    """Error envelope returned when a model's dataset failed to load at
    import time — keyed off _LOAD_ERRORS so the user sees the actual
    IO/JSON failure message instead of a bare traceback.

    Pure-Python callers (solve_pmedian() etc invoked directly, e.g. by
    pytest) still get this exact status="error" shape back — unchanged by
    A3. It's only `__main__`'s process boundary that now refuses to forward
    a status="error" envelope as a fd3 SUCCESS message; `_failureStage`
    below is the private marker that boundary reads to classify which
    FAILURE message to write instead (never the raw infeasibilityReason
    text, which may contain a filesystem path from the underlying OSError).
    """
    env = _envelope(
        "error", "error", 0, run_time, [],
        {"utilizationByNode": [], "bandCoverage": [], "weightedAvgDistance": 0},
        {"openWarehouseIds": [], "assignments": []},
        _LOAD_ERRORS.get(model_id, f"Unknown load error for {model_id}"),
    )
    env["_failureStage"] = "dataset_load"
    return env


# ---------------------------------------------------------------------------
# A3 -- fd3 SolverProcessMessage helpers. See
# artifacts/api-server/src/solver/solverProcessMessage.ts for the Node-side
# schema this must match exactly (failureReason/failureStage enums,
# errorDetail allowlist + 2048-byte cap).
# ---------------------------------------------------------------------------
_MAX_ERROR_DETAIL_BYTES = 2048


def _failure(reason, stage, detail=None):
    """Builds a FAILURE process message. `detail`, if given, MUST already be
    a small, structured, allowlisted dict — never raw stdout/stderr, a raw
    exception message, or a filesystem path (§ A3). Defensively truncated to
    the 2048-byte octet cap the Node-side schema also enforces, so a bug here
    degrades to a smaller-but-valid message rather than a protocol violation."""
    if detail is not None:
        raw = json.dumps(detail)
        if len(raw.encode("utf-8")) > _MAX_ERROR_DETAIL_BYTES:
            detail = {"truncated": True}
    return {"failureReason": reason, "failureStage": stage, "errorDetail": detail}


def _write_process_message(msg):
    """Writes exactly one newline-terminated JSON object to fd 3 (A3's
    Node<->Python IPC channel) — the sole channel a caller driven by
    jobRunner.ts reads. Falls back to stdout only when fd 3 isn't open at
    all (a manual/dev invocation with no Node parent providing it — not part
    of the production contract). Never raises: a failure to report the
    result must not crash the process after the solve already completed."""
    line = json.dumps(msg) + "\n"
    try:
        with os.fdopen(os.dup(3), "w") as f:
            f.write(line)
            f.flush()
        return
    except OSError:
        pass
    sys.stdout.write(line)
    sys.stdout.flush()

# ---------------------------------------------------------------------------
# P-Median solver (Chapter 3)
# ---------------------------------------------------------------------------
def solve_pmedian(inp):
    if _LOAD_ERRORS.get("p-median-us"):
        return _load_error_envelope("p-median-us")
    p = inp['pValue']
    distance_bands = sorted(inp['distanceBands'])
    uniform_capacity = inp.get('uniformCapacity')
    # D1.1: sparse per-entity overrides, keyed by the same string ids used in
    # warehouseStatuses/excludedCustomerIds — entries only exist for
    # warehouses/customers that actually override the base value.
    warehouse_capacities = inp.get('warehouseCapacities', {})
    customer_demands = inp.get('customerDemands', {})
    gap = inp.get('gap', 0.0)
    time_limit = inp.get('timeLimitSec', 120)
    wh_statuses = {ws['warehouseId']: ws['status'] for ws in inp.get('warehouseStatuses', [])}
    excluded_ids = set(inp.get('excludedCustomerIds', []))

    # B3.1: per-call merge of the base dataset with this scenario's
    # scenario-local network edits (addedWarehouses/addedCustomers/
    # distanceOverrides, B1.1) — never mutates the module-level WAREHOUSES/
    # CUSTOMERS/DISTANCE globals, so concurrent solves for other scenarios
    # never see one scenario's added entities. Empty inputs (the default)
    # produce a merged dataset that is a plain equal copy of the globals,
    # so this is a no-op for every scenario that doesn't use the feature.
    merged = build_merged_pmedian_dataset(inp, WAREHOUSES, CUSTOMERS, DISTANCE)
    wh_data = merged['warehouses']
    cust_data = merged['customers']
    dist_data = merged['distance']
    # Added entities carry their own capacity/status/demand directly on
    # their addedWarehouses/addedCustomers record (B1.1's schema) — distinct
    # from base entities, whose capacity/status/demand come from the sparse
    # warehouseCapacities/wh_statuses/customer_demands override maps above.
    # Mirrors precheckPMedianInputs' (B2.1) own precedent: an added entity's
    # active/inactive status and demand are resolved solely from its own
    # added-entity record, never layered with the base-entity sparse
    # override maps.
    added_warehouses_by_id = merged['addedWarehousesById']
    added_customers_by_id = merged['addedCustomersById']

    warehouses = list(wh_data.keys())
    customers_list = [k for k in cust_data.keys() if cust_data[k]['id'] not in excluded_ids]

    def get_bounds(wid):
        sid = wh_data[wid]['id']
        added = added_warehouses_by_id.get(sid)
        s = added['status'] if added is not None else wh_statuses.get(sid, 'potential')
        if s == 'forced_open': return (1, 1)
        if s == 'inactive':    return (0, 0)
        return (0, 1)

    def get_capacity(wid):
        sid = wh_data[wid]['id']
        added = added_warehouses_by_id.get(sid)
        if added is not None:
            return added.get('capacity')
        if sid in warehouse_capacities:
            return warehouse_capacities[sid]
        return uniform_capacity

    def get_demand(c):
        cid = cust_data[c]['id']
        added = added_customers_by_id.get(cid)
        if added is not None:
            return added['demand']
        return customer_demands.get(cid, cust_data[c]['demand'])

    start = time.time()

    prob = LpProblem("PMedian", LpMinimize)

    assign_vars   = LpVariable.dicts("A",    [(w, c) for w in warehouses for c in customers_list], 0, 1, cat='Binary')
    facility_vars = LpVariable.dicts("Open", warehouses, 0, 1, cat='Binary')

    prob += lpSum(get_demand(c) * dist_data.get((w, c), 9999) * assign_vars[w, c]
                  for w in warehouses for c in customers_list)

    for c in customers_list:
        prob += LpConstraint(lpSum(assign_vars[w, c] for w in warehouses),
                             LpConstraintEQ, f"served_{c}", 1)

    prob += LpConstraint(lpSum(facility_vars[w] for w in warehouses),
                         LpConstraintEQ, "FacilityCount", p)

    for w in warehouses:
        cap = get_capacity(w)
        if cap is not None:
            prob += LpConstraint(
                lpSum(get_demand(c) * assign_vars[w, c] for c in customers_list) - cap * facility_vars[w],
                LpConstraintLE, f"cap_{w}", 0)

    for w in warehouses:
        lb, ub = get_bounds(w)
        prob += LpConstraint(facility_vars[w], LpConstraintGE, f"lb_{w}", lb)
        prob += LpConstraint(facility_vars[w], LpConstraintLE, f"ub_{w}", ub)

    for w in warehouses:
        for c in customers_list:
            prob += LpConstraint(assign_vars[w, c] - facility_vars[w],
                                 LpConstraintLE, f"route_{w}_{c}", 0)

    cbc = _run_cbc(prob, gap, time_limit, problem_uid="pmedian")

    run_time = time.time() - start
    status_str = cbc.lpStatus

    if status_str == "Infeasible":
        forced_open = sum(1 for w in warehouses if get_bounds(w) == (1,1))
        reason = "Model is infeasible."
        active_demand_count = sum(get_demand(c) for c in customers_list)
        capacities_in_play = [get_capacity(w) for w in warehouses if get_capacity(w) is not None]
        if forced_open > p:
            reason = f"Forced-open warehouses ({forced_open}) exceed p={p}. Increase P or unforce some warehouses."
        elif capacities_in_play:
            total_capacity = sum(sorted(capacities_in_play, reverse=True)[:p])
            reason = (f"Capacity is too tight. The {p} highest-capacity warehouses provide "
                      f"{total_capacity:,} total capacity, less than active demand ({active_demand_count:,}). "
                      "Increase P, raise capacity, or remove the capacity constraint.")
        return _envelope("infeasible", status_str, 0, run_time, [],
                          {"utilizationByNode": [], "bandCoverage": [], "weightedAvgDistance": 0},
                          {"openWarehouseIds": [], "assignments": []}, reason,
                          termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                          solver_incumbent_objective=cbc.solverIncumbentObjective,
                          solver_best_bound=cbc.solverBestBound)

    open_wh_nums = [w for w in warehouses if (facility_vars[w].varValue or 0) > 0.5]
    open_wh_ids  = [wh_data[w]['id'] for w in open_wh_nums]

    assignments = []
    edges = []
    wh_demand = {w: 0.0 for w in open_wh_nums}
    band_demand = {b: 0.0 for b in distance_bands}
    total_demand_assigned = 0.0

    for c in customers_list:
        assigned_w = None
        for w in open_wh_nums:
            if (assign_vars[w, c].varValue or 0) > 0.5:
                assigned_w = w
                break
        if assigned_w is None:
            assigned_w = min(open_wh_nums, key=lambda w: dist_data.get((w, c), 9999))

        dist   = dist_data.get((assigned_w, c), 0)
        demand = get_demand(c)
        wh_demand[assigned_w] += demand
        total_demand_assigned += demand
        band_idx = next((i for i, b in enumerate(distance_bands) if dist <= b), len(distance_bands) - 1)
        # cust_data[c]['id'] (not a synthetic f"C{c}") — base dataset customer
        # ids already happen to equal f"C{index}", but an added customer's id
        # is whatever the student named it, so this must read the real id.
        wh_id, c_id = wh_data[assigned_w]['id'], cust_data[c]['id']
        assignments.append({"customerId": c_id, "warehouseId": wh_id,
                             "distanceMi": dist, "band": band_idx})
        edges.append({"fromId": wh_id, "toId": c_id, "flow": round(demand), "distance": dist, "band": band_idx})
        for b in distance_bands:
            if dist <= b:
                band_demand[b] += demand

    obj_val   = value(prob.objective) or 0
    active_demand = total_demand_assigned if total_demand_assigned > 0 else 1
    wt_avg    = obj_val / active_demand
    band_coverage = [{"band": b, "percent": round(band_demand[b] * 100 / active_demand)} for b in distance_bands]
    avg_demand_per_wh = active_demand / len(open_wh_nums) if open_wh_nums else 1
    utilization = []
    for w in open_wh_nums:
        cap = get_capacity(w)
        cap_for_util = cap if (cap and cap < active_demand) else avg_demand_per_wh
        utilization.append({"warehouseId": wh_data[w]['id'], "city": wh_data[w]['city'],
                             "utilization": min(100, round(wh_demand[w] * 100 / cap_for_util))})

    return _envelope(cbc.solutionStatus, status_str, round(obj_val), run_time, edges,
                      {"utilizationByNode": utilization, "bandCoverage": band_coverage, "weightedAvgDistance": round(wt_avg, 1)},
                      {"openWarehouseIds": open_wh_ids, "assignments": assignments},
                      termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                      solver_incumbent_objective=cbc.solverIncumbentObjective,
                      solver_best_bound=cbc.solverBestBound)

# ---------------------------------------------------------------------------
# Transportation LP solver (Chapter 5)
# ---------------------------------------------------------------------------
def solve_transport(inp):
    if _LOAD_ERRORS.get("transport-coal"):
        return _load_error_envelope("transport-coal")
    capacity_factor   = float(inp.get('capacityFactor', 1.0))
    single_source     = bool(inp.get('singleSource', False))
    capacity_inactive = bool(inp.get('capacityInactive', False))
    distance_bands    = sorted(inp.get('distanceBands', [500, 1000, 1500, 2000]))
    gap               = float(inp.get('gap', 0.0))
    time_limit        = int(inp.get('timeLimitSec', 120))
    mine_caps         = inp.get('mineCapacities', {})
    station_demands   = inp.get('stationDemands', {})

    # B6.1: per-call merge of the base dataset with this scenario's
    # scenario-local network edits (addedMines/addedStations/
    # laneCostOverrides) — mirrors solve_pmedian's B3.1 / solve_capacitated_
    # pmedian's B6.3 wiring; transport-coal is already ID-keyed (DD-2), so
    # build_merged_transport_dataset does a plain dict merge, no id<->index
    # bridge. Never mutates COAL_MINES/POWER_STATIONS/_transport_distances()
    # module-level data. Empty inputs (the default) produce a merged dataset
    # equal to the base globals, so this is a no-op for every scenario that
    # doesn't use the feature.
    merged = build_merged_transport_dataset(inp, COAL_MINES, POWER_STATIONS, _transport_distances())
    mine_data    = merged['mines']
    station_data = merged['stations']
    dist         = merged['distance']
    # An added mine/station's own capacity/demand comes straight off its
    # addedMines/addedStations record — mines/stations have no status/open-
    # close concept in this LP at all (a "closed" mine is a capacity
    # override of 0, per templates.ts's own precedent), so unlike p-median
    # there is no status-bound mechanism to wire here.
    added_mines_by_id    = merged['addedMinesById']
    added_stations_by_id = merged['addedStationsById']

    def get_base_capacity(m):
        added = added_mines_by_id.get(m)
        if added is not None:
            return added.get('capacity')  # None -> unconstrained supply
        return mine_caps.get(m, mine_data[m]['capacity'])

    def effective_demand(s):
        added = added_stations_by_id.get(s)
        if added is not None:
            return added['demand']
        return station_demands.get(s, station_data[s]['demand'])

    mines    = list(mine_data.keys())
    stations = list(station_data.keys())
    total_demand = sum(effective_demand(s) for s in stations)

    start = time.time()
    prob  = LpProblem("TransportLP", LpMinimize)

    flow = LpVariable.dicts("Flow", [(m, s) for m in mines for s in stations], lowBound=0)

    if single_source:
        source = LpVariable.dicts("Src", [(m, s) for m in mines for s in stations], 0, 1, cat='Binary')

    # .get((m, s), 9999) — same missing-pair sentinel convention as
    # solve_pmedian's dist_data.get((w, c), 9999): the base dataset's cost
    # matrix is a complete 4x15 grid (no missing pairs), but once an added
    # mine/station has no laneCostOverrides to some counterpart, `dist` has
    # no entry for that pair at all (L4: no auto-haversine — an override IS
    # the mechanism). Without a fallback the objective's lpSum would raise a
    # bare KeyError on any scenario reaching this constructor with an
    # incomplete added-entity lane-cost set — B2.1-style precheck.ts is the
    # primary place this gets caught before a solve is even attempted, but
    # solve.py must not crash outright either.
    prob += lpSum(dist.get((m, s), 9999) * flow[m, s] for m in mines for s in stations)

    for s in stations:
        prob += LpConstraint(
            lpSum(flow[m, s] for m in mines),
            LpConstraintEQ, f"demand_{s}", effective_demand(s))

    if not capacity_inactive:
        for m in mines:
            base_cap = get_base_capacity(m)
            if base_cap is None:
                continue  # unconstrained supply (added mine with no capacity given)
            cap = base_cap * capacity_factor
            prob += LpConstraint(
                lpSum(flow[m, s] for s in stations),
                LpConstraintLE, f"cap_{m}", cap)

    if single_source:
        for s in stations:
            prob += LpConstraint(
                lpSum(source[m, s] for m in mines),
                LpConstraintEQ, f"onesrc_{s}", 1)
            for m in mines:
                prob += LpConstraint(
                    flow[m, s] - effective_demand(s) * source[m, s],
                    LpConstraintLE, f"link_{m}_{s}", 0)

    cbc = _run_cbc(prob, gap, time_limit, problem_uid="transport")

    run_time   = time.time() - start
    status_str = cbc.lpStatus

    if status_str == "Infeasible":
        total_capacity = sum(int((get_base_capacity(m) or 0) * capacity_factor) for m in mines)
        if single_source and not capacity_inactive:
            reason = (
                "Infeasible with single-source + capacity constraints active. "
                f"Each station must be served by exactly one mine, but total mine capacity "
                f"({total_capacity:,} tons) "
                f"cannot cover all demand ({total_demand:,} tons) under these restrictions. "
                "This is the pedagogical point of exercise part (c). "
                "Fix: (a) disable single-source, (b) increase capacityFactor, or (c) set capacityInactive=true."
            )
        else:
            reason = (
                f"Total mine capacity ({total_capacity:,} tons) "
                f"is less than total station demand ({total_demand:,} tons). "
                "Increase capacityFactor or set capacityInactive=true."
            )
        return _envelope("infeasible", status_str, 0, run_time, [],
                          {"utilizationByNode": [], "bandCoverage": [], "weightedAvgDistance": 0},
                          {"openWarehouseIds": mines, "assignments": []}, reason,
                          termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                          solver_incumbent_objective=cbc.solverIncumbentObjective,
                          solver_best_bound=cbc.solverBestBound)

    obj_val = value(prob.objective) or 0
    avg_dist = obj_val / total_demand if total_demand > 0 else 0

    assignments = []
    edges = []
    mine_outflow = {m: 0.0 for m in mines}
    band_demand  = {b: 0.0 for b in distance_bands}

    for m in mines:
        for s in stations:
            flow_val = (flow[m, s].varValue or 0)
            if flow_val < 1:
                continue
            d = dist.get((m, s), 9999)
            mine_outflow[m] += flow_val
            band_idx = next((i for i, b in enumerate(distance_bands) if d <= b), len(distance_bands) - 1)
            flow_tons = round(flow_val)
            assignments.append({
                "customerId": s,
                "warehouseId": m,
                "distanceMi": d,
                "band": band_idx,
                "flowTons": flow_tons,
                "flowFraction": round(flow_val / effective_demand(s), 4)
            })
            edges.append({"fromId": m, "toId": s, "flow": flow_tons, "distance": d, "band": band_idx})
            for b in distance_bands:
                if d <= b:
                    band_demand[b] += flow_val

    band_coverage = [{"band": b, "percent": round(band_demand[b] * 100 / total_demand)} for b in distance_bands]

    utilization = []
    for m in mines:
        cap = get_base_capacity(m)
        if cap:
            denom = cap * capacity_factor if not capacity_inactive else cap
            util = min(100, round(mine_outflow[m] * 100 / denom)) if not capacity_inactive else round(mine_outflow[m] * 100 / denom)
        else:
            util = 0  # unconstrained added mine (no capacity given) — nothing to be "full" against
        utilization.append({"warehouseId": m, "city": mine_data[m]['city'], "utilization": util})

    return _envelope(cbc.solutionStatus, status_str, round(obj_val), run_time, edges,
                      {"utilizationByNode": utilization, "bandCoverage": band_coverage, "weightedAvgDistance": round(avg_dist, 1)},
                      {"openWarehouseIds": mines, "assignments": assignments},
                      termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                      solver_incumbent_objective=cbc.solverIncumbentObjective,
                      solver_best_bound=cbc.solverBestBound)

# ---------------------------------------------------------------------------
# Capacitated P-Median solver — Brazil Facility Location (Chapter 5)
# 25 warehouse candidates, 25 demand regions
# singleSource=True  → binary assign (infeasible with 20M cap: SP demands 29M)
# singleSource=False → continuous assign (LP relaxation, always feasible)
# ---------------------------------------------------------------------------
def solve_capacitated_pmedian(inp):
    if _LOAD_ERRORS.get("p-median-brazil"):
        return _load_error_envelope("p-median-brazil")
    p               = int(inp.get('pValue', 5))
    wh_cap          = int(inp.get('warehouseCapacity', 20_000_000))
    single_source   = bool(inp.get('singleSource', True))
    gap             = float(inp.get('gap', 0.0))
    time_limit      = int(inp.get('timeLimitSec', 120))
    distance_bands  = sorted(inp.get('distanceBands', [500, 1000, 2000, 4000]))

    # B6.3: per-call merge of the base dataset with this scenario's
    # scenario-local network edits (addedWarehouses/addedCustomers/
    # distanceOverrides, B1.1) — mirrors solve_pmedian's B3.1 wiring, but
    # p-median-brazil is already ID-keyed (DD-2's correction), so
    # build_merged_brazil_dataset does a plain dict merge with no id<->index
    # bridge. Never mutates the module-level BRAZIL_WAREHOUSES/
    # BRAZIL_REGIONS/_brazil_distances() data. Empty inputs (the default)
    # produce a merged dataset equal to the base globals, so this is a no-op
    # for every scenario that doesn't use the feature.
    merged = build_merged_brazil_dataset(inp, BRAZIL_WAREHOUSES, BRAZIL_REGIONS, _brazil_distances())
    wh_data     = merged['warehouses']
    region_data = merged['regions']
    dist        = merged['distance']     # in miles
    # An added warehouse's own status (forced_open/inactive) comes straight
    # off its addedWarehouses record — p-median-brazil has no base-warehouse
    # status override table (D1.1's per-warehouse override UI was never
    # built for this model), so base warehouses stay unconstrained (free to
    # be selected for any of the P slots) exactly as before this task.
    added_warehouses_by_id = merged['addedWarehousesById']

    warehouses = list(wh_data.keys())
    regions    = list(region_data.keys())
    total_demand = sum(r['demand'] for r in region_data.values())

    def get_bounds(w):
        added = added_warehouses_by_id.get(w)
        s = added['status'] if added is not None else 'active'
        if s == 'forced_open': return (1, 1)
        if s == 'inactive':    return (0, 0)
        return (0, 1)

    # Pre-check: if single-source and any region exceeds capacity, report infeasibility
    # immediately without running the solver (faster feedback, clearer message).
    if single_source:
        over_cap = [(rid, region_data[rid]['name'], region_data[rid]['demand'])
                    for rid in regions if region_data[rid]['demand'] > wh_cap]
        if over_cap:
            names = ", ".join(f"{n} ({d/1e6:.0f}M)" for _, n, d in over_cap[:3])
            plural = "regions" if len(over_cap) > 1 else "region"
            return _envelope(
                "infeasible", "Infeasible", 0, 0.0, [],
                {"utilizationByNode": [], "bandCoverage": [], "weightedAvgDistance": 0},
                {"openWarehouseIds": [], "assignments": []},
                (
                    f"Demand {plural} {names} exceed the single-warehouse capacity "
                    f"({wh_cap/1e6:.0f}M). Under single-sourcing each region must be served by "
                    "exactly one warehouse, but no warehouse can absorb this much demand. "
                    "Solution: toggle Single-source OFF to allow demand to split across warehouses."
                ),
                # No CBC evidence exists -- this is a pure pre-solve, dataset-
                # derived infeasibility (a region's demand mathematically
                # exceeds the single-warehouse capacity), detected before any
                # solve is attempted. termination_reason mirrors the
                # solution_status literal rather than fabricating CBC log
                # evidence that was never produced.
                termination_reason="infeasible",
            )

    start = time.time()
    prob  = LpProblem("CapPMedian", LpMinimize)

    # assign_vars: binary when single_source, continuous otherwise
    cat = 'Binary' if single_source else 'Continuous'
    assign_vars   = LpVariable.dicts("A",    [(w, r) for w in warehouses for r in regions], 0, 1, cat=cat)
    facility_vars = LpVariable.dicts("Open", warehouses, 0, 1, cat='Binary')

    # Objective: minimise sum of distance * demand * assignment_fraction.
    # dist.get((w, r), 9999) — same missing-pair sentinel as solve_pmedian —
    # an added warehouse/region with no distanceOverrides to some pair on
    # the other side simply can't be assigned there (no auto-haversine, L4).
    prob += lpSum(dist.get((w, r), 9999) * region_data[r]['demand'] * assign_vars[w, r]
                  for w in warehouses for r in regions)

    # C1: every region fully served (fractions sum to 1)
    for r in regions:
        prob += LpConstraint(
            lpSum(assign_vars[w, r] for w in warehouses),
            LpConstraintEQ, f"served_{r}", 1)

    # C2: open exactly P warehouses
    prob += LpConstraint(
        lpSum(facility_vars[w] for w in warehouses),
        LpConstraintEQ, "FacilityCount", p)

    # C2b: forced-open/inactive bounds for added warehouses (base warehouses
    # are unaffected — get_bounds returns the default (0, 1) for any id not
    # in added_warehouses_by_id, so no constraint is added for them).
    for w in warehouses:
        lb, ub = get_bounds(w)
        if (lb, ub) != (0, 1):
            prob += LpConstraint(facility_vars[w], LpConstraintGE, f"lb_{w}", lb)
            prob += LpConstraint(facility_vars[w], LpConstraintLE, f"ub_{w}", ub)

    # C3: capacity per open warehouse
    for w in warehouses:
        prob += LpConstraint(
            lpSum(region_data[r]['demand'] * assign_vars[w, r] for r in regions)
            - wh_cap * facility_vars[w],
            LpConstraintLE, f"cap_{w}", 0)

    # C4: can only assign to an open warehouse
    for w in warehouses:
        for r in regions:
            prob += LpConstraint(
                assign_vars[w, r] - facility_vars[w],
                LpConstraintLE, f"route_{w}_{r}", 0)

    cbc = _run_cbc(prob, gap, time_limit, problem_uid="brazil")

    run_time   = time.time() - start
    status_str = cbc.lpStatus

    if status_str not in ("Optimal", "Not Solved"):
        # Generic infeasibility fallback
        reason = (
            f"Model is infeasible with P={p}, capacity={wh_cap:,}. "
            f"Total required capacity with P warehouses = {p * wh_cap:,} vs "
            f"total demand = {total_demand:,}. "
            "Try increasing P, raising warehouse capacity, or disabling single-sourcing."
        )
        return _envelope("infeasible", status_str, 0, run_time, [],
                          {"utilizationByNode": [], "bandCoverage": [], "weightedAvgDistance": 0},
                          {"openWarehouseIds": [], "assignments": []}, reason,
                          termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                          solver_incumbent_objective=cbc.solverIncumbentObjective,
                          solver_best_bound=cbc.solverBestBound)

    open_wh_ids = [w for w in warehouses if (facility_vars[w].varValue or 0) > 0.5]

    assignments = []
    edges = []
    wh_demand   = {w: 0.0 for w in open_wh_ids}
    band_demand  = {b: 0.0 for b in distance_bands}
    obj_val      = value(prob.objective) or 0

    for r in regions:
        rd = region_data[r]['demand']
        for w in open_wh_ids:
            frac = assign_vars[w, r].varValue or 0
            if frac < 1e-6:
                continue
            d = dist.get((w, r), 9999)
            wh_demand[w] += rd * frac
            band_idx = next((i for i, b in enumerate(distance_bands) if d <= b), len(distance_bands) - 1)
            assignments.append({
                "customerId": r,
                "warehouseId": w,
                "distanceMi": d,
                "band": band_idx,
                "flowFraction": round(frac, 4),
            })
            edges.append({"fromId": w, "toId": r, "flow": round(rd * frac), "distance": d, "band": band_idx})
            for b in distance_bands:
                if d <= b:
                    band_demand[b] += rd * frac

    wt_avg = obj_val / total_demand if total_demand > 0 else 0
    band_coverage = [
        {"band": b, "percent": round(band_demand[b] * 100 / total_demand)}
        for b in distance_bands
    ]
    utilization = [
        {
            "warehouseId": w,
            "city": wh_data[w]['city'],
            "utilization": min(100, round(wh_demand[w] * 100 / wh_cap)),
        }
        for w in open_wh_ids
    ]

    return _envelope(cbc.solutionStatus, status_str, round(obj_val), run_time, edges,
                      {"utilizationByNode": utilization, "bandCoverage": band_coverage, "weightedAvgDistance": round(wt_avg, 1)},
                      {"openWarehouseIds": open_wh_ids, "assignments": assignments},
                      termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                      solver_incumbent_objective=cbc.solverIncumbentObjective,
                      solver_best_bound=cbc.solverBestBound)

# ---------------------------------------------------------------------------
# Two-Echelon Gold Refinery solver (Chapter 10)
# mine -> refinery -> customer, exactly one of two candidate refineries opens.
# ---------------------------------------------------------------------------
def solve_two_echelon(inp):
    if _LOAD_ERRORS.get("two-echelon-gold-au"):
        env = _envelope("error", "error", 0, 0, [], _EMPTY_METRICS, _EMPTY_DETAILS,
                         f"Dataset load failed: {_LOAD_ERRORS['two-echelon-gold-au']}")
        env["_failureStage"] = "dataset_load"
        return env

    bom            = float(inp.get('bomRatio', 1.1))
    distance_bands = sorted(inp.get('distanceBands', [500, 1000, 1500, 2000, 2600]))
    gap            = float(inp.get('gap', 0.0))
    time_limit     = int(inp.get('timeLimitSec', 120))
    ref_status     = {o['refineryId']: o['status'] for o in inp.get('refineryStatuses', [])}
    excluded       = set(inp.get('excludedCustomerIds', []))
    demand_over    = inp.get('customerDemands', {})

    # B6.2: per-call merge of the base dataset with this scenario's
    # scenario-local network edits (addedRefineries/addedCustomers/
    # distanceOverrides) -- mirrors solve_transport's B6.1 / solve_
    # capacitated_pmedian's B6.3 wiring. two-echelon-gold-au is already
    # ID-keyed (DD-2), so build_merged_two_echelon_dataset does a plain
    # dict merge, no id<->index bridge. Never mutates GOLD_MINES/
    # GOLD_REFINERIES/GOLD_CUSTOMERS/_gold_distances() module-level data.
    # No addedMines concept -- the mine is fixed, never overridable (not a
    # facility-location choice).
    merged = build_merged_two_echelon_dataset(inp, GOLD_MINES, GOLD_REFINERIES, GOLD_CUSTOMERS, _gold_distances())
    refinery_data = merged['refineries']
    customer_data = merged['customers']
    dist          = merged['distance']
    # An added refinery/customer's own status/demand comes straight off its
    # addedRefineries/addedCustomers record (own-record wins, mirroring
    # solve_pmedian's/solve_transport's established precedent) -- distinct
    # from base entities, whose status/demand come from the sparse
    # ref_status/demand_over override maps above. An added refinery
    # competing to be the single open one is a real capability, not skipped
    # for a first pass.
    added_refineries_by_id = merged['addedRefineriesById']
    added_customers_by_id  = merged['addedCustomersById']

    def get_ref_status(r):
        added = added_refineries_by_id.get(r)
        if added is not None:
            return added['status']
        return ref_status.get(r)

    def get_demand(c):
        added = added_customers_by_id.get(c)
        if added is not None:
            return float(added['demand'])
        return float(demand_over.get(c, customer_data[c]['demand']))

    mines      = list(GOLD_MINES.keys())
    refineries = list(refinery_data.keys())
    customers  = [c for c in customer_data if c not in excluded]
    demands    = {c: get_demand(c) for c in customers}
    total_demand = sum(demands.values())

    start = time.time()
    prob  = LpProblem("TwoEchelonGold", LpMinimize)

    x      = LpVariable.dicts("MineToRef",  [(p, r) for p in mines for r in refineries], lowBound=0)
    y      = LpVariable.dicts("RefToCust",  [(r, c) for r in refineries for c in customers], lowBound=0)
    open_r = LpVariable.dicts("Open", refineries, cat="Binary")

    # .get((p, r)/(r, c), 9999) -- same missing-pair sentinel convention as
    # solve_transport's dist.get((m, s), 9999): the base dataset's distance
    # matrix is complete, but an added refinery/customer with an incomplete
    # distanceOverrides set has no entry for that pair at all (L4: no
    # auto-haversine). Without a fallback the objective's lpSum would raise a
    # bare KeyError -- precheck.ts is the primary place this gets caught
    # before a solve is even attempted, but solve.py must not crash outright.
    prob += (lpSum(dist.get((p, r), 9999) * x[p, r] / TRUCKLOAD_KG for p in mines for r in refineries)
             + lpSum(dist.get((r, c), 9999) * y[r, c] / TRUCKLOAD_KG for r in refineries for c in customers))

    # C1 -- every customer's demand met exactly
    for c in customers:
        prob += LpConstraint(lpSum(y[r, c] for r in refineries),
                             LpConstraintEQ, f"demand_{c}", demands[c])

    # C2 -- exactly one refinery open, honouring forced_open / inactive
    # (own-record wins for an added refinery -- see get_ref_status above).
    for r in refineries:
        if get_ref_status(r) == "inactive":
            prob += LpConstraint(open_r[r], LpConstraintEQ, f"inactive_{r}", 0)
        elif get_ref_status(r) == "forced_open":
            prob += LpConstraint(open_r[r], LpConstraintEQ, f"forced_{r}", 1)
    prob += LpConstraint(lpSum(open_r[r] for r in refineries), LpConstraintEQ, "total_open", 1)

    # C3 -- big-M: no outflow from a closed refinery
    for r in refineries:
        prob += LpConstraint(lpSum(y[r, c] for c in customers) - total_demand * open_r[r],
                             LpConstraintLE, f"open_link_{r}", 0)

    # C4 -- BOM flow balance, summed over mines. The notebook constrains this
    # per (p,r) pair, which is correct only for a single mine; with two it
    # forces each mine to supply the full requirement independently, doubling
    # raw inflow with no error raised.
    for r in refineries:
        prob += LpConstraint(lpSum(x[p, r] for p in mines) - bom * lpSum(y[r, c] for c in customers),
                             LpConstraintEQ, f"bom_balance_{r}", 0)

    cbc = _run_cbc(prob, gap, time_limit, problem_uid="two_echelon")
    run_time   = time.time() - start
    status_str = cbc.lpStatus

    if status_str == "Infeasible":
        active = [r for r in refineries if get_ref_status(r) != "inactive"]
        forced = [r for r in refineries if get_ref_status(r) == "forced_open"]
        if not active:
            reason = ("Every refinery is marked inactive, but exactly one must be open to "
                      "refine gold. Re-activate at least one refinery.")
        elif len(forced) > 1:
            reason = (f"{len(forced)} refineries are forced open, but this model builds exactly "
                      "one. Force at most one open, or leave them all active.")
        else:
            reason = f"No feasible assignment for total demand of {total_demand:,.0f} kg."
        return _envelope("infeasible", status_str, 0, run_time, [],
                         _EMPTY_METRICS, {"openWarehouseIds": [], "assignments": []}, reason,
                         termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                         solver_incumbent_objective=cbc.solverIncumbentObjective,
                         solver_best_bound=cbc.solverBestBound)

    EPS = max(total_demand * 1e-9, 1e-6)          # relative, not absolute
    open_ids = [r for r in refineries if (open_r[r].varValue or 0) > 0.5]

    edges, assignments = [], []
    leg_dist_flow = {"mine_to_refinery": 0.0, "refinery_to_customer": 0.0}
    leg_flow      = {"mine_to_refinery": 0.0, "refinery_to_customer": 0.0}
    band_flow     = {b: 0.0 for b in distance_bands}
    band_overflow = 0.0

    def _band(d):
        """Returns None for distances past the last band rather than absorbing
        them into it -- the existing models' len(bands)-1 fallback silently
        misreports coverage on this dataset, whose longest leg is 2,544 km."""
        for i, b in enumerate(distance_bands):
            if d <= b:
                return i
        return None

    for p in mines:
        for r in refineries:
            f = x[p, r].varValue or 0
            if f <= EPS:
                continue
            d = dist.get((p, r), 9999)
            leg_dist_flow["mine_to_refinery"] += d * f
            leg_flow["mine_to_refinery"]      += f
            edges.append({"fromId": p, "toId": r, "flow": round(f), "distance": d,
                          "band": _band(d) if _band(d) is not None else len(distance_bands),
                          "leg": "mine_to_refinery"})

    for r in refineries:
        for c in customers:
            f = y[r, c].varValue or 0
            if f <= EPS:
                continue
            d  = dist.get((r, c), 9999)
            bi = _band(d)
            leg_dist_flow["refinery_to_customer"] += d * f
            leg_flow["refinery_to_customer"]      += f
            if bi is None:
                band_overflow += f
            else:
                for b in distance_bands:
                    if d <= b:
                        band_flow[b] += f
            edges.append({"fromId": r, "toId": c, "flow": round(f), "distance": d,
                          "band": bi if bi is not None else len(distance_bands),
                          "leg": "refinery_to_customer"})
            assignments.append({"customerId": c, "warehouseId": r, "distanceMi": d,
                                "band": bi if bi is not None else len(distance_bands),
                                "flowKg": round(f),
                                "flowFraction": round(f / demands[c], 4) if demands[c] else 0})

    def _avg(leg):
        return round(leg_dist_flow[leg] / leg_flow[leg], 1) if leg_flow[leg] > 0 else 0

    avg_by_leg = [{"leg": leg, "avgDistance": _avg(leg), "totalFlow": round(leg_flow[leg])}
                  for leg in ("mine_to_refinery", "refinery_to_customer")]

    total_flow = sum(leg_flow.values())
    blended = round(sum(leg_dist_flow.values()) / total_flow, 1) if total_flow else 0

    band_coverage = [{"band": b, "percent": round(band_flow[b] * 100 / total_demand)}
                     for b in distance_bands]
    if band_overflow > 0:
        band_coverage.append({"band": -1,
                              "percent": round(band_overflow * 100 / total_demand)})

    utilization = [{"warehouseId": r, "city": refinery_data[r]['city'],
                    "utilization": 100 if r in open_ids else 0} for r in refineries]

    return _envelope(cbc.solutionStatus, status_str, round(value(prob.objective) or 0, 2), run_time, edges,
                     {"utilizationByNode": utilization,
                      "bandCoverage": band_coverage,
                      "weightedAvgDistance": blended,
                      "avgDistanceByLeg": avg_by_leg},
                     {"openWarehouseIds": open_ids, "assignments": assignments,
                      "bomRatio": bom},
                     termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                     solver_incumbent_objective=cbc.solverIncumbentObjective,
                     solver_best_bound=cbc.solverBestBound)

# ---------------------------------------------------------------------------
# JADE Multi-Product Two-Echelon solver (Chapter 9)
# plant -> warehouse -> customer, single-source per customer across all
# products, plant-product capability (can-make) matrix. Faithful port of
# design spec §2 -- every scenario edit enters as a variable bound or
# coefficient change (hard rule 6), never a new if/else code path: P is the
# facility-count constraint's rhs, force open/close are facility[w]'s
# bounds, capability toggles are capability[p,k]'s value (0 / 210_000_000),
# customer exclusion drops a customer from the served/flow terms entirely,
# and added entities/distance overrides are just extra rows in the sets and
# distance maps (build_merged_jade_dataset).
# ---------------------------------------------------------------------------
def solve_jade(inp):
    if _LOAD_ERRORS.get("two-echelon-jade-us"):
        return _load_error_envelope("two-echelon-jade-us")

    p              = int(inp.get('p', 2))
    distance_bands = sorted(inp.get('distanceBands', [200, 400, 800, 1600]))
    gap            = float(inp.get('gap', 0.0))
    time_limit     = int(inp.get('timeLimitSec', 120))
    wh_statuses    = {ws['warehouseId']: ws['status'] for ws in inp.get('warehouseStatuses', [])}
    customer_demand_overrides = inp.get('customerDemands', {})

    product_ids = list(JADE_PRODUCTS.keys())

    # jade-T4: per-call, non-mutating merge of the base package with this
    # scenario's edits (addedPlants/addedWarehouses/addedCustomers,
    # distanceOverrides, capabilityOverrides, excludedCustomerIds) --
    # mirrors every prior build_merged_*_dataset wiring. Never mutates
    # JADE_PLANTS/JADE_WAREHOUSES/JADE_CUSTOMERS/JADE_CAPABILITY/
    # _jade_distances() module-level data. Empty inputs (the default)
    # produce a merged dataset equal to the base globals.
    merged = build_merged_jade_dataset(
        inp, JADE_PLANTS, JADE_WAREHOUSES, JADE_CUSTOMERS, JADE_CAPABILITY,
        product_ids, _jade_distances(),
    )
    plant_data = merged['plants']
    wh_data    = merged['warehouses']
    cust_data  = merged['customers']    # already excludes excludedCustomerIds (base + added alike)
    capability = merged['capability']
    dist       = merged['distance']
    added_warehouses_by_id = merged['addedWarehousesById']
    added_customers_by_id  = merged['addedCustomersById']

    plants     = list(plant_data.keys())
    warehouses = list(wh_data.keys())
    customers  = list(cust_data.keys())

    def get_bounds(w):
        added = added_warehouses_by_id.get(w)
        s = added['status'] if added is not None else wh_statuses.get(w, 'active')
        if s == 'forced_open': return (1, 1)
        if s == 'inactive':    return (0, 0)
        return (0, 1)

    def get_demands(c):
        # Added customer's own record wins (mirrors every prior model's
        # "own record wins over the sparse base-entity override map"
        # precedent); base customers layer a sparse per-product override
        # onto their base demands dict.
        added = added_customers_by_id.get(c)
        if added is not None:
            return added['demands']
        merged_demands = dict(cust_data[c]['demands'])
        override = customer_demand_overrides.get(c)
        if override:
            merged_demands.update(override)
        return merged_demands

    demands = {c: get_demands(c) for c in customers}
    total_demand = sum(sum(dk.values()) for dk in demands.values())

    def ic_cost(pl, w):
        return max(JADE_IC_RATE * dist.get((pl, w), 9999), JADE_IC_MIN)

    def ob_cost(w, c):
        return max(JADE_OB_RATE * dist.get((w, c), 9999), JADE_OB_MIN)

    start = time.time()
    prob = LpProblem("Jade", LpMinimize)

    flow_pw = LpVariable.dicts(
        "FlowPW", [(pl, w, k) for pl in plants for w in warehouses for k in product_ids], lowBound=0)
    flow_wc = LpVariable.dicts(
        "FlowWC", [(w, c, k) for w in warehouses for c in customers for k in product_ids], 0, 1, cat='Binary')
    facility_vars = LpVariable.dicts("Open", warehouses, cat='Binary')
    single_source = LpVariable.dicts("Src", [(w, c) for w in warehouses for c in customers], 0, 1, cat='Binary')

    prob += (lpSum(flow_pw[pl, w, k] * ic_cost(pl, w)
                   for pl in plants for w in warehouses for k in product_ids)
             + lpSum(flow_wc[w, c, k] * ob_cost(w, c) * demands[c].get(k, 0)
                     for w in warehouses for c in customers for k in product_ids))

    # C1 -- serve every (customer, product) with positive demand exactly once
    for c in customers:
        for k in product_ids:
            if demands[c].get(k, 0) > 0:
                prob += LpConstraint(lpSum(flow_wc[w, c, k] for w in warehouses),
                                     LpConstraintEQ, f"served_{c}_{k}", 1)

    # C2 -- flow conservation at warehouse per product, summed over PLANTS
    # (not written per (plant, warehouse, product) triple -- see
    # test_flow_balance_generalizes; a per-triple version would force EACH
    # capable plant to independently supply the full requirement).
    for w in warehouses:
        for k in product_ids:
            prob += LpConstraint(
                lpSum(flow_wc[w, c, k] * demands[c].get(k, 0) for c in customers)
                - lpSum(flow_pw[pl, w, k] for pl in plants),
                LpConstraintEQ, f"balance_{w}_{k}", 0)

    # C3 -- plant-product capability (can-make) capacity
    for pl in plants:
        for k in product_ids:
            prob += LpConstraint(
                lpSum(flow_pw[pl, w, k] for w in warehouses),
                LpConstraintLE, f"cap_{pl}_{k}", capability.get((pl, k), 0))

    # C4 -- open-if-used big-M
    for w in warehouses:
        prob += LpConstraint(
            lpSum(flow_wc[w, c, k] for c in customers for k in product_ids)
            - JADE_OPEN_BIG_M * facility_vars[w],
            LpConstraintLE, f"open_link_{w}", 0)

    # C5 -- exactly P open
    prob += LpConstraint(lpSum(facility_vars[w] for w in warehouses), LpConstraintEQ, "FacilityCount", p)

    # C6 -- force open/close bounds
    for w in warehouses:
        lb, ub = get_bounds(w)
        prob += LpConstraint(facility_vars[w], LpConstraintGE, f"lb_{w}", lb)
        prob += LpConstraint(facility_vars[w], LpConstraintLE, f"ub_{w}", ub)

    # C7 -- single-source tie: one warehouse per customer, across all products
    for w in warehouses:
        for c in customers:
            for k in product_ids:
                prob += LpConstraint(flow_wc[w, c, k] - single_source[w, c],
                                     LpConstraintLE, f"tie_{w}_{c}_{k}", 0)
    for c in customers:
        prob += LpConstraint(lpSum(single_source[w, c] for w in warehouses),
                             LpConstraintLE, f"onesrc_{c}", 1)

    cbc = _run_cbc(prob, gap, time_limit, problem_uid="jade")

    run_time   = time.time() - start
    status_str = cbc.lpStatus

    if status_str == "Infeasible":
        forced_open  = sum(1 for w in warehouses if get_bounds(w) == (1, 1))
        active_count = sum(1 for w in warehouses if get_bounds(w) != (0, 0))
        zero_capacity_products = [
            k for k in product_ids
            if sum(demands[c].get(k, 0) for c in customers) > 0
            and sum(capability.get((pl, k), 0) for pl in plants) <= 0
        ]
        if forced_open > p:
            reason = (f"Forced-open warehouses ({forced_open}) exceed p={p}. "
                      "Increase P or unforce some warehouses.")
        elif active_count < p:
            reason = (f"Only {active_count} active warehouses are available but P={p}. "
                      "Reactivate warehouses or lower P.")
        elif zero_capacity_products:
            reason = (f"No enabled plant can make {', '.join(zero_capacity_products)}, but customer "
                      "demand for it is positive. Enable at least one plant's capability for this product.")
        else:
            reason = (f"Model is infeasible with P={p}. Total demand is {total_demand:,.0f} tons; "
                      "check plant-product capability coverage and warehouse force/inactive bounds.")
        return _envelope("infeasible", status_str, 0, run_time, [], _EMPTY_METRICS, _EMPTY_DETAILS, reason,
                          termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                          solver_incumbent_objective=cbc.solverIncumbentObjective,
                          solver_best_bound=cbc.solverBestBound)

    open_ids = [w for w in warehouses if (facility_vars[w].varValue or 0) > 0.5]

    EPS = max(total_demand * 1e-9, 1e-6)  # relative, not absolute

    def _band_exclusive(d):
        """Each distance falls into exactly ONE bucket (exclusive, matching
        lib/bands.ts's semantics) -- -1 means "beyond the last band"
        (explicit overflow, never silently absorbed into the last band)."""
        for i, b in enumerate(distance_bands):
            if d <= b:
                return i
        return -1

    edges = []
    details_assignments = []
    leg_dist_flow = {"plant_to_warehouse": 0.0, "warehouse_to_customer": 0.0}
    leg_flow      = {"plant_to_warehouse": 0.0, "warehouse_to_customer": 0.0}
    band_flow     = {b: 0.0 for b in distance_bands}
    band_overflow = 0.0
    wh_demand_served = {w: 0.0 for w in open_ids}
    inbound_cost  = 0.0
    outbound_cost = 0.0

    # Inbound edges: one per positive (plant, warehouse, product) flow.
    for pl in plants:
        for w in warehouses:
            for k in product_ids:
                f = flow_pw[pl, w, k].varValue or 0
                if f <= EPS:
                    continue
                d = dist.get((pl, w), 9999)
                leg_dist_flow["plant_to_warehouse"] += d * f
                leg_flow["plant_to_warehouse"]      += f
                inbound_cost += f * ic_cost(pl, w)
                edges.append({
                    "fromId": pl, "toId": w, "flow": round(f), "distance": d,
                    "leg": "plant_to_warehouse", "productId": k,
                })

    # Outbound edges: one per customer, aggregated across products
    # (single-source guarantees exactly one serving warehouse per customer).
    for c in customers:
        served_by = None
        total_flow_c = 0.0
        dist_c = 0.0
        for w in warehouses:
            tons_c_w = sum((flow_wc[w, c, k].varValue or 0) * demands[c].get(k, 0) for k in product_ids)
            if tons_c_w <= EPS:
                continue
            served_by = w
            total_flow_c = tons_c_w
            dist_c = dist.get((w, c), 9999)
            for k in product_ids:
                if demands[c].get(k, 0) > 0 and (flow_wc[w, c, k].varValue or 0) > 0.5:
                    details_assignments.append({
                        "customerId": c, "warehouseId": w, "productId": k,
                        "flow": round(demands[c][k]), "distanceMi": dist_c,
                    })
            break
        if served_by is None:
            continue
        wh_demand_served[served_by] = wh_demand_served.get(served_by, 0.0) + total_flow_c
        leg_dist_flow["warehouse_to_customer"] += dist_c * total_flow_c
        leg_flow["warehouse_to_customer"]      += total_flow_c
        outbound_cost += total_flow_c * ob_cost(served_by, c)
        band_idx = _band_exclusive(dist_c)
        if band_idx == -1:
            band_overflow += total_flow_c
        else:
            band_flow[distance_bands[band_idx]] += total_flow_c
        edges.append({
            "fromId": served_by, "toId": c, "flow": round(total_flow_c), "distance": dist_c,
            "band": band_idx if band_idx != -1 else len(distance_bands),
            "leg": "warehouse_to_customer",
        })

    def _avg(leg):
        return round(leg_dist_flow[leg] / leg_flow[leg], 1) if leg_flow[leg] > 0 else 0

    avg_by_leg = [{"leg": leg, "avgDistance": _avg(leg), "totalFlow": round(leg_flow[leg])}
                  for leg in ("plant_to_warehouse", "warehouse_to_customer")]

    total_flow_both = sum(leg_flow.values())
    blended = round(sum(leg_dist_flow.values()) / total_flow_both, 1) if total_flow_both else 0

    band_coverage = []
    if total_demand > 0:
        band_coverage = [{"band": b, "percent": round(band_flow[b] * 100 / total_demand)}
                         for b in distance_bands]
        if band_overflow > 0:
            band_coverage.append({"band": -1, "percent": round(band_overflow * 100 / total_demand)})

    utilization = [{"warehouseId": w, "city": wh_data[w]['city'],
                    "utilization": round(wh_demand_served.get(w, 0.0))} for w in open_ids]

    return _envelope(
        cbc.solutionStatus, status_str, round(value(prob.objective) or 0, 4), run_time, edges,
        {
            "utilizationByNode": utilization,
            "bandCoverage": band_coverage,
            "weightedAvgDistance": blended,
            "avgDistanceByLeg": avg_by_leg,
            "openFacilityIds": open_ids,
            "totalDemand": round(total_demand),
            "inboundCost": round(inbound_cost, 2),
            "outboundCost": round(outbound_cost, 2),
        },
        {"openWarehouseIds": open_ids, "assignments": details_assignments},
        termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
        solver_incumbent_objective=cbc.solverIncumbentObjective,
        solver_best_bound=cbc.solverBestBound,
    )

# ---------------------------------------------------------------------------
# Chen's Cosmetics coverage solver (Chapter 4)
# China single-echelon warehouse -> customer service-level model with two
# coupled objectives behind one mode toggle (hard rule 6: ONE objective-sense
# branch, everything else is a coefficient/constraint change, not a code path):
#   coverage      -> MAXIMISE high-service-covered demand s.t. avg distance cap
#   min_distance  -> MINIMISE total demand-weighted distance s.t. coverage floor
# Distances are RAW km in DISTANCE_CHENS; circuity ×1.17 is applied here only
# (D8). Demand is the integer domain (D30) -- edge flow = integer demand,
# details.coveredDemand is an exact integer sum.
# ---------------------------------------------------------------------------
def solve_chens(inp):
    # Dataset load-failure containment (H4): a corrupt/missing Chen dataset is
    # captured in _LOAD_ERRORS at import time, never crashing other models.
    if "chens-cosmetics-cn" in _LOAD_ERRORS:
        return _load_error_envelope("chens-cosmetics-cn")
    from pulp import (LpProblem, LpMaximize, LpMinimize, LpVariable, lpSum,
                      LpInteger, LpStatus, value, PULP_CBC_CMD)
    t = time.time()
    m = build_merged_chens_dataset(inp, WAREHOUSES_CHENS, CUSTOMERS_CHENS, DISTANCE_CHENS)
    cand = [wid for wid in m["warehouses"] if wid not in m["inactive"]]
    custs = [cid for cid in m["customers"] if cid not in m["excluded"]]
    dem = {cid: m["customers"][cid]["demand"] for cid in custs}
    total = sum(dem.values())
    hi, mx, p = inp["highServiceDistKm"], inp["maxDistKm"], inp["p"]
    if total <= 0:
        # No CBC evidence exists -- this is a pure pre-solve, data-derived
        # infeasibility (zero effective demand), detected before any solve
        # is attempted. termination_reason mirrors the solution_status
        # literal rather than fabricating CBC log evidence never produced.
        return _envelope("infeasible", "infeasible", 0, round(time.time() - t, 2), [],
                         _EMPTY_METRICS, _EMPTY_DETAILS, "Total effective demand is zero",
                         termination_reason="infeasible")
    # ×1.17 circuity applied in-solver only. .get((w,c), 9999) sentinel matches
    # every other model's missing-pair convention: an added entity with no
    # distanceOverrides/estimate to some counterpart is simply unreachable
    # (adj 9999 km fails both hi and mx thresholds), never a KeyError crash --
    # the "solver never throws" contract. Numerically identical to a direct
    # index for the base dataset (all 4925 pairs present).
    adj = {(w, c): m["distance"].get((w, c), 9999) * 1.17 for w in cand for c in custs}
    hsp = {k: (1 if v <= hi else 0) for k, v in adj.items()}
    mdp = {k: (1 if v <= mx else 0) for k, v in adj.items()}
    mode = inp["objective"]
    prob = LpProblem("chens", LpMaximize if mode == "coverage" else LpMinimize)
    a = LpVariable.dicts("A", [(w, c) for w in cand for c in custs], 0, 1, LpInteger)
    o = LpVariable.dicts("O", cand, 0, 1, LpInteger)
    if mode == "coverage":
        prob += lpSum(hsp[w, c] * dem[c] * a[w, c] for w in cand for c in custs)
        prob += lpSum(adj[w, c] * dem[c] * a[w, c] for w in cand for c in custs) <= inp["avgServiceDistCapKm"] * total
    else:
        prob += lpSum(adj[w, c] * dem[c] * a[w, c] for w in cand for c in custs)
        prob += lpSum(hsp[w, c] * dem[c] * a[w, c] for w in cand for c in custs) >= inp["coverageFloorDemand"]
    for c in custs:
        prob += lpSum(a[w, c] for w in cand) == 1
    prob += lpSum(o[w] for w in cand) == p
    for w in cand:
        if w in m["forced"]:
            prob += o[w] == 1
        for c in custs:
            prob += a[w, c] <= o[w]
            prob += a[w, c] <= mdp[w, c]
    cbc = _run_cbc(prob, inp["gap"], inp["timeLimitSec"], problem_uid="chens", msg=0)
    st = cbc.lpStatus
    if st == "Infeasible":                                            # D17: mathematical infeasibility ONLY
        return _envelope("infeasible", "infeasible", 0, round(time.time() - t, 2), [],
                         _EMPTY_METRICS, _EMPTY_DETAILS, "No feasible assignment under the constraints",
                         termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                         solver_incumbent_objective=cbc.solverIncumbentObjective,
                         solver_best_bound=cbc.solverBestBound)
    if st != "Optimal":                                              # Not Solved / Undefined / Unbounded / timeout → error
        env = _envelope("error", "error", 0, round(time.time() - t, 2), [],
                         _EMPTY_METRICS, _EMPTY_DETAILS, f"Solver terminated with status: {st}",
                         termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                         solver_incumbent_objective=cbc.solverIncumbentObjective,
                         solver_best_bound=cbc.solverBestBound)
        # A CBC status we have no actionable branch for is the solver's own
        # outcome, not a Python-side plumbing bug -- classified as
        # solver_error, distinct from the internal_error stages above.
        env["_failureReason"] = "solver_error"
        env["_failureStage"] = "cbc_parse"
        return env
    edges = []
    covered = 0.0
    tdd = 0.0
    for w in cand:
        for c in custs:
            v = a[w, c].varValue
            if v and v > 0.5:
                d = adj[w, c]
                edges.append({"fromId": w, "toId": c, "distance": round(d, 2), "flow": dem[c]})
                tdd += dem[c] * d
                if hsp[w, c]:
                    covered += dem[c]
    open_ids = sorted(w for w in cand if o[w].varValue and o[w].varValue > 0.5)
    cov = round(covered * 100 / total, 4)                            # D22: coveragePct 4-dp
    avg = round(tdd / total, 2)                                      # D22: avg 2-dp
    metrics = {"openFacilityIds": open_ids, "weightedAvgDistance": avg, "utilizationByNode": [],
               "bandCoverage": [{"band": hi, "percent": cov}, {"band": mx, "percent": 100.0}]}
    details = {"objective": mode, "p": p, "highServiceDistKm": hi, "maxDistKm": mx,
               "avgServiceDistCapKm": inp.get("avgServiceDistCapKm"), "coverageFloorDemand": inp.get("coverageFloorDemand"),
               "openWarehouseIds": open_ids, "coveragePct": cov, "coveredDemand": int(covered),
               "uncoveredPct": round(100 - cov, 4), "assignments": []}
    obj = cov if mode == "coverage" else round(value(prob.objective), 2)   # D22: min-dist objective 2-dp
    return _envelope(cbc.solutionStatus, st, obj, round(time.time() - t, 2), edges, metrics, details,
                      termination_reason=cbc.terminationReason, achieved_gap=cbc.achievedGap,
                      solver_incumbent_objective=cbc.solverIncumbentObjective,
                      solver_best_bound=cbc.solverBestBound)

# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------
def solve(inp):
    model_type = inp.get('modelType', 'p_median')
    if model_type == 'transport':
        return solve_transport(inp)
    if model_type == 'capacitated_pmedian':
        return solve_capacitated_pmedian(inp)
    if model_type == 'two_echelon':
        return solve_two_echelon(inp)
    if model_type == 'two_echelon_jade':
        return solve_jade(inp)
    if model_type == 'chens':
        return solve_chens(inp)
    if model_type == 'p_median':
        return solve_pmedian(inp)
    env = _envelope("error", "error", 0, 0, [], _EMPTY_METRICS, _EMPTY_DETAILS,
                     f"Unknown modelType: {model_type}")
    env["_failureStage"] = "dispatch"
    return env


# ---------------------------------------------------------------------------
# A3 -- process entrypoint. `solve()`/`solve_*()` are UNCHANGED pure Python
# functions (hard rules #2/#6: zero solver-math changes) that still return an
# envelope dict, including the pre-existing status="error" shape for a
# dataset-load/dispatch failure -- direct Python callers (pytest) see exactly
# what they always have. It is ONLY this process boundary that changed: a
# status="error" envelope is no longer forwarded as if it were a real
# success -- it is translated into a fd3 FAILURE message instead, so
# jobRunner.ts can never cache or publish it (the live bug this task fixes).
# `_failureStage` is a private marker `_load_error_envelope()`/the dispatch-
# error/two-echelon-load-error branches set above; it is read here and
# never forwarded itself (stripped implicitly -- `_failure()` builds a fresh
# message, it doesn't pass the envelope dict through).
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    try:
        inp = json.loads(sys.stdin.read())
    except Exception:
        _write_process_message(_failure("internal_error", "input_parse"))
        sys.exit(0)

    try:
        result = solve(inp)
    except Exception:
        # Any unhandled exception from solve()/solve_*() (including a
        # CBCParseError bubbling up from cbc_termination.py) -- never forward
        # the raw exception text, only a fixed, safe classification.
        _write_process_message(_failure("internal_error", "solve_exception"))
        sys.exit(0)

    if result.get("status") == "error":
        reason = result.get("_failureReason", "internal_error")
        stage = result.get("_failureStage", "dispatch")
        _write_process_message(_failure(reason, stage))
    else:
        _write_process_message(result)
