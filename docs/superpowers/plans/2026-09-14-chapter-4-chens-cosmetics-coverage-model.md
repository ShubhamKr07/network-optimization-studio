# Chapter 4 — Chen's Cosmetics Coverage Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: execute via the **agent team** (backend-engineer /
> frontend-engineer / qa-sdet), waves by file-disjointness, per the repo's standing orchestration
> preference — NOT sequential subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
> Controller cherry-picks each task onto the branch and re-runs its gate before merging.

**Goal:** Add `chens-cosmetics-cn` — a China single-echelon warehouse→customer service-level model
(Watson Ch.4) with two coupled objectives (coverage / min-distance) behind one mode toggle — as the
6th solver model, full-stack and visible, with full scenario-local-edit parity.

**Architecture:** Data-driven new model. Dataset extracted from the notebook into a package; a new
`solve_chens()` in `solve.py` dispatched on `modelType=="chens"`; the standard async job/envelope
path; full Workspace UI (mode toggle, tables, output grids, map). Overrides/added-entities merged
**Python-side** (`merge_inputs.py`). km is this repo's first non-mile model, so distance-unit plumbing
(exports, solve-history, labels) is generalized.

**Tech Stack:** Python 3 + PuLP/CBC (solver); Express 5 + Drizzle + Zod (api-server); OpenAPI + Orval
(contract/codegen); React + Vite + TanStack Query + Leaflet (studio); vitest / pytest / Playwright.

**Spec (single source of truth):**
`docs/superpowers/specs/2026-09-14-chapter-4-chens-cosmetics-coverage-model-design.md` — Rev 8,
decisions **D1–D29**. Cite only the normative body; never the Review-history alternatives.

## Global Constraints

- **pnpm only.** Verification gate: `pnpm run typecheck && pnpm --filter api-server test && pnpm
  --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`.
- **One task = one commit**, message `[C4.N] <imperative>`. Spec + regenerated codegen in the SAME
  commit (hard rule 1/4). Never hand-edit `lib/api-zod/src/generated/` or
  `lib/api-client-react/src/generated/` — edit `lib/api-spec/openapi.yaml`, run Orval.
- **`e2e_accuracy.py` is sacred** (hard rule 2) — must pass unmodified after every task that touches
  Python. Run it (`python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py`) whenever solver/
  dataset code changes; it is NOT in the pytest gate.
- **Ownership 404 never 403** (hard rule 5). **Solver rules enter as data, not branches** (hard rule 6).
- **Circuity (D8):** store RAW km in `distances.json`; apply `× 1.17` in the solver only.
- **Golden values (D3/D22):** coverage `coveredDemand == 131645389`, `details.coveragePct ==
  approx(66.0639, abs=1e-3)`, open `{wh-40, wh-69, wh-102}`; min-distance `objective ==
  approx(123834216789.27, abs=0.05)`, `metrics.weightedAvgDistance == approx(621.44, abs=0.05)`;
  floor `500100100` infeasible. Total demand `199269881`. NEVER assert coverage-mode average or `rel=`.
- **km display:** manifest `distanceUnit:"km"`; assert `km` / absence of `mi` on every Chen surface.
- **Merge is Python-side (D23):** `buildPayload` emits sparse edits by schema name; `merge_inputs.py`
  merges. **Dispatch on `modelType` not `modelId` (D16).**
- **Deploy deferred** — surface + confirm before any Render push.

---

## File structure

**New:**
- `solvers/chens-cosmetics-cn/{manifest.json, dataset/{warehouses,customers,distances,version}.json}`
- `scripts/src/extract-chens-dataset.ts` (one-off), `scripts/src/geocode-chens.ts` (one-off) + its
  `docs/dataset-audit/chens-geocode-provenance.json`
- `artifacts/api-server/src/validation/inputs/chens.ts`
- `artifacts/api-server/src/solver/tests/test_chens.py`
- `artifacts/studio/src/…` Chen-specific bits only where a shared component can't be gated
- `artifacts/studio/e2e/chens-cosmetics.spec.ts`

**Modified (single-writer noted for agent-team):**
- `artifacts/api-server/src/solver/solve.py` — `solve_chens()` + `modelType=="chens"` dispatch (T3 writer)
- `artifacts/api-server/src/solver/merge_inputs.py` — `build_merged_chens_dataset` (T3 writer)
- `artifacts/api-server/src/solver/resultEnvelope.ts` — no schema change (reuse; verify only)
- `artifacts/api-server/src/solver/pmedian.ts` — `SolveInput` union + Chen `buildPayload` (T5 writer)
- `artifacts/api-server/src/services/precheck.ts` — new codes + `precheckChensInputs` (T6 writer)
- `artifacts/api-server/src/services/templates.ts` — export rename + versions + nullability (T7 writer)
- `artifacts/api-server/src/routes/scenarios.ts` — export wrapper version + Chen precheck wiring (T7/T6)
- `artifacts/api-server/src/routes/solveHistory.ts` — resultSummary shape + legacy read (T8 writer)
- `artifacts/api-server/src/solver/jobRunner.ts` — resultSummary write shape (T8 writer)
- `lib/api-spec/openapi.yaml` (+ regen) — modelId enum, precheck codes, solve-history, export enum (T2/T8)
- `lib/dataset-schema/src/index.ts` — PACKAGE_SPECS + MODEL_IDS (T1 writer)
- `artifacts/studio/src/lib/chapters.ts`, `components/workspace/**`, `NetworkMap.tsx`, etc. (Wave 4)

