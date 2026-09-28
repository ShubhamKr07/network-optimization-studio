"""Chapter 5 (modified) - Delivery Company Teaching Example.

Goldens are measured, not predicted: the design-time prototype at
docs/superpowers/specs/assets/2026-09-28-cog-prototype-solve.py solved this
exact formulation against the source workbook with PuLP/CBC. It shares no code
with solve.py, which is what makes it an independent oracle rather than a
restatement.
"""
import sys
from pathlib import Path

import pytest

# No conftest.py exists anywhere in this repo; every solver test bootstraps
# its own import path exactly like this (tests/test_max_coverage.py:22-24).
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))

from merge_inputs import UnresolvableIdError  # noqa: E402
from solve import (  # noqa: E402
    solve_delivery,
    _effective_delivery_costs,
    _build_delivery_problem,
    _assign_band_or_overflow,
    DELIV_DISTANCES,
    DELIV_COSTS,
)

BASE = {
    "modelType": "delivery",
    "pValue": 3,
    "distanceBands": [400, 800, 1200, 1600],
    "gap": 0,
    "timeLimitSec": 300,
    "laneCostOverrides": [],
    "costAdjustEnabled": False,
    "distanceThreshold": 800,
    "costPerMile": 1,
    "costPerMileOver": 10,
}


def adjusted(**over):
    return {**BASE, "costAdjustEnabled": True, **over}


def bands_of(env):
    return {row["band"]: row["percent"] for row in env["metrics"]["bandCoverage"]}


def test_scenario_1_golden():
    env = solve_delivery(dict(BASE))
    assert env["solutionStatus"] == "optimal"
    assert env["objective"] == pytest.approx(88240913478.10, rel=1e-9)
    assert set(env["details"]["openWarehouseIds"]) == {"W1", "W2", "W60"}
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(422.5511, abs=5e-4)
    b = bands_of(env)
    assert b[400] == pytest.approx(59.38, abs=5e-3)
    assert b[800] == pytest.approx(81.45, abs=5e-3)
    assert b[1200] == pytest.approx(99.44, abs=5e-3)
    assert b[1600] == pytest.approx(100.00, abs=5e-3)


def test_scenario_2_golden():
    env = solve_delivery(adjusted())
    assert env["solutionStatus"] == "optimal"
    assert env["objective"] == pytest.approx(150194534098.60, rel=1e-9)
    assert set(env["details"]["openWarehouseIds"]) == {"W6", "W43", "W45"}
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(508.6534, abs=5e-4)
    b = bands_of(env)
    assert b[400] == pytest.approx(26.43, abs=5e-3)
    assert b[800] == pytest.approx(97.19, abs=5e-3)
    assert b[1200] == pytest.approx(100.00, abs=5e-3)
    assert b[1600] == pytest.approx(100.00, abs=5e-3)


def test_avg_distance_not_derived_from_objective():
    """The bug class this repo has already shipped twice (Ch9, Ch10).

    With the adjustment ON the objective is in dollars, so objective/demand is
    dollars-per-unit. If weightedAvgDistance were derived that way it would be
    a plausible number under a distance label - no exception, no failing
    assertion. 508.6534 mi vs 719.2... $/unit are far enough apart that this
    assertion cannot pass by coincidence.
    """
    env = solve_delivery(adjusted())
    total_demand = 208829000
    derived = env["objective"] / total_demand
    assert env["metrics"]["weightedAvgDistance"] == pytest.approx(508.6534, abs=5e-4)
    assert abs(env["metrics"]["weightedAvgDistance"] - derived) > 1.0


def test_toggle_off_equals_unit_rate():
    """"Off" IS the case study's Scenario 1 ($1/mile), because costs are
    seeded equal to distances. Nothing special-cases it."""
    off = solve_delivery(dict(BASE))
    unit = solve_delivery(adjusted(costPerMile=1, costPerMileOver=1))
    assert off["objective"] == pytest.approx(unit["objective"], rel=1e-9)


def test_facility_count_is_at_most_p():
    """Decision 8. Asserted against the BUILT PuLP problem, never source text."""
    import pulp
    ec = _effective_delivery_costs(DELIV_COSTS, DELIV_DISTANCES, BASE)
    prob, _y, o = _build_delivery_problem(ec, p=3)
    named = {c.name: c for c in prob.constraints.values()}
    assert "FacilityCount" in named
    assert named["FacilityCount"].sense == pulp.LpConstraintLE
    env = solve_delivery(dict(BASE))
    assert len(env["details"]["openWarehouseIds"]) <= 3


