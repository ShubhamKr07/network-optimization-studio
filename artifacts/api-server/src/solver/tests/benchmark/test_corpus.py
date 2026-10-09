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

# CH4O-5 -- `avgServiceDistCapKm` and `coverageFloorDemand` are
# UNCONDITIONALLY required for max-coverage-us now, so the manifest's own flat
# `required` list is the whole rule and the objective-discriminated
# conditional-required hook is gone. These three tests kept their intent (a
# case solve_max_coverage would KeyError on must be rejected at load time,
# without ever driving a real solve) and changed only the mechanism they
# assert through. `objective` is not an input any more and is absent from the
# base case.
def _max_coverage_case(case_id, extra=None):
    base = {"modelType": "max_coverage_us", "p": 3,
            "highServiceDistKm": 700, "maxDistKm": 5500, "capacityMode": "none",
            "avgServiceDistCapKm": 1000, "coverageFloorDemand": 0,
            "distanceBands": [700, 1400, 2800, 5500], "timeLimitSec": 60}
    base.update(extra or {})
    return {"case_id": case_id, "inputs": base}

def _one_max_coverage_manifest(case):
    return {
        "version": 1,
        "strata": [{"model_id": "max-coverage-us", "regime": "forced_open",
                    "edit_family": None, "weight": 1.0,
                    "cases": [case]}],
        "gaps": [0],
    }

def test_max_coverage_missing_coverage_floor_is_rejected(tmp_path):
    case = _max_coverage_case("mc-0")
    del case["inputs"]["coverageFloorDemand"]
    p = tmp_path / "m.json"
    p.write_text(json.dumps(_one_max_coverage_manifest(case)))
    with pytest.raises(ManifestError, match=r"missing \['coverageFloorDemand'\]"):
        load_manifest(str(p))

def test_max_coverage_with_both_mode_fields_is_accepted(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps(_one_max_coverage_manifest(_max_coverage_case("mc-0"))))
    m = load_manifest(str(p))          # must not raise
    assert m.cells()[0].cases[0].case_id == "mc-0"

def test_max_coverage_missing_avg_service_dist_cap_is_rejected(tmp_path):
    case = _max_coverage_case("mc-0")
    del case["inputs"]["avgServiceDistCapKm"]
    p = tmp_path / "m.json"
    p.write_text(json.dumps(_one_max_coverage_manifest(case)))
    with pytest.raises(ManifestError, match=r"missing \['avgServiceDistCapKm'\]"):
        load_manifest(str(p))

def test_max_coverage_no_longer_requires_objective(tmp_path):
    # The mode is derived from the floor server-side and re-derived inside
    # solve_max_coverage; a corpus case that omits `objective` entirely (as
    # every case now does) must load cleanly.
    case = _max_coverage_case("mc-0")
    assert "objective" not in case["inputs"]
    p = tmp_path / "m.json"
    p.write_text(json.dumps(_one_max_coverage_manifest(case)))
    load_manifest(str(p))              # must not raise
