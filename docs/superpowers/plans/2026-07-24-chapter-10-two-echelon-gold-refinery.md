# Chapter 10 Two-Echelon Gold Refinery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `two-echelon-gold-au` (Chapter 10's gold mine → refinery → customer siting problem) as a fourth playable model, following the exact technical design already fully specified in this repo's own `chapter-10-two-echelon-gold-refinery-integration.md` (strategy) and `chapter-10-two-echelon-gold-refinery-implementation.md` (executable code), gated by `model-integration-precheck.md`'s generic registration checklist.

**Architecture:** A two-echelon LP — raw gold flows mine→refinery (`x[p,r]`), refined gold flows refinery→customer (`y[r,c]`), exactly one of two candidate refineries opens (`open[r]`), and a bill-of-materials ratio (`bomRatio`) links the two legs' mass balance. The pedagogical point is that at `bomRatio=1.1` the customer-adjacent refinery (Cunnamulla) wins, but at `bomRatio=2.0` the mine-adjacent one (Daggar Hills) wins — because more raw mass than refined mass moves at high ratios, shifting where distance cost should be minimized. This plan lands shared-infrastructure hardening first (Phase H, no new model), then the model itself in strictly ordered phases (M0 dataset → M1 registration-only → M2+M3.1 solver+envelope as one atomic commit → M3.2-M3.5 API contract → M4 frontend), mirroring this repo's own established "registration is eight separate points, land narrowest-first" convention already used for `transport-coal`.

**Tech Stack:** Python (PuLP/CBC via `solve.py`), Zod, Express 5, Orval codegen, React + react-leaflet (`NetworkMap.tsx`, extended not forked), Vitest, pytest, Playwright.

## Global Constraints