**Waves (agent-team):** T1 ⟂ (extraction) → T2 (contract) → T3 (solver) → T4 (registry/manifest test)
→ T5 (buildPayload) ⟂ T6 (precheck) → T7 (exports/km) ⟂ T8 (solve-history) → Wave 4 frontend
(T9–T14, single-writer `Workspace.tsx`/`chapters.ts`) → T15 QA. Backend lane (`api-server`/`lib`/
Python) ⟂ frontend lane (`studio`) where file-disjoint.

---

## Task C4.1: Extract dataset + geocode + package

**Files:**
- Create: `scripts/src/extract-chens-dataset.ts`, `scripts/src/geocode-chens.ts`
- Create: `solvers/chens-cosmetics-cn/dataset/{warehouses,customers,distances,version}.json`
- Create: `docs/dataset-audit/chens-geocode-provenance.json`
- Reference: `solvers/two-echelon-gold-au/dataset/*.json` (shape), source notebook
  `~/Downloads/ChensCosmeticsV1-UNZIP-before-USING-this-is-3-files/ChensCosmeticsV1 Step 3.ipynb`

**Interfaces:**
- Produces: dataset files with slug ids `wh-<n>`/`cs-<n>` (numeric ids collide across WH/customer sets;
  slugging avoids the PK collision). `warehouses.json` rows `{id, city, state:"", lat, lng, zip?}` (NO
  `country`, NO `kind` — stripped by `WarehouseEntry`). `customers.json` rows `{id, city, state:"",
  lat, lng, demand, zip?}`. `distances.json` **raw km**, index-keyed `[whOrdinal, csOrdinal]` — same
  container shape as `two-echelon-gold-au/dataset/distances.json`.

- [ ] **Step 1: Write the extraction script.** Import the notebook's `get_data()` verbatim (no
  hand-retype), map numeric→slug ids consistently across all three outputs, write RAW distances.

```ts
// scripts/src/extract-chens-dataset.ts — run: pnpm tsx scripts/src/extract-chens-dataset.ts
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const OUT = "solvers/chens-cosmetics-cn/dataset";
// Emit a tiny python that imports the notebook's get_data() (via nbconvert-free ast slice already
// proven in brainstorming) and prints JSON: {warehouses:{id:[name,city,country,lat,lng]}, customers:…,
// customer_demands:{id:dem}, distance:{"w,c":km}}. Reuse the brainstorming extractor verbatim.
const raw = JSON.parse(execFileSync("python3", ["scripts/py/dump_chens.py"], { encoding: "utf8" }));
const whIds = Object.keys(raw.warehouses).map(Number).sort((a,b)=>a-b);
const csIds = Object.keys(raw.customers).map(Number).sort((a,b)=>a-b);
const warehouses = whIds.map(n => { const w = raw.warehouses[n]; return { id:`wh-${n}`, city:w[1], state:"", lat:w[3], lng:w[4] }; });
const customers  = csIds.map(n => { const c = raw.customers[n]; return { id:`cs-${n}`, city:c[1], state:"", lat:c[3], lng:c[4], demand: raw.customer_demands[n] }; });
// distances: match two-echelon container shape — verify against solvers/two-echelon-gold-au/dataset/distances.json first
const distances = { fromIds: warehouses.map(w=>w.id), toIds: customers.map(c=>c.id),
  matrix: whIds.map(w => csIds.map(c => raw.distance[`${w},${c}`])) }; // RAW km, NO ×1.17
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/warehouses.json`, JSON.stringify(warehouses, null, 2));
writeFileSync(`${OUT}/customers.json`, JSON.stringify(customers, null, 2));
writeFileSync(`${OUT}/distances.json`, JSON.stringify(distances, null, 2));
const version = createHash("sha256").update(JSON.stringify({warehouses,customers,distances})).digest("hex");
writeFileSync(`${OUT}/version.json`, JSON.stringify({ version: 1, sha256: version }, null, 2));
```

- [ ] **Step 2: Verify the distances container shape** against an existing model before trusting it.

Run: `python3 -c "import json;d=json.load(open('solvers/two-echelon-gold-au/dataset/distances.json'));print(list(d)[:3])"`
Match `extract-chens-dataset.ts`'s `distances` object keys to what the loaders expect (adjust
`fromIds/toIds/matrix` naming to the real container). Re-run Step 1 after aligning.

- [ ] **Step 3: Run extraction; assert counts + no ×1.17.**

Run: `pnpm tsx scripts/src/extract-chens-dataset.ts`
Then: `python3 -c "import json;w=json.load(open('solvers/chens-cosmetics-cn/dataset/warehouses.json'));c=json.load(open('solvers/chens-cosmetics-cn/dataset/customers.json'));print(len(w),len(c),sum(x['demand'] for x in c))"`
Expected: `25 197 199269881`. Confirm ids 81/120/135 absent from customers; a spot distance is raw
(e.g. wh-15→cs-1 == 3660.0, NOT ×1.17).

- [ ] **Step 4: Geocode zips (D9/D26).** City-match-only acceptance, ≥85% floor or abort, ambiguous→blank.

```ts
// scripts/src/geocode-chens.ts — Nominatim, 1 req/sec, retry/backoff.
// For each of 25 WH + 197 customers: query "<city>, China"; accept a result ONLY if its returned
// city (case-insensitive, trimmed) matches the row's city; multiple-equal-rank or no-match → ambiguous,
// zip left absent (does NOT count as a hit). Write per-row provenance
// {id, city, status:"hit"|"miss"|"ambiguous", selectedDisplayName, zip} to
// docs/dataset-audit/chens-geocode-provenance.json. If hits/222 < 0.85 → throw (abort, no partial write).
// On success, splice accepted zips back into warehouses.json / customers.json and recompute version.json.
```

- [ ] **Step 5: Run geocode; confirm floor + provenance.**

Run: `pnpm tsx scripts/src/geocode-chens.ts`
Expected: prints `hits/222 ≥ 0.85`, writes provenance; `warehouses.json`/`customers.json` gain `zip`
on hit rows only; `version.json` sha256 updated. Zip is display-only (asserted never read by the
solver in C4.3).

- [ ] **Step 6: Commit.**

```bash
git add scripts/src/extract-chens-dataset.ts scripts/src/geocode-chens.ts scripts/py/dump_chens.py \
  solvers/chens-cosmetics-cn/dataset docs/dataset-audit/chens-geocode-provenance.json
