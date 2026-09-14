#!/usr/bin/env python3
"""One-off extraction of the Chapter 9 JADE dataset (Watson et al., *Supply
Chain Network Design*, "JADE Investment Decision" case study) from the
source notebook (JADE_case_Chapter_9_Network_Design_Book.ipynb) into the
canonical `solvers/two-echelon-jade-us/dataset/` package.

Usage:
    python3 extract_jade_dataset.py [/path/to/JADE_case_Chapter_9_Network_Design_Book.ipynb]

The path argument is optional; a few conventional locations are tried first
(see `_find_notebook`). The notebook itself is NOT part of this repo and is
NOT a runtime/build dependency of the app -- it is provenance only. Only the
generated JSON package under `solvers/two-echelon-jade-us/dataset/` is
committed and consumed at runtime.

Extraction method (Gate 3 solver hygiene applies to this script too):
this script NEVER `exec`s or imports the notebook. Its top level runs
`!pip install`, solves the model, writes files, and renders Plotly maps --
executing it would be both unsafe and pointless (it doesn't hand back
Python values, it writes to disk / draws HTML). Instead:

  1. The notebook is parsed as plain JSON (`.ipynb` is JSON).
  2. The `get_data()` cell's source is located by searching for its
     `def get_data():` signature, then parsed with `ast.parse` -- never
     executed. The single top-level `FunctionDef` node is found, and only
     the literal (constant-only) assignment statements inside its body are
     evaluated with `ast.literal_eval` (never `eval`/`exec`): `customers`,
     `warehouses`, `plants`, `products`, `customer_demands`,
     `plant_wh_distance`, `wh_cust_distance` -- exactly the 7 values
     `get_data()` returns.
  3. The scenario-config cell (the one defining `number_of_whs` alongside
     the real `plant_product_info` capacity matrix that the notebook's
     `optimal_location(...)` call site actually uses -- NOT the throwaway
     4-entry literal that appears, unused, inside `get_data()`'s own body
     as a comment example) is located the same way and its *module-level*
     `plant_product_info` assignment is literal_eval'd.

The notebook's integer ids are NOT safe wire ids: plants 1-4 overlap
customer ids 1-4, plants 1-3 overlap warehouse ids 1-3, and all 25
warehouse ids overlap customer ids (warehouses are a strict subset of the
customer id space). Every entity is re-keyed into one globally unique
canonical namespace (`plant-<n>`, `product-<n>`, `wh-<notebookId>`,
`customer-<notebookId>`) and retains its integer notebook id as
display-only `sourceId`.

All distances/demands/coordinates are transcribed verbatim from the
notebook -- never recomputed or "corrected" (Gate 2).
"""
import argparse
import ast
import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]
DATASET_DIR = REPO_ROOT / "solvers" / "two-echelon-jade-us" / "dataset"

GET_DATA_NAMES = (
    "customers",
    "warehouses",
    "plants",
    "products",
    "customer_demands",
    "plant_wh_distance",
    "wh_cust_distance",
)


def _find_notebook(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit).expanduser().resolve()
        if not p.exists():
            raise SystemExit(f"notebook not found: {p}")
        return p
    candidates = [
        Path.home() / "Downloads" / "network-optimization-studio" / "JADE_case_Chapter_9_Network_Design_Book.ipynb",
        REPO_ROOT / "JADE_case_Chapter_9_Network_Design_Book.ipynb",
        REPO_ROOT / "attached_assets" / "JADE_case_Chapter_9_Network_Design_Book.ipynb",
    ]
    for c in candidates:
        if c.exists():
            return c
    raise SystemExit(
        "Notebook not found in any conventional location. Pass its path explicitly:\n"
        "  python3 extract_jade_dataset.py /path/to/JADE_case_Chapter_9_Network_Design_Book.ipynb"
    )


def _code_cell_sources(notebook_path: Path) -> list[str]:
    """Reads the .ipynb as plain JSON (never executed) and returns every code
    cell's joined source text."""
    with open(notebook_path, encoding="utf-8") as f:
        nb = json.load(f)
    return ["".join(cell.get("source", [])) for cell in nb["cells"] if cell.get("cell_type") == "code"]


def _literal_assignments(body: list[ast.stmt], names: tuple[str, ...]) -> dict:
    """ast.literal_eval's every top-level `name = <literal>` assignment in
    `body` whose target is one of `names`. Never executes anything --
    `ast.literal_eval` only accepts constant literal expressions (dicts,
    tuples, numbers, strings, bools), raising on anything else."""
    result = {}
    for node in body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id in names
        ):
            result[node.targets[0].id] = ast.literal_eval(node.value)
    return result


