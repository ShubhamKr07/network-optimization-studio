#!/usr/bin/env python3
"""One-off extraction of the Chapter 10 mining/gold-refinery dataset from the
source notebook (Notebook_Mining_Problem_Chapter_10_Network_Design_Book.ipynb,
cell 14's get_data() function) into slug-keyed JSON files. Re-keying eliminates
the notebook's id-4 gap (customer ids run 1,2,3,5,6,7,8,9,10,11) and the
refinery/customer id collision (refineries reuse customer ids 3 and 4).
Every coordinate, demand, and distance value below is transcribed VERBATIM
from the notebook's get_data() -- do not "clean up" or round any of them.
"""
import json
import hashlib
from pathlib import Path

DATASET_DIR = Path(__file__).resolve().parent.parent / "solvers" / "two-echelon-gold-au" / "dataset"

# Notebook: plants = {1: ('Kalgoorlie', -30.7495, 121.4667)}
MINES = {
    "kalgoorlie": {"id": "kalgoorlie", "city": "Kalgoorlie", "state": "WA", "lat": -30.7495, "lng": 121.4667},
}

# Notebook: refineries = {3: ('Daggar Hills', -28.15, 117.6), 4: ('Cunnamulla', -28.0716, 145.6695)}
REFINERIES = {
    "daggar-hills": {"id": "daggar-hills", "city": "Daggar Hills", "state": "WA", "lat": -28.15, "lng": 117.6},
    "cunnamulla": {"id": "cunnamulla", "city": "Cunnamulla", "state": "QLD", "lat": -28.0716, "lng": 145.6695},
}

# Notebook: customers = {1: ('Sydney', ...), 2: ('Melbourne', ...), 3: ('Brisbane', ...),
#   5: ('Adelaide', ...), 6: ('Canberra', ...), 7: ('Newcastle', ...), 8: ('Sunshine Coast', ...),
#   9: ('Townsville', ...), 10: ('Cairns', ...), 11: ('Bendigo', ...)}
# demands = {1: 500000.0, 2: 1000000.0, 3: 750000.0, 5: 850000.0, 6: 900000.0, 7: 650000.0,
#   8: 500000.0, 9: 850000.0, 10: 650000.0, 11: 750000.0}  -- sums to 7,400,000 exactly.
CUSTOMERS = {
    "sydney":         {"id": "sydney",         "city": "Sydney",         "state": "NSW", "lat": -33.87, "lng": 151.21, "demand": 500000.0},
    "melbourne":      {"id": "melbourne",      "city": "Melbourne",      "state": "VIC", "lat": -37.81, "lng": 144.96, "demand": 1000000.0},
    "brisbane":       {"id": "brisbane",       "city": "Brisbane",       "state": "QLD", "lat": -27.46, "lng": 153.02, "demand": 750000.0},
    "adelaide":       {"id": "adelaide",       "city": "Adelaide",       "state": "SA",  "lat": -34.93, "lng": 138.6,  "demand": 850000.0},
    "canberra":       {"id": "canberra",       "city": "Canberra",       "state": "ACT", "lat": -35.31, "lng": 149.13, "demand": 900000.0},
    "newcastle":      {"id": "newcastle",      "city": "Newcastle",      "state": "NSW", "lat": -32.92, "lng": 151.75, "demand": 650000.0},
    "sunshine-coast": {"id": "sunshine-coast", "city": "Sunshine Coast", "state": "QLD", "lat": -25.88, "lng": 152.56, "demand": 500000.0},
    "townsville":     {"id": "townsville",     "city": "Townsville",     "state": "QLD", "lat": -19.26, "lng": 146.78, "demand": 850000.0},
    "cairns":         {"id": "cairns",         "city": "Cairns",         "state": "QLD", "lat": -16.92, "lng": 145.75, "demand": 650000.0},
    "bendigo":        {"id": "bendigo",        "city": "Bendigo",        "state": "VIC", "lat": -36.76, "lng": 144.28, "demand": 750000.0},
}