git commit -m "[C4.1] extract Chen's Cosmetics China dataset (25 WH / 197 customers / raw-km) + geocoded zips"
```

---

## Task C4.2: Manifest + dataset-schema registration

**Files:**
- Create: `solvers/chens-cosmetics-cn/manifest.json`
- Modify: `lib/dataset-schema/src/index.ts` (`PACKAGE_SPECS` ~L115, `MODEL_IDS` ~L249)
- Test: `lib/dataset-schema/src/manifest.test.ts`

**Interfaces:**
- Produces: model id `chens-cosmetics-cn` discoverable by the registry scan; manifest with
  `distanceUnit:"km"` and Chen capabilities.

- [ ] **Step 1: Compute countryBounds from ALL coords (never eyeball).**

Run: `python3 -c "import json;a=[*json.load(open('solvers/chens-cosmetics-cn/dataset/warehouses.json')),*json.load(open('solvers/chens-cosmetics-cn/dataset/customers.json'))];lat=[x['lat'] for x in a];lng=[x['lng'] for x in a];print(min(lng),max(lng),min(lat),max(lat))"`
Expected ≈ `75.97 130.97 20.05 47.4`. Pad each edge by ~2° for the manifest bounds.

- [ ] **Step 2: Write the manifest** (mirror `two-echelon-gold-au/manifest.json`; `distanceUnit:"km"` at
  top level — NOT a capability).

```json
{
  "id": "chens-cosmetics-cn",
  "name": "Chen's Cosmetics",
  "chapter": 4,
  "datasetDir": "dataset",
  "distanceUnit": "km",
  "countryBounds": { "west": 73.9, "east": 133.0, "south": 18.0, "north": 49.4 },
  "capabilities": {
    "supportsP": true,
    "capacityModes": ["none"],
    "demandEditable": true,
    "supportsFacilityStatus": true,
    "supportsAddedCustomerExclusion": true,
    "supportsReferenceDistances": true,
    "outputGrids": ["openWarehouses", "assignments", "costSummary", "serviceStats"]
  }
}
```

- [ ] **Step 3: Register in dataset-schema.** Add a `PACKAGE_SPECS` entry (same shape as the two-echelon
  entry: id, datasetDir, and its entity file list `warehouses/customers/distances`) and add
  `"chens-cosmetics-cn"` to `MODEL_IDS`.

- [ ] **Step 4: Add the DoD literal test** to `manifest.test.ts` — parsing the real Chen manifest
  yields `distanceUnit === "km"` and the exact `outputGrids` array.

```ts
it("chens-cosmetics-cn manifest declares km + its output grids", () => {
  const m = ManifestSchema.parse(JSON.parse(readFileSync("solvers/chens-cosmetics-cn/manifest.json","utf8")));
  expect(m.distanceUnit).toBe("km");
  expect(m.capabilities.outputGrids).toEqual(["openWarehouses","assignments","costSummary","serviceStats"]);
});
```

- [ ] **Step 5: Run + commit.**

Run: `pnpm --filter @workspace/db exec true; pnpm --filter dataset-schema test` (or the repo's
dataset-schema test command) — expect green.
```bash
git add solvers/chens-cosmetics-cn/manifest.json lib/dataset-schema/src/index.ts lib/dataset-schema/src/manifest.test.ts
git commit -m "[C4.2] register chens-cosmetics-cn manifest (km, coverage grids) in dataset-schema"
```

---

## Task C4.3: Solver `solve_chens` + Python merge

**Files:**
- Modify: `artifacts/api-server/src/solver/solve.py` (`solve_chens()`; `solve()` dispatch ~L1188)
- Modify: `artifacts/api-server/src/solver/merge_inputs.py` (`build_merged_chens_dataset`)
- Test: `artifacts/api-server/src/solver/tests/test_chens.py`

**Interfaces:**
- Consumes: dataset package (C4.1), `_envelope(status, quality, objective, run_time, edges, metrics,
  details, infeasibility_reason=None)`, `_EMPTY_METRICS`, `_EMPTY_DETAILS`.
- Produces: `solve_chens(inp)` returning a `ResultEnvelope`-shaped dict; wire keys consumed:
  `objective ∈ {"coverage","min_distance"}`, `p`, `highServiceDistKm`, `maxDistKm`,
  `avgServiceDistCapKm?`, `coverageFloorDemand?`, and sparse edits `warehouseOverrides`,
  `customerOverrides`, `addedWarehouses`, `addedCustomers`, `distanceOverrides`.

- [ ] **Step 1: Write the failing subprocess golden test** (D17 — error path only via CLI).

```python
# artifacts/api-server/src/solver/tests/test_chens.py
import json, subprocess, os, pytest
SOLVE = os.path.join(os.path.dirname(__file__), "..", "solve.py")
def run(payload):
    p = subprocess.run(["python3", SOLVE], input=json.dumps(payload), capture_output=True, text=True)
    return json.loads(p.stdout)
BASE = {"modelType":"chens","p":3,"highServiceDistKm":600,"maxDistKm":5000,
        "warehouseOverrides":[],"customerOverrides":[],"addedWarehouses":[],"addedCustomers":[],"distanceOverrides":[]}
