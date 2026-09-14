# Chapter 4 — Chen's Cosmetics Coverage / Service-Level Model (`chens-cosmetics-cn`)

**Design spec (normative, Rev 3).** Adds a 5th solver model to Network Optimization Studio: a China
warehouse-siting service-level model from the Chen's Cosmetics notebooks (Watson, Ch. 4).
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

Dispatched on `modelId == "chens-cosmetics-cn"`. Mode from `payload["objective"] ∈ {coverage,
min_distance}`. Requires `0 < highServiceDistKm < maxDistKm`.

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

**Never throws.** Every non-optimal exit returns a **complete** envelope that validates against
`ResultEnvelopeSchema` (§Result envelope, Failure envelope).

## Result envelope (`_envelope`)

**Success:**
- `status: "optimal"`, `objective` (coverage % in coverage mode, demand-distance in min-distance),
  `runTimeSec`, `quality` (required string), `solverUsed`, `infeasibilityReason: null`.
- `edges[]` = assignments `{fromId: whId, toId: csId, distance: dist_adj, flow: assignedDemand}` —
  `flow` required (served customer's effective demand); **`leg` omitted** (its enum accepts only the
  two-echelon values; single-echelon leaves it absent, never `null`).
- `metrics` — reuse generic keys only: `weightedAvgDistance` (km, via `distanceUnit:"km"`),
  `bandCoverage` (cumulative: `coveragePct` at `highServiceDistKm`, `100%` at `maxDistKm` for every
  positive-demand feasible solve). No Chen-only keys in `metrics` (closed object strips unknowns).
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
(server returns no postal code) persist as **absent/blank** — never guessed. A geocode **provenance
report** (per-row hit/miss/ambiguous) is committed alongside the dataset. Zip is display-only; the
integrity check asserts it is never read by the solver or any golden.

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

**Semantic precheck (reuse the B2.1 precheck service), returns structured findings:**
- blocking: total effective demand `≤ 0` (D15); duplicate/colliding ids; `forcedOpenCount > p`;
  `p > active candidate count`; any active customer with no route `≤ maxDistKm`; `coverageFloorDemand
  > total servable demand` (min-distance).
- warning: unresolved overrides; missing added-entity distances; implausibly tight avg cap.
The solve path still returns a valid infeasible envelope if a mathematically infeasible case reaches
it.

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
`OptimizationParametersTab`, and Landing recent-solves; generalize solve-history's
`weightedAvgDistanceMi` to carry a unit **before** this km model is visible on Landing. Tests assert
`km` and the **absence of `mi`** on Chen surfaces.

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

**Output tabs + KPIs (D14):** `ServiceStatsTab` and `CostSummaryTab` gain **model-aware rows sourced
from `details`** (coverage %, covered demand, uncovered %, avg distance in km) — today they render only
`metrics.bandCoverage`, so this is real component work, not free. `ObjectiveBar`, exports, and
solve-history use **mode-aware labels** (coverage % vs demand-km — never one generic "Objective"
label). Same-model compare is **restricted to scenarios sharing `details.objective`**. Output Map with
metric overlay.

## Tests & QA

**`test_chens.py` (pytest) — tie-aware assertions:**
- *Coverage:* status optimal; exact covered demand `131645389` (≈ 66.0639 % with tolerance); open set
  `{wh-40, wh-69, wh-102}`; exactly-one assignment per active customer; route/open linkage;
  max-distance feasibility; `avgServiceDistKm ≤ cap`. **Do NOT** assert runtime, exact average
  distance, specific customer→warehouse assignments, or edge order.
- *Min-distance* (floor `131645389`): additionally assert the deterministic objective
  `123834216789.27` and avg `621.44 km` with documented tolerances; same open set.
- *Failure:* floor `500100100` infeasible; zero-demand (all customers excluded, and all effective
  demands zeroed) — both blocked by precheck AND, if bypassed, a schema-valid infeasible envelope;
  unexpected solver error → schema-valid error envelope. Every failure case asserts the envelope
  validates against `ResultEnvelopeSchema`.
- Override behaviors: forced-open binds, inactive WH absent, excluded customer absent, added WH
  openable, distance override changes an assignment.
- Runtime only in a broad timeout/termination check, not per-value.
- NOT added to `e2e_accuracy.py` (sacred).

**API (vitest):** per-mode validation (required params, `highServiceDistKm < maxManifest`, bad
objective), `buildPayload` translation + derived bands + km estimator, precheck findings, reference
distances, export/import model→dataset selection + sibling-model negatives, ownership 404,
`registration.test.ts` extended to 5 models, metric parse-retention if any public field added.

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

Three review rounds; all findings accepted and **folded into the body above**. This section records
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