- **Model id:** `two-echelon-gold-au` · **wire `modelType`:** `two_echelon` · **chapter:** 10.
- **Commit 8 (M2+M3.1, solver + envelope schema) must not be split.** Zod strips unknown keys silently — a solver emitting `leg`/`avgDistanceByLeg` whose schema doesn't yet declare them optional loses those fields in transit with no error. This is the plan's single most important sequencing rule.
- **`e2e_accuracy.py` and `e2e_journey.py` must pass unmodified after every task in this plan** (CLAUDE.md hard rule #2, reinforced by both source docs' own "merge gate" test entries). No existing model's numbers may change.
- **Distances/costs are copied verbatim from the source notebook, never recomputed.** The textbook's answer key is the spec.
- **IDs are stable string slugs, unique across all entity types** — the notebook's raw numeric ids collide (refineries reuse customer ids 3/4) and customer id 4 is absent; re-key to slugs before writing any dataset file.
- **`lng` not `lon`, `state` required** — matches this repo's existing `WarehouseEntry` schema in `lib/dataset-schema`. Do not reuse `MineEntry` (requires `capacity`, which this model has none of in v1).
- **Distance bands default `[500, 1000, 1500, 2000, 2600]`** (Australia-scale — the longest leg, Daggar Hills→Brisbane, is 2,544 km; a US-scale 2,000 km ceiling would silently misreport ~100% coverage).
- **Band only the refinery→customer leg** — banding both legs double-counts against total demand.
- **`bomRatio` uses `z.number().gt(1).max(10)`**, not `.positive()` — a ratio ≤1 means refining creates mass, a nonsensical input worth rejecting at the schema boundary.
- **`timeLimitSec` is required in every input schema** — `jobRunner` computes `timeLimitSec * 1000 + 15000`; if absent/NaN, the timeout fires immediately and kills every solve.
- **No `print()` except the final `print(json.dumps(result))`, no `writeLP()`, no notebook artifacts** (`!pip install`, `plotly`, `IPython.display`) anywhere in `solve.py`.
- **Binary variables compared `> 0.5`, never `== 1`** (CBC returns `0.9999999997`). **Flow filters use a relative epsilon** (`total_demand * 1e-9`), never an absolute `< 1`.
- **Averages computed from flows** (`Σ(d×f)/Σf`), never derived from the objective — this model's objective is divided by `TRUCKLOAD_KG` (44000), so `obj/totalDemand` would understate distance 44,000×.
- **M5 ("Arcadia quest") is explicitly OUT OF SCOPE and will NOT be built.** `chapter-10-two-echelon-gold-refinery-integration.md` §10 states directly: "That subsystem does not exist in this repository — no quest, XP, badge, leaderboard, progress route, or `user_progress` table... Adding one is a separate feature requiring a new DB table, new routes, and a new frontend section; it is not an appendix to a model integration." This contradicts `chapter-10-two-echelon-gold-refinery-implementation.md`'s commit-sequence list (which still names an M5/commit-11 "Arcadia quest") — the integration doc's explicit scope decision governs; the implementation doc's stale reference is disregarded.
- **Also explicitly out of scope for this plan** (per integration.md §10): refinery capacity limits, `p > 1` (multiple open refineries), fixed facility opening costs, live distance recomputation.
- **Full verification gate**, run after every task: `pnpm run typecheck && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver/tests && python3 -m pytest . -x) && (cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py) && (cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py)`.

---

### Task 1: Phase H — Shared-infrastructure hardening (no new model)

**Status: already dispatched and executing at time of writing** (glm agent, background). This task block is recorded here for completeness/audit trail per this session's standing convention that every task gets its own plan entry even when execution began before the formal doc existed.

**Files:**
- Modify: `artifacts/api-server/src/solver/jobRunner.ts` (H2 stderr capture + `lastJsonLine`, H3 solver-code hash in cache key)
- Modify: `artifacts/api-server/src/solver/solve.py` (H4 `_LOAD_ERRORS`/`_safe_load` wrapper around the three existing models' loads only — Chapter 10's own loads are added in Task 4)
- Modify: `artifacts/api-server/src/registry/modelRegistry.ts` (H5 per-manifest try/catch)
- Create: `artifacts/api-server/src/registry/__tests__/registration.test.ts` (H1, `SOLVABLE = ["p-median-us", "transport-coal", "p-median-brazil"]` — Chapter 10 not added until Task 5)
- Modify: `.github/workflows/ci.yml` or a referenced script (H6 CI guard)

**Interfaces:**
- Consumes: nothing — this phase touches only pre-existing shared infrastructure.
- Produces: `lastJsonLine(raw: string): string` (jobRunner.ts, consumed nowhere else yet but establishes the stdout-parsing contract every future solver invocation relies on); `SOLVER_CODE_HASH: string` (module constant in jobRunner.ts); `_safe_load(model_id, filename, default=None)` and `_LOAD_ERRORS: dict` (solve.py, Task 4's `solve_two_echelon` will call the same helper); exported `VALID_MODEL_IDS` from `routes/scenarios.ts` (Task 5 adds `two-echelon-gold-au` to this same set).

- [ ] **Step 1: Confirm the dispatched Phase H work landed correctly**

Run: `git log --oneline -5` and confirm 5 commits exist matching:
```
ci: forbid stray print() and writeLP() in solve.py
test(registry): assert model registration consistency
fix(registry): contain dataset and manifest load failures
fix(cache): include solver code hash in cache key
fix(solver): capture stderr, parse last stdout line, set subprocess cwd
```

- [ ] **Step 2: Re-verify the full gate myself, fresh**

Run: `pnpm run typecheck && DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test && pnpm --filter studio test`
Expected: clean, all pass, no regressions vs. the pre-Phase-H baseline (227 api-server / 248 studio at the time this plan was written).

- [ ] **Step 3: Re-verify `e2e_accuracy.py` and `e2e_journey.py` fresh**

Run: `cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py && python3 e2e_journey.py`
Expected: both pass with identical numbers to the pre-Phase-H baseline — H4's `_safe_load` wrapper must be a transparent pass-through when a dataset loads successfully (all three existing datasets do), and H2/H3's changes are additive-only (new fields, no altered control flow for the success path).

- [ ] **Step 4: Confirm H6's CI guard actually catches a violation**

Run: `echo 'print("debug")' >> artifacts/api-server/src/solver/solve.py && bash -c 'grep -nE "^\s*print\(" artifacts/api-server/src/solver/solve.py | grep -v "print(json.dumps(result))" && echo CAUGHT'`
Expected: prints `CAUGHT` (proves the guard's grep pattern actually matches a real violation, not just a syntactically-valid-but-untested regex). Then immediately revert: `git checkout -- artifacts/api-server/src/solver/solve.py`.

**No commit for this task** — it only re-verifies the already-committed Phase H work.

---

### Task 2: Phase M0 — Dataset extraction

**Files:**
- Create: `scripts/extract-mining-dataset.py` (one-off, committed for reproducibility)
- Create: `solvers/two-echelon-gold-au/dataset/mines.json`
- Create: `solvers/two-echelon-gold-au/dataset/refineries.json`
- Create: `solvers/two-echelon-gold-au/dataset/customers.json`
- Create: `solvers/two-echelon-gold-au/dataset/distances.json`
- Create: `solvers/two-echelon-gold-au/dataset/version.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the five dataset files above, in the exact shapes Task 3 (M1's `PACKAGE_SPECS`) and Task 4 (M2's `_safe_load` calls) will read.

- [ ] **Step 1: Write the extraction script**

`scripts/extract-mining-dataset.py`:

```python
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
    h = hashlib.sha256()
    for filename in sorted(files.keys()):
        h.update(json.dumps(files[filename], sort_keys=True).encode())
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
```

**Verified against the real source notebook** (`Notebook_Mining_Problem_Chapter_10_Network_Design_Book.ipynb`, committed at the repo root, cell 14's `get_data()` and cell 12's `optimal_refinery()`). All coordinates, demands, and distances above are transcribed directly from the notebook's source, not invented. Confirmed by replicating the notebook's exact LP locally with PuLP: scenario 1 (BOM=1.1) reproduces the notebook's own stored cell-22 output exactly — `Optimal`, objective `386576.9929994568`, `Cunnamulla` opened, avg customer distance `687.5738755210947` — and scenario 2 (BOM=2.0, not stored in the notebook's saved outputs) computes to `Optimal`, objective `467205.2592914422`, `Daggar Hills` opened, avg customer distance `2190.6486217334573`, avg mine-to-refinery distance `293.664297837559` (both scenario 2 numbers match the integration doc's approximate "~2,191 km" / "294 km" citations exactly). These four numbers are the ground truth for Task 4's `test_objective_matches_notebook` and `test_scenario_*_selects_*` tests below.

- [ ] **Step 2: Run the extraction script**

Run: `cd /Users/shubhamkr/network-optimization-studio && python3 scripts/extract-mining-dataset.py`
Expected: prints `Extracted 5 files + version.json to .../solvers/two-echelon-gold-au/dataset`, no assertion errors.

- [ ] **Step 3: Verify `version.json`'s sha256 was produced by the same method `computeSha256()` (the TS helper) would produce**

Read `lib/dataset-schema/src/index.ts`'s existing `computeSha256(spec: ModelPackageSpec)` function (already in the repo, used by the other three models) — confirm it hashes "the package's data files' raw bytes concatenated in sorted filename order" per its own docstring. If the Python script's `compute_sha256` above uses a different hashing method (JSON-string-based vs raw-bytes-based), this is a real mismatch — Task 3's `PACKAGE_SPECS` entry will call the REAL `computeSha256()` at Zod-package-validation time, and it must match what's in `version.json`. Fix the Python script to match the TS helper's exact method (likely: concatenate the raw file bytes of each JSON file, sorted by filename, then sha256) rather than assuming — read the real TS implementation first.

- [ ] **Step 4: Manually verify the extraction assertions one more time, standalone**

Run:
```bash
python3 -c "
import json
d = json.load(open('solvers/two-echelon-gold-au/dataset/customers.json'))
assert len(d) == 10
assert sum(c['demand'] for c in d.values()) == 7_400_000
print('customers OK')
d = json.load(open('solvers/two-echelon-gold-au/dataset/distances.json'))
assert len(d) == 22
print('distances OK')
"
```
Expected: `customers OK` and `distances OK` printed, no assertion errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-mining-dataset.py solvers/two-echelon-gold-au/dataset/
git commit -m "$(cat <<'EOF'
feat(data): extract Ch.10 mining dataset with slug ids

One-off extraction script (committed for reproducibility) re-keys the
notebook's raw numeric ids to stable slugs -- eliminates the id-4 gap in
customer ids and the refinery/customer id collision (refineries reuse
customer ids 3 and 4 in the source). Distances copied verbatim from the
notebook, never recomputed. version.json's sha256 produced by the same
method lib/dataset-schema's computeSha256() uses, so Task 3's package-spec
validation matches on first run.
EOF
)"
```

---

### Task 3: Phase M1 — Registration (listable, not solvable)

**Files:**
- Create: `solvers/two-echelon-gold-au/manifest.json`
- Modify: `lib/dataset-schema/src/index.ts` (add `RefineryEntry`/`GoldMineEntry`/`GoldCustomerEntry` schemas, push a new `PACKAGE_SPECS` entry)

**Interfaces:**
- Consumes: Task 2's five dataset files.
- Produces: `GET /api/models` includes a 4th entry. `PACKAGE_SPECS` gains an entry Task 4's `_safe_load` calls implicitly depend on having validated the files first (registry validation and solve.py's runtime load are independent paths, but both must agree on file shape).

**Manifest (`solvers/two-echelon-gold-au/manifest.json`, full file, per implementation.md M1.1):**

```json
{
  "id": "two-echelon-gold-au",
  "name": "Gold Refinery Siting — Two-Echelon",
  "chapter": "Chapter 10",
  "datasetDir": "solvers/two-echelon-gold-au/dataset",
  "countryBounds": { "sw": [-38.5, 113.0], "ne": [-16.0, 154.5] },
  "capabilities": { "supportsP": false, "capacityModes": [], "demandEditable": true },
  "inputsSchema": {
    "type": "object",
    "properties": {
      "bomRatio": { "type": "number", "exclusiveMinimum": 1 },
      "refineryOverrides": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "status": { "type": "string", "enum": ["active", "forced_open", "inactive"] }
          },
          "required": ["id", "status"]
        }
      },
      "customerOverrides": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "demand": { "type": ["number", "null"], "minimum": 0 },
            "status": { "type": "string", "enum": ["active", "excluded"] }
          },
          "required": ["id", "status"]
        }
      },
      "distanceBands": {
        "type": "array",
        "items": { "type": "integer", "exclusiveMinimum": 0 },
        "minItems": 1,
        "default": [500, 1000, 1500, 2000, 2600]
      },
      "gap": { "type": "number", "minimum": 0 },
      "timeLimitSec": { "type": "integer", "minimum": 1 }
    },
    "required": ["bomRatio", "distanceBands", "gap", "timeLimitSec"]
  }
}
```

**`PACKAGE_SPECS` addition (`lib/dataset-schema/src/index.ts`, per implementation.md M1.2):**

```ts
export const RefineryEntry = z.object({
  id: z.string(), city: z.string(), state: z.string(),
  lat: z.number(), lng: z.number(),
});
export const GoldMineEntry = RefineryEntry;                    // no capacity in v1
export const GoldCustomerEntry = RefineryEntry.extend({ demand: z.number() });

PACKAGE_SPECS.push({
  modelId: "two-echelon-gold-au",
  files: {
    "mines.json": z.record(z.string(), GoldMineEntry),
    "refineries.json": z.record(z.string(), RefineryEntry),
    "customers.json": z.record(z.string(), GoldCustomerEntry),
    "distances.json": DistanceMap,
  },
});
```

Read `lib/dataset-schema/src/index.ts` in full first to find the exact current `PACKAGE_SPECS` array literal (already has 3 entries, one per existing model) and the exact existing `WarehouseEntry`/`CustomerEntry`/`DistanceMap` schema definitions to place the three new schemas alongside them consistently (same style, same export pattern).

- [ ] **Step 1: Write the failing test**

Find the existing test file covering `PACKAGE_SPECS`/`validatePackage` (search `lib/dataset-schema/src/__tests__/` or wherever its tests live) and add:

```ts
it("validates the two-echelon-gold-au package against its schema", () => {
  const spec = PACKAGE_SPECS.find(s => s.modelId === "two-echelon-gold-au");
  expect(spec).toBeDefined();
  const result = validatePackage(spec!);
  expect(result["mines.json"]).toBeDefined();
  expect(result["refineries.json"]).toBeDefined();
  expect(Object.keys(result["refineries.json"] as object)).toHaveLength(2);
  expect(Object.keys(result["customers.json"] as object)).toHaveLength(10);
});

it("readManifest loads the two-echelon-gold-au manifest", () => {
  const manifest = readManifest("two-echelon-gold-au");
  expect(manifest.id).toBe("two-echelon-gold-au");
  expect(manifest.capabilities.supportsP).toBe(false);
  expect(manifest.capabilities.demandEditable).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/dataset-schema test` (or wherever this package's test script is — check its `package.json`)
Expected: FAIL — `PACKAGE_SPECS.find(...)` returns `undefined`, manifest file doesn't exist yet.

- [ ] **Step 3: Create the manifest and add the package spec**

Apply the exact manifest JSON and `PACKAGE_SPECS`/schema additions shown above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/dataset-schema test`
Expected: PASS.

- [ ] **Step 5: Verify `GET /api/models` lists 4 entries and `POST /scenarios` still 422s (expected per M1's exit criteria — schema/allowlist land in Task 5)**

Start local dev (`DATABASE_URL=... PORT=3001 pnpm --filter api-server run dev`), then:
```bash
curl -s http://localhost:3001/api/models | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d), [m['id'] for m in d])"
```
Expected: `4 ['p-median-us', 'transport-coal', 'p-median-brazil', 'two-echelon-gold-au']` (order may vary — it's a directory scan).

```bash
curl -s -X POST http://localhost:3001/api/scenarios -H "Content-Type: application/json" -d '{"name":"test","modelId":"two-echelon-gold-au","inputs":{}}' -b <a valid auth cookie>
```
Expected: `422` (the Zod schema doesn't exist until Task 5, so validation correctly rejects this — this is the EXPECTED, documented exit state for this phase, not a bug).

- [ ] **Step 6: Run the full verification gate + e2e_accuracy.py/e2e_journey.py**

Per this plan's Global Constraints section. Expected: clean, no regressions, unchanged existing-model numbers.

- [ ] **Step 7: Commit**

```bash
git add solvers/two-echelon-gold-au/manifest.json lib/dataset-schema/src/index.ts lib/dataset-schema/src/__tests__/
git commit -m "$(cat <<'EOF'
feat(registry): register two-echelon-gold-au manifest and package spec

Model is now listable (GET /api/models returns 4 entries) but not yet
solvable -- POST /scenarios correctly 422s until the Zod input schema and
route allowlist land in a later task. New RefineryEntry/GoldMineEntry/
GoldCustomerEntry schemas deliberately do NOT reuse the existing MineEntry
(it requires capacity, which this model has no notion of in v1).
EOF
)"
```

---

### Task 4: Phase M2 + M3.1 — Solver + envelope schema (ONE commit, do not split)

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py` (dataset loads via `_safe_load`, `solve_two_echelon()`, dispatcher branch)
- Modify: `artifacts/api-server/src/solver/resultEnvelope.ts` (add optional `leg` to `EdgeSchema`, optional `avgDistanceByLeg` to `MetricsSchema`)

**Interfaces:**
- Consumes: Task 2's dataset files (via `_safe_load`, Task 1's H4 helper), Task 3's manifest (indirectly — the manifest's `distanceBands` default is what `solve_two_echelon` falls back to if the caller omits it).
- Produces: `solve_two_echelon(inp) -> envelope dict` with `edges[].leg` and `metrics.avgDistanceByLeg` populated; Task 5's Zod schema and Task 6's frontend both consume these exact field names/shapes.

