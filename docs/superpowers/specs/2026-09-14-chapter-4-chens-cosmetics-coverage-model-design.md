# Chapter 4 — Chen's Cosmetics Coverage / Service-Level Model (`chens-cosmetics-cn`)

**Design spec (normative, Rev 4).** Adds a new solver model to Network Optimization Studio (the 6th —
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
| D4 | Min-distance floor input | Absolute demand `coverageFloorDemand`, default `131645389`. Blocking precheck if `> total servable demand`. |
| D5 | Frontend scope | Full stack, visible (`hiddenFromLanding: false`) |
| D6 | Scenario-local network edits | Full parity (added warehouses/customers, distance overrides, status overrides) |
| D7 | Solver structure | One `solve_chens()`, mode = data (branch only on objective sense + the one mode-specific constraint) — hard rule 6 |
| D8 | Circuity ×1.17 | Store RAW km; apply ×1.17 in solver. Solved edges = adjusted km; base tables/reference/overrides/export = raw km. Both labeled. |
| D9 | Zip codes | Geocoded once; **acceptance rule locked below**. Display-only, never affects goldens. |
| D10 | Echelon | Single-echelon warehouse→customer (no plant/supply layer — grep-verified across all three notebooks) |
| D11 | Capacity | None. `capacityMode: "none"` **persisted** in inputs; warehouse overrides = status only |
| D12 | outputGrids | `["openWarehouses","assignments","costSummary","serviceStats"]` (= p-median-us/brazil). No `flows` (single-echelon → `assignments` is the flow view). `costSummary` is a distance/objective rollup, not monetary. |
| D13 | Distance bands | **Derived, non-editable** `distanceBands = [highServiceDistKm, maxDistKm]`, resynced whenever either param changes. Two-class coverage lens (§Bands). |
| D14 | Mode-aware presentation | ServiceStats/CostSummary gain **model-aware rows sourced from `details`**; ObjectiveBar/exports/solve-history carry mode-aware labels; same-model compare **restricted to scenarios sharing `details.objective`**. |
| D15 | Zero effective demand | Total effective demand `≤ 0` = **blocking precheck error**; solver still returns a complete infeasible envelope if bypassed. |
| D16 | Dispatch key | `solve.py` dispatches on `inp["modelType"]`; Chen emits `modelType: "chens"` from `buildPayload` + a new `SolveInput` union member. |
| D17 | Two failure layers | Model-level (math-infeasible / caught exception) → complete envelope, job succeeds. Process-level (timeout/spawn/exit/stdout/validation) → job `failed`, prior result intact. |
| D18 | Precheck contract | `PrecheckResult {ok, errors}`, blocking-only (no warnings channel). New codes `zero_demand`, `no_feasible_route`, `coverage_floor_infeasible`; reuse `completeness`/`reference_integrity`/`id_collision`/`p_range`. |
| D19 | Band persistence | Normalize `distanceBands` → `[high, max]` before validation/storage on create/PATCH/import + Zod refinement; hide editor in `OptimizationParametersTab` AND `SolveDialog`. |
| D20 | Km exports | Pass `distanceUnit` into the assignment export builder; don't emit adjusted km under `distanceMi`/`distance_mi`. `km`/no-`mi` tests cover CSV + JSON exports. |
| D21 | Solve-history shape | Generalize `resultSummary.weightedAvgDistanceMi` → unit-carrying field; persist the `objective` mode for label formatting. |
| D22 | Rounding/tolerance | Envelope floats round to 2 dp; tests use `pytest.approx` (coveragePct abs 1e-3, min-dist objective rel 1e-6, avg abs 0.05); integer `coveredDemand` + warehouse set are equality. |

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

**Dispatch contract (D16).** `solve.py::solve()` dispatches on `inp["modelType"]` (defaults
`p_median`; unknown → error path), NOT on `modelId`. So: add `{modelId: "chens-cosmetics-cn"; inputs:
ChensInputs}` to `pmedian.ts`'s `SolveInput` union; the Chen `buildPayload` branch emits
`modelType: "chens"` + `objective` + all params + merged dataset; `solve()` dispatches
`modelType == "chens"` → `solve_chens()`. (Miss the discriminator and it silently falls through to
p-median.) Mode from `payload["objective"] ∈ {coverage, min_distance}`. Requires
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
merged into the dataset dicts before build via the existing scenario-local merge layer. No capacity.

**Two failure layers (D17) — do not conflate.**
- **Model-level** (mathematical infeasibility, or an exception caught inside solve.py's JSON
  boundary) → `solve_chens` returns a **complete** `ResultEnvelope` (status `infeasible`/`error`); the
  solve **job succeeds** and persists that envelope.
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

**Failure envelope (infeasible / error).** All fields present so it validates: `status`
(`"infeasible"`|`"error"`), `objective: 0`, `runTimeSec`, `quality` (e.g. "infeasible"),
`edges: []`, `metrics: {}` (all-optional → empty ok), `details: {objective, p, highServiceDistKm,
maxDistKm, …params, openWarehouseIds: []}`, `solverUsed`, `infeasibilityReason` non-null.

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
wire — it does NOT repair the saved `scenario.inputs` that maps/exports/later-edits read. One canonical
rule: **normalize `distanceBands` to `[highServiceDistKm, maxDistKm]` before validation/storage on
every write path** (create, PATCH, import/apply), backed by a Zod refinement that rejects any other
value (defense against a stale or hand-authored client). The band editor is **hidden in both
`OptimizationParametersTab` AND `SolveDialog`** (both render it today). Tests: a direct PATCH or import
carrying a third boundary is normalized/rejected, never persisted.

## Dataset (`solvers/chens-cosmetics-cn/`)

One-off extraction script imports Step-3 `get_data()` (no hand-retype), mapping numeric city ids to
slug ids consistently across files (warehouse ids are a subset of customer ids — PK collision, same as
Ch.10; slugging avoids it).

- `warehouses.json` — 25 rows `{id: "wh-15", city, state: "", lat, lng, zip}`. **No `country`, no
  `kind`** (neither in `WarehouseEntry` → stripped; every Chen WH is an overridable facility, omit
  `kind` per convention).
- `customers.json` — 197 rows `{id: "cs-1", city, state: "", lat, lng, demand, zip}`. No `country`.
- `distances.json` — 4925 pairs, **raw km**, index-keyed `[whOrdinal, csOrdinal]`.
- `version.json` — sha256 + version.
- `manifest.json` — `countryBounds` computed from **all** warehouse+customer coords + padding (real
  span Kashi `75.97°E` … Jixi `130.97°E`, `20.05–47.4°N`); extraction asserts every source point is
  inside. `distanceUnit: "km"` (top-level manifest field; omission defaults `"mi"`).

**Zip acceptance rule (D9):** Nominatim, 1 req/sec, retry/backoff. Normalize to a trimmed string.
Coverage floor **≥ 85 %** of 222 rows or the extraction **aborts** (no partial commit). Genuine misses
(server returns no postal code) persist as **absent/blank** — never guessed. **Ambiguous match
policy:** accept a Nominatim result only when its returned city + admin/province matches the row's
city (case-insensitive); if multiple results match or none matches on city/province, record the row as
**ambiguous** and leave `zip` blank (ambiguous rows don't count toward the 85 % floor as hits). A
geocode **provenance report** (per-row: selected result, hit/miss/ambiguous, normalized value) is
committed alongside the dataset. Zip is display-only; the integrity check asserts it is never read by
the solver or any golden.

## Contract & registration

**OpenAPI (`openapi.yaml`) + Orval regen (one commit):**
- `modelId` enum += `chens-cosmetics-cn`.
- `zip` — already present on `WarehouseCandidate`/`Customer`; no change.
- `distances` entity — already enumerated; no enum change. Real work: **model→dataset selection** in
  export/import/apply/reset + template/stub functions + reference/data-route branches. Today's
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
- `avgServiceDistCapKm > 0` (required iff coverage); `coverageFloorDemand ≥ 0` (required iff min_distance)
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
  (total effective demand ≤ 0, D15), `no_feasible_route` (an active customer with no route
  ≤ `maxDistKm`), `coverage_floor_infeasible` (`coverageFloorDemand > total servable demand`,
  min-distance). Reuse `p_range` for `forcedOpenCount > p` / `p > active candidate count`. Each new
  code added to `PrecheckErrorCode`, the OpenAPI error schema, regenerated clients, and Workspace
  rendering.
- The "implausibly tight avg cap" idea is **dropped** — it has no home in a blocking-only contract and
  the solver already returns a valid infeasible envelope for it.
The solve path still returns a valid infeasible envelope (model-level, D17) if a mathematically
infeasible case bypasses precheck.

**`pmedian.ts buildPayload`:** discriminated-union entry — translate validated inputs + merged
scenario-local edits into the solver wire format; derive `distanceBands` from `[high, max]`; add a
**Chen branch to `normalizeAddedEntityDistances`** and a **Chen estimator producing raw haversine
kilometres (no ×1.17)** — stored base + overrides are raw km and the solver applies circuity; the
generic `fillEstimatedDistances` emits miles and must not be reused as-is.

**Job wire:** unchanged async `jobRunner` path.

## Frontend

`chapters.ts` entry drives Landing card, `App.tsx` route, header title. Gate-1's ten registration
points (`model-integration-precheck.md`) run explicitly.

**Kilometre display (real added scope):** `distanceUnit: "km"` in the manifest; remove/parameterize
hard-coded mile labels in `AssignmentsTab`, `ObjectiveBar`, `NetworkMap`'s customer popup,
`OptimizationParametersTab`, and Landing recent-solves. **Exports too (D20):** solve.py emits
assignment `distanceMi` and `AssignmentTemplateRow`/`assignmentRowsToCsv` expose
`distanceMi`/`distance_mi` — Chen must NOT export adjusted km under a miles field name. Pass the
model's `distanceUnit` into the export builder and use a backward-compatible unit-aware row/header
contract (existing mile models unchanged). Tests assert `km` / **absence of `mi`** on Chen surfaces
**including CSV and JSON assignment exports**, not just visible labels.

**Inputs (Workspace tabs):**
- Mode toggle (`objective`) segmented Coverage ⇄ Min-distance; switches which param field shows.
- `p` slider **1–25** — the shared slider is hard-capped at 50, so give it a model-derived max; test
  that 26 cannot be authored via the tab or the Solve dialog. `highServiceDistKm`, `maxDistKm` always
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
columns:
- *ServiceStats* rows/CSV: `Coverage %`, `Covered demand`, `Uncovered %`, `Avg service distance (km)`
  + the existing cumulative `bandCoverage` `{band, percent}` rows.
- *CostSummary* rows: `Objective` (mode-aware, below), `Avg service distance (km)`, band rollup.

**Mode-aware objective (D14).** `ObjectiveBar`/CostSummary/exports/history format `objective` by mode
(coverage `%` vs `demand-km`) — never one generic "Objective" label. The mode comes from
`details.objective`. **Solve-history (D21):** `resultSummary`'s hardcoded `weightedAvgDistanceMi` is
generalized to a unit-carrying field (e.g. `weightedAvgDistance` + `distanceUnit`), and `resultSummary`
persists the `objective` **mode** so the Landing/history row can format it. Same-model **compare is
restricted to scenarios sharing `details.objective`**. Output Map with metric overlay.

## Tests & QA

**`test_chens.py` (pytest) — tie-aware assertions:**
- *Coverage:* status optimal; **exact** integer `coveredDemand == 131645389` and **exact** open set
  `{wh-40, wh-69, wh-102}` (equality); `coveragePct == pytest.approx(66.0639, abs=1e-3)`;
  exactly-one assignment per active customer; route/open linkage; max-distance feasibility;
  `avgServiceDistKm ≤ cap`. **Do NOT** assert runtime, exact average distance, specific
  customer→warehouse assignments, or edge order.
- *Min-distance* (floor `131645389`): additionally `objective == pytest.approx(123834216789.27,
  rel=1e-6)` and `weightedAvgDistance == pytest.approx(621.44, abs=0.05)`; same exact open set.

**Rounding/tolerance policy (D22):** the envelope emits `objective`/`weightedAvgDistance`/`coveragePct`
rounded to 2 decimals (matching solve.py's existing `round(..., 2)` convention). Tests use
`pytest.approx` (tolerances above) for all floats; only integer `coveredDemand` and the warehouse set
are equality assertions.
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
column, no band editor, P-max 25, outputGrids gating, `details`-sourced ServiceStats/CostSummary rows,
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

Plant/supply echelon; capacity constraints; adding Chen answers to `e2e_accuracy.py`; changes to the
existing 4 models beyond the shared registration lists/gates this model touches.

---

## Review history (audit trail — superseded, non-normative)

Rev 1–4 findings were accepted and **folded into the body above** (Rev 4 → decisions D16–D22). This
section records that they happened — it specifies nothing.

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
