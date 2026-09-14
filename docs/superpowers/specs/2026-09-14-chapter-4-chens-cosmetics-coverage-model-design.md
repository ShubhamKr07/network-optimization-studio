# Chapter 4 — Chen's Cosmetics Coverage / Service-Level Model (`chens-cosmetics-cn`)

**Design spec.** Adds a 5th solver model to Network Optimization Studio: a China warehouse-siting
service-level model from the Chen's Cosmetics notebooks (Watson, Ch. 4). Single-echelon
(warehouse → customer). Two coupled objectives exposed as one mode toggle:

- **Coverage** — maximize % of demand served within a "high service distance", subject to an
  average-service-distance cap.
- **Min-distance** — minimize total demand-distance, subject to a coverage-demand floor.

Source: `ChensCosmeticsV1.ipynb`, `…Step 2.ipynb`, `…Step 3.ipynb` (Step 3 = canonical/cleanest;
Steps 1/2 are pedagogical intermediates with identical model logic). The three notebooks differ only
in parameter values and a metric-variable refactor — verified by diffing all code cells.

## Decisions locked (via brainstorming)

| # | Decision | Value |
|---|----------|-------|
| D1 | Objective scope | **A+B** — both modes, one `objective` toggle in inputs |
| D2 | Model id / chapter | `chens-cosmetics-cn`, Chapter 4, route `/chapter-4`, name "Chen's Cosmetics" |
| D3 | Ground truth | Captured by running Step-3 PuLP code locally (below); frozen in `test_chens.py` |
| D4 | Min-distance floor input | **Absolute demand** (`coverageFloorDemand`), default `131645389` (= coverage-mode answer). Precheck warns if `> total demand`. |
| D5 | Frontend scope | **Full stack, visible** on Landing (`hiddenFromLanding: false`) |
| D6 | Scenario-local network edits | **Full parity in v1** (added warehouses/customers, distance overrides, status overrides) |
| D7 | Solver structure | **One `solve_chens()`**, mode = data (branch only on objective sense + the one mode-specific constraint) — honors hard rule 6 |
| D8 | Circuity ×1.17 | **Store RAW distances**, apply ×1.17 in solver. Solved edges show adjusted km; base distances (reference tab / overrides / export) show raw km — both labeled. |
| D9 | Zip codes | **Included** via one-off Nominatim geocode pass (25 WH + 197 customers) |
| D10 | Echelon | **Single-echelon** warehouse→customer (notebooks contain no plant/supply layer — verified by grep across all three) |
| D11 | Capacity | **None** — model has no capacity constraint; `capacityMode` always `"none"`, warehouse overrides = status only |
| D12 | outputGrids | `["openWarehouses", "assignments", "costSummary", "serviceStats"]` (identical to p-median-us/brazil — same single-echelon min-weighted-distance family). **No flows** (single-echelon → `assignments` is the flow view). **costSummary included** — that tab is a distance/objective rollup, not monetary. |

## Golden values (captured locally, PuLP/CBC, Step-3 formulation, defaults P=3 / highServiceDist=600 / avgServiceDistCap=1000 / maxDist=5000)

- **Coverage mode:** status Optimal, coverage **66.0639 %** (covered demand `131645389`), actual avg
  service distance **658.46 km**, opens **Guangzhou (wh-40), Jinan (wh-69), Nanjing (wh-102)**, ~1.6 s.
- **Min-distance mode**, floor = `131645389`: Optimal, objective (total demand-distance)
  **123834216789.27**, avg **621.44 km**, same 3 warehouses open, ~0.7 s.
- **Min-distance mode**, floor = `500100100` (notebook default): **Infeasible** — floor exceeds total
  demand (199,269,881). This is an intentional teaching trap in the notebook; the app default is the
  feasible `131645389`, with a precheck warning when floor > total demand.

Total demand = `199269881`. These become the `test_chens.py` assertions.

## Model formulation (`solve_chens`)

Dispatched on `modelId == "chens-cosmetics-cn"`. Mode read from `payload["objective"] ∈ {coverage,
min_distance}`.

**Precompute:**
- `dist_adj[w,c] = raw[w,c] × 1.17` (circuity)
- `hsp[w,c] = 1 if dist_adj[w,c] ≤ highServiceDistKm else 0` (coverage indicator)
- `mdp[w,c] = 1 if dist_adj[w,c] ≤ maxDistKm else 0` (feasibility cutoff)

