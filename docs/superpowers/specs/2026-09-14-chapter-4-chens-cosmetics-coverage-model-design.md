# Chapter 4 — Chen's Cosmetics Coverage / Service-Level Model (`chens-cosmetics-cn`)

**Design spec.** Adds a 5th solver model to Network Optimization Studio: a China warehouse-siting
service-level model from the Chen's Cosmetics notebooks (Watson, Ch. 4). Single-echelon
(warehouse → customer). Two coupled objectives exposed as one mode toggle:

- **Coverage** — maximize % of demand served within a "high service distance", subject to an
  average-service-distance cap.
- **Min-distance** — minimize total demand-distance, subject to a coverage-demand floor.

Source: `ChensCosmeticsV1.ipynb`, `…Step 2.ipynb`, `…Step 3.ipynb`. All three share byte-identical
data and Model-2 code, and their Model-1 formulations are mathematically equivalent — but they do NOT
differ *only* by parameters/metric-vars: Steps 2/3 **comment out the Model-2 invocation** in the
driver, the original invokes both, and Step 3 enables `writeLP`. **Step 3 = the final pedagogical
coverage refactor** (not a canonical both-modes executable). The floor default also conflicts across
files (original `131645389`, Steps 2/3 `500100100`) — see D4. Verified by diffing all code cells.

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

- **Coverage mode:** status Optimal, coverage **66.0638669 %** (covered demand `131645389`), opens
  **Guangzhou (wh-40), Jinan (wh-69), Nanjing (wh-102)**, ~1.6 s. **Average distance is NOT frozen** —
  the coverage objective has assignment-level ties (the notebooks themselves saved 658.5 vs 632.0 km,
  my reruns 656.6/658.5, all at the same 66.0639 %). Per D3/Blocker-6 resolution A: assert
  coverage % + the unique warehouse set + full feasibility + `avgServiceDistKm ≤ cap`, never an exact
  avg.
- **Min-distance mode**, floor = `131645389`: Optimal, objective (total demand-distance)
  **123834216789.27**, avg **621.44 km**, same 3 warehouses open, ~0.7 s. Objective + avg ARE
  deterministic here (unique minimum) → freezable.
- **Min-distance mode**, floor = `500100100`: **Infeasible** — floor exceeds total demand
  (199,269,881). The floor default differs across the source files (original `131645389`, Steps 2/3
  `500100100`); the app default is the feasible `131645389` (D4), with a precheck warning when
  floor > total demand.

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
- `quality` (required `z.string()`) — e.g. "optimal" / gap statement
- `edges[]` = assignments: `{fromId: whId, toId: csId, distance: dist_adj, flow: assignedDemand}` —
  **`leg` OMITTED** (the schema's `leg` enum accepts only the two-echelon values; single-echelon
  edges leave it absent, never `null`). `flow` is **required** = the served customer's effective
  demand.
- `metrics` — **reuse the generic keys** (`weightedAvgDistance` reported in km via
  `distanceUnit:"km"`, `bandCoverage`). Any Chen KPI not already in `MetricsSchema`
  (`coveragePct`, `coveredDemand`, `uncoveredPct`, `openCount`) goes in `details` (open `z.record`),
  NOT in `metrics` (closed object — silently strips unknown keys). If any Chen metric must reach the
  public contract, add it as optional to **both** `resultEnvelope.ts` `MetricsSchema` and OpenAPI
  `SolveMetrics`, with a parse-retention test per field.
- `details` (open record) = `{objective (mode), p, highServiceDistKm, maxDistKm,
  avgServiceDistCapKm?, coverageFloorDemand?, openWarehouseIds, coveragePct, coveredDemand,
  uncoveredPct}` — **`openWarehouseIds` is required** here: `NetworkMap` reads it to paint opened
  facilities and drive hide-closed.
- `infeasibilityReason` when applicable

## Dataset (`solvers/chens-cosmetics-cn/`)

Extracted by a one-off script that imports Step-3 `get_data()` (no hand-retyping), mapping numeric
city ids to slug ids consistently across all files (numeric warehouse ids are a subset of customer
ids — a PK collision, same as Chapter 10; slugging avoids it).

- `dataset/warehouses.json` — 25 rows: `{id: "wh-15", city, state: "", lat, lng, zip}`. **No
  `country`, no `kind`** — `WarehouseEntry` has neither field, so validated loading would strip them;
  every Chen warehouse is an overridable facility (omit `kind` per the existing convention). No fixed
  mine.