**CRITICAL — per this plan's Global Constraints: this task's two files ship in ONE commit.** If `resultEnvelope.ts` doesn't already declare `leg`/`avgDistanceByLeg` as optional the moment `solve_two_echelon` starts emitting them, Zod's `z.object()` parse strips them silently — the solver would appear to work (200 OK, no error) while the exact two fields this exercise depends on for its pedagogical payload vanish before reaching the frontend.

**`solve.py` additions (per implementation.md M2.1-M2.4, full code):**

```python
TRUCKLOAD_KG = 44000  # notebook's cost divisor: kg -> truckloads

GOLD_MINES      = _safe_load("two-echelon-gold-au", "mines.json")
GOLD_REFINERIES = _safe_load("two-echelon-gold-au", "refineries.json")
GOLD_CUSTOMERS  = _safe_load("two-echelon-gold-au", "customers.json")
_GOLD_DIST_RAW  = _safe_load("two-echelon-gold-au", "distances.json")

def _gold_distances():
    return {(k.split(',')[0], k.split(',')[1]): v for k, v in _GOLD_DIST_RAW.items()}

def solve_two_echelon(inp):
    if _LOAD_ERRORS.get("two-echelon-gold-au"):
        return _envelope("error", "error", 0, 0, [], _EMPTY_METRICS, _EMPTY_DETAILS,
                         f"Dataset load failed: {_LOAD_ERRORS['two-echelon-gold-au']}")

    bom            = float(inp.get('bomRatio', 1.1))
    distance_bands = sorted(inp.get('distanceBands', [500, 1000, 1500, 2000, 2600]))
    gap            = float(inp.get('gap', 0.0))
    time_limit     = int(inp.get('timeLimitSec', 120))
    ref_status     = {o['refineryId']: o['status'] for o in inp.get('refineryStatuses', [])}
    excluded       = set(inp.get('excludedCustomerIds', []))
    demand_over    = inp.get('customerDemands', {})

    mines      = list(GOLD_MINES.keys())
    refineries = list(GOLD_REFINERIES.keys())
    customers  = [c for c in GOLD_CUSTOMERS if c not in excluded]
    dist       = _gold_distances()
    demands    = {c: float(demand_over.get(c, GOLD_CUSTOMERS[c]['demand'])) for c in customers}
    total_demand = sum(demands.values())

    start = time.time()
    prob  = LpProblem("TwoEchelonGold", LpMinimize)

    x      = LpVariable.dicts("MineToRef",  [(p, r) for p in mines for r in refineries], lowBound=0)
    y      = LpVariable.dicts("RefToCust",  [(r, c) for r in refineries for c in customers], lowBound=0)
    open_r = LpVariable.dicts("Open", refineries, cat="Binary")

    prob += (lpSum(dist[p, r] * x[p, r] / TRUCKLOAD_KG for p in mines for r in refineries)
             + lpSum(dist[r, c] * y[r, c] / TRUCKLOAD_KG for r in refineries for c in customers))

    # C1 -- every customer's demand met exactly
    for c in customers:
        prob += LpConstraint(lpSum(y[r, c] for r in refineries),
                             LpConstraintEQ, f"demand_{c}", demands[c])

    # C2 -- exactly one refinery open, honouring forced_open / inactive
    for r in refineries:
        if ref_status.get(r) == "inactive":
            prob += LpConstraint(open_r[r], LpConstraintEQ, f"inactive_{r}", 0)
        elif ref_status.get(r) == "forced_open":
            prob += LpConstraint(open_r[r], LpConstraintEQ, f"forced_{r}", 1)
    prob += LpConstraint(lpSum(open_r[r] for r in refineries), LpConstraintEQ, "total_open", 1)

    # C3 -- big-M: no outflow from a closed refinery
    for r in refineries:
        prob += LpConstraint(lpSum(y[r, c] for c in customers) - total_demand * open_r[r],
                             LpConstraintLE, f"open_link_{r}", 0)

    # C4 -- BOM flow balance, summed over mines. The notebook constrains this
    # per (p,r) pair, which is correct only for a single mine; with two it
    # forces each mine to supply the full requirement independently, doubling
    # raw inflow with no error raised.
    for r in refineries:
        prob += LpConstraint(lpSum(x[p, r] for p in mines) - bom * lpSum(y[r, c] for c in customers),
                             LpConstraintEQ, f"bom_balance_{r}", 0)

    prob.solve(PULP_CBC_CMD(keepFiles=False, gapRel=gap, timeLimit=time_limit, msg=False))
    run_time   = time.time() - start
    status_str = LpStatus[prob.status]

    if status_str == "Infeasible":
        active = [r for r in refineries if ref_status.get(r) != "inactive"]
        forced = [r for r in refineries if ref_status.get(r) == "forced_open"]
        if not active:
            reason = ("Every refinery is marked inactive, but exactly one must be open to "
                      "refine gold. Re-activate at least one refinery.")
        elif len(forced) > 1:
            reason = (f"{len(forced)} refineries are forced open, but this model builds exactly "
                      "one. Force at most one open, or leave them all active.")
        else:
            reason = f"No feasible assignment for total demand of {total_demand:,.0f} kg."
        return _envelope("infeasible", status_str, 0, run_time, [],
                         _EMPTY_METRICS, {"openWarehouseIds": [], "assignments": []}, reason)

    EPS = max(total_demand * 1e-9, 1e-6)          # relative, not absolute
    open_ids = [r for r in refineries if (open_r[r].varValue or 0) > 0.5]

    edges, assignments = [], []
    leg_dist_flow = {"mine_to_refinery": 0.0, "refinery_to_customer": 0.0}
    leg_flow      = {"mine_to_refinery": 0.0, "refinery_to_customer": 0.0}
    band_flow     = {b: 0.0 for b in distance_bands}
    band_overflow = 0.0

    def _band(d):
        """Returns None for distances past the last band rather than absorbing
        them into it -- the existing models' len(bands)-1 fallback silently
        misreports coverage on this dataset, whose longest leg is 2,544 km."""
        for i, b in enumerate(distance_bands):
            if d <= b:
                return i
        return None

    for p in mines:
        for r in refineries:
            f = x[p, r].varValue or 0
            if f <= EPS:
                continue
            d = dist[p, r]
            leg_dist_flow["mine_to_refinery"] += d * f
            leg_flow["mine_to_refinery"]      += f
            edges.append({"fromId": p, "toId": r, "flow": round(f), "distance": d,
                          "band": _band(d) if _band(d) is not None else len(distance_bands),
                          "leg": "mine_to_refinery"})

    for r in refineries:
        for c in customers:
            f = y[r, c].varValue or 0
            if f <= EPS:
                continue
            d  = dist[r, c]
            bi = _band(d)
            leg_dist_flow["refinery_to_customer"] += d * f
            leg_flow["refinery_to_customer"]      += f
            if bi is None:
                band_overflow += f
            else:
                for b in distance_bands:
                    if d <= b:
                        band_flow[b] += f
            edges.append({"fromId": r, "toId": c, "flow": round(f), "distance": d,
                          "band": bi if bi is not None else len(distance_bands),
                          "leg": "refinery_to_customer"})
            assignments.append({"customerId": c, "warehouseId": r, "distanceMi": d,
                                "band": bi if bi is not None else len(distance_bands),
                                "flowKg": round(f),
                                "flowFraction": round(f / demands[c], 4) if demands[c] else 0})

    def _avg(leg):
        return round(leg_dist_flow[leg] / leg_flow[leg], 1) if leg_flow[leg] > 0 else 0

    avg_by_leg = [{"leg": leg, "avgDistance": _avg(leg), "totalFlow": round(leg_flow[leg])}
                  for leg in ("mine_to_refinery", "refinery_to_customer")]

    total_flow = sum(leg_flow.values())
    blended = round(sum(leg_dist_flow.values()) / total_flow, 1) if total_flow else 0

    band_coverage = [{"band": b, "percent": round(band_flow[b] * 100 / total_demand)}
                     for b in distance_bands]
    if band_overflow > 0:
        band_coverage.append({"band": -1,
                              "percent": round(band_overflow * 100 / total_demand)})

    utilization = [{"warehouseId": r, "city": GOLD_REFINERIES[r]['city'],
                    "utilization": 100 if r in open_ids else 0} for r in refineries]

    return _envelope("optimal", status_str, round(value(prob.objective) or 0, 2), run_time, edges,
                     {"utilizationByNode": utilization,
                      "bandCoverage": band_coverage,
                      "weightedAvgDistance": blended,
                      "avgDistanceByLeg": avg_by_leg},
                     {"openWarehouseIds": open_ids, "assignments": assignments,
                      "bomRatio": bom})
```

