# Workspace fixups bundle — Design Spec

**Date:** 2026-09-19 · **Base:** `main` (`9f72add`) · **Status:** awaiting approval (plan NOT written until approved).
**Execution:** agent-team, frontend-heavy. Distance-band, plant, and table-UX polish across the tabbed Workspace.

## 0. Scope — 5 items (approver-confirmed decisions in **bold**)

1. Plant map icon → green factory. **Marker + legend (shared source).**
2. Plant IDs in tables accompanied by City, State.
3. Capability Matrix info line single-line; the 210,000,000 readout suffixed `Units`.
4. Added warehouses/customers (and every added-entity type) move OUT of the inline
   below-base-table section INTO a dedicated tab with inner sub-tabs, like the Flows tab.
   **All models, all added-entity types.**
5. Distance-Band filters show the band *range* (unit-aware) instead of "Band N".
   **Live (updates immediately on band edit); all Distance-Band filters.**

Frontend-only. **No backend / solver / dataset / OpenAPI change.** `e2e_accuracy.py` not run.

---

## 1. Item 1 — plant factory icon (marker + legend)

**Current:** `EntityMarkers.plantSquareSvg()` (`artifacts/studio/src/components/workspace/map/EntityMarkers.tsx:34`)
returns an empty square:
```
<svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="none" stroke="var(--map-warehouse)" stroke-width="2"/></svg>
```
It is the **single source** consumed by (a) Input-map markers (`EntityMarkers.plantIcon`),
(b) Output-map markers (`NetworkMap.createPlantIcon`, line 150 — already reuses `plantSquareSvg`
"so it can never visually drift from the Input Map's own plant icon"), and (c) the legend
(`MapLegend.tsx` imports `plantSquareSvg`).

**Change:** replace the `plantSquareSvg()` body with a filled green factory silhouette matching the
supplied icon (a factory with a saw-tooth roofline + 3 windows), e.g. `fill="var(--map-plant)"` with
a **new** `--map-plant` token = the factory green (add to `index.css`; do NOT reuse `--map-warehouse`
so plants read distinctly). Keep the `20×20` / `viewBox 0 0 24 24` envelope so marker sizing, bounds,
and legend swatch geometry are unchanged. Single edit propagates to all three consumers — zero drift.

**DoD:** Input-map plant markers, Output-map plant markers, and the legend "Plant" swatch all render
the factory; no other marker changes; `plantSquareSvg` remains the only definition.

---

## 2. Item 2 — plant IDs + City, State in tables

**Plant type** (`Dataset.plants[]`, generated `api.ts:55`): `{ id, name?, city (req), state (req), lat, lng }`.

**Current gap:** table plant cells show `name ?? city/state ?? id` via `displayLabel` — a plant WITH a
`name` shows ONLY the name (no id, no city/state). Sites affected:
- `JadeFlowsTab.tsx` P→W inner tab — Plant column (`plantLabel`, line 88/158).
- `ServiceStatsTab.tsx` Plant Production — `plantLabel: plant.name ?? plant.id` (line 106) — no city/state at all.
- `CapabilityMatrixTab.tsx` — one row per plant (verify the row header cell; apply same helper).

**Change:** one shared helper `plantIdCityState(plant): string` (co-locate in `lib/formatLocation.ts`
next to `formatCityState`) returning **`"<id> — <City>, <State>"`** (id explicit per the request;
`formatCityState(city, state)` for the suffix). Use it at all three sites for the plant identifier cell.
`name` is not shown (the request is IDs + location); if a reviewer wants the name too, that is a
one-line format tweak — flag, do not silently add.

**DoD:** every table cell that identifies a plant shows its id followed by City, State; a plant with a
`name` still shows id + City, State (name no longer masks them).

---

## 3. Item 3 — Capability Matrix info line + `Units` suffix

**Two parts** in `CapabilityMatrixTab.tsx`:
- **(a) single line:** the info `<p>` (line 127) has `max-w-md` → wraps to 2 lines. Change to keep it
  on one line (`whitespace-nowrap`, drop `max-w-md`; the row already `flex-wrap`s so a narrow viewport
  degrades gracefully). Text unchanged.