def test_coverage_golden():
    r = run({**BASE, "objective":"coverage", "avgServiceDistCapKm":1000})
    assert r["status"] == "optimal"
    assert r["details"]["coveredDemand"] == 131645389
    assert r["details"]["coveragePct"] == pytest.approx(66.0639, abs=1e-3)
    assert set(r["details"]["openWarehouseIds"]) == {"wh-40","wh-69","wh-102"}
    assert set(r["metrics"]["openFacilityIds"]) == {"wh-40","wh-69","wh-102"}
    assert r["metrics"]["weightedAvgDistance"] <= 1000  # avg cap, D3
def test_min_distance_golden():
    r = run({**BASE, "objective":"min_distance", "coverageFloorDemand":131645389})
    assert r["status"] == "optimal"
    assert r["objective"] == pytest.approx(123834216789.27, abs=0.05)
    assert r["metrics"]["weightedAvgDistance"] == pytest.approx(621.44, abs=0.05)
    assert set(r["details"]["openWarehouseIds"]) == {"wh-40","wh-69","wh-102"}
def test_min_distance_floor_infeasible():
    r = run({**BASE, "objective":"min_distance", "coverageFloorDemand":500100100})
    assert r["status"] == "infeasible"
    assert r["infeasibilityReason"]
def test_zero_demand_infeasible():
    r = run({**BASE, "objective":"coverage", "avgServiceDistCapKm":1000,
             "customerOverrides":[{"id":c,"status":"excluded"} for c in []]})  # filled by merge test below
```

- [ ] **Step 2: Run it — expect failure** (`Unknown modelType: chens`).

Run: `cd artifacts/api-server/src/solver && python3 -m pytest tests/test_chens.py -x`
Expected: FAIL (dispatch falls to unknown-model error / KeyError).

- [ ] **Step 3: Add the Python merge helper** (D23) mirroring `build_merged_pmedian_dataset`.

```python
# merge_inputs.py — build_merged_chens_dataset(inp, WAREHOUSES, CUSTOMERS, DISTANCE)
# Returns (warehouses, customers, distance, excluded_customer_ids, forced_open_ids, inactive_wh_ids)
# after applying: addedWarehouses/addedCustomers (append), distanceOverrides (sparse map replace),
# warehouseOverrides.status (forced_open / inactive), customerOverrides (status excluded, demand override).
# Same pattern & helpers as build_merged_pmedian_dataset — reuse its added-entity + override plumbing.
```

- [ ] **Step 4: Add `solve_chens`** — objective sense is the ONLY branch (hard rule 6). Reuse
  `_envelope`. Circuity ×1.17 in-solver. Emit `metrics.openFacilityIds` + `details.openWarehouseIds` +
  `coveragePct`(4dp)/`coveredDemand`(int)/`uncoveredPct`(4dp), `metrics.weightedAvgDistance`(2dp),
  `metrics.bandCoverage` cumulative at `[high, max]`, edges `{fromId,toId,distance:adj,flow:dem}` (no
  `leg`). Zero effective demand → infeasible envelope (guard the ratio). Round per D22.

```python
def solve_chens(inp):
    from pulp import LpProblem, LpMaximize, LpMinimize, LpVariable, lpSum, LpInteger, LpStatus, value, PULP_CBC_CMD
    import time
    t = time.time()
    W, C, DIST, excluded, forced, inactive = build_merged_chens_dataset(inp, WAREHOUSES_CHENS, CUSTOMERS_CHENS, DISTANCE_CHENS)
    cand = [w for w in W if w["id"] not in inactive]
    custs = [c for c in C if c["id"] not in excluded]
    total = sum(c["demand"] for c in custs)
    hi, mx, p = inp["highServiceDistKm"], inp["maxDistKm"], inp["p"]
    if total <= 0:
        return _envelope("infeasible","infeasible",0,round(time.time()-t,2),[],_EMPTY_METRICS,_EMPTY_DETAILS,"Total effective demand is zero")
    adj = {(w["id"],c["id"]): DIST[(w["id"],c["id"])]*1.17 for w in cand for c in custs}
    hsp = {k: 1 if v <= hi else 0 for k,v in adj.items()}
    mdp = {k: 1 if v <= mx else 0 for k,v in adj.items()}
    mode = inp["objective"]
    prob = LpProblem("chens", LpMaximize if mode=="coverage" else LpMinimize)
    a = LpVariable.dicts("A", [(w["id"],c["id"]) for w in cand for c in custs], 0, 1, LpInteger)
    o = LpVariable.dicts("O", [w["id"] for w in cand], 0, 1, LpInteger)
    if mode == "coverage":
        prob += lpSum(hsp[w["id"],c["id"]]*c["demand"]*a[w["id"],c["id"]] for w in cand for c in custs)
        prob += lpSum(adj[w["id"],c["id"]]*c["demand"]*a[w["id"],c["id"]] for w in cand for c in custs) <= inp["avgServiceDistCapKm"]*total
    else:
        prob += lpSum(adj[w["id"],c["id"]]*c["demand"]*a[w["id"],c["id"]] for w in cand for c in custs)
        prob += lpSum(hsp[w["id"],c["id"]]*c["demand"]*a[w["id"],c["id"]] for w in cand for c in custs) >= inp["coverageFloorDemand"]
    for c in custs:
        prob += lpSum(a[w["id"],c["id"]] for w in cand) == 1
    prob += lpSum(o[w["id"]] for w in cand) == p
    for w in cand:
        if w["id"] in forced: prob += o[w["id"]] == 1
        for c in custs:
            prob += a[w["id"],c["id"]] <= o[w["id"]]
            prob += a[w["id"],c["id"]] <= mdp[w["id"],c["id"]]
    prob.solve(PULP_CBC_CMD(msg=0))
    st = LpStatus[prob.status]
    if st != "Optimal":
        return _envelope("infeasible","infeasible",0,round(time.time()-t,2),[],_EMPTY_METRICS,_EMPTY_DETAILS,f"CBC status: {st}")
    edges, covered, tdd = [], 0, 0.0
    for w in cand:
        for c in custs:
            if a[w["id"],c["id"]].varValue and a[w["id"],c["id"]].varValue > 0.5:
                d = adj[w["id"],c["id"]]; edges.append({"fromId":w["id"],"toId":c["id"],"distance":round(d,2),"flow":round(c["demand"])})
                tdd += c["demand"]*d
                if hsp[w["id"],c["id"]]: covered += c["demand"]
    open_ids = sorted(w["id"] for w in cand if o[w["id"]].varValue and o[w["id"]].varValue > 0.5)
    cov_pct = round(covered*100/total, 4)
    avg = round(tdd/total, 2)
    metrics = {"openFacilityIds": open_ids, "weightedAvgDistance": avg, "bandCoverage":
               [{"band": hi, "percent": cov_pct}, {"band": mx, "percent": 100.0}], "utilizationByNode": []}
    details = {"objective": mode, "p": p, "highServiceDistKm": hi, "maxDistKm": mx,
               "avgServiceDistCapKm": inp.get("avgServiceDistCapKm"), "coverageFloorDemand": inp.get("coverageFloorDemand"),
               "openWarehouseIds": open_ids, "coveragePct": cov_pct, "coveredDemand": int(covered),
               "uncoveredPct": round(100 - cov_pct, 4), "assignments": []}
    obj = cov_pct if mode == "coverage" else round(value(prob.objective), 2)
    return _envelope("optimal", "optimal", obj, round(time.time()-t,2), edges, metrics, details)