def test_threshold_boundary_is_inclusive():
    """Decision 7. Synthetic by necessity - zero real lanes measure exactly 800."""
    dist = {("W1", "C1"): 800.0, ("W1", "C2"): 800.0001}
    cost = {("W1", "C1"): 800.0, ("W1", "C2"): 800.0001}
    ec = _effective_delivery_costs(cost, dist, adjusted())
    assert ec[("W1", "C1")] == pytest.approx(800.0 * 1)
    assert ec[("W1", "C2")] == pytest.approx(800.0001 * 10)


def test_cost_override_does_not_move_distance_metrics():
    """The section 5.4 invariant, with the precondition FORCED.

    A large enough override legitimately changes the optimum and therefore
    legitimately moves WAD. This case picks a lane already in the base
    solution and lowers its cost. Lowering the cost of a lane the optimum
    already uses cannot make any other solution strictly better than it,
    so the open set and assignment are unchanged; that equality is asserted
    before the metrics are compared.

    The lane must have a POSITIVE base cost: 33 customers are co-located
    with a plant (C1/W1 = Los Angeles, distance 0), and assignments[0] IS
    one of them - overriding a zero to zero changes nothing and the strict
    objective decrease below would fail for no real reason.
    """
    base = solve_delivery(dict(BASE))
    lane = next(a for a in base["details"]["assignments"] if a["distanceMi"] > 0)
    demand = _customers()[lane["customerId"]]["demand"]
    base_cost = DELIV_COSTS[(lane["warehouseId"], lane["customerId"])]
    over = solve_delivery({**BASE, "laneCostOverrides": [
        {"fromId": lane["warehouseId"], "toId": lane["customerId"], "cost": 0.0}]})
    assert set(over["details"]["openWarehouseIds"]) == set(base["details"]["openWarehouseIds"])
    assert _assignment_map(over) == _assignment_map(base)
    # Exactly the removed cost x demand, not merely "less".
    assert over["objective"] == pytest.approx(base["objective"] - base_cost * demand, abs=0.02)
    assert over["metrics"]["weightedAvgDistance"] == pytest.approx(
        base["metrics"]["weightedAvgDistance"], abs=1e-9)
    assert over["metrics"]["bandCoverage"] == base["metrics"]["bandCoverage"]


def test_cost_override_large_enough_does_move_the_assignment():
    """The other side. A cost change that reroutes demand SHOULD move WAD;
    a test that only ever proves invariance would pass against a solver that
    ignored overrides entirely."""
    base = solve_delivery(dict(BASE))
    huge = [{"fromId": a["warehouseId"], "toId": a["customerId"], "cost": 1e7}
            for a in base["details"]["assignments"][:40]]
    over = solve_delivery({**BASE, "laneCostOverrides": huge})
    assert _assignment_map(over) != _assignment_map(base)


def test_edges_carry_distance_not_cost():
    """ServiceStatsTab recomputes live coverage from edges[].distance. Put cost
    there and the coverage bars silently become a cost histogram in miles."""
    env = solve_delivery(adjusted())
    for e in env["edges"]:
        assert e["distance"] == pytest.approx(DELIV_DISTANCES[(e["fromId"], e["toId"])])
        assert e["flow"] == round(_customers()[e["toId"]]["demand"])


def test_assignment_record_shape():
    """Pins the plan's choice of solve_pmedian's record shape (solve.py:475-476)
    so a later edit cannot rename distanceMi to distance or drop band."""
    a = solve_delivery(dict(BASE))["details"]["assignments"][0]
    assert set(a) == {"customerId", "warehouseId", "distanceMi", "band"}
    assert a["distanceMi"] == pytest.approx(DELIV_DISTANCES[(a["warehouseId"], a["customerId"])])


def test_band_coverage_is_cumulative_and_exact():
    """Exact values, not merely non-decreasing - an exclusive rollup is also
    non-decreasing, so that assertion cannot tell the two semantics apart."""
    b = bands_of(solve_delivery(dict(BASE)))
    assert [b[400], b[800], b[1200], b[1600]] == [
        pytest.approx(59.38, abs=5e-3), pytest.approx(81.45, abs=5e-3),
        pytest.approx(99.44, abs=5e-3), pytest.approx(100.00, abs=5e-3)]
    assert -1 not in b          # both goldens reach 100% by 1600: no Overflow row


