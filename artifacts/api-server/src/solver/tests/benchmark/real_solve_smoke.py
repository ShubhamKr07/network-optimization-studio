# real_solve_smoke.py
"""M1.6 real-solve integration proof: drives one REAL `solve.py` solve per
live model, through the SAME API-schema -> wire-format translation
(`translate.to_solver_input`, wired into `measure._default_solve`) the
harness now uses for a real campaign -- proving `corpus/manifest.json`
cases can actually drive `solve.py`, not just the fake `solve_fn`s the fast
`benchmark/` unit suite uses.

Deliberately NOT named `test_*.py` -- same convention as
`solver/tests/e2e_accuracy.py`/`e2e_journey.py`, standalone scripts run
directly, not picked up by `pytest benchmark/ -q`'s fast collection (M1.5's
constraint: the benchmark unit suite never runs a real solve). CBC is slow
enough (each of these 6 solves can take real wall-clock seconds) that this
must stay opt-in, not part of every `pytest` invocation.

Run directly:
    cd artifacts/api-server/src/solver/tests/benchmark
    python3 real_solve_smoke.py
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # tests/ (for benchmark pkg import below)

from benchmark.corpus import load_manifest  # noqa: E402
from benchmark.measure import measure_once  # noqa: E402

MANIFEST_PATH = Path(__file__).resolve().parent / "corpus" / "manifest.json"

# One case per model_id: the FIRST case of the FIRST cell encountered for
# that model_id, in manifest order -- deterministic, no cherry-picking.
ALL_MODEL_IDS = (
    "p-median-us", "p-median-brazil", "transport-coal",
    "two-echelon-gold-au", "two-echelon-jade-us", "chens-cosmetics-cn",
)


def main() -> int:
    manifest = load_manifest(str(MANIFEST_PATH), min_cases_per_cell=1)

    picked = {}
    for cell in manifest.cells():
        if cell.model_id in picked:
            continue
        picked[cell.model_id] = (cell, cell.cases[0])

    missing = [mid for mid in ALL_MODEL_IDS if mid not in picked]
    if missing:
        print(f"FAIL: no corpus case found for: {missing}")
        return 1

    results = {}
    failures = []
    for model_id in ALL_MODEL_IDS:
        cell, case = picked[model_id]
        print(f"--- {model_id} (case_id={case.case_id}, gap={cell.gap}) ---")
        obs = measure_once(cell, case, timeout_sec=120)
        ok = (
            obs.ok is True
            and obs.objective is not None
            and math.isfinite(obs.objective)
            and obs.cpu_tree_sec > 0
        )
        status = "PASS" if ok else "FAIL"
        print(f"  {status}: ok={obs.ok} objective={obs.objective} "
              f"status={obs.solution_status} cpu_tree_sec={obs.cpu_tree_sec:.4f} "
              f"wall_sec={obs.wall_sec:.4f} error={obs.error}")
        if model_id == "chens-cosmetics-cn" and obs.error and "coverageFloorDemand" in obs.error:
            print(
                "  NOTE: this is a CORPUS data defect, not a translation defect.\n"
                "  Every chens-cosmetics-cn case in corpus/manifest.json has\n"
                "  objective=\"min_distance\" but omits coverageFloorDemand, which\n"
                "  chensInputsSchema's superRefine (chens.ts) requires whenever\n"
                "  objective is \"min_distance\" -- solve_chens reads it via a bare\n"
                "  inp['coverageFloorDemand'] (solve.py), so a real payload built\n"
                "  from ANY current chens case KeyErrors, exactly like a real\n"
                "  buildPayload+solve.py call would given the same malformed input.\n"
                "  Verified separately (not via the corpus) that\n"
                "  translate.to_solver_input's chens branch is itself correct: a\n"
                "  hand-built, schema-complete chens payload (same shape, with\n"
                "  coverageFloorDemand supplied) solves to a real finite optimal\n"
                "  objective through this exact code path."
            )
        results[model_id] = obs
        if not ok:
            failures.append(model_id)

    print()
    print("=== summary ===")
    for model_id in ALL_MODEL_IDS:
        obs = results[model_id]
        print(f"{model_id}: objective={obs.objective}")

    if failures:
        print(f"\nFAIL: {len(failures)}/{len(ALL_MODEL_IDS)} model(s) could not be driven: {failures}")
        return 1

    print(f"\nPASS: all {len(ALL_MODEL_IDS)} models solved for real via translate.to_solver_input")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
