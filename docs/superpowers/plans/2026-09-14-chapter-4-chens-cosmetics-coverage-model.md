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
`docs/superpowers/specs/2026-09-14-chapter-4-chens-cosmetics-coverage-model-design.md` — Rev 8,
decisions **D1–D29**. Cite only the normative body.

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

## Task C4.1: Extract dataset (record-maps, flat distances)

**Files:** Create `scripts/py/dump_chens.py`, `scripts/src/extract-chens-dataset.ts`,
`solvers/chens-cosmetics-cn/dataset/{warehouses,customers,distances,version}.json`.
Reference `solvers/two-echelon-gold-au/dataset/*.json` (exact shape).

**Interfaces — Produces:** record-map dataset with slug ids `wh-<n>`/`cs-<n>`, flat `DistanceMap`,
RAW km, `version.json` matching `computeSha256`.

- [ ] **Step 1: Create `dump_chens.py`** (the extractor proven during brainstorming — declare it here).
  It slices `get_data()` out of `ChensCosmeticsV1 Step 3.ipynb` via ast and prints
  `{"warehouses":{n:[name,city,country,lat,lng]}, "customers":{…}, "customer_demands":{n:dem},
  "distance":{"w,c":km}}`. (Copy the brainstorming `ast.literal_eval` slice verbatim.)

- [ ] **Step 2: Write the extraction script — record-maps + flat distances.**

```ts
// scripts/src/extract-chens-dataset.ts — run: pnpm tsx scripts/src/extract-chens-dataset.ts
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const OUT = "solvers/chens-cosmetics-cn/dataset";
const raw = JSON.parse(execFileSync("python3", ["scripts/py/dump_chens.py"], { encoding: "utf8" }));
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

- [ ] **Step 3: Run + assert counts/ids/raw.**

Run: `pnpm tsx scripts/src/extract-chens-dataset.ts`
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
  per-row provenance `{id, city, status, selectedDisplayName, zip}`. If `hits/222 < 0.85` → throw
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
  "inputsSchema": {}
}
```
(Confirm the exact `datasetDir` convention against an existing manifest — match it verbatim; the
value above assumes repo-relative like the others. `inputsSchema` is required; `{}` is accepted by
`z.record`.)

