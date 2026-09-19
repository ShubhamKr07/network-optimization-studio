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
supplied icon (a factory with a saw-tooth roofline + 3 windows), `fill="var(--map-plant)"`. Add a
**new** token `--map-plant: #2E7D32;` (approver-pinned forest green — distinct from the olive
`--map-warehouse-open #5F7F28` / `--map-customer #93B747` / band-0 `#16A34A`) to `index.css`; do NOT
reuse `--map-warehouse`. Keep the `20×20` / `viewBox 0 0 24 24` envelope so marker sizing, bounds, and
legend swatch geometry are unchanged. Single edit propagates to all three consumers — zero drift.

**DoD:** Input-map plant markers, Output-map plant markers, and the legend "Plant" swatch all render
the factory; no other marker changes; `plantSquareSvg` remains the only definition; `--map-plant`
(`#2E7D32`) added to the exhaustive raw-token inventory in `designTokens.contract.test.ts` (Codex P2).

---

## 2. Item 2 — plant IDs + City, State in tables

**Plant type** (`Dataset.plants[]`, generated `api.ts:55`): `{ id, name?, city (req), state (req), lat, lng }`.

**Scope (approver-confirmed): the 3 named output/matrix surfaces only** — the editable input Plants tab
is explicitly OUT (Codex P2 resolved: named surfaces only).

**Current gap:** table plant cells show `name ?? city/state ?? id` via `displayLabel` — a plant WITH a
`name` shows ONLY the name (no id, no city/state). Sites affected:
- `JadeFlowsTab.tsx` P→W inner tab — Plant column (`plantLabel`, line 88/158).
- `ServiceStatsTab.tsx` Plant Production — `plantLabel: plant.name ?? plant.id` (line 106) — no city/state at all.
- `CapabilityMatrixTab.tsx` — one row per plant (verify the row header cell; apply same helper).

**Change:** one shared helper `plantIdCityState(plant): string` (co-locate in `lib/formatLocation.ts`
next to `formatCityState`) returning **`"<id> — <City>, <State>"`** (id explicit per the request;
`formatCityState(city, state)` for the suffix). Use it at all three sites. `name` is not shown.

**Added-plant resolution (Codex P1 — mandatory):** `JadeFlowsTab`'s Plant column resolves ids from
`dataset.plants` only, and Workspace passes it just the base `dataset` — so a solved
`plant_to_warehouse` edge from a **scenario-added** plant falls back to the raw id, breaking the DoD.
Pass an **effective-plants** lookup = `dataset.plants ∪ addedPlantsFromInputs(displayedInputs)` — the
**SOLVED snapshot** `displayedInputs`, NEVER `localInputs` (this is an output report; every other JADE
output tab already honors the snapshot contract). Plant Production (`ServiceStatsTab`) already receives
`effectivePlants` from `displayedInputs`; Capability Matrix is an input surface (uses `localInputs`,
correct there). Only Flows needs the new lookup wired.

**DoD:** the Plant column of Flows P→W, the Plant Production plant cell, and the Capability Matrix plant
row each show `<id> — <City>, <State>`; a plant with a `name` still shows id + City, State; an
**added-plant** edge in Flows resolves to `<id> — <City>, <State>` (not the raw id). Input Plants tab
unchanged.

---

## 3. Item 3 — Capability Matrix info line + `Units` suffix

**Two parts** in `CapabilityMatrixTab.tsx`:
- **(a) single line (Codex P2 corrected):** the info `<p>` (line 127) has `max-w-md` → wraps to 2
  lines. Drop `max-w-md` and apply `md:whitespace-nowrap` (single unbroken line at desktop ≥ md;
  below md it wraps normally rather than overflowing — `whitespace-nowrap` alone would force overflow
  on a phone, which is the accepted-behavior we explicitly reject). Text unchanged. DoD asserts
  single-line at desktop width; narrow-viewport wrap is the defined, accepted degradation.
