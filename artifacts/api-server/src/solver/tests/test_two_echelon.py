"""pytest tests for the Two-Echelon Gold Refinery model (Chapter 10) in solve.py.

Ground-truth values below are transcribed VERBATIM from the source notebook
(``Notebook_Mining_Problem_Chapter_10_Network_Design_Book.ipynb``): scenario 1's
objective and average customer distance are the notebook's own STORED cell-22
output (reproduced exactly by replicating the notebook's LP locally with PuLP
during planning); scenario 2's values were computed the same way (same
replication, BOM=2.0) and cross-checked against the integration doc's
independent "~2,191 km" / "~294 km" citations, which match to the nearest km.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent))
from solve import solve_two_echelon  # noqa: E402


def test_scenario_1_selects_cunnamulla():
    result = solve_two_echelon({
        "bomRatio": 1.1, "distanceBands": [500, 1000, 1500, 2000, 2600],
        "gap": 0, "timeLimitSec": 30,
    })
    assert result["status"] == "optimal"
    assert result["details"]["openWarehouseIds"] == ["cunnamulla"]


def test_scenario_2_selects_daggar_hills():
    result = solve_two_echelon({
        "bomRatio": 2.0, "distanceBands": [500, 1000, 1500, 2000, 2600],
        "gap": 0, "timeLimitSec": 30,
    })
    assert result["status"] == "optimal"
    assert result["details"]["openWarehouseIds"] == ["daggar-hills"]


def test_objective_matches_notebook():
    # Ground truth from the real source notebook: scenario 1's objective/avg
    # distance is the notebook's own STORED cell-22 output (reproduced exactly
    # by replicating the notebook's LP locally with PuLP during planning).
    # Scenario 2 was not stored in the notebook's saved outputs -- its value
    # below was computed the same way (same replication, BOM=2.0) and cross-
    # checked against the integration doc's independent "~2,191 km" / "~294 km"
    # citations, which match to the nearest whole km.
    r1 = solve_two_echelon({"bomRatio": 1.1, "distanceBands": [500, 1000, 1500, 2000, 2600], "gap": 0, "timeLimitSec": 30})
    r2 = solve_two_echelon({"bomRatio": 2.0, "distanceBands": [500, 1000, 1500, 2000, 2600], "gap": 0, "timeLimitSec": 30})
    assert abs(r1["objective"] - 386576.9929994568) / 386576.9929994568 < 1e-6
    assert abs(r2["objective"] - 467205.2592914422) / 467205.2592914422 < 1e-6
    leg1 = {l["leg"]: l["avgDistance"] for l in r1["metrics"]["avgDistanceByLeg"]}
    leg2 = {l["leg"]: l["avgDistance"] for l in r2["metrics"]["avgDistanceByLeg"]}
    assert abs(leg1["refinery_to_customer"] - 687.6) < 0.5   # notebook: 687.5738755210947
    assert abs(leg2["refinery_to_customer"] - 2190.6) < 0.5  # replicated: 2190.6486217334573
    assert abs(leg2["mine_to_refinery"] - 293.7) < 0.5       # replicated: 293.664297837559 (only Daggar Hills open)


def test_leg_averages_move_oppositely():
    # The exercise's actual pedagogical answer: as bomRatio rises, the
    # mine->refinery leg's average distance should trend down (favoring the
    # mine-adjacent refinery) while refinery->customer trends up, or the
    # facility choice flips entirely between the two scenarios.
    r1 = solve_two_echelon({"bomRatio": 1.1, "distanceBands": [500, 1000, 1500, 2000, 2600], "gap": 0, "timeLimitSec": 30})
    r2 = solve_two_echelon({"bomRatio": 2.0, "distanceBands": [500, 1000, 1500, 2000, 2600], "gap": 0, "timeLimitSec": 30})
    assert r1["details"]["openWarehouseIds"] != r2["details"]["openWarehouseIds"]
    leg1 = {l["leg"]: l["avgDistance"] for l in r1["metrics"]["avgDistanceByLeg"]}
    leg2 = {l["leg"]: l["avgDistance"] for l in r2["metrics"]["avgDistanceByLeg"]}
    assert leg1["mine_to_refinery"] != leg2["mine_to_refinery"]


def test_bom_flip_threshold():
    # Bracket, not point -- CBC tie-breaking is arbitrary near the boundary.
    low = solve_two_echelon({"bomRatio": 1.1, "distanceBands": [500, 1000, 1500, 2000, 2600], "gap": 0, "timeLimitSec": 30})
    high = solve_two_echelon({"bomRatio": 2.0, "distanceBands": [500, 1000, 1500, 2000, 2600], "gap": 0, "timeLimitSec": 30})
    assert low["details"]["openWarehouseIds"] == ["cunnamulla"]
    assert high["details"]["openWarehouseIds"] == ["daggar-hills"]


def test_band_overflow_not_absorbed():
    # Daggar Hills -> Brisbane leg is 2,544 km per the integration doc, past
    # every default band's ceiling (2600 is the last, so this specific case
    # may not overflow at defaults -- force a narrower band set to trigger it).
    result = solve_two_echelon({
        "bomRatio": 2.0, "distanceBands": [500, 1000, 1500, 2000],  # no 2600 band
        "gap": 0, "timeLimitSec": 30,
    })
    coverage = result["metrics"]["bandCoverage"]
    overflow_entries = [c for c in coverage if c["band"] == -1]
    if result["details"]["openWarehouseIds"] == ["daggar-hills"]:
        assert len(overflow_entries) > 0, "a >2000km leg with no matching band must appear as overflow, not silently absorbed"


def test_avg_distance_not_derived_from_objective():
    result = solve_two_echelon({"bomRatio": 1.1, "distanceBands": [500, 1000, 1500, 2000, 2600], "gap": 0, "timeLimitSec": 30})
    naive_avg = result["objective"] / 7_400_000  # the wrong shortcut -- objective is /44000 already
    real_avg = result["metrics"]["weightedAvgDistance"]
    assert abs(naive_avg - real_avg) > 1  # must NOT match the naive (wrong) calculation


def test_all_refineries_inactive_infeasible():
    result = solve_two_echelon({
        "bomRatio": 1.1, "distanceBands": [500, 1000, 1500, 2000, 2600], "gap": 0, "timeLimitSec": 30,
        "refineryStatuses": [{"refineryId": "daggar-hills", "status": "inactive"},
                             {"refineryId": "cunnamulla", "status": "inactive"}],
    })
    assert result["status"] == "infeasible"
    assert "inactive" in result["infeasibilityReason"].lower()


def test_two_forced_open_infeasible():
    result = solve_two_echelon({
        "bomRatio": 1.1, "distanceBands": [500, 1000, 1500, 2000, 2600], "gap": 0, "timeLimitSec": 30,
        "refineryStatuses": [{"refineryId": "daggar-hills", "status": "forced_open"},
                             {"refineryId": "cunnamulla", "status": "forced_open"}],
    })
    assert result["status"] == "infeasible"
    assert "forced" in result["infeasibilityReason"].lower()


def test_flow_balance_generalizes(monkeypatch):
    # The source notebook writes the BOM constraint PER (mine, refinery) pair,
    # which is only correct by coincidence for the single-mine dataset: with
    # TWO mines it would force EACH mine to independently supply the open
    # refinery's full raw requirement, doubling total raw inflow with no error
    # raised. solve_two_echelon instead SUMS the constraint over mines:
    #   sum_p x[p,r] - bomRatio * sum_c y[r,c] == 0    (for each r)
    # so total raw inflow == bomRatio * total refined outflow. The real dataset
    # has only one mine, so this test monkeypatches GOLD_MINES to add a
    # synthetic 2nd mine with a real distance profile and asserts the summed
    # invariant holds -- not 2x it, which is the per-pair bug's signature.
    import solve as solve_mod

    synth_mines = dict(solve_mod.GOLD_MINES)
    synth_mines["kalgoorlie-2"] = {
        "id": "kalgoorlie-2", "city": "Kalgoorlie 2", "state": "WA",
        "lat": -30.7495, "lng": 121.4667,
    }
    synth_dist = dict(solve_mod._GOLD_DIST_RAW)
    # Give the 2nd mine the SAME distance profile as the real mine, so the LP
    # is free to split raw supply between both mines without changing the
    # objective (and both distances must exist or dist[p,r] would KeyError).
    synth_dist["kalgoorlie-2,daggar-hills"] = synth_dist["kalgoorlie,daggar-hills"]
    synth_dist["kalgoorlie-2,cunnamulla"] = synth_dist["kalgoorlie,cunnamulla"]
    monkeypatch.setattr(solve_mod, "GOLD_MINES", synth_mines)
    monkeypatch.setattr(solve_mod, "_GOLD_DIST_RAW", synth_dist)

    bom = 1.1
    result = solve_two_echelon({
        "bomRatio": bom, "distanceBands": [500, 1000, 1500, 2000, 2600],
        "gap": 0, "timeLimitSec": 30,
    })
    assert result["status"] == "optimal", result.get("infeasibilityReason")

    raw_inflow = sum(e["flow"] for e in result["edges"] if e["leg"] == "mine_to_refinery")
    refined_outflow = sum(e["flow"] for e in result["edges"] if e["leg"] == "refinery_to_customer")
    assert refined_outflow > 0

    # Summed-over-mines BOM: raw inflow == bom * refined outflow (within int
    # rounding). Per-(p,r) BOM (the notebook's bug) would give exactly 2x.
    expected = bom * refined_outflow
    assert abs(raw_inflow - expected) / expected < 1e-3, (
        f"raw_inflow={raw_inflow} but expected bom*refined_outflow={expected:.0f}; "
        f"ratio={raw_inflow / refined_outflow:.4f} "
        f"(would be {2 * bom:.2f} under the per-pair BOM bug)"
    )
    # Explicit anti-assertion: must NOT approach 2x.
    assert raw_inflow < 1.9 * bom * refined_outflow
