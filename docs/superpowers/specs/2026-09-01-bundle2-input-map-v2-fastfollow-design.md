# Bundle 2 — Input Map v2 + R1–R9 UX fast-follow to the other 3 models — Design Spec

**Date:** 2026-09-01
**Status:** rev 3 (both open decisions resolved; ready for plan)
**Predecessors:** Input Map v2 (`docs/superpowers/plans/2026-08-31-input-map-v2.md`, merged `8bfb304`), R1–R9 Workspace UX (`docs/superpowers/specs/2026-09-01-workspace-ux-r1-r9-design.md`, merged `2ee91eb`, deployed). Both are p-median-us pilots; this bundle brings the other three models to parity.

**Rev 2 changes:** incorporates a review pass that found the rev-1 "de-risking" claims materially wrong. Verified against code/data: Brazil and two-echelon **do** need estimator work; Brazil needs an OpenAPI change, a customer-shape adapter, manifest-schema parity, and an output-map architecture decision; the R3/R7 capability must be defined here, not deferred. All corrected below.

## Goal

Bring **p-median-brazil**, **transport-coal**, and **two-echelon-gold-au** to full parity with the p-median-us pilot on the Workspace Input Map: the complete v2 editor (click-to-place / move / edit / delete added entities + pairwise distance estimates) plus the p-median-us-only R1–R9 UX (green demand bubbles, quintile bubble sizing, status-marker paint, Save-in-Layers, hide-closed facilities), with each upgrade applied only where it has meaning for that model.

## Locked scope decisions (from brainstorm)

1. **All 3 models**, including Brazil (which needs its missing `GET /dataset` endpoint built first).
2. **Full v2 editor + all p-median-only R1–R9 UX**, scoped per model by capability (below).
3. **transport-coal:** R3 (status markers) and R7 (hide-closed) are **N/A** — a pure transportation LP has no facility open/close or status concept (`solve_transport` returns `openWarehouseIds = all mines` always; mines/stations carry no status). Gated off via a capability flag, not forced into a nonsensical UI. transport-coal still gets the v2 editor, R1/R2 station bubbles, and R4.
4. **R1 green demand bubbles apply to all 3** — uniform "green = demand". Overrides two-echelon's current blue demand tone.

## Per-model applicability matrix

| Upgrade | p-median-brazil | transport-coal | two-echelon-gold-au |
|---|---|---|---|
| v2 editor (place/move/edit/delete added + distance estimates) | ✓ (warehouses + customers) | ✓ (mines + stations) | ✓ (refineries + customers; **mine is fixed, non-editable**) |
| R1 green demand bubbles | ✓ customers | ✓ **stations** | ✓ customers |
| R2 quintile bubble sizing | ✓ | ✓ | ✓ |
| R3 status markers (outline/dashed paint) | ✓ warehouses | ✗ **N/A** | ✓ **refineries only** (mine fixed, no status) |
| R4 Save-in-Layers | ✓ | ✓ | ✓ |
| R7 hide closed facilities | ✓ warehouses | ✗ **N/A** | ✓ **refineries only** (never the fixed mine) |

Demand-bearing entity (R1/R2 target): brazil → customers; transport-coal → stations; two-echelon → customers.
Facility entity with status/open-close (R3/R7 target): brazil → warehouses; transport-coal → none; two-echelon → refineries.

### two-echelon fixed-mine invariant (P1, must be explicit)

The two-echelon mine (Kalgoorlie) is **read-only context**: it can never be placed, moved, edited, copied, or deleted, and R7 must **never** filter it out. The existing `WarehouseCandidate.kind` (`"mine" | "facility"`, from Chapter 10) is the join point — R7 filters only **closed `kind: "facility"`** rows and always retains `kind: "mine"`. Today's `NetworkMap` drops every warehouse-role row absent from `openWarehouseIds`; the fixed mine is never in that refinery-only result, so a naive R7 would drop it. Acceptance requires an RTL assertion that hide-closed removes a closed refinery **and preserves the mine**.

## What already exists vs. what this bundle must build (corrected)

