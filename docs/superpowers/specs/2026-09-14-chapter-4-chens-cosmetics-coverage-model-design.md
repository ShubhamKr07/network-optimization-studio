# Chapter 4 — Chen's Cosmetics Coverage / Service-Level Model (`chens-cosmetics-cn`)

**Design spec (normative, Rev 9).** Adds a new solver model to Network Optimization Studio (the 6th —
p-median-us, p-median-brazil, transport-coal, two-echelon-gold-au, two-echelon-jade-us already exist):
a China warehouse-siting service-level model from the Chen's Cosmetics notebooks (Watson, Ch. 4).
Single-echelon (warehouse → customer). Two coupled objectives exposed as one `objective` mode toggle:

- **Coverage** — maximize % of demand served within a "high service distance", subject to an
  average-service-distance cap.
- **Min-distance** — minimize total demand-distance, subject to a coverage-demand floor.

This body is the single source of truth. The **Review history** appendix is an audit trail only — it
does not specify behavior. Every decision below is one concrete contract; there are no open
alternatives or TODOs.

Source: `ChensCosmeticsV1.ipynb`, `…Step 2.ipynb`, `…Step 3.ipynb`. All three share byte-identical
data and Model-2 code; their Model-1 formulations are mathematically equivalent. They do NOT differ
only by parameters — Steps 2/3 comment out the Model-2 driver invocation, the original invokes both,
Step 3 enables `writeLP`. Step 3 = the final pedagogical coverage refactor, not a both-modes
executable. The floor default conflicts across files (original `131645389`, Steps 2/3 `500100100`).
Verified by diffing all code cells.

## Decisions locked

