"""SCN v0.3 Phase B, task B6.1 — `build_merged_transport_dataset`
(merge_inputs.py), the `transport-coal` fast-follow of B3.1's
`build_merged_pmedian_dataset` / B6.3's `build_merged_brazil_dataset`.

`transport-coal` is already ID-keyed end to end (`COAL_MINES`/
`POWER_STATIONS` are `{str_id: {...}}`, `_transport_distances()` is
`{(str_mine_id, str_station_id): float}`), DD-2's correction — so like
Brazil, no id<->index bridge (B1.3) is exercised here. These are unit/
mechanism tests for the merge helper in isolation, tested against the real
transport-coal dataset (loaded via solve.py's module-level COAL_MINES/
POWER_STATIONS, per this repo's standing convention). End-to-end golden
tests that exercise this through a real `solve_transport` subprocess solve
live in `test_network_edits_transport.py` (mirrors `test_network_edits.py`/
`test_network_edits_brazil.py`'s convention).

Unlike p-median's added warehouses, an added mine has NO status field (see
validation/inputs/transportLp.ts's header comment) — mines have no open/
close concept in this LP at all."""
import sys
from pathlib import Path

import pytest

SOLVER_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(SOLVER_DIR))
import solve as S  # noqa: E402
from merge_inputs import UnresolvableIdError, build_merged_transport_dataset  # noqa: E402


def empty_inputs(**overrides):
    base = {"addedMines": [], "addedStations": [], "laneCostOverrides": []}
    base.update(overrides)
    return base


def transport_distance():
    return S._transport_distances()


def test_merged_dataset_with_empty_inputs_is_a_copy_not_the_same_object():
    merged = build_merged_transport_dataset(empty_inputs(), S.COAL_MINES, S.POWER_STATIONS, transport_distance())
    assert merged["mines"] == S.COAL_MINES
    assert merged["mines"] is not S.COAL_MINES
    assert merged["stations"] == S.POWER_STATIONS
    assert merged["stations"] is not S.POWER_STATIONS
    assert merged["distance"] == transport_distance()
    assert merged["addedMinesById"] == {}
    assert merged["addedStationsById"] == {}


def test_added_mine_is_keyed_by_its_own_id_no_synthetic_index():
    inputs = empty_inputs(addedMines=[
        {"id": "MN-NEW-1", "city": "Bristol", "state": "VA", "lat": 36.6, "lng": -82.19, "capacity": 5_000_000},
    ])
    merged = build_merged_transport_dataset(inputs, S.COAL_MINES, S.POWER_STATIONS, transport_distance())
    assert "MN-NEW-1" in merged["mines"]
    assert merged["mines"]["MN-NEW-1"]["id"] == "MN-NEW-1"
    assert merged["mines"]["MN-NEW-1"]["city"] == "Bristol"
    assert merged["mines"]["MN-NEW-1"]["state"] == "VA"
    assert merged["mines"]["MN-NEW-1"]["capacity"] == 5_000_000
    assert merged["addedMinesById"]["MN-NEW-1"]["capacity"] == 5_000_000
    # Base dataset itself never mutated.
    assert "MN-NEW-1" not in S.COAL_MINES


def test_added_mine_with_no_capacity_merges_with_capacity_none():
    inputs = empty_inputs(addedMines=[
        {"id": "MN-NEW-2", "city": "Beckley", "state": "WV", "lat": 37.78, "lng": -81.19},
    ])
    merged = build_merged_transport_dataset(inputs, S.COAL_MINES, S.POWER_STATIONS, transport_distance())
    assert merged["mines"]["MN-NEW-2"]["capacity"] is None
    assert merged["addedMinesById"]["MN-NEW-2"].get("capacity") is None


def test_added_station_is_keyed_by_its_own_id_with_demand():
    inputs = empty_inputs(addedStations=[
        {"id": "ST-NEW-1", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81, "demand": 1_500_000},
    ])
    merged = build_merged_transport_dataset(inputs, S.COAL_MINES, S.POWER_STATIONS, transport_distance())
    assert "ST-NEW-1" in merged["stations"]
    assert merged["stations"]["ST-NEW-1"]["demand"] == 1_500_000
    assert merged["addedStationsById"]["ST-NEW-1"]["demand"] == 1_500_000
    assert "ST-NEW-1" not in S.POWER_STATIONS


