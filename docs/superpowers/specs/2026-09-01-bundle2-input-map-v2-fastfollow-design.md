# Bundle 2 — Input Map v2 + R1–R9 UX fast-follow to the other 3 models — Design Spec

**Date:** 2026-09-01
**Status:** Draft (awaiting user review)
**Predecessors:** Input Map v2 (`docs/superpowers/plans/2026-08-31-input-map-v2.md`, merged `8bfb304`), R1–R9 Workspace UX (`docs/superpowers/specs/2026-09-01-workspace-ux-r1-r9-design.md`, merged `2ee91eb`, deployed). Both are p-median-us pilots; this bundle brings the other three models to parity.

## Goal

Bring **p-median-brazil**, **transport-coal**, and **two-echelon-gold-au** to full parity with the p-median-us pilot on the Workspace Input Map: the complete v2 editor (click-to-place / move / edit / delete added entities + pairwise distance estimates) plus the p-median-us-only R1–R9 UX (green demand bubbles, quintile bubble sizing, status-marker paint, Save-in-Layers, hide-closed facilities), with each upgrade applied only where it has meaning for that model.

## Locked scope decisions (from brainstorm)

1. **All 3 models**, including Brazil (which needs its missing `GET /dataset` endpoint built first).
2. **Full v2 editor + all p-median-only R1–R9 UX**, scoped per model by capability (below).
3. **transport-coal:** R3 (status markers) and R7 (hide-closed) are **N/A** — a pure transportation LP has no facility open/close or status concept (`solve_transport` returns `openWarehouseIds = all mines` always; mines/stations carry no status). These are gated off the same way R6+R8 already omits facility rows — not forced into a nonsensical UI. transport-coal still gets the v2 editor, R1/R2 station bubbles, and R4 Save-in-Layers.
4. **R1 green demand bubbles apply to all 3** — uniform "green = demand" everywhere. This overrides two-echelon's current blue demand tone.

## Per-model applicability matrix

| Upgrade | p-median-brazil | transport-coal | two-echelon-gold-au |
|---|---|---|---|
| v2 editor (place/move/edit/delete added + distance estimates) | ✓ (warehouses + customers) | ✓ (mines + stations; circuity 1.17 in estimate) | ✓ (mine + refineries + customers; 2-leg estimate) |
| R1 green demand bubbles | ✓ customers | ✓ **stations** (demand-bearing entity) | ✓ customers |
| R2 quintile bubble sizing | ✓ | ✓ | ✓ |
| R3 status markers (outline/dashed paint) | ✓ warehouses | ✗ **N/A** | ✓ refineries only (mine is fixed) |
| R4 Save-in-Layers | ✓ | ✓ | ✓ |
| R7 hide closed facilities | ✓ warehouses | ✗ **N/A** | ✓ refineries (single-open binary) |

The demand-bearing entity per model (R1/R2 target): p-median-brazil → customers (regions); transport-coal → stations; two-echelon → customers.
The facility entity with status/open-close (R3/R7 target): p-median-brazil → warehouses; transport-coal → none; two-echelon → refineries (the mine is fixed, no status).

## What already exists (de-risking)

The Input Map v2 **backend is already multi-model** — this bundle is mostly frontend plus one small backend endpoint:

- **Added-entity persistence + schemas:** Phase B built `addedWarehouses`/`addedCustomers` (p-median-us, brazil), `addedMines`/`addedStations`/`laneCostOverrides` (transport-coal), `addedRefineries`/`addedCustomers`/`distanceOverrides` (two-echelon) into the validation schemas and solver merge paths for **all 4 models**.
- **Distance/cost estimators:** `routes/scenarios.ts`'s `normalizeAddedEntityDistances` already dispatches by modelId across POST-create / PATCH / import-apply, calling `fillEstimatedDistances` (p-median-us, and brazil via the shared schema), `fillEstimatedLaneCosts` (transport-coal, circuity 1.17), and `fillEstimatedTwoEchelonDistances` (two-echelon, both legs). No new estimator work is needed.
- **Prechecks:** `precheckPMedianInputs` / `precheckTransportInputs` / `precheckTwoEchelonInputs` + `BRAZIL_DATASET` all exist.

What is **p-median-us-only today** and must be extended:

- **Frontend `InputMapTab` mode.** Three modes exist: `pmedian` (full v2 — p-median-us only), `legacy` (Task-4 pin-drop — transport-coal, two-echelon), `placeholder` (Brazil — no dataset). This bundle moves all three non-pilot models to a full-v2 editor matching each one's own entity shape.
- **R1–R9 symbology.** `EntityMarkers`/`MapLegend` green-demand + quintile + status paint, `Save-in-Layers`, and `hideClosedWarehouses` are wired for p-median-us; they must be extended per the matrix.
- **Brazil `GET /dataset`.** `routes/dataset.ts` has branches for p-median-us / transport-coal / two-echelon but **not** p-median-brazil (it 400s). Brazil's base data exists as `BRAZIL_WAREHOUSES` + `BRAZIL_REGIONS` (`data/dataset.ts`) and canonically in `solvers/p-median-brazil/dataset/*.json`.

## Architecture

### Backend: Brazil `GET /dataset` endpoint

Add a `p-median-brazil` branch to `routes/dataset.ts` returning `{ warehouses, customers }` for Brazil, mirroring the other three model branches. **Verification requirement (spec-time risk):** the served rows must carry the full map-rendering shape (`id`, `city`, `state`, `lat`, `lng`, and `demand` on customers). Confirm `BRAZIL_WAREHOUSES`/`BRAZIL_REGIONS` carry coords + demand; if they are id-only (they are shaped for precheck), source the endpoint from the canonical `solvers/p-median-brazil/dataset/*.json` instead (the same origin `solve.py` loads), following the existing `data/*Dataset.ts` derivation pattern. No OpenAPI change is expected (the `GET /dataset` response is already an untyped `{warehouses, customers}` passthrough) — confirm during implementation; if a contract change is needed, it goes through openapi.yaml + codegen per hard rule #1/#4.