def _extract_get_data(sources: list[str]) -> dict:
    for src in sources:
        if "def get_data():" not in src:
            continue
        tree = ast.parse(src)
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == "get_data":
                found = _literal_assignments(node.body, GET_DATA_NAMES)
                missing = set(GET_DATA_NAMES) - set(found)
                if missing:
                    raise SystemExit(f"get_data() cell found but missing assignments: {sorted(missing)}")
                return found
    raise SystemExit("no cell defining get_data() found in the notebook")


def _extract_plant_product_capability(sources: list[str]) -> dict:
    """The real capacity matrix the model solves against is the
    module-level `plant_product_info` defined in the scenario-config cell
    (identified by also defining `number_of_whs`), NOT the 4-entry literal
    that appears, unused, inside get_data()'s own function body."""
    for src in sources:
        if "number_of_whs" not in src or "plant_product_info" not in src:
            continue
        tree = ast.parse(src)
        found = _literal_assignments(tree.body, ("plant_product_info",))
        if "plant_product_info" in found:
            return found["plant_product_info"]
    raise SystemExit("no scenario-config cell with a module-level plant_product_info found")


def _canonicalize(raw: dict, capability_raw: dict) -> dict:
    customers_raw = raw["customers"]
    warehouses_raw = raw["warehouses"]
    plants_raw = raw["plants"]
    products_raw = raw["products"]
    customer_demands = raw["customer_demands"]
    plant_wh_distance = raw["plant_wh_distance"]
    wh_cust_distance = raw["wh_cust_distance"]

    product_ids = sorted(products_raw.keys())

    plants = {}
    for pid in sorted(plants_raw.keys()):
        name, city, state, _zip, _country, lat, lng = plants_raw[pid]
        plants[f"plant-{pid}"] = {
            "id": f"plant-{pid}",
            "sourceId": pid,
            "name": name.strip(),
            "city": city.strip(),
            "state": state.strip(),
            "lat": lat,
            "lng": lng,
        }

    products = {}
    for kid in product_ids:
        products[f"product-{kid}"] = {
            "id": f"product-{kid}",
            "sourceId": kid,
            "name": products_raw[kid].strip(),
        }

    warehouses = {}
    for wid in sorted(warehouses_raw.keys()):
        name, _active, _status, city, state, zip_code, _country, lat, lng = warehouses_raw[wid]
        warehouses[f"wh-{wid}"] = {
            "id": f"wh-{wid}",
            "sourceId": wid,
            "name": name.strip(),
            "city": city.strip(),
            "state": state.strip(),
            "zip": str(zip_code),
            "lat": lat,
            "lng": lng,
        }

    customers = {}
    for cid in sorted(customers_raw.keys()):
        name, _active, city, state, zip_code, _country, lat, lng = customers_raw[cid]
        demands = {f"product-{kid}": customer_demands[(cid, kid)] for kid in product_ids}
        customers[f"customer-{cid}"] = {
            "id": f"customer-{cid}",
            "sourceId": cid,
            "name": name.strip(),
            "city": city.strip(),
            "state": state.strip(),
            "zip": str(zip_code),
            "lat": lat,
            "lng": lng,
            "demand": sum(demands.values()),
            "demands": demands,
        }

    distances = {}
    for (pid, wid), miles in plant_wh_distance.items():
        distances[f"plant-{pid},wh-{wid}"] = miles
    for (wid, cid), miles in wh_cust_distance.items():
        distances[f"wh-{wid},customer-{cid}"] = miles

    capability = [
        {"plantId": f"plant-{pid}", "productId": f"product-{kid}", "capacity": cap}
        for (pid, kid), cap in sorted(capability_raw.items())
    ]

    return {
        "plants.json": plants,
        "products.json": products,
        "warehouses.json": warehouses,
        "customers.json": customers,
        "distances.json": distances,
        "plant_product_capability.json": capability,
    }


