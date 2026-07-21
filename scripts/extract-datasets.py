#!/usr/bin/env python3
"""ONE-OFF (C1.1): extract solve.py's embedded dataset blobs into
solvers/<model-id>/dataset/*.json packages. Reads the live module so the
extracted values are exactly what solve.py currently computes — including
the haversine-derived transport/Brazil distance matrices, which were never
stored as static blobs to begin with (only p-median-us's distance matrix
was pre-baked JSON in solve.py; the other two are computed at import time
from lat/lng + a circuity factor). Freezing all three into on-disk JSON
gives every model package the same on-disk shape, which is the point of
this task, but the source computation (haversine * 1.17) is preserved here
in this docstring for future reference since it no longer appears in
solve.py after C1.2 removes the embedded blobs.

Run once, then delete or leave in place marked one-off (not part of any
build step).
"""
import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SOLVER_DIR = REPO_ROOT / "artifacts" / "api-server" / "src" / "solver"
SOLVERS_ROOT = REPO_ROOT / "solvers"

sys.path.insert(0, str(SOLVER_DIR))
import solve as S  # noqa: E402


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=None, separators=(",", ":")) + "\n")


def write_package(model_id: str, files: dict[str, object]) -> None:
    pkg_dir = SOLVERS_ROOT / model_id / "dataset"
    for filename, data in files.items():
        write_json(pkg_dir / filename, data)

    # sha256 of the other files' contents concatenated, in a stable (sorted) order.
    hasher = hashlib.sha256()
    for filename in sorted(files.keys()):
        hasher.update((pkg_dir / filename).read_bytes())
    version = {"version": 1, "sha256": hasher.hexdigest()}
    write_json(pkg_dir / "version.json", version)
    print(f"wrote {model_id}: {list(files.keys())} + version.json (sha256={version['sha256'][:12]}...)")


def main() -> None:
    # ---- p-median-us (Chapter 3, Al's Athletics) ----
    warehouses = {str(k): v for k, v in S.WAREHOUSES.items()}
    customers = {str(k): v for k, v in S.CUSTOMERS.items()}
    distances = {f"{w},{c}": d for (w, c), d in S.DISTANCE.items()}
    write_package("p-median-us", {
        "warehouses.json": warehouses,
        "customers.json": customers,
        "distances.json": distances,
    })
    assert len(warehouses) == 26, len(warehouses)
    assert len(customers) == 200, len(customers)

    # ---- transport-coal (Chapter 5, Coal Transport LP) ----
    mines = S.COAL_MINES
    stations = S.POWER_STATIONS
    costs = {f"{m},{s}": d for (m, s), d in S._transport_distances().items()}
    write_package("transport-coal", {
        "mines.json": mines,
        "stations.json": stations,
        "costs.json": costs,
    })
    assert len(mines) == 4, len(mines)
    assert len(stations) == 15, len(stations)

    # ---- p-median-brazil (Chapter 5, Brazil Capacity) ----
    b_warehouses = S.BRAZIL_WAREHOUSES
    b_states = S.BRAZIL_REGIONS
    b_distances = {f"{w},{r}": d for (w, r), d in S._brazil_distances().items()}
    write_package("p-median-brazil", {
        "warehouses.json": b_warehouses,
        "states.json": b_states,
        "distances.json": b_distances,
    })
    assert len(b_warehouses) == 25, len(b_warehouses)
    assert len(b_states) == 25, len(b_states)


if __name__ == "__main__":
    main()
