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
# Dataset: Al's Athletics — P-Median (26 warehouses, 200 customers)
# Source: Watson et al. "Supply Chain Network Design" Ch.5 Exercise 5 notebook
# solvers/p-median-us/dataset/
# ---------------------------------------------------------------------------
_WH_DATA  = _load_json("p-median-us", "warehouses.json")
_CU_DATA  = _load_json("p-median-us", "customers.json")
_DIST_RAW = _load_json("p-median-us", "distances.json")

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
COAL_MINES      = _load_json("transport-coal", "mines.json")
POWER_STATIONS  = _load_json("transport-coal", "stations.json")
_TRANSPORT_COSTS_RAW = _load_json("transport-coal", "costs.json")

# ---------------------------------------------------------------------------
# Dataset: Brazil Facility Location (Chapter 5 Capacitated P-Median)
# Source: Watson et al. "Supply Chain Network Design" Ch.5 Exercise 6 notebook
# 25 candidate warehouse cities, 25 demand regions (states)
# solvers/p-median-brazil/dataset/
# ---------------------------------------------------------------------------
BRAZIL_WAREHOUSES   = _load_json("p-median-brazil", "warehouses.json")
BRAZIL_REGIONS      = _load_json("p-median-brazil", "states.json")
_BRAZIL_DIST_RAW    = _load_json("p-median-brazil", "distances.json")
BRAZIL_TOTAL_DEMAND = sum(r["demand"] for r in BRAZIL_REGIONS.values())

def _transport_distances():
    """Mine→station distances in miles, precomputed at extraction time
    (haversine × circuity — see scripts/extract-datasets.py)."""
    return {tuple(k.split(',')): v for k, v in _TRANSPORT_COSTS_RAW.items()}

def _brazil_distances():
    """Warehouse→region distances in miles, precomputed at extraction time
    (haversine × circuity — see scripts/extract-datasets.py)."""
    return {tuple(k.split(',')): v for k, v in _BRAZIL_DIST_RAW.items()}

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

# ---------------------------------------------------------------------------
# P-Median solver (Chapter 3)
# ---------------------------------------------------------------------------
def solve_pmedian(inp):
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
    capacity_factor   = float(inp.get('capacityFactor', 1.0))
    single_source     = bool(inp.get('singleSource', False))
    capacity_inactive = bool(inp.get('capacityInactive', False))
    distance_bands    = sorted(inp.get('distanceBands', [500, 1000, 1500, 2000]))
    gap               = float(inp.get('gap', 0.0))
    time_limit        = int(inp.get('timeLimitSec', 120))
    mine_caps         = inp.get('mineCapacities', {})

    mines    = list(COAL_MINES.keys())
    stations = list(POWER_STATIONS.keys())
    dist     = _transport_distances()
    total_demand = sum(s['demand'] for s in POWER_STATIONS.values())

    start = time.time()
    prob  = LpProblem("TransportLP", LpMinimize)

    flow = LpVariable.dicts("Flow", [(m, s) for m in mines for s in stations], lowBound=0)

    if single_source:
        source = LpVariable.dicts("Src", [(m, s) for m in mines for s in stations], 0, 1, cat='Binary')

    prob += lpSum(dist[m, s] * flow[m, s] for m in mines for s in stations)

    for s in stations:
        prob += LpConstraint(
            lpSum(flow[m, s] for m in mines),
            LpConstraintEQ, f"demand_{s}", POWER_STATIONS[s]['demand'])

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
                    flow[m, s] - POWER_STATIONS[s]['demand'] * source[m, s],
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
                "flowFraction": round(flow_val / POWER_STATIONS[s]['demand'], 4)
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
# Dispatcher
# ---------------------------------------------------------------------------
def solve(inp):
    model_type = inp.get('modelType', 'p_median')
    if model_type == 'transport':
        return solve_transport(inp)
    if model_type == 'capacitated_pmedian':
        return solve_capacitated_pmedian(inp)
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