# Notebook: plant_refinery_distance[1,3] = 293.664297837559; plant_refinery_distance[1,4] = 1464.538208
# refinery_customer_distance keyed (refinery_notebook_id, customer_notebook_id) -- copied verbatim,
# re-keyed to slug ids. Distances copied verbatim from the notebook (km/miles per its own "miles" label
# in the print statement, though the values are consistent with km given the geography -- preserve the
# notebook's own unit ambiguity, do not convert). Keyed "fromId,toId".
DISTANCES = {
    "kalgoorlie,daggar-hills": 293.664297837559,
    "kalgoorlie,cunnamulla": 1464.538208,
    "daggar-hills,sydney": 2381.786038127133, "daggar-hills,melbourne": 2019.2091654878682,
    "daggar-hills,brisbane": 2544.0809027606692, "daggar-hills,adelaide": 1555.5031071449534,
    "daggar-hills,canberra": 2250.938462513898, "daggar-hills,newcastle": 2417.0866662776243,
    "daggar-hills,sunshine-coast": 2535.6186541739626, "daggar-hills,townsville": 2287.1587598023734,
    "daggar-hills,cairns": 2299.807802254805, "daggar-hills,bendigo": 1955.652005873137,
    "cunnamulla,sydney": 610.4768065336423, "cunnamulla,melbourne": 794.893579915611,
    "cunnamulla,brisbane": 532.1678895606277, "cunnamulla,adelaide": 743.4459746688292,
    "cunnamulla,canberra": 636.5305273993972, "cunnamulla,newcastle": 581.3653948872694,
    "cunnamulla,sunshine-coast": 531.1082797489862, "cunnamulla,townsville": 722.6628595437319,
    "cunnamulla,cairns": 908.5788876427208, "cunnamulla,bendigo": 714.2678283254355,
}

def compute_sha256(files: dict) -> str:
    # Mirrors lib/dataset-schema's computeSha256() exactly: read each file's
    # RAW BYTES (the exact bytes written to disk, NOT a re-serialized
    # in-memory dict), concatenate in sorted filename order, then sha256.
    # The plan's original draft JSON-stringified the in-memory content, which
    # would diverge from the on-disk bytes whenever the write format differs
    # from sort_keys serialization -- Task 3's PACKAGE_SPECS validation calls
    # the real computeSha256() and must match version.json.
    h = hashlib.sha256()
    for filename in sorted(files.keys()):
        h.update((DATASET_DIR / filename).read_bytes())
    return h.hexdigest()

def main():
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    files = {
        "mines.json": MINES,
        "refineries.json": REFINERIES,
        "customers.json": CUSTOMERS,
        "distances.json": DISTANCES,
    }

    # Extraction assertions (M0.2)
    assert len(CUSTOMERS) == 10, f"expected 10 customers, got {len(CUSTOMERS)}"
    assert sum(c["demand"] for c in CUSTOMERS.values()) == 7_400_000, "total demand must be 7,400,000"
    assert len(REFINERIES) == 2 and len(MINES) == 1
    assert len(DISTANCES) == 22, f"expected 22 distance pairs, got {len(DISTANCES)}"
    all_nodes = list(MINES.values()) + list(REFINERIES.values()) + list(CUSTOMERS.values())
    assert all(-38.5 <= v["lat"] <= -16.0 for v in all_nodes), "lat out of Australian range"
    assert all(113.0 <= v["lng"] <= 155.0 for v in all_nodes), "lng out of Australian range"

    for filename, content in files.items():
        (DATASET_DIR / filename).write_text(json.dumps(content, indent=2) + "\n")

    version = {"version": 1, "sha256": compute_sha256(files)}
    (DATASET_DIR / "version.json").write_text(json.dumps(version, indent=2) + "\n")

    print(f"Extracted {len(files)} files + version.json to {DATASET_DIR}")
    print(f"sha256: {version['sha256']}")

if __name__ == "__main__":
    main()