- **(b) `Units` suffix:** the per-cell capacity readout (rendered from `cellCapacity(...)`, ~line 170)
  shows `210,000,000` (and other values) with no unit. Append `" Units"` → `210,000,000 Units`.
  Applies to the readout under every checkbox (enabled → the capacity value; disabled → `0 Units`).

**DoD:** info line renders on one line at normal width; every capacity readout ends in ` Units`.

---

## 4. Item 4 — Added-entities dedicated tab (all models, all types)

**Current:** each base input tab renders an inline "Added …" section **beneath** its base table
(`addedSection` in `WarehousesTab.tsx:336/518/535`, and equivalently in
`CustomersTab.tsx`, `MinesTab.tsx`, `StationsTab.tsx`, `PlantsTab.tsx`). The section holds the add-row
form + the added-rows table + per-row precheck chips + delete. It is capability-gated by
`onAdded*Change != null` (Workspace passes the callback only for models that support that added type).

**Change — relocate, don't rewrite:** add a `showAddedSection?: boolean` (default `true`) and a
symmetric `showBaseTable?: boolean` (default `true`) to each base tab. The base tabs keep ALL existing
add-row logic; they just conditionally render the two halves.
- **Base tab call sites** (renderTabContent) pass `showAddedSection={false}` → base table only.
- **New `AddedEntitiesTab.tsx`** (one component) renders inner sub-tabs — one per added-entity type the
  model supports — each sub-tab body being the corresponding base `*Tab` rendered with
  `showBaseTable={false}` (added section only). Inner-tab pattern mirrors `JadeFlowsTab`'s
  `innerTab` state exactly (segmented control, same styling).
- **Sub-tab sets per model** (only types with a wired `onAdded*Change`):
  - `p-median-us` / `p-median-brazil`: Warehouses, Customers
  - `transport-coal`: Mines, Stations
  - `two-echelon-gold-au`: Refineries, Customers
  - `two-echelon-jade-us`: Plants, Warehouses, Customers
  - `chens-cosmetics-cn`: Warehouses, Customers
- **Sidebar:** new input entry `{ id: "added-entities", label: "Added Entities" }` appended to every
  model's `inputEntriesForModel(...)` list (after the last entity tab, before Optimization Parameters).
- **renderTabContent:** new branch `activeTab.entity === "added-entities"` → `<AddedEntitiesTab …>`
  wiring each inner sub-tab to the SAME props (`addedWarehouses`/`onAddedWarehousesChange`/…,
  precheck errors, `hasStateData`, etc.) the base tabs get today.
- **Save gate:** the `added-entities` entity joins the save-eligible set (it is an inputs editor); the
  existing dirty-tracking on `localInputs` already covers added arrays — just ensure the tab is not
  excluded by the save-gate allowlist (`Workspace.tsx:1811+`).
- **Input-Map prefill reconciliation:** today Input-Map "Confirm → place entity" calls
  `openTab("input", {id: <entity>})` and shoots `prefillCoords` into that base tab's add form
  (`Workspace.tsx:2110`, `pendingPrefill`). Since the add form now lives in `added-entities`, retarget:
  open `added-entities`, tell `AddedEntitiesTab` which inner sub-tab to select + forward `prefillCoords`
  to it. Add a one-shot `pendingAddedSubTab` hint alongside `pendingPrefill`; `AddedEntitiesTab` selects
  that sub-tab on mount/prop-change then forwards coords to its child. **This flow must keep working
  end-to-end** (place-on-map → prefilled add form in the Added Entities tab → Save).

**DoD:** every model shows an "Added Entities" sidebar tab with correct inner sub-tabs; base
Warehouses/Customers/Mines/Stations/Refineries/Plants tabs show ONLY the base table (no inline added
section); add / edit / delete / precheck-chip / CSV-add behaviors are byte-identical to today, just
relocated; Input-Map click-to-place lands the prefilled form in the new tab's correct sub-tab; Save
persists added entities from the new tab.

---

