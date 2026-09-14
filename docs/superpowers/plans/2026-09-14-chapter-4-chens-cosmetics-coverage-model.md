# Chapter 4 — Chen's Cosmetics Coverage Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: execute via the **agent team** (backend-engineer /
> frontend-engineer / qa-sdet), waves by file-disjointness, per the repo's standing orchestration
> preference — NOT sequential subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
> Controller cherry-picks each task onto the branch and re-runs its gate before merging.

**Goal:** Add `chens-cosmetics-cn` — a China single-echelon warehouse→customer service-level model
(Watson Ch.4) with two coupled objectives (coverage / min-distance) behind one mode toggle — as the
6th solver model, full-stack and visible, with full scenario-local-edit parity.

**Architecture:** Data-driven new model. Dataset extracted into a record-map package; `solve_chens()`
in `solve.py` dispatched on `modelType=="chens"`; overrides/added-entities merged **Python-side**
(`merge_inputs.py`); standard async job/envelope path; a TS dataset loader + `/dataset` + reference
distances + model→entity export/import selection; full Workspace UI. km is the repo's first non-mile
model, so distance-unit plumbing (exports, solve-history, labels) is generalized.

**Tech Stack:** Python 3 + PuLP/CBC; Express 5 + Drizzle + Zod; OpenAPI + Orval; React + Vite +
TanStack Query + Leaflet; vitest / pytest / Playwright.

**Spec (single source of truth):**
`docs/superpowers/specs/2026-09-14-chapter-4-chens-cosmetics-coverage-model-design.md` — Rev 9,
decisions **D1–D30**. Cite only the normative body.

## Global Constraints

