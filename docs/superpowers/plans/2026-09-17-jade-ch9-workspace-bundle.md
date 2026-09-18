# JADE Ch.9 Workspace Bundle — Implementation Plan

**Date:** 2026-09-17 · **Branch:** `jade-ch9` · **Spec:** `docs/superpowers/specs/2026-09-17-jade-ch9-workspace-bundle-design.md` (rounds 1–7 addressed, approved).
**Model:** `two-echelon-jade-us`. **Execution:** agent-team (isolated worktrees; controller cherry-picks each task onto `jade-ch9` and re-gates on the merged state).

## Scope reminder (from spec)

- **All-models (#1):** palette overflow color; `assignBandOrOverflow` + `bandLabel` at **every** NetworkMap band site; live band recolor (Output Map `bands` feed → `localInputs`); `distanceBands`-sole-key non-staling save (strict); history-entry sync on a bands-only save.
- **JADE-only:** separate `JadeAssignmentsTab`/`JadeFlowsTab`; ServiceStats Plant Production + JADE two-leg coverage recompute; Capability Matrix capacity; output-map plant markers (`effectivePlants`) + union bounds; three avg-distance lines; fixed-4 **validated** band editor; FilterMenu wiring; warehouse-capacity audit; running clock.
- **Backend (two bounded touches):** staleness rule (`scenarios.ts`); model-branched export (`assignments` product-level + combined `flows` schema). **No `solve.py`/dataset/Python change** → `e2e_accuracy.py` NOT re-run.
- **Follow-up (NOT this bundle):** non-JADE ServiceStats coverage bars live-recompute (spec §12).

## Process contract (standing)

- One task = one commit, `[<task-id>] <summary>`, **explicit pathspec** (`git commit -- <paths>`; Bundle 3 shared-index lesson); re-check `git status` before commit.
- **Optional-props pattern** (Bundle 2.2): leaf tasks add new component props as **optional, safe-default**, so each commit typechecks standalone. **INT** wires real values.
- **Single-writer files** (no other task edits these): `Workspace.tsx`→INT; map trio `NetworkMap.tsx`/`MapLegend.tsx`/`OutputMapTab.tsx`→B1; `SolveDialog.tsx`→B9; `OptimizationParametersTab.tsx`→B8; `ServiceStatsTab.tsx`→B4; `CapabilityMatrixTab.tsx`→B5; **`scenarios.ts` + `services/templates.ts`→A4** (both the export route AND the PATCH staleness change live in `scenarios.ts` — one backend owner, per review R-plan-1).
- Two-lane concurrency: backend (A4) ⊥ frontend.
- Per-task gate: typecheck + affected package vitest. Full gate at INT + final.
- Spec/plan docs merged to local `main` on creation, re-merged after review.

## Waves / dependencies

```
Wave A (parallel):  A1  A2  A3  A4(be)
Wave B (parallel, ⟵A): B1  B2  B3  B4  B5  B6  B7  B8
   then B9 ⟵ B8 (SolveDialog single-writer)
Wave C: INT ⟵ all B (+B9)
Wave D: QA ⟵ INT
```
A1–A4 ⟵ none · B1⟵A1 · B2⟵A1,A3 · B3⟵A1,A3 · B4⟵A1,A2,A3 · B5⟵A2,A3 · B6⟵A3 · B7⟵A3 · B8⟵none · B9⟵B8 · INT⟵A1‑A4,B1‑B9 · QA⟵INT

---

## Wave A — foundation

### A1 — Band overflow color + `bandLabel` (frontend)
Spec §2, §11. **Files:** `lib/bandPalette.ts`, `index.css`, `lib/bands.ts`, tests.
- `index.css`: add `--band-overflow` (a color visually distinct from `--band-0..4`; pick from the design system, document).
- `bandPalette.ts`: `getBandColor(-1)` → overflow color; `0..4` unchanged.
- `bands.ts`: `bandLabel(distance, bands)` → `"Band N"` (1-indexed) or `"Overflow"` (built on existing `assignBandOrOverflow`).
**DoD:** `getBandColor(-1)` ≠ `getBandColor(4)`; `0..4` unchanged; `bandLabel` on-boundary → correct band, above-highest → "Overflow".

### A2 — Shared JADE capability helper (frontend)
Spec §6, §7. **Files:** new `lib/jadeCapability.ts` + tests. (Do NOT edit `CapabilityMatrixTab` here.)
- `JADE_ENABLED_CAPACITY = 210_000_000`.
- `isCellEnabled(base, overrides, plantId, productId)` — override wins, else `base.capacity > 0`.
- `cellCapacity(base, plantId, productId, enabled)` — enabled → base capacity if `>0` else `JADE_ENABLED_CAPACITY` for **any** enabled cell (base off-diagonal OR added); disabled → 0. (Matches `merge_inputs.py:869`.)
**DoD:** enabling a base off-diagonal cell → 210,000,000; added cell enabled → 210,000,000; disabled → 0; override removal falls back to base.

### A3 — Reusable FilterMenu + useTableFilters (frontend)
Spec §10. **Files:** new `components/tables/FilterMenu.tsx`, `lib/useTableFilters.ts`, tests.
- `ColumnFilterDescriptor = {key,label,type:"text"|"select"|"number",accessor}`.
- `useTableFilters(rows,descriptors)` → `{filteredRows,filterState,setFilter,clearAll,totalCount,filteredCount}`. text→contains; select→multi-select distinct; number→inclusive min/max. Pure, pre-pagination; distinct values from unfiltered rows.
- `FilterMenu` popover (`.scn-theme`), one control per descriptor by type, per-filter + clear-all, "X of Y" count. Caller controls visibility (render only when `totalCount > 10`).
**DoD (unit+RTL):** each type narrows; distinct derivation; counts; clear-all; controls by type.

### A4 — Backend: non-staling save + model-branched export (backend) — SOLE `scenarios.ts` writer
Merges the former A4+A5 (both live in `scenarios.ts` — the export route at `:454` and the PATCH handler at `:162`/`:183`; can't be two parallel writers, per review R-plan-1). Spec §2 (strict rule) + §5c. **Files:** `artifacts/api-server/src/routes/scenarios.ts` (PATCH staleness + export route branch), `services/templates.ts` (export builder), tests, `openapi.yaml` doc text (entity `enum` unchanged → no codegen). Do the staleness change first, then the export branch (so the export-after-non-staling-save test is coherent within one task).
- **Non-staling (all models):** in the PATCH-inputs handler compute the `inputs` diff. **Only** when the sole changed key is `distanceBands` → do NOT bump `inputsUpdatedAt`/`stale`. Any other changed `inputs` key → stale as today. Strict, scoped to that one key. No schema change; solver still receives `distanceBands`.
- **Export (branch on `modelId`):** JADE `entity=assignments` → product-level `product,customer,assigned_warehouse,distance,distance_band`. JADE `entity=flows` → combined `leg,from_id,to_id,distance,distance_band,flows` (inbound aggregated per plant-warehouse pair; outbound per customer). `distance_band` from **current saved `scenario.inputs.distanceBands`** (server-side `bandLabel` equivalent). Non-JADE exports **unchanged**.
- **Also owns the hand-crafted API-rejection test** moved from B8 (per review R-plan-2): a PATCH body with ≠4 / non-positive / non-ascending `distanceBands` still 422s (schema unchanged).
**DoD:** JADE+non-JADE `distanceBands`-only PATCH does not stale; `distanceBands`+`p` PATCH stales; name-only PATCH unchanged; JADE export column/label tests (both entities) + a **non-JADE byte-identical** export regression; export after a non-staling bands-only save reflects new bands; invalid-`distanceBands` PATCH 422s; ownership (404-not-403) intact.

---

## Wave B — leaf components (parallel; optional props; INT wires call sites)

### B1 — Map trio: all-site overflow + plant markers + avg lines + timing overlay (frontend) — SOLE map-trio writer
Spec §2 (#1 all sites), §3 (#2), §4 (#3), §9 (overlay). **Files:** `NetworkMap.tsx`, `MapLegend.tsx`, `OutputMapTab.tsx`, tests. ⟵A1.
- **#1 all sites:** replace `assignBand`→`assignBandOrOverflow` + `getBandColor` (overflow for `-1`) + `bandLabel` at the lane (`:495`), popup (`:391`/`:175`/`:192`), customer highlight (`:535`→`:542/:544/:558/:560`), tooltip (`:580`). No hand-rolled `Band ${x+1}` survives. Respect `colorByBand`; JADE default colorByBand ON on solve. `MapLegend` gains the overflow swatch.
- **#2:** separate optional `plants` prop (default `[]`) → plant square markers (input-map symbol), never `hideClosedWarehouses`-hidden; inbound endpoints resolve `fromId` against `plants`; fit bounds to the **union of rendered marker coords** driving `maxBounds` + `FitBounds` + `mapKey`. **Degenerate-bounds guard (per review R-plan-4):** if the rendered-marker union has **fewer than 2 valid coordinates** (all layers toggled off, or one lone marker), fall back to the union of **all effective entity coordinates** (plants+warehouses+customers regardless of toggle), and if that is still `<2`, to manifest `countryBounds`; always apply padding so a single point never yields degenerate bounds. `MapLegend` "Plant" entry when non-empty; Plants layer toggle in `OutputMapTab` (default on).
- **#3:** Output Map overlay card shows three labelled flow-weighted lines for JADE (P→W, W→C from `avgDistanceByLeg`; Overall from `weightedAvgDistance`), each with `distanceUnit`; single line for single-leg models.
- **#8 overlay:** overlay card renders an optional frozen `timing` prop (total + queued/active split); suppressed when absent.
**DoD (unit+RTL):** overflow consistent across lane/highlight/popup/tooltip (single overflow customer); boundary→band; plant markers + connected lanes + union-bounds; **all-layers-off / single-marker → falls back to all-entity coords or manifest bounds, padded, never degenerate**; three avg lines (JADE) / one (single-leg); overlay timing renders when provided, suppressed when not.

### B2 — JadeAssignmentsTab (product-level) + filter (frontend)
Spec §5, §5a. **Files:** new `JadeAssignmentsTab.tsx`, tests. ⟵A1,A3. (Shared `AssignmentsTab.tsx` untouched.)
- Rows from `displayedResult.details.assignments` (product-level). Columns: Product · Customer · Assigned Warehouse · Distance · Distance Band. No Demand/Flow. Band via `bandLabel(distanceMi, liveBands)`. Names via `dataset.products`/customers/warehouses. Optional snapshot props (default safe).
- FilterMenu (Product/Customer/Warehouse select-or-text; Distance number; Band select). Show >10. Pagination if large.
**DoD:** exact columns/order; product-level rows; band matches map; filter hidden ≤10/shown >10 + count.

### B3 — JadeFlowsTab (two inner tabs) + per-leg CSV + filter (frontend)
Spec §5b. **Files:** new `JadeFlowsTab.tsx`, tests. ⟵A1,A3. (Shared `FlowsTab.tsx` untouched.)
- Segmented control **Plant → Warehouse** | **Warehouse → Customer**.
  - P→W: inbound edges summed over `productId` per `(fromId,toId)`. Columns: Plant · Warehouse · Distance · Flow · Distance Band. No Product/Transport Cost.
  - W→C: outbound edges per customer. Columns: Warehouse · Customer · Distance · **Flows** · Distance Band (label exactly `Flows`).
- Per-inner-tab FilterMenu (>10) + Download CSV of that leg (client-side).
**DoD:** two inner tabs; P→W aggregated (no per-product dupes); `Flows` label; band labels; per-tab filter + per-leg CSV.

### B4 — ServiceStats: Plant Production + JADE coverage recompute + filter (frontend) — SOLE ServiceStatsTab writer
Spec §6, §2 (coverage). **Files:** `ServiceStatsTab.tsx`, tests. ⟵A1,A2,A3.
- **Plant Production (JADE, gated on `supportsPlantProductCapability`):** full effective `plants × products` grid left-joined to inbound production. Columns: Plant · Product · Actual production · Enabled capacity · Remaining capacity. Actual = Σ inbound-edge `flow` by `(plant,productId)`; capacity/enabled via A2; remaining = enabled−actual (enabled), "—" (disabled). Zero/disabled combos visible. `.toLocaleString()`. Optional snapshot props (default → section hidden).
- **JADE coverage recompute:** for JADE only, coverage bars recompute via `computeCumulativeBandCoverage(edges, liveBands)` over **`warehouse_to_customer` edges only**. Non-JADE unchanged (frozen `metrics.bandCoverage`).
- FilterMenu on Plant Production (>10 → shown at 16 rows).
**DoD:** full-grid left-join (zero+disabled visible); production/capacity/remaining math; JADE coverage over W→C only with an edited boundary + overflow row; non-JADE still frozen; filter shown.

### B5 — Capacity in Capability Matrix + filter (frontend) — SOLE CapabilityMatrixTab writer
Spec §7. **Files:** `CapabilityMatrixTab.tsx`, tests. ⟵A2,A3.
- Rewire to A2 helpers; keep checkbox control. Read-only capacity per cell: enabled → base capacity if `>0` else `210,000,000`; disabled → `0` (`.toLocaleString()`); flips live on toggle. Label "capacity per plant-product combination". No numeric editing.
- FilterMenu wired with runtime >10 rule (4 rows → hidden until added plants exceed 10).
**DoD:** enable base off-diagonal → 210,000,000 in matrix; unchecked → 0; toggle flips value; label present; filter hidden at 4 rows **AND shown when added plants push rendered plant rows >10 (positive test, per review R-plan-5)**.

### B6 — Warehouse-capacity audit + shared warehouse filters (frontend)
Spec §8, §10. **Files:** `WarehousesTab.tsx`/`WarehouseTable.tsx`, `OpenWarehousesTab.tsx`, `CreateEntityDialog.tsx`, tests. ⟵A3.
- Verify no JADE surface renders a warehouse-capacity field or `10,000,000`; hide any leak (capacity column gated on `capacityModes`/`capacityMode`; utilization column for JADE). UI-only.
- Add optional `enableFilters?: boolean` (default false) to shared `WarehousesTab`/`OpenWarehousesTab`; wire FilterMenu behind it (runtime >10). Other models unaffected (default false).
**DoD:** no warehouse-capacity control + no `10,000,000` on JADE warehouse/open-warehouse surfaces; `enableFilters` off → other models unchanged; on + >10 → menu shown.

### B7 — Shared-component filter opt-in + JadeDistances/Plants filters (frontend)
Spec §10. **Files:** `CustomersTab.tsx`, `ImportDialog.tsx`, `JadeDistancesTab.tsx`, `PlantsTab.tsx`, tests. ⟵A3.
- Add `enableFilters?: boolean` (default false) to shared `CustomersTab` + `ImportDialog` (Errors + Changes grids counted as **separate** tables). Wire FilterMenu behind it (runtime >10).
- `JadeDistancesTab` (JADE-only): migrate its From/To free-text to the shared FilterMenu; preserve pagination + focus/filter-reset handling.
- `PlantsTab` (JADE-only): **base plants and "Added plants" stay two separate physical tables** (current structure, `PlantsTab.tsx:246`; per review R-plan-5) — wire FilterMenu into each independently, threshold per table (runtime >10).
**DoD:** shared components unchanged when `enableFilters` off; JadeDistances migrated (pagination intact); import Errors/Changes independent thresholds; **Plants: base table (4 rows) hides its menu, AND the Added-plants table with >10 added rows SHOWS its menu (positive test)**.

### B8 — JADE fixed-4 validated band editor + Optimization Parameters wiring (frontend) — SOLE OptimizationParametersTab writer
Spec §2 (R3-1+R6-1). **Files:** new `JadeBandEditor.tsx`, `OptimizationParametersTab.tsx`, tests. ⟵none.
- `JadeBandEditor`: four ordered numeric inputs, **no add/remove**. Enforces the FULL invariant client-side — four **positive integers, strictly ascending** — with **inline errors** and an **isValid** signal that **disables Save** on any violation (never PATCHes an invalid set).
- `OptimizationParametersTab`: use `JadeBandEditor` when `modelId==="two-echelon-jade-us"`; other models keep the chip editor.
- **Validity contract (per review R-plan-2):** Save + save-before-solve live in `Workspace.tsx`, NOT this tab — so the editor cannot disable Save itself. `JadeBandEditor` therefore (a) shows inline errors, (b) **never commits an invalid set upward** (only publishes a valid 4-tuple to `localInputs`), and (c) exposes an **`onValidityChange(isValid)`** signal. **INT** consumes that signal to disable/guard **every** save + solve entry point (see INT). The hand-crafted API-rejection test moves to **A4** (backend).
**DoD (UI tests):** zero/negative, duplicate, descending each → inline error shown AND `onValidityChange(false)` fired AND no invalid value published to `localInputs`; valid set → `onValidityChange(true)` + value published; the editor cannot produce ≠4 bands.

### B9 — SolveDialog: JADE editor wiring + running clock (frontend) — SOLE SolveDialog writer
Spec §2 (editor), §9 (clock). **Files:** `SolveDialog.tsx`, tests, `lib/useElapsed.ts`. ⟵B8.
- Use `JadeBandEditor` for JADE (same validity contract — publishes only valid values, exposes `onValidityChange`); other models keep the chip editor. The dialog's own Run/solve button is guarded by that validity via INT (the dialog surfaces validity up; INT gates the run).
- Live clock during `queued`/`running` (1s tick): "Queued Xs" then "Queued Xs · Solving Ys" once `startedAt`. Freeze on terminal (`succeeded`/`failed`). On `failed`, dialog shows the frozen total. Optional timing props (default undefined); INT threads real values.
**DoD (RTL, fake timers):** queued-only → queued time; after `startedAt` → split; freeze on terminal; failed shows frozen total; JADE editor invalid → `onValidityChange(false)` surfaced (run gating verified in INT).

---

## Wave C — integration

### INT — Workspace wiring (frontend) — SOLE `Workspace.tsx` writer
Spec §2/§3/§5/§6/§9/§10. **Files:** `Workspace.tsx`, tests. ⟵ all A + all B.
- **#1 live recolor:** switch the Output Map `bands` feed at `:3010` from `displayedInputs` → live `localInputs.distanceBands` (all models). Fix the stale `OutputMapTab` comment.
- **#1 history sync:** on a successful `distanceBands`-only save, update `resultHistoryState.items[index].inputs.distanceBands` in place.
- **#1 band validity guard (per review R-plan-2):** hold JADE band validity (from `JadeBandEditor`'s `onValidityChange`, via `OptimizationParametersTab`/`SolveDialog`); when invalid, **disable/guard every save + solve entry point** — the Save button, the save-before-solve path in `handleSolve`, and the SolveDialog Run — not just the visible Optimization Parameters button.
- **#2:** pass `effectivePlants = dataset.plants ∪ displayedInputs.addedPlants` to the JADE `OutputMapTab`/`NetworkMap` (`:2927-3035`).
- **#8 (timing handoff race — per review R-plan-3):** job success (`:2317`) is observed **before** the refetch appends the new result-history entry (the append effect at `:1439-1444` fires when `currentScenario.result` changes). So do **not** attach timing to the currently-displayed (older) entry. Instead: at job success, **retain the terminal timing keyed by `{scenarioId, jobId}`** (from `queuedAt`/`startedAt`/`finishedAt`); when the append effect creates the new `ResultHistoryEntry`, attach the retained timing to **that new entry**. Pass the displayed entry's timing to the Output Map overlay; suppress when the entry has none. Also thread live `queuedAt`/`startedAt`/`status` into `SolveDialog` for the running clock.
- **#4/#5:** render JADE branches for `JadeAssignmentsTab`/`JadeFlowsTab` (`:3096`,`:3123`); pass snapshot props (`displayedResult`/`displayedInputs`/`dataset`) + `presentationBands`(=live `distanceBands`) to Jade report tabs + `ServiceStatsTab`.
- **#9:** pass `enableFilters={true}` to shared `CustomersTab`/`WarehousesTab`/`OpenWarehousesTab`/`ImportDialog` on the JADE path only.
**DoD:** Workspace suites green; editing bands recolors lanes with **zero network calls** (multi-model RTL); bands-only save → step away → back preserves bands; **invalid JADE bands disable Save AND save-before-solve AND the dialog Run** (all three, tested); **timing attaches to the newly-appended entry in the real event order (job-success-then-refetch-append), not the older displayed entry** (test with that order); JADE output map gets plants; overlay gets the displayed entry's timing; Jade tabs get snapshot props; shared tabs get `enableFilters` only for JADE. **Full gate at this checkpoint.**

---

## Wave D — QA

### QA — real-browser Playwright (qa-sdet)
Spec §14. **Files:** new `e2e/jade-ch9-workspace-bundle.spec.ts` (excludes `labs.spec.ts`). ⟵INT.
Local dev servers (`API_PROXY_TARGET`), fresh account, real JADE scenario + async solve. Verify: (1) overflow color on a JADE lane + consistent highlight/popup/tooltip "Overflow"; band edit recolors with no solve call; (2) plant markers + connected lanes + union-bounds; (3) three avg-distance lines; (4) Customer Assignments product-level columns + Flows two inner tabs with `Flows` label; (5) Plant Production section; (6) Capability Matrix 210,000,000/0 read-only, flips on toggle; (7) no warehouse-capacity field / no `10,000,000`; (8) clock queued/active split + persistent frozen total after dialog auto-close; (9) FilterMenu on a >10-row JADE table (incl. Warehouses input) — type-aware + count + clear.
**Cross-model regression (approver scope): also `p-median-us`** — band edit recolors live + a bands-only save does not stale (no StaleOutputBanner). Other 3 models covered by unit/RTL only.
Run twice for stability. Report product bugs to the controller (not fixed in QA).

## Final gate (controller, merged branch)
typecheck · api-server vitest · studio vitest · solver pytest (no-regression, Python untouched) · **`e2e_accuracy.py` NOT re-run** (unchanged). Full whole-branch review before merge to local `main`. Render deploy deferred (outward-facing — surface + confirm first).

## Review comments (Codex, 2026-09-18)

The plan is well structured, but the following task-boundary and lifecycle issues should be resolved before execution.

1. **[P1] A4 and A5 cannot be parallel or separate single writers.** A5 modifies the PATCH handler in `scenarios.ts`, while A4 must modify the export handler in that same file to branch on `modelId` and pass `scenario.inputs.distanceBands`. A4's "export after a non-staling bands-only save" test also depends on A5. Make A4 depend on A5 and permit sequential ownership, or split builder work from one backend integration task that owns `scenarios.ts`.

2. **[P1] B8 cannot disable the Workspace Save control it does not own.** `OptimizationParametersTab` only edits values; Save and save-before-solve live in `Workspace.tsx`. B8's `isValid` signal therefore cannot satisfy its own "invalid → Save disabled/never PATCH" DoD without explicit INT wiring. Add centralized JADE-band validity in INT and guard every save/solve entry point—not merely the visible Optimization Parameters button—or define that the editor never publishes invalid values. Move the hand-crafted API-rejection test to a backend/QA task.

3. **[P2] Specify the timing handoff race.** Job success is observed before the scenario refetch appends the new result-history entry. INT should retain terminal timing keyed by scenario/job, then attach it when the new result is appended—not update the currently displayed, older entry. Add a test with that actual event order.

4. **[P2] B1 still needs padded bounds and a fallback.** If every marker layer is hidden, the rendered-marker union is empty; one remaining marker produces degenerate bounds. Require padding and fall back to all effective entity coordinates or manifest bounds when fewer than two valid coordinates remain.

5. **[P2] Add positive filter-wiring tests for Plants and Capability Matrix.** Their DoDs only verify that filtering is hidden at four rows. Require a test showing the menu above ten rows. For Plants, first choose whether base and added plants remain separate physical tables—currently they do—or become one combined table; apply the threshold accordingly.

6. **[P2] Reconcile document status.** The plan says the spec is approved, while the spec still says "Awaiting spec approval before plan." Update one of them before execution.

## Plan-review responses (2026-09-18) — all 6 accepted, folded in

1. **R-plan-1 (A4/A5 collide on `scenarios.ts`) — done.** Confirmed both the export route (`:454`) and the PATCH handler (`:162`/`:183`) live in `scenarios.ts`. **Merged A4+A5 into one backend task A4** owning `scenarios.ts` + `services/templates.ts` (staleness first, then export branch). A5 removed; waves/deps/single-writer updated.
2. **R-plan-2 (B8 can't disable Workspace's Save) — done.** `JadeBandEditor` never publishes invalid values + exposes `onValidityChange`; **INT** guards every save + solve entry point (Save button, save-before-solve in `handleSolve`, SolveDialog Run). The hand-crafted API-rejection test moved to **A4**. B8/B9/INT DoDs updated.
3. **R-plan-3 (timing handoff race) — done.** INT **retains terminal timing keyed by `{scenarioId, jobId}`** at job success and attaches it to the **newly-appended** `ResultHistoryEntry` (append effect `:1439-1444`), not the older displayed entry; test asserts the real job-success-then-refetch-append order.
4. **R-plan-4 (degenerate bounds) — done.** B1 falls back from the rendered-marker union (`<2` valid coords) to all effective entity coords, then manifest bounds, always padded; DoD adds the all-layers-off/single-marker test.
5. **R-plan-5 (positive filter tests + Plants structure) — done.** Plants stays **two separate physical tables** (base vs added), threshold per table; B7 adds a positive >10 test on the Added-plants table; B5 adds a positive >10 test on Capability Matrix (added plants push rendered rows past 10).
6. **R-plan-6 (doc status) — done.** Spec status updated to approved (below).
