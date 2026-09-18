# JADE Ch.9 Workspace Bundle — Design Spec

**Date:** 2026-09-17
**Branch:** `jade-ch9`
**Model in scope:** `two-echelon-jade-us` (Chapter 9 — multi-product plant→warehouse→customer, single-source, plant-product capability matrix).
**Status:** review rounds 1 (§16), 2 (§18), 3 (§20), 4 (§21), 5 (§22), 6 (§23), 7 (§24) addressed; approver chose Option C for bands; edited-band behavior restored to all-models (§22). non-JADE coverage-bar live-recompute accepted as a tracked follow-up (§12), not this bundle. No open decisions. **APPROVED (2026-09-18)** — implementation plan written (`docs/superpowers/plans/2026-09-17-jade-ch9-workspace-bundle.md`), plan-review round 1 addressed.

## 0. Resolved decisions (from clarifying round)

- **D1 (Big-M / #7):** UI-hide only. Do **not** touch `solve.py`'s `JADE_OPEN_BIG_M` formulation. Zero solver/e2e risk.
- **D2 (Filter scope / #9):** JADE-first. Build one reusable `FilterMenu` component + hook, wire it into JADE's tables this bundle. Other models fast-follow in a later bundle.
- **D3 (Filter type / #9):** Type-aware per column — text→contains, categorical→multi-select of distinct values, numeric→min/max range.
- **D4 (Bands / #1):** One scenario `distanceBands` config; every lane (both JADE legs) classified by its **own** distance against those shared thresholds; distinct overflow color above the highest boundary.

## 1. Grounding facts (verified against code)

| Area | File:line | Fact |
|---|---|---|
| Lane color | `NetworkMap.tsx:495` | `getLegColor(edge.leg) ?? getBandColor(assignBand(edge.distance, bands))` — leg color wins for JADE; band toggle inert. Uses `assignBand` (folds overflow into last band). |
| Overflow helpers | `lib/bands.ts:94-104` | `OVERFLOW_BAND = -1` + `assignBandOrOverflow()` already exist (jade-T14) but map/legend don't use them. |
| Palette | `lib/bandPalette.ts:8-12` | `BAND_COLORS` = 5 CSS vars; `getBandColor` clamps `Math.min(index,4)` — **no** overflow color, `-1`→`BAND_COLORS[0]` (wrong). |
| Plant markers | `NetworkMap.tsx:587-631` | Only warehouse triangle/star + customer circle marker kinds. Plants folded into `warehouses` via `jadePlantsAsWarehouseCandidates()` (`Workspace.tsx:588`) and auto-hidden (`:595` `hideClosedWarehouses && !isOpen`). |
| Input-map plants | `InputMapTab`/`MapLegend` | Input map already renders `plantSquareSvg` markers + `showPlantLayer` legend — reusable symbology. |
| Bounds | `lib/mapBounds.ts`, `NetworkMap.tsx:293-307,151-157` | Bounds from manifest `countryBounds`, not marker coords. |
| Per-leg avg | `solve.py:1167-1174`, `metrics.avgDistanceByLeg` | Envelope emits `[{leg, avgDistance, totalFlow}]` per leg + `weightedAvgDistance` overall blend. Consumed only by legacy `Studio.tsx:1602`, not Workspace. |
| Assignments detail | `solve.py:1143-1148`, `details.assignments` | Product-level `{customerId, warehouseId, productId, flow, distanceMi}`. |
| Plant production | inbound `edges` `plant_to_warehouse` w/ `productId` + `flow` | `flow` = `flow_pw` value = plant-product actual production. |
| Capability capacity | `plant_product_capability.json` | 4 diagonal cells `capacity:210000000`, 12 off-diagonal `capacity:0`. `JADE_CAPABILITY` (`solve.py:126`). Override wire translates `enabled`→`210_000_000`. |
| Warehouse capacity | `jadeInputs.ts:48-54,97-107`; manifest `capacityModes:[]` | **No** warehouse-capacity input exists. 10M is solver-internal Big-M only. |
| Job timing | `solve_jobs.ts:15-17`; `scenarios.ts:405-424` | `queuedAt`/`startedAt`/`finishedAt` exposed on GET solve-job. `runTimeSec` = solver-internal, only in `resultSummary`/history. |
| Current output tabs | `AssignmentsTab.tsx` (Customer/Warehouse/Distance/Flow), `FlowsTab.tsx` (From/To/Product/Distance/Flow), `ServiceStatsTab.tsx` (band bars) | See §5-§7. |
| Filters/pagination | `DistancesTab.tsx:171-172,476-486,184-317` | Only free-text From/To inputs + local PAGE_SIZE=50 pager. No reusable FilterMenu. Output grids have neither. |

## 2. Requirement #1 — Fix distance-band lane coloring (all models, shared logic)

**Behavior**
- Switch the map/legend from `assignBand` to `assignBandOrOverflow` so out-of-range lanes get the `OVERFLOW_BAND` sentinel instead of folding into the last band.
- **EVERY band-classification call site in `NetworkMap` must switch, not just the lane (reconciles review R7-1).** `assignBand` (and its `Band ${x+1}` labels) appears at: the lane color (`:495`), the selected-customer **popup** (`:391` → color `:175`, label `:192`), the **customer highlight** fill/stroke (`:535` → `:542/:544/:558/:560`), and the customer **tooltip** label (`:580`). If only `:495` changes, an overflow lane recolors while its customer highlight keeps the last-band color and its popup/tooltip read "Band N" — inconsistent. Require `assignBandOrOverflow` + the overflow color + the overflow **label** at **all** of them: colors via `getBandColor` (returns the overflow color for `-1`), labels via the shared `bandLabel` (§11), which renders "Overflow" for `OVERFLOW_BAND` instead of `Band ${x+1}`. No hand-rolled `+1` label survives.
- Add a distinct **overflow color** to the palette; `getBandColor(-1)` returns it (not `BAND_COLORS[0]`).
- Every lane colored by its own distance against the scenario's single `distanceBands` set. Both JADE legs classified independently by their own distance (D4).
- Boundary inclusion stays **upper-inclusive** (`distance <= boundary` → that band) — matches existing `assignBand`.

**Presentation-band state vs. the solved-input snapshot (reconciles review P1-1)**
- Today every OUTPUT surface reads `displayedInputs` (`Workspace.tsx:1487-1505`), the frozen inputs snapshot that produced the on-screen result, and a band edit does **not** recolor an existing result. Requirement #1 explicitly demands live reclassification without a re-solve — the two conflict. Resolution: introduce a **presentation-band state** used ONLY as the color/label lens.
  - Band classification is a pure function of `(edge.distance, bands)`; it never changes result geometry (which warehouses open, which customer is served by which warehouse, the distances themselves). So a live band edit is a legitimate presentation change, not a stale-making input change.
  - `presentationBands` is seeded from the displayed result's `displayedInputs.distanceBands` on solve / history-step, then freely editable. The map lane colors, the `MapLegend`, the band-coverage bars, AND every report "Distance Band" column read `presentationBands` — so colors and labels always agree.
  - Result geometry/identity (edges, assignments, distances, production, open set) continues to come from `displayedResult` / `displayedInputs`. The snapshot invariant is retained for geometry; only the color/label lens is live.

**One band field; a bands-only save is non-geometric (reconciles review R2-2 — APPROVER DECISION: Option C).** There is exactly **one** `distanceBands` (on `inputs`); the Optimization Parameters tab and the map/results band editor read/write the same field — no separate "presentation" field is introduced. `distanceBands` is verified non-geometric: it is sent to the solver only to stamp `edge.band` + `bandCoverage` (reporting), never affecting objective/open-set/assignments, and the frontend already recomputes coverage client-side and ignores the solver's stamped bands (E1.1). Resolution:
  - **The color/label lens reads the LIVE `distanceBands`** (`localInputs.distanceBands`), so a band edit recolors the map, legend, coverage bars, and report Distance-Band columns immediately. Geometry (edges/assignments/distances/production/open-set) keeps coming from `displayedResult`/`displayedInputs` — only the band lens is live. (Where this spec says `presentationBands`, read it as "the live `distanceBands` array passed as a prop," not a new stored field.)
  - **A save is non-geometric ONLY when `distanceBands` is the SOLE changed `inputs` key (strict rule — approver decision).** Compute the `inputs` diff at Save: if the only changed key is `distanceBands` → do not bump `inputsUpdatedAt`, do not set `stale`, no re-solve. If the diff also changes **any** other `inputs` key (`p`, `capacityMode`, `warehouseOverrides`, `customerOverrides`, `addedPlants`/`addedWarehouses`/`addedCustomers`, `plantProductCapability`, `distanceOverrides`, `gap`, `timeLimitSec`, …) → stale as normal (geometric wins). Scenario **name** is a separate column, not in `inputs`, and already doesn't affect staleness — orthogonal. Persists across reload (still a saved input). `edit bands → save → reopen output` shows the recolor with **no** `StaleOutputBanner` and **no** re-solve — a required test; plus a test that a bands+`p` save DOES stale.
  - Small **backend** task (A-wave): the `inputsUpdatedAt`/`stale` derivation (and the PATCH-inputs handler) must treat a `distanceBands`-only change as non-geometric. Scope the special-case to *only* `distanceBands` (a diff touching any other input key stays geometric). No schema/column change; no `SolveInput` change (the solver still receives `distanceBands`, harmlessly).
  - **Sync the history entry on a bands-only save (reconciles review R4-1).** The result-history stepper stores a per-entry `{result, inputs}` snapshot and only appends a NEW entry when `.result` changes by reference (`Workspace.tsx:1437-1444`). A bands-only save produces no new result → no new entry, so the current entry keeps its **pre-save** `inputs.distanceBands`; `stepResultBack/Forward` then overwrite `localInputs`/`savedInputsRef` from that stale snapshot (`:1454-1470`), silently reverting the save. Resolution: on a successful bands-only save, INT updates the **displayed** history entry in place — `resultHistoryState.items[index].inputs.distanceBands` = the saved value — so stepping away and back preserves it. Required test: **edit bands → save → step to another entry → step back → bands still applied** (and `localInputs`/`savedInputsRef` reflect the saved bands, not the pre-save ones).
  - **Owner:** `Workspace.tsx` passes the live `distanceBands` to `NetworkMap`/`MapLegend`/output tabs and syncs the displayed history entry on a bands-only save (INT wires both). Backend owns the non-geometric-save classification.

**JADE band editor must honor the FULL exactly-4 invariant (reconciles review R3-1 + R6-1).** `jadeInputsSchema.distanceBands` requires exactly four **positive, strictly-ascending integers**; the current `OptimizationParametersTab`/`SolveDialog` add/remove **chip** editor can violate all of it. A fixed-4-slot editor alone only fixes the *count* — a user could still enter a zero/negative, a duplicate, or a descending value and hit a **422 on Save**. Resolution: a **JADE-specific fixed-4-slot band editor** — four ordered numeric inputs, **no add/remove** — used in both `OptimizationParametersTab` and `SolveDialog` when `modelId==="two-echelon-jade-us"`, that **enforces the full invariant client-side**: four values, each a positive integer, strictly ascending. Invalid state shows **inline errors AND disables Save** (never lets an invalid set reach the PATCH). No schema relaxation; other models keep the existing chip editor. **UI tests for every invalid case:** (a) a zero/negative value, (b) a duplicate value, (c) a non-ascending (descending) value — each surfaces an inline error and disables Save; plus a valid 4-band set enables Save and PATCHes successfully; and the API still rejects a hand-crafted invalid body (schema unchanged).

**Scope of the live lens — ALL MODELS (reconciles review R5-1; corrects the earlier R3-2 over-narrowing).** Requirement #1 is explicitly all-models; the JADE-first decision (D2) applies to **filters (#9)**, not bands. So these are **all-models**, with cross-model regression tests per #1's DoD:
  - The shared band-color palette fix (overflow color + `assignBandOrOverflow` in the shared map/legend path).
  - **Live band recolor without solve.** Today the Output Map's `bands` prop is fed from `displayedInputs` at the single call site `Workspace.tsx:3007-3010` (the deliberate T4 "editing draft bands never recolors the on-screen solve" behavior) — for **every** model, so #1 is currently unmet everywhere. #1 **overrides T4 for the color lens**: switch the Output Map `bands` feed to the **live `localInputs.distanceBands`**, all models, so a band edit recolors lanes/legend/report-columns immediately. Geometry (edges/assignments/added entities) keeps coming from `displayedInputs`/`displayedResult` — only the band lens goes live. (Stepping the history stepper sets `localInputs = entry.inputs` at `:1459`/`:1468`, so the lens still matches the stepped entry's bands.)
  - The `distanceBands`-only **non-staling save** (backend) — **all models** (bands are non-geometric for every model; this is what makes "reclassify without another solve" survive a Save universally). NOT gated on `modelId`.
  - The **history-entry sync on a bands-only save** — all models.

  **JADE-only carve-out (outside #1's "lanes" scope):** the two-leg **coverage-bar recompute** in `ServiceStatsTab` (§6) is JADE-only, because it requires selecting `warehouse_to_customer` edges out of JADE's two-leg edge set. #1 governs map **lanes**, not the ServiceStats coverage bars; non-JADE `ServiceStatsTab` continues to read the frozen `result.metrics.bandCoverage` unchanged. *(If you want non-JADE coverage bars to also recompute live from edited bands, that's a larger all-model ServiceStats change — flagged, not assumed.)* The **exactly-4 fixed editor** stays JADE-only (only `jadeInputsSchema` mandates 4).

**Files (§2):** `lib/bandPalette.ts`, `index.css`, `lib/bands.ts` (`bandLabel`), `NetworkMap.tsx` (ALL band sites → `assignBandOrOverflow` + `bandLabel`: lane `:495`, popup `:391`/`:175`/`:192`, customer highlight `:535`, tooltip `:580`), `MapLegend.tsx`, `OutputMapTab.tsx` (fix the stale `localInputs` comment), `Workspace.tsx` (**switch the Output Map `bands` feed at `:3010` from `displayedInputs` → live `localInputs.distanceBands`, all models**; INT also syncs the history entry on a bands-only save), `OptimizationParametersTab.tsx` + `SolveDialog.tsx` (JADE fixed-4 editor), **`artifacts/api-server/src/routes/scenarios.ts` (a `distanceBands`-only save = non-geometric, ALL models: skip the `inputsUpdatedAt`/`stale` bump; scope the exception strictly to that one key)**. **Tests:** the §2 regression list above (run across models) **plus** focused api-server tests — a `distanceBands`-only PATCH does not stale (result stays fresh) for a non-JADE model AND for JADE, a PATCH also touching a geometric key does stale, and a multi-model RTL test that editing bands recolors lanes with zero network calls.

**Live band-coverage recompute — JADE only (reconciles review R2-3 + R3-2).** `ServiceStatsTab` currently reads the frozen `result.metrics.bandCoverage` for every model. **For JADE only**, recompute client-side from the live `distanceBands` via `computeCumulativeBandCoverage(edges, liveBands)` (cumulative + explicit `-1` overflow row, already in `bands.ts`), feeding **`warehouse_to_customer` edges ONLY** (including `plant_to_warehouse` would mix the two legs and double-count throughput). **Non-JADE models are untouched** — they keep reading the frozen `result.metrics.bandCoverage` exactly as today. Regression tests: JADE edited boundaries reclassify coverage; overflow row appears above the highest boundary; JADE excludes inbound edges; a non-JADE model still renders the frozen coverage.

**JADE leg-vs-band coloring resolution**
- The existing "Color lanes: Distance band" toggle governs. When ON → band colors apply to JADE lanes (currently inert — the `getLegColor(...) ?? ...` short-circuit is the bug). When OFF → leg colors (green inbound / red outbound) as today.
- On solve, JADE routes auto-enable with band coloring ON (mirrors E4.1 auto-on-band for other models), so the default post-solve view is band-colored per D4/#1's "color every lane by distance".
- Per-leg **layer** toggles (show/hide `plant_to_warehouse` / `warehouse_to_customer`) are unchanged and independent of color mode.

**Files:** `lib/bandPalette.ts` (overflow color + `getBandColor(-1)`), `NetworkMap.tsx:495` (respect `colorByBand`, use `assignBandOrOverflow`), `MapLegend.tsx` (overflow swatch), `OutputMapTab.tsx` (JADE default colorByBand on solve), `index.css` (new `--band-overflow` var).

**Regression tests (unit + RTL):**
- Every model's map uses the shared `assignBandOrOverflow`/`getBandColor` path (no local color copies).
- A distance exactly on a boundary → that boundary's band (upper-inclusive).
- Editing bands reclassifies lane colors with zero network calls.
- A distance above the highest boundary → overflow band with the distinct overflow color, not the last band — asserted at **every** surface: lane color, selected-customer highlight fill/stroke, popup (color + "Overflow" label), and tooltip ("Overflow" label). A single overflow customer shows the overflow color on its lane AND its highlight AND "Overflow" (not "Band N") in both popup and tooltip.

## 3. Requirement #2 — Plants on the JADE Output Map

**Behavior**
- Render plants as a distinct marker kind (reuse the input-map plant square symbol). Warehouses + customers keep their markers.
- `plant_to_warehouse` lanes must terminate at the now-visible plant markers (route endpoint lookup already resolves plant ids via the folded `warehouses` array — keep that; just stop hiding the plant markers).
- Fit map bounds to the **union of all rendered marker coords** (plants+warehouses+customers) — OQ-1.
- Preserve marker layer toggles (Warehouses/Customers) + per-leg layer toggles; add a Plants layer toggle.

**Approach (reconciles review P2-5):** Pass plants to `NetworkMap` as a **separate `plants` prop**, NOT a `kind: "plant"` variant. The generated `WarehouseCandidateKind` permits only `mine | facility`, so `kind: "plant"` would force an OpenAPI + client-codegen change for no benefit; a dedicated prop preserves plants' first-class entity semantics and is codegen-free. `NetworkMap` renders plant markers (input-map square symbol) from `plants`, never subject to `hideClosedWarehouses`. Legend gains a "Plant" entry when `plants` is non-empty.

**Effective plants incl. scenario-added (reconciles review R2-4):** scenario-local `addedPlants` live only in `displayedInputs`, so the marker set must be `effectivePlants = dataset.plants ∪ displayedInputs.addedPlants`. INT passes `effectivePlants` (not just `dataset.plants`) to the output map. Inbound (`plant_to_warehouse`) route endpoints resolve `fromId` against `effectivePlants` (authoritative for plant markers + endpoints); the existing warehouse-fold (`jadePlantsAsWarehouseCandidates`) remains **only** as a compatibility lookup, not the marker source. Test: an added plant renders a marker AND its plant→warehouse route draws.

**Bounds constraint (reconciles review P2-6):** `NetworkMap` currently assigns manifest `countryBounds` to `MapContainer.maxBounds` with `maxBoundsViscosity={1.0}` and keys the map on those bounds — so a wider `fitBounds` union would be clamped straight back. The rendered-marker union must therefore drive **all three**: `maxBounds`, the `FitBounds` target, AND the map remount key. (Alternatively relax/remove `maxBounds` for the JADE output map.) Chosen: union drives `maxBounds`/center/`FitBounds`/`mapKey`.

**Files:** `NetworkMap.tsx` (separate `plants` prop + marker branch + union bounds→maxBounds/FitBounds/mapKey), `OutputMapTab.tsx` (pass plants, plant layer toggle), `MapLegend.tsx` (plant swatch), `Workspace.tsx` (INT — pass `effectivePlants = dataset.plants ∪ displayedInputs.addedPlants` to the JADE output map at `:2927-3035`).

**Tests:** plant markers render on JADE output map; plant→warehouse polylines connect to plant coords; bounds include plants; toggles hide/show plant layer.

## 4. Requirement #3 — Three weighted-average distances

**Behavior** — display, flow-weighted, unit-labelled:
1. Plant → Warehouse weighted average — `metrics.avgDistanceByLeg` entry `leg==="plant_to_warehouse"`.
2. Warehouse → Customer weighted average — `avgDistanceByLeg` entry `leg==="warehouse_to_customer"`.
3. Overall weighted average across both legs — `metrics.weightedAvgDistance`.

All already computed in `solve.py:1167-1174`; frontend-only display. Location: the Output Map floating overlay card (`OutputMapTab.tsx:306-321`) shows all three labelled lines for JADE (single overall line for other models). Each labelled with `distanceUnit` (JADE "mi").

**Files:** `OutputMapTab.tsx`. **Tests:** RTL asserts three labelled values from a JADE result envelope; single value for a non-two-echelon model.

## 5. Requirement #4 — Output report restructure

**JADE-only, no regression to shared tabs (reconciles review R2-1).** `AssignmentsTab` and `FlowsTab` are **shared** (transport-coal, Chapter 10) and have no `modelId` prop. Do NOT rewrite them in place. Instead add **separate JADE-only components** `JadeAssignmentsTab.tsx` + `JadeFlowsTab.tsx` (precedent: `JadeDistancesTab`), wired only on the JADE render branches in `Workspace.tsx` (`:3096`, `:3123`). The existing `AssignmentsTab`/`FlowsTab` and their CSV contracts stay byte-identical for every other model. Backend export likewise **branches on the scenario's `modelId`** — JADE gets the new columns/schema below; all other models keep their current `assignments`/`flows` export unchanged.

**Solved-snapshot data contract (reconciles review P1-2).** All three restructured tables read the DISPLAYED solve, never the editable `localInputs` draft:
- Geometry/identity from `displayedResult` (`details.assignments`, `edges`) + `displayedInputs` (the snapshot that produced it).
- The "Distance Band" column uses the live `presentationBands` (§2), same source as the map, so labels match colors. Distance itself comes from the snapshot result.
- Product id→name and warehouse/customer id→display lookups come from `dataset` (`products`, `warehouses`, `customers`) + `displayedInputs` added entities.
- These are new component props wired by **INT** in `Workspace.tsx` (added to the §5 file list) — the tabs take them as optional props (safe defaults) so they compile standalone.

### 5a. Customer Assignments (product-level)
Columns, in order: **Product · Customer · Assigned Warehouse · Distance · Distance Band**. No Demand, no Flow.
- Source: `displayedResult.details.assignments` (`{customerId, warehouseId, productId, distanceMi}`) — one row per (product, customer).
- Product/Customer/Warehouse rendered by display name (product name via `dataset.products` id→name; customer/warehouse city/state where available); Distance `.toFixed(1) {unit}`; Distance Band via `bandLabel(distanceMi, presentationBands)` ("Band N" / "Overflow").
- New `JadeAssignmentsTab.tsx`; the shared `AssignmentsTab.tsx` (`:72-138`) is left untouched for other models.

### 5b. Flows — two inner tabs
Keep one "Flows" tab; add two inner tabs (segmented control).

**Plant → Warehouse** — aggregate all products per (plant, warehouse) pair:
Columns: **Plant · Warehouse · Distance · Flow · Distance Band**. No Product, no Transport Cost.
- Source: inbound `edges` (`leg==="plant_to_warehouse"`), summed `flow` over `productId` per `(fromId, toId)`. Distance = the pair distance (identical across products).

**Warehouse → Customer**:
Columns: **Warehouse · Customer · Distance · Flows · Distance Band**. Column label exactly `Flows` (replaces any "Total flow"/"Summarized demand"/"Flow" wording).
- Source: outbound `edges` (`leg==="warehouse_to_customer"`), one row per customer (already aggregated in the envelope).

### 5c. Export alignment

**`entity=assignments`** (backend) → product-level, matching 5a: headers `product,customer,assigned_warehouse,distance,distance_band` (no demand/flow), one row per (product, customer) from `details.assignments`.

**`entity=flows`** (backend) — canonical **combined** schema (reconciles review P1-3). One file, both legs, using a neutral union schema so it unambiguously matches both on-screen inner tables:

```
leg,from_id,to_id,distance,distance_band,flows
```

- Inbound rows (`leg=plant_to_warehouse`): one row per (plant, warehouse) pair, `flows` = inbound flow **aggregated across products** (matches 5b P→W). `from_id`=plant, `to_id`=warehouse.
- Outbound rows (`leg=warehouse_to_customer`): one row per (warehouse, customer), `flows` = the customer's total flow (matches 5b W→C). `from_id`=warehouse, `to_id`=customer.
- `distance_band` derived from the **current saved `scenario.inputs.distanceBands`** (reconciles review R3-4). Under Option C there is no persisted solved-band snapshot — a bands-only save overwrites `inputs.distanceBands` without a new result — so the only server-side band source is the current saved value. The export therefore reflects the last **saved** bands; it diverges only from **unsaved** UI edits (a downloaded file is a static artifact of saved state). Thread `scenario.inputs.distanceBands` explicitly into the JADE export builder. Test: export after a non-staling bands-only save reflects the new bands.
- Backend `bandLabel` equivalent lives server-side (small pure helper mirroring the TS `bandLabel`; document the shared semantics).

**Client-side per-leg CSV (OQ-2):** each Flows inner tab's own "Download" button produces a client-side CSV of just that leg's on-screen columns (5b), independent of the combined backend `entity=flows` file above.

**Files:** new `JadeAssignmentsTab.tsx`, new `JadeFlowsTab.tsx` (two inner tabs + per-leg client CSV) — shared `AssignmentsTab.tsx`/`FlowsTab.tsx` untouched; `Workspace.tsx` (INT — JADE render branches + snapshot props); backend export builder (`services/templates.ts` or equivalent, **branched on `modelId`**); `openapi.yaml` (entity `enum` unchanged; doc text for the JADE combined schema). **Tests:** RTL per JADE table (exact columns/labels, product-level rows, aggregated P→W rows, `Flows` label) + a test asserting other models' `AssignmentsTab`/`FlowsTab` output is unchanged; backend export tests for the JADE branch + a non-JADE regression.

## 6. Requirement #5 — Plant Production section in Service Stats

Add a "Plant Production" section to `ServiceStatsTab.tsx` (JADE only) with columns:
**Plant · Product · Actual production · Enabled capacity · Remaining capacity** (remaining only where capacity applies, i.e. enabled cells).
- **Row set: the FULL effective `plants × products` grid, left-joined to aggregated inbound production** (reconciles review P1-2). Enumerate every (effective plant, product) combination; left-join the actual-production aggregate; a combination with no inbound flow shows Actual `0`, and disabled combinations stay visible with capacity `0`. No combination is dropped for being zero/disabled.
- Effective plants/products/base capabilities + `plantProductCapability` overrides come from `displayedInputs` (snapshot) + `dataset`, NOT `localInputs` — same snapshot contract as §5. Passed as props by INT.
- Actual production: sum of inbound `displayedResult.edges` (`plant_to_warehouse`) `flow` grouped by `(fromId=plant, productId)`.
- Enabled capacity + enabled/disabled via the A2 shared helper (`cellCapacity`/`isCellEnabled`): enabled → `210,000,000` (or the base cell's own capacity), disabled → `0`.
- Remaining: `enabledCapacity - actual` for enabled cells; "—" for disabled cells.
- Numbers `.toLocaleString()`.

**JADE-gated, shared tab preserved.** `ServiceStatsTab` is shared; the Plant Production section is gated on `supportsPlantProductCapability` (JADE only), and the band-coverage bars recompute from `presentationBands` over `warehouse_to_customer` edges only (§2 R2-3) — for JADE. Non-JADE models keep their current ServiceStats behavior (their own recompute/edge set) unchanged.

**Files:** `ServiceStatsTab.tsx` (JADE-gated Plant Production section + JADE coverage recompute; optional snapshot props: effective plants, products, base capabilities, capability overrides, edges, `presentationBands`), shared capability helper `lib/jadeCapability.ts` (A2), `Workspace.tsx` (INT — wire the snapshot props from `displayedInputs`/`dataset`/`displayedResult` + `presentationBands`). **Tests:** RTL asserts the full-grid left-join (zero-production + disabled combos visible), production/capacity/remaining math, JADE coverage recompute over W→C edges only with an edited boundary, and non-JADE ServiceStats unchanged.

## 7. Requirement #6 — Capacity in the Capability Matrix (read-only)

`CapabilityMatrixTab.tsx`: each plant-product cell shows the checkbox (unchanged enable/disable control) **plus** a read-only capacity value below/beside it: enabled→`210,000,000`, disabled→`0` (`.toLocaleString()`). No numeric editing.
- Section/column label states this is **capacity per plant-product combination**, not total plant capacity.
- Enabled value (reconciles review R3-3): base capacity when the base cell has `capacity>0`, otherwise `210_000_000` (the `JADE_ENABLED_CAPACITY` constant) for **any** enabled cell — including a **base plant's initially-disabled off-diagonal cell** that the scenario enables, not only added-plant cells. This matches `merge_inputs.py:869` (`enabled → 210_000_000` regardless of base). Single named constant, no scattered literal. Test: enable a base off-diagonal cell → both the Capability Matrix and Plant Production show `210,000,000`.

**Files:** `CapabilityMatrixTab.tsx`. **Tests:** RTL asserts `210,000,000` on checked cells, `0` on unchecked, value flips live when the checkbox toggles.

## 8. Requirement #7 — Do not expose 10M as warehouse capacity (audit + hide)

- Warehouses stay uncapacitated. Confirm no JADE UI surface renders a warehouse-capacity field or a `10,000,000` value.
- Audit: `WarehouseTable`/`WarehousesTab` (capacity column gated on `capacityMode` — JADE `capacityModes:[]` → already hidden; verify), `OpenWarehousesTab` (utilization column — verify it is hidden or not derived from a phantom 10M capacity for JADE), `CreateEntityDialog` (capacity field gated — verify JADE), any "Utilization" reading `utilizationByNode`.
- 10M remains solely the Big-M linking constant in `solve.py` (untouched per D1).

**Files:** verification across the above; hide any leak found (UI-only). **Tests:** RTL asserts no warehouse-capacity control and no `10,000,000` string on JADE warehouse/open-warehouse surfaces.

## 9. Requirement #8 — Running solve clock

- A live elapsed clock, started when solve is requested (enqueue).
- Distinguish **queued** time from **active solving** time using `queuedAt`→`startedAt` (queue wait) and `startedAt`→now (active), from the polled GET solve-job response.
- Stop on success / infeasible / failed; show final total. (No cancel mechanism added — OQ-3.)
- No upper/lower-bound graph work.

**Approach.** Live clock during `queued`/`running`: `SolveDialog.tsx` shows an elapsed display driven by a 1s tick (or the existing 800ms poll), computing `now - queuedAt`, and once `startedAt` is present splitting into "Queued Xs · Solving Ys". Reads timestamps already in the poll response (`Workspace.tsx:2304-2335`).

**Terminal-time visibility (reconciles review R2-6 / P2-7).** On job `succeeded` the dialog auto-closes and the Output Map opens (`Workspace.tsx:2317-2321`) — and **an infeasible result also arrives as a `succeeded` job** (solver never throws; envelope `status:"infeasible"`, not `"error"`). So a frozen total shown only inside the dialog would vanish. Resolution:
- **One concrete Workspace surface: the Output Map overlay card** (`OutputMapTab.tsx:306-321`, the same card that shows the avg-distance lines in §4). `ObjectiveBar` is **legacy `Studio.tsx`-only** — not rendered by Workspace — so it is NOT used here.
- The frozen total (+ queued/active split) is **stored on the matching `ResultHistoryEntry`** (alongside `{result, inputs}`), so stepping the result-history stepper shows each entry's own timing, never a single retained "last job" time bleeding onto an older displayed result. When the displayed entry has no matching timing, the timing line is **suppressed** (shows nothing) rather than a mismatched value.
- **After page reload:** result-history is session-local (not persisted, per the existing Studio/Workspace stepper), so timing is session-local too — after reload the displayed result has no in-session timing → the timing line is suppressed. (No persisted timing surface this bundle.)
- On job `failed` the dialog stays open with the error and shows the frozen total in-dialog.
- The clock freezes when the job reaches a terminal state (`succeeded`/`failed`), independent of the envelope's optimal/infeasible status.

**Files:** `SolveDialog.tsx` (live clock + failed-state frozen total), `OutputMapTab.tsx` (persistent frozen total on the overlay card, from the displayed entry's timing), `Workspace.tsx` (INT — thread `queuedAt`/`startedAt`/`finishedAt`/`status` from the poll query; store timing onto the `ResultHistoryEntry`; pass the displayed entry's timing to `OutputMapTab`), small `lib/useElapsed.ts` hook. **Tests:** RTL with faked timers asserts queued-vs-active split, freeze-on-terminal, the overlay total surviving dialog auto-close on success (incl. an infeasible-but-succeeded job), and timing suppressed when stepping to an entry with no matching timing.

## 10. Requirement #9 — Filter Menu (JADE-first, type-aware)

**Reusable primitives**
- `components/tables/FilterMenu.tsx` — a per-column filter popover/menu.
- `lib/useTableFilters.ts` (or a hook) — holds filter state, derives filtered rows, exposes filtered/total counts and a clear-all.
- Column filter descriptors: `{ key, label, type: "text" | "select" | "number" }`.
  - `text` → case-insensitive contains.
  - `select` → multi-select of the column's distinct values (checkbox list).
  - `number` → min/max range.

**Behavior**
- A table renders the FilterMenu only when its **unfiltered rendered-ROW count** `> 10`; hidden at ≤10. (Row count, not cell count — the Capability Matrix's 16 *cells* render as 4 plant *rows*, so it stays below threshold unless added plants push rendered rows past 10.)
- Filters appropriate to each column's type (D3).
- Clear-all + per-filter clear.
- Show filtered row count vs total (e.g. "37 of 210").
- Preserve existing pagination, sorting, editing. Filtering happens before pagination; page resets to 1 on filter change (mirror DistancesTab's focus/filter interaction to avoid the reset race).
- Consistent styling (book-cover design system, `.scn-theme` scope) across every JADE table it's wired to.

**Opt-in gate on shared components (reconciles review R2-5).** `CustomersTab`, `WarehousesTab`, `OpenWarehousesTab`, `ImportDialog` (and any shared table) are used by other models too. FilterMenu must not leak into them (D2 is JADE-first). Add an opt-in `enableFilters?: boolean` (default `false`) prop, supplied `true` only by the JADE Workspace path. When `false`, zero behavior change for other models. The JADE-only components (`JadeAssignmentsTab`, `JadeFlowsTab`, `JadeDistancesTab`, `PlantsTab`, `CapabilityMatrixTab`, the Plant Production table) wire FilterMenu directly (no gate needed — they only render for JADE). The `>10 rendered-row` visibility rule applies at runtime inside each, so Plants (4) and Capability Matrix (4 rows) show no menu until added plants push them past 10.
- **Import preview:** the Errors grid and the Changes grid are **separate tables** for the threshold — each independently shows/hides its own FilterMenu by its own unfiltered row count.

**JADE tables — FilterMenu wired, shown at runtime when unfiltered rendered rows >10:** Customer Assignments (product-level), Flows P→W and W→C, Service Stats Plant Production (16), Warehouses input (25 base rows), Open Warehouses, Customers input, Distances/`JadeDistancesTab` (migrate its From/To free-text to the shared FilterMenu; JADE-only component, does not touch shared `DistancesTab`), import-preview (Errors + Changes counted separately). **`PlantsTab` and `CapabilityMatrixTab` are also wired** with the same runtime rule — they render 4 rows today (menu hidden) but cross the threshold once a scenario adds enough plants, so they must be wired, not excluded (reconciles review R3-5). No comparison/history table exists (OQ-4).

**Files:** new `FilterMenu.tsx` + hook; wire into the JADE output/input/distance/import tabs. **Tests:** unit for the hook (each filter type, distinct-value derivation, count); RTL for menu hidden ≤10 / shown >10, type-aware controls, clear, count display, pagination preserved.

## 11. Cross-cutting: distance-band column helper

#4a/#4b/#5 all show a "Distance Band" column. Provide one shared formatter: `bandLabel(distance, bands)` → "Band N" (1-indexed) or "Overflow", built on `assignBandOrOverflow` so it matches map colors exactly. Lives in `lib/bands.ts`.

## 12. Out of scope — tracked follow-ups

- **FOLLOW-UP (approver-accepted, NOT built this bundle): non-JADE ServiceStats coverage bars live-recompute.** This bundle makes non-JADE map **lanes** recolor live (#1) but leaves non-JADE **coverage bars** reading frozen `metrics.bandCoverage`. Switching every model's coverage bars to a client-side live recompute from edited bands is a larger all-model `ServiceStatsTab` change (needs a per-model service-leg edge-selection contract: single-echelon = all assignment edges; `two-echelon-gold-au` = `refinery_to_customer`; `transport-coal` = flows; JADE already done here = `warehouse_to_customer`). Kept in scope as a **separate future bundle**, not this one. Design deferred until picked up.
- Fast-follow of FilterMenu to `p-median-us` / `transport-coal` / `two-echelon-gold-au` / `p-median-brazil` (later bundle, per D2).
- Any `solve.py` / formulation / Big-M change (D1).
- Upper/lower-bound solve-progress graph (#8 explicitly excludes).
- Solve cancellation *mechanism* if one doesn't already exist — the clock only needs to stop on a cancel signal that already exists; adding cancel is out of scope unless trivial (OQ-3).

## 13. Open questions — RESOLVED

- **OQ-1 (#2 bounds): RESOLVED — fit to all rendered markers.** The JADE Output Map fits bounds to the union of plant+warehouse+customer coords so every plant is visible, regardless of manifest `countryBounds`.
- **OQ-2 (#4c export): RESOLVED — client-side per-leg CSV.** Each Flows inner tab's Download produces a client-side CSV of that leg only. Backend `entity=flows` export stays "both legs" (no `&leg=` param). Backend export column alignment (§5c) still applies to the `assignments` (product-level) and `flows` (both legs) entities so a full download matches the on-screen contract.
- **OQ-3 (#8 cancel): RESOLVED — no cancel mechanism added.** The clock stops on success / infeasible / failed. No solve-cancel path is added this bundle; if a cancel signal already exists the clock also stops on it, otherwise "cancelled" is not a reachable terminal state.
- **OQ-4 (#9 comparison/history): RESOLVED — skip.** No comparison/history *table* exists (Compare page + Reports tab removed in Phase 3.2). The result-history stepper is not a >10-row table. FilterMenu targets the real data tables only: Customer Assignments, Flows (both inner tabs), Service Stats Plant Production, Open Warehouses, Customers input, Distances, import-preview.

## 14. Test/gate requirements

- Full gate: typecheck, api-server vitest, studio vitest, solver pytest (only if Python touched — expected **not** touched), `e2e_accuracy.py` (only if dataset/solver touched — expected not).
- **Cross-model regression QA scope (approver decision):** browser QA on **JADE + one representative non-JADE (`p-median-us`)** for the all-model #1 changes (live band recolor + no-stale-on-bands-save); the shared band logic is additionally covered by cross-model unit/RTL tests. The other three models (`p-median-brazil`/`transport-coal`/`two-echelon-gold-au`) rely on the shared-logic unit/RTL coverage, not a dedicated browser pass (small accepted residual risk).
- QA task (real-browser Playwright, per standing feedback) covering: band overflow color on the JADE map, live band edit reclassifies without a solve, plant markers + connected lanes + union-bounds fit, three avg-distance lines, restructured Customer Assignments / Flows inner tabs (reading the snapshot), Plant Production full-grid section, capacity in Capability Matrix, no 10M warehouse-capacity leak, running clock queued/active split + **persistent frozen total after the dialog auto-closes on success**, FilterMenu on a >10-row JADE table incl. **Warehouses input** (type-aware + count + clear).

## 15. Review comments (Codex, 2026-09-17)

The JADE-only FilterMenu scope in D2 is deliberate and accepted. The following issues should be resolved before converting this design into an implementation plan.

1. **[P1] Reconcile live distance-band editing with the solved-input snapshot invariant.** Section 2 says editing bands reclassifies lanes immediately without a solve, but `Workspace.tsx:1492-1501` deliberately makes every output surface read `displayedInputs` and says an edited band does not recolor an existing result until a fresh solve. Choose and document one behavior. If live reclassification is required, define separate presentation-band state that can change without replacing or invalidating the inputs snapshot that produced the displayed result; otherwise remove the immediate-reclassification behavior and its zero-network-call regression test.

2. **[P1] Define the solved-snapshot data contract for the restructured reports.** Customer Assignments and both Flows tables need the displayed solve's `distanceBands`; Customer Assignments also needs the product id-to-name lookup. Plant Production needs effective plants, products, base capabilities, and `plantProductCapability` overrides from `displayedInputs`. Add `Workspace.tsx` to the files in §§5-6 and specify the new component props. Output reports must not read the editable `localInputs` draft. Also state that Plant Production enumerates the full effective `plants × products` set and left-joins aggregated inbound production, so zero-production and disabled combinations remain visible.

3. **[P1] Define the combined backend Flows CSV schema.** The two on-screen inner tables have different semantic endpoint columns and the Plant → Warehouse table aggregates across products, while OQ-2 retains one backend `entity=flows` export containing both legs. Specify exact headers, row semantics, and aggregation for that combined file—for example, a neutral schema such as `leg,from_id,to_id,distance,distance_band,flows`, with inbound rows aggregated per plant-warehouse pair. Without a canonical combined schema, the backend export cannot unambiguously "match" both on-screen contracts.

4. **[P2] Include the JADE Warehouses input table in the runtime FilterMenu rule.** JADE has 25 base warehouse rows, so Warehouses exceeds the unfiltered `>10` threshold. Section 10 currently calls Warehouses "small" and excludes it. Capability Matrix has 16 cells but only four rendered plant rows, so it correctly remains below the row threshold unless added plants raise the rendered row count above 10.

5. **[P2] Resolve the plant-marker representation.** The recommended `kind: "plant"` approach is not valid under the current generated `WarehouseCandidateKind`, which permits only `mine | facility`. Select one implementation in this spec. Prefer passing `Dataset.plants` as a separate `NetworkMap` prop to preserve its first-class entity semantics; if `kind: "plant"` is retained, add the required OpenAPI and client-codegen changes to the file list and gates.

6. **[P2] Make marker-union bounds control the Leaflet constraint as well as fitting.** `NetworkMap` currently assigns manifest-derived bounds to `MapContainer.maxBounds`, uses `maxBoundsViscosity={1.0}`, and keys the map on those bounds. Calling `fitBounds` with a wider marker union will still be clamped. OQ-1 should require the rendered-marker union to drive `FitBounds`, `maxBounds`, and the map remount key, or explicitly relax/remove `maxBounds` for this view.

7. **[P2] Specify where the terminal solve time remains visible.** Section 9 requires the frozen final total to be shown, but `Workspace.tsx:2317-2321` closes the dialog immediately when a job succeeds; infeasible solver results also arrive through a successfully completed job. Keep a terminal summary visible until the user dismisses it, or move the final elapsed time to the resulting Output Map/summary surface.

## 16. Review responses (2026-09-17) — all 7 accepted, folded in

Every comment verified against code and accepted. Fixes folded into the normative sections (not appended as alternatives):

1. **P1-1 (live bands vs snapshot) — folded into §2 "Presentation-band state vs. the solved-input snapshot".** Introduces `presentationBands`: a display-only color/label lens (map, legend, coverage bars, every report Distance-Band column) that edits live without a solve and without touching the `displayedInputs` geometry snapshot. Confirmed the conflict at `Workspace.tsx:1487-1505`. Immediate-reclassification behavior + its zero-network-call test are retained under this decoupled state.
2. **P1-2 (report snapshot contract) — folded into §5 (new "Solved-snapshot data contract" preamble) + §6.** Reports read `displayedResult`/`displayedInputs`/`dataset`, never `localInputs`. Product id→name lookup specified. Plant Production enumerates the full effective `plants × products` grid, left-joined to inbound production, zero/disabled combos visible. `Workspace.tsx` (INT) added to both file lists with the new props.
3. **P1-3 (combined Flows CSV) — folded into §5c.** Canonical combined schema `leg,from_id,to_id,distance,distance_band,flows`; inbound aggregated per plant-warehouse pair, outbound per customer. Client-side per-leg CSV kept separate (OQ-2).
4. **P2-4 (Warehouses in filter scope) — folded into §10.** JADE Warehouses (25 rows) is in scope. Row-count (not cell-count) semantics documented; Capability Matrix (4 rows) correctly excluded.
5. **P2-5 (plant marker) — folded into §3 Approach.** Separate `plants` prop on `NetworkMap`, not `kind:"plant"` (generated `WarehouseCandidateKind` = `mine|facility` only — confirmed) — no OpenAPI/codegen change.
6. **P2-6 (bounds constraint) — folded into §3 "Bounds constraint".** The rendered-marker union drives `maxBounds` + `FitBounds` + `mapKey`, not just `fitBounds` (which `maxBoundsViscosity=1.0` would clamp).
7. **P2-7 (terminal time visibility) — folded into §9 "Terminal-time visibility".** Frozen total shown on a persistent surface (`ObjectiveBar`/Output-Map header) that survives the success auto-close; handles infeasible-but-succeeded jobs; dialog keeps the frozen total on `failed`.

## 17. Re-review comments (Codex, 2026-09-17)

The seven first-round comments are substantively addressed. The following integration and lifecycle issues remain before implementation planning.

1. **[P1] Preserve non-JADE report and export behavior.** Section 5 replaces the shared `AssignmentsTab`, `FlowsTab`, and backend export schemas without defining a JADE-only activation branch. These components currently serve other models; for example, `FlowsTab` supports transport-coal and Chapter 10 and has no `modelId` prop. Require an explicit JADE branch while retaining the current legacy tables and CSV contracts for every other model. Backend builders must likewise branch by the scenario's model rather than globally replacing the existing assignment/flow export schemas.

2. **[P1] Make live presentation bands survive saving without forcing a re-solve.** Section 2 treats whether a band edit marks the scenario dirty as orthogonal, but saving any input change currently makes the scenario stale, after which `Workspace.tsx:2927-2935` replaces the output with `StaleOutputBanner`. A local `presentationBands` state therefore supports only unsaved edits. Define a persistence path that does not stale the geometric solution—for example, store presentation bands outside optimization inputs or explicitly classify a distance-band-only save as non-geometric—and test edit → save → reopen output without solving.

3. **[P1] Define live band-coverage recomputation and its JADE edge set.** Section 2 says the Service Stats band-coverage bars read `presentationBands`, but `ServiceStatsTab` currently reads frozen `result.metrics.bandCoverage`, and the replacement calculation is not specified. For JADE, recompute cumulative coverage from `warehouse_to_customer` edges only; including `plant_to_warehouse` edges would mix the two legs and double-count throughput. Specify the helper, cumulative and overflow semantics, and regression tests for edited boundaries.

4. **[P1] Include scenario-added plants in the output-map plant contract.** Section 3 passes `Dataset.plants` separately while retaining the folded warehouse endpoint lookup. Scenario-local `addedPlants` exist only in `displayedInputs`, so passing only `Dataset.plants` omits their markers. Define `effectivePlants = dataset.plants ∪ displayedInputs.addedPlants`, pass that collection to the output map, and either resolve inbound route endpoints directly against it or state that the warehouse fold remains strictly as a lookup compatibility layer. Add a test for an added plant marker and its plant→warehouse route.

5. **[P1] Apply the runtime FilterMenu rule to every JADE table that can cross ten rows, with an explicit JADE gate on shared components.** Section 10 declares a runtime rendered-row threshold but excludes Plants and Capability Matrix based on their four base rows; added plants can push both above ten. Wire filtering into every JADE table capable of crossing the threshold and hide the control while its current unfiltered count is ≤10. Because `AssignmentsTab`, `FlowsTab`, `CustomersTab`, `WarehousesTab`, `OpenWarehousesTab`, and `ImportDialog` are shared, define an opt-in `enableFilters`/capability prop supplied only by the JADE Workspace path so the deliberate D2 scope does not leak into other models. Treat the import Errors and Changes grids as separate tables for threshold purposes.

6. **[P2] Associate terminal timing with the displayed history result and choose one persistent surface.** A single retained "last terminal job" can remain visible while the result-history stepper shows an older result. Store timing with the matching `ResultHistoryEntry`, or suppress it whenever the displayed result lacks matching timing; also define behavior after page reload. `ObjectiveBar` is currently rendered by legacy `Studio.tsx`, not `Workspace.tsx`, so §9 must choose and locate one concrete Workspace surface instead of `ObjectiveBar`/Output-Map header alternatives. Correct the parenthetical in §9 as well: an infeasible solve returns envelope `status:"infeasible"`, not `status:"error"`.

## 18. Re-review responses (2026-09-17) — all 6 accepted, folded in

Every comment verified against code and accepted.

1. **R2-1 (no regression to shared tabs) — folded into §5.** `AssignmentsTab`/`FlowsTab` confirmed shared (no `modelId` prop; serve transport-coal/Ch10). New JADE-only `JadeAssignmentsTab`/`JadeFlowsTab` (precedent `JadeDistancesTab`); shared tabs + their CSV untouched. Backend export branches on `modelId`; non-JADE regression test added.
2. **R2-2 (persist bands without staling) — folded into §2; APPROVER chose Option C.** Confirmed a saved input change → stale → `StaleOutputBanner` (`:1355`,`:2927-2935`), and that `distanceBands` is one field, solver-reporting-only, non-geometric. Resolution: keep the single `distanceBands`; the color lens reads it live; a `distanceBands`-only save is classified non-geometric (persists, no stale, no re-solve). Small backend change to the staleness rule; no new column/field. `edit → save → reopen without solve` test required.
3. **R2-3 (live coverage recompute + JADE edge set) — folded into §2 + §6.** `ServiceStatsTab` recomputes via `computeCumulativeBandCoverage(edges, presentationBands)` (cumulative + `-1` overflow), JADE feeding `warehouse_to_customer` edges ONLY; edited-boundary regression test.
4. **R2-4 (added plants) — folded into §3.** `effectivePlants = dataset.plants ∪ displayedInputs.addedPlants` drives markers + inbound endpoints; warehouse-fold kept only as a compat lookup; added-plant marker+route test.
5. **R2-5 (opt-in filter gate) — folded into §10.** `enableFilters?: boolean` (default false) on the shared `CustomersTab`/`WarehousesTab`/`OpenWarehousesTab`/`ImportDialog`, true only on the JADE path; JADE-only components wire directly; runtime `>10` rule covers Plants/Capability Matrix once added plants cross 10; import Errors/Changes counted separately.
6. **R2-6 (terminal timing) — folded into §9.** Confirmed `ObjectiveBar` is Studio-only. One surface = the Output Map overlay card; timing stored per `ResultHistoryEntry`, suppressed when the displayed entry lacks matching timing; session-local (suppressed after reload). Parenthetical fixed to envelope `status:"infeasible"`.

**Scope note:** R2-2 (Option C) adds a small **backend** change — classify a `distanceBands`-only inputs save as non-geometric (no stale, no re-solve), scoped strictly to that one key. No schema/column change. The bundle is thus frontend + two bounded backend touches (this + the model-branched export in §5c).

## 19. Third review comments (Codex, 2026-09-17)

The six second-round comments are mostly addressed. The following correctness and contract issues remain before implementation planning.

1. **[P1] Make the JADE band editor obey the API's exactly-four invariant.** Section 2 now requires the existing editor to persist the single `distanceBands` field, but `OptimizationParametersTab` and `SolveDialog` expose add/remove controls while `jadeInputsSchema` requires exactly four strictly ascending positive integers. As written, a user can live-reclassify with three or five bands and then receive a 422 on Save. Specify either a JADE-specific editor that edits exactly four ordered values without add/remove controls, or an intentional schema relaxation. Add UI and PATCH tests for valid and invalid band counts.

2. **[P1] Resolve the non-JADE live-coverage contradiction and scope the non-geometric save rule consistently.** Section 2 says all band-coverage bars read live bands and says non-JADE models retain an "existing single-leg recompute," but the current Workspace `ServiceStatsTab` reads frozen `result.metrics.bandCoverage`; §6 separately says non-JADE behavior remains unchanged. Choose one contract. If live coverage is JADE-only, narrow the §2 statements and the distanceBands-only non-staling exception to JADE. If it applies to all models, define the service-leg edge selection and recomputation behavior for every multi-leg model and test each supported model.

3. **[P1] Use the standard enabled capacity for every enabled zero/missing-base cell, not only added plants.** Section 7 currently describes the `210,000,000` fallback as applying to added-plant cells. A base plant's initially disabled off-diagonal cell can also be enabled, and `merge_inputs.py` then assigns that pair `210_000_000`. The shared helper and Capability Matrix must use: positive base capacity when present; otherwise the standard `210,000,000` for any enabled cell, whether the plant is base or added. Add a test that enables a base off-diagonal cell and verifies both the matrix and Plant Production capacity.

4. **[P1] Define backend exports against the current saved band lens after an Option C save.** Section 5c says the backend derives `distance_band` from the solved snapshot's `distanceBands`, but Option C overwrites `scenario.inputs.distanceBands` without creating a new result, and no prior solved-input snapshot is persisted server-side. The old bands therefore cannot be recovered after a bands-only save. Define backend exports as using current saved `scenario.inputs.distanceBands` (with divergence only from unsaved UI edits), or add persisted solved-band metadata. Thread the chosen source explicitly into the JADE export builder and test export after a non-staling band save.

5. **[P2] Remove stale normative wording and complete the implementation file lists.** Section 3 requires `effectivePlants` but its Files paragraph still says to pass `dataset.plants`. Section 10 says Plants and Capability Matrix are runtime-wired, then labels them "Not in scope." Update those passages to the accepted contracts. Also add `artifacts/api-server/src/routes/scenarios.ts` and focused API tests to §2's Files/tests for the distanceBands-only staleness change; the current §2 file list contains only frontend files despite Option C's required backend mutation.

## 20. Third-review responses (2026-09-17) — all 5 accepted, folded in

Every comment verified against code and accepted.

1. **R3-1 (exactly-4 invariant) — folded into §2 "JADE band editor must honor the exactly-4 invariant".** Confirmed `jadeInputsSchema.distanceBands` is `.length(4)` and the current chip editor (`OptimizationParametersTab`/`SolveDialog`) allows add/remove → a 422 trap. JADE gets a fixed-4-slot editor (no add/remove) in both places; no schema relaxation; valid/invalid band-count tests.
2. **R3-2 (live-coverage contradiction + scope) — folded into §2 + §6. ⚠️ PARTIALLY SUPERSEDED by R5-1 (§22).** The live-lens + non-staling-save scoping to JADE was WRONG (D2's JADE-first is filters-only). Only the two-leg **coverage-bar recompute** stays JADE-only; the live lens + non-staling save are restored to **all models** — see §22.
3. **R3-3 (enabled-capacity fallback) — folded into §7.** Confirmed `merge_inputs.py:869` sets `210_000_000` for any enabled override. `210,000,000` applies to any enabled cell — base off-diagonal or added — not only added plants; test enables a base off-diagonal cell.
4. **R3-4 (export band source) — folded into §5c.** Confirmed no persisted solved-band snapshot under Option C. Backend export derives `distance_band` from the **current saved `scenario.inputs.distanceBands`**; diverges only from unsaved UI edits; threaded explicitly into the JADE export builder; test export after a non-staling bands-only save.
5. **R3-5 (stale wording + file lists) — folded into §3 Files, §10, §2 Files/tests.** §3 Files now says `effectivePlants`; §10 wires `PlantsTab`/`CapabilityMatrixTab` with the runtime rule (no "not in scope" contradiction); §2 Files/tests now include `artifacts/api-server/src/routes/scenarios.ts` + focused api-server staleness tests.

## 21. Fourth-review response (2026-09-17) — accepted, folded in

**R4-1 (bands-only save undone by history navigation) — folded into §2.** Confirmed at `Workspace.tsx:1437-1444` (new entry only on a changed `.result` reference) and `:1454-1470` (step restores `entry.inputs` into `localInputs`/`savedInputsRef`): a bands-only save leaves the displayed history entry's `inputs.distanceBands` stale, and stepping away/back reverts it. Resolution: on a successful bands-only save, INT updates the displayed entry in place (`resultHistoryState.items[index].inputs.distanceBands`). Required test: edit bands → save → step away → step back → bands preserved. (All models.)

## 22. Fifth-review response (2026-09-17) — accepted, scope corrected

**R5-1 (spec silently narrowed edited-band behavior to JADE) — folded into §2.** Correct: D2's JADE-first is for **filters (#9)**; requirement **#1 is all-models** with cross-model edited-band regression in its DoD. Confirmed the actual gap: `Workspace.tsx:3007-3010` feeds the Output Map `bands` prop from `displayedInputs` for **every** model (T4's snapshot behavior), so live band recolor is unmet everywhere, not just JADE. Resolution, **restored to all models**: the live band recolor (switch the `bands` feed to `localInputs`, overriding T4 for the color lens), the `distanceBands`-only non-staling save (backend, not `modelId`-gated), the history-entry sync, and the overflow/palette fix — all with cross-model tests. **Only** the JADE two-leg **coverage-bar recompute** in `ServiceStatsTab` stays JADE-specific (it selects `warehouse_to_customer` edges from JADE's two-leg set; #1 governs lanes, not coverage bars) — non-JADE coverage bars keep reading frozen `metrics.bandCoverage`. Flagged for the approver: making non-JADE coverage bars also live-recompute is a larger all-model ServiceStats change, not assumed here. **APPROVER DECISION: accepted as a tracked follow-up (separate future bundle), NOT built this bundle — recorded in §12.**

## 23. Sixth-review response (2026-09-17) — accepted, folded in

**R6-1 (fixed-4 editor still permits invalid values) — folded into §2.** Correct: four slots stop 3/5-band counts but not zero/negative, duplicate, or non-ascending values, which `jadeInputsSchema` (positive + strictly-ascending) still 422s. The JADE fixed-4 editor must enforce the **full** invariant client-side — inline errors + **disabled Save** on any invalid value — with UI tests for all three invalid cases (zero/negative, duplicate, descending), a valid set enabling Save, and the API still rejecting a hand-crafted invalid body.

## 24. Seventh-review response (2026-09-17) — accepted, folded in

**R7-1 (overflow must cover all map band surfaces) — folded into §2.** Confirmed four `assignBand` classification sites in `NetworkMap` — lane (`:495`), selected-customer popup (`:391`→`:175` color/`:192` label), customer highlight fill/stroke (`:535`), tooltip label (`:580`) — plus hand-rolled `Band ${x+1}` labels. Changing only `:495` would recolor an overflow lane while its highlight stays last-band and its popup/tooltip read "Band N". Resolution: **every** site switches to `assignBandOrOverflow` + `getBandColor` (overflow color for `-1`) + the shared `bandLabel` ("Overflow" for the sentinel); regression asserts a single overflow customer is consistent across lane, highlight, popup, and tooltip.