**Variables:** `assign[w,c]` binary, `open[w]` binary.

**Shared constraints (both modes):**
- every (non-excluded) customer served exactly once: `Σ_w assign[w,c] == 1`
- exactly P open: `Σ_w open[w] == p`
- route link: `assign[w,c] ≤ open[w]`
- max-distance cutoff: `assign[w,c] ≤ mdp[w,c]`

**Mode-specific (the only branch):**
- `coverage` → `LpMaximize Σ hsp·dem·assign`; **avg-dist cap**
  `Σ dist_adj·dem·assign ≤ avgServiceDistCapKm · Σ dem`
- `min_distance` → `LpMinimize Σ dist_adj·dem·assign`; **coverage floor**
  `Σ hsp·dem·assign ≥ coverageFloorDemand`

**Overrides folded as data** (hard rule 6, no new code paths): forced-open → `open[w]` fixed to 1;
inactive warehouse → dropped from candidate set; excluded customer → dropped from the served set;
added warehouses/customers/distance overrides merged into the dataset dicts before build via the
existing scenario-local merge layer. No capacity handling (model has none).

**Never throws:** tight cap / floor > servable → `{status: "infeasible", infeasibilityReason}`.

## Result envelope (`_envelope`)

- `status`, `runTimeSec`, `solverUsed`
- `objective` = coverage % (coverage mode) OR total demand-distance (min-distance mode)
- `edges[]` = assignments: `{fromId: whId, toId: csId, distance: dist_adj, leg: null}` (single leg)
- `metrics` = `{coveragePct, coveredDemand, uncoveredPct, avgServiceDistKm, openCount,
  demandByWarehouse, weightedAvgDistance, bandCoverage}` (bandCoverage keyed off `highServiceDist`
  for the CostSummary/ServiceStats rollups; recomputed client-side per the E1.1 band-lens rule)
- `details` = `{objective (mode), p, highServiceDistKm, maxDistKm, avgServiceDistCapKm?,
  coverageFloorDemand?}`
- `infeasibilityReason` when applicable

## Dataset (`solvers/chens-cosmetics-cn/`)

Extracted by a one-off script that imports Step-3 `get_data()` (no hand-retyping), mapping numeric
city ids to slug ids consistently across all files (numeric warehouse ids are a subset of customer
ids — a PK collision, same as Chapter 10; slugging avoids it).

- `dataset/warehouses.json` — 25 rows: `{id: "wh-15", city, state: "", country: "China", lat, lng,
  zip, kind: "facility"}`. No fixed mine.
- `dataset/customers.json` — 197 rows (ids 81, 120, 135 absent — NOT a dense 1..200 range):
  `{id: "cs-1", city, state: "", country, lat, lng, demand, zip}`.
- `dataset/distances.json` — 4925 pairs, **raw km** (pre-circuity), index-keyed `[whOrdinal,
  csOrdinal]` like existing models.
- `dataset/version.json` — sha256 + version.
- `manifest.json` — `countryBounds` computed from real China lat/lng (≈ 87.5°–130.5°E, 20°–47°N);
  capabilities per §Manifest below.

Zip codes: source notebooks have none → geocoded once (Nominatim, 1 req/sec, retry/backoff, coverage
floor abort — same pattern as Bundle 3.2 Task 2). Threaded through `lib/dataset-schema` Zod schemas,
the dataset loaders' explicit field lists, OpenAPI `Warehouse`/`Customer`, and the table columns.

## Contract & registration

**OpenAPI (`lib/api-spec/openapi.yaml`) + Orval regen (spec + generated output one commit):**
- `modelId` enum += `chens-cosmetics-cn`
- `Warehouse`/`Customer` += `zip` (optional)
- `exportScenario` `entity` enum includes `distances` for this model
- `SolveMetrics` += `coveragePct`, `avgServiceDistKm` (public contract, separate from the internal
  envelope, or Orval strips them)
- `Edge` reused unchanged (single leg)

