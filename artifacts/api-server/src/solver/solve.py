#!/usr/bin/env python3
"""P-Median, Transportation LP, and Capacitated P-Median solvers.
Reads JSON from stdin, writes JSON to stdout."""
import sys, json, time, math, os
from pulp import (LpProblem, LpMinimize, LpVariable, lpSum,
                  LpConstraint, LpConstraintEQ, LpConstraintLE, LpConstraintGE,
                  LpStatus, value, PULP_CBC_CMD)

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
# Standardized result envelope (Phase 3.5, G2.1). `details` deliberately
# retains the pre-envelope `assignments`/`openWarehouseIds` shape verbatim
# (not just the new generic `edges` view) — a pure refactor of where each
# already-computed value lives, not a re-derivation, so no numeric value
# changes. `edges` is the new model-agnostic view Phase 4/5 render from.
# ---------------------------------------------------------------------------
def _envelope(status, quality, objective, run_time, edges, metrics, details, infeasibility_reason=None):
    return {
        "status": status,
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
    IO/JSON failure message instead of a bare traceback."""
    return _envelope(
        "error", "error", 0, run_time, [],
        {"utilizationByNode": [], "bandCoverage": [], "weightedAvgDistance": 0},
        {"openWarehouseIds": [], "assignments": []},
        _LOAD_ERRORS.get(model_id, f"Unknown load error for {model_id}"),
    )

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

    warehouses = list(WAREHOUSES.keys())
    customers_list = [k for k in CUSTOMERS.keys() if CUSTOMERS[k]['id'] not in excluded_ids]

    def get_bounds(wid):
        sid = WAREHOUSES[wid]['id']
        s = wh_statuses.get(sid, 'potential')
        if s == 'forced_open': return (1, 1)
        if s == 'inactive':    return (0, 0)
        return (0, 1)

    def get_capacity(wid):
        sid = WAREHOUSES[wid]['id']
        if sid in warehouse_capacities:
            return warehouse_capacities[sid]
        return uniform_capacity

    def get_demand(c):
        cid = CUSTOMERS[c]['id']
        return customer_demands.get(cid, CUSTOMERS[c]['demand'])

    start = time.time()

    prob = LpProblem("PMedian", LpMinimize)

    assign_vars   = LpVariable.dicts("A",    [(w, c) for w in warehouses for c in customers_list], 0, 1, cat='Binary')
    facility_vars = LpVariable.dicts("Open", warehouses, 0, 1, cat='Binary')

    prob += lpSum(get_demand(c) * DISTANCE.get((w, c), 9999) * assign_vars[w, c]
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

    solver = PULP_CBC_CMD(keepFiles=False, gapRel=gap, timeLimit=time_limit, msg=False)
    prob.solve(solver)

    run_time = time.time() - start
    status_str = LpStatus[prob.status]

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
                          {"openWarehouseIds": [], "assignments": []}, reason)

    open_wh_nums = [w for w in warehouses if (facility_vars[w].varValue or 0) > 0.5]
    open_wh_ids  = [WAREHOUSES[w]['id'] for w in open_wh_nums]

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
            assigned_w = min(open_wh_nums, key=lambda w: DISTANCE.get((w, c), 9999))

        dist   = DISTANCE.get((assigned_w, c), 0)
        demand = get_demand(c)
        wh_demand[assigned_w] += demand
        total_demand_assigned += demand
        band_idx = next((i for i, b in enumerate(distance_bands) if dist <= b), len(distance_bands) - 1)
        wh_id, c_id = WAREHOUSES[assigned_w]['id'], f"C{c}"
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
        utilization.append({"warehouseId": WAREHOUSES[w]['id'], "city": WAREHOUSES[w]['city'],
                             "utilization": min(100, round(wh_demand[w] * 100 / cap_for_util))})

    return _envelope("optimal", status_str, round(obj_val), run_time, edges,
                      {"utilizationByNode": utilization, "bandCoverage": band_coverage, "weightedAvgDistance": round(wt_avg, 1)},
                      {"openWarehouseIds": open_wh_ids, "assignments": assignments})

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

    def effective_demand(s):
        return station_demands.get(s, POWER_STATIONS[s]['demand'])

    mines    = list(COAL_MINES.keys())
    stations = list(POWER_STATIONS.keys())
    dist     = _transport_distances()
    total_demand = sum(effective_demand(s) for s in stations)

    start = time.time()
    prob  = LpProblem("TransportLP", LpMinimize)

    flow = LpVariable.dicts("Flow", [(m, s) for m in mines for s in stations], lowBound=0)

    if single_source:
        source = LpVariable.dicts("Src", [(m, s) for m in mines for s in stations], 0, 1, cat='Binary')

    prob += lpSum(dist[m, s] * flow[m, s] for m in mines for s in stations)

    for s in stations:
        prob += LpConstraint(
            lpSum(flow[m, s] for m in mines),
            LpConstraintEQ, f"demand_{s}", effective_demand(s))

    if not capacity_inactive:
        for m in mines:
            base_cap = mine_caps.get(m, COAL_MINES[m]['capacity'])
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

    solver = PULP_CBC_CMD(keepFiles=False, gapRel=gap, timeLimit=time_limit, msg=False)
    prob.solve(solver)

    run_time   = time.time() - start
    status_str = LpStatus[prob.status]

    if status_str == "Infeasible":
        if single_source and not capacity_inactive:
            reason = (
                "Infeasible with single-source + capacity constraints active. "
                f"Each station must be served by exactly one mine, but total mine capacity "
                f"({sum(int(COAL_MINES[m]['capacity']*capacity_factor) for m in mines):,} tons) "
                f"cannot cover all demand ({total_demand:,} tons) under these restrictions. "
                "This is the pedagogical point of exercise part (c). "
                "Fix: (a) disable single-source, (b) increase capacityFactor, or (c) set capacityInactive=true."
            )
        else:
            reason = (
                f"Total mine capacity ({sum(int(COAL_MINES[m]['capacity']*capacity_factor) for m in mines):,} tons) "
                f"is less than total station demand ({total_demand:,} tons). "
                "Increase capacityFactor or set capacityInactive=true."
            )
        return _envelope("infeasible", status_str, 0, run_time, [],
                          {"utilizationByNode": [], "bandCoverage": [], "weightedAvgDistance": 0},
                          {"openWarehouseIds": list(COAL_MINES.keys()), "assignments": []}, reason)

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
            d = dist[m, s]
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

    utilization = [{
        "warehouseId": m,
        "city": COAL_MINES[m]['city'],
        "utilization": min(100, round(mine_outflow[m] * 100 / (COAL_MINES[m]['capacity'] * capacity_factor)))
        if not capacity_inactive else round(mine_outflow[m] * 100 / COAL_MINES[m]['capacity'])
    } for m in mines]

    return _envelope("optimal", status_str, round(obj_val), run_time, edges,
                      {"utilizationByNode": utilization, "bandCoverage": band_coverage, "weightedAvgDistance": round(avg_dist, 1)},
                      {"openWarehouseIds": mines, "assignments": assignments})

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

    warehouses = list(BRAZIL_WAREHOUSES.keys())
    regions    = list(BRAZIL_REGIONS.keys())
    dist       = _brazil_distances()     # in miles

    # Pre-check: if single-source and any region exceeds capacity, report infeasibility
    # immediately without running the solver (faster feedback, clearer message).
    if single_source:
        over_cap = [(rid, BRAZIL_REGIONS[rid]['name'], BRAZIL_REGIONS[rid]['demand'])
                    for rid in regions if BRAZIL_REGIONS[rid]['demand'] > wh_cap]
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
            )

    start = time.time()
    prob  = LpProblem("CapPMedian", LpMinimize)

    # assign_vars: binary when single_source, continuous otherwise
    cat = 'Binary' if single_source else 'Continuous'
    assign_vars   = LpVariable.dicts("A",    [(w, r) for w in warehouses for r in regions], 0, 1, cat=cat)
    facility_vars = LpVariable.dicts("Open", warehouses, 0, 1, cat='Binary')

    # Objective: minimise sum of distance * demand * assignment_fraction
    prob += lpSum(dist[w, r] * BRAZIL_REGIONS[r]['demand'] * assign_vars[w, r]
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

    # C3: capacity per open warehouse
    for w in warehouses:
        prob += LpConstraint(
            lpSum(BRAZIL_REGIONS[r]['demand'] * assign_vars[w, r] for r in regions)
            - wh_cap * facility_vars[w],
            LpConstraintLE, f"cap_{w}", 0)

    # C4: can only assign to an open warehouse
    for w in warehouses:
        for r in regions:
            prob += LpConstraint(
                assign_vars[w, r] - facility_vars[w],
                LpConstraintLE, f"route_{w}_{r}", 0)

    solver = PULP_CBC_CMD(keepFiles=False, gapRel=gap, timeLimit=time_limit, msg=False)
    prob.solve(solver)

    run_time   = time.time() - start
    status_str = LpStatus[prob.status]

    if status_str not in ("Optimal", "Not Solved"):
        # Generic infeasibility fallback
        reason = (
            f"Model is infeasible with P={p}, capacity={wh_cap:,}. "
            f"Total required capacity with P warehouses = {p * wh_cap:,} vs "
            f"total demand = {BRAZIL_TOTAL_DEMAND:,}. "
            "Try increasing P, raising warehouse capacity, or disabling single-sourcing."
        )
        return _envelope("infeasible", status_str, 0, run_time, [],
                          {"utilizationByNode": [], "bandCoverage": [], "weightedAvgDistance": 0},
                          {"openWarehouseIds": [], "assignments": []}, reason)

    open_wh_ids = [w for w in warehouses if (facility_vars[w].varValue or 0) > 0.5]

    assignments = []
    edges = []
    wh_demand   = {w: 0.0 for w in open_wh_ids}
    band_demand  = {b: 0.0 for b in distance_bands}
    obj_val      = value(prob.objective) or 0

    for r in regions:
        rd = BRAZIL_REGIONS[r]['demand']
        for w in open_wh_ids:
            frac = assign_vars[w, r].varValue or 0
            if frac < 1e-6:
                continue
            d = dist[w, r]
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

    wt_avg = obj_val / BRAZIL_TOTAL_DEMAND if BRAZIL_TOTAL_DEMAND > 0 else 0
    band_coverage = [
        {"band": b, "percent": round(band_demand[b] * 100 / BRAZIL_TOTAL_DEMAND)}
        for b in distance_bands
    ]
    utilization = [
        {
            "warehouseId": w,
            "city": BRAZIL_WAREHOUSES[w]['city'],
            "utilization": min(100, round(wh_demand[w] * 100 / wh_cap)),
        }
        for w in open_wh_ids
    ]

    return _envelope("optimal", status_str, round(obj_val), run_time, edges,
                      {"utilizationByNode": utilization, "bandCoverage": band_coverage, "weightedAvgDistance": round(wt_avg, 1)},
                      {"openWarehouseIds": open_wh_ids, "assignments": assignments})

# ---------------------------------------------------------------------------
# Two-Echelon Gold Refinery solver (Chapter 10)
# mine -> refinery -> customer, exactly one of two candidate refineries opens.
# ---------------------------------------------------------------------------
def solve_two_echelon(inp):
    if _LOAD_ERRORS.get("two-echelon-gold-au"):
        return _envelope("error", "error", 0, 0, [], _EMPTY_METRICS, _EMPTY_DETAILS,
                         f"Dataset load failed: {_LOAD_ERRORS['two-echelon-gold-au']}")

    bom            = float(inp.get('bomRatio', 1.1))
    distance_bands = sorted(inp.get('distanceBands', [500, 1000, 1500, 2000, 2600]))
    gap            = float(inp.get('gap', 0.0))
    time_limit     = int(inp.get('timeLimitSec', 120))
    ref_status     = {o['refineryId']: o['status'] for o in inp.get('refineryStatuses', [])}
    excluded       = set(inp.get('excludedCustomerIds', []))
    demand_over    = inp.get('customerDemands', {})

    mines      = list(GOLD_MINES.keys())
    refineries = list(GOLD_REFINERIES.keys())
    customers  = [c for c in GOLD_CUSTOMERS if c not in excluded]
    dist       = _gold_distances()
    demands    = {c: float(demand_over.get(c, GOLD_CUSTOMERS[c]['demand'])) for c in customers}
    total_demand = sum(demands.values())

    start = time.time()
    prob  = LpProblem("TwoEchelonGold", LpMinimize)

    x      = LpVariable.dicts("MineToRef",  [(p, r) for p in mines for r in refineries], lowBound=0)
    y      = LpVariable.dicts("RefToCust",  [(r, c) for r in refineries for c in customers], lowBound=0)
    open_r = LpVariable.dicts("Open", refineries, cat="Binary")

    prob += (lpSum(dist[p, r] * x[p, r] / TRUCKLOAD_KG for p in mines for r in refineries)
             + lpSum(dist[r, c] * y[r, c] / TRUCKLOAD_KG for r in refineries for c in customers))

    # C1 -- every customer's demand met exactly
    for c in customers:
        prob += LpConstraint(lpSum(y[r, c] for r in refineries),
                             LpConstraintEQ, f"demand_{c}", demands[c])

    # C2 -- exactly one refinery open, honouring forced_open / inactive
    for r in refineries:
        if ref_status.get(r) == "inactive":
            prob += LpConstraint(open_r[r], LpConstraintEQ, f"inactive_{r}", 0)
        elif ref_status.get(r) == "forced_open":
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

    prob.solve(PULP_CBC_CMD(keepFiles=False, gapRel=gap, timeLimit=time_limit, msg=False))
    run_time   = time.time() - start
    status_str = LpStatus[prob.status]

    if status_str == "Infeasible":
        active = [r for r in refineries if ref_status.get(r) != "inactive"]
        forced = [r for r in refineries if ref_status.get(r) == "forced_open"]
        if not active:
            reason = ("Every refinery is marked inactive, but exactly one must be open to "
                      "refine gold. Re-activate at least one refinery.")
        elif len(forced) > 1:
            reason = (f"{len(forced)} refineries are forced open, but this model builds exactly "
                      "one. Force at most one open, or leave them all active.")
        else:
            reason = f"No feasible assignment for total demand of {total_demand:,.0f} kg."
        return _envelope("infeasible", status_str, 0, run_time, [],
                         _EMPTY_METRICS, {"openWarehouseIds": [], "assignments": []}, reason)

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
            d = dist[p, r]
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
            d  = dist[r, c]
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

    utilization = [{"warehouseId": r, "city": GOLD_REFINERIES[r]['city'],
                    "utilization": 100 if r in open_ids else 0} for r in refineries]

    return _envelope("optimal", status_str, round(value(prob.objective) or 0, 2), run_time, edges,
                     {"utilizationByNode": utilization,
                      "bandCoverage": band_coverage,
                      "weightedAvgDistance": blended,
                      "avgDistanceByLeg": avg_by_leg},
                     {"openWarehouseIds": open_ids, "assignments": assignments,
                      "bomRatio": bom})

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
    return solve_pmedian(inp)

if __name__ == "__main__":
    inp = json.loads(sys.stdin.read())
    try:
        result = solve(inp)
    except Exception as e:
        result = _envelope("error", "error", 0, 0, [],
                            {"utilizationByNode": [], "bandCoverage": [], "weightedAvgDistance": 0},
                            {"openWarehouseIds": [], "assignments": []}, str(e))
    print(json.dumps(result))