def _assert_invariants(files: dict) -> None:
    """Mirrors the extraction assertions in test_jade_dataset.py -- fails
    loudly at generation time rather than silently drifting."""
    assert len(files["plants.json"]) == 4, f"expected 4 plants, got {len(files['plants.json'])}"
    assert len(files["products.json"]) == 4, f"expected 4 products, got {len(files['products.json'])}"
    assert len(files["warehouses.json"]) == 25, f"expected 25 warehouses, got {len(files['warehouses.json'])}"
    assert len(files["customers.json"]) == 100, f"expected 100 customers, got {len(files['customers.json'])}"

    all_demand_cells = [v for c in files["customers.json"].values() for v in c["demands"].values()]
    assert len(all_demand_cells) == 400, f"expected 400 demand cells, got {len(all_demand_cells)}"
    total_demand = sum(all_demand_cells)
    assert total_demand == 1545308, f"expected total demand 1545308, got {total_demand}"

    per_product = {}
    for c in files["customers.json"].values():
        for pid, tons in c["demands"].items():
            per_product[pid] = per_product.get(pid, 0) + tons
    expected_per_product = {"product-1": 569324, "product-2": 406660, "product-3": 325328, "product-4": 243996}
    assert per_product == expected_per_product, f"per-product totals mismatch: {per_product}"

    distances = files["distances.json"]
    assert len(distances) == 2600, f"expected 2600 distance pairs, got {len(distances)}"
    inbound = {k: v for k, v in distances.items() if k.split(",")[0].startswith("plant-")}
    outbound = {k: v for k, v in distances.items() if k.split(",")[0].startswith("wh-")}
    assert len(inbound) == 100, f"expected 100 inbound (plant->wh) pairs, got {len(inbound)}"
    assert len(outbound) == 2500, f"expected 2500 outbound (wh->customer) pairs, got {len(outbound)}"
    assert max(inbound.values()) == 2907.302, f"plant_wh max distance mismatch: {max(inbound.values())}"
    assert max(outbound.values()) == 3219.9609, f"wh_cust max distance mismatch: {max(outbound.values())}"
    assert sum(1 for v in inbound.values() if v > 1600) == 34
    assert sum(1 for v in outbound.values() if v > 1600) == 825

    capability = files["plant_product_capability.json"]
    assert len(capability) == 16, f"expected 16 capability cells, got {len(capability)}"
    nonzero = [c for c in capability if c["capacity"] > 0]
    assert len(nonzero) == 4, f"expected 4 non-zero capability cells, got {len(nonzero)}"
    assert all(c["capacity"] == 210000000 for c in nonzero)

    all_ids = (
        list(files["plants.json"].keys())
        + list(files["products.json"].keys())
        + list(files["warehouses.json"].keys())
        + list(files["customers.json"].keys())
    )
    assert len(all_ids) == len(set(all_ids)), "canonical ids must be globally unique across all entity maps"

    for entity_file in ("plants.json", "warehouses.json", "customers.json"):
        for row in files[entity_file].values():
            assert 24 <= row["lat"] <= 49, f"{entity_file} lat out of US range: {row}"
            assert -125 <= row["lng"] <= -66, f"{entity_file} lng out of US range: {row}"

    assert files["warehouses.json"]["wh-11"]["name"] == "Phoenix"
    assert files["warehouses.json"]["wh-14"]["name"] == "New York"


def _compute_sha256(files: dict) -> str:
    """Mirrors lib/dataset-schema's computeSha256() exactly: hash each
    file's RAW BYTES as written to disk (not a re-serialized in-memory
    value), concatenated in sorted filename order."""
    h = hashlib.sha256()
    for filename in sorted(files.keys()):
        h.update((DATASET_DIR / filename).read_bytes())
    return h.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("notebook", nargs="?", help="Path to JADE_case_Chapter_9_Network_Design_Book.ipynb")
    args = parser.parse_args()

    notebook_path = _find_notebook(args.notebook)
    sources = _code_cell_sources(notebook_path)

    raw = _extract_get_data(sources)
    capability_raw = _extract_plant_product_capability(sources)
    files = _canonicalize(raw, capability_raw)

    _assert_invariants(files)

    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    for filename, content in files.items():
        (DATASET_DIR / filename).write_text(json.dumps(content, indent=2) + "\n")

    version = {"version": 1, "sha256": _compute_sha256(files)}
    (DATASET_DIR / "version.json").write_text(json.dumps(version, indent=2) + "\n")

    print(f"Parsed notebook: {notebook_path}")
    print(f"Wrote {len(files)} files + version.json to {DATASET_DIR}")
    print(f"sha256: {version['sha256']}")


if __name__ == "__main__":
    main()
