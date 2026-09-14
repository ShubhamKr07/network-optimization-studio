"""Chapter 9 JADE dataset drift guard (jade-T1). Mirrors test_datasets.py's
style but is self-contained (does not import solve.py -- solve_jade() does
not exist yet at this task). Asserts the canonical
`solvers/two-echelon-jade-us/dataset/` package against figures independently
re-derived from the source notebook's get_data() + the scenario-config
cell's plant_product_info (see extract_jade_dataset.py's own docstring for
how those figures were derived, and the design spec's §2.2/§2.7)."""
import hashlib
import json
from pathlib import Path

import pytest

MODEL_ID = "two-echelon-jade-us"
SOLVERS_ROOT = Path(__file__).resolve().parents[5] / "solvers"
DATASET_DIR = SOLVERS_ROOT / MODEL_ID / "dataset"

FILES = [
    "plants.json",
    "products.json",
    "warehouses.json",
    "customers.json",
    "distances.json",
    "plant_product_capability.json",
]


def _load(name):
    with open(DATASET_DIR / name) as f:
        return json.load(f)


def _package_sha256():
    hasher = hashlib.sha256()
    for filename in sorted(FILES):
        hasher.update((DATASET_DIR / filename).read_bytes())
    return hasher.hexdigest()


def test_entity_counts():
    assert len(_load("plants.json")) == 4
    assert len(_load("products.json")) == 4
    assert len(_load("warehouses.json")) == 25
    assert len(_load("customers.json")) == 100


def test_demand_totals_and_per_product_breakdown():
    customers = _load("customers.json")
    all_cells = [tons for c in customers.values() for tons in c["demands"].values()]
    assert len(all_cells) == 400
    assert sum(all_cells) == 1545308

    per_product = {}
    for c in customers.values():
        for pid, tons in c["demands"].items():
            per_product[pid] = per_product.get(pid, 0) + tons
    assert per_product == {
        "product-1": 569324,
        "product-2": 406660,
        "product-3": 325328,
        "product-4": 243996,
    }

    # scalar `demand` is the sum of the four product demands (shared map
    # sizing / legacy consumers) -- spec §3
    for c in customers.values():
        assert c["demand"] == pytest.approx(sum(c["demands"].values()))
        assert set(c["demands"].keys()) == {"product-1", "product-2", "product-3", "product-4"}


def test_distances_composite_key_map():
    distances = _load("distances.json")
    assert len(distances) == 2600

    inbound = {k: v for k, v in distances.items() if k.split(",")[0].startswith("plant-")}
    outbound = {k: v for k, v in distances.items() if k.split(",")[0].startswith("wh-")}
    assert len(inbound) == 100
    assert len(outbound) == 2500

    # every inbound key is "plant-<n>,wh-<n>"; every outbound key is "wh-<n>,customer-<n>"
    for k in inbound:
        frm, to = k.split(",")
        assert frm.startswith("plant-") and to.startswith("wh-")
    for k in outbound:
        frm, to = k.split(",")
        assert frm.startswith("wh-") and to.startswith("customer-")

    assert max(inbound.values()) == 2907.302
    assert max(outbound.values()) == 3219.9609
    assert sum(1 for v in inbound.values() if v > 1600) == 34
    assert sum(1 for v in outbound.values() if v > 1600) == 825


def test_plant_product_capability_matrix():
    cap = _load("plant_product_capability.json")
    assert len(cap) == 16
    nonzero = [c for c in cap if c["capacity"] > 0]
    zero = [c for c in cap if c["capacity"] == 0]
    assert len(nonzero) == 4
    assert len(zero) == 12
    assert all(c["capacity"] == 210000000 for c in nonzero)
    # every (plant, product) pair present exactly once (4x4 cross product)
    pairs = {(c["plantId"], c["productId"]) for c in cap}
    assert len(pairs) == 16


def test_canonical_ids_globally_unique_and_well_formed():
    plants = _load("plants.json")
    products = _load("products.json")
    warehouses = _load("warehouses.json")
    customers = _load("customers.json")

    all_ids = list(plants) + list(products) + list(warehouses) + list(customers)
    assert len(all_ids) == 4 + 4 + 25 + 100
    assert len(all_ids) == len(set(all_ids)), "canonical ids must be globally unique across all entity maps"

    for pid, p in plants.items():
        assert pid == p["id"] == f"plant-{p['sourceId']}"
    for pid, p in products.items():
        assert pid == p["id"] == f"product-{p['sourceId']}"
    for wid, w in warehouses.items():
        assert wid == w["id"] == f"wh-{w['sourceId']}"
    for cid, c in customers.items():
        assert cid == c["id"] == f"customer-{c['sourceId']}"


def test_coordinates_in_us_range():
    for entity_file in ("plants.json", "warehouses.json", "customers.json"):
        for row in _load(entity_file).values():
            assert 24 <= row["lat"] <= 49, f"{entity_file} lat out of US range: {row}"
            assert -125 <= row["lng"] <= -66, f"{entity_file} lng out of US range: {row}"


def test_spot_check_known_warehouses():
    warehouses = _load("warehouses.json")
    assert warehouses["wh-11"]["name"] == "Phoenix"
    assert warehouses["wh-11"]["sourceId"] == 11
    assert warehouses["wh-14"]["name"] == "New York"
    assert warehouses["wh-14"]["sourceId"] == 14


def test_version_matches_sha256():
    version = _load("version.json")
    assert version["sha256"] == _package_sha256()
    assert version["version"] == 1