```

- [ ] **Step 5: Wire dispatch** — in `solve()` add `elif model_type == "chens": return solve_chens(inp)`
  (before the unknown-model error). Load the Chen package eagerly at module top like the others
  (`WAREHOUSES_CHENS`, `CUSTOMERS_CHENS`, `DISTANCE_CHENS`).

- [ ] **Step 6: Run the golden tests — expect PASS.**

Run: `cd artifacts/api-server/src/solver && python3 -m pytest tests/test_chens.py -x`
Expected: PASS (coverage 66.0639% / {wh-40,wh-69,wh-102}; min-distance 1.238e11; floor infeasible).

- [ ] **Step 7: Add override + zero-demand tests** to `test_chens.py`: forced-open binds (a WH with no
  demand still in `openWarehouseIds`), inactive WH absent, excluded customer absent from edges, an
  added WH is openable, a `distanceOverride` changes an assignment, all-excluded → infeasible, and a
  malformed payload via CLI → schema-valid `error` envelope. Run — expect PASS.

- [ ] **Step 8: Run e2e_accuracy (sacred) — unchanged.**

Run: `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py`
Expected: passes unmodified (Chen adds a package but touches no existing model's numbers).

- [ ] **Step 9: Commit.**

```bash
git add artifacts/api-server/src/solver/solve.py artifacts/api-server/src/solver/merge_inputs.py artifacts/api-server/src/solver/tests/test_chens.py
git commit -m "[C4.3] solve_chens (coverage/min-distance) + Python-side build_merged_chens_dataset"
```

---

## Task C4.4: OpenAPI contract + Orval regen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (+ regen `lib/api-zod`, `lib/api-client-react`)
- Test: existing contract tests (regen must typecheck)

**Interfaces:**
- Produces: `modelId` enum value `chens-cosmetics-cn`; precheck error codes `zero_demand`,
  `no_feasible_route`, `coverage_floor_infeasible`; solve-history fields (D21). NO `SolveMetrics`
  change (coverage KPIs ride `details`); `Edge`/export `entity` enums already cover Chen.

- [ ] **Step 1: Edit `openapi.yaml`** — add `chens-cosmetics-cn` to the `modelId` enum; add the 3 new
  `PrecheckErrorCode` enum values; update the solve-history schema to `{status, objective, objectiveMode
  (string|null), weightedAvgDistance (number|null), distanceUnit, runTimeSec}`, remove
  `weightedAvgDistanceMi`. Confirm the export `entity` enum already contains `assignments/openWarehouses/
  costSummary/serviceStats` (it does) — no change there.

- [ ] **Step 2: Regenerate.**

Run: `pnpm --filter api-spec exec orval --config orval.config.ts` (repo's Orval command)
Expected: `lib/api-zod/src/generated/` + `lib/api-client-react/src/generated/` update.

- [ ] **Step 3: Typecheck + commit spec + regen together.**

Run: `pnpm run typecheck` — expect green (frontend consumers of solve-history may go red here; that's
Wave 4's job — if so, note it and keep this commit to spec+regen+api-server only).
```bash
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "[C4.4] OpenAPI: chens-cosmetics-cn modelId, precheck codes, solve-history unit-carrying shape (+regen)"
```

---

## Task C4.5: Zod inputs + buildPayload

**Files:**
- Create: `artifacts/api-server/src/validation/inputs/chens.ts`
- Modify: `artifacts/api-server/src/validation/inputs/index.ts` (register in `validateInputsForModel`)
- Modify: `artifacts/api-server/src/solver/pmedian.ts` (`SolveInput` union + Chen `buildPayload` branch)
- Test: `artifacts/api-server/src/validation/inputs/__tests__/chens.test.ts`,
  `artifacts/api-server/src/__tests__/pmedian.test.ts`

**Interfaces:**
- Consumes: solver wire keys from C4.3.
- Produces: `ChensInputs` type; `SolveInput` member `{modelId:"chens-cosmetics-cn"; inputs: ChensInputs}`;
  `buildPayload` emits `modelType:"chens"` + sparse edits (D23) + derived `distanceBands=[high,max]`.

- [ ] **Step 1: Write failing validation tests** — objective discriminates required params; `p 1..25`;
  `highServiceDistKm < maxDistKm`; `avgServiceDistCapKm` required iff coverage; `coverageFloorDemand`
  required iff min-distance; `timeLimitSec` + `gap` required; `capacityMode:"none"` persisted;
  `addedWarehouses/addedCustomers` allow `displayCode?`; `distanceOverrides` allow `estimated?`.

- [ ] **Step 2: Run — expect fail** (module absent). Run: `pnpm --filter api-server test chens`.

- [ ] **Step 3: Write `chens.ts`** — Zod schema per D-list (complete field list in spec §Contract).
  `distanceBands` present but overwritten to `[highServiceDistKm, maxDistKm]` by a `.transform`
  (D19 normalize-not-reject); a refinement asserts `highServiceDistKm < maxDistKm`. Register in
  `index.ts`.

- [ ] **Step 4: Add the `SolveInput` union member + `buildPayload` branch** in `pmedian.ts` — emit
  `modelType:"chens"`, all scalar params, and the sparse edits by their exact schema names (NOT a
  merged dataset); add a Chen branch to `normalizeAddedEntityDistances` + a Chen estimator producing
  **raw haversine km** (`R=6371`, no ×1.17). Write `pmedian.test.ts` cases: both modes translate; a
  third `distanceBands` value normalizes to `[high,max]`; estimator returns km not miles.

- [ ] **Step 5: Run — expect PASS. Commit.**

Run: `pnpm --filter api-server test chens pmedian` — green.
```bash
git add artifacts/api-server/src/validation/inputs/chens.ts artifacts/api-server/src/validation/inputs/index.ts artifacts/api-server/src/solver/pmedian.ts artifacts/api-server/src/validation/inputs/__tests__/chens.test.ts artifacts/api-server/src/__tests__/pmedian.test.ts
git commit -m "[C4.5] Chen Zod inputs + buildPayload (modelType:chens, sparse edits, derived bands, km estimator)"
```

---

## Task C4.6: Semantic precheck

**Files:**
- Modify: `artifacts/api-server/src/services/precheck.ts` (`PrecheckErrorCode`, `precheckChensInputs`)
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (dispatch Chen to `precheckChensInputs`)
- Test: `artifacts/api-server/src/__tests__/precheck.test.ts`

**Interfaces:**
- Consumes: merged dataset semantics; manifest `distanceUnit`.
- Produces: `precheckChensInputs(inputs, dataset): PrecheckResult` — blocking-only.

- [ ] **Step 1: Write failing tests** — each blocking code fires: `zero_demand` (all excluded / all
  demand 0), `no_feasible_route` (a customer whose every active WH has `rawKm×1.17 > maxDistKm`),
  `coverage_floor_infeasible` (`coverageFloorDemand >` Σ demand of customers with ≥1 active WH at
  `rawKm×1.17 ≤ highServiceDistKm` — a necessary upper bound), `p_range` (`forcedOpen > p`,
  `p > active candidates`), `id_collision`/`completeness`/`reference_integrity` (added-entity dup id,
  missing added distance, unresolved override).

- [ ] **Step 2: Run — expect fail.** Run: `pnpm --filter api-server test precheck`.

- [ ] **Step 3: Add the 3 codes to `PrecheckErrorCode`** and implement `precheckChensInputs` — apply
  ×1.17 **after** merge + inactive/excluded filtering (both thresholds distinct: `no_feasible_route`
  uses `maxDistKm`, the coverage upper bound uses `highServiceDistKm`). Wire the Chen branch in
  `scenarios.ts`'s precheck dispatch (the `422 {ok:false}` path).

- [ ] **Step 4: Run — expect PASS. Commit.**

```bash
git add artifacts/api-server/src/services/precheck.ts artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/__tests__/precheck.test.ts
git commit -m "[C4.6] Chen semantic precheck (zero_demand/no_feasible_route/coverage_floor_infeasible, circuity-aware)"
```

---

## Task C4.7: km exports — assignment rename, CostSummary/ServiceStats versioning, self-describing units

**Files:**
- Modify: `artifacts/api-server/src/services/templates.ts` (`OUTPUT_TEMPLATE_VERSION`, row shapes, CSV)
- Modify: `artifacts/api-server/src/routes/scenarios.ts` (JSON wrapper version per entity)
- Test: `artifacts/api-server/src/__tests__/templates.test.ts`, export-route tests

**Interfaces:**
- Produces (D24/D25/D28/D29): `AssignmentTemplateRow.distance` + `distanceUnit` (rename from
  `distanceMi`); `CostSummaryTemplateRow` + `objectiveMode`/`distanceUnit`; `ServiceStatsTemplateRow` +
  `distanceUnit`; `OUTPUT_TEMPLATE_VERSION=2` for those three at BOTH JSON wrapper and rows.

- [ ] **Step 1: Write failing tests** — assignment CSV header is
  `template_version,customer_id,warehouse_id,distance,distance_unit,band,flow`; a Chen result exports
  `distance_unit=km` and NO `distance_mi`/`distanceMi`; a mile model exports `distance_unit=mi`;
  CostSummary CSV `…,objective_mode,…,distance_unit,…` with `objectiveMode` serialized as explicit
  `null` when absent; ServiceStats CSV `template_version,band,distance_unit,percent`; the JSON export
  **wrapper** `templateVersion` equals every row's for assignments/costSummary/serviceStats (==2) and
  stays 1 for openWarehouses/flows/distances.

- [ ] **Step 2: Run — expect fail.** Run: `pnpm --filter api-server test templates`.

- [ ] **Step 3: Implement.** Add `export const OUTPUT_TEMPLATE_VERSION = 2;`. Update the three row
  builders + CSV serializers to the D24/D25 shapes (pass `distanceUnit` from the model manifest into
  the builders; `buildAssignmentRows(result, distanceUnit)` etc.). In `scenarios.ts`, select the
  wrapper `templateVersion` per entity: `OUTPUT_TEMPLATE_VERSION` for
  assignments/costSummary/serviceStats, else `TEMPLATE_VERSION`. Nullability: `objectiveMode: string|null`,
  unavailable numerics `number|null`, serialize explicit `null`. Do NOT touch the importable
  `distances` export (stays v1 4-column, D29) or `flows`/`legDistances`.

- [ ] **Step 4: Run api-server suite — expect PASS** (existing mile-model export tests updated to the
  new `distance`/`distance_unit` columns; that churn is expected and in-scope per D24).

Run: `pnpm --filter api-server test`
Expected: green (all 5 existing models now emit `distanceUnit`).

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/services/templates.ts artifacts/api-server/src/routes/scenarios.ts artifacts/api-server/src/__tests__/templates.test.ts
git commit -m "[C4.7] unit-aware output exports (assignment distance rename, CostSummary/ServiceStats OUTPUT_TEMPLATE_VERSION=2, self-describing units)"
```