- [ ] **Step 3: Register** — add `PACKAGE_SPECS` entry `{ modelId: "chens-cosmetics-cn", files: {
  "warehouses.json": WarehouseEntryMap, "customers.json": CustomerEntryMap, "distances.json":
  DistanceMap } }` (match the two-echelon entry's `files` record shape EXACTLY — no `datasetDir` key);
  add `"chens-cosmetics-cn"` to `MODEL_IDS`.

- [ ] **Step 4: Tests** — (a) `manifest.test.ts`: `ManifestSchema.parse(<Chen manifest>)` →
  `distanceUnit==="km"`, exact `outputGrids`, `chapter==="Chapter 4"`. (b) `index.test.ts`:
  `validatePackage("chens-cosmetics-cn")` passes AND `computeSha256(spec) === readVersion(...).sha256`.

- [ ] **Step 5: Run + commit.**

Run: `pnpm --filter @workspace/dataset-schema test`
```bash
git add solvers/chens-cosmetics-cn/manifest.json lib/dataset-schema/src/index.ts lib/dataset-schema/src/manifest.test.ts lib/dataset-schema/src/index.test.ts
git commit -m "[C4.2] register chens-cosmetics-cn manifest (km) + PACKAGE_SPECS/MODEL_IDS + hash test"
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
def test_min_distance_golden():
    r = run({**BASE,"objective":"min_distance","coverageFloorDemand":131645389})
    assert r["status"]=="optimal"
    assert r["objective"]==pytest.approx(123834216789.27,abs=0.05)
    assert r["metrics"]["weightedAvgDistance"]==pytest.approx(621.44,abs=0.05)
    assert set(r["details"]["openWarehouseIds"])=={"wh-40","wh-69","wh-102"}
def test_floor_infeasible():
    assert run({**BASE,"objective":"min_distance","coverageFloorDemand":500100100})["status"]=="infeasible"
def test_maxdist_feasibility():
    r = run({**BASE,"objective":"coverage","avgServiceDistCapKm":1000,"maxDistKm":300})
    # every emitted edge respects adjusted maxDist, or infeasible
    assert r["status"] in ("optimal","infeasible")
    if r["status"]=="optimal": assert all(e["distance"]<=300 for e in r["edges"])
```

- [ ] **Step 2: Run — expect fail** (`Unknown modelType: chens`).
  `cd artifacts/api-server/src/solver && python3 -m pytest tests/test_chens.py -x`.

- [ ] **Step 3: `build_merged_chens_dataset`** in `merge_inputs.py` — copy `build_merged_pmedian_dataset`'s
  structure verbatim (same added-entity append, `distanceOverrides` sparse replace, `warehouseOverrides`
  status → `forced`/`inactive` sets, `customerOverrides` excluded set + demand override), return the
  **same dict shape** it returns. Chen ids are strings (`wh-`/`cs-`), so the merged dicts are keyed by
  string id (pmedian uses int keys — adapt key type, keep structure).

- [ ] **Step 4: `solve_chens`** — one objective-sense branch (rule 6); CBC with the input controls;
  `flow` = effective demand (NOT rounded — demand may be non-integer once overridden); zero-demand →
  infeasible; round per D22 (coveragePct 4dp, avg 2dp, min-dist objective 2dp). Reuse `_envelope`.

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
    if st != "Optimal":
        return _envelope("infeasible","infeasible",0,round(time.time()-t,2),[],_EMPTY_METRICS,_EMPTY_DETAILS,f"CBC status: {st}")
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

- [ ] **Step 7: Vitest schema validation** — in `__tests__/resultEnvelope.test.ts` add a case that
  spawns `python3 solve.py` for `modelType:"chens"` (coverage + an error payload) and asserts the
  stdout parses against `ResultEnvelopeSchema` (real TS validation, not a Python structural check).

- [ ] **Step 8: e2e_accuracy unchanged.** `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py`.

- [ ] **Step 9: Commit** `[C4.3] solve_chens + build_merged_chens_dataset (dict repr, CBC gap/timeLimit, flow=demand)`.

---

## Task C4.4: Backend dataset loader + /dataset + reference distances + model→entity selection

**Files:** Create `artifacts/api-server/src/data/chensDataset.ts`; modify `data/dataset.ts` (or
`routes/dataset.ts` dispatch), `data/referenceDistances.ts`, `services/templates.ts` (template/stub
dataset selection), `services/import.ts` (column/dispatch), `routes/scenarios.ts` (`entityIsChens` +
per-model guard ~L531-547, reset-to-baseline). Tests: `__tests__/dataset.test.ts`,
`routes.test.ts`, `referenceDistances` test.

**Interfaces — Produces:** `GET /dataset?modelId=chens-cosmetics-cn` returns Chen warehouses/customers;
`GET /models/chens-cosmetics-cn/reference-distances` returns the base×base matrix; export/import/reset
resolve **Chen's** dataset, never a sibling's.

- [ ] **Step 1: Failing tests** — `/dataset?modelId=chens-cosmetics-cn` returns 25 WH / 197 customers;
  reference-distances returns 4925 pairs; **negative sibling test**: exporting `entity=warehouses` for
  a Chen scenario returns Chen rows (not p-median-us rows); `entity=mines` for Chen → 422.

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

- [ ] **Step 1: Edit `openapi.yaml`** — add `chens-cosmetics-cn` to the `modelId` enum; add precheck
  codes `zero_demand`/`no_feasible_route`/`coverage_floor_infeasible`; **add** (not remove yet) solve-
  history `objectiveMode (string|null)`, `weightedAvgDistance (number|null)`, `distanceUnit`; add the
  output entity values + exact row schemas to `ExportEnvelope.entity`/`rows` OR explicitly document the
  generated client as opaque `rows: object` with a one-line rationale.

- [ ] **Step 2: Regenerate + typecheck.** `pnpm --filter @workspace/api-spec run codegen` (orval +
  typecheck:libs) → green.

- [ ] **Step 3: Commit** `[C4.5] OpenAPI: chens modelId, precheck codes, additive solve-history fields, ExportEnvelope output rows (+regen)`.

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
- [ ] **Step 3: Implement** `chensInputsSchema` (D19 `.transform` overwrites `distanceBands` to
  `[high,max]`; refinement `high<max`); add to `KNOWN_SCHEMAS` + `VALID_MODEL_IDS` +
  `validateInputsForModel`; add the `SolveInput` union member + `buildPayload` branch (sparse edits,
  NOT merged dataset); extend `registry.test.ts`'s `SOLVABLE`.
- [ ] **Step 4: Run — PASS. Commit** `[C4.6] Chen Zod inputs + KNOWN_SCHEMAS/VALID_MODEL_IDS registration + buildPayload (atomic)`.

---

## Task C4.7: Added-entity distance estimator (autoDistance)

**Files:** Modify `services/autoDistance.ts` (`fillEstimatedChensDistances`), `routes/scenarios.ts`
(`normalizeAddedEntityDistances` Chen dispatch); test `__tests__/autoDistance.test.ts`,
`routes.test.ts`.

- [ ] **Step 1: Failing test** — `fillEstimatedChensDistances` fills a missing added-entity pair with
  **raw haversine km** (`R=6371`, NO ×1.17), leaves existing pairs untouched, is idempotent; the
  `normalizeAddedEntityDistances` PATCH path invokes it for Chen (create/move/delete reconciliation).
- [ ] **Step 2: Run — fail.** `pnpm --filter api-server test autoDistance`.
- [ ] **Step 3: Implement** — add `fillEstimatedChensDistances(inputs, dataset)` next to
  `fillEstimatedBrazilDistances` (reuse the generic core with a km-not-mile haversine and circuity=1);
  dispatch Chen in `routes/scenarios.ts::normalizeAddedEntityDistances`.
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
  openWarehouses/flows/distances; **`buildOpenWarehouseRows` includes a forced-open zero-flow WH**
  (union `metrics.openFacilityIds` with edge-derived ids).
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** — `export const OUTPUT_TEMPLATE_VERSION = 2;`; update the 3 builders +
  serializers to D24/D25 shapes (pass `distanceUnit` from manifest into the builders); union
  `openFacilityIds` in `buildOpenWarehouseRows`; per-entity wrapper version in `scenarios.ts`. Do NOT
  touch the importable `distances` export or `flows`/`legDistances`.
- [ ] **Step 4: Run full api-server suite — PASS** (existing mile-model export tests updated to the new
  columns; in-scope per D24). Commit `[C4.9] unit-aware output exports + OUTPUT_TEMPLATE_VERSION=2 (both JSON levels) + openFacilityIds union`.

---

## Task C4.10: Solve-history unit-carrying shape (removes weightedAvgDistanceMi)

**Files:** Modify `solver/jobRunner.ts`, `routes/solveHistory.ts`, `lib/api-spec/openapi.yaml` (+regen,
remove `weightedAvgDistanceMi`), `pages/Landing.tsx` (recent-solves consumer); tests
`__tests__/solveHistory.test.ts`, `jobRunner.test.ts`.

- [ ] **Step 1: Failing tests** — new solve writes `resultSummary = {status, objective, objectiveMode,
  weightedAvgDistance, distanceUnit, runTimeSec}` (objectiveMode from `details.objective` else `null`;
  distanceUnit from manifest); reader on a **legacy successful** row (only `weightedAvgDistanceMi`)
  returns that value + `distanceUnit:"mi"` + `objectiveMode:null`; a **failed** job returns nulls (the
  `"mi"` fallback applies ONLY to a legacy successful summary — derive unit from `modelId` when the
  summary is absent).
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement** (jobRunner write + solveHistory read + openapi remove `weightedAvgDistanceMi`
  + regen + Landing consumer, ALL in this one commit so every commit stays green).
- [ ] **Step 4: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test` —
  green. Commit** `[C4.10] solve-history unit-carrying resultSummary + legacy fallback (remove weightedAvgDistanceMi, +regen)`.

---

## Task C4.11: Frontend — chapter registration (real interface) + defaults + km labels

**Files:** Modify `lib/chapters.ts` (extend `StudioModelType` + add `Chapter`), `App.tsx`,
`pages/Workspace.tsx` (`defaultInputsForModel` branch), `AssignmentsTab.tsx`, `ObjectiveBar.tsx`,
`NetworkMap.tsx` (popup), `OptimizationParametersTab.tsx`, `Landing.tsx`; RTL tests.

- [ ] **Step 1:** Add `"chens-cosmetics-cn"` to `StudioModelType`; add a `Chapter` entry with ALL
  required fields (`modelId, chapter:"Chapter 4", title, path:"/chapter-4", labHeaderTitle,
  labHeaderSubtitle, workspace:true, hiddenFromLanding:false`, + description/summary fields as the
  interface actually defines them — copy an existing entry's field set verbatim). Add the `App.tsx`
  route.
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
  min-distance → `coverageFloorDemand` default 131645389 + "> 199M infeasible" hint). RTL: toggle swaps.
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
  move/delete/save reconciliation. Reuse the existing p-median map-editor plumbing (this is the
  full-parity D6 requirement, not a Gate-1 sweep). RTL: add → save → the added entity appears with
  City/State/Lat/Lng and a display code.
- [ ] **Step 2:** Distances tab shows Chen base (raw-km reference) + overrides with display codes.
- [ ] **Step 3: PASS. Commit** `[C4.13] Chen full Input-Map parity (projection, symbology, uid/displayCode, reconciliation)`.

---

## Task C4.14: Frontend — map (China bounds, coverage lens) + Gate-1 sweep + output tabs

**Files:** `NetworkMap.tsx`, `mapBounds.ts`, band lens/`bandPalette`, `MapLegend`, every `modelId===`
allowlist (Gate-1 10 points), `ServiceStatsTab.tsx`, `CostSummaryTab.tsx`, compare gating; RTL.

- [ ] **Step 1: Gate-1 sweep** — add `chens-cosmetics-cn` to each shared allowlist (10 points per
  `model-integration-precheck.md`); China bounds from manifest `{sw,ne}` contain all points (RTL).
- [ ] **Step 2: Two-class coverage lens** — routes `≤high` (covered) / `high<d≤max` (uncovered),
  client-side.
- [ ] **Step 3: Output tabs (D14)** — ServiceStatsTab rows Coverage%/Covered/Uncovered (from `details`)
  + Avg service distance (from `metrics.weightedAvgDistance`) + band rows; CostSummaryTab mode-aware
  Objective; compare restricted to same `details.objective`. RTL.
- [ ] **Step 4: PASS. Commit** `[C4.14] Chen map (China bounds, coverage lens) + Gate-1 sweep + output tabs`.

---

## Task C4.15: Full gate + e2e_accuracy

- [ ] **Step 1:** `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test &&
  (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)` — all green.
- [ ] **Step 2:** `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py` — unmodified pass.
- [ ] **Step 3:** Verification only; fix any red in the owning task's file, re-commit under that id.

---

## Task C4.16 (QA): Real-browser Playwright

**Files:** Create `artifacts/studio/e2e/chens-cosmetics.spec.ts`.

- [ ] **Step 1:** Dev-proxy setup (`API_PROXY_TARGET`, per the repo's e2e gotcha). Flow: register →
  create Chen scenario → coverage solve → coverage ≈66% / 3 cities (Guangzhou/Jinan/Nanjing) → switch
  min_distance → solve → edit a demand → re-solve delta → distance override → assignment change →
  Input-Map add → save → precheck surfaces → `km` present / `mi` absent → **export customers CSV, edit,
  re-import** (the importable `distances`/`customers` CSV round-trip — NOT an output-only export).
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
(C4.3) · D18 (C4.8) · D20+D24+D28+D29 (C4.9) · D21 (C4.10) · D25 (C4.9) · D27 (C4.12) — mapped. Backend
dataset/reference/export-selection now owned (C4.4). Registration atomic (C4.6). Full Input-Map parity
owned (C4.13).

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
