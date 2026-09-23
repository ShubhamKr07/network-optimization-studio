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