| # | Decision | Value |
|---|----------|-------|
| D1 | Objective scope | **A+B** — both modes, one `objective` toggle |
| D2 | Model id / chapter | `chens-cosmetics-cn`, Chapter 4, route `/chapter-4`, "Chen's Cosmetics" |
| D3 | Ground truth | **Tie-aware, independently verified** (below). Coverage assignment/avg intentionally NOT frozen; min-distance objective + avg ARE frozen (with tolerance). |
| D4 | Min-distance floor input | Absolute demand `coverageFloorDemand`, default `131645389`. Blocking precheck if `> total potentially coverable demand under adjusted highServiceDistKm` (a necessary upper bound, not joint achievability under `p` — solver authoritative). |
| D5 | Frontend scope | Full stack, visible (`hiddenFromLanding: false`) |
| D6 | Scenario-local network edits | Full parity (added warehouses/customers, distance overrides, status overrides) |
| D7 | Solver structure | One `solve_chens()`, mode = data (branch only on objective sense + the one mode-specific constraint) — hard rule 6 |
| D8 | Circuity ×1.17 | Store RAW km; apply ×1.17 in solver. Solved edges = adjusted km; base tables/reference/overrides = raw km. Unit is **labeled in the UI/reference-manifest** (`distanceUnit`); the bidirectional v1 `distances` CSV carries no unit column (D29) and derives it from the selected model's manifest. |
| D9 | Zip codes | Geocoded once; **acceptance rule locked below**. Display-only, never affects goldens. |
| D10 | Echelon | Single-echelon warehouse→customer (no plant/supply layer — grep-verified across all three notebooks) |
| D11 | Capacity | None. `capacityMode: "none"` **persisted** in inputs; warehouse overrides = status only |
| D12 | outputGrids | `["openWarehouses","assignments","costSummary","serviceStats"]` (= p-median-us/brazil). No `flows` (single-echelon → `assignments` is the flow view). `costSummary` is a distance/objective rollup, not monetary. |
| D13 | Distance bands | **Derived, non-editable** `distanceBands = [highServiceDistKm, maxDistKm]`, resynced whenever either param changes. Two-class coverage lens (§Bands). |
| D14 | Mode-aware presentation | ServiceStatsTab/CostSummaryTab gain model-aware rows: coverage/covered/uncovered from `details`, **average distance from `metrics.weightedAvgDistance`**. ObjectiveBar/exports/solve-history carry mode-aware labels; same-model compare **restricted to scenarios sharing `details.objective`**. |
| D15 | Zero effective demand | Total effective demand `≤ 0` = **blocking precheck error**; solver still returns a complete infeasible envelope if bypassed. |
| D16 | Dispatch key | `solve.py` dispatches on `inp["modelType"]`; Chen emits `modelType: "chens"` from `buildPayload` + a new `SolveInput` union member. |
| D17 | Two failure layers | Model-level (math-infeasible / caught exception) → complete envelope, job succeeds. Process-level (timeout/spawn/exit/stdout/validation) → job `failed`, prior result intact. |
| D18 | Precheck contract | `PrecheckResult {ok, errors}`, blocking-only (no warnings channel). New codes `zero_demand`, `no_feasible_route`, `coverage_floor_infeasible`; reuse `completeness`/`reference_integrity`/`id_collision`/`p_range`. |
| D19 | Band persistence | **Overwrite** `distanceBands := [high, max]` before storage on create/PATCH/import (normalize, do NOT reject a mismatched incoming value); post-normalization invariant assertion; hide editor in `OptimizationParametersTab` AND `SolveDialog`. |
| D20 | Km exports | Pass `distanceUnit` into the assignment export builder; don't emit adjusted km under `distanceMi`/`distance_mi`. `km`/no-`mi` tests cover CSV + JSON exports. |
| D21 | Solve-history shape | `resultSummary` = `{status, objective, objectiveMode, weightedAvgDistance, distanceUnit, runTimeSec}`; `weightedAvgDistanceMi` removed same commit. Legacy rows read `weightedAvgDistance ?? weightedAvgDistanceMi ?? null` + `distanceUnit ?? "mi"`; `objectiveMode`/distance nullable in OpenAPI. |
| D22 | Rounding/tolerance (by field) | **4 dp, both modes:** `details.coveragePct`, `details.uncoveredPct`, coverage `bandCoverage.percent` → tests `abs=1e-3`. **2 dp, both modes:** `metrics.weightedAvgDistance` → `abs=0.05`. **`objective`:** 4 dp coverage mode (= coveragePct, `abs=1e-3`), 2 dp min-distance mode (`abs=0.05`). `coveredDemand` = unrounded integer, equality; warehouse set equality. No `rel=`. |
| D28 | Template versions | `OUTPUT_TEMPLATE_VERSION = 2` for the changed output exports — **assignments, costSummary, AND serviceStats** — at **both** the JSON wrapper (`res.json({templateVersion, entity, rows})`) and each row's `templateVersion`; a contract test asserts wrapper == every row. `openWarehouses`, `flows`, and the importable `distances` template stay **v1**. Input `TEMPLATE_VERSION` stays **1** (bumping the shared constant would reject every existing v1 input CSV — import.ts checks exact equality). |
| D23 | Payload/merge boundary | `buildPayload` emits `modelType` + params + **sparse** overrides/added-entities/distanceOverrides (schema names), NOT a merged dataset. New `build_merged_chens_dataset(inp, WAREHOUSES, CUSTOMERS, DISTANCE)` in `merge_inputs.py` does the per-call merge; `solve_chens` calls it. |
| D24 | Assignment export shape | Rename `distanceMi`→`distance` + add `distanceUnit` on `AssignmentTemplateRow` (all models pass their manifest unit); CSV `template_version,customer_id,warehouse_id,distance,distance_unit,band,flow`; uses `OUTPUT_TEMPLATE_VERSION` (D28). |
| D25 | ServiceStats/CostSummary export (`OUTPUT_TEMPLATE_VERSION`) | **CostSummary** JSON `{templateVersion, objective, objectiveMode, weightedAvgDistance, distanceUnit, runTimeSec, quality, solverUsed}` / CSV `template_version,objective,objective_mode,weighted_avg_distance,distance_unit,run_time_sec,quality,solver_used`. **ServiceStats** JSON `{templateVersion, band, distanceUnit, percent}` / CSV `template_version,band,distance_unit,percent` (band rows + unit metadata). **Nullability (type-correct by field):** `objectiveMode: string \| null`; unavailable numeric fields (`objective`, `weightedAvgDistance`, `runTimeSec`) `number \| null`; other metadata keeps its own required/nullable string type. Any unavailable field serializes as explicit `null` — never `undefined`/omitted. Chen coverage KPIs are a **tab-display** concern, not export rows. |
| D29 | Self-describing distances (Chen's exports only) | The unit-labeling applies to **Chen's own output entities**: assignments (D24) + CostSummary + ServiceStats (D25) carry `distance_unit`, all at `OUTPUT_TEMPLATE_VERSION`. **NOT the importable `distances` export** — it's a bidirectional input template locked to the v1 4-column `template_version,from_id,to_id,distance` (adding a column breaks its own importer); its unit is model-implicit (manifest `distanceUnit`). Other models' `flows`/`legDistances` exports are out of scope. |
| D26 | Geocode match rule | Accept a Nominatim result on **normalized city match alone** (rows store `state:""` → no province to compare). No external province map. |
| D27 | P-max both controls | Add a `pMax` prop to `SolveDialog` (currently hardcodes `max={50}`); Chen passes `pMax=25` to it AND `OptimizationParametersTab`; test both authoring paths reject 26. |
| D30 | Integer demand domain | Demand is integer end-to-end (notebook demands are integers). Chen Zod demand fields — `customerOverrides[].demand`, `addedCustomers[].demand`, and `coverageFloorDemand` — are `z.number().int().nonnegative()`. **Forced by D22** (`coveredDemand` is an unrounded integer): fractional demand would make `coveredDemand` non-integer, contradicting D22. So edge `flow` = integer demand and `coveredDemand` = exact integer sum. Rejecting fractional demand is intentional (consistency-forced, not a free product choice). |

## Ground truth (independently verified; PuLP/CBC; defaults P=3 / highServiceDist=600 / avgServiceDistCap=1000 / maxDist=5000)

Data facts: 25 warehouses, 197 customers (ids 81/120/135 absent — NOT dense 1..200), 4925 pairs, total
demand `199269881`. Circuity `raw × 1.17` applied before both indicators and both objectives.

- **Coverage mode:** Optimal, coverage **66.0638669 %** (covered demand `131645389`), opens
  **Guangzhou (wh-40), Jinan (wh-69), Nanjing (wh-102)**. Average distance is **tie-degenerate** —
  notebooks saved 658.5 vs 632.0 km, reruns 656.6/658.5, all at the same coverage — so it is **not a
  frozen assertion**.
- **Min-distance mode**, floor `131645389`: Optimal, objective (demand-distance) **123834216789.27**,
  avg **621.44 km**, same 3 warehouses. Objective + avg are deterministic (unique minimum) → frozen
  with tolerance.
- **Min-distance mode**, floor `500100100`: Infeasible — floor exceeds total demand.

## Model formulation (`solve_chens`)

**Dispatch + merge boundary (D16, D23).** `solve.py::solve()` dispatches on `inp["modelType"]`
(defaults `p_median`; unknown → error path), NOT on `modelId`. So: add `{modelId:
"chens-cosmetics-cn"; inputs: ChensInputs}` to `pmedian.ts`'s `SolveInput` union; the Chen
`buildPayload` branch emits `modelType: "chens"` + `objective` + all scalar params + the **sparse**
scenario edits by their exact schema names (`warehouseOverrides`, `customerOverrides`,
`addedWarehouses`, `addedCustomers`, `distanceOverrides`) — **not** a pre-merged dataset. `solve()`
dispatches `modelType == "chens"` → `solve_chens()`, which loads the immutable package dataset and
applies the edits via a **new `build_merged_chens_dataset(inp, WAREHOUSES, CUSTOMERS, DISTANCE)` in
`merge_inputs.py`** (mirrors `build_merged_pmedian_dataset`). (Miss the discriminator and it silently
falls through to p-median.) Mode from `payload["objective"] ∈ {coverage, min_distance}`. Requires
`0 < highServiceDistKm < maxDistKm`.

**Precompute:** `dist_adj[w,c] = raw × 1.17`; `hsp[w,c] = 1 if dist_adj ≤ highServiceDistKm else 0`;
`mdp[w,c] = 1 if dist_adj ≤ maxDistKm else 0`.

**Variables:** `assign[w,c]` binary, `open[w]` binary.

**Shared constraints:** each non-excluded customer served exactly once; `Σ open == p`;
`assign ≤ open`; `assign ≤ mdp`.

**Mode-specific (only branch):**
- `coverage` → `LpMaximize Σ hsp·dem·assign`; avg-dist cap `Σ dist_adj·dem·assign ≤ avgServiceDistCapKm·Σdem`.
- `min_distance` → `LpMinimize Σ dist_adj·dem·assign`; coverage floor `Σ hsp·dem·assign ≥ coverageFloorDemand`.

**Overrides as data** (hard rule 6): forced-open → `open[w]` fixed 1; inactive WH → dropped from
candidates; excluded customer → dropped from served set; added warehouses/customers/distance overrides
applied by `build_merged_chens_dataset` **inside solve.py** (D23), not in TS. No capacity.

**Two failure layers (D17) — do not conflate.**
- **Model-level** — *infeasibility*: `solve_chens` returns a complete `infeasible` envelope (using the
  existing `_envelope(..., _EMPTY_METRICS, _EMPTY_DETAILS, ...)` constants). *Unexpected exception*: it
  need NOT self-catch — only solve.py's `if __name__ == "__main__"` boundary wraps `solve()` in
  `try/except` and emits a complete `error` envelope. The solve **job succeeds** and persists that
  envelope either way. **The error-envelope test MUST run the real subprocess/CLI** (`python3 solve.py`
  via stdin, the `resultEnvelope.test.ts` pattern) — a direct in-process `solve(inp)` call does NOT
  catch and is not equivalent.
- **Process/transport-level** (timeout, spawn failure, non-zero exit, unparseable stdout, envelope
  schema-validation failure) → `jobRunner` marks the job **`failed`** with a message and **leaves the
  previous scenario result intact** — it does NOT synthesize a result. This is the existing contract
  (jobRunner "a job status, not a synthesized error-shaped result"); Chen inherits it unchanged.

## Result envelope (`_envelope`)

**Success:**
- `status: "optimal"`, `objective` (coverage % in coverage mode, demand-distance in min-distance),
  `runTimeSec`, `quality` (required string), `solverUsed`, `infeasibilityReason: null`.
- `edges[]` = assignments `{fromId: whId, toId: csId, distance: dist_adj, flow: assignedDemand}` —
  `flow` required (served customer's effective demand); **`leg` omitted** (its enum accepts only the
  two-echelon values; single-echelon leaves it absent, never `null`).
- `metrics` — reuse generic keys only: `weightedAvgDistance` (km, via `distanceUnit:"km"`),
  `bandCoverage` (cumulative: `coveragePct` at `highServiceDistKm`, `100%` at `maxDistKm` for every
  positive-demand feasible solve), and **`openFacilityIds`** (the open warehouse ids). No Chen-only
  keys in `metrics` (closed object strips unknowns). `openFacilityIds` is **required** even though
  `details.openWarehouseIds` carries the same set: `buildOpenWarehouseRows`/`OpenWarehousesTab` build
  the grid from edges + `metrics.openFacilityIds`, so a forced-open warehouse serving zero demand (no
  edge) would vanish from the grid/export without it. `details.openWarehouseIds` stays for
  `NetworkMap`.
- `details` (open record) = `{objective, p, highServiceDistKm, maxDistKm, avgServiceDistCapKm?,
  coverageFloorDemand?, openWarehouseIds, coveragePct, coveredDemand, uncoveredPct}`.
  `openWarehouseIds` **required** — `NetworkMap` reads it to paint/hide facilities.

**Failure envelope (infeasible / error).** Uses the **shared empty shapes** — no Chen-specific failure
detail builder (the `__main__` CLI catch has no parsed inputs to echo, so both paths stay uniform):
`status` (`"infeasible"`|`"error"`), `objective: 0`, `runTimeSec`, `quality` (e.g. "infeasible"),
`edges: []`, `metrics: _EMPTY_METRICS` (`{utilizationByNode:[], bandCoverage:[], weightedAvgDistance:0}`),
`details: _EMPTY_DETAILS` (`{openWarehouseIds:[], assignments:[]}`), `solverUsed`,
`infeasibilityReason` non-null. (Params are not echoed on failure — there are no edges/facilities to
render anyway; matches every existing model's infeasible path.)

## Distance bands (two-class coverage lens) {#bands}

`distanceBands` is a **required input**, but **derived and non-editable** for Chen: always
`[highServiceDistKm, maxDistKm]`, resynced by `buildPayload`/the inputs layer whenever either
parameter changes (no separate band editor tab for this model). Rationale: a single `[high]` band
can't color covered-vs-uncovered because `assignBand` folds everything above the sole boundary into
the last class.

- **Route coloring** uses the two boundaries as **exclusive** classes: `≤ high` (covered),
  `high < d ≤ max` (served-but-uncovered). Client-side per the E1.1 band-lens rule.
- **Server `bandCoverage`** stays **cumulative** (`coveragePct` at `high`, `100%` at `max`) — this is
  the coverage KPI `ServiceStatsTab`/CSV consume; do not conflate it with the exclusive route lens.

**Persistence enforcement (D19).** Re-deriving `distanceBands` in `buildPayload` only fixes the solver
wire — it does NOT repair the saved `scenario.inputs` that maps/exports/later-edits read. **One
observable behavior: overwrite, don't reject.** Validate `highServiceDistKm`/`maxDistKm`, then
**overwrite `distanceBands := [high, max]` before storage on every write path** (create, PATCH,
import/apply) — a stale or hand-authored client sending a third boundary is silently normalized, not
422'd. A post-normalization invariant assertion (not a Zod rejection of the incoming value) guards it.
The band editor is **hidden in both `OptimizationParametersTab` AND `SolveDialog`** (both render it
today). Tests: a direct PATCH/import carrying a third boundary persists as `[high, max]`.

## Dataset (`solvers/chens-cosmetics-cn/`)

One-off extraction script imports Step-3 `get_data()` (no hand-retype), mapping numeric city ids to
slug ids consistently across files (warehouse ids are a subset of customer ids — PK collision, same as
Ch.10; slugging avoids it).

- `warehouses.json` — 25 rows `{id: "wh-15", city, state: "", lat, lng, zip}`. **No `country`, no
  `kind`** (neither in `WarehouseEntry` → stripped; every Chen WH is an overridable facility, omit
  `kind` per convention).
- `customers.json` — 197 rows `{id: "cs-1", city, state: "", lat, lng, demand, zip}`. No `country`.
- `distances.json` — 4925 pairs, **raw km**, a flat `DistanceMap` keyed by **direct entity ids**
  `"<whId>,<csId>"` (e.g. `"wh-15,cs-1"`) — the same direct-id convention as `two-echelon-gold-au`, NOT
  array ordinals.
- `version.json` — sha256 + version.
- `manifest.json` — `countryBounds` computed from **all** warehouse+customer coords + padding (real
  span Kashi `75.97°E` … Jixi `130.97°E`, `20.05–47.4°N`); extraction asserts every source point is
  inside. `distanceUnit: "km"` (top-level manifest field; omission defaults `"mi"`).

**Zip acceptance rule (D9):** Nominatim, 1 req/sec, retry/backoff. Normalize to a trimmed string.
**Source (D9/D26 — REVISED in execution, user-directed):** Nominatim was tried first and REJECTED —
OSM has no city-level postcodes for mainland China (22.5 % coverage). The shipped approach:
1. **GeoNames CN postal export** (CC-BY 4.0) — city/prefecture-level `NNNN00` codes matched by **nearest
   lat/lng within 25 km**, most-trailing-zeros tie-break (so metros resolve to the city code, e.g.
   Shanghai `200000`). Attribution recorded in `dataset/README.md` + the provenance header. Gave 195/222.
2. **Cited reference overrides** for the 27 GeoNames couldn't place: HK districts → China Post SAR code
   `999077`, Macau (Aomen) → `999078`; 16 mainland cities → their documented city postal codes (each
   verified against Wikipedia/China Post and cited per-row in provenance). → **222/222 (100 %)**.
Zip is **display-only**; the integrity check asserts it is never read by the solver or any golden. A
per-row **provenance report** (`docs/dataset-audit/chens-geocode-provenance.json`: source, license,
status hit/hardcoded_reference, assignedZip, matchDistance/referenceSource) is committed. The original
Nominatim-city-match rule (below) is superseded; kept for history.
- *(superseded)* ≥85 % floor or abort; Nominatim normalized-city-match; ambiguous→blank.

## Contract & registration

**OpenAPI (`openapi.yaml`) + Orval regen (one commit):**
- `modelId` enum += `chens-cosmetics-cn`.
- `zip` — already present on `WarehouseCandidate`/`Customer`; no change.
- `distances` entity — already enumerated; no enum change. Real work: **model→dataset selection** in
  export/import/apply + template/stub functions + reference/data-route branches (NOTE:
  `reset-to-baseline` was removed repo-wide in SCN v0.3 Phase 3.2 — do NOT reintroduce it). Today's
  p-median template path hard-selects the US-or-Brazil base, so allowlisting Chen would export the
  WRONG rows. Generalize selection by `modelId`; add negative sibling-model route tests (a Chen id
  must never resolve p-median rows).
- `Edge` reused; single-echelon edges omit `leg`. No new `SolveMetrics` field (coverage KPIs ride
  `details` + reused `weightedAvgDistance`).

**Manifest capabilities:**
```
supportsP: true
capacityModes: ["none"]
demandEditable: true
supportsFacilityStatus: true
supportsAddedCustomerExclusion: true
supportsReferenceDistances: true
outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"]
distanceUnit: "km"          # top-level, not a capability
```
Registered in `lib/dataset-schema` (`PACKAGE_SPECS`, `MODEL_IDS`, `ManifestSchema`).

**Zod inputs (`validation/inputs/chens.ts`, behind `validateInputsForModel`) — complete field list:**
- `objective: "coverage" | "min_distance"`
- `p: int 1..25`; `highServiceDistKm > 0`; `maxDistKm > 0` with `highServiceDistKm < maxDistKm`
- `avgServiceDistCapKm > 0` (required iff coverage); `coverageFloorDemand` `z.number().int()≥0`
  (required iff min_distance, integer per D30)
- demand fields `customerOverrides[].demand` / `addedCustomers[].demand` are `z.number().int()≥0` (D30)
- `timeLimitSec` (**required** — jobRunner computes `*1000 + 15000`); `gap` (CBC gap control)
- `distanceBands` (derived `[high, max]`, D13); `capacityMode: "none"` (**persisted**, D11)
- `warehouseOverrides[]` (status only); `customerOverrides[]` (status + demand)
- `addedWarehouses[]` / `addedCustomers[]` (each with optional `displayCode`);
  `distanceOverrides[]` (with optional `estimated`) — else the full Input-Map editor's minted values
  are stripped on save.

**Semantic precheck (D18) — matches the real `PrecheckResult` contract.** `PrecheckResult` is
`{ok, errors}` with codes `completeness | id_collision | reference_integrity | p_range | capacity`;
`POST …/solve` returns **422 whenever `ok` is false**. There is **no warnings channel**. Therefore:
- **All Chen precheck findings are blocking `errors`** (there is nowhere to put a non-blocking
  warning): missing added-entity distances → existing `completeness`; unresolved overrides → existing
  `reference_integrity`; duplicate/colliding ids → `id_collision`.
- **Add three new `PrecheckErrorCode` values** (do NOT overload `p_range`/`capacity`): `zero_demand`
  (total effective demand ≤ 0, D15), `no_feasible_route` (an active customer with no route within
  `maxDistKm`), `coverage_floor_infeasible` (`coverageFloorDemand > total potentially coverable demand
  under adjusted highServiceDistKm` — a necessary upper bound, D4/precheck detail below), Reuse `p_range` for `forcedOpenCount > p` / `p > active candidate count`. Each new
  code added to `PrecheckErrorCode`, the OpenAPI error schema, regenerated clients, and Workspace
  rendering.
- **Precheck applies circuity, with two distinct thresholds** (after merging overrides/added-entities/
  distance-overrides and filtering inactive warehouses + excluded customers):
  - `no_feasible_route` — an active customer has NO active warehouse with `rawKm × 1.17 ≤ maxDistKm`.
  - `coverage_floor_infeasible` — its cheap **upper bound** sums demand of customers that have at least
    one active warehouse with `rawKm × 1.17 ≤ highServiceDistKm`; if `coverageFloorDemand` exceeds that
    sum, reject. This is only a *necessary* upper bound (the shared `p` limit may stop all
    individually-coverable customers being covered together) — the solver stays authoritative.
  Comparing raw km directly (either threshold) would approve scenarios the solver then declares
  infeasible.
- The "implausibly tight avg cap" idea is **dropped** — it has no home in a blocking-only contract and
  the solver already returns a valid infeasible envelope for it.
The solve path still returns a valid infeasible envelope (model-level, D17) if a mathematically
infeasible case bypasses precheck.

**`pmedian.ts buildPayload`:** discriminated-union entry — translate validated inputs + **validated
sparse scenario-local edits** into the solver wire (the Python-side `build_merged_chens_dataset` does
the actual merge, D23); derive `distanceBands` from `[high, max]`; add a **Chen branch to
`normalizeAddedEntityDistances`** and a **Chen estimator producing raw haversine kilometres (no ×1.17)**
— stored base + overrides are raw km and the solver applies circuity; the generic
`fillEstimatedDistances` emits miles and must not be reused as-is.

**Job wire:** unchanged async `jobRunner` path.

## Frontend

`chapters.ts` entry drives Landing card, `App.tsx` route, header title. Gate-1's ten registration
points (`model-integration-precheck.md`) run explicitly.

**Kilometre display (real added scope):** `distanceUnit: "km"` in the manifest; remove/parameterize
hard-coded mile labels in `AssignmentsTab`, `ObjectiveBar`, `NetworkMap`'s customer popup,
`OptimizationParametersTab`, and Landing recent-solves. **Exports (D20/D24) — exact shape:**
`AssignmentTemplateRow.distanceMi` is **renamed to `distance`** with an added `distanceUnit` field;
`assignmentRowsToCsv` header becomes `template_version,customer_id,warehouse_id,distance,distance_unit,band,flow`.
**Version (D28):** the changed OUTPUT exports (assignments, CostSummary, **ServiceStats**) use a new
`OUTPUT_TEMPLATE_VERSION = 2` at **both** the JSON wrapper (the route's `res.json({templateVersion,
entity, rows})`, currently hardcoded to `TEMPLATE_VERSION`) and each row's `templateVersion` — a
contract test asserts wrapper == every row; `openWarehouses`/`flows`/`distances` keep the v1 wrapper.
The shared input `TEMPLATE_VERSION` stays **1** (import.ts rejects any
CSV whose `template_version != 1` at 5 sites, so a global bump would break every existing v1 warehouse/
customer/distance/refinery/plant/capability import). **All models** adopt the assignment shape (each
passes its manifest `distanceUnit`; mile models now carry `distanceUnit:"mi"` explicitly) — no external
export consumers, so a clean rename beats a dual-field window. **Self-describing distances (D29) — Chen
OUTPUT exports only:** CostSummary export = `{templateVersion, objective, objectiveMode,
weightedAvgDistance, distanceUnit, runTimeSec, quality, solverUsed}` / CSV
`template_version,objective,objective_mode,weighted_avg_distance,distance_unit,run_time_sec,quality,solver_used`;
ServiceStats export = `{templateVersion, band, distanceUnit, percent}` / CSV
`template_version,band,distance_unit,percent`. **`objectiveMode` and any legacy/failed-unavailable
field is `string | null`, serialized as explicit `null` (never omitted).** The importable **`distances`
export is NOT touched** — it stays the v1 4-column `template_version,from_id,to_id,distance` (a 5th
column breaks its own importer, shared with `legDistances`); its unit is model-implicit. Other models'
`flows`/`legDistances` are out of scope. Tests assert `km`/**absence of `mi`** on Chen CSV + JSON
exports, and that mile models still emit `distanceUnit:"mi"`.

**Inputs (Workspace tabs):**
- Mode toggle (`objective`) segmented Coverage ⇄ Min-distance; switches which param field shows.
- `p` slider **1–25** (D27) — `OptimizationParametersTab` already takes a `pMax` prop (default 50);
  `SolveDialog` hardcodes `max={50}` and needs a `pMax` prop added. Chen passes `pMax=25` to **both**;
  test that 26 cannot be authored via either the tab or the Solve dialog. `highServiceDistKm`, `maxDistKm` always
  visible; `avgServiceDistCapKm` (coverage only); `coverageFloorDemand` (min-distance only, default
  `131645389`, inline "> total demand 199M = infeasible" hint). No band editor (D13, derived).
- Warehouse table: status only, no capacity column (so the reused Open Warehouses tab shows no
  meaningless Utilization column, per persisted `capacityMode:"none"`). Customer table: status +
  demand. Added-entity tables, Distances tab (raw-km reference + overrides), Input Map (click-to-place)
  — full parity.

**Map:** `NetworkMap`, China `countryBounds`, WH triangle / customer circle, warehouse→customer routes
colored by the two-class coverage lens (§Bands), shared `MapLegend`.

**Output tabs + KPIs (D14) — exact field sources.** `ServiceStatsTab` and `CostSummaryTab` gain
model-aware rows (today they render only `metrics.bandCoverage` — real component work). **Source of
each row:** `coveragePct`, `coveredDemand`, `uncoveredPct` from **`details`**; **average distance from
`metrics.weightedAvgDistance`** (km) — the solved average lives only there, NOT in `details`. Locked
**tab** rows (UI only — export serializers are D25, not these):
- *ServiceStatsTab*: `Coverage %`, `Covered demand`, `Uncovered %`, `Avg service distance (km)` + the
  existing cumulative `bandCoverage` `{band, percent}` rows. ServiceStats **export** = band rows +
  `distance_unit` metadata (D25/D29 — `coveragePct` is the cumulative first/high-service band percent;
  KPI rows are tab-only, not exported).
- *CostSummaryTab*: `Objective` (mode-aware, below), `Avg service distance (km)`, band rollup.
  CostSummary **export** adds `objective_mode` + `distance_unit` (D25).

**Mode-aware objective (D14).** `ObjectiveBar`/CostSummary/exports/history format `objective` by mode
(coverage `%` vs `demand-km`) — never one generic "Objective" label. The mode comes from
`details.objective`. **Solve-history (D21) — exact shape:** `resultSummary` becomes
`{status, objective, objectiveMode, weightedAvgDistance, distanceUnit, runTimeSec}`;
`weightedAvgDistanceMi` is **removed in the same OpenAPI/codegen commit**. Legacy stored rows (JSONB)
are read with fallbacks that **preserve the old numeric value**: `weightedAvgDistance ??
weightedAvgDistanceMi ?? null` and `distanceUnit ?? "mi"`; absent `objectiveMode` → legacy
single-objective label (no back-fill migration). `objectiveMode` and the distance value are **nullable**
in OpenAPI (failed jobs + legacy rows). Same-model **compare is restricted to scenarios sharing
`details.objective`**. Output Map with metric overlay.

## Tests & QA

**`test_chens.py` (pytest) — tie-aware assertions:**
- *Coverage:* status optimal; **exact** integer `coveredDemand == 131645389` and **exact** open set
  `{wh-40, wh-69, wh-102}` (equality); `details.coveragePct == pytest.approx(66.0639, abs=1e-3)`;
  exactly-one assignment per active customer; route/open linkage; max-distance feasibility;
  **`metrics.weightedAvgDistance ≤ avgServiceDistCapKm`** (that field IS the solved avg service
  distance in km — there is no separate `avgServiceDistKm` field). **Do NOT** assert runtime, the
  exact average value, specific customer→warehouse assignments, or edge order.
- *Min-distance* (floor `131645389`): additionally `objective == pytest.approx(123834216789.27,
  abs=0.05)` and `metrics.weightedAvgDistance == pytest.approx(621.44, abs=0.05)`; same exact open set.

**Rounding/tolerance policy (D22) — precision by field.** `details.coveragePct`, `details.uncoveredPct`,
and coverage `bandCoverage.percent` emit at **4 decimals in both modes** (so `66.0639` holds; tested
`abs=1e-3`). `metrics.weightedAvgDistance` emits at **2 decimals in both modes** (tested `abs=0.05`).
`objective` follows its mode — 4 dp in coverage mode (it *is* `coveragePct`), 2 dp in min-distance mode.
`coveredDemand` is an unrounded integer (equality), as is the warehouse set. Never `rel=` (at 1e11 it
admits ~1e5 of error).
- *Failure:* floor `500100100` infeasible; zero-demand (all customers excluded, and all effective
  demands zeroed) — both blocked by precheck AND, if bypassed, a schema-valid infeasible envelope;
  unexpected solver error → schema-valid error envelope. Every failure case asserts the envelope
  validates against `ResultEnvelopeSchema`.
- Override behaviors: forced-open binds, inactive WH absent, excluded customer absent, added WH
  openable, distance override changes an assignment.
- Runtime only in a broad timeout/termination check, not per-value.
- NOT added to `e2e_accuracy.py` (sacred).

**API (vitest):** per-mode validation (required params, `highServiceDistKm < maxDistKm`, bad
objective), `buildPayload` translation emitting `modelType:"chens"` + derived bands + km estimator,
precheck findings (each new error code), band persistence normalization on PATCH/import, reference
distances, export/import model→dataset selection + sibling-model negatives + km export field, ownership
404, `registration.test.ts` extended to all models, metric parse-retention if any public field added.

**Frontend (vitest/RTL):** mode toggle param-switching, coverage-only/mindist-only fields, no capacity
column, no band editor, P-max 25 (both controls), outputGrids gating, ServiceStats/CostSummary tab rows (coverage/covered/uncovered from `details`, avg from `metrics.weightedAvgDistance`),
mode-aware ObjectiveBar/compare, `km`/no-`mi` assertions, China map bounds contain all points, Gate-1
sweep.

**QA (`qa-sdet`, real Playwright — standing requirement):** `e2e/chens-cosmetics.spec.ts` on local dev
servers — create scenario, coverage solve → 66 % / 3 cities, switch to min_distance → solve, demand
edit → re-solve delta, distance override → assignment change, Input-Map add → save → precheck, km
labels present / mi absent, import/export round-trip.

**Verification gate:** typecheck + api-server + studio + solver pytest all green; `e2e_accuracy.py`
passes unmodified (re-run the command; its pass count is not a stable contract).

## Execution & process

Agent-team dispatch (standing preference), waves by file-disjointness, QA a first-class plan task. One
task = one commit `[<id>] <summary>`; spec + regenerated codegen same commit. Merge spec/plan docs to
local `main` on creation; re-merge after review. Deploy deferred — surface + confirm before triggering
`nos-api`/`nos-studio`. km-display generalization + mode-aware presentation + semantic precheck are
sequenced as explicit waves, not afterthoughts.

## Out of scope (explicit)

Plant/supply echelon; capacity constraints; adding Chen answers to `e2e_accuracy.py`; other models'
`flows`/`legDistances` exports; the importable `distances` template (stays v1). **Shared-serializer
changes that necessarily touch the 5 existing models:** the assignment-export rename (D24), the
CostSummary + ServiceStats output serializers (D25/D28/D29), and the solve-history contract (D21) — all
generic builders. Everything else leaves existing models untouched beyond the shared registration
lists/gates.

---

## Review history (audit trail — superseded, non-normative)

Rev 1–8 findings were accepted (all verified correct against the repo) and **folded into the body
above** (Rev 4 → D16–D22; Rev 5 → D23–D27; Rev 6 → D28–D29; Rev 7 → D4/D22/D25/D29 revisions +
failure-details + cross-model scope; Rev 8 → D8/D25/D28 revisions + golden field-path + title;
**Rev 9** (surfaced by the *plan* review) → D30 integer-demand domain (forced by D22) + removed the
stale `reset-to-baseline` reference (endpoint deleted in SCN v0.3 Phase 3.2)). This section records
that they happened — it specifies nothing.

- **Rev 1 findings (SUPERSEDED):** envelope completeness (`quality`/`flow`/omit-`leg`/
  `openWarehouseIds`), metrics-strip, required `timeLimitSec`/`gap`/`distanceBands`/`capacityMode`,
  Input-Map v2 fields + km estimator, km-display generalization, coverage-golden tie-degeneracy
  (→ Option A faithful), mode-aware compare, map bounds, drop `country`/`kind`, zip-already-exists,
  distances-already-enumerated, two-class bands, zero-demand guard, full semantic precheck, P-max.
- **Rev 2 (SUPERSEDED):** verified all Rev-1 claims against the repo, accepted all — but recorded them
  as an errata layer rather than editing the body (the Rev-3 defect).
- **Rev 3 (folded here):** required one authoritative normative body (no competing named-file
  sections), a concrete two-class band contract (D13), a locked zero-demand policy (D15), a complete
  failure envelope, KPI-to-component wiring + one compare implementation (D14), a locked zip
  acceptance rule (D9), and explicitly tie-aware golden assertions (D3). All done above.

## Re-review findings — 2026-09-14 (Rev 4, FOLDED → D16–D22)

**All resolved in the normative body:** dispatch-on-`modelType` (D16), two failure layers (D17),
blocking-only precheck + new error codes (D18), band persistence rule (D19), `metrics.openFacilityIds`
(Result envelope), km exports (D20), concrete D14 field sources + solve-history (D21), rounding/
tolerances (D22), `maxManifest`→`maxDistKm` fix, zip ambiguous-match policy (D9). Original text
retained below as the audit trail.

**Disposition (historical): revise before implementation planning.** Rev 3 resolves the prior
mathematical,
dataset, band-semantics, zero-demand-policy, and tie-aware-golden findings. The remaining blockers are
integration-contract mismatches discovered by tracing the rewritten normative body through the
current dispatcher, precheck, async job runner, persistence paths, and output exports.

### Blockers

1. **The Python dispatcher consumes `modelType`, not `modelId`.** The normative Model section says
   dispatch occurs on `modelId == "chens-cosmetics-cn"`, but `buildPayload` is the boundary that
   translates public `modelId` into the internal wire's `modelType`, and `solve.py::solve()` dispatches
   exclusively on `inp["modelType"]`. Lock the actual contract:

   - add `{modelId: "chens-cosmetics-cn"; inputs: ChensInputs}` to the `SolveInput` union;
   - have the Chen `buildPayload` branch emit `modelType: "chens"` plus `objective` and all parameters;
   - dispatch `modelType == "chens"` to the single `solve_chens()` function.

   Without this, a missing/incorrect discriminator can fall through to the existing p-median default
   or the unknown-model error path.

2. **The proposed blocking/warning precheck split does not match the repository contract.**
   `PrecheckResult` currently contains only `{ok, errors}`; `POST .../solve` returns 422 whenever
   `ok` is false. Missing added-entity distances and unresolved references already produce blocking
   `completeness`/`reference_integrity` errors. The spec currently labels both as warnings, which is
   neither representable nor safe. Prefer retaining them as blocking errors. If a non-blocking
   “implausibly tight cap” warning is required, explicitly add a warnings channel through
   `precheck.ts`, OpenAPI, generated clients, and Workspace rendering. Also assign concrete internal
   and OpenAPI error codes for the new zero-demand, no-feasible-route, and coverage-floor conditions;
   do not overload unrelated `capacity`/`p_range` codes.

3. **“Every non-optimal exit returns an envelope” conflicts with async worker failure semantics.**
   `jobRunner` treats timeout, spawn failure, non-zero exit, unparseable stdout, and envelope-validation
   failure as a failed solve job with an error message — it does not synthesize or persist a scenario
   result. Distinguish two layers:

   - mathematical infeasibility and a model-level exception caught inside the Python JSON boundary
     return a complete `ResultEnvelope`; and
   - process/transport failures mark the job `failed` and leave the previous scenario result intact.

   Update the tests accordingly: schema-validate solver-returned infeasible/error envelopes, but test
   worker crashes/timeouts against the solve-job failure contract rather than expecting an envelope.

4. **The derived-band persistence invariant has no authoritative enforcement point.**
   `distanceBands` is simultaneously required/persisted and derived/non-editable. Re-deriving it in
   `buildPayload` protects only the solver wire; it does not repair the saved `scenario.inputs` read
   by maps, exports, and later edits. Define one canonical persistence rule across create, PATCH, and
   import/apply (for example, normalize to `[highServiceDistKm, maxDistKm]` before validation/storage,
   plus a Zod equality refinement as defense). Hide the band editor in **both**
   `OptimizationParametersTab` and `SolveDialog`. Add direct-PATCH/import mismatch tests so a stale or
   hand-authored client cannot persist a third boundary.

### Important corrections

- **Emit the existing `metrics.openFacilityIds` for Chen, or adapt both consumers.**
  `details.openWarehouseIds` drives `NetworkMap`, but `OpenWarehousesTab` and
  `buildOpenWarehouseRows` derive rows from edges and augment them only from
  `metrics.openFacilityIds`. A forced-open warehouse may serve zero demand and have no edge, causing
  a genuinely open facility to disappear from the Open Warehouses grid and export. The generic
  `openFacilityIds` metric already exists at both result boundaries and is the smallest fix; keep
  `details.openWarehouseIds` as well for the map.

- **Kilometre support must include output-export schemas.** The UI list correctly names visible
  hard-coded `mi` labels, but `AssignmentTemplateRow`/`assignmentRowsToCsv` still expose
  `distanceMi`/`distance_mi`. D8 and the “no `mi` on Chen surfaces” tests must cover both CSV and JSON
  assignments exports. Define a backward-compatible unit-aware row/header contract and pass the
  model's `distanceUnit` into the export builder; do not export adjusted kilometres under a miles
  field name.

- **Make D14's output and history shapes executable.** The spec says all Chen KPI rows, including
  average distance, are sourced from `details`, but the Result section stores the solved average only
  in `metrics.weightedAvgDistance`. Specify that coverage/covered/uncovered come from `details` and
  average distance comes from `metrics`, or add an explicit redundant detail. Then lock the exact
  Service Stats and Cost Summary JSON/CSV columns. For solve history, name the replacement for
  `weightedAvgDistanceMi` and the persisted/returned mode field used to format `objective`; “carry
  mode-aware labels” alone is not a data contract.

- **Document output rounding and numeric tolerances.** The Golden section says “with tolerance” but
  supplies neither tolerances nor the envelope's rounding policy. Specify emitted precision and
  explicit `pytest.approx` tolerances for `coveragePct`, the coverage objective, min-distance
  demand-distance, and `weightedAvgDistance`. Exact integer `coveredDemand` and the warehouse set can
  remain equality assertions.

### Minor corrections

- In API tests, replace `highServiceDistKm < maxManifest` with
  `highServiceDistKm < maxDistKm`; `maxManifest` is not a field.
- D9 defines genuine geocode misses but not ambiguous multiple matches. For reproducible extraction,
  define the city/province match used to accept one Nominatim result; otherwise record the row as
  ambiguous and leave `zip` blank. The committed provenance report should include the selected result
  and normalization outcome.

**Approval condition:** resolve the four blockers in the normative body and make the output/history
field shapes and tolerances concrete. No changes to the notebook formulation, source-data facts,
circuity, Option-A coverage golden, min-distance golden, or locked zero-demand policy are requested.

## Re-review findings — 2026-09-14 (Rev 5, FOLDED → D22 revised + D23–D27)

**All verified correct against the repo and resolved in the body:** rounding-vs-tolerance (D22),
assignment-export rename (D24), solve-history exact shape (D21 revised), ServiceStats/CostSummary
export schema (D25), band normalize-not-reject (D19 revised), Python-side merge boundary (D23),
adjusted-distance precheck, D14 table wording, exception boundary, geocode city-only (D26), P-max both
controls (D27), "existing 4 models"→5. Original text retained below as audit trail.

**Disposition (historical): revise before implementation planning.** Rev 4 correctly resolves the
dispatcher,
blocking-only precheck, worker-failure layers, zero-flow open-facility reporting, and kilometre scope
in principle. The following contract and test inconsistencies remain.

### Blockers

1. **The rounding policy makes the coverage golden fail.** D22 says every envelope float, including
   `coveragePct`, is rounded to 2 decimal places, so the verified coverage becomes `66.06`. The test
   requires `pytest.approx(66.0639, abs=1e-3)`; the difference is `0.0039`, outside that tolerance.
   Retain at least 4 decimal places for coverage percentages (recommended) or use an absolute
   tolerance of at least `0.005`. Assert the coverage-mode envelope `objective` under the same policy,
   not only `details.coveragePct`.

   The min-distance objective's `rel=1e-6` tolerance is also too loose: at
   `123834216789.27`, it accepts an error of roughly `123,834`. For a 2-decimal emitted objective, use
   `abs=0.05` (or a comparably strict relative tolerance). Keep exact equality only for integer
   `coveredDemand` and the warehouse set.

2. **D20 still does not define the assignment-export wire shape.** “A backward-compatible unit-aware
   row/header contract” does not say whether Chen JSON emits `distance`, `distanceKm`, or
   `distance + distanceUnit`, nor does it name the CSV header. Lock the exact fields and compatibility
   behavior for existing mile models. One concrete additive choice is:

   - JSON: `{…, distance, distanceUnit, …}` for all models while retaining legacy `distanceMi` only
     during a documented compatibility window; and
   - CSV: `distance` + `distance_unit` columns for all models, with an explicit version bump if the
     current `distance_mi` header is removed.

   A different choice is acceptable, but the spec must choose one before the plan divides API,
   templates, and frontend work.

3. **D21 still leaves solve-history fields as an example rather than a contract.** The text says
   “e.g. `weightedAvgDistance + distanceUnit`.” Replace that with exact persisted
   `resultSummary` and returned OpenAPI fields. Recommended shape:
   `{status, objective, objectiveMode, weightedAvgDistance, distanceUnit, runTimeSec}`. State whether
   `weightedAvgDistanceMi` remains temporarily for compatibility or is removed in the same
   OpenAPI/codegen commit, and define how existing stored history rows lacking the new fields are
   rendered.

4. **Service Stats and Cost Summary exports still have no serializable schema.** The “locked columns”
   are UI labels, while today's Service Stats export is a homogeneous
   `{template_version, band, percent}` row set. Coverage %, covered demand, uncovered %, average
   distance, and band rows cannot be added as loosely named “rows” without choosing a wide or
   discriminated format. Specify exact JSON properties and CSV headers, including mode and unit,
   for both `serviceStats` and `costSummary`; state whether their template version changes.

5. **D19 still permits two different PATCH/import outcomes.** The normative rule says mismatched
   `distanceBands` are normalized before validation/storage and also rejected by a Zod refinement;
   its test says “normalized/rejected.” Choose one observable API behavior. Recommended: validate
   `highServiceDistKm`/`maxDistKm`, overwrite `distanceBands` with `[high,max]` on create/PATCH/
   import-apply, persist the normalized result, and use a post-normalization invariant assertion—not
   a rejection of an otherwise valid stale-client payload.

### Important corrections

- **Correct the payload/merge boundary.** The Dispatch section says `buildPayload` emits “all params
  + merged dataset.” Existing models send parameters and sparse scenario edits; Python loads the
  immutable package dataset and applies those edits with `merge_inputs.py`. Chen should emit
  `modelType`, parameters, overrides, added entities, and distance overrides only; a
  `build_merged_chens_dataset` helper performs the per-call merge in Python. If sending the full
  dataset is intentional, it is a new architecture and must be justified and scoped explicitly.

- **Make adjusted-distance precheck semantics explicit.** `no_feasible_route` must evaluate
  `rawDistanceKm × 1.17 ≤ maxDistKm`, after merging overrides and estimates and filtering inactive
  warehouses/excluded customers. Comparing the stored raw value directly would let precheck approve
  scenarios the solver declares infeasible.

- **Fix D14's stale decision-table wording.** D14 still says ServiceStats/CostSummary rows are sourced
  from `details`; the normative Output section correctly says average distance comes from
  `metrics.weightedAvgDistance`. Make the table match the detailed contract.

- **Name the exception test boundary.** An exception caught by `solve.py`'s CLI `__main__` boundary
  yields an error envelope, but a direct `solve_chens()` call may throw unless that function adds its
  own catch. State whether the error-envelope test invokes the dispatcher/CLI or requires
  `solve_chens()` itself to catch exceptions.

- **Make the geocode province check implementable.** Dataset rows deliberately store `state: ""`, so
  the extractor has no expected province against which to compare Nominatim's administrative result.
  Either commit a city→province reference map used only during extraction or accept on normalized
  city alone; otherwise “city + province matches” is not reproducible.

- **Thread the P maximum through both controls.** `OptimizationParametersTab` already supports a
  `pMax` prop, while `SolveDialog` still owns an independent hard-coded maximum. Specify that Chen
  passes the same `pMax=25` to both components and test both authoring paths.

### Minor correction

- The Out-of-scope section says “existing 4 models,” while the header correctly states that five
  models already exist before Chen.

**Approval condition:** resolve the five blockers with exact observable field shapes and API behavior,
then align the listed important/minor wording. No changes to the mathematical formulation, notebook
ground truth, circuity, coverage tie policy, min-distance answer, or zero-demand policy are requested.

## Re-review findings — 2026-09-14 (Rev 6, FOLDED → D28–D29 + revisions)

**All verified correct and resolved in the body:** coverage rounding by-mode (D22), output-specific
template version (D28), precheck two-threshold split, legacy solve-history value preservation (D21),
subprocess-only exception test, self-describing distance exports (D29), full CostSummary export schema
(D25), D19 table stale-refinement removed, title→Rev 6, frontend test wording, buildPayload wording.
Original text retained below as audit trail.

**Disposition (historical): close, but revise before implementation planning.** Rev 5 resolves most prior
findings. Two contract blockers and several important inconsistencies remain.

### Blockers

1. **Coverage-objective rounding is still contradictory.** D22 says `coveragePct` is emitted at four
   decimals while `objective` is emitted at two decimals, but also requires `objective == coveragePct`
   in coverage mode. `66.06 != 66.0639`. Lock precision by mode:

   - coverage `objective`, `details.coveragePct`, `details.uncoveredPct`, and the high-service
     `bandCoverage.percent`: four decimal places;
   - min-distance `objective` and `metrics.weightedAvgDistance`: two decimal places; and
   - default-data `coveredDemand`: an unrounded integer.

   Use the existing `abs=1e-3` coverage tolerance against the four-decimal values and `abs=0.05` for
   each two-decimal min-distance value.

2. **A global `TEMPLATE_VERSION` bump would invalidate every existing input CSV.** D24/D25 tie the
   assignment and Cost Summary output changes to the shared `TEMPLATE_VERSION`. Today that one
   constant is emitted by every input/output template and every input parser requires exact equality;
   changing 1→2 would reject existing v1 warehouse, customer, distance, refinery, plant, and
   capability imports. Introduce an entity/output-specific version (for example
   `OUTPUT_TEMPLATE_VERSION = 2`) while leaving input `TEMPLATE_VERSION = 1`. If a global bump is
   intentional, the spec must instead add v1-compatible import parsing and update the much larger
   fixture/contract scope explicitly.

### Important corrections

- **Split the two distance thresholds in semantic precheck.** `no_feasible_route` asks whether each
  active customer has an active warehouse with `rawKm × 1.17 ≤ maxDistKm`. The cheap
  coverage-floor upper bound instead sums demand for customers having at least one active warehouse
  with `rawKm × 1.17 ≤ highServiceDistKm`. The latter is only a necessary upper bound because the
  shared `p` limit may prevent all individually coverable customers from being covered together; the
  solver remains authoritative.

- **Preserve old solve-history distance values.** For stored rows written before D21, read
  `summary.weightedAvgDistance ?? summary.weightedAvgDistanceMi ?? null` and
  `summary.distanceUnit ?? "mi"`; defaulting only the unit would otherwise discard the legacy numeric
  value. Lock nullability for failed jobs and for legacy rows without `objectiveMode` in OpenAPI.

- **Make the exception-envelope test use one real boundary.** Only the CLI `__main__` `try/except`
  catches an exception thrown by `solve(inp)` today. A direct dispatcher call is not equivalent.
  Require subprocess/CLI execution for this test, or move the catch into `solve()`; do not allow
  either path interchangeably.

- **Make every distance-bearing export self-describing.** D24 fixes assignments and D25 fixes Cost
  Summary, but Service Stats still exports unitless `band` values and the raw-distance override export
  still has a unitless `distance` column. Add `distance_unit` to those CSV/JSON exports, or name another
  stable export-level mechanism that labels the unit, so D8's raw-vs-adjusted and km-vs-mi promise is
  preserved outside the UI.

- **Lock the complete Cost Summary export schema.** D25 names `objective_mode` and `distance_unit`
  but not their position or the complete JSON row. Record the full CSV header and corresponding
  camelCase JSON properties, and state which output-specific template version they use.

- **Remove the stale D19 refinement.** The decision table still mentions a Zod refinement, while the
  detailed D19 contract correctly chooses normalize-and-persist without rejecting a mismatched
  incoming `distanceBands` value. The decision table must reflect that single observable behavior.

### Editorial consistency

- Change the title's “normative, Rev 4” to the current normative revision after these findings are
  folded.
- In the Frontend test list, source coverage/covered/uncovered from `details` but average distance
  from `metrics.weightedAvgDistance`; do not describe every KPI as details-sourced.
- Replace “merged scenario-local edits” in the `buildPayload` paragraph with “validated sparse
  scenario-local edits,” consistent with D23's Python-side merge boundary.

**Approval condition:** resolve both blockers and align the precheck/history/export contracts and
stale wording above. No change is requested to the mathematical formulation, notebook facts,
circuity, Option-A coverage tie policy, min-distance answer, band behavior, or zero-demand policy.

## Re-review findings — 2026-09-14 (Rev 7, FOLDED → D4/D22/D25/D29 revisions)

**All verified correct and resolved:** distances-import round-trip preserved (D29 no longer touches the
`distances` template), golden asserts `metrics.weightedAvgDistance ≤ cap` (no phantom `avgServiceDistKm`
field), by-field rounding (D22), ServiceStats versioned + full schema + nullability (D25/D28),
failure-details = shared `_EMPTY_*` (no dual promise), cross-model scope corrected, D4 upper-bound
term, D29 scoped to Chen's output exports (flows/legDistances excluded), ServiceStats "band rows + unit"
wording. Original text retained below as audit trail.

**Disposition (historical): revise before implementation planning.** Rev 6 resolves the earlier rounding
contradiction and global template-version problem in principle. One export/import blocker and several
executable-contract gaps remain.

### Blockers

1. **Adding `distance_unit` to the importable `distances` CSV breaks its round trip.** The current
   distances importer requires exactly
   `template_version,from_id,to_id,distance`. D29 adds a fifth column while D28 deliberately keeps
   input templates at version 1, so a freshly exported file would fail its own importer and the v1
   schema would change without a version change. Choose one complete contract:

   - keep the v1 CSV unchanged and convey the unit through stable export metadata/filename; or
   - define a distances-template v2, emit `distance_unit`, accept both v1 and v2 imports, validate the
     v2 unit against the model manifest, and interpret v1 under the selected model's unit.

   The second choice is more self-describing but adds explicit import/parser/fixture scope; the spec
   must lock one behavior.

2. **The coverage golden references a result field that the envelope does not expose.** The test says
   `avgServiceDistKm ≤ cap`, while the envelope stores the solved average as
   `metrics.weightedAvgDistance`. Assert that field, or recompute a full-precision demand-weighted
   average from `edges`, and identify the authoritative value. Also finish D22 across both modes:

   - `details.coveragePct`, `details.uncoveredPct`, and coverage `bandCoverage.percent`: 4 dp in both
     modes;
   - `metrics.weightedAvgDistance`: 2 dp in both modes; and
   - `objective`: 4 dp in coverage mode, 2 dp in min-distance mode.

### Important corrections

- **Version every changed output serializer.** Service Stats gains `distance_unit`, so it is no
  longer an unchanged v1 output and must use `OUTPUT_TEMPLATE_VERSION = 2` alongside Assignments and
  Cost Summary. Lock its complete CSV header and camelCase JSON row shape.

- **Define Cost Summary nullability.** Existing single-objective envelopes do not contain
  `details.objective`, so their new `objectiveMode` value is unavailable. Make it `string | null` and
  serialize `null` rather than letting `undefined` silently omit a property from the promised exact
  JSON shape. Apply the same rule to every unavailable field in the output row.

- **Reconcile failure details with `_EMPTY_DETAILS`.** The Failure envelope requires Chen mode and
  parameters in `details`, but the Model section says infeasibility uses the shared `_EMPTY_DETAILS`
  constant, and the global CLI catch uses that generic shape too. Either add a Chen-specific
  failure-details builder (and provide the input to the CLI catch) or define failure details as the
  shared empty shape. Do not promise both.

- **Correct the cross-model scope statement.** Generic Cost Summary and Service Stats serializer
  changes affect the five existing models, as does any shared distances-export change. The current
  Out-of-scope section acknowledges only Assignment and solve-history changes.

- **Scope D29 accurately.** “Every distance-bearing export” also includes existing `flows` CSV fields
  named `distanceMi` and importable `legDistances` exports with a unitless `distance`. Either scope D29
  to exports available to Chen or include those serializers and their compatibility tests.

- **Use the precise D4 upper-bound term.** Replace “total servable demand” with “total potentially
  coverable demand under adjusted `highServiceDistKm`.” The semantic precheck computes a necessary
  upper bound; it does not prove joint achievability under the `p` constraint.

### Editorial consistency

- Service Stats is not strictly “band-only” after adding `distanceUnit`; describe it as band rows plus
  unit metadata.
- The implementation plan must cite only the normative body/locked decisions, never the superseded
  review-history alternatives.

**Approval condition:** resolve the two blockers and align output versioning, failure details,
cross-model scope, and terminology. No change is requested to the optimization formulation, notebook
facts, coverage tie policy, min-distance answer, dispatcher, Python merge boundary, band behavior, or
zero-demand policy.

## Re-review findings — 2026-09-14 (Rev 8, FOLDED → D8/D25/D28 + golden field-path + title)

**All verified correct and resolved:** D28 covers ServiceStats + both JSON levels (wrapper == rows,
verified `res.json({templateVersion,…})` wrapper exists) with a contract test; D25 nullability is
type-correct by field (`objectiveMode: string|null`, numeric fields `number|null`, explicit `null`);
min-distance golden uses `metrics.weightedAvgDistance`; title→Rev 8; D8 labeling clarified (UI/reference
labels, v1 CSV model-implicit); "band-0"→"first/high-service band". Original text below is audit trail.

**Disposition (historical):** substantively approval-ready; no mathematical or notebook-fidelity blocker remains.
Resolve the following executable-contract inconsistencies before implementation planning.

### Important corrections

1. **Define output versioning at both JSON levels and include ServiceStats in D28.** D28 currently
   names only Assignments and CostSummary, while D25 and the detailed export section also migrate
   ServiceStats. The existing JSON export response has a top-level `templateVersion` in addition to
   row-level `templateVersion` values. Require both levels to use `OUTPUT_TEMPLATE_VERSION = 2` for
   Assignments, CostSummary, and ServiceStats; OpenWarehouses, Flows, and the importable Distances
   template remain v1. Add contract tests asserting that the wrapper and every row agree. Without
   this rule, an implementation can legitimately emit a v1 wrapper around v2 rows.

2. **Make D25 nullability type-correct by field.** “`objectiveMode` and any field unavailable ... is
   `string | null`” incorrectly assigns a string type to unavailable numeric fields. Specify
   `objectiveMode: string | null`; numeric fields such as `objective`, `weightedAvgDistance`, and
   `runTimeSec` as `number | null` if they can be unavailable; and each remaining metadata field with
   its own appropriate nullable or required string type. Preserve the locked requirement to emit an
   explicit `null`, never `undefined` or an omitted property.

3. **Use the actual result-envelope path in the min-distance golden.** The Golden tests section
   currently asserts bare `weightedAvgDistance == 621.44`; the field is
   `metrics.weightedAvgDistance`. Use that full path, matching the coverage-mode cap assertion and
   `MetricsSchema`.

### Editorial consistency

- Update the document header from “normative, Rev 6” to the current folded normative revision.
- D8 says the raw-distance export is “labeled,” while D29 deliberately preserves the v1 Distances CSV
  without a unit column and makes its unit model-implicit. Clarify that the UI/reference manifest
  labels the raw unit; the bidirectional v1 CSV derives it from the selected model's manifest.
- In the ServiceStats contract, prefer “first/high-service band” over “band-0” so the public meaning
  does not depend on an array-index nickname.

**Approval condition:** align these version, type, and field-path contracts. No change is requested to
the formulation, verified optima, circuity, faithful Option-A coverage tie policy, prechecks, failure
layers, merge boundary, or Distances v1 round-trip decision.