### Frontend: per-model full-v2 Input Map editor

Each non-pilot model gets a full-v2 editor variant matching its entity types. The p-median-us `pmedian` mode is the template; the work is generalizing its editor + symbology to the other entity shapes rather than a literal flag flip (the input shapes differ: `PMedianMapInputs` vs `TransportLpInputs` mines/stations vs two-echelon refineries/customers/mine).

Decomposition is **per-model (three tracks)** sharing common symbology work:

- **Track B (Brazil):** `GET /dataset` endpoint + frontend query wiring, then the full-v2 editor over warehouses+customers (Brazil shares p-median-us's `PMedianMapInputs` schema, so this is the closest to the pilot — mainly swapping the placeholder mode for the real map + dataset). Full R1/R2/R3/R4/R7.
- **Track T (transport-coal):** full-v2 editor over mines+stations, replacing the legacy pin-drop. R1/R2 station bubbles, R4. **R3/R7 gated off** (N/A).
- **Track E (two-echelon):** full-v2 editor over mine(fixed)+refineries+customers, replacing legacy pin-drop. R1/R2 customer bubbles, R4, R3/R7 on refineries only. Handles the 2-leg geometry (mine→refinery, refinery→customer) in the map + estimates (estimator already exists).

### Cross-model gate consistency (this repo's most-documented bug class)

A shared component's per-model gate updated for one model but forgotten for a sibling has recurred 5+ times (Chapter 10 Rounds 1/2/4, SCN v0.3 Phase B, C6.1). Bundle 2 touches exactly this surface. Mitigations, mandatory:

- Prefer **capability-driven gates** over `modelId === "..."` checks wherever a capability flag expresses the distinction (R3/R7 gate on "has facility open/close + status", not a hardcoded model list). If no clean capability exists, add one to the manifest rather than hardcoding (precedent: R6+R8's `capabilities.supportsP`, C6.1's `capabilities.outputGrids`).
- Run **`model-integration-precheck.md`'s Gate 1 + Gate 6.5** explicitly at every new entity/model registration point in this bundle.
- Every symbology/editor change gets an RTL test **per model** (not only the model being added), asserting the others are unchanged — the same pattern R1–R9's T6/T5 tests used.

## Testing strategy

- **RTL (per model):** editor place/move/edit/delete for each model's entity shape; R1 green bubbles on the demand entity; R2 quintile sizing; R3 status paint (brazil/two-echelon) and **absence** for transport-coal; R4 Save-in-Layers; R7 hide-closed (brazil/two-echelon) and **absence** for transport-coal. Legacy-behavior-unchanged assertions for any model not being modified by a given change.
- **Backend:** Brazil `GET /dataset` returns the correct shape (all rows, coords + demand present); estimator normalizer already covered by Phase B tests (re-confirm green, no new estimator work).
- **Solver gate:** no `solve.py`/dataset-numeric change is in scope. `e2e_accuracy.py` must remain **87/87 unchanged**. If the Brazil endpoint sources from `solvers/p-median-brazil/dataset/*.json`, that is a read, not a mutation — confirm no dataset file is edited.
- **Live Playwright:** one money-path per model against real dev servers (real solve): place an added entity → save → solve → confirm the v2 editor + symbology render; R3 paint proven via computed style for brazil/two-echelon; transport-coal confirmed to have no status/hide-closed UI. Disposable scenarios/users cleaned up.

## Hard rules & invariants (must hold)

- **DD-1:** base dataset files under `solvers/*/dataset/*.json` are never mutated; added entities live only in the scenario's `inputs` JSONB.
- **Hard rule #1/#4:** no hand-edits to generated code; any contract change = openapi.yaml + regenerated codegen in the same commit.
- **Hard rule #5:** ownership filtering (404 never 403) on any new scenario-scoped surface (none expected here; `GET /dataset` is unauthenticated static data).
- **Hard rule #6:** no new solver branches — all model behavior is data/bounds; no `solve.py` change is in scope.
- **`displayedInputs` snapshot principle** (R1–R9): every output surface reads the solve-time snapshot, never the editable draft. Any new per-model output wiring inherits this.
- **DD-7 identity:** added entities carry a stable opaque uid (`aw-`/`ac-`/`am-`/`as-`/`ar-`) as the distanceOverrides join key; never changes on move. Extended per model in Phase B — Bundle 2's editors must preserve it.

## Out of scope (explicit)

- **New models** — that is Bundle 3 (the user will name additional models to integrate).
- **two-echelon `TRUCKLOAD_KG` non-geometric objective handling**, base-entity move/delete, focusable-marker keyboard navigation, touch, marker clustering — all remain deferred from Input Map v2's own out-of-scope list unless a specific one proves necessary for parity.
- **The 3 Minor R1–R9 follow-ups** (compare stale-recheck, `selectedIds` re-init, EntityMarkers green-default invariant) — tracked separately, not part of this bundle.

## Open questions for user review

1. **Decomposition order** — the plan will sequence Track B (Brazil, closest to pilot + one backend piece) first, then T and E. Acceptable, or prioritize differently?
2. **Two-echelon demand tone** — confirmed green for all 3 in brainstorm; flagging again since it visibly changes an existing shipped model.
3. **Brazil dataset source** — endpoint serves from `BRAZIL_WAREHOUSES`/`BRAZIL_REGIONS` if they carry coords+demand, else from `solvers/p-median-brazil/dataset/*.json`. The plan will verify and pick; no decision needed unless you want to force one.