- **(b) `Units` suffix:** the per-cell capacity readout (rendered from `cellCapacity(...)`, ~line 170)
  shows `210,000,000` (and other values) with no unit. Append `" Units"` → `210,000,000 Units`.
  Applies to the readout under every checkbox (enabled → the capacity value; disabled → `0 Units`).

**DoD:** info line is a single line at ≥ md width (wraps, not overflows, below md); every capacity
readout ends in ` Units`.

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

**Precise split (Codex P2 — what each flag hides + single toolbar owner):** the base tabs render more
than a bare table — an Upload/Download CSV toolbar, an import dialog, a base-table filter/count, and an
empty state — all OUTSIDE the physical `<Table>`. Define the two regions as a clean partition:
- **`showBaseTable={false}` (Added Entities tab)** hides ALL of: base `<Table>`, base count/filter,
  base empty state, CSV toolbar, and import dialog. The Added Entities sub-tab shows **only** the
  add-row form + the added-rows table + per-row precheck chips + delete. **No toolbar, no import
  dialog, no base filter** in this tab.
- **`showAddedSection={false}` (base entity tab)** hides the add-row form + added-rows table; keeps the
  base `<Table>`, base count/filter, empty state, CSV toolbar, and import dialog.
- **Single owner:** the CSV import/export toolbar stays on the **base entity tab** (the server export
  template already contains base+added rows, and import applies to both — it is not an "added-only"
  control). The Added Entities tab never renders it. Exactly one toolbar per entity, on the base tab.
- **Base tab call sites** (renderTabContent) pass `showAddedSection={false}` → base table + toolbar only.
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
  precheck errors, `hasStateColumn`, etc. — the REAL shared prop name, Codex round-2) the base tabs get today.
- **Save gate:** the `added-entities` entity joins the save-eligible set (it is an inputs editor); the
  existing dirty-tracking on `localInputs` already covers added arrays — just ensure the tab is not
  excluded by the save-gate allowlist (`Workspace.tsx:1811+`).
- **Input-Map flow (Codex P1 — the prior reconciliation was based on dead code):** the
  `prefillCoords`/`pendingPrefill` path is **obsolete**. Verified: `setPendingPrefill` is never called
  anywhere in `Workspace.tsx`; the cited `:2110` `openTab` is the post-save "missing distances" toast
  navigation, not map placement. Input Map v2 places an entity via `CreateEntityDialog` in-place and, on
  confirm, writes the completed entity **directly to `localInputs`** (never opening a base tab). So:
  - **Do NOT** add `pendingAddedSubTab` or redirect map placement to the Added Entities tab.
  - **Invariant instead:** creating an entity on the Input Map stays on the map, updates `localInputs`,
    and the new row is visible in the appropriate Added Entities inner sub-tab when the user opens it.
  - **Cleanup (do it here):** remove the now-dead `pendingPrefill` state + `prefillCoords` /
    `onPrefillConsumed` props from the base tabs (they are wired to a value that is never set). If any
    base tab’s add-form open-on-prefill effect keys off `prefillCoords`, that effect is dead too.

**DoD:** every model shows an "Added Entities" sidebar tab with correct inner sub-tabs; base
Warehouses/Customers/Mines/Stations/Refineries/Plants tabs show ONLY the base table + its toolbar (no
inline added section); add / edit / delete / precheck-chip / CSV behaviors are byte-identical to today,
just relocated; the CSV import/export toolbar renders exactly once per entity (on the base tab), never
in the Added Entities tab, and no filter/count for a hidden base table appears; placing an entity on the
Input Map writes `localInputs` in-place and the row then appears in the Added Entities inner sub-tab;
Save persists added entities; the dead `pendingPrefill`/`prefillCoords` wiring is removed.

---

## 5. Item 5 — Distance-Band filters show ranges (live, all band filters)