**Genuinely done (Phase B):**
- Added-entity **Zod validation schemas + solver merge paths** for all 4 models (`addedWarehouses`/`addedCustomers`, `addedMines`/`addedStations`/`laneCostOverrides`, `addedRefineries`/`addedCustomers`/`distanceOverrides`).
- Prechecks: `precheckPMedianInputs` / `precheckTransportInputs` / `precheckTwoEchelonInputs` + `BRAZIL_DATASET`.
- Estimators for **p-median-us** (plain haversine) and **transport-coal** (haversine × 1.17 lane costs).

**NOT done — must be built (this is the corrected core of the backend work):**

#### Estimator gaps (P1) — per-leg circuity conventions

Every model's estimator must replicate its **own base matrix's** distance convention, reverse-derived from the base data and locked with a test. Verified ratios (stored ÷ plain-haversine-miles):

| Model / leg | Base convention | `normalizeAddedEntityDistances` today | Required fix |
|---|---|---|---|
| p-median-us | plain haversine mi (×1.000) | `fillEstimatedDistances` (plain) | none |
| transport-coal lanes | haversine × 1.17 | `fillEstimatedLaneCosts` (×1.17) | none |
| two-echelon mine→refinery | plain haversine mi (×0.999) | `fillEstimatedTwoEchelonDistances` (plain) | none |
| **two-echelon refinery→customer** | haversine × **≈1.179** | plain haversine | **add circuity ≈1.179 to this leg only** |
| **p-median-brazil** | haversine × **1.17** | **falls through unchanged (none)** | **add a Brazil estimator (BRAZIL_DATASET + ×1.17)** |

- **two-echelon:** `fillEstimatedTwoEchelonDistances` writes plain `haversineMiles` for **both** legs; the refinery→customer base leg actually carries a ≈1.179 circuity factor, so added refinery→customer rows are understated ~15% and can wrongly influence which single refinery opens. The estimator must apply the exact factor (reverse-derived from the base matrix, not assumed 1.17) to the refinery→customer leg only; the mine→refinery leg stays plain. The misleading `autoDistance.ts` comment ("haversineMiles for both legs, no circuity") — which only ever spot-checked a mine→refinery pair — must be corrected.
- **Brazil:** `normalizeAddedEntityDistances` has no `p-median-brazil` branch (`return data` fall-through), so added-entity distances are never estimated; routing Brazil through the US plain-haversine path would also be wrong (Brazil base = ×1.17). Add a Brazil branch: parameterize/clone the estimator to use `BRAZIL_DATASET` and the 1.17 factor, wired on POST-create, PATCH, and import-apply, with idempotency + move/re-estimation tests.
- **`e2e_accuracy` 87/87 is preserved** by all of the above: base matrices are never edited; only added-entity rows are estimated. The fixes make added rows *consistent* with the untouched base convention. The plan must state this explicitly per model.

#### Brazil `GET /dataset` — endpoint + contract + adapter (P1)

