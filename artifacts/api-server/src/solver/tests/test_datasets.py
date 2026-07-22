"""C1.3 drift guard: solve.py's loaded dataset packages must match their own
version.json sha256 — the Python-side counterpart to
artifacts/api-server/src/__tests__/datasets.test.ts on the TS side."""
import hashlib
import json
import sys
from pathlib import Path

SOLVER_DIR = Path(__file__).parent.parent
SOLVERS_ROOT = SOLVER_DIR.parent.parent.parent.parent / "solvers"

sys.path.insert(0, str(SOLVER_DIR))
import solve as S  # noqa: E402


def package_sha256(model_id: str, filenames: list[str]) -> str:
    pkg_dir = SOLVERS_ROOT / model_id / "dataset"
    hasher = hashlib.sha256()
    for filename in sorted(filenames):
        hasher.update((pkg_dir / filename).read_bytes())
    return hasher.hexdigest()


def package_version(model_id: str) -> dict:
    with open(SOLVERS_ROOT / model_id / "dataset" / "version.json") as f:
        return json.load(f)


def test_p_median_us_matches_its_version():
    version = package_version("p-median-us")
    assert package_sha256("p-median-us", ["warehouses.json", "customers.json", "distances.json"]) == version["sha256"]
    assert len(S.WAREHOUSES) == 26
    assert len(S.CUSTOMERS) == 200


def test_transport_coal_matches_its_version():
    version = package_version("transport-coal")
    assert package_sha256("transport-coal", ["mines.json", "stations.json", "costs.json"]) == version["sha256"]
    assert len(S.COAL_MINES) == 4
    assert len(S.POWER_STATIONS) == 15


def test_p_median_brazil_matches_its_version():
    version = package_version("p-median-brazil")
    assert package_sha256("p-median-brazil", ["warehouses.json", "states.json", "distances.json"]) == version["sha256"]
    assert len(S.BRAZIL_WAREHOUSES) == 25
    assert len(S.BRAZIL_REGIONS) == 25


def test_solve_py_and_ts_agree_on_corrected_warehouse_labels():
    """C2.1 label fix must be visible from the Python side too — solve.py and
    the TS dataset route both read the same canonical file, so this should
    never drift, but it's cheap to assert directly."""
    by_id = {w["id"]: w for w in S.WAREHOUSES.values()}
    assert by_id["SFO"]["city"] == "San Francisco"
    assert by_id["SFO"]["state"] == "CA"
    assert by_id["STL"]["city"] == "St. Louis"
    assert by_id["STL"]["state"] == "MO"
    assert by_id["LBB"]["city"] == "Lubbock - Current WH"