def test_merged_distance_overlays_override_onto_base_without_dropping_other_pairs():
    base_dist = transport_distance()
    assert base_dist[("KY", "LAX")] == 2332.7
    inputs = empty_inputs(laneCostOverrides=[{"fromId": "KY", "toId": "LAX", "cost": 1.0}])
    merged = build_merged_transport_dataset(inputs, S.COAL_MINES, S.POWER_STATIONS, base_dist)
    assert merged["distance"][("KY", "LAX")] == 1.0
    # An unrelated pair is untouched.
    assert merged["distance"][("KY", "NYC")] == base_dist[("KY", "NYC")]
    # Base distance dict itself never mutated.
    assert base_dist[("KY", "LAX")] == 2332.7


def test_merged_distance_supplies_the_only_route_to_an_added_entity():
    inputs = empty_inputs(
        addedMines=[
            {"id": "MN-NEW-1", "city": "Bristol", "state": "VA", "lat": 36.6, "lng": -82.19, "capacity": 5_000_000},
        ],
        addedStations=[
            {"id": "ST-NEW-1", "city": "Reno", "state": "NV", "lat": 39.53, "lng": -119.81, "demand": 1_500_000},
        ],
        laneCostOverrides=[{"fromId": "MN-NEW-1", "toId": "ST-NEW-1", "cost": 15.0}],
    )
    merged = build_merged_transport_dataset(inputs, S.COAL_MINES, S.POWER_STATIONS, transport_distance())
    assert merged["distance"][("MN-NEW-1", "ST-NEW-1")] == 15.0
    # No auto-haversine fallback for pairs with no override — simply absent.
    assert ("MN-NEW-1", "LAX") not in merged["distance"]


def test_unknown_from_id_in_lane_cost_override_raises_not_silently_resolved():
    inputs = empty_inputs(laneCostOverrides=[{"fromId": "NOPE-NOT-REAL", "toId": "LAX", "cost": 10.0}])
    with pytest.raises(UnresolvableIdError):
        build_merged_transport_dataset(inputs, S.COAL_MINES, S.POWER_STATIONS, transport_distance())


def test_unknown_to_id_in_lane_cost_override_also_raises():
    inputs = empty_inputs(laneCostOverrides=[{"fromId": "KY", "toId": "NOPE-NOT-REAL", "cost": 10.0}])
    with pytest.raises(UnresolvableIdError):
        build_merged_transport_dataset(inputs, S.COAL_MINES, S.POWER_STATIONS, transport_distance())


def test_backwards_override_raises_not_silently_resolved():
    # fromId is a real station id, toId is a real mine id — backwards.
    inputs = empty_inputs(laneCostOverrides=[{"fromId": "LAX", "toId": "KY", "cost": 999.0}])
    with pytest.raises(UnresolvableIdError):
        build_merged_transport_dataset(inputs, S.COAL_MINES, S.POWER_STATIONS, transport_distance())


def test_two_calls_for_two_different_scenarios_do_not_leak_into_each_other():
    inputs_a = empty_inputs(addedMines=[
        {"id": "MN-A", "city": "Bristol", "state": "VA", "lat": 36.6, "lng": -82.19, "capacity": 1_000_000},
    ])
    inputs_b = empty_inputs(addedMines=[
        {"id": "MN-B", "city": "Beckley", "state": "WV", "lat": 37.78, "lng": -81.19, "capacity": 2_000_000},
    ])
    merged_a = build_merged_transport_dataset(inputs_a, S.COAL_MINES, S.POWER_STATIONS, transport_distance())
    merged_b = build_merged_transport_dataset(inputs_b, S.COAL_MINES, S.POWER_STATIONS, transport_distance())
    assert "MN-A" in merged_a["mines"] and "MN-B" not in merged_a["mines"]
    assert "MN-B" in merged_b["mines"] and "MN-A" not in merged_b["mines"]
    assert "MN-A" not in S.COAL_MINES
    assert "MN-B" not in S.COAL_MINES