- `dataset/customers.json` — 197 rows (ids 81, 120, 135 absent — NOT a dense 1..200 range):
  `{id: "cs-1", city, state: "", lat, lng, demand, zip}`. No `country` (not in `CustomerEntry`).
- `dataset/distances.json` — 4925 pairs, **raw km** (pre-circuity), index-keyed `[whOrdinal,
  csOrdinal]` like existing models.
- `dataset/version.json` — sha256 + version.
- `manifest.json` — `countryBounds` computed from **all** warehouse + customer coordinates with
  deliberate padding (real span: Kashi `75.97°E` → Jixi `130.97°E`, `20.05°–47.4°N` — an earlier
  `87.5°E` guess would clip Kashi under the map's strict `maxBounds`). Extraction asserts every
  source point falls inside the computed bounds. `distanceUnit: "km"` set explicitly (a top-level
  manifest field, NOT a capability; omission defaults to `"mi"`). Capabilities per §Manifest below.

Zip codes: **already an optional contract field** (`zip` exists in `WarehouseEntry`/`CustomerEntry`
and OpenAPI `WarehouseCandidate`/`Customer` + generated clients — do NOT re-add it). Scope = the
one-off geocode (Nominatim, 1 req/sec, retry/backoff; **define an explicit coverage threshold and the
policy for ambiguous/missing postal codes** — leave blank, don't guess), integrity checks, loader
field-list preservation, and the Workspace `WarehousesTab`/`CustomersTab` columns. Zip is
display-only and MUST NOT affect golden results.

## Contract & registration

**OpenAPI (`lib/api-spec/openapi.yaml`) + Orval regen (spec + generated output one commit):**
- `modelId` enum += `chens-cosmetics-cn`
- `zip` — **already present** on `WarehouseCandidate`/`Customer`; no change.
- `distances` — **already present** in the `exportScenario`/import `entity` enums; no enum change.
  The real work is the **model→entity pairing** in export/import/apply/reset + the dataset-aware
  template/stub functions + the reference-distance/data-route branches: today's p-median template
  path selects only the US-or-Brazil base dataset, so merely allowlisting Chen would export the WRONG
  base rows. **Generalize template/reference selection to pick the dataset by `modelId`**, and add
  negative sibling-model route tests (a Chen id must never resolve p-median rows).
- `SolveMetrics` — add a Chen metric to the public contract **only if surfaced**; if added, add to
  both `resultEnvelope.ts` `MetricsSchema` and OpenAPI with a parse-retention test (see envelope
  §). Prefer reusing `weightedAvgDistance` (km) + `details` for coverage KPIs.
- `Edge` reused unchanged; single-echelon edges **omit** `leg`.

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

**Verification gate:** typecheck + api-server + studio + solver pytest all green; **`e2e_accuracy.py`
passes unmodified** — assert by re-running the command, not a fixed count (dataset added → re-run to
confirm no cross-model regression). Its pass count is not a stable contract.

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

## Review findings — 2026-09-14

**Disposition: revise before implementation planning.** The core mathematical model matches the
attached notebooks, but the result/input contracts, kilometre handling, golden-test strategy, and
full-parity integration details below are not yet compatible with the repository's current
architecture.

### Blockers

1. **Result envelope is incomplete and currently invalid.** `ResultEnvelopeSchema` requires
   `quality`; every `Edge` requires `flow`; and a single-echelon edge must omit `leg` rather than
   emit `leg: null` (the schema only accepts the two non-null two-echelon values). For Chen,
   `flow` should be the assigned customer's effective demand. `details` must also retain
   `openWarehouseIds`, because `NetworkMap` uses that field to paint opened facilities and implement
   hide-closed behavior. Without it, the output map does not know which warehouses opened.

2. **Every proposed metric must be admitted at both result boundaries.** The current internal
   `MetricsSchema` silently strips unknown keys. Adding only `coveragePct` and
   `avgServiceDistKm` to OpenAPI is insufficient for the proposed `coveredDemand`,
   `uncoveredPct`, `openCount`, and `demandByWarehouse` fields. Either add every retained field as
   optional to both `artifacts/api-server/src/solver/resultEnvelope.ts` and OpenAPI, or reuse the
   existing generic metrics where possible (`weightedAvgDistance` in the manifest's distance unit,
   `bandCoverage`, edges, and `details.openWarehouseIds`) and remove redundant Chen-only fields.
   Add a parse-retention test for every new field.

3. **The input schema omits runner/UI-required fields.** `timeLimitSec` must be required: the job
   runner computes `inputs.timeLimitSec * 1000 + 15000`, so an absent value produces an invalid
   timeout. Include `gap` as the standard CBC control. Define `distanceBands` (or an explicit
   replacement contract) because the Workspace optimization form, output map, Cost Summary, and
   Service Stats consume it. D11 also says `capacityMode` is always `"none"`, but the Zod field list
   omits it; leaving it absent makes the reused Open Warehouses tab show a meaningless Utilization
   column. Either persist `capacityMode: "none"` or explicitly adapt that component.

4. **Input Map v2 fields and normalization are missing.** Full-parity added entities require
   optional `displayCode` on `addedWarehouses`/`addedCustomers` and optional `estimated` on
   `distanceOverrides`; otherwise Zod strips values minted by the full editor on save. Add a Chen
   branch to `normalizeAddedEntityDistances` and a Chen-specific estimator. Because persisted base
   distances and overrides are raw kilometres and the solver applies circuity, the estimator must
   produce raw haversine **kilometres** (no ×1.17); reusing `fillEstimatedDistances` as written would
   produce miles. Cover create, move, delete, save reconciliation, completeness, and idempotence.

5. **Kilometre registration and display are incomplete.** The manifest must explicitly set
   `distanceUnit: "km"`; it is not a capability and omission defaults to `"mi"`. The implementation
   scope must also remove or parameterize live hard-coded mile labels in `AssignmentsTab`,
   `ObjectiveBar`, `NetworkMap`'s customer popup, `OptimizationParametersTab`, and Landing recent
   solves. Solve history currently stores/returns `weightedAvgDistanceMi`; generalize that contract
   (or carry a unit) before making this kilometre model visible on Landing. Tests must assert `km`
   and the absence of `mi` on Chen surfaces.

6. **Coverage-mode average distance is not a stable golden value.** The coverage objective has
   assignment-level ties. The supplied notebook outputs already demonstrate this: the original
   notebook saved approximately `658.5 km`, while Step 3 saved `632.01454 km`, both at
   `66.063867%` coverage. A local rerun of the literal Step-3 percentage-variable formulation also
   produced a third average (`656.64 km`), while the direct covered-demand formulation produced
   `658.4619 km`. Do not freeze `658.46` as an equality assertion unless the model adds a
   deterministic secondary objective. Preferred choices:

   - preserve the notebook's single objective and assert coverage, the unique warehouse set,
     assignment feasibility, and `avgServiceDistKm <= 1000`; or
   - explicitly define a lexicographic solve: maximize covered demand, fix it at the optimum, then
     minimize total demand-distance. This changes the selected assignment policy and must be called
     out as an intentional refinement.

7. **The mode toggle breaks same-model comparison semantics.** Cost Summary currently compares any
   scenarios sharing `modelId`. It would therefore place a coverage objective such as `66.06%`
   beside a min-distance objective such as `123,834,216,789 demand-km` under one generic
   "Objective" label. Make objective labels/formatting mode-aware and either restrict comparison to
   scenarios with the same `details.objective` mode or render the two measures as separate rows.
   Apply the same treatment to ObjectiveBar, exports, and solve history.

### Important corrections

- **Fix the map bounds.** The customer data extend from Kashi at `75.97°E` to Jixi at
  `130.97°E`, with latitude `20.05°N` to `47.4°N`. The stated `87.5°–130.5°E` range
  excludes source points and, with the map's strict `maxBounds`, can clip them. Compute bounds from
  all warehouse and customer coordinates and add deliberate padding; assert every source point is
  inside the result.

- **Reconcile the dataset row shape with the actual schemas.** `WarehouseEntry`/`CustomerEntry`
  currently have no `country` field, and `WarehouseEntry` has no `kind`; validated package loading
  will strip them. Since every Chen warehouse is an overridable facility, omit `kind` as the
  existing convention recommends. Either omit `country` too or intentionally add it through the
  dataset schema, API types, loaders, and UI. Do not leave fields in JSON that disappear during
  validation.

- **Zip is not a new contract field.** Optional `zip` already exists in `WarehouseEntry`,
  `CustomerEntry`, OpenAPI `WarehouseCandidate`/`Customer`, and the generated clients. Scope the
  work to extraction/geocoding, integrity checks, loader preservation, and the Workspace
  `WarehousesTab`/`CustomersTab` columns. Define the Nominatim coverage threshold and the policy for
  ambiguous/missing postal codes; zip remains display-only and must not affect golden results.

- **`distances` is already present in OpenAPI's entity enums.** The actual Chen work is the
  model-to-entity pairing in export/import/apply/reset, the dataset-aware template functions and
  stub generator, and the reference-distance/data-route branches. The existing p-median template
  path selects only the US or Brazil base dataset; merely adding Chen to an allowlist would export
  the wrong base rows. Generalize it to select the dataset by model id and add negative sibling-model
  route tests.

- **Define the coverage-band representation.** A single band `[highServiceDistKm]` cannot produce
  distinct covered/uncovered route colors with the current `assignBand` overflow behavior: values
  above the only boundary are assigned to that same last band. Specify a two-class lens (for
  example the service threshold plus an explicit overflow class), while keeping the solver's
  `coveragePct` cumulative at `highServiceDistKm`. Do not conflate that service KPI with the shared
  exclusive post-solve reporting bands.

- **Define zero-demand behavior.** Full network editing allows all customers to be excluded or all
  effective demands to become zero. Guard every coverage/average ratio and decide whether precheck
  blocks this state or the solver returns a defined zero-demand result. Add a regression test; the
  "never throws" requirement must cover this reachable case.

- **Use the existing semantic precheck, not only the two new warnings.** In addition to the
  floor/cap warnings, Chen needs dataset-scoped checks for duplicate/colliding IDs, unresolved
  overrides, missing added-entity distances, forced-open count greater than `p`, `p` greater than
  active candidates, and customers with no route inside `maxDistKm`. The solve path must still
  return a valid infeasible envelope if a mathematically infeasible case reaches it.

- **Parameterize the P control.** The current shared Workspace P slider is hard-coded to a maximum
  of 50. To deliver the promised `1–25` control, give the component a model-derived/configurable
  maximum and test that 26 cannot be authored through either the tab or Solve dialog.

### Source-description corrections

- The three notebooks share byte-identical data and Model 2 code, and their Model 1 formulations are
  mathematically equivalent, but they do not differ *only* by parameters and metric variables.
  Steps 2/3 comment out the Model 2 invocation; the original invokes both, and Step 3 enables
  `writeLP`. Describe Step 3 as the final pedagogical coverage refactor, not as the sole canonical
  executable for both modes.
- The floor defaults conflict across the supplied files: the original notebook uses the feasible
  `131645389`, while Steps 2/3 use `500100100`. State this explicitly rather than calling one value
  "the notebook default." The app's feasible default remains a sound product choice.
- Replace the stale `e2e_accuracy.py 87/87` claim with a command-based gate. The file currently
  collects four pytest cases; assertion counts are not a stable contract.

### Independently verified against the supplied notebooks

- 25 warehouses, 197 customers, and 4,925 warehouse-customer pairs.
- Customer IDs 81, 120, and 135 are absent; total demand is `199269881`.
- Circuity is applied as `raw distance × 1.17` before both threshold indicators and both
  objectives.
- Coverage optimum is `66.0638669222671%` / `131645389` covered demand and selects Guangzhou
  (`40`), Jinan (`69`), and Nanjing (`102`).
- Min-distance with floor `131645389` has objective `123834216789.27011 demand-km`, average
  `621.4397086395114 km`, and the same warehouse set.
- Floor `500100100` is infeasible because it exceeds total demand.
- The notebooks contain one warehouse→customer echelon and no capacity constraint.

## Review resolution — 2026-09-14 (Rev 2, AUTHORITATIVE)

All review findings verified against the repo and **accepted**. Where this section conflicts with the
body above, this section wins. The relevant body sections were also patched inline.

**Blockers (all resolved):**

1. **Envelope.** `quality` (string) required; each `Edge` carries required `flow` = served customer's
   effective demand; single-echelon edges **omit** `leg` (never `null`); `details.openWarehouseIds`
   required (NetworkMap paints/hides on it). See patched §Result envelope.
2. **Metrics at both boundaries.** `MetricsSchema` is a closed object (strips unknown). Reuse
   `weightedAvgDistance` (km) + `bandCoverage`; put coverage KPIs in `details`. Any metric promoted to
   the public contract is added to **both** `resultEnvelope.ts` and OpenAPI `SolveMetrics` with a
   per-field parse-retention test.
3. **Input schema completeness.** Required: `timeLimitSec` (job runner: `*1000+15000`), `gap` (CBC
   control), `distanceBands` (consumed by the optimization form / output map / CostSummary /
   ServiceStats — define an explicit bands contract, see Band item), and persist
   `capacityMode: "none"` (else the reused Open Warehouses tab renders a meaningless Utilization
   column) — or explicitly adapt that component. All in `validation/inputs/chens.ts`.
4. **Input Map v2 fields + normalization.** Added entities need optional `displayCode`
   (`addedWarehouses`/`addedCustomers`) and `distanceOverrides` need optional `estimated`, or Zod
   strips full-editor-minted values on save. Add a **Chen branch to `normalizeAddedEntityDistances`**
   and a **Chen estimator that produces RAW haversine kilometres (no ×1.17)** — stored base + overrides
   are raw km and the solver applies circuity; reusing `fillEstimatedDistances` as-is emits miles.
   Test create/move/delete/save-reconciliation/completeness/idempotence.
5. **Kilometre registration + display.** `distanceUnit: "km"` in the manifest. Remove/parameterize
   hard-coded mile labels in `AssignmentsTab`, `ObjectiveBar`, `NetworkMap`'s customer popup,
   `OptimizationParametersTab`, and Landing recent-solves. Generalize solve-history's
   `weightedAvgDistanceMi` (carry a unit) before this km model is visible on Landing. Tests assert
   `km` and the **absence of `mi`** on Chen surfaces. (This is real added scope — two-echelon dodged it
   by relabelling; Chen genuinely is km.)
6. **Coverage golden = Option A (faithful).** Assert coverage % + unique warehouse set + feasibility +
   `avgServiceDistKm ≤ cap`; do NOT freeze the coverage-mode average (tie-degenerate). Min-distance
   mode asserts its exact deterministic objective + avg. No lexicographic refinement.
7. **Mode-aware presentation.** The `objective` toggle yields two incommensurable units (coverage % vs
   demand-km) under one `modelId`. CostSummary/ObjectiveBar/exports/solve-history must render
   objective labels/formatting **mode-aware**, and same-model compare must restrict to scenarios
   sharing `details.objective` (or show the two measures as separate rows) — never place `66.06 %`
   beside `1.238e11` under one "Objective" label.

**Important corrections (all accepted):**

- **Map bounds** from all wh+cs coords + padding (Kashi 75.97°E … Jixi 130.97°E, 20.05–47.4°N); assert
  every source point inside. (Patched §Dataset.)
- **Dataset row shape** omits `country` and `kind` (neither in the entry schemas → stripped).
  (Patched §Dataset.)
- **Zip** already a contract field — scope is extraction/geocoding/integrity/loader-preservation/
  columns only, with a defined coverage threshold + ambiguous/missing policy; display-only. (Patched.)
- **`distances` entity** already enumerated — real work is model→dataset selection in
  export/import/apply/reset + template/stub + reference/data-route branches (p-median path hard-selects
  US/Brazil base); generalize by `modelId` + negative sibling-model route tests. (Patched §Contract.)
- **Coverage-band lens** = an explicit **two-class** representation (service threshold + overflow
  class); a single `[highServiceDistKm]` band can't color covered-vs-uncovered because `assignBand`
  overflow folds everything above the sole boundary into that last band. Keep the solver's
  `coveragePct` cumulative at `highServiceDistKm`; do not conflate that KPI with the shared exclusive
  post-solve reporting bands. This defines the `distanceBands` contract referenced in Blocker 3.
- **Zero-demand behavior** — full editing can exclude all customers / zero all demand. Guard every
  coverage/average ratio (division by total demand); decide precheck-blocks vs solver-returns-defined-
  zero; regression test — "never throws" must cover this reachable case.
- **Semantic precheck** (reuse the existing B2.1 precheck, not just the two new warnings): dataset-
  scoped duplicate/colliding IDs, unresolved overrides, missing added-entity distances, forced-open
  count > `p`, `p` > active candidates, customers with no route within `maxDistKm`. Solve path still
  returns a valid infeasible envelope if a truly infeasible case reaches it.
- **Parameterize the P control** — the shared Workspace P slider is hard-capped at 50; give it a
  model-derived/configurable max to deliver `1–25`; test that 26 cannot be authored via the tab or the
  Solve dialog.

**Source-description + gate:** Step 3 = final coverage refactor (not both-modes canonical); floor
default conflicts across files (state both); replace the `87/87` count with a command-based
`e2e_accuracy.py` gate. (All patched inline.)

**Scope note:** Blocker 5 (km display generalization) + Blocker 7 (mode-aware compare) + the semantic
precheck materially enlarge the build beyond a straight model-add. The implementation plan sequences
these as explicit tasks/waves, not afterthoughts.