---

## Task C4.8: Solve-history unit-carrying shape

**Files:**
- Modify: `artifacts/api-server/src/solver/jobRunner.ts` (`resultSummary` write shape)
- Modify: `artifacts/api-server/src/routes/solveHistory.ts` (read + legacy fallback)
- Test: `artifacts/api-server/src/__tests__/solveHistory.test.ts`, `jobRunner.test.ts`

**Interfaces:**
- Produces (D21): `resultSummary = {status, objective, objectiveMode, weightedAvgDistance, distanceUnit,
  runTimeSec}`; `weightedAvgDistanceMi` removed. Reader falls back for legacy rows.

- [ ] **Step 1: Write failing tests** — a new solve writes `resultSummary` with `objectiveMode`
  (from `details.objective`) + `distanceUnit` (from manifest); the history reader on a **legacy** row
  (only `weightedAvgDistanceMi`) returns `weightedAvgDistance = <that value>` + `distanceUnit = "mi"`
  + `objectiveMode = null`; a failed job returns nulls, not a throw.

- [ ] **Step 2: Run — expect fail.** Run: `pnpm --filter api-server test solveHistory jobRunner`.

- [ ] **Step 3: Implement.** `jobRunner` writes the new `resultSummary` (derive `objectiveMode` from
  `envelope.details.objective` when present, else `null`; `distanceUnit` from the model manifest).
  `solveHistory.ts` reads `summary.weightedAvgDistance ?? summary.weightedAvgDistanceMi ?? null` and
  `summary.distanceUnit ?? "mi"`, `objectiveMode ?? null`.