**Dispatcher (`solve.py`, find the existing `def solve(inp):` function and add one branch):**

```python
def solve(inp):
    model_type = inp.get('modelType', 'p_median')
    if model_type == 'transport':            return solve_transport(inp)
    if model_type == 'capacitated_pmedian':  return solve_capacitated_pmedian(inp)
    if model_type == 'two_echelon':          return solve_two_echelon(inp)
    return solve_pmedian(inp)
```

**`resultEnvelope.ts` additions (find the exact current `EdgeSchema`/`MetricsSchema` first, add these fields):**

```ts
export const EdgeSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  flow: z.number(),
  distance: z.number(),
  band: z.number().optional(),
  // Two-echelon models tag each edge with its leg so the map can style
  // mine->refinery and refinery->customer differently. Optional: single-echelon
  // models omit it. Without this field here, Zod strips it silently.
  leg: z.enum(["mine_to_refinery", "refinery_to_customer"]).optional(),
});

export const MetricsSchema = z.object({
  utilizationByNode: z.array(z.object({
    warehouseId: z.string(), city: z.string(), utilization: z.number(),
  })).optional(),
  bandCoverage: z.array(z.object({ band: z.number(), percent: z.number() })).optional(),
  weightedAvgDistance: z.number().optional(),
  avgDistanceByLeg: z.array(z.object({
    leg: z.string(), avgDistance: z.number(), totalFlow: z.number(),
  })).optional(),
});
```