## 5. Item 5 — Distance-Band filters show ranges (live, all band filters)

**Current:** the "Distance Band" filter descriptor uses `accessor: r => r.band` where
`r.band = bandLabel(distance, effectiveBands)` → `"Band 1"`, `"Band 2"`, … `"Overflow"`
(`JadeFlowsTab.tsx:188/199`, `JadeAssignmentsTab.tsx:198`). These are the only Distance-Band filters
that exist (both JADE; other models' output tables have no band column). `FilterMenu` derives its
`select` options from the distinct `accessor(row)` values.

**Change:** replace the band **filter option value** with a unit-aware range label, driven by the SAME
live `effectiveBands` (the presentation-band lens already fed to these tabs — so it already updates the
instant bands are edited; "live" is satisfied by construction, no new wiring). Add a helper
`bandRangeLabel(distance, bands, unit): string` in `lib/bands.ts` beside `bandLabel`:
- Band 0: `"≤ <b0> <unit>"`
- Band i (i>0, ≤ last): `"<b(i-1)>–<b(i)> <unit>"`
- Overflow: `"> <lastBoundary> <unit>"`
- `unit` = the model's distance unit (`mi` for us/brazil/transport/gold-au/jade, `km` for chens),
  resolved the same way the tabs already resolve `distanceUnit`.

**Where:** change the band descriptor's `accessor` to `r => bandRangeLabel(r.distanceMi/​r.distance, effectiveBands, unit)`.
Keep the **table cell** column as-is (still `bandLabel` → "Band N") — the request is filters only. The
filter's matching stays consistent because both the option list and the row-match run through the same
accessor. Because `effectiveBands` is live, editing bands re-labels the filter options immediately
(and after a re-solve, unchanged). Applies to every Distance-Band filter descriptor (currently the two
JADE tabs); any future band filter inherits by using the same helper.

**DoD:** Distance-Band filter dropdowns list ranges like `"≤ 250 mi"`, `"250–500 mi"`, `"> 1000 mi"`
(km for chens), not "Band N"; editing bands updates the ranges live with no re-solve; filtering by a
range selects exactly the rows whose distance falls in it; table cells still read "Band N".

---

## 6. Tests

- **Item 1:** `EntityMarkers` unit — `plantSquareSvg()` contains the factory path + `--map-plant`;
  legend/marker snapshot unaffected in shape.
- **Item 2:** `plantIdCityState` unit (id + City, State; name ignored); RTL that Flows P→W /
  Plant-Production / Capability-Matrix plant cells render id + City, State.
- **Item 3:** RTL — info `<p>` has no `max-w-md` / is single-line; a capacity readout renders `… Units`.
- **Item 4:** RTL — AddedEntitiesTab renders correct inner sub-tabs per model; base tab with
  `showAddedSection={false}` renders no add form; add/delete through the new tab mutates `localInputs`;
  Input-Map prefill opens `added-entities` at the right sub-tab with coords filled. Tab-coverage sweep
  (`Workspace.TabCoverage.test.tsx`) extended with the new entity.
- **Item 5:** `bandRangeLabel` unit (each band + overflow, mi and km); RTL that a JADE band filter lists
  ranges and that editing bands changes them with no network call.
- **QA (qa-sdet, real browser):** per §7.

## 7. QA (real browser)

- Plant markers show the factory on Input + Output maps + legend (JADE).
- A plant-bearing table shows id + City, State.
- Capability Matrix: single-line info; readouts end in `Units`.
- Added Entities tab present for ≥2 models; place an entity on the Input Map → prefilled add form
  appears in the Added Entities tab's correct sub-tab → Save persists it; base tab shows no inline add
  section.
- Edit a band post-solve → JADE Distance-Band filter options re-range live (no `/solve` call); filtering
  by a range selects the right rows.

## 8. Out of scope

- Any backend/solver/dataset/contract change.
- Renaming or re-ranging the table **cells** (cells keep "Band N").
- Adding Distance-Band columns/filters to models that don't have them today.
- Showing the plant `name` alongside id/city/state (id + City, State only unless reviewer requests).
