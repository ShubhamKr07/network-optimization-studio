# test_corpus.py
import json, pytest
from benchmark.corpus import load_manifest, ManifestError

def _stratum(model, regime, fam, weight, n_cases):
    model_type = {"two-echelon-jade-us": "two_echelon_jade",
                  "p-median-us": "p_median"}[model]
    base = ({"modelType": model_type, "p": 3, "distanceBands": [500],
             "timeLimitSec": 60}
            if model == "two-echelon-jade-us" else
            {"modelType": model_type, "p": 3, "capacityMode": "none",
             "distanceBands": [500], "timeLimitSec": 60})
    return {"model_id": model, "regime": regime, "edit_family": fam, "weight": weight,
            "cases": [{"case_id": f"{model}-{i}", "inputs": {**base, "p": 3 + i}}
                      for i in range(n_cases)]}

def test_cells_carry_distinct_cases_not_one_input(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "version": 1,
        "strata": [
            _stratum("two-echelon-jade-us", "free_choice", "demand", 0.5, 3),
            _stratum("p-median-us", "forced_open", None, 0.5, 3),
        ],
        "gaps": [0, 0.005],
    }))
    m = load_manifest(str(p))
    cells = m.cells()
    assert len(cells) == 4                       # 2 strata x 2 gaps
    assert {c.gap for c in cells} == {0, 0.005}
    for c in cells:
        ids = [case.case_id for case in c.cases]
        assert len(ids) == len(set(ids)) == 3     # MP-R1: distinct cases, not repeats

def test_minimum_case_count_is_enforced(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "version": 1,
        "strata": [_stratum("p-median-us", "forced_open", None, 1.0, 2)],
        "gaps": [0],
    }))
    with pytest.raises(ManifestError, match="at least 200 distinct cases"):
        load_manifest(str(p), min_cases_per_cell=200)

def test_weights_must_sum_to_one(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "version": 1,
        "strata": [{"model_id": "p-median-us", "regime": "forced_open",
                    "edit_family": None, "weight": 0.4, "inputs": {}}],
        "gaps": [0],
    }))
    with pytest.raises(ManifestError, match="weights must sum to 1"):
        load_manifest(str(p))

def _chens_case(case_id, extra=None):
    base = {"modelType": "chens", "objective": "min_distance", "p": 3,
            "highServiceDistKm": 300, "maxDistKm": 800, "capacityMode": "none",
            "distanceBands": [200, 400, 800, 1600], "timeLimitSec": 60}
    return {"case_id": case_id, "inputs": {**base, **(extra or {})}}

def test_chens_min_distance_missing_coverage_floor_is_rejected(tmp_path):
    # M1.1-fix: chensInputsSchema's superRefine (chens.ts) requires
    # coverageFloorDemand whenever objective="min_distance" -- a flat
    # `required`-list check alone (the pre-fix behavior) cannot see this,
    # and solve_chens KeyErrors on such a case. Manifest.validate must now
    # catch it directly, without ever driving a real solve.
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "version": 1,
        "strata": [{"model_id": "chens-cosmetics-cn", "regime": "forced_open",
                    "edit_family": None, "weight": 1.0,
                    "cases": [_chens_case("chens-0")]}],   # no coverageFloorDemand
        "gaps": [0],
    }))
    with pytest.raises(ManifestError, match="conditionally-required.*coverageFloorDemand"):
        load_manifest(str(p))

def test_chens_min_distance_with_coverage_floor_is_accepted(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "version": 1,
        "strata": [{"model_id": "chens-cosmetics-cn", "regime": "forced_open",
                    "edit_family": None, "weight": 1.0,
                    "cases": [_chens_case("chens-0", {"coverageFloorDemand": 0})]}],
        "gaps": [0],
    }))
    m = load_manifest(str(p))          # must not raise
    assert m.cells()[0].cases[0].case_id == "chens-0"

def test_chens_coverage_missing_avg_service_dist_cap_is_rejected(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "version": 1,
        "strata": [{"model_id": "chens-cosmetics-cn", "regime": "forced_open",
                    "edit_family": None, "weight": 1.0,
                    "cases": [_chens_case("chens-0", {"objective": "coverage"})]}],
        "gaps": [0],
    }))
    with pytest.raises(ManifestError, match="conditionally-required.*avgServiceDistCapKm"):
        load_manifest(str(p))