- `routes/dataset.ts` has no `p-median-brazil` branch (400s today). Add one returning `{ warehouses, customers }`.
- **OpenAPI change is mandatory, not conditional.** The `getDataset` query `modelId` enum is `[p-median-us, transport-coal, two-echelon-gold-au]` and the response is the typed `Dataset` schema; generated `GetDatasetModelId` mirrors the narrower enum. Adding Brazil **requires** updating `openapi.yaml` (enum + description) and regenerating `lib/api-zod` + `lib/api-client-react` in the same commit (hard rule #1/#4).
- **Customer-shape adapter is mandatory.** `BRAZIL_REGIONS` (from canonical `states.json`) is `{id, name, lat, lng, demand}` — it lacks the `city`/`state` fields `Dataset.Customer` requires; `BRAZIL_WAREHOUSES` similarly lacks them. Falling back to the canonical file does **not** fix this. Lock and test a deterministic adapter: **`city = name`, `state = id`** (regions have no separate city/state; the region name is the display label, the region code is the stable id). Applies to both the endpoint output and any frontend consumer that expects `Dataset` shape.

#### Brazil manifest-schema parity (P2)

`solvers/p-median-brazil/manifest.json`'s `inputsSchema` omits `addedWarehouses`, `addedCustomers`, and `distanceOverrides`, even though `GET /models` publishes it — schema-driven consumers get a false contract. Add these to Brazil's manifest `inputsSchema` (matching the p-median-us manifest it otherwise mirrors).

#### Brazil R7 output-map architecture (P1) — **RESOLVED: migrate to NetworkMap**

Swapping the Input Map placeholder does **not** deliver R7 for Brazil. `OutputMapTab` routes Brazil through `BrazilMap`, which takes only `{result, showRoutes}` and renders counts ("N DCs · M demand regions") — it consumes no dataset, `displayedInputs`, added entities, status overrides, or `hideClosedWarehouses`.

**Decision (user):** migrate Brazil output from `BrazilMap` to the shared `NetworkMap`, same as the other models — R7 + effective-dataset-from-`displayedInputs` geometry + all output features come with parity, and the codebase stops maintaining a divergent Brazil output map. `BrazilMap` is retired once the migration is verified. Regression risk to Brazil's currently-working output is covered by per-model RTL + a Brazil live-solve e2e. The migration must honor the `displayedInputs` snapshot principle (output reads the solve-time snapshot, never the draft) and Brazil's `Dataset`-shape adapter (city=name, state=id).

**Frontend, p-median-us-only today, to extend:**
- `InputMapTab` modes: `pmedian` (full v2, us only), `legacy` (transport/two-echelon pin-drop), `placeholder` (Brazil). Move all three non-pilot models to a full-v2 editor matching each one's own entity shape.
- `EntityMarkers`/`MapLegend` green-demand + quintile + status paint; `Save-in-Layers`; `hideClosedWarehouses` — extend per the matrix.

## Capability metadata (P2) — defined here, not deferred

The existing capability schema (`supportsP`, `capacityModes`, `demandEditable`, `outputGrids`) cannot distinguish transport-coal's no-status mines from two-echelon's status-bearing refineries + fixed mine. To keep R3/R7 gates capability-driven (never `modelId === "..."`), add one capability:

- **`capabilities.supportsFacilityStatus: boolean`** — true when the model has open/close + status facilities that R3/R7 act on. Values: p-median-us `true`, p-median-brazil `true`, two-echelon-gold-au `true`, transport-coal `false`.

R3 status markers and R7 hide-closed gate on `supportsFacilityStatus`. The two-echelon fixed-mine retention uses the orthogonal existing `WarehouseCandidate.kind` (`"mine"` never filtered), not this flag.

**Change surface for this capability (all in one coherent set):** `lib/dataset-schema` `ManifestSchema`; all 4 `solvers/*/manifest.json`; `openapi.yaml` `ModelInfo.capabilities` + regenerated codegen; `registry/modelRegistry.ts` `toPublic` default (`?? false`); frontend gate call sites; and test fixtures on both the API and frontend sides.

## Architecture & decomposition

Three per-model tracks sharing common symbology + capability work:

- **Track B (Brazil):** capability + manifest parity → `GET /dataset` (endpoint + OpenAPI + adapter) → Brazil estimator (×1.17) → frontend full-v2 editor (Brazil shares `PMedianMapInputs`) → R1/R2/R3/R4 → **R7 output-map architecture** (per the open decision). Largest track.
- **Track T (transport-coal):** full-v2 editor over mines+stations (replaces legacy) → R1/R2 station bubbles → R4. R3/R7 gated off via `supportsFacilityStatus === false`. No estimator work (lane costs already ×1.17).
- **Track E (two-echelon):** **unit relabel km→mi** (see below) → refinery→customer estimator circuity fix → full-v2 editor over refineries+customers with the **fixed mine as read-only context** → R1/R2 customer bubbles → R4 → R3/R7 on refineries only (never the mine). Handles 2-leg geometry in the map.

#### two-echelon unit relabel (RESOLVED: relabel km→mi)

The two-echelon base numbers are geographically **miles** (mine→refinery plain haversine miles; refinery→customer haversine × ≈1.179 circuity) and are the source notebook's own published values — but `test_two_echelon.py`'s ground-truth objective (`386576.99`) and the notebook itself label them "km". T2 (Bundle 1) set `distanceUnit: "km"` off that mislabel. **Decision (user):** relabel to `"mi"` so the displayed unit matches the actual mile-magnitude data. This is a **one-value change** in `solvers/two-echelon-gold-au/manifest.json` (`distanceUnit: "km" → "mi"`), surfaced through the already-existing `ModelInfo.distanceUnit` "mi"|"km" enum (no schema/codegen change — the enum already has both values). **Zero data change** — the numbers, the objective `386576.99`, and `test_two_echelon.py`'s golden assertions are all untouched, so the notebook-fidelity contract and `e2e_accuracy` 87/87 hold. Update the tests that asserted two-echelon = "km" (T2's `registry.test.ts`, T3's `ServiceStatsTab` km case) to "mi". This reverses a Bundle-1 decision, now grounded in the verified ground-truth reality.

### Cross-model gate consistency (this repo's most-documented bug class)

A shared component's per-model gate updated for one model but forgotten for a sibling has recurred 5+ times. Mandatory mitigations:
- **Capability-driven gates** (the new `supportsFacilityStatus`), never hardcoded model lists.
- Run `model-integration-precheck.md` Gate 1 + Gate 6.5 at every new entity/model registration point.
- Every symbology/editor change gets an RTL test **per model** asserting the others are unchanged.

## Testing strategy

- **RTL (per model):** editor place/move/edit/delete per entity shape; R1 green bubbles on the demand entity; R2 quintile sizing; R3 status paint present (brazil/two-echelon) and **absent** (transport-coal); R4 Save-in-Layers; R7 hide-closed present (brazil/two-echelon, **mine preserved for two-echelon**) and **absent** (transport-coal); "other models unchanged" assertions.
- **Backend:** Brazil `GET /dataset` returns the correct adapted shape (all rows, `city`/`state`/`lat`/`lng`/`demand` present); Brazil + two-echelon estimators — idempotency, move/re-estimation, and correct per-leg circuity (reverse-derived factor asserted).
- **Solver gate:** no `solve.py`/dataset-numeric change. `e2e_accuracy.py` **87/87 unchanged**; the plan states per model why each estimator fix leaves base data untouched.
- **Live Playwright (expanded, P2):** real-solve journeys must exercise **both editable roles** per model, then verify the generated cross rows:
  - transport-coal: added **mine** + added **station** → verify generated lane costs.
  - two-echelon: added **refinery** + added **customer** → verify generated mine→refinery **and** refinery→customer rows (correct circuity on the latter).
  - Brazil: added **warehouse** + added **customer** (one case or split across two).
  - R3 paint proven via computed style (brazil/two-echelon); transport-coal confirmed to have no status/hide-closed UI. Disposable data cleaned up.

## Hard rules & invariants

- **DD-1:** base `solvers/*/dataset/*.json` never mutated; added entities live only in scenario `inputs` JSONB.
- **Hard rule #1/#4:** no hand-edited generated code; every contract change = `openapi.yaml` + regenerated codegen in the same commit (applies to the `GET /dataset` enum and the `ModelInfo.capabilities` addition).
- **Hard rule #5:** ownership 404-never-403 on any scenario-scoped surface (`GET /dataset` is unauthenticated static data).
- **Hard rule #6:** no new solver branches — model behavior stays data/bounds; no `solve.py` change in scope.
- **`displayedInputs` snapshot principle:** every output surface reads the solve-time snapshot, never the editable draft — Brazil's R7 output work must honor this.
- **DD-7 identity:** added entities keep their stable opaque uid; never changes on move.

## Out of scope (explicit)

- **New models** — Bundle 3.
- **two-echelon `TRUCKLOAD_KG` non-geometric objective**, base-entity move/delete, keyboard-focusable markers, touch, marker clustering — deferred from Input Map v2's own out-of-scope list.
- **The 3 Minor R1–R9 follow-ups** — tracked separately.

## Resolved decisions (were open in rev 2)

1. **Brazil R7 output-map architecture** — **migrate Brazil output to the shared `NetworkMap`** (retire `BrazilMap`). See the Brazil output-architecture section above.
2. **two-echelon km/mi label** — **relabel `distanceUnit` km→mi** (one manifest value, zero data change; notebook objective + `test_two_echelon.py` golden values preserved). See the two-echelon unit-relabel section above.