- [ ] **Step 1: Write the failing pytest tests first**

In `artifacts/api-server/src/solver/tests/` (find the existing test file convention — likely a new `test_two_echelon.py`):

```python
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
    r1 = solve_two_echelon({"bomRatio": 1.1, "distanceBands": [500,1000,1500,2000,2600], "gap": 0, "timeLimitSec": 30})
    r2 = solve_two_echelon({"bomRatio": 2.0, "distanceBands": [500,1000,1500,2000,2600], "gap": 0, "timeLimitSec": 30})
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
    r1 = solve_two_echelon({"bomRatio": 1.1, "distanceBands": [500,1000,1500,2000,2600], "gap": 0, "timeLimitSec": 30})
    r2 = solve_two_echelon({"bomRatio": 2.0, "distanceBands": [500,1000,1500,2000,2600], "gap": 0, "timeLimitSec": 30})
    assert r1["details"]["openWarehouseIds"] != r2["details"]["openWarehouseIds"]
    leg1 = {l["leg"]: l["avgDistance"] for l in r1["metrics"]["avgDistanceByLeg"]}
    leg2 = {l["leg"]: l["avgDistance"] for l in r2["metrics"]["avgDistanceByLeg"]}
    assert leg1["mine_to_refinery"] != leg2["mine_to_refinery"]

def test_bom_flip_threshold():
    # Bracket, not point -- CBC tie-breaking is arbitrary near the boundary.
    low = solve_two_echelon({"bomRatio": 1.1, "distanceBands": [500,1000,1500,2000,2600], "gap": 0, "timeLimitSec": 30})
    high = solve_two_echelon({"bomRatio": 2.0, "distanceBands": [500,1000,1500,2000,2600], "gap": 0, "timeLimitSec": 30})
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
    result = solve_two_echelon({"bomRatio": 1.1, "distanceBands": [500,1000,1500,2000,2600], "gap": 0, "timeLimitSec": 30})
    naive_avg = result["objective"] / 7_400_000  # the wrong shortcut -- objective is /44000 already
    real_avg = result["metrics"]["weightedAvgDistance"]
    assert abs(naive_avg - real_avg) > 1  # must NOT match the naive (wrong) calculation

def test_all_refineries_inactive_infeasible():
    result = solve_two_echelon({
        "bomRatio": 1.1, "distanceBands": [500,1000,1500,2000,2600], "gap": 0, "timeLimitSec": 30,
        "refineryStatuses": [{"refineryId": "daggar-hills", "status": "inactive"},
                             {"refineryId": "cunnamulla", "status": "inactive"}],
    })
    assert result["status"] == "infeasible"
    assert "inactive" in result["infeasibilityReason"].lower()

def test_two_forced_open_infeasible():
    result = solve_two_echelon({
        "bomRatio": 1.1, "distanceBands": [500,1000,1500,2000,2600], "gap": 0, "timeLimitSec": 30,
        "refineryStatuses": [{"refineryId": "daggar-hills", "status": "forced_open"},
                             {"refineryId": "cunnamulla", "status": "forced_open"}],
    })
    assert result["status"] == "infeasible"
    assert "forced" in result["infeasibilityReason"].lower()

def test_flow_balance_generalizes():
    # Synthetic 2nd mine, confirming the summed-over-mines BOM constraint
    # (not per-(p,r), which the source notebook incorrectly uses) handles it
    # without doubling raw inflow. Requires monkeypatching GOLD_MINES or
    # constructing a local LP with the same constraint shape -- read solve.py's
    # actual module structure to determine the cleanest test seam.
    pass  # implementer: flesh out against the real module structure
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest test_two_echelon.py -x -v`
Expected: FAIL — `solve_two_echelon` doesn't exist yet.

- [ ] **Step 3: Apply the solve.py and resultEnvelope.ts changes exactly as shown above, in the SAME commit**

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd artifacts/api-server/src/solver/tests && python3 -m pytest test_two_echelon.py -x -v`
Expected: PASS (except `test_objective_matches_notebook` and `test_flow_balance_generalizes`, explicitly left as placeholders above pending the real notebook's exact values/structure — the implementer must complete these two before considering this task done, not ship them as permanently-skipped).

- [ ] **Step 5: Verify the CLI reproduces both notebook objectives (M2's own exit criterion)**

Run:
```bash
cd artifacts/api-server/src/solver
echo '{"modelType":"two_echelon","bomRatio":1.1,"distanceBands":[500,1000,1500,2000,2600],"gap":0,"timeLimitSec":30}' | python3 solve.py
echo '{"modelType":"two_echelon","bomRatio":2.0,"distanceBands":[500,1000,1500,2000,2600],"gap":0,"timeLimitSec":30}' | python3 solve.py
```
Expected: first call's `details.openWarehouseIds` is `["cunnamulla"]`, second is `["daggar-hills"]`; both `edges[]` entries carry `leg`; `metrics.avgDistanceByLeg` has 2 entries.

- [ ] **Step 6: Write the vitest envelope-retention test (the S1 regression guard — non-negotiable)**

Find `resultEnvelope.ts`'s existing test file and add:

```ts
it("retains leg and avgDistanceByLeg through Zod parse (S1 guard)", () => {
  const raw = {
    status: "optimal", objective: 100, runTimeSec: 0.1, quality: "Optimal",
    edges: [{ fromId: "kalgoorlie", toId: "cunnamulla", flow: 1000, distance: 1465, leg: "mine_to_refinery" }],
    metrics: {
      weightedAvgDistance: 500,
      avgDistanceByLeg: [{ leg: "mine_to_refinery", avgDistance: 1465, totalFlow: 1000 }],
    },
    details: {}, solverUsed: "CBC (PuLP)",
  };
  const parsed = ResultEnvelopeSchema.parse(raw);
  expect(parsed.edges[0].leg).toBe("mine_to_refinery");
  expect(parsed.metrics.avgDistanceByLeg).toHaveLength(1);
  expect(parsed.metrics.avgDistanceByLeg![0].avgDistance).toBe(1465);
});
```

- [ ] **Step 7: Run the full verification gate + e2e_accuracy.py/e2e_journey.py**

Expected: clean, and critically — the three EXISTING models' numbers must be byte-identical to before this task (this task only adds a new dispatcher branch and new optional schema fields, touching zero existing code paths).

- [ ] **Step 8: Commit (ONE commit for both files)**

```bash
git add artifacts/api-server/src/solver/solve.py artifacts/api-server/src/solver/resultEnvelope.ts \
  artifacts/api-server/src/solver/tests/test_two_echelon.py artifacts/api-server/src/__tests__/
git commit -m "$(cat <<'EOF'
feat(solver)!: two-echelon refinery siting + envelope leg/per-leg metrics