**Manifest capabilities:**
```
supportsP: true
capacityModes: ["none"]
demandEditable: true
supportsFacilityStatus: true
supportsAddedCustomerExclusion: true
supportsReferenceDistances: true
outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"]
```
Registered in `lib/dataset-schema` (`PACKAGE_SPECS`, `MODEL_IDS`, `ManifestSchema` if any new key).

**Zod inputs (`artifacts/api-server/src/validation/inputs/chens.ts`, behind
`validateInputsForModel`):**
- `objective: "coverage" | "min_distance"`
- `p: int 1..25`, `highServiceDistKm > 0`, `maxDistKm > 0`
- `avgServiceDistCapKm > 0` (required when coverage), `coverageFloorDemand ≥ 0` (required when
  min_distance)
- `warehouseOverrides[]` (status only — no capacity), `customerOverrides[]` (status + demand),
  `addedWarehouses[]`, `addedCustomers[]`, `distanceOverrides[]`
- precheck (non-blocking warning): `coverageFloorDemand > total servable demand`, or avg-cap
  implausibly tight

**`pmedian.ts` `buildPayload`:** discriminated-union entry for the new modelId — translate validated
inputs + merged scenario-local edits into the solver wire format (objective, params, dataset dicts).

**Job wire:** unchanged async `jobRunner` path — the new model flows through with no worker changes.

## Frontend

`chapters.ts` entry drives Landing card, `App.tsx` route, header title. Gate-1's ten registration
points (`model-integration-precheck.md`) run explicitly — the repo's #1 recurring bug class.

**Inputs (Workspace tabs):**
- Mode toggle (`objective`) — segmented Coverage ⇄ Min-distance; switches which param field shows.
- `p` slider (1–25); `highServiceDistKm`, `maxDistKm` always visible; `avgServiceDistCapKm`
  (coverage only); `coverageFloorDemand` (min-distance only, default `131645389`, inline
  "> total demand 199M = infeasible" hint).
- Warehouse table: status only, **no capacity column**. Customer table: status + demand. Added-entity
  tables, Distances tab (raw-km reference + overrides), Input Map (click-to-place) — full parity.

**Map:** `NetworkMap`, China `countryBounds`, WH triangle / customer circle, warehouse→customer
routes colored by coverage band (`highServiceDist` lens), shared `MapLegend`.

**Output tabs:** OpenWarehouses, Assignments, CostSummary (objective / avg-dist / band rollup),
ServiceStats (coverage % / covered / uncovered / avg-dist). Output Map with metric overlay.

## Tests & QA

- **`test_chens.py` (pytest):** the golden assertions above + override behaviors (forced-open binds,
  inactive WH absent, excluded customer absent, added WH openable, distance override changes an
  assignment) + envelope-validates-against-schema. NOT added to `e2e_accuracy.py` (sacred).
- **API (vitest):** per-mode validation, `buildPayload` translation, reference-distances endpoint,
  export entities, ownership 404, `registration.test.ts` extended to 5 models.
- **Frontend (vitest/RTL):** mode toggle param-switching, coverage-only/mindist-only fields, tables
  (no capacity col), outputGrids gating, envelope→tabs, China map bounds, Gate-1 sweep.
- **QA (`qa-sdet`, real Playwright — standing requirement):** `e2e/chens-cosmetics.spec.ts` against
  local dev servers — create scenario, coverage solve → assert 66 % / 3 cities, switch to
  min_distance → solve, demand edit → re-solve delta, distance override → assignment change,
  import/export round-trip.

**Verification gate:** typecheck + api-server + studio + solver pytest all green; `e2e_accuracy.py`
87/87 unmodified (dataset added → re-run to confirm no cross-model regression).

## Execution & process

- **Agent-team dispatch** (standing preference — not subagent-driven-development), waves by
  file-disjointness, QA a first-class plan task.
- One task = one commit, `[<task-id>] <summary>`. Spec + regenerated codegen in the same commit.
- Merge spec/plan docs to local `main` on creation; re-merge after review.
- **Deploy deferred** — outward-facing; surface + confirm before triggering `nos-api`/`nos-studio`.

## Out of scope (explicit)

- Plant / supply echelon (not in the notebooks; a separate future model if ever needed).
- Capacity constraints (model has none).
- Adding Chen answers to `e2e_accuracy.py`.
- Any change to the existing 4 models beyond the shared registration lists/gates this model touches.