- [ ] **Step 4: Run — expect PASS. Commit.**

```bash
git add artifacts/api-server/src/solver/jobRunner.ts artifacts/api-server/src/routes/solveHistory.ts artifacts/api-server/src/__tests__/solveHistory.test.ts artifacts/api-server/src/__tests__/jobRunner.test.ts
git commit -m "[C4.8] solve-history unit-carrying resultSummary + legacy-row fallback"
```

---

## Task C4.9: Frontend — chapter registration + km-label de-hardcoding

**Files:**
- Modify: `artifacts/studio/src/lib/chapters.ts`, `App.tsx`
- Modify: `AssignmentsTab.tsx`, `ObjectiveBar.tsx`, `NetworkMap.tsx` (popup), `OptimizationParametersTab.tsx`,
  Landing recent-solves — replace hardcoded `mi` with the model's `distanceUnit`
- Test: relevant RTL specs

**Interfaces:**
- Consumes: manifest `distanceUnit` via `useListModels()`; solve-history `distanceUnit` (C4.8).
- Produces: `/chapter-4` route + Landing card; all distance labels read the active model's unit.

- [ ] **Step 1: Add the `chapters.ts` entry** `{ chapter:4, path:"/chapter-4",
  modelId:"chens-cosmetics-cn", name:"Chen's Cosmetics", summary:"…", description:"…", workspace:true,
  hiddenFromLanding:false }`; add the `App.tsx` route.

- [ ] **Step 2: De-hardcode `mi`** in the 5 named surfaces — thread `distanceUnit` (from the active
  model / solve-history row). Write an RTL test asserting a Chen scenario renders `km` and no `mi` in
  each.

- [ ] **Step 3: Run studio tests — expect PASS. Commit.**

Run: `pnpm --filter studio test`
```bash
git add artifacts/studio/src/lib/chapters.ts artifacts/studio/src/App.tsx artifacts/studio/src/components/**/AssignmentsTab.tsx artifacts/studio/src/components/**/ObjectiveBar.tsx artifacts/studio/src/components/**/NetworkMap.tsx artifacts/studio/src/components/**/OptimizationParametersTab.tsx artifacts/studio/src/pages/Landing.tsx
git commit -m "[C4.9] register Chapter 4 route/card + de-hardcode mi labels to model distanceUnit"
```

---

## Task C4.10: Frontend — inputs (mode toggle, params, tables, derived bands, pMax)

**Files:**
- Modify: Workspace input tabs (`OptimizationParametersTab.tsx`, `WarehouseTable`/`CustomerTable`,
  `SolveDialog.tsx`), `Workspace.tsx` (mode toggle wiring)
- Test: RTL specs per component

**Interfaces:**
- Consumes: `ChensInputs` shape (C4.5); manifest capabilities.
- Produces: mode toggle switching visible params; no capacity column; no band editor; `pMax=25` on
  both `OptimizationParametersTab` and `SolveDialog`.