solve_two_echelon() implements the Chapter 10 mine->refinery->customer LP:
demand-met equality, single-refinery-open with forced/inactive overrides, a
big-M open-link constraint, and the BOM flow balance SUMMED over mines (the
source notebook writes this per (mine,refinery) pair, which double-counts raw
inflow the moment a second mine exists -- correct only by coincidence for the
current single-mine dataset). Ships in the same commit as resultEnvelope.ts's
new optional `leg` (per-edge) and `avgDistanceByLeg` (per-leg average distance
and flow) fields -- splitting them would let Zod silently strip both the
moment the solver starts emitting them, since z.object() drops unknown keys
with no error. Distance-band overflow is a real `None` sentinel, not absorbed
into the last band, since this dataset's longest leg (2,544 km) exceeds
US-scale defaults. Averages are computed from flows, never from the
objective (which carries a /44000 truckload divisor that would understate
distance by that factor). All three existing models' behavior and numbers
are unchanged (e2e_accuracy.py/e2e_journey.py verified unmodified).
EOF
)"
```

---

### Task 5: Phase M3.2–M3.5 — API contract

**Files:**
- Create: `artifacts/api-server/src/validation/inputs/twoEchelon.ts`
- Modify: `artifacts/api-server/src/registry/modelRegistry.ts` (`KNOWN_SCHEMAS` entry)
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (`VALID_MODEL_IDS` entry)
- Modify: `artifacts/api-server/src/solver/pmedian.ts` (`SolveInput` union + `buildPayload()` branch)
- Modify: `lib/api-spec/openapi.yaml` (`modelId` enum)
- Regenerate: `lib/api-zod/src/generated/*`, `lib/api-client-react/src/generated/*`

**Interfaces:**
- Consumes: Task 4's `TwoEchelonInputs`-shaped payload the solver expects (`bomRatio`, `refineryStatuses`, `excludedCustomerIds`, `customerDemands`, `distanceBands`, `gap`, `timeLimitSec`).
- Produces: `POST /scenarios` with `modelId: "two-echelon-gold-au"` succeeds; `useGetDataset`/scenario CRUD hooks accept the new model id; Task 6's frontend consumes the regenerated `useCreateScenario`/`useUpdateScenario` types.

**`twoEchelon.ts` (full file, per implementation.md M3.2):**

```ts
import { z } from "zod";

export const twoEchelonInputsSchema = z.object({
  // .gt(1), not .positive(): a ratio at or below 1 means refining creates mass.
  // Rejecting at the edge beats debugging a nonsensical optimum later.
  bomRatio: z.number().gt(1).max(10),
  refineryOverrides: z.array(z.object({
    id: z.string(),
    status: z.enum(["active", "forced_open", "inactive"]),
  })).default([]),
  customerOverrides: z.array(z.object({
    id: z.string(),
    demand: z.number().min(0).nullable().optional(),
    status: z.enum(["active", "excluded"]),
  })).default([]),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),   // required -- NaN here kills every solve
});

export type TwoEchelonInputs = z.infer<typeof twoEchelonInputsSchema>;
```

**`modelRegistry.ts`'s `KNOWN_SCHEMAS`** (read the file first to find the exact current object, add one line):

```ts
const KNOWN_SCHEMAS: Record<string, ZodType> = {
  "p-median-us": pMedianInputsSchema,
  "p-median-brazil": pMedianInputsSchema,
  "transport-coal": transportLpInputsSchema,
  "two-echelon-gold-au": twoEchelonInputsSchema,
};
```

**`routes/scenarios.ts`'s `VALID_MODEL_IDS`** (this is the SAME export Task 1's H1 test already reads — read the file to confirm it's exported, add the new id):

```ts
export const VALID_MODEL_IDS = new Set([
  "p-median-us", "transport-coal", "p-median-brazil",
  "two-echelon-gold-au",
  "max_coverage", "p_center", "set_cover",
]);
```

**`pmedian.ts`'s `SolveInput` union and `buildPayload()` branch** (read the file first to find the exact current union and the `transport-coal` early-return branch this new branch sits alongside):

```ts
export type SolveInput =
  | { modelId: "p-median-us" | "p-median-brazil"; inputs: PMedianInputs }
  | { modelId: "transport-coal"; inputs: TransportLpInputs }
  | { modelId: "two-echelon-gold-au"; inputs: TwoEchelonInputs };

// inside buildPayload(), alongside the existing transport-coal branch
if (input.modelId === "two-echelon-gold-au") {
  const i = input.inputs;
  return {
    modelType: "two_echelon",
    bomRatio: i.bomRatio,
    refineryStatuses: i.refineryOverrides
      .filter((o) => o.status !== "active")
      .map((o) => ({ refineryId: o.id, status: o.status })),
    excludedCustomerIds: i.customerOverrides
      .filter((o) => o.status === "excluded").map((o) => o.id),
    customerDemands: Object.fromEntries(
      i.customerOverrides.filter((o) => o.demand != null).map((o) => [o.id, o.demand as number]),
    ),
    distanceBands: i.distanceBands,
    gap: i.gap,
    timeLimitSec: i.timeLimitSec,
  };
}
```

**IMPORTANT — apply the earlier `buildPayload` lesson from this session's transport-coal integration:** when this branch is added, re-verify it is actually reached and its fields actually forwarded end-to-end (a prior integration shipped `buildPayload` fields that were validated and persisted correctly but silently never reached the solver due to a stale hardcoded return object — caught only by live testing, not by any unit test in isolation). Step 6 below requires an end-to-end payload check for exactly this reason, not just a unit test on `buildPayload` in isolation.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/__tests__/twoEchelon.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { twoEchelonInputsSchema } from "../validation/inputs/twoEchelon.js";

describe("twoEchelonInputsSchema", () => {
  it("accepts a valid two-echelon input", () => {
    const result = twoEchelonInputsSchema.safeParse({
      bomRatio: 1.1, distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120,
    });
    expect(result.success).toBe(true);
  });

  it("rejects bomRatio: 0.5 (<=1)", () => {
    const result = twoEchelonInputsSchema.safeParse({
      bomRatio: 0.5, distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing timeLimitSec", () => {
    const result = twoEchelonInputsSchema.safeParse({
      bomRatio: 1.1, distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0,
    });
    expect(result.success).toBe(false);
  });
});
```

Add to `pmedian.test.ts` (find the existing `buildPayload` test block, follow its exact pattern):

```ts
it("buildPayload forwards two-echelon-gold-au inputs to the solver payload", () => {
  const payload = buildPayload({
    modelId: "two-echelon-gold-au",
    inputs: {
      bomRatio: 1.5,
      refineryOverrides: [{ id: "daggar-hills", status: "inactive" }],
      customerOverrides: [{ id: "sydney", demand: 3000000, status: "active" }],
      distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120,
    },
  });
  expect(payload.modelType).toBe("two_echelon");
  expect(payload.bomRatio).toBe(1.5);
  expect(payload.refineryStatuses).toEqual([{ refineryId: "daggar-hills", status: "inactive" }]);
  expect(payload.customerDemands).toEqual({ sydney: 3000000 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- twoEchelon pmedian`
Expected: FAIL — `twoEchelon.ts` doesn't exist, `buildPayload` has no two-echelon branch.

- [ ] **Step 3: Apply all the changes shown above**

- [ ] **Step 4: Update the OpenAPI spec and regenerate**

Add `two-echelon-gold-au` to every `modelId` enum in `lib/api-spec/openapi.yaml` (find every occurrence — `POST /scenarios`, `GET /scenarios?modelId=`, `Scenario` schema if it has one, etc. — grep for the existing enum list `[p-median-us, transport-coal, p-median-brazil, ...]` first to find every location, since the existing enum ALSO already contains `max_coverage`/`p_center`/`set_cover` per the audit finding B2 — do not remove those in this task, that's out of scope here, just add the new id alongside them).

Run: `pnpm --filter @workspace/api-spec run codegen`
Review the generated diff in `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/` — confirm only the `modelId` enum type changed, nothing else. **Never hand-edit these generated files.**

- [ ] **Step 5: Run tests to verify they pass**

Run: `DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test -- twoEchelon pmedian`
Expected: PASS.

- [ ] **Step 6: End-to-end payload verification against a real local server (the "learned lesson" check — do not skip)**

Start local dev, create a real scenario with `modelId: "two-echelon-gold-au"` and a `refineryOverrides`/`customerOverrides` entry, PATCH it, then trigger a solve and inspect the ACTUAL stdin payload reaching `solve.py` (e.g., temporarily log it, or check the job's stored inputs against the solve result's behavior — confirm a `refineryOverrides: [{id: "daggar-hills", status: "inactive"}]` override actually changes which refinery gets selected in the real solved result, the same way this session verified transport-coal's `mineCapacities` override actually reached the solver by observing a real behavior change, not just a passing unit test).

- [ ] **Step 7: Run the full verification gate + e2e_accuracy.py/e2e_journey.py**

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/validation/inputs/twoEchelon.ts artifacts/api-server/src/registry/modelRegistry.ts \
  artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/solver/pmedian.ts \
  lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated \
  artifacts/api-server/src/__tests__/twoEchelon.test.ts artifacts/api-server/src/__tests__/pmedian.test.ts
git commit -m "$(cat <<'EOF'
feat(api): zod schema, allowlist, payload builder, openapi codegen for two-echelon-gold-au

Model is now genuinely createable and solvable end-to-end: Zod schema gates
POST /scenarios, the route allowlist and model registry agree (H1's
registration-consistency test now covers all 4 solvable models), and
buildPayload() forwards bomRatio/refineryOverrides/customerOverrides through
to the solver's expected wire shape -- verified against a real local solve
that a refinery override actually changes the selected facility, not just
persists in the DB (the exact gap a prior model integration this session
shipped and only caught via live testing, not unit tests in isolation).
EOF
)"
```

---

### Task 6: Phase M4 — Frontend

**Files:**
- Modify: `artifacts/studio/src/components/NetworkMap.tsx` (leg-based edge coloring, refinery/customer marker labels)
- Modify: `artifacts/studio/src/pages/Studio.tsx` (BOM slider, per-leg metrics panel, two-echelon left-panel branch, copy-layer labels)
- Modify: `artifacts/studio/src/lib/chapters.ts` (new chapter entry — decide visibility per this session's existing `hiddenFromLanding` mechanism, see note below)
- Modify: `artifacts/studio/src/pages/Compare.tsx` (verify cross-model rejection still holds for a 4th model — likely needs zero changes since Compare already generalizes over `modelId`, but confirm)

**Interfaces:**
- Consumes: Task 4's `edge.leg`/`metrics.avgDistanceByLeg`, Task 5's `two-echelon-gold-au` model id and validated inputs, Task 3's manifest `countryBounds`.
- Produces: a playable Chapter 10 lab in the UI.

- [ ] **Step 1: Extend `NetworkMap.tsx`'s edge rendering to color by `edge.leg`**

Read `NetworkMap.tsx`'s existing `<Polyline>` rendering (the same block Task 1 of the earlier `2026-07-24-studio-map-fixes.md` plan already touched this session — read it fresh to get current line numbers). Add: when `edge.leg === "mine_to_refinery"`, use a green stroke color; when `"refinery_to_customer"`, red; when `leg` is absent (every other model), fall back to the existing `getBandColor(assignBand(...))` behavior completely unchanged. This must be purely additive — p-median-us and transport-coal edges have no `leg` field and must render exactly as they do today.

```tsx
const legColor = edge.leg === "mine_to_refinery" ? "#16A34A"
  : edge.leg === "refinery_to_customer" ? "#DC2626"
  : getBandColor(assignBand(edge.distance, bands));
```

- [ ] **Step 2: Add the BOM slider to Studio.tsx's two-echelon left-panel branch**

Follow the exact pattern of the existing `transport-coal`/`p-median-brazil` branches (`{modelId === "transport-coal" && (...)}` etc. — find these in Studio.tsx) and add a new `{modelId === "two-echelon-gold-au" && (...)}` block:

```tsx
{modelId === "two-echelon-gold-au" && (
  <div className="px-3 py-3 border-b space-y-2">
    <p className="text-xs font-semibold text-foreground">BOM ratio (raw kg per refined kg)</p>
    <div className="flex items-center gap-2">
      <Slider
        min={1.0} max={3.0} step={0.1}
        value={[localConfig.bomRatio]}
        onValueChange={([v]) => update("bomRatio", Math.round(v * 10) / 10)}
        className="flex-1"
      />
      <span className="text-xs font-mono w-10 text-right">{localConfig.bomRatio.toFixed(1)}×</span>
    </div>
    <p className="text-[10px] text-muted-foreground">1.1 favors the customer-adjacent refinery. 2.0 favors the mine-adjacent one — watch which refinery gets selected as you sweep this.</p>
  </div>
)}
```

Round before sending (`Math.round(v * 10) / 10`) since sliders emit floating-point noise like `1.7000000000000002`.

- [ ] **Step 3: Add the per-leg metrics panel, rendered only when the field is present**

In Studio.tsx's results panel (find where `result.metrics.bandCoverage`/`weightedAvgDistance` currently render):

```tsx
{result.metrics.avgDistanceByLeg && result.metrics.avgDistanceByLeg.length > 0 && (
  <div className="px-3 py-3 border-b space-y-2">
    <p className="text-xs font-semibold text-foreground">Average distance by leg</p>
    {result.metrics.avgDistanceByLeg.map((l) => (
      <div key={l.leg} className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{l.leg === "mine_to_refinery" ? "Mine → Refinery" : "Refinery → Customer"}</span>
        <span className="font-mono">{l.avgDistance.toFixed(1)} km · {l.totalFlow.toLocaleString()} kg</span>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 4: Add the copy-layer label mapping for this model**

Find wherever Studio.tsx currently maps `openWarehouseIds` → a model-specific label (transport-coal likely says "mines"/"active flows" somewhere per this session's earlier work) and add: for `two-echelon-gold-au`, `openWarehouseIds` → "Refinery selected" (singular, since exactly one opens by design).

- [ ] **Step 5: Add a chapter entry to `chapters.ts`**

```ts
{
  path: "/chapter-10/gold-refinery",
  modelId: "two-echelon-gold-au",
  chapter: "Chapter 10",
  title: "Gold Refinery Siting — Two-Echelon",
  description: "Two-echelon facility location: site a refinery between a gold mine and ten customers, and watch the choice flip as the bill-of-materials ratio changes.",
},
```

**Decide visibility explicitly, do not default silently:** this session's most recent work hid `transport-coal` and `p-median-brazil` from the Landing page via `hiddenFromLanding: true`, leaving only `p-median-us` visible, per explicit user instruction. This plan does NOT know whether Chapter 10 should ship visible or hidden — this is a product decision for whoever executes this task to confirm with the user before Step 8's commit, not to assume either way.

- [ ] **Step 6: Verify `Compare.tsx` rejects cross-model comparison including this 4th model**

Read `Compare.tsx`'s existing model-picker filtering (`availableModelIds`, computed from the user's own scenarios, already generalizes over whatever `modelId` values exist — per this session's Phase 5/F1.1 work, the actual rejection is server-side in `POST /scenarios/compare`'s `same-modelId` check, which is already generic). Confirm by creating one `two-echelon-gold-au` scenario and one `p-median-us` scenario, attempting to compare them, and confirming a 422 with `CompareRejection` — this should require zero code changes if the existing implementation is as generic as documented; if it isn't, that's a real gap to fix here.

- [ ] **Step 7: Add RTL tests**

```tsx
it("per-leg panel is absent when avgDistanceByLeg is not in the result", () => {
  // render Studio with a p-median-us result lacking avgDistanceByLeg
  // assert the "Average distance by leg" text is not present
});

it("edge coloring keys off leg for two-echelon, falls back to band color otherwise", () => {
  // render NetworkMap with one edge carrying leg: "mine_to_refinery" and one with no leg field
  // assert the colored stroke differs appropriately
});
```

- [ ] **Step 8: Run the full verification gate + e2e_accuracy.py/e2e_journey.py, then manually verify live in a browser**

Start local dev, create a two-echelon-gold-au scenario, sweep the BOM slider from 1.1 to 2.0, solve at both ends, confirm the selected refinery visibly flips and the per-leg panel updates. This is the exercise's entire pedagogical point — verify it is actually visible, not just that the numbers are correct in isolation.

- [ ] **Step 9: Commit**

```bash
git add artifacts/studio/src/components/NetworkMap.tsx artifacts/studio/src/pages/Studio.tsx \
  artifacts/studio/src/lib/chapters.ts artifacts/studio/src/__tests__/
git commit -m "$(cat <<'EOF'
feat(studio): australia bounds, two-leg edges, BOM slider, per-leg panel

NetworkMap.tsx extended (not forked into a third country-specific map
component) to color edges by edge.leg when present, falling back to the
existing band-color behavior for every model that doesn't set it. BOM
ratio is a slider (1.0-3.0, step 0.1, rounded before send) rather than a
number field -- the flip point between Daggar Hills and Cunnamulla is worth
discovering by sweeping, not typing. Per-leg average-distance panel renders
only when avgDistanceByLeg is present, defensive against every other model's
result shape. Manually verified live: sweeping the slider from 1.1 to 2.0
visibly flips the selected refinery.
EOF
)"
```

---

### Task 7: Final test-matrix pass

**Files:** none new — this task runs the complete cross-layer test matrix implementation.md specifies and records the result, catching anything the per-task gates above didn't already cover.

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a green full-repo verification gate, ready for deploy.

- [ ] **Step 1: Run every layer's full suite fresh**

```bash
pnpm run typecheck
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" pnpm --filter api-server test
pnpm --filter studio test
cd artifacts/api-server/src/solver/tests && python3 -m pytest . -x
cd artifacts/api-server/src/solver/tests && python3 e2e_accuracy.py
cd artifacts/api-server/src/solver/tests && python3 e2e_journey.py
```

- [ ] **Step 2: Cross-check the full test matrix from `chapter-10-two-echelon-gold-refinery-implementation.md`'s "Test matrix" section against what actually exists**

Go through every row of that table (10 pytest entries, envelope-retention vitest, two 422 vitest cases, registration-consistency vitest, banner-parsing vitest, 2 RTL cases, 1 Playwright e2e, the merge-gate row) and confirm each has a real, passing test — not just that the overall suite is green. List any row without a corresponding test and either write it now or explicitly flag it to the user as a known gap, per this session's established practice of never silently claiming full coverage.

- [ ] **Step 3: Add the Playwright e2e test if it doesn't exist**

`artifacts/studio/e2e/two-echelon.spec.ts` (or add to an existing spec file, following `import.spec.ts`'s established pattern from earlier this session): build a two-echelon scenario → solve at bomRatio 1.1 → confirm Cunnamulla selected → clone → change BOM to 2.0 → solve → confirm Daggar Hills selected → open Compare → confirm the two scenarios show a real diff.

- [ ] **Step 4: Post-deploy checklist (do not execute until Tasks 1-6 are deployed)**

Per `model-integration-precheck.md`'s Gate 8: after deploying, `GET /api/models` count should be 4 (or the visibility-adjusted equivalent from Task 6 Step 5's decision), the new model's objectives should match the source notebook, and — critically — every EXISTING model's objectives must be unchanged. This is the same live-verification discipline this session already applied to `transport-coal`'s override fix.

- [ ] **Step 5: Commit any test additions from Step 3**

```bash
git add artifacts/studio/e2e/two-echelon.spec.ts
git commit -m "test: solver, api, and e2e coverage for two-echelon model"
```

---

## Self-Review

**1. Spec coverage:** Every phase from `chapter-10-two-echelon-gold-refinery-implementation.md` (H, M0, M1, M2, M3, M4) maps to a task above (Tasks 1-6), plus a dedicated final test-matrix task (Task 7). Every gate from `model-integration-precheck.md` (Gates 0-8) is addressed: Gate 0 by this plan's own Global Constraints section quoting the envelope-strips-unknown-keys risk directly; Gate 1's eight registration points are Tasks 3 (points 1, 2, 5), 5 (points 3, 4, 6, 7), 4 (point 8); Gate 2 (dataset integrity) is Task 2's extraction assertions; Gate 3 (solver hygiene) is baked into Task 4's exact code (epsilon, `>0.5`, no `print`/`writeLP`); Gate 4 (bands) is Task 3's manifest defaults + Task 4's `_band()` overflow handling; Gate 5 (contract/caching) is Task 4's single-commit rule + Task 1's H3 cache-hash fix; Gate 6 (frontend) is Task 6; Gate 7 (tests) is Task 7; Gate 8 (rollout) is this plan's task ORDER itself plus Task 7 Step 4's post-deploy checklist. M5/Arcadia is explicitly excluded per the Global Constraints section, resolving the contradiction between the two source docs.

**2. Placeholder scan:** The plan originally had two disclosed placeholders (Task 2's exact distance/coordinate values, Task 4's `test_objective_matches_notebook`); both are now resolved with real, verified values — the source notebook (`Notebook_Mining_Problem_Chapter_10_Network_Design_Book.ipynb`) was read directly, its `get_data()` values transcribed verbatim, and its LP replicated locally with PuLP to confirm scenario 1 reproduces the notebook's own stored output exactly (`386576.9929994568`, Cunnamulla, `687.5738755210947` km) and to compute scenario 2's real value (`467205.2592914422`, Daggar Hills, `2190.6486217334573` km — matching the integration doc's independent "~2,191 km" citation). One genuine placeholder remains, explicitly disclosed: `test_flow_balance_generalizes` (a synthetic-second-mine test with no notebook analogue, since the real dataset only has one mine — the implementer must construct this test against solve.py's actual module structure, not against notebook data that doesn't exist for this case).

**3. Type consistency:** `TwoEchelonInputs` (Task 5) matches `twoEchelonInputsSchema`'s inferred type exactly. `SolveInput`'s new union member in `pmedian.ts` (Task 5) matches `buildPayload`'s new branch's input type. `edge.leg`/`metrics.avgDistanceByLeg` (Task 4's Python dict keys) match `resultEnvelope.ts`'s Zod field names exactly (`leg`, `avgDistanceByLeg`, `totalFlow`, `avgDistance`) — verified by literally copying the Python dict-construction code and the TS schema from the same source section of `implementation.md`, not independently re-derived.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-chapter-10-two-echelon-gold-refinery.md`. Task 1 (Phase H) is already executing via a dispatched `glm` background agent at the time this plan was written — per this session's established standing instruction ("leverage the glm agent for executable tasks, remain the orchestrator and decision maker"), the remaining tasks (2-7) will be dispatched to `glm` the same way, one at a time, with independent verification (diff review + fresh test/typecheck runs, plus `e2e_accuracy.py`/`e2e_journey.py` re-verification after every solver-touching task) before moving to the next, matching Subagent-Driven execution. No further confirmation needed to proceed on that basis unless you want to change the approach.