**Current:** the "Distance Band" filter descriptor uses `accessor: r => r.band` where
`r.band = bandLabel(distance, effectiveBands)` → `"Band 1"`, `"Band 2"`, … `"Overflow"`
(`JadeFlowsTab.tsx:188/199`, `JadeAssignmentsTab.tsx:198`). These are the only Distance-Band filters
that exist (both JADE; other models' output tables have no band column). `FilterMenu` derives its
`select` options from the distinct `accessor(row)` values.

**Change:** replace the band **filter option value** with a unit-aware range label. Add a helper
`bandRangeLabel(distance, bands, unit): string` in `lib/bands.ts` beside `bandLabel`. It MUST
**sort a copy of `bands` ascending first** and classify + build the label from that same sorted copy
(mirrors `bandLabel`/`assignBandOrOverflow`/`computeCumulativeBandCoverage`, which all `[...bands].sort()`
— Codex round-2 P2; a label built from the original order could disagree with the cell's `Band N`):
- empty `bands` → `"All distances"` (no boundary to bucket by — never leak `undefined` into a label)
- Band 0: `"≤ <b0> <unit>"`
- Band i (i>0, ≤ last): `"<b(i-1)>–<b(i)> <unit>"`
- Overflow (> last boundary): `"> <lastBoundary> <unit>"`
- `unit` = the model's distance unit (`mi` for us/brazil/transport/gold-au/jade, `km` for chens),
  resolved the same way the tabs already resolve `distanceUnit`.

**Live wiring is NOT free (Codex P1 corrected):** the `pwDescriptors`/`wcDescriptors`/`filterDescriptors`
arrays in `JadeFlowsTab`/`JadeAssignmentsTab` are `useMemo(() => [...], [])` — an **empty dep array**.
An accessor closing over `effectiveBands`/`unit` captures their FIRST-render values; editing bands would
NOT change the options. Required: add `[effectiveBands boundary signature, unit]` to those `useMemo`
deps (a stable primitive key, e.g. `effectiveBands.join(",")` + `unit`), so the descriptors — and thus
`FilterMenu`'s derived options — rebuild when bands/unit change. (Equivalent alternative: compute a live
`bandRange` string per row and give the descriptor a stable accessor reading it; the memo-deps route is
preferred as the smaller change.)

**Stale-selection policy (Codex P1 — approver-confirmed: clear):** `useTableFilters` stores a `select`
filter as the exact option string. When boundaries/unit change, an active selection like `"≤ 250 mi"`
no longer matches any option (`"≤ 300 mi"`) → zero rows + an orphaned active-filter badge. Policy:
**on any band-boundary/unit change, clear the Distance Band filter** (reset that key to "all"). Implement
via an effect keyed on the boundary-signature + unit that resets only the `band` filter key (leaving
other column filters in the same table intact).

**Three independent band filters, not two (Codex round-2 P2):** there are THREE Distance-Band filter
states, each with its own `useTableFilters` instance and its own `band` key:
1. `JadeFlowsTab` Plant→Warehouse inner table (`pwFilters`, `pwDescriptors`)
2. `JadeFlowsTab` Warehouse→Customer inner table (`wcFilters`, `wcDescriptors`)
3. `JadeAssignmentsTab` Customer Assignments (`tableFilters`, `filterDescriptors`)
Each of the three needs the memo-deps fix AND its own clear-on-change effect resetting its own `band`
key; a clear in one inner table must not touch the other, and must not touch that table's non-band filters.

**Where:** for each of the three descriptor sets, change the band descriptor's `accessor` to
`r => bandRangeLabel(r.distanceMi/​r.distance, effectiveBands, unit)` AND add `[boundary-signature, unit]`
to that `useMemo`'s deps AND add that table's clear-on-change effect. Keep the **table cell** column
as-is (still `bandLabel` → "Band N") — filters only. Any future band filter inherits by using the same
helper + the same memo-deps/clear pattern.

**DoD:** Distance-Band filter dropdowns list ranges like `"≤ 250 mi"`, `"250–500 mi"`, `"> 1000 mi"`
(km for chens), not "Band N"; editing bands updates the ranges live with no re-solve; filtering by a
range selects exactly the rows whose distance falls in it; table cells still read "Band N".

---

## 6. Tests

- **Item 1:** `EntityMarkers` unit — `plantSquareSvg()` contains the factory path + `--map-plant`;
  `designTokens.contract.test.ts` inventory includes `--map-plant: #2E7D32`.
- **Item 2:** `plantIdCityState` unit (id + City, State; name ignored); RTL that Flows P→W /
  Plant-Production / Capability-Matrix plant cells render id + City, State; **component added-plant
  test** — a solved `plant_to_warehouse` edge whose plant is only in the passed effective-plants array
  renders `<id> — <City>, <State>`, not the raw id. **Workspace-level snapshot regression (Codex
  round-2 P2):** the displayed solved snapshot (`displayedInputs`) contains an added plant AND the
  current unsaved `localInputs` draft differs — the Flows plant label must resolve from the **snapshot**,
  not the draft; step the result-history stepper and assert the plant lookup + displayed result advance
  together (proves the call-site wiring, which a child-only test cannot).
- **Item 3:** RTL — info `<p>` has no `max-w-md` **and has `md:whitespace-nowrap`** (Codex round-2
  minor — the absence of `max-w-md` alone doesn't prove single-line); a capacity readout renders `… Units`.
- **Item 4:** RTL — AddedEntitiesTab renders correct inner sub-tabs per model; base tab with
  `showAddedSection={false}` renders no add form; Added tab with `showBaseTable={false}` renders **no
  base table, no CSV toolbar, no import dialog, no base filter/count**; the CSV toolbar renders exactly
  once (base tab); add/delete through the new tab mutates `localInputs`. Tab-coverage sweep
  (`Workspace.TabCoverage.test.tsx`) extended with the new entity. **No** prefill test (flow removed).
- **Item 5:** `bandRangeLabel` unit (each band + overflow, mi and km; **exact-boundary** distances +
  an **unsorted-boundary** input + empty-array → `"All distances"` — Codex round-2 P2); RTL that
  **re-rendering an already-mounted** report with changed bands changes the filter options with no
  solve/network call (proves the memo-deps fix); RTL that selecting a range then editing boundaries
  **clears** the band filter (row count returns to unfiltered, no orphaned badge). **Cover all THREE
  band filters** (Codex round-2 P2) — `JadeFlowsTab` P→W (`pwFilters`) and W→C (`wcFilters`) and
  `JadeAssignmentsTab` (`tableFilters`): in Flows, select a range in EACH inner table then edit bands
  and assert both `pwFilters` and `wcFilters` clear their OWN `band` key while any active non-band
  filter in the same table survives.

## 7. QA (real browser)

- Plant markers show the factory on Input + Output maps + legend (JADE).
- A plant-bearing table shows id + City, State.
- Capability Matrix: single-line info; readouts end in `Units`.
- Added Entities tab present for ≥2 models; place an entity on the Input Map (in-place
  `CreateEntityDialog`) → the row appears in the Added Entities tab's correct sub-tab → Save persists it;
  base tab shows no inline add section and the CSV toolbar appears only on the base tab.
- Edit a band post-solve → JADE Distance-Band filter options re-range live (no `/solve` call); filtering
  by a range selects the right rows; editing boundaries while a range is selected clears the band filter.

## 8. Out of scope

- Any backend/solver/dataset/contract change.
- Renaming or re-ranging the table **cells** (cells keep "Band N").
- Adding Distance-Band columns/filters to models that don't have them today.
- Showing the plant `name` alongside id/city/state (id + City, State only).
- The editable **input Plants tab** id cells (Item 2 is the 3 named output/matrix surfaces only).
- Any Input-Map prefill-into-tab redirect (that flow is dead; map placement stays in-place).

---

## 9. Review comments — Codex (2026-09-19) — SUPERSEDED / RESOLVED (history)

**Status: RESOLVED.** All eight comments below were folded into §1–§8; see the §10 resolution table.
Retained verbatim for history only — the current normative status is in §10 (round 1) and §12 (round 2).
The original round-1 status was "changes requested".

### [P1] Remove the obsolete Input-Map prefill reconciliation

Section 4 describes an Input-Map flow that opens a base entity tab and sets `pendingPrefill`. That
flow was superseded by Input Map v2: map placement opens `CreateEntityDialog` in place and, on
confirmation, writes the completed entity directly to `localInputs`. `Workspace.pendingPrefill` is
declared and consumed by the base tabs but is never set; the cited `Workspace.tsx:2110` is navigation
from a post-save missing-distance toast, not map placement.

Do not introduce `pendingAddedSubTab` or redirect map placement to the Added Entities tab. Replace the
Section 4 requirement, DoD, tests, and QA step with this invariant: creating an entity on the Input Map
stays on the map, updates `localInputs`, and the resulting row is visible in the appropriate Added
Entities inner tab when the user opens it. The obsolete `pendingPrefill` cleanup may be handled here or
as a separate cleanup, but it must not be treated as an active product flow.

### [P1] Make the Distance-Band descriptor depend on live bands and unit

The current `JadeFlowsTab` and `JadeAssignmentsTab` filter descriptor arrays are memoized with an empty
dependency array. Merely changing an accessor to close over `effectiveBands` and `distanceUnit` will
capture their initial values, so the filter ranges will not update when the user edits bands. The
statement that live behavior is satisfied "by construction" is therefore incorrect.

Require either:

- descriptor memoization that depends on the effective band boundaries and distance unit; or
- a live `bandRange` value computed on each row, with a stable descriptor reading that value.

The RTL test must rerender an already-mounted report with changed bands and assert that the options
change without a solve/network call.

### [P1] Define active-filter behavior when band boundaries change

`useTableFilters` persists select filters as exact strings. If `≤ 250 mi` is selected and the first
boundary changes to 300, the available option becomes `≤ 300 mi` while the filter state still contains
`≤ 250 mi`. The result is zero matching rows, an active-filter badge, and no checked option.

Specify one deterministic policy: either clear the Distance Band filter whenever bands/unit change, or
preserve the selected logical band indices and remap them to the new range strings. Add a regression
test that selects a range first, edits the boundaries, and verifies the chosen policy and row count.

### [P1] Resolve added plants in the Flows report from the solved snapshot

`JadeFlowsTab` currently resolves plant labels only from `dataset.plants`, and Workspace passes only the
base dataset. A solved `plant_to_warehouse` edge from an added plant therefore falls back to the raw id,
violating Item 2's "every table cell" DoD.

Pass a solved-snapshot effective plant collection (`dataset.plants ∪ displayedInputs.addedPlants`) or
an equivalent lookup into `JadeFlowsTab`; do not use unsaved `localInputs` for an output report. Add a
test whose solved result contains an added-plant edge and assert `id — City, State`.

### [P2] Define what `showBaseTable` hides and assign toolbar ownership

The existing base-tab components render their Upload/Download toolbar, import dialog, base-table filter,
and empty state outside the physical base table. A literal `showBaseTable={false}` implementation could
therefore show a filter for a hidden table and duplicate CSV controls in both the base and Added Entities
tabs.

Specify whether `showBaseTable={false}` suppresses the base empty state, base count/filter, toolbar, and
import dialog. Also choose exactly one owner for each entity's combined base-plus-added import/export
toolbar; the server templates contain both base and added rows, so it is not inherently an
"added-only" control. Tests should assert that no hidden-base filter appears and that only one toolbar
for an entity is rendered in the intended location.

### [P2] Reconcile the Plants input tables with Item 2's DoD

The affected-site list omits `PlantsTab`. Its base table's ID cell currently renders `name ?? id`, and
its added table renders `displayCode ?? id`; both can hide the actual plant id. Either include the base
and added Plants input tables in the `plantIdCityState` change, or narrow the DoD from "every table cell
that identifies a plant" to the three explicitly named Flows, Plant Production, and Capability Matrix
surfaces.

### [P2] Specify and contract-test the new plant color token

"Factory green" is not a deterministic token value. Specify the exact `--map-plant` hex value and add
the token to `designTokens.contract.test.ts`'s exhaustive raw-token inventory, in addition to the
`EntityMarkers` test.

### [P2] Correct the narrow-screen claim for the Capability Matrix copy

`whitespace-nowrap` prevents the paragraph itself from wrapping; a wrapping parent only moves that
entire unbreakable item and does not guarantee graceful behavior on a narrow viewport. Use a responsive
rule such as normal wrapping below the intended breakpoint and nowrap at normal desktop width, or
explicitly define the accepted overflow behavior. Add a narrow-viewport assertion if responsive
degradation is part of the DoD.

---

## 10. Review resolution (Codex, 2026-09-19)

All 8 comments folded into §1–§8 above (normative body is now self-consistent; no open alternatives).

| # | Comment | Disposition |
|---|---------|-------------|
| P1 | Obsolete Input-Map prefill reconciliation | **Accepted.** Verified `setPendingPrefill` never called; `:2110` is a toast nav. §4 drops `pendingPrefill`/`pendingAddedSubTab`; replaced with the in-place-`CreateEntityDialog` → `localInputs` invariant + dead-wiring cleanup. |
| P1 | Descriptor memo empty-dep array | **Accepted.** Verified `useMemo(..., [])` in both JADE tabs. §5 now requires memo deps on the band boundary-signature + unit (or per-row live `bandRange`); RTL rerender test. |
| P1 | Active-filter behavior on band change | **Accepted; policy = clear** (approver-confirmed). §5 clears the band filter on boundary/unit change via a keyed effect; regression test. |
| P1 | Added plants in Flows from solved snapshot | **Accepted.** Verified Flows gets base `dataset` only. §2 wires `dataset.plants ∪ addedPlantsFromInputs(displayedInputs)` (snapshot, not `localInputs`); added-plant test. |
| P2 | `showBaseTable` semantics + toolbar owner | **Accepted.** §4 defines exactly what each flag hides; CSV toolbar/import owned solely by the base tab; Added tab = add-form + added-table + delete only; tests assert single toolbar + no hidden-base filter. |
| P2 | PlantsTab omitted from Item 2 | **Resolved by narrowing (approver-confirmed): named surfaces only.** Input Plants tab explicitly out of scope (§2, §8). |
| P2 | `--map-plant` not deterministic | **Accepted.** Pinned `#2E7D32` (approver-confirmed); added to `designTokens.contract.test.ts` inventory (§1). |
| P2 | Narrow-screen `whitespace-nowrap` claim | **Accepted.** §3 uses `md:whitespace-nowrap` (single-line ≥ md, wraps below); false "degrades gracefully" claim removed. |

---

## 11. Second review comments — Codex (2026-09-19)

**Review status: changes requested (no P1 blockers; four P2 findings plus two minor corrections).**
Reviewed against the revised spec and matching implementation at `a3116f0`.

### [P2] Reconcile the historical review status with the resolution

Section 9 still says **"Review status: changes requested"**, while Section 10 says all eight comments
were folded into the normative body and that there are no open alternatives. Those two statements give
an approver conflicting status signals.

Mark Section 9 as resolved/superseded and retained for history, or remove the duplicated historical
comments and retain only the Section 10 resolution table. The document should have one unambiguous
current review status before approval.

### [P2] Define boundary normalization inside `bandRangeLabel`

The existing `bandLabel` path classifies against an ascending copy of the boundaries, but the new
helper's formulas refer directly to `b0`, `b(i-1)`, and `b(i)` without stating that the helper must
normalize the input first. A literal implementation could classify a distance using sorted boundaries
but construct the displayed range from the original order, making the range label disagree with the
table's `Band N` classification.

Require `bandRangeLabel` to sort a copy of `bands` ascending before both classification and label
construction. Define its empty-array behavior rather than allowing `undefined` to leak into a label.
Extend the helper tests with exact-boundary cases and an unsorted-boundary input, even though JADE's
current editor publishes only valid ascending values; this keeps the shared helper safe for the future
callers Section 5 explicitly anticipates.

### [P2] Cover all three independent Distance Band filters

The test requirement currently says to rerender "a JADE report." There are actually three Distance
Band filters with independent state:

1. Flows — Plant → Warehouse (`pwFilters`)
2. Flows — Warehouse → Customer (`wcFilters`)
3. Customer Assignments (`tableFilters`)

Require parameterized or explicit coverage for all three descriptors. For `JadeFlowsTab`, edit bands
after selecting a range in each inner table and prove that both `pwFilters` and `wcFilters` clear their
own `band` key. Also assert that clearing the band filter preserves any active non-band filter in the
same physical table.

### [P2] Prove the added-plant solved-snapshot wiring at Workspace level

A component-level `JadeFlowsTab` test can pass a prepared effective-plants array directly and still
allow the Workspace call site to be implemented incorrectly with unsaved `localInputs`. Item 2's key
contract is specifically that output labels resolve from `displayedInputs`, the snapshot that produced
the displayed solve.

Add a Workspace-level regression where the displayed solved snapshot contains an added plant and the
current unsaved draft differs. The Flows plant label must resolve from the displayed snapshot. Ideally
also step through result history so the test proves the plant lookup and displayed result advance
together, not merely that an added plant can be formatted by the child component.

### Minor: use the real state-column prop name

Section 4 says the wrapper forwards `hasStateData`; the existing shared tab prop is
`hasStateColumn`. Replace the example name so the implementation plan does not invent a parallel prop
or omit Chen's state-column behavior accidentally.

### Minor: assert the responsive class required by Item 3

The Item 3 test only requires that the paragraph no longer have `max-w-md`. That does not prove the
new desktop single-line behavior. Assert that the paragraph has `md:whitespace-nowrap` as well as not
having `max-w-md`; retain the real-browser narrow-width check for normal wrapping/no overflow.

---

## 12. Review resolution — round 2 (Codex, 2026-09-19)

**Current status: RESOLVED — no open items.** All round-2 comments folded into §1–§8.

| # | Comment | Disposition |
|---|---------|-------------|
| P2 | §9 vs §10 conflicting status | **Accepted.** §9 re-headed SUPERSEDED/RESOLVED (history only); current status lives in §10 + §12. |
| P2 | `bandRangeLabel` boundary normalization | **Accepted.** §5 requires `[...bands].sort()` before classify + label (matches `bandLabel`); empty → `"All distances"`; tests add exact-boundary + unsorted-input + empty cases. |
| P2 | All THREE band filters, not two | **Accepted.** §5 enumerates `pwFilters`/`wcFilters`/`tableFilters` — each gets memo-deps + its own clear effect; §6 tests each, incl. non-band-filter survival + inner-table isolation. |
| P2 | Prove added-plant wiring at Workspace level | **Accepted.** §6 adds a Workspace regression: snapshot has the added plant, unsaved draft differs, label resolves from `displayedInputs`; steps result history to prove lookup+result advance together. |
| Minor | Real prop name `hasStateColumn` | **Accepted.** §4 corrected (`hasStateColumn`, not `hasStateData`). |
| Minor | Assert `md:whitespace-nowrap` | **Accepted.** §6 Item-3 test asserts the class present, not just `max-w-md` absent. |