- [ ] **Step 1: Mode toggle** — segmented Coverage⇄Min-distance bound to `inputs.objective`; coverage
  shows `avgServiceDistCapKm`, min-distance shows `coverageFloorDemand` (default 131645389 + inline
  "> total demand 199M = infeasible" hint). RTL: toggling swaps the field.
- [ ] **Step 2: pMax both controls (D27)** — add a `pMax` prop to `SolveDialog` (currently hardcodes
  `max={50}`); Chen passes `pMax=25` to it AND `OptimizationParametersTab`. RTL: 26 rejected in both.
- [ ] **Step 3: Hide band editor (D19)** in both `OptimizationParametersTab` and `SolveDialog` for Chen;
  warehouse table status-only (no capacity col, `capacityMode:"none"`). RTL asserts absence.
- [ ] **Step 4: Run — PASS. Commit** `[C4.10] Chen inputs: mode toggle, pMax=25 both controls, no capacity/band editor`.

---

## Task C4.11: Frontend — map (China bounds, coverage lens) + Gate-1 registration sweep

**Files:**
- Modify: `NetworkMap.tsx` (countryBounds from manifest — already model-driven), `mapBounds.ts`,
  the two-class coverage band lens (`lib/bands.ts` consumer / `bandPalette`), `MapLegend`
- Modify: every `modelId===` allowlist per `model-integration-precheck.md` Gate-1 (10 points)
- Test: RTL + the Gate-1 sweep

- [ ] **Step 1: Gate-1 sweep** — run the 10-point checklist; add `chens-cosmetics-cn` to each shared
  allowlist (header title, CONSTRAINTS, ObjectiveBar, map multi-select, import/export entity,
  override-section gate, `WarehouseCandidate.kind`, sidebar output entries, reference-distances gate).
- [ ] **Step 2: Two-class coverage lens** — routes colored `≤high` (covered) / `high<d≤max`
  (uncovered) client-side; China bounds contain all points (RTL bounds test).
- [ ] **Step 3: Run — PASS. Commit** `[C4.11] Chen map (China bounds, two-class coverage lens) + Gate-1 sweep`.

---

## Task C4.12: Frontend — output tabs (KPI rows, mode-aware objective, compare)

**Files:**
- Modify: `ServiceStatsTab.tsx`, `CostSummaryTab.tsx`, `ObjectiveBar.tsx`, compare gating
- Test: RTL specs

**Interfaces:**
- Consumes: envelope `details.{coveragePct,coveredDemand,uncoveredPct}` + `metrics.weightedAvgDistance`.

- [ ] **Step 1: Tab KPI rows (D14)** — ServiceStatsTab: Coverage%/Covered demand/Uncovered% (from
  `details`) + Avg service distance (km, from `metrics.weightedAvgDistance`) + existing band rows.
  CostSummaryTab: mode-aware Objective + avg + band rollup.
- [ ] **Step 2: Mode-aware objective + compare** — ObjectiveBar/compare read `details.objective`;
  compare restricted to scenarios sharing `details.objective` (never `%` beside `demand-km`). RTL.
- [ ] **Step 3: Run — PASS. Commit** `[C4.12] Chen output tabs (details-sourced KPI rows, mode-aware objective/compare)`.

---

## Task C4.13: Full gate + e2e_accuracy

- [ ] **Step 1: Run the whole gate.**

Run: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`
Expected: all green.

- [ ] **Step 2: Run e2e_accuracy (sacred).**

Run: `python3 artifacts/api-server/src/solver/tests/e2e_accuracy.py` — passes unmodified.

- [ ] **Step 3: If green, no commit (verification only). If red, fix in the owning task's file and
  re-commit under that task id.**

---

## Task C4.14 (QA): Real-browser Playwright

**Files:**
- Create: `artifacts/studio/e2e/chens-cosmetics.spec.ts`

- [ ] **Step 1: Write the spec** (dev-proxy setup per the repo's e2e gotcha — `API_PROXY_TARGET`):
  register → create Chen scenario → coverage solve → assert coverage ≈66% / 3 cities (Guangzhou/Jinan/
  Nanjing) → switch to min_distance → solve → edit a demand → re-solve delta → distance override →
  assignment changes → Input-Map add → save → precheck surfaces → assert `km` present / `mi` absent →
  export CSV round-trip.
- [ ] **Step 2: Run against local dev servers.**

Run: start api-server (`DATABASE_URL=… PORT=3001 pnpm --filter api-server run dev`) + studio
(`BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 pnpm --filter studio run dev`), then
`E2E_BASE_URL=http://localhost:<port> npx playwright test chens-cosmetics.spec.ts`.
Expected: green.
- [ ] **Step 3: Commit** `[C4.14] e2e chens-cosmetics real-browser coverage+min-distance+overrides`.

---

## Self-review (done by plan author)

**Spec coverage:** D1 (T5 toggle) · D2 (T2/T9) · D3+D22 (T3 goldens) · D4 (T6) · D5 (T9) · D6 (T3/T5/T10) ·
D7 (T3) · D8 (T1/T3) · D9+D26 (T1) · D10 (T3) · D11 (T5/T10) · D12 (T2/T12) · D13+D19 (T5/T10) ·
D14 (T12) · D15 (T3/T6) · D16+D23 (T3/T5) · D17 (T3) · D18 (T6) · D20+D24+D28+D29 (T7) · D21 (T8) ·
D25 (T7) · D27 (T10) — all mapped.

**Deferred/known:** `e2e_journey.py` stays non-runnable (legacy auth) — out of scope. Deploy deferred.

**Type consistency:** `build_merged_chens_dataset` signature identical in T3 def + T5/T6 references;
`OUTPUT_TEMPLATE_VERSION` defined T7, referenced only T7; `resultSummary` shape defined T8 matches D21.