- **pnpm only.** Gate: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio
  test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`.
- **Every commit is typecheck-green.** One task = one commit `[C4.N] <imperative>`. Spec + regen in
  the SAME commit; codegen command is `pnpm --filter @workspace/api-spec run codegen` (runs orval +
  `typecheck:libs`). Never hand-edit `lib/api-*/src/generated/`.
- **`e2e_accuracy.py` sacred** (hard rule 2) — run `python3 artifacts/api-server/src/solver/tests/
  e2e_accuracy.py` after any Python change; not in the pytest gate. `e2e_journey.py` is **non-runnable
  legacy** (authenticates via removed `POST /login {userId}`) — documented gate exception, do NOT try
  to run it (see CLAUDE.md gotcha).
- **Ownership 404 never 403** (rule 5). **Solver rules = data, not branches** (rule 6).
- **Circuity (D8):** store RAW km; `× 1.17` in the solver only.
- **Golden (D3/D22):** coverage `coveredDemand == 131645389`, `details.coveragePct ==
  approx(66.0639, abs=1e-3)`, open `{wh-40, wh-69, wh-102}`; min-distance `objective ==
  approx(123834216789.27, abs=0.05)`, `metrics.weightedAvgDistance == approx(621.44, abs=0.05)`;
  floor `500100100` infeasible. Total demand `199269881`. Never assert coverage-mode average or `rel=`.
- **km display:** manifest `distanceUnit:"km"`; assert `km` / absence of `mi` on every Chen surface.
- **Merge is Python-side (D23); dispatch on `modelType` (D16).**
- **Demand is the integer domain** (notebook demands are integers; units = people/product). Chen's Zod
  demand fields (`customerOverrides[].demand`, `addedCustomers[].demand`) and `coverageFloorDemand` are
  `z.number().int().nonnegative()`. So edge `flow` = integer demand and `details.coveredDemand` is an
  exact integer sum — `int(covered)` is a no-op cast, not truncation. (Resolves the flow/coveredDemand
  domain question one way, end-to-end.)
- **Deploy deferred** — confirm before any Render push.

## Verified repository contracts (traced against real code — build to THESE)

- **Dataset files are record-maps, not arrays.** `warehouses.json`/`customers.json` = `{ "<id>": {id,
  city, state, lat, lng, demand?, zip?} }` (`WarehouseEntry`/`CustomerEntry` = `z.object`;
  `CustomerEntry = WarehouseEntry.extend({demand})`). `distances.json` = **flat** `DistanceMap`
  `{ "<fromId>,<toId>": number }` (`z.record(z.string(), z.number())`). No `country`/`kind` fields.
- **`computeSha256(spec)`** hashes the **raw bytes** of each file in `Object.keys(spec.files).sort()`
  order. `version.json` = `{ version, sha256 }` matching that rule.
- **`ManifestSchema`:** `id, name, chapter (STRING e.g. "Chapter 4"), datasetDir (repo-relative), name,
  countryBounds {sw:[lat,lng], ne:[lat,lng]}, capabilities{...}, inputsSchema (REQUIRED z.record),
  distanceUnit ("mi"|"km" optional)`. **`ModelPackageSpec` = `{modelId, files}` only** (no datasetDir).
- **`build_merged_pmedian_dataset(inputs, warehouses: dict[int,dict], customers: dict[int,dict],
  distance)` returns a DICT** (index-keyed entity dicts + tuple-keyed distance dict). Chen mirrors this.
- **Registration surfaces (must agree in one green commit):** `registry/modelRegistry.ts::KNOWN_SCHEMAS`
  (→ `KNOWN_MODEL_IDS`), `routes/scenarios.ts::VALID_MODEL_IDS`, `pmedian.ts::buildPayload` union,
  `solve.py` dispatch, `__tests__/registry.test.ts` (+ its `SOLVABLE` fixture).
- **Estimators live in `services/autoDistance.ts`** (`fillEstimatedDistances`,
  `fillEstimatedBrazilDistances`, `fillEstimatedLaneCosts`, `haversineMiles`).
  **`normalizeAddedEntityDistances` dispatches in `routes/scenarios.ts`.**
- **Backend dataset stack:** `data/dataset.ts` (+ `brazilDataset.ts`/`transportCoalDataset.ts`/
  `twoEchelonDataset.ts`/`jadeDataset.ts`), `routes/dataset.ts`, `data/referenceDistances.ts`.
  Model→entity export/import selection: `routes/scenarios.ts` ~L531-547 (`entityIsPMedian` etc. +
  per-model guards) and the template/stub path selecting US-or-Brazil base rows.
- **Chapter (studio) interface:** `{ modelId: StudioModelType, chapter: string, title, …,
  labHeaderTitle, labHeaderSubtitle, path, workspace, hiddenFromLanding }`. `StudioModelType` is a
  union that must gain `"chens-cosmetics-cn"`. `defaultInputsForModel(modelId)` in `Workspace.tsx`
  needs a Chen branch. `InputMapTab.tsx` exists.
- **Export JSON wrapper:** `res.json({ templateVersion, entity, rows })`. `ExportEnvelope` at
  openapi.yaml:1292.

---

## Dependency / wave table (agent-team) — shared-file owners are SERIALIZED, never parallel

| Wave | Tasks | Serialization reason |
|---|---|---|
| W1 | C4.1 → C4.1b → C4.2 (sequential) | each builds on the prior's output files |
| W2 | C4.3 (`solve.py`/`merge_inputs.py`) ⟂ C4.5 (`openapi.yaml`) | genuinely file-disjoint |
| W3 | **C4.4 → C4.6 → C4.7 → C4.8 → C4.9 (strictly sequential)** | ALL edit `routes/scenarios.ts` |
| W4 | C4.10 (after C4.5) | `openapi.yaml`: C4.5 → C4.10 (both edit it) |
| W5 | **C4.11 → C4.12 → C4.13 → C4.14 (sequential)** | all edit `Workspace.tsx` + studio components |
| W6 | C4.15 (full gate) → C4.16 (QA) | gate precedes QA |

**Controller rule:** `routes/scenarios.ts` (C4.4/6/7/8/9), `openapi.yaml` (C4.5/10), and
`Workspace.tsx` (C4.11-14) each have exactly ONE writer at a time — cherry-pick + re-gate each before
starting the next in its chain. Backend (W2/W3/W4) ⟂ studio (W5) may overlap only where file-disjoint.

---

## Task C4.1: Extract dataset (record-maps, flat distances)

**Files:** Create `scripts/py/dump_chens.py`, `scripts/src/extract-chens-dataset.ts`,
`solvers/chens-cosmetics-cn/dataset/{warehouses,customers,distances,version}.json`.
Reference `solvers/two-echelon-gold-au/dataset/*.json` (exact shape).

**Interfaces — Produces:** record-map dataset with slug ids `wh-<n>`/`cs-<n>`, flat `DistanceMap`,
RAW km, `version.json` matching `computeSha256`.

- [ ] **Step 1: Create `dump_chens.py`** (the extractor proven during brainstorming — declare it here).
  It takes a **required `--notebook <path>` argument** (the `ChensCosmeticsV1 Step 3.ipynb` is an
  external attached file, NOT a repo path — do NOT bake a developer's `~/Downloads` absolute path into
  the committed script), slices `get_data()` out of it via ast, and prints
  `{"warehouses":{n:[name,city,country,lat,lng]}, "customers":{…}, "customer_demands":{n:dem},
  "distance":{"w,c":km}}`. It exits non-zero with a clear message if `--notebook` is missing/unreadable.
  The `extract-chens-dataset.ts` invocation passes the path through:
  `execFileSync("python3", ["scripts/py/dump_chens.py", "--notebook", process.env.CHENS_NOTEBOOK ??
  process.argv[2]])`. Documented run: `pnpm tsx scripts/src/extract-chens-dataset.ts "<path to Step 3.ipynb>"`.

- [ ] **Step 2: Write the extraction script — record-maps + flat distances.**

```ts
// scripts/src/extract-chens-dataset.ts — run: pnpm tsx scripts/src/extract-chens-dataset.ts
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const OUT = "solvers/chens-cosmetics-cn/dataset";
const notebookPath = process.env.CHENS_NOTEBOOK ?? process.argv[2];
if (!notebookPath) { console.error("Usage: tsx extract-chens-dataset.ts <path to 'ChensCosmeticsV1 Step 3.ipynb'>  (or set CHENS_NOTEBOOK)"); process.exit(1); }
const raw = JSON.parse(execFileSync("python3", ["scripts/py/dump_chens.py", "--notebook", notebookPath], { encoding: "utf8" }));
const whN = Object.keys(raw.warehouses).map(Number).sort((a,b)=>a-b);
const csN = Object.keys(raw.customers).map(Number).sort((a,b)=>a-b);
const warehouses: Record<string, unknown> = {};
for (const n of whN) { const w = raw.warehouses[n]; warehouses[`wh-${n}`] = { id:`wh-${n}`, city:w[1], state:"", lat:w[3], lng:w[4] }; }
const customers: Record<string, unknown> = {};
for (const n of csN) { const c = raw.customers[n]; customers[`cs-${n}`] = { id:`cs-${n}`, city:c[1], state:"", lat:c[3], lng:c[4], demand: raw.customer_demands[n] }; }
const distances: Record<string, number> = {};                     // flat DistanceMap, RAW km (no ×1.17)
for (const w of whN) for (const c of csN) distances[`wh-${w},cs-${c}`] = raw.distance[`${w},${c}`];
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/warehouses.json`, JSON.stringify(warehouses, null, 2) + "\n");
writeFileSync(`${OUT}/customers.json`, JSON.stringify(customers, null, 2) + "\n");
writeFileSync(`${OUT}/distances.json`, JSON.stringify(distances, null, 2) + "\n");
// version.json: hash raw bytes of the three files in sorted-filename order (computeSha256 rule)
const files = ["customers.json","distances.json","warehouses.json"]; // already sorted
const h = createHash("sha256");
for (const f of files) h.update(readFileSync(`${OUT}/${f}`));
writeFileSync(`${OUT}/version.json`, JSON.stringify({ version: 1, sha256: h.digest("hex") }, null, 2) + "\n");
```

- [ ] **Step 3: Run (with the notebook path) + assert counts/ids/raw.**

Run: `pnpm tsx scripts/src/extract-chens-dataset.ts "$HOME/Downloads/ChensCosmeticsV1-UNZIP-before-USING-this-is-3-files/ChensCosmeticsV1 Step 3.ipynb"`
(or `CHENS_NOTEBOOK="<path>" pnpm tsx scripts/src/extract-chens-dataset.ts` — the path is a runtime arg,
never committed into the script.)
Then: `python3 -c "import json;w=json.load(open('solvers/chens-cosmetics-cn/dataset/warehouses.json'));c=json.load(open('solvers/chens-cosmetics-cn/dataset/customers.json'));d=json.load(open('solvers/chens-cosmetics-cn/dataset/distances.json'));print(len(w),len(c),sum(v['demand'] for v in c.values()),d['wh-15,cs-1'])"`
Expected: `25 197 199269881 3660.0` (raw, not ×1.17). Confirm `cs-81`/`cs-120`/`cs-135` absent.

- [ ] **Step 4: Commit** `[C4.1] extract Chen's Cosmetics dataset (record-maps, flat raw-km DistanceMap)`.
  (Zip geocoding is C4.1b — split so a Nominatim failure doesn't block the base dataset.)

---

## Task C4.1b: Geocode zips (D9/D26)

**Files:** Create `scripts/src/geocode-chens.ts`, `docs/dataset-audit/chens-geocode-provenance.json`;
modify `solvers/chens-cosmetics-cn/dataset/{warehouses,customers,version}.json`.

- [ ] **Step 1:** Nominatim, 1 req/sec, retry/backoff. Accept a result ONLY if its returned city
  (case-insensitive, trimmed) matches the row's city (D26 — rows have `state:""`, no province to
  compare). Multiple-equal-rank or no-match → **ambiguous**, `zip` left absent (not a hit). Write
  per-row provenance `{id, city, normalizedInputCity, normalizedResultCity, selectedDisplayName,
  selectedPlaceId, status, zip}` (persist the **normalized** values the acceptance rule actually
  compared, so a reviewer can reproduce every accept/reject). If `hits/222 < 0.85` → throw
  (abort, no partial write). On success splice `zip` into the record-map rows, recompute `version.json`
  (same sorted-bytes rule). Zip is display-only.
- [ ] **Step 2:** Run `pnpm tsx scripts/src/geocode-chens.ts` — expect `hits/222 ≥ 0.85`, provenance
  written, `version.json` updated.
- [ ] **Step 3: Commit** `[C4.1b] geocode Chen zips (city-match, ≥85% floor, provenance)`.

---

## Task C4.2: Manifest + dataset-schema registration

**Files:** Create `solvers/chens-cosmetics-cn/manifest.json`; modify `lib/dataset-schema/src/index.ts`
(`PACKAGE_SPECS` ~L115, `MODEL_IDS` ~L249); test `lib/dataset-schema/src/manifest.test.ts` +
`index.test.ts`.

- [ ] **Step 1: countryBounds from ALL coords.**

Run: `python3 -c "import json;a=[*json.load(open('solvers/chens-cosmetics-cn/dataset/warehouses.json')).values(),*json.load(open('solvers/chens-cosmetics-cn/dataset/customers.json')).values()];lat=[x['lat'] for x in a];lng=[x['lng'] for x in a];print(min(lat),min(lng),max(lat),max(lng))"`
Expected ≈ `20.05 75.97 47.4 130.97`. Pad ~2°.

- [ ] **Step 2: Write manifest (schema-correct).**

```json
{
  "id": "chens-cosmetics-cn",
  "name": "Chen's Cosmetics",
  "chapter": "Chapter 4",
  "datasetDir": "solvers/chens-cosmetics-cn/dataset",
  "distanceUnit": "km",
  "countryBounds": { "sw": [18.0, 73.9], "ne": [49.4, 133.0] },
  "capabilities": {
    "supportsP": true,
    "capacityModes": ["none"],
    "demandEditable": true,
    "supportsFacilityStatus": true,
    "supportsAddedCustomerExclusion": true,
    "supportsReferenceDistances": true,
    "outputGrids": ["openWarehouses", "assignments", "costSummary", "serviceStats"]
  },
  "inputsSchema": {
    "type": "object",
    "properties": {
      "objective": { "type": "string", "enum": ["coverage", "min_distance"] },
      "p": { "type": "integer", "minimum": 1, "maximum": 25 },
      "highServiceDistKm": { "type": "number", "exclusiveMinimum": 0 },
      "maxDistKm": { "type": "number", "exclusiveMinimum": 0 },
      "avgServiceDistCapKm": { "type": "number", "exclusiveMinimum": 0 },
      "coverageFloorDemand": { "type": "integer", "minimum": 0 },
      "gap": { "type": "number", "minimum": 0 },
      "timeLimitSec": { "type": "number", "exclusiveMinimum": 0 },
      "capacityMode": { "type": "string", "enum": ["none"] },
      "distanceBands": { "type": "array", "items": { "type": "number" } }
    },
    "required": ["objective", "p", "highServiceDistKm", "maxDistKm", "gap", "timeLimitSec", "capacityMode", "distanceBands"]
  }
}
```
(`inputsSchema` must be **non-empty** — `manifests.test.ts:20` asserts
`Object.keys(inputsSchema).length > 0` for every `MODEL_IDS` entry. Integer `coverageFloorDemand` per
D30. `avgServiceDistCapKm`/`coverageFloorDemand` are objective-dependent — the discriminated
requirement is enforced by `chensInputsSchema` (Zod, C4.6); the manifest schema is a UI/doc hint and
keeps them optional. Confirm `datasetDir` verbatim against an existing manifest.)

- [ ] **Step 3: Register** — add `PACKAGE_SPECS` entry `{ modelId: "chens-cosmetics-cn", files: {
  "warehouses.json": z.record(z.string(), WarehouseEntry), "customers.json": z.record(z.string(),
  CustomerEntry), "distances.json": DistanceMap } }` (exact wrap the existing p-median entry uses — the
  bare `WarehouseEntry`/`CustomerEntry`/`DistanceMap` exports, no `datasetDir` key); add
  `"chens-cosmetics-cn"` to `MODEL_IDS`.

- [ ] **Step 4: Tests** — (a) `manifest.test.ts`: `ManifestSchema.parse(<Chen manifest>)` →
  `distanceUnit==="km"`, exact `outputGrids`, `chapter==="Chapter 4"`. (b) `index.test.ts`: find the
  Chen spec — `const spec = PACKAGE_SPECS.find(s => s.modelId === "chens-cosmetics-cn")!` — then
  `validatePackage(spec)` does not throw AND `computeSha256(spec) === readVersion("chens-cosmetics-cn").sha256`
  (`validatePackage` takes a `ModelPackageSpec`, NOT a model-id string).

- [ ] **Step 5: Run BOTH the package test AND the API manifest suite** (the latter iterates `MODEL_IDS`
  and asserts a non-empty `inputsSchema` — Chen now appears in it).

Run: `pnpm --filter @workspace/dataset-schema test && pnpm --filter api-server test manifests`
Expected: green (including `manifests.test.ts`'s `has a non-empty inputsSchema` for Chen).

- [ ] **Step 6: Commit.**
```bash
git add solvers/chens-cosmetics-cn/manifest.json lib/dataset-schema/src/index.ts lib/dataset-schema/src/manifest.test.ts lib/dataset-schema/src/index.test.ts
git commit -m "[C4.2] register chens-cosmetics-cn manifest (km, real inputsSchema) + PACKAGE_SPECS/MODEL_IDS + hash test"
```

---

## Task C4.3: Solver `solve_chens` + Python merge (dict representation)

**Files:** Modify `solve.py` (`solve_chens`, dispatch ~L1188, eager package load),
`merge_inputs.py` (`build_merged_chens_dataset`); test `tests/test_chens.py`; add a Vitest
schema-validation case to `__tests__/resultEnvelope.test.ts`.

**Interfaces — Produces:** `build_merged_chens_dataset(inputs, warehouses, customers, distance)` →
**dict** `{ "warehouses": {id:dict}, "customers": {id:dict}, "distance": {(from,to):km}, "excluded":
set, "forced": set, "inactive": set }` (mirror `build_merged_pmedian_dataset`'s return exactly).
`solve_chens(inp)` → `ResultEnvelope` dict.

- [ ] **Step 1: Failing subprocess goldens** (D17 — Python asserts structure; TS schema validation is
  Step 8).

```python
# tests/test_chens.py
import json, subprocess, os, pytest
SOLVE = os.path.join(os.path.dirname(__file__), "..", "solve.py")
def run(p): 
    r = subprocess.run(["python3", SOLVE], input=json.dumps(p), capture_output=True, text=True); return json.loads(r.stdout)
BASE = {"modelType":"chens","p":3,"highServiceDistKm":600,"maxDistKm":5000,"gap":0.0,"timeLimitSec":60,
        "warehouseOverrides":[],"customerOverrides":[],"addedWarehouses":[],"addedCustomers":[],"distanceOverrides":[]}
def test_coverage_golden():
    r = run({**BASE,"objective":"coverage","avgServiceDistCapKm":1000})
    assert r["status"]=="optimal"
    assert r["details"]["coveredDemand"]==131645389
    assert r["details"]["coveragePct"]==pytest.approx(66.0639,abs=1e-3)
    assert set(r["details"]["openWarehouseIds"])=={"wh-40","wh-69","wh-102"}
    assert set(r["metrics"]["openFacilityIds"])=={"wh-40","wh-69","wh-102"}
    assert r["metrics"]["weightedAvgDistance"]<=1000
    served = [e["toId"] for e in r["edges"]]
    assert len(served)==len(set(served))==197                        # exactly-one per active customer
    assert all(e["fromId"] in set(r["details"]["openWarehouseIds"]) for e in r["edges"])  # open linkage
    assert all(e["distance"] <= 5000 for e in r["edges"])            # non-vacuous max-distance feasibility (adjusted)
def test_min_distance_golden():
    r = run({**BASE,"objective":"min_distance","coverageFloorDemand":131645389})
    assert r["status"]=="optimal"
    assert r["objective"]==pytest.approx(123834216789.27,abs=0.05)
    assert r["metrics"]["weightedAvgDistance"]==pytest.approx(621.44,abs=0.05)
    assert set(r["details"]["openWarehouseIds"])=={"wh-40","wh-69","wh-102"}
def test_floor_infeasible():
    assert run({**BASE,"objective":"min_distance","coverageFloorDemand":500100100})["status"]=="infeasible"
# (max-distance feasibility is asserted non-vacuously inside test_coverage_golden, on a known-optimal
#  result — a separate tight-cap test would be vacuous if it lands infeasible, so it's folded in.)
```

- [ ] **Step 2: Run — expect fail** (`Unknown modelType: chens`).
  `cd artifacts/api-server/src/solver && python3 -m pytest tests/test_chens.py -x`.

- [ ] **Step 3: `build_merged_chens_dataset`** in `merge_inputs.py` — copy `build_merged_pmedian_dataset`'s
  structure verbatim (same added-entity append, `distanceOverrides` sparse replace, `warehouseOverrides`
  status → `forced`/`inactive` sets, `customerOverrides` excluded set + demand override), return the
  **same dict shape** it returns. Chen ids are strings (`wh-`/`cs-`), so the merged dicts are keyed by
  string id (pmedian uses int keys — adapt key type, keep structure).

- [ ] **Step 4: `solve_chens`** — one objective-sense branch (rule 6); CBC with the input controls;
  `flow` = integer demand (D30 — demand is integer end-to-end; `int()` is an exact-value cast);
  zero-demand → infeasible; CBC `Infeasible` → infeasible envelope, any other non-optimal → **error**
  envelope (D17); round per D22 (coveragePct 4dp, avg 2dp, min-dist objective 2dp). Reuse `_envelope`.

```python
def solve_chens(inp):
    from pulp import LpProblem, LpMaximize, LpMinimize, LpVariable, lpSum, LpInteger, LpStatus, value, PULP_CBC_CMD
    import time; t = time.time()
    m = build_merged_chens_dataset(inp, WAREHOUSES_CHENS, CUSTOMERS_CHENS, DISTANCE_CHENS)
    cand = [wid for wid in m["warehouses"] if wid not in m["inactive"]]
    custs = [cid for cid in m["customers"] if cid not in m["excluded"]]
    dem = {cid: m["customers"][cid]["demand"] for cid in custs}
    total = sum(dem.values())
    hi, mx, p = inp["highServiceDistKm"], inp["maxDistKm"], inp["p"]
    if total <= 0:
        return _envelope("infeasible","infeasible",0,round(time.time()-t,2),[],_EMPTY_METRICS,_EMPTY_DETAILS,"Total effective demand is zero")
    adj = {(w,c): m["distance"][(w,c)]*1.17 for w in cand for c in custs}
    hsp = {k:(1 if v<=hi else 0) for k,v in adj.items()}
    mdp = {k:(1 if v<=mx else 0) for k,v in adj.items()}
    mode = inp["objective"]
    prob = LpProblem("chens", LpMaximize if mode=="coverage" else LpMinimize)
    a = LpVariable.dicts("A", [(w,c) for w in cand for c in custs], 0, 1, LpInteger)
    o = LpVariable.dicts("O", cand, 0, 1, LpInteger)
    if mode=="coverage":
        prob += lpSum(hsp[w,c]*dem[c]*a[w,c] for w in cand for c in custs)
        prob += lpSum(adj[w,c]*dem[c]*a[w,c] for w in cand for c in custs) <= inp["avgServiceDistCapKm"]*total
    else:
        prob += lpSum(adj[w,c]*dem[c]*a[w,c] for w in cand for c in custs)
        prob += lpSum(hsp[w,c]*dem[c]*a[w,c] for w in cand for c in custs) >= inp["coverageFloorDemand"]
    for c in custs: prob += lpSum(a[w,c] for w in cand) == 1
    prob += lpSum(o[w] for w in cand) == p
    for w in cand:
        if w in m["forced"]: prob += o[w] == 1
        for c in custs:
            prob += a[w,c] <= o[w]
            prob += a[w,c] <= mdp[w,c]
    prob.solve(PULP_CBC_CMD(msg=0, gapRel=inp["gap"], timeLimit=inp["timeLimitSec"]))
    st = LpStatus[prob.status]
    if st == "Infeasible":                                            # D17: mathematical infeasibility ONLY
        return _envelope("infeasible","infeasible",0,round(time.time()-t,2),[],_EMPTY_METRICS,_EMPTY_DETAILS,"No feasible assignment under the constraints")
    if st != "Optimal":                                               # Not Solved / Undefined / Unbounded / timeout → error, not infeasible
        return _envelope("error","error",0,round(time.time()-t,2),[],_EMPTY_METRICS,_EMPTY_DETAILS,f"Solver terminated with status: {st}")
    edges=[]; covered=0.0; tdd=0.0
    for w in cand:
        for c in custs:
            v=a[w,c].varValue
            if v and v>0.5:
                d=adj[w,c]; edges.append({"fromId":w,"toId":c,"distance":round(d,2),"flow":dem[c]})
                tdd+=dem[c]*d
                if hsp[w,c]: covered+=dem[c]
    open_ids=sorted(w for w in cand if o[w].varValue and o[w].varValue>0.5)
    cov=round(covered*100/total,4); avg=round(tdd/total,2)
    metrics={"openFacilityIds":open_ids,"weightedAvgDistance":avg,"utilizationByNode":[],
             "bandCoverage":[{"band":hi,"percent":cov},{"band":mx,"percent":100.0}]}
    details={"objective":mode,"p":p,"highServiceDistKm":hi,"maxDistKm":mx,
             "avgServiceDistCapKm":inp.get("avgServiceDistCapKm"),"coverageFloorDemand":inp.get("coverageFloorDemand"),
             "openWarehouseIds":open_ids,"coveragePct":cov,"coveredDemand":int(covered),
             "uncoveredPct":round(100-cov,4),"assignments":[]}
    obj = cov if mode=="coverage" else round(value(prob.objective),2)
    return _envelope("optimal","optimal",obj,round(time.time()-t,2),edges,metrics,details)
```

- [ ] **Step 5: Dispatch + eager load** — `elif model_type == "chens": return solve_chens(inp)` before
  the unknown-model error; load `WAREHOUSES_CHENS/CUSTOMERS_CHENS/DISTANCE_CHENS` at module top (int-
  free string keys; distance dict keyed by `(fromId,toId)` tuples parsed from the flat map).

- [ ] **Step 6: Run goldens + Step-7 override tests — PASS.** Add: forced-open zero-demand WH still in
  `openWarehouseIds`+`openFacilityIds`; inactive WH absent; excluded customer absent; added WH openable;
  `distanceOverride` changes an assignment; all-excluded → infeasible.
  `python3 -m pytest tests/test_chens.py -x`.

- [ ] **Step 7: Vitest schema validation** — in `__tests__/resultEnvelope.test.ts` add cases that spawn
  `python3 solve.py` for `modelType:"chens"` and assert stdout parses against `ResultEnvelopeSchema`
  (real TS validation) for **all four exit shapes**: optimal (coverage), model-level infeasible (floor
  `500100100`), zero-demand infeasible (all customers excluded), and unexpected error (malformed
  payload). Each must produce a schema-valid envelope with the D17-correct `status`.

- [ ] **Step 8: e2e_accuracy unchanged.** `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py`.

- [ ] **Step 9: Commit** `[C4.3] solve_chens + build_merged_chens_dataset (dict repr, CBC gap/timeLimit, flow=demand)`.

---

## Task C4.4: Backend dataset loader + /dataset + reference distances + model→entity selection

**Files:** Create `artifacts/api-server/src/data/chensDataset.ts`; modify `data/dataset.ts` (or
`routes/dataset.ts` dispatch), `data/referenceDistances.ts`, `services/templates.ts` (template/stub
dataset selection), `services/import.ts` (column/dispatch), `routes/scenarios.ts` (`entityIsChens` +
per-model guard ~L531-547). Tests: `__tests__/dataset.test.ts`, `routes.test.ts`,
`importMultiModelRoundTrip.test.ts`, `referenceDistances` test. **NO reset-to-baseline** — that
endpoint was removed repo-wide (SCN v0.3 Phase 3.2); do not reintroduce it.

**Interfaces — Produces:** `GET /dataset?modelId=chens-cosmetics-cn` returns Chen warehouses/customers;
`GET /models/chens-cosmetics-cn/reference-distances` returns the base×base matrix; export/import/apply
resolve **Chen's** dataset, never a sibling's (no reset-to-baseline — removed).

- [ ] **Step 1: Failing tests — every model→dataset path, positive + sibling-negative:**
  `/dataset?modelId=chens-cosmetics-cn` returns 25 WH / 197 customers; reference-distances returns 4925
  pairs; **export** `entity=warehouses` for a Chen scenario returns Chen rows (NOT p-median-us rows),
  `entity=mines` → 422; **import preview** + **import apply** of a Chen `customers` CSV resolve Chen's
  dataset (a sibling's ids are rejected); the **v1 `distances` export → re-import round-trip** is
  unchanged. (No reset-to-baseline — endpoint removed in SCN v0.3 Phase 3.2.) These prove Chen never
  silently resolves a p-median sibling dataset on any surviving path.

- [ ] **Step 2: Implement `chensDataset.ts`** mirroring `data/dataset.ts` (load the record-map package
  via `findRepoRoot()` per the bundling gotcha — NOT `import.meta.url` relative). Wire into
  `routes/dataset.ts`'s model dispatch, `referenceDistances.ts`, and generalize the template/stub +
  `routes/scenarios.ts` selection so `chens-cosmetics-cn` → Chen base dataset. Add
  `entityIsChens = entity==="warehouses"||entity==="customers"||entity==="distances"` + the guard.

- [ ] **Step 3: Run — PASS. Commit** `[C4.4] Chen dataset loader + /dataset + reference-distances + model→entity export/import selection`.

---

## Task C4.5: OpenAPI contract + ALL producers/consumers (atomic, green)

**Files:** Modify `lib/api-spec/openapi.yaml` (+ regen); `ExportEnvelope`. Because D21 removes
`weightedAvgDistanceMi` from generated types, this task lands the codegen **with** every consumer in ONE
commit (jobRunner/solveHistory are C4.10 — so DO NOT remove the field here; ADD the new fields
additively now, remove `weightedAvgDistanceMi` in C4.10 alongside its producers/consumers).

- [ ] **Step 1: Edit `openapi.yaml`** — add `chens-cosmetics-cn` to the `modelId` enum; set the
  `PrecheckError.code` enum to the **complete 8-value set** `[completeness, id_collision,
  reference_integrity, p_range, capacity, zero_demand, no_feasible_route, coverage_floor_infeasible]`
  — OpenAPI currently lists only the first three, so it can't represent the server's existing `p_range`/
  `capacity` outcomes (D18 "reuse `p_range`"); a contract test asserts all 8 round-trip through the
  generated client; **add as OPTIONAL** (not remove
  yet, producer lands in C4.10) solve-history `objectiveMode`, `weightedAvgDistance`, `distanceUnit`.
  **`ExportEnvelope.rows` stays the existing permissive/opaque type — scope decision, not laziness:**
  the envelope serves ~15 entities (warehouses/customers/mines/stations/refineries/distances/laneCosts/
  legDistances/plants/plantCapabilities + the 5 output rows); typing a partial union of only the new
  output rows would MIS-type every existing input-entity export, and fully typing all 15 with
  entity-discriminated schemas is a whole-contract expansion out of scope for a model-add. Exact output
  shapes are enforced + tested at the `templates.ts` layer (C4.9), which is where D25's contract lives;
  add a one-line rationale comment in the spec at `ExportEnvelope.rows`. (This deliberately reverses the
  earlier "exact rows" instruction, which the completeness review showed to be incomplete/harmful.)

- [ ] **Step 2: Regenerate + typecheck.** `pnpm --filter @workspace/api-spec run codegen` (orval +
  typecheck:libs) → green.

- [ ] **Step 3: Commit** `[C4.5] OpenAPI: chens modelId, complete 8-value precheck enum, additive solve-history fields (rows stay opaque) (+regen)`.

---

## Task C4.6: Zod inputs + atomic registration + buildPayload

**Files:** Create `validation/inputs/chens.ts`; modify `validation/inputs/index.ts`,
`registry/modelRegistry.ts` (`KNOWN_SCHEMAS`), `routes/scenarios.ts` (`VALID_MODEL_IDS`),
`solver/pmedian.ts` (`SolveInput` + `buildPayload`); tests `validation/inputs/__tests__/chens.test.ts`,
`__tests__/registry.test.ts` (+ `SOLVABLE` fixture), `__tests__/pmedian.test.ts`.

- [ ] **Step 1: Failing tests** — validation per D-list (objective discriminates required params;
  `p 1..25`; `highServiceDistKm < maxDistKm`; `avgServiceDistCapKm` iff coverage; `coverageFloorDemand`
  iff min-distance; `timeLimitSec`+`gap` required; `capacityMode:"none"` persisted; `displayCode?`/
  `estimated?`); `registry.test.ts` asserts `chens-cosmetics-cn` in `KNOWN_MODEL_IDS` and solvable;
  `pmedian.test.ts` asserts `buildPayload` emits `modelType:"chens"` + sparse edits + `distanceBands`
  normalized to `[high,max]`.
- [ ] **Step 2: Run — fail.** `pnpm --filter api-server test chens registry pmedian`.
- [ ] **Step 3: Implement** `chensInputsSchema` — demand fields (`customerOverrides[].demand`,
  `addedCustomers[].demand`) and `coverageFloorDemand` are `z.number().int().nonnegative()` (integer
  demand domain); D19 `.transform` overwrites `distanceBands` to `[high,max]`; refinement `high<max`.
  Add to `KNOWN_SCHEMAS` + `VALID_MODEL_IDS` + `validateInputsForModel`; add the `SolveInput` union
  member + `buildPayload` branch (sparse edits, NOT merged dataset); extend `registry.test.ts`'s
  `SOLVABLE`.
- [ ] **Step 4: Run — PASS. Commit** `[C4.6] Chen Zod inputs + KNOWN_SCHEMAS/VALID_MODEL_IDS registration + buildPayload (atomic)`.

---

## Task C4.7: Added-entity distance estimator (autoDistance)

**Files:** Modify `services/autoDistance.ts` (`fillEstimatedChensDistances`), `routes/scenarios.ts`
(`normalizeAddedEntityDistances` Chen dispatch); test `__tests__/autoDistance.test.ts`,
`routes.test.ts`.

- [ ] **Step 1: Failing test** — `fillEstimatedChensDistances` fills a missing added-entity pair with
  **raw haversine km** (`R=6371`, NO ×1.17), a **positive floor** for co-located points (never 0 —
  match the existing estimator's min), leaves existing pairs untouched, is idempotent; **all three
  persist call sites** (POST create, PATCH, import/apply) invoke it for Chen (create/move/delete
  reconciliation) — one route test each.
- [ ] **Step 2: Run — fail.** `pnpm --filter api-server test autoDistance`.
- [ ] **Step 3: Implement — write a SEPARATE `fillEstimatedChensDistances`** (the locked choice — do
  NOT refactor the shared p-median core, which is riskier for a model-add). It mirrors
  `fillEstimatedBrazilDistances`'s structure but reparses with `chensInputsSchema` (so Chen-only
  objective/threshold fields survive), uses a **km haversine `R=6371`**, circuity=1, rounds each
  estimate to **2 dp**, and applies a **positive floor of `0.01` km** for co-located points (never 0).
  Dispatch Chen in `routes/scenarios.ts::normalizeAddedEntityDistances`.
- [ ] **Step 4: Run — PASS. Commit** `[C4.7] Chen added-entity km estimator (autoDistance) + normalize dispatch`.

---

## Task C4.8: Semantic precheck

**Files:** Modify `services/precheck.ts` (codes + `precheckChensInputs`), `routes/scenarios.ts`
(dispatch); test `__tests__/precheck.test.ts`.

- [ ] **Step 1: Failing tests** — each blocking code fires: `zero_demand`; `no_feasible_route`
  (a customer whose every active WH has `rawKm×1.17 > maxDistKm`); `coverage_floor_infeasible`
  (`coverageFloorDemand >` Σ demand of customers with ≥1 active WH at `rawKm×1.17 ≤ highServiceDistKm`
  — necessary upper bound); `p_range` (`forcedOpen > p`, `p > active candidates`); `id_collision`/
  `completeness`/`reference_integrity`.
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** — add the 3 codes to `PrecheckErrorCode`; `precheckChensInputs` applies
  ×1.17 **after** merge + inactive/excluded filtering, two distinct thresholds; wire the Chen branch in
  `scenarios.ts` precheck dispatch (the `422 {ok:false}` path).
- [ ] **Step 4: Run — PASS. Commit** `[C4.8] Chen semantic precheck (3 codes, circuity-aware, two thresholds)`.

---

## Task C4.9: Unit-aware output exports

**Files:** Modify `services/templates.ts` (`OUTPUT_TEMPLATE_VERSION`, row shapes, CSV,
`buildOpenWarehouseRows` union), `routes/scenarios.ts` (wrapper version per entity); test
`__tests__/templates.test.ts`, `routes.test.ts`.

- [ ] **Step 1: Failing tests** — assignment CSV header
  `template_version,customer_id,warehouse_id,distance,distance_unit,band,flow`; Chen exports
  `distance_unit=km`, no `distanceMi`/`distance_mi`; mile models export `distance_unit=mi`; CostSummary
  JSON serializes `objectiveMode` as explicit `null` when absent (not omitted), numeric-unavailable
  fields `null`; ServiceStats CSV `template_version,band,distance_unit,percent`; JSON **wrapper**
  `templateVersion==2` for assignments/costSummary/serviceStats and `==1` for
  openWarehouses/flows/distances; **`buildOpenWarehouseRows` includes a forced-open zero-flow WH WITH
  its real city** — Chen emits `metrics.utilizationByNode` empty, so unioning `openFacilityIds` alone
  yields blank cities. The builder takes an **effective-dataset city lookup = base warehouses ∪ this
  scenario's `inputs.addedWarehouses`** (a forced-open zero-flow *added* warehouse exists only in
  inputs, so a base-only lookup would still blank it). **Test both** a base and an added zero-flow
  forced-open facility export a non-blank city.
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** — `export const OUTPUT_TEMPLATE_VERSION = 2;`; update the 3 builders +
  serializers to D24/D25 shapes (pass `distanceUnit` from manifest into the builders); change
  **`buildOpenWarehouseRows` to accept an effective id→city lookup** (base warehouses ∪ the scenario's
  `inputs.addedWarehouses`) and union `metrics.openFacilityIds` with edge-derived ids so a zero-flow
  forced-open facility (base OR added) exports with its real city; construct + pass that lookup at the
  export-route call site in `scenarios.ts`; per-entity wrapper version in `scenarios.ts`. Do NOT
  touch the importable `distances` export or `flows`/`legDistances`.
- [ ] **Step 4: Run full api-server suite — PASS** (existing mile-model export tests updated to the new
  columns; in-scope per D24). Commit `[C4.9] unit-aware output exports + OUTPUT_TEMPLATE_VERSION=2 (both JSON levels) + openFacilityIds union`.

---

## Task C4.10: Solve-history unit-carrying shape (removes weightedAvgDistanceMi)

**Files:** Modify `solver/jobRunner.ts`, `routes/solveHistory.ts`, `lib/api-spec/openapi.yaml` (+regen,
remove `weightedAvgDistanceMi`), `pages/Landing.tsx` (recent-solves consumer); tests
`__tests__/solveHistory.test.ts`, `jobRunner.test.ts`.

- [ ] **Step 1: Failing tests — exact response shapes:** new solve writes `resultSummary = {status,
  objective, objectiveMode, weightedAvgDistance, distanceUnit, runTimeSec}` (objectiveMode from
  `details.objective` else `null`; distanceUnit from manifest). **Failed job:** `objective`,
  `objectiveMode`, `weightedAvgDistance`, `runTimeSec` are all `null`, but `distanceUnit` is the
  **non-null model-derived unit** (from `modelId`'s manifest — never null). **Legacy successful** row
  (only `weightedAvgDistanceMi`): returns that value as `weightedAvgDistance` + `distanceUnit:"mi"` +
  `objectiveMode:null`. The `"mi"` literal fallback is reserved for legacy successful summaries ONLY;
  a present-but-failed summary derives the unit from `modelId`.
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** (jobRunner write + solveHistory read + openapi: **finalize the C4.5-optional
  solve-history fields to their D21 required/nullable shape AND remove `weightedAvgDistanceMi`** + regen
  + Landing consumer — ALL in this one commit so every commit stays green).
- [ ] **Step 3b: Landing mode-aware label test** — the recent-solves row renders a coverage solve's
  objective as `NN.NN %` and a min-distance solve's as `demand-km`, keyed on `objectiveMode` (D14) —
  RTL assertion, not just a unit swap.
- [ ] **Step 4: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test` —
  green. Commit** `[C4.10] solve-history unit-carrying resultSummary + legacy fallback + Landing mode-aware label (remove weightedAvgDistanceMi, +regen)`.

---

## Task C4.11: Frontend — chapter registration (real interface) + defaults + km labels

**Files:** Modify `lib/chapters.ts` (extend `StudioModelType` + add `Chapter`),
`pages/Workspace.tsx` (`defaultInputsForModel` branch), `AssignmentsTab.tsx`, `ObjectiveBar.tsx`,
`NetworkMap.tsx` (popup), `OptimizationParametersTab.tsx`, `Landing.tsx`; RTL tests. (NOT `App.tsx` —
routes derive from `CHAPTERS`.)

- [ ] **Step 1:** Add `"chens-cosmetics-cn"` to `StudioModelType`; add a `Chapter` entry with ALL
  required fields — `modelId, chapter:"Chapter 4", title, description (the real field — a one-line lab
  description like the existing entries), path:"/chapter-4", labHeaderTitle, labHeaderSubtitle,
  workspace:true, hiddenFromLanding:false` (copy an existing entry's exact field set). **Do NOT touch
  `App.tsx`** — it already maps `CHAPTERS.map(...)` to routes, so `/chapter-4` is created automatically;
  adding a manual route would duplicate it.
- [ ] **Step 2:** Add a `defaultInputsForModel("chens-cosmetics-cn")` branch returning every required
  Chen field (objective:"coverage", p:3, highServiceDistKm:600, maxDistKm:5000, avgServiceDistCapKm:1000,
  gap, timeLimitSec, capacityMode:"none", distanceBands:[600,5000], empty override/added arrays).
- [ ] **Step 3:** De-hardcode `mi` → active model's `distanceUnit` in the 5 named surfaces; RTL asserts
  `km`/no-`mi` for a Chen scenario in each.
- [ ] **Step 4: `pnpm --filter studio test` — PASS. Commit** `[C4.11] Chapter 4 route/card + defaultInputsForModel + km labels`.

---

## Task C4.12: Frontend — inputs (mode toggle, pMax, no capacity/band editor)

**Files:** `OptimizationParametersTab.tsx`, `WarehouseTable`/`CustomerTable`, `SolveDialog.tsx`,
`Workspace.tsx`; RTL.

- [ ] **Step 1:** Mode toggle bound to `inputs.objective` (coverage → `avgServiceDistCapKm`;
  min-distance → `coverageFloorDemand` default 131645389 + "> 199M infeasible" hint). RTL: toggle
  swaps the visible field AND initializes the newly-required mode-specific field (switching to
  min-distance seeds `coverageFloorDemand`; switching to coverage seeds `avgServiceDistCapKm`).
- [ ] **Step 1b: Band resync RTL** — editing `highServiceDistKm` OR `maxDistKm` immediately updates
  local `inputs.distanceBands` to `[high, max]` in component state, BEFORE any Save/solve (D13/D19).
- [ ] **Step 2:** Add `pMax` prop to `SolveDialog` (hardcodes `max={50}`); Chen passes `pMax=25` to it
  AND `OptimizationParametersTab`. RTL: 26 rejected in both.
- [ ] **Step 3:** Hide band editor (D19) in both; warehouse table status-only (no capacity col). RTL.
- [ ] **Step 4: PASS. Commit** `[C4.12] Chen inputs (mode toggle, pMax=25 both, no capacity/band editor)`.

---

## Task C4.13: Frontend — full Input-Map parity (Gate 6.5)

**Files:** `InputMapTab.tsx` (Chen branch = p-median-style variant), `MinesTab`/etc not applicable;
`DistancesTab` (Chen display codes), `Workspace.tsx` wiring; RTL + Playwright-lite.

- [ ] **Step 1:** Wire Chen into `InputMapTab.tsx` as the p-median-style variant: effective
  base-plus-overrides-plus-added projection, status symbology (potential/forced-open/inactive), stable
  `uid`/`displayCode` on added entities, click-to-place → draft marker → Confirm → prefilled add form,
  move/delete/save reconciliation. **Enumerate and add `chens-cosmetics-cn` to every Workspace gate
  (RTL assertion per gate):** `Workspace.tsx::isEditableInputTab`'s input-map/warehouse/customer/
  distance branches; the p-median Layers-row save condition (`saveInLayersRow` family at
  `Workspace.tsx:3023`); the `InputMapTab` render branch; and the warehouse/customer/distance **table
  render** branches. A stale model-id allowlist on any one gate must fail an RTL test — "full parity"
  cannot pass otherwise. RTL: add → save → the added entity appears with City/State/Lat/Lng + display
  code; each gate renders for a Chen scenario.
- [ ] **Step 2:** Distances tab shows Chen base (raw-km reference) + overrides with display codes.
- [ ] **Step 3: PASS. Commit** `[C4.13] Chen full Input-Map parity (projection, symbology, uid/displayCode, reconciliation)`.

---

## Task C4.14: Frontend — map (China bounds, coverage lens) + Gate-1 sweep + output tabs

**Files:** `NetworkMap.tsx`, `mapBounds.ts`, band lens/`bandPalette`, `MapLegend`, every `modelId===`
allowlist (Gate-1 10 points), `ServiceStatsTab.tsx`, `CostSummaryTab.tsx`, compare gating; RTL.

- [ ] **Step 1: Gate-1 MAPPED AUDIT (not a blanket allowlist mutation).** For each of Gate-1's 10
  registration points, check whether the branch is structurally shared or model-specific (many
  `modelId===` branches are coal/gold/JADE-specific and Chen must NOT be added to them). Prefer an
  existing **capability gate** over expanding a model-id list where one exists. Map each point to its
  owning task and add Chen ONLY where it shares the contract; RTL asserts the correct header
  title/subtitle, map bounds `{sw,ne}` (contain all points), and each genuinely-shared gate renders for
  Chen — while a coal/gold-specific branch does NOT gain Chen.
- [ ] **Step 2: Two-class coverage lens** — routes `≤high` (covered) / `high<d≤max` (uncovered),
  client-side.
- [ ] **Step 3: Output tabs + mode-aware labels (D14)** — ServiceStatsTab rows Coverage%/Covered/
  Uncovered (from `details`) + Avg service distance (from `metrics.weightedAvgDistance`) + band rows;
  **ObjectiveBar AND CostSummaryTab render the objective mode-aware** (coverage → `NN.NN %`,
  min-distance → `demand-km`), keyed on `details.objective`; compare restricted to same
  `details.objective`. **RTL asserts** (a) a coverage scenario shows a `%` objective and a min-distance
  scenario shows demand-km in BOTH ObjectiveBar and CostSummary; (b) **two solved Chen scenarios with
  DIFFERENT objective modes cannot be selected/compared together, while two with the SAME mode can**
  (the D14 compat restriction, proven — not just stated).
- [ ] **Step 4: PASS. Commit** `[C4.14] Chen map (China bounds, coverage lens) + Gate-1 sweep + output tabs`.

---

## Task C4.15: Full gate + e2e_accuracy

- [ ] **Step 1:** `pnpm run typecheck && pnpm --filter @workspace/dataset-schema test && pnpm --filter
  api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m
  pytest tests/ -x)` — all green. (The dataset-schema package test + the api-server `manifests.test.ts`
  suite must run AFTER the final `dataset/*.json`/`version.json` are settled — package validation/hash/
  manifest correctness is central to C4.1–C4.2.)
- [ ] **Step 2:** `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py` — unmodified pass.
- [ ] **Step 3:** Verification only; fix any red in the owning task's file, re-commit under that id.

---

## Task C4.16 (QA): Real-browser Playwright

**Files:** Create `artifacts/studio/e2e/chens-cosmetics.spec.ts`.

- [ ] **Step 1:** Dev-proxy setup (`API_PROXY_TARGET`, per the repo's e2e gotcha). Flow: register →
  create Chen scenario → coverage solve → coverage ≈66% / 3 cities (Guangzhou/Jinan/Nanjing) → switch
  min_distance → solve → edit a demand → re-solve delta → distance override → assignment change →
  Input-Map add → save → precheck surfaces → `km` present / `mi` absent. **Two distinct import flows,
  asserted separately:** (a) the v1 `distances` CSV **exports and re-imports UNCHANGED** (round-trip
  identity — proves the input template didn't drift); (b) a `customers` CSV is **exported, one demand
  edited, re-imported** and exactly one change applies (a distinct edit flow). Both are importable input
  entities — never an output-only export.
- [ ] **Step 2: Run** (repo command, NOT bare npx): start api-server + studio dev, then
  `pnpm --filter studio exec playwright test chens-cosmetics.spec.ts` (or the repo's `e2e:gate`-style
  script). Expected: green.
- [ ] **Step 3: Commit** `[C4.16] e2e chens-cosmetics (coverage+min-distance+overrides+import round-trip)`.

**Gate note:** the plan's gate is `e2e_accuracy.py` (runnable) + the pytest suite + this Playwright
spec. `e2e_journey.py` is a **documented, pre-approved exception** — non-runnable legacy auth (removed
`POST /login {userId}`), per CLAUDE.md; do NOT count it as coverage and do NOT attempt to run it.

---

## Self-review (plan author)

**Spec coverage:** D1 (C4.12) · D2 (C4.2/C4.11) · D3+D22 (C4.3) · D4 (C4.8) · D5 (C4.11) · D6
(C4.3/C4.6/C4.7/C4.13) · D7 (C4.3) · D8 (C4.1/C4.3) · D9+D26 (C4.1b) · D10 (C4.3) · D11 (C4.6/C4.12) ·
D12 (C4.2/C4.14) · D13+D19 (C4.6/C4.12) · D14 (C4.14) · D15 (C4.3/C4.8) · D16+D23 (C4.3/C4.6) · D17
(C4.3) · D18 (C4.8) · D20+D24+D28+D29 (C4.9) · D21 (C4.10) · D25 (C4.9) · D27 (C4.12) · **D30
(Global Constraints + C4.3/C4.6 — integer demand)** — mapped. Backend dataset/reference/export-selection
now owned (C4.4). Registration atomic (C4.6). Full Input-Map parity owned (C4.13).

**Type consistency:** `build_merged_chens_dataset` returns the pmedian dict shape (C4.3), consumed only
there; `OUTPUT_TEMPLATE_VERSION` defined+used C4.9; `resultSummary` shape C4.10 matches D21;
`fillEstimatedChensDistances` defined C4.7 used C4.7/C4.13; `StudioModelType`/`Chapter` extended C4.11
before any studio consumer. Every task commit is typecheck-green (C4.5 additive, C4.10 removes+migrates
atomically).

---

## Review history (audit trail — non-normative)

**Plan Rev 1 review (FOLDED):** all findings verified correct against the repo and folded — dataset
record-map + flat `DistanceMap` shape, `computeSha256` sorted-bytes rule, `ManifestSchema`
(string chapter / `{sw,ne}` bounds / required `inputsSchema`), `ModelPackageSpec={modelId,files}`
(C4.1/C4.2); owned backend dataset/reference/export-selection task (C4.4); atomic
`KNOWN_SCHEMAS`/`VALID_MODEL_IDS`/`registry.test.ts` registration (C4.6); dict merge representation +
CBC `gapRel`/`timeLimit` + `flow`=demand + complete goldens + real `resultEnvelope.test.ts` validation
(C4.3); resequenced OpenAPI (additive C4.5, remove-with-consumers C4.10) + `ExportEnvelope` rows +
`pnpm --filter @workspace/api-spec run codegen` (C4.5/C4.10); real `Chapter`/`StudioModelType` +
`defaultInputsForModel` (C4.11); estimator in `autoDistance.ts` + `normalizeAddedEntityDistances`
dispatch (C4.7); `routes.test.ts` + `buildOpenWarehouseRows` `openFacilityIds` union + null encoding
(C4.9); solve-history `"mi"`-fallback-only-for-legacy-successful (C4.10); pnpm Playwright command +
importable-CSV round-trip + `e2e_journey.py` documented exception + task-numbering aligned (C4.16).

### Plan Rev 2 review — 2026-09-14 (FOLDED)

**All verified correct against the repo and folded:** PACKAGE_SPECS `z.record(z.string(), WarehouseEntry)`
wrap + `validatePackage(spec)` (C4.2); integer demand domain end-to-end resolving flow/coveredDemand
(Global Constraints + C4.3/C4.6); optional solve-history fields in C4.5 (final shape in C4.10) —
`ExportEnvelope.rows` kept **opaque** (the "exact rows" idea from this round was reversed in Rev 3/4 as
incomplete/harmful); non-vacuous max-distance assertion in the known-optimal golden (C4.3);
import-preview/apply + v1 distances round-trip sibling-negative tests (C4.4, no reset — endpoint
removed); band-resync +
mode-field-init RTL (C4.12); open-warehouse export city lookup for zero-flow forced-open (C4.9); exact
failed-vs-legacy solve-history null semantics (C4.10); no duplicate `App.tsx` route + real
`Chapter.description` (C4.11); enumerated Workspace input-map gates with per-gate RTL (C4.13); separated
distances-round-trip vs customer-edit import flows (C4.16). Original review text retained below.

**Disposition (historical):** materially improved and faithful to the tie-aware notebook model, but not yet
execution-ready. Resolve the three blockers and align the executable tests/contracts below before
dispatch. No change is requested to Option-A coverage tie handling or the verified mathematical
goldens.

#### Blockers

1. **C4.2 names schemas that do not exist and calls `validatePackage` with the wrong argument.** The
   repository exports `WarehouseEntry`, `CustomerEntry`, and `DistanceMap`; the first two must be wrapped
   as `z.record(z.string(), WarehouseEntry)` / `z.record(z.string(), CustomerEntry)`, matching the
   existing p-median package. `validatePackage` accepts a `ModelPackageSpec`, not a model-id string, so
   the test must find the Chen entry in `PACKAGE_SPECS` and pass that spec.

2. **The demand domain contradicts `coveredDemand: int(covered)`.** C4.3 explicitly preserves
   non-integer overridden demand in edge `flow`, while the proposed solver truncates the sum in
   `details.coveredDemand`. Lock one contract end-to-end: either require integer base/override/added
   demand and integer `coverageFloorDemand`, preserving D22's integer result, or allow fractional demand
   and emit the exact numeric covered demand without `int()` (with the spec/schema/tests updated).

3. **C4.5 leaves an OpenAPI alternative unresolved.** Replace “exact row schemas ... OR opaque rows”
   with one decision. The normative spec promises exact output shapes, so prefer exact row schemas.
   During C4.5's additive transition, explicitly keep the new solve-history properties optional because
   their producer does not land until C4.10; C4.10 can establish the final required/nullable D21 shape
   while atomically removing `weightedAvgDistanceMi`.

#### Important corrections

1. **Make max-distance feasibility non-vacuous.** The proposed tight-`maxDistKm` test accepts an
   infeasible result and therefore may inspect no edges. Add `edge.distance <= BASE.maxDistKm` to the
   known-optimal default coverage golden, or use a separately verified feasible tight-cap fixture.

2. **Test every model-to-dataset path owned by C4.4.** In addition to `/dataset`, reference distances,
   warehouse export, and the invalid-entity case, add positive and sibling-negative route tests for
   import preview, import apply, reset-to-baseline, and the unchanged v1 distances export/import round
   trip. This is the proof that Chen never silently resolves a p-median sibling dataset.

3. **Test band resynchronization at the authoring boundary.** C4.12 must prove that editing either
   `highServiceDistKm` or `maxDistKm` immediately updates local `distanceBands` to `[high,max]`, before
   persistence or solve. Also prove a mode switch initializes the newly required mode-specific field.

4. **Lock city resolution for open-warehouse exports.** `buildOpenWarehouseRows` currently derives
   `city` only from `metrics.utilizationByNode`; Chen intentionally emits that array empty. Merely
   unioning `metrics.openFacilityIds` will therefore retain zero-flow facilities but give Chen rows blank
   cities. Pass a model dataset lookup to the builder, or explicitly choose and test blank-city output.

5. **Resolve failed solve-history null semantics.** C4.10 says a failed job “returns nulls” and also
   says an absent summary derives `distanceUnit` from `modelId`. State the exact response. Recommended:
   `objective`, `objectiveMode`, `weightedAvgDistance`, and `runTimeSec` are null, while `distanceUnit`
   is the non-null model-derived unit; reserve the `"mi"` fallback for legacy successful summaries.

6. **Do not add a duplicate Chapter 4 route.** `App.tsx` already maps `CHAPTERS` into routes, so the
   `chapters.ts` entry creates `/chapter-4` automatically. C4.11 should remove the instruction to add an
   `App.tsx` route and should name the actual `Chapter.description` field rather than leaving a
   `description/summary` alternative.

7. **Enumerate the Workspace gates required for Input-Map parity.** C4.13 should explicitly cover the
   `isEditableInputTab` input-map/warehouse/customer/distance branches, the p-median Layers-row save
   condition, the InputMap render branch, and the warehouse/customer/distance table render branches.
   Add an RTL assertion for each gate so “full parity” cannot pass while one model-id allowlist remains
   stale.

#### Minor correction

- C4.16 should separate two browser assertions: the v1 `distances` CSV must export and re-import
  unchanged, while a customer CSV may be edited and re-imported as a distinct flow. The current wording
  starts with customers and then ambiguously calls it a distances/customers round trip. The documented
  `e2e_journey.py` exception is valid; `CLAUDE.md` confirms that script is non-runnable under the removed
  legacy-auth flow.

**Approval condition:** fold the three blockers, make the solver and persistence tests non-vacuous,
and lock the remaining dataset/export/history/frontend behaviors above. Then re-review the revised plan
against the normative Rev 8 body.

### Plan Rev 3 re-review — 2026-09-14 (FOLDED, + spec Rev 9)

**All verified correct and resolved:** integer-demand domain promoted to **spec D30** (forced by D22)
+ stale C4.3 wording fixed; `reset-to-baseline` removed from plan (C4.4), spec (line 197), AND
`model-integration-precheck.md` (endpoint deleted SCN v0.3 Phase 3.2); `ExportEnvelope.rows` kept
opaque with an explicit scope rationale (typing all ~15 entities is out of scope; exact shapes live in
`templates.ts`); CBC status mapping — `Infeasible`→infeasible, all other non-optimal→**error** (D17) +
4-shape `resultEnvelope.test.ts`; estimator boundary (`fillEstimatedDistances` reparses `PMedianInputs`
— Chen needs a schema-neutral core or `chensInputsSchema` wrapper) + positive km floor + 3 call-site
tests (C4.7); open-warehouse city from **effective** dataset (base ∪ added) + base/added zero-flow
tests (C4.9); mode-aware label tests on ObjectiveBar + Landing (C4.10/C4.14); Gate-1 **mapped audit**
not blanket allowlist (C4.14); `--notebook` arg, no baked path (C4.1); explicit dependency/wave table
serializing `routes/scenarios.ts` + `openapi.yaml` + `Workspace.tsx` owners. Original text below.

**Disposition (historical):** Rev 2 is mostly folded correctly and the notebook formulation/tie-aware coverage
golden remain sound. The plan is not execution-ready until the four blockers below are resolved. Two of
them expose stale or missing normative decisions, so the spec must be revised alongside the plan rather
than letting the plan silently become a second source of truth.

#### Blockers

1. **The integer-demand resolution is still internally contradictory and is not locked by Rev 8.** The
   Global Constraints and C4.6 now require integer `customerOverrides[].demand`,
   `addedCustomers[].demand`, and `coverageFloorDemand`, but C4.3 Step 4 still says demand may be
   non-integer. More importantly, the normative Zod field list says only `coverageFloorDemand >= 0` and
   does not make edited/added demand integer-only. Rejecting fractional scenario inputs is a new public
   behavior. Either promote the integer-domain decision into a new normative spec revision and remove
   the stale C4.3 wording, or preserve numeric demand and emit `coveredDemand` without `int()`.

2. **C4.4 plans work against a removed reset endpoint.** `POST /scenarios/:id/reset-to-baseline` was
   removed repo-wide in SCN v0.3 Phase 3.2; the current `importMultiModelRoundTrip.test.ts` explicitly
   records that there is nothing to register a new model into. C4.4 nevertheless lists the route as an
   implementation file/path and requires a reset test. The Rev 8 spec and
   `model-integration-precheck.md` also retain this stale reference. Remove reset from all three
   documents, or explicitly scope and design reintroduction as a separate feature; do not recreate it
   incidentally during Chen integration.

3. **C4.5's exact `ExportEnvelope.rows` typing is incomplete for the shared endpoint.** The plan names
   only `AssignmentRow`, `CostSummaryRow`, `ServiceStatsRow`, `OpenWarehouseRow`, and `FlowRow`, while
   the same envelope already returns warehouses, customers, mines, stations, refineries, distances,
   lane costs, leg distances, plants, and plant capabilities. Replacing opaque rows with a union of only
   the five named output types makes every existing input-entity export incorrectly typed. Define every
   row variant, or use top-level entity-discriminated response schemas that correlate each `entity`
   literal with its exact row array. Add generated-type/contract coverage for both a changed output
   entity and unchanged input entities.

4. **C4.3 maps every non-optimal CBC termination to mathematical infeasibility.** The proposed
   `if st != "Optimal"` branch labels `Not Solved`, `Undefined`, and `Unbounded` as `infeasible`, including
   potential time-limit cases. D17 distinguishes mathematical infeasibility from error/transport
   outcomes. Handle `Infeasible` specifically and lock the treatment of every other CBC status (error
   envelope or a deliberately supported incumbent result). Extend the real TypeScript
   `ResultEnvelopeSchema` subprocess tests to cover floor-infeasible and zero-demand envelopes as well
   as optimal and unexpected-error envelopes.

#### Important corrections

1. **Make the Chen estimator implementation boundary explicit.** The existing
   `fillEstimatedDistances` is not a schema-neutral generic core: it accepts `PMedianInputs` and returns
   `pMedianInputsSchema.parse(...)`. Passing Chen inputs through it would strip Chen-only objective and
   threshold fields. C4.7 must either extract a truly schema-neutral pair-generation core or implement a
   separate Chen wrapper that reparses with `chensInputsSchema`. Also lock a positive km minimum for
   co-located points and add route tests for all three existing persist call sites: POST create, PATCH,
   and import/apply.

2. **Resolve open-warehouse cities against the effective scenario dataset.** A base model-dataset
   lookup fixes base facilities only. A forced-open, zero-flow added warehouse exists solely in
   `inputs.addedWarehouses`, so it would still export a blank city. Define the builder input as the base
   warehouse set plus that scenario's added warehouses (or a prebuilt id-to-city lookup) and test both a
   base and an added zero-flow open facility.

3. **Assign and test D14's mode-aware labels.** C4.11 changes only the distance unit in ObjectiveBar,
   C4.10 names Landing as a migrated consumer without a formatting assertion, and C4.14 makes only
   CostSummary's objective mode-aware. Add explicit acceptance tests that ObjectiveBar and Landing
   solve history render coverage objectives as percentages and min-distance objectives as demand-km,
   using `details.objective` / `objectiveMode` respectively.

4. **Replace C4.14's blanket allowlist mutation with a mapped audit.** “Add Chen to every
   `modelId ===` allowlist” is unsafe because many such branches are structurally specific to coal,
   gold two-echelon, or JADE. Map Gate 1's ten registrations to their owning C4 tasks, audit each one,
   and add Chen only where it shares the contract. Prefer an existing capability gate over expanding a
   model-id list where possible.

5. **Make dataset extraction reproducible.** C4.1 runs `dump_chens.py` without defining how that script
   locates `ChensCosmeticsV1 Step 3.ipynb`, which is an external attached file rather than a repository
   path. Give the extractor a required `--notebook` argument (or a documented environment variable),
   show the exact invocation, and fail clearly when the source file is unavailable. Do not bake one
   developer's absolute Downloads path into the committed script.

#### Process correction

- The plan requires agent-team waves but does not define them, while C4.4/C4.6/C4.7/C4.8/C4.9 all
  modify `routes/scenarios.ts` and C4.5/C4.10 both modify OpenAPI. Add an explicit dependency/wave table
  that serializes shared-file owners (at minimum C4.4 -> C4.6 -> C4.7 -> C4.8 -> C4.9, and C4.5 ->
  C4.10) so parallel workers cannot overwrite or cherry-pick conflicting versions.

**Approval condition:** update the normative spec for the demand-domain decision and removed reset
surface; make the shared ExportEnvelope and CBC-status contracts complete; then fold the estimator,
effective-city, mode-label, Gate-1, extraction, and execution-order corrections above before dispatch.

### Plan Rev 4 re-review — 2026-09-15 (FOLDED — nothing left open)

**All verified correct and resolved:** real non-empty Chen `inputsSchema` in the manifest + API
`manifests.test.ts` run (C4.2); C4.1 snippet + command actually forward `--notebook <path>` (guarded,
never baked); complete 8-value OpenAPI `PrecheckError.code` enum + round-trip contract test (C4.5);
ONE locked estimator — separate `fillEstimatedChensDistances`, km `R=6371`, 2 dp, `0.01` km floor
(C4.7); effective id→city lookup (base ∪ added) wired into `buildOpenWarehouseRows` at the call site
(C4.9 Step 3); incompatible-mode compare RTL (C4.14); auditable geocode provenance with normalized
input/result city + place id (C4.1b); C4.15 gate adds dataset-schema + manifest suites; header → Rev 9 /
D1–D30; C4.4 interface drops export/import/**reset**; C4.5 commit renamed (rows opaque); D30 in the
self-review matrix; the historical Rev-2 synopsis corrected (opaque rows, no reset). Original text below.

**Disposition (historical):** the substantive Rev 3 mathematical/failure-layer decisions are folded and the plan is
close, but it remains non-executable as written. Three blockers remain: one newly exposed manifest
gate, one incompletely folded extraction fix, and one newly exposed OpenAPI drift. Items explicitly
marked **residual Rev 3** below were addressed in prose but not in every executable step; the others are
new findings from this repository-contract pass.

#### Blockers

1. **[NEW] C4.2's empty `inputsSchema` fails the existing manifest suite.** The proposed manifest still
   contains `"inputsSchema": {}`, while `artifacts/api-server/src/__tests__/manifests.test.ts` iterates
   every `MODEL_IDS` entry and requires `Object.keys(inputsSchema).length > 0`. Define Chen's real JSON
   Schema (including D30 integer demand, common required fields, and the objective-dependent
   `avgServiceDistCapKm`/`coverageFloorDemand` contract), add it to the manifest, and run the API
   manifest test in C4.2 in addition to the dataset-schema package test.

2. **[RESIDUAL REV 3] C4.1's executable snippet and run command still omit the notebook path.** Step 1
   correctly requires `--notebook`, but Step 2 still calls `dump_chens.py` with no arguments and Step 3
   still runs `extract-chens-dataset.ts` without a path. Resolve a `notebookPath` from
   `CHENS_NOTEBOOK ?? process.argv[2]`, reject an absent value before building the argument array, pass
   `['--notebook', notebookPath]` to `execFileSync`, and show the path-bearing command in Step 3.

3. **[NEW] C4.5 would keep the OpenAPI precheck enum incomplete.** The server's existing
   `PrecheckErrorCode` already includes `p_range` and `capacity`, but OpenAPI currently lists only
   `completeness`, `id_collision`, and `reference_integrity`. Adding only Chen's three new values still
   leaves generated clients unable to represent two real server outcomes and contradicts D18's “reuse
   `p_range`” contract. C4.5 must set the complete enum to `completeness | id_collision |
   reference_integrity | p_range | capacity | zero_demand | no_feasible_route |
   coverage_floor_infeasible`, regenerate, and add a contract assertion covering all eight values.

#### Important corrections

1. **[RESIDUAL REV 3] Lock one C4.7 estimator implementation.** The plan correctly warns that
   `fillEstimatedDistances` reparses through `pMedianInputsSchema`, but still leaves “extract a generic
   core OR write a separate Chen estimator” open. Select one implementation before dispatch. Also lock
   the exact kilometre rounding and positive-minimum constant so persisted estimates and tests are
   deterministic.

2. **[RESIDUAL REV 3] Put the effective-city lookup into C4.9's implementation step.** The failing test
   now correctly covers base and scenario-added zero-flow facilities, but Step 3 still mentions only
   `distanceUnit` and the `openFacilityIds` union. Explicitly change `buildOpenWarehouseRows` to receive
   an effective id-to-city lookup (base warehouses union `inputs.addedWarehouses`) and construct/pass it
   at the export route call site.

3. **[NEW REFINEMENT OF D14] Add an incompatible-mode compare test.** C4.14 now tests ObjectiveBar and
   CostSummary formatting, but merely states that compare is restricted to matching
   `details.objective`. Add RTL proving that two solved Chen scenarios with different objective modes
   cannot be selected/compared together, while two scenarios with the same mode can.

4. **[NEW] Make D26 geocode acceptance auditable.** The planned provenance shape stores raw `city`,
   `status`, `selectedDisplayName`, and `zip`, but not the normalized values used by the acceptance rule.
   Persist at least `normalizedInputCity` and `normalizedResultCity` (plus the selected result identity)
   for every row so a reviewer can reproduce why a hit was accepted or rejected.

5. **[NEW] Include the package/manifest gates in C4.15.** The final gate omits
   `pnpm --filter @workspace/dataset-schema test`, despite package validation/hash/manifest correctness
   being central to C4.1-C4.2. Add that command and ensure the API manifest suite runs after the final
   dataset/version files are settled.

#### Consistency cleanup

- Update the plan's single-source header from **Rev 8 / D1-D29** to **Rev 9 / D1-D30**.
- Remove the remaining `export/import/reset` phrase from C4.4's produced interface; only
  export/import/apply survive.
- Rename C4.5's commit summary: `ExportEnvelope.rows` now deliberately stays opaque, so “output rows”
  inaccurately describes the change.
- Add D30 to the Self-review spec-coverage matrix.
- Replace the historical Rev 2 folded-summary claim that C4.5 added “exact ExportEnvelope row schemas”
  with the final Rev 3 decision to preserve opaque rows, so even the audit synopsis does not report a
  behavior that the normative plan later reversed.

**Approval condition:** supply a non-empty Chen input JSON Schema, make the extractor command actually
forward its required notebook path, and synchronize all eight precheck codes in OpenAPI. Then lock the
estimator/city wiring and add the compare, provenance, and final-gate assertions before implementation
dispatch.
