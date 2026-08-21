"""SCN v0.3 Phase B, task B6.2 — `build_merged_two_echelon_dataset`
(merge_inputs.py), the `two-echelon-gold-au` fast-follow of B3.1's
`build_merged_pmedian_dataset` / B6.3's `build_merged_brazil_dataset` /
B6.1's `build_merged_transport_dataset`.

`two-echelon-gold-au` is already ID-keyed end to end (`GOLD_MINES`/
`GOLD_REFINERIES`/`GOLD_CUSTOMERS` are `{str_id: {...}}`,
`_gold_distances()` is `{(str_from_id, str_to_id): float}`), DD-2's
correction — so like Brazil/transport-coal, no id<->index bridge (B1.3) is
exercised here. Own function (not a generalization of the two-entity-type
merges above) — this model has THREE entity types (mines/refineries/
customers) and TWO legs sharing one flat distance dict.

These are unit/mechanism tests for the merge helper in isolation, tested
against the real two-echelon-gold-au dataset (loaded via solve.py's
module-level GOLD_MINES/GOLD_REFINERIES/GOLD_CUSTOMERS, per this repo's
standing convention). End-to-end golden tests that exercise this through a
real `solve_two_echelon` subprocess solve live in
`test_network_edits_two_echelon.py` (mirrors `test_network_edits_
transport.py`'s convention).

Unlike p-median's added warehouses, there is no `addedMines` concept at
all — the mine is fixed, never overridable (not a facility-location
choice)."""
import sys
from pathlib import Path

import pytest

SOLVER_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SOLVER_DIR))
import solve as S  # noqa: E402
from merge_inputs import UnresolvableIdError, build_merged_two_echelon_dataset  # noqa: E402


def empty_inputs(**overrides):
    base = {"addedRefineries": [], "addedCustomers": [], "distanceOverrides": []}
    base.update(overrides)
    return base


def gold_distance():
    return S._gold_distances()


def test_merged_dataset_with_empty_inputs_is_a_copy_not_the_same_object():
    merged = build_merged_two_echelon_dataset(
        empty_inputs(), S.GOLD_MINES, S.GOLD_REFINERIES, S.GOLD_CUSTOMERS, gold_distance())
    assert merged["refineries"] == S.GOLD_REFINERIES
    assert merged["refineries"] is not S.GOLD_REFINERIES
    assert merged["customers"] == S.GOLD_CUSTOMERS
    assert merged["customers"] is not S.GOLD_CUSTOMERS
    assert merged["distance"] == gold_distance()
    assert merged["addedRefineriesById"] == {}
    assert merged["addedCustomersById"] == {}


def test_added_refinery_is_keyed_by_its_own_id_no_synthetic_index():
    inputs = empty_inputs(addedRefineries=[
        {"id": "ref-new-1", "city": "Kalgoorlie West", "state": "WA", "lat": -30.8, "lng": 121.3, "status": "active"},
    ])
    merged = build_merged_two_echelon_dataset(
        inputs, S.GOLD_MINES, S.GOLD_REFINERIES, S.GOLD_CUSTOMERS, gold_distance())
    assert "ref-new-1" in merged["refineries"]
    assert merged["refineries"]["ref-new-1"]["id"] == "ref-new-1"
    assert merged["refineries"]["ref-new-1"]["city"] == "Kalgoorlie West"
    assert merged["refineries"]["ref-new-1"]["state"] == "WA"
    # No capacity/status key on the merged refineries dict itself — those
    # come from addedRefineriesById instead (mirrors base refineries' own
    # shape, which also carries no status).
    assert "status" not in merged["refineries"]["ref-new-1"]
    assert merged["addedRefineriesById"]["ref-new-1"]["status"] == "active"
    # Base dataset itself never mutated.
    assert "ref-new-1" not in S.GOLD_REFINERIES


def test_added_customer_is_keyed_by_its_own_id_with_demand():
    inputs = empty_inputs(addedCustomers=[
        {"id": "perth", "city": "Perth", "state": "WA", "lat": -31.95, "lng": 115.86, "demand": 250000},
    ])
    merged = build_merged_two_echelon_dataset(
        inputs, S.GOLD_MINES, S.GOLD_REFINERIES, S.GOLD_CUSTOMERS, gold_distance())
    assert "perth" in merged["customers"]
    assert merged["customers"]["perth"]["demand"] == 250000
    assert merged["addedCustomersById"]["perth"]["demand"] == 250000
    assert "perth" not in S.GOLD_CUSTOMERS