def test_overflow_band_is_emitted():
    """Spec 5.6 / 12.3.7: an explicit Overflow row (band -1, the OVERFLOW_BAND
    sentinel shared with lib/units and the gold/jade envelopes) whenever any
    assigned lane exceeds the largest band. Both goldens reach 100% by 1600,
    so a narrower band set is used to force it. Asserts the ROW EXISTS with
    the right remainder - `total < 100` alone is true even when no row is
    emitted, which is the bug this test exists to catch."""
    env = solve_delivery({**BASE, "distanceBands": [100, 200]})
    b = bands_of(env)
    assert -1 in b
    assert b[-1] == pytest.approx(100.0 - b[200], abs=5e-3)
    assert 0 < b[-1] < 100
    # edges beyond every band carry the OVERFLOW_BAND sentinel (-1), never a clamp
    assert any(e["band"] == -1 for e in env["edges"])
    assert all(e["band"] in (0, 1, -1) for e in env["edges"])


def test_assign_band_or_overflow_never_clamps():
    """The three older solvers clamp an over-band lane into the LAST band
    (solve.py:470, 642, 835 - documented at :1004-1006 as a misreporting
    fallback). This helper must return OVERFLOW_BAND (-1) instead."""
    assert _assign_band_or_overflow(50, [100, 200]) == 0
    assert _assign_band_or_overflow(100, [100, 200]) == 0     # inclusive upper edge
    assert _assign_band_or_overflow(150, [100, 200]) == 1
    assert _assign_band_or_overflow(201, [100, 200]) == -1    # overflow, not 1


def test_single_source():
    """Decision 9: exactly one assignment per customer AND it carries the
    customer's whole demand (spec 8.2's `flow == demand` half)."""
    env = solve_delivery(dict(BASE))
    seen = {}
    for a in env["details"]["assignments"]:
        assert a["customerId"] not in seen
        seen[a["customerId"]] = a["warehouseId"]
    assert len(seen) == 313
    flow_by_customer = {}
    for e in env["edges"]:
        flow_by_customer[e["toId"]] = flow_by_customer.get(e["toId"], 0) + e["flow"]
    for cid, c in _customers().items():
        assert flow_by_customer[cid] == round(c["demand"])


def test_no_utilization_metric():
    """No capacity means no utilization denominator. Emitting one would plant a
    number nothing can compute; OpenWarehousesTab shows Demand Served instead."""
    env = solve_delivery(dict(BASE))
    assert "utilizationByNode" not in env["metrics"]


def test_unknown_override_id_raises():
    """Fails closed with the shared UnresolvableIdError (merge_inputs.py:31),
    which solve()'s blanket handler turns into an fd3 internal_error. Task 6's
    precheck exists so a student never reaches this path with bad input."""
    with pytest.raises(UnresolvableIdError):
        solve_delivery({**BASE, "laneCostOverrides": [
            {"fromId": "W999", "toId": "C1", "cost": 1.0}]})
    with pytest.raises(UnresolvableIdError):
        solve_delivery({**BASE, "laneCostOverrides": [
            {"fromId": "C1", "toId": "W1", "cost": 1.0}]})   # role-swapped pair


def test_envelope_carries_status_evidence():
    """Spec 5.8: the truthful-status fields every other solver forwards."""
    env = solve_delivery(dict(BASE))
    assert env["quality"] == "Optimal"          # raw PuLP LpStatus, not a projection
    assert env["terminationReason"] is not None
    assert env["runTimeSec"] >= 0               # 0.00 is a legal rounded value; -1 is the absent sentinel
    assert env["details"]["objective"] == "base"
    assert solve_delivery(adjusted())["details"]["objective"] == "cost_adjusted"


def test_dataset_load_error_degrades_to_error_envelope():
    """Spec 5.8, the other half: a package that failed to load must come back
    as the dataset_load failure envelope, never as a solve attempt against
    empty tables (which would be 'infeasible' - plausible and wrong)."""
    import solve as solve_mod
    solve_mod._LOAD_ERRORS["delivery-teaching-us"] = "synthetic load failure"
    try:
        env = solve_delivery(dict(BASE))
    finally:
        del solve_mod._LOAD_ERRORS["delivery-teaching-us"]
    assert env["status"] == "error"
    assert env["_failureStage"] == "dataset_load"
    assert env["edges"] == []


def _assignment_map(env):
    return {a["customerId"]: a["warehouseId"] for a in env["details"]["assignments"]}


def _customers():
    from solve import DELIV_CUSTOMERS
    return DELIV_CUSTOMERS