def test_merged_distance_overlays_override_onto_base_without_dropping_other_pairs():
    base_dist = gold_distance()
    assert base_dist[("kalgoorlie", "cunnamulla")] != 1.0
    inputs = empty_inputs(distanceOverrides=[{"fromId": "kalgoorlie", "toId": "cunnamulla", "distance": 1.0}])
    merged = build_merged_two_echelon_dataset(
        inputs, S.GOLD_MINES, S.GOLD_REFINERIES, S.GOLD_CUSTOMERS, base_dist)
    assert merged["distance"][("kalgoorlie", "cunnamulla")] == 1.0
    # An unrelated pair (a real refinery -> customer leg) is untouched.
    assert merged["distance"][("cunnamulla", "sydney")] == base_dist[("cunnamulla", "sydney")]
    # Base distance dict itself never mutated.
    assert base_dist[("kalgoorlie", "cunnamulla")] != 1.0


def test_added_refinery_needs_both_legs_supplied_via_overrides():
    inputs = empty_inputs(
        addedRefineries=[
            {"id": "ref-new-1", "city": "Kalgoorlie West", "state": "WA", "lat": -30.8, "lng": 121.3, "status": "active"},
        ],
        addedCustomers=[
            {"id": "perth", "city": "Perth", "state": "WA", "lat": -31.95, "lng": 115.86, "demand": 250000},
        ],
        distanceOverrides=[
            {"fromId": "kalgoorlie", "toId": "ref-new-1", "distance": 50.0},   # mine -> refinery leg
            {"fromId": "ref-new-1", "toId": "perth", "distance": 700.0},       # refinery -> customer leg
        ],
    )
    merged = build_merged_two_echelon_dataset(
        inputs, S.GOLD_MINES, S.GOLD_REFINERIES, S.GOLD_CUSTOMERS, gold_distance())
    assert merged["distance"][("kalgoorlie", "ref-new-1")] == 50.0
    assert merged["distance"][("ref-new-1", "perth")] == 700.0
    # No auto-haversine fallback for pairs with no override — simply absent.
    assert ("ref-new-1", "sydney") not in merged["distance"]


def test_unknown_from_id_in_distance_override_raises_not_silently_resolved():
    inputs = empty_inputs(distanceOverrides=[{"fromId": "NOPE-NOT-REAL", "toId": "sydney", "distance": 10.0}])
    with pytest.raises(UnresolvableIdError):
        build_merged_two_echelon_dataset(inputs, S.GOLD_MINES, S.GOLD_REFINERIES, S.GOLD_CUSTOMERS, gold_distance())


def test_unknown_to_id_in_distance_override_also_raises():
    inputs = empty_inputs(distanceOverrides=[{"fromId": "cunnamulla", "toId": "NOPE-NOT-REAL", "distance": 10.0}])
    with pytest.raises(UnresolvableIdError):
        build_merged_two_echelon_dataset(inputs, S.GOLD_MINES, S.GOLD_REFINERIES, S.GOLD_CUSTOMERS, gold_distance())


def test_backwards_override_raises_not_silently_resolved():
    # fromId is a real customer id, toId is a real refinery id — backwards.
    inputs = empty_inputs(distanceOverrides=[{"fromId": "sydney", "toId": "cunnamulla", "distance": 999.0}])
    with pytest.raises(UnresolvableIdError):
        build_merged_two_echelon_dataset(inputs, S.GOLD_MINES, S.GOLD_REFINERIES, S.GOLD_CUSTOMERS, gold_distance())


def test_mine_to_customer_pair_skipping_a_leg_raises():
    # Neither leg shape — mine and customer are never directly adjacent in
    # this model's structure (a real leg-skip mistake, not just a typo).
    inputs = empty_inputs(distanceOverrides=[{"fromId": "kalgoorlie", "toId": "sydney", "distance": 999.0}])
    with pytest.raises(UnresolvableIdError):
        build_merged_two_echelon_dataset(inputs, S.GOLD_MINES, S.GOLD_REFINERIES, S.GOLD_CUSTOMERS, gold_distance())


def test_two_calls_for_two_different_scenarios_do_not_leak_into_each_other():
    inputs_a = empty_inputs(addedRefineries=[
        {"id": "ref-a", "city": "A", "state": "WA", "lat": -30.0, "lng": 120.0, "status": "active"},
    ])
    inputs_b = empty_inputs(addedRefineries=[
        {"id": "ref-b", "city": "B", "state": "WA", "lat": -31.0, "lng": 121.0, "status": "active"},
    ])
    merged_a = build_merged_two_echelon_dataset(
        inputs_a, S.GOLD_MINES, S.GOLD_REFINERIES, S.GOLD_CUSTOMERS, gold_distance())
    merged_b = build_merged_two_echelon_dataset(
        inputs_b, S.GOLD_MINES, S.GOLD_REFINERIES, S.GOLD_CUSTOMERS, gold_distance())
    assert "ref-a" in merged_a["refineries"] and "ref-b" not in merged_a["refineries"]
    assert "ref-b" in merged_b["refineries"] and "ref-a" not in merged_b["refineries"]
    assert "ref-a" not in S.GOLD_REFINERIES
    assert "ref-b" not in S.GOLD_REFINERIES
