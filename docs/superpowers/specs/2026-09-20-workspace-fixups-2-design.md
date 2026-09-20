# Workspace fixups 2 — Design Spec

**Date:** 2026-09-20 · **Base:** `main` (`86d7acf`) · **Status:** awaiting approval (plan NOT written until approved).
**Execution:** agent-team. Mostly frontend; item 7 adds one backend Zod line. Follows the just-shipped
`workspace-fixups` bundle (some items adjust it).

## 0. Scope — 7 items (approver-confirmed decisions in **bold**)

1. **Remove the "Added Entities" tab** (from the last bundle). Adding a new entity happens via a button
   **inside each respective base tab** instead.
2. On any table with **>10 rows**, an entity-ID cell must also show **City, State** — **unless** the
   table already has City/State columns. Reference: the Warehouse cell in Chapter 9's **Open Warehouses**
   tab (stacked: `City, State` on top, ID mono below). **Everywhere** (all such tables, all models).
3. In the **input Warehouses tab**, move the **Filter** onto the **same line** as the Import/Export
   buttons; fix the same misalignment in every other model's input tabs.
4. **Map marker hover** must show **type + ID + City, State** for every icon.
5. **Remove "P-Median"** from the "AL's Athletics" block on the homepage.
6. **Distance-Band filter label format** → **`Band N: X mi - Y mi`** (Band 1 starts at 0; overflow reads
   **`Band N: > <last> mi`**).
7. **Relax JADE distance bands to free bands** so the Run Optimizer band UX matches Chapter 3
   (approver decision, given JADE's "exactly 4" is a non-load-bearing self-imposed schema rule).

---

## 1. Item 1 — remove the Added Entities tab; add-button inside each base tab

**Background:** the last bundle (INT) added an `added-entities` sidebar tab per model + `AddedEntitiesTab`
rendering each base `*Tab` with `showBaseTable={false}`, and set `showAddedSection={false}` on the base
tab call sites. The base tabs' own inline add-section (a `+ Add …` button that opens the add-row form +
added-rows table + precheck + delete) was moved into that tab.

**Change — revert to inline:** each base tab renders its add-section inline again (the `+ Add …` button
is exactly the "button within the tab" the request asks for — it already exists in the base tabs).
- Remove the `added-entities` entry from every model's `inputEntriesForModel(...)`.
- Remove the `renderTabContent` `added-entities` branch in `Workspace.tsx`.
- Remove `showAddedSection={false}` at every base-tab call site (default is `true` → inline section returns).
- Delete `AddedEntitiesTab.tsx` + its test.
- Clean up the now-dead `showBaseTable` prop from the 5 base tabs (only `AddedEntitiesTab` used it);
  `showAddedSection` may stay (default `true`, harmless) or be removed — remove it too if no other caller
  passes it, to avoid dead props.
- The dead-`pendingPrefill` removal from the last bundle STAYS removed (it was genuinely dead; unrelated).

**DoD:** no model has an "Added Entities" sidebar entry; each base input tab (Warehouses/Customers/
Mines/Stations/Refineries/Plants) shows its inline `+ Add …` button + add-row form + added-rows table +
precheck + delete, exactly as before the last bundle; the CSV Import/Export toolbar and base table are on
the same tab as the add-section (one tab per entity again); `AddedEntitiesTab` is gone; studio tests pass
(the last bundle's `Workspace.AddedEntities.test.tsx` + matrix are removed/rewritten, base-tab tests
restored to the inline-section assertions).

---

## 2. Item 2 — ID + City, State on every >10-row table (unless it has City/State columns)

**Reference (verified) — `OpenWarehousesTab.tsx:190-203`:** the Warehouse cell renders a stacked pair:
```tsx
<div className="flex flex-col">
  <span>{formatCityState(loc.city, loc.state)}</span>
  <span className="font-mono text-[10px] text-muted-foreground">{code ?? id}</span>
</div>
```
(City, State primary; ID mono/muted below — falls back to the bare id when no location is known.)

**Change — one shared cell, canonical-vs-display id split, generic location map:**
- Add a shared `<EntityIdCell entityId displayId location />` (new `components/tables/EntityIdCell.tsx`),
  Open-WHs stacked pattern: `formatCityState(location.city, location.state)` primary + `displayId` mono
  below; bare `displayId` fallback when `location` is missing. **Canonical vs display id (Codex P2):**
  `entityId` is the canonical id used for the `locationById` LOOKUP; `displayId` is what the user SEES =
  `displayCode ?? id` (the reference renders `displayCode ?? id`, and a scenario-added entity has an
  internal `aw-…` canonical id but a user-chosen display code). Never show a raw `aw-…` uid. The same
  canonical-lookup/display-value split applies to the marker tooltips (item 4).
- **`>10` is an UPGRADE trigger, not a suppression rule (Codex P2).** Tables that ALREADY render
  location+id when data is available (`AssignmentsTab`, `FlowsTab`, `OpenWarehousesTab`,
  `CapabilityMatrixTab`, `ServiceStatsTab`, …) keep their rich cells at EVERY row count — do not regress
  them. `>10` only governs whether a currently **bare-id** table upgrades to the stacked cell. The
  threshold uses the **unfiltered physical row count** (not the post-filter count).
- **Generic per-model location map (Codex P1).** Replace the JADE/Chen-specific maps with one
  `buildLocationById(modelId, dataset, displayedInputs): Record<canonicalId,{city,state}>` in
  `Workspace.tsx`, unioning ALL base entities (warehouses/customers/mines/stations/refineries/plants) with
  the SOLVED-snapshot added entities (`displayedInputs.added*`), keyed by canonical id, **base wins on id
  collision** (mirrors item-4 / the last bundle's plant projection). Wire it into every consuming table
  across every model.
- **Verified inventory (every consuming table):**
  - **Exempt — already have City/State columns:** input base tables `WarehouseTable` / `CustomerTable` /
    `MineTable` / `StationTable` — no change.
  - **Apply / already-rich (keep rich at any count; upgrade bare-id at >10):** `OpenWarehousesTab` (the
    reference), `AssignmentsTab`, `FlowsTab`, `CostSummaryTab`, `DistancesTab`, `JadeDistancesTab`,
    `CapabilityMatrixTab` (plant rows, already `plantIdCityState`), `JadeAssignmentsTab`, `JadeFlowsTab`,
    `ServiceStatsTab`, `LaneCostsTab`, **`LegDistancesTab`** (gold-au From/To, user-defined rows can
    exceed 10, currently bare ids — Codex P1, added to the inventory).
  - Tabs not yet receiving a location map (`JadeAssignmentsTab`, `JadeFlowsTab`, `ServiceStatsTab`,
    `LaneCostsTab`, `LegDistancesTab`, and any non-JADE consumer) get the generic `buildLocationById`
    output.

**DoD:** every listed table shows `City, State` above a mono display-id for each entity-ID cell (matching
Open WHs) once eligible — already-rich tables stay rich at ALL row counts; a currently bare-id table
upgrades when its unfiltered row count > 10; `LegDistancesTab` is covered; a lookup miss falls back to the
bare display id (never blank, never a raw `aw-` uid); at least one previously-unwired **non-JADE** model
(e.g. p-median `AssignmentsTab` or gold-au `LegDistancesTab`) is exercised in tests.

---

## 3. Item 3 — Filter on the same line as Import/Export (input tabs)

**Current (verified):** the CSV toolbar (`Download CSV/JSON`, `Upload`) is rendered by the base tab
(`WarehousesTab.tsx:264`, a `flex items-center gap-1.5 mb-2` row). The FilterMenu is rendered separately
INSIDE the table component (`WarehouseTable.tsx:100-102`, its own `flex justify-end mb-1.5` row) — a
different row, so Filter and Import/Export are visually misaligned on two lines.

**Scope — alignment only, NOT a filter-availability expansion (Codex P1).** Verified: input-tab filters
are enabled ONLY for JADE (`Workspace.tsx:2734/2866/3570` pass `enableFilters={modelId === "two-echelon-jade-us"}`);
every non-JADE input tab renders no FilterMenu, so there is no misalignment to fix there. This item is a
**placement/alignment** change for the tabs where the FilterMenu is ALREADY enabled (JADE's
Warehouses/Customers/Plants input tabs). It must **not** silently enable FilterMenus for non-JADE models.
(If enabling filters on other models' input tabs is desired, that is a separate product-scope change
needing explicit approval — flagged, not assumed.)

**Change:** render the FilterMenu on the SAME row as the toolbar. The base input tab owns one header row —
`flex items-center justify-between` — Import/Export buttons left, FilterMenu right. Lift the FilterMenu
out of the inner table component (`WarehouseTable.tsx:100`) up to the base tab's toolbar row, keeping the
`>10` gate and passing the table's `tableFilters`/descriptors up (or expose them via a small render-prop/
context so the mount can live in the toolbar row). Applies to the JADE-enabled input tabs.

**DoD:** in every input tab where the FilterMenu is enabled (JADE's), the Filter control sits on the same
horizontal line as the Import/Export buttons (toolbar left, Filter right), no orphaned second filter row;
no non-JADE input tab gains a filter; the `>10` gate and all filtering behavior are unchanged.

---

## 4. Item 4 — map marker hover: Type + ID + City, State

**TWO renderers, both must change (Codex P1):**
- **Output map** `NetworkMap.tsx` — warehouse markers show `{id} — {city}, {state}` (+ `(mine)`); plant
  `{id} — {city}, {state}`; customer `{city}, {state} · demand`. Type mostly absent; customer shows no id.
- **Input map** `EntityMarkers.tsx` (used by `InputMapTab.tsx`) — verified: plant/warehouse/customer
  tooltips render ONLY `{displayCode}` (`EntityMarkers.tsx:205/231/249`) — no type, no location. This
  renderer was omitted from the first draft; it MUST be updated too, which means threading the model/role
  label AND city/state into `EntityMarkers` (its `MapPlant`/`MapWarehouse`/`MapCustomer` rows carry
  city/state from the dataset — confirm and use them; a role→type label is passed in from `InputMapTab`).

**Change — every marker tooltip (both maps) reads `<Type> · <DisplayId> · <City>, <State>`** (approver-confirmed):
- **Type label by role:** Warehouse → `Warehouse`; a `kind==="mine"` warehouse-role marker → `Mine`;
  gold-au facility → `Refinery`; JADE plant → `Plant`; transport station (customer-role marker in the
  transport model) → `Station`; every other customer marker → `Customer`. Derive from the marker branch +
  `kind` + `modelId`.
- **DisplayId** = `displayCode ?? id` (item-2 canonical/display split — never a raw `aw-…` uid); customer
  markers gain it (currently omitted).
- **City, State** via the shared `formatCityState` (so a missing state doesn't produce malformed
  `City, ` text). Keep existing extras (demand, band, open-warehouse customer-count) after the location.
- Format `·`-separated, matching the existing tooltip style.

**DoD:** hovering any marker (warehouse/mine/refinery/customer/station/plant) on BOTH the Input and Output
map shows its type, its display id, and City, State (via `formatCityState`); existing extras preserved;
tests cover both `NetworkMap` and `EntityMarkers` renderers.

---

## 5. Item 5 — drop "P-Median" from the AL's Athletics homepage block

**Current (verified) — `chapters.ts:27`:** `title: "AL's Athletics — P-Median"`. The Landing card renders
this `title`. (`labHeaderTitle`/`labHeaderSubtitle` are separate — the header keeps "Ch 3 · p-median".)

**Change:** `title: "AL's Athletics"` (drop `— P-Median`). Only the Landing card text changes; the header
subtitle's "p-median" descriptor is a different field and stays.

**DoD:** the homepage AL's Athletics card no longer shows "P-Median"; nothing else changes.

---

## 6. Item 6 — Distance-Band filter label format `Band N: X mi - Y mi`

**Current (verified) — `lib/bands.ts` `bandRangeLabel` (last bundle):** returns `≤ 250 mi` / `250–500 mi`
/ `> 1000 mi` / `All distances`. **Change the format** (approver-confirmed):
- Band 0 → `Band 1: 0 <unit> - <b0> <unit>` (Band 1 starts at 0).
- Band i (0<i≤last) → `Band <i+1>: <b(i-1)> <unit> - <b(i)> <unit>`.
- Overflow → `Band <n+1>: > <last> <unit>`.
- Empty bands → keep `All distances`.
- Still sorts a copy first; still `<unit>` = the model's distance unit (`mi`/`km`).
This keeps the band NUMBER (which the last bundle had dropped) AND the range. **Only the FilterMenu
options get the new range-aware label (Codex P2).** The table **cells** are unchanged: a configured-band
cell stays `bandLabel` → `Band N`, an overflow cell stays `bandLabel` → `Overflow` (bandLabel is NOT
modified). All three JADE band filters (Flows pw/wc, Assignments) inherit `bandRangeLabel` via the shared
helper; the live memo-deps + clear-on-change from the last bundle are unchanged. **These band filters are
JADE-only** — no Chen (or other-model) Distance-Band filter exists, so there is no Chen filter UI to label
(the km branch of `bandRangeLabel` is exercised by a helper unit test only, not a Chen filter surface).

**DoD:** a JADE Distance-Band filter option reads e.g. `Band 1: 0 mi - 250 mi`, `Band 2: 250 mi - 500 mi`,
`Band 5: > 1000 mi`; band-1 lower bound is 0; overflow shows `> <last> mi`; table cells still show
`Band N` / `Overflow` unchanged; `bandRangeLabel`'s km formatting is unit-tested (no Chen filter UI added).

---

## 7. Item 7 — relax JADE distance bands to free bands (unify with Chapter 3)

**Rationale (verified):** JADE's `distanceBands` is constrained to `.length(4)` + strictly-ascending in
`artifacts/api-server/src/validation/inputs/jadeInputs.ts:158`; every other distance-band model uses
`.min(1)`. JADE bands are a **pure reporting lens** — the JADE spec calls them "non-geometric… never
affecting objective/open-set/assignments," and `merge_inputs.py` has **zero** band references (the solver
never reads them). The fixed-4 `JadeBandEditor` exists only to satisfy that self-imposed `.length(4)` rule
before a Save would 422. So relaxing is safe.

**Change:**
- **Backend:** `jadeInputs.ts` — change `distanceBands` from `.array(z.number().int().positive()).length(4).refine(ascending…)`
  to `.array(z.number().int().positive()).min(1).refine(ascending…)` — same shape as `pMedian`/`transportLp`/
  `twoEchelon` (keep the strictly-ascending refine, drop the exactly-4). One line. No OpenAPI/codegen impact
  (`inputs` is opaque). No solver change.
- **Frontend:** drop the `isJade`/`JadeBandEditor` branch in **both** `SolveDialog.tsx` and
  `OptimizationParametersTab.tsx` for `two-echelon-jade-us`, so JADE uses the shared free chip editor
  (add value + Enter, remove via ×, any count ≥1) exactly like Chapter 3. `JadeBandEditor.tsx` becomes
  unused → delete it (+ its test) and remove the now-unused `onBandValidityChange`/fixed-4 plumbing.
- **Zero-band guard (Codex P1 — shared, fixes p-median too):** the shared chip editor's `removeBand`
  (`SolveDialog.tsx:174`, `OptimizationParametersTab.tsx:160`) has NO lower bound — it can empty the array
  to `[]`, which `.min(1)` then 422s on Save. Since every free-chip model is now `.min(1)`, **disable the
  `×` remove control on the LAST remaining band** in both editors (a `distanceBands.length <= 1` guard), so
  the count can never reach 0 by construction (mirrors the add-side dedupe guard). This also closes the
  same latent gap for p-median/transport/gold-au. Backend keeps `.min(1)` and a test asserts an empty
  array is rejected.
- **Auto-bands / history:** JADE's existing `computeAutoBands`/history-step band restore keep working
  (they already produce ascending arrays; count is no longer constrained).

**DoD:** JADE's Run Optimizer AND Optimization Parameters tab show the same free chip band editor as
Chapter 3 (add/remove ascending bands, count ≥1); the `×` on the last band is disabled so the list can
never empty (verified in both editors); a 3- or 5-band JADE scenario saves and solves without a 422; an
empty-array backend request is rejected by `.min(1)`; `JadeBandEditor` is deleted; `e2e_accuracy.py`
untouched (no solver change); the api-server jade schema test is updated to accept 1/3/5 ascending bands
and reject empty + descending.

---

## 8. Tests
- **Item 1:** base-tab tests assert the inline add-section (button → form) is present again; a Workspace
  test asserts no `added-entities` sidebar entry for any model; `AddedEntitiesTab` test deleted.
- **Item 2:** `EntityIdCell` unit (stacked City,State + mono **displayId**; `displayCode ?? id`; bare-id
  fallback on a location miss — never a raw `aw-` uid); RTL that a **bare-id** output table upgrades to the
  stacked cell when its unfiltered row count > 10 AND a 10-row one does not (10/11 boundary); RTL that an
  **already-rich** table (e.g. `AssignmentsTab`) keeps its rich cells at **≤10** rows (no regression); a
  **non-JADE** consumer (p-median `AssignmentsTab` or gold-au `LegDistancesTab`) resolves location from the
  generic `buildLocationById`; a scenario-added entity (canonical `aw-…` + display code) shows the display
  code, resolves location by canonical id, and id-collision (added id == base id) resolves to the base.
- **Item 3:** RTL that a JADE input tab renders the FilterMenu in the same header row as the Import/Export
  toolbar (single row), not a separate filter row; a non-JADE input tab renders NO FilterMenu (unchanged).
- **Item 4:** RTL/unit for BOTH renderers — `NetworkMap` (output) AND `EntityMarkers` (input) — each
  marker tooltip contains `<Type> · <displayId> · <City>, <State>` (warehouse, mine, refinery, customer,
  station, plant), via `formatCityState` (missing state → no trailing comma).
- **Item 5:** Landing/chapters test that the AL's Athletics card title has no "P-Median".
- **Item 6:** `bandRangeLabel` unit — `Band 1: 0 mi - 250 mi`, mid bands, `Band N: > 1000 mi`, **km**
  (generic formatter), empty; plus a test that `bandLabel` (the CELL) is UNCHANGED (`Band N`/`Overflow`).
- **Item 7:** api-server jade schema test accepts 1/3/5 ascending bands, rejects **empty** + descending;
  RTL that JADE's SolveDialog + Optimization Parameters render the chip editor (not the fixed-4 editor) AND
  that the `×` on the last remaining band is disabled in both.
- **QA (qa-sdet, real browser):** §9.

## 9. QA (real browser, local-served merged branch, explicit E2E_BASE_URL)
- Added Entities tab gone; each input tab has an inline "+ Add" button that adds an entity → Save persists.
- A >10-row output table shows City, State above the mono display-ID (matches Open WHs).
- A JADE input tab: Filter is on the same line as Import/Export (and a non-JADE input tab still has no filter).
- Hover a warehouse, a customer, and a plant marker on BOTH the Input and Output map → each shows
  Type · ID · City, State.
- Homepage AL's Athletics card shows no "P-Median".
- A JADE Distance-Band filter option reads `Band 1: 0 mi - 250 mi` … `Band N: > 1000 mi`; table cells still show `Band N`/`Overflow`.
- JADE Run Optimizer shows the same free chip band editor as Chapter 3; add a 5th band, Save, solve — no
  error; removing down to one band leaves the last `×` disabled (can't reach zero).

## 10. Out of scope
- Any solver / dataset / OpenAPI change (item 7 is a single Zod line; `inputs` stays opaque).
- Output-table filter placement (item 3 is input tabs only).
- Changing the table **cell** band label (stays "Band N").
- Consolidating the two plant projections (carried-over follow-up from the last bundle).

---

## 11. Review comments — Codex (2026-09-20) — SUPERSEDED / RESOLVED (history)

**Status: RESOLVED.** All 7 comments folded into §1–§9; see the §12 resolution table. Retained verbatim
for history. Original round status was "changes requested".

### [P1] Prevent JADE from reaching zero distance bands

The shared chip editors currently allow the user to remove the final band, while the proposed backend
contract requires `distanceBands.min(1)`. An empty editor would therefore allow Save/Run to reach a 422.
Define the client behavior explicitly: either disable/hide removal of the last band, or introduce a
validity gate that disables Save/Run while the list is empty. Cover the final-band removal interaction in
both `SolveDialog` and `OptimizationParametersTab`, and add a backend assertion that an empty array is
rejected. The existing 1/3/5-band and descending-order tests do not cover this boundary.

### [P1] Include the separate Input Map marker renderer in Item 4

Updating `NetworkMap.tsx` is insufficient for the stated input-and-output-map DoD. Input maps use the
separate `EntityMarkers` renderer in `InputMapTab.tsx`, and its tooltips currently show only the display
code. It also needs model-specific semantic role information to label Mine, Refinery, Station, Plant,
Warehouse, and Customer correctly. Require implementation and tests for both renderers, thread the
model/role labels into the input renderer, and use the shared City/State formatter so missing state values
do not produce malformed text.

### [P1] Complete the all-model table inventory and location-data contract

`LegDistancesTab` is missing from the Item 2 inventory even though its user-defined From/To table can
exceed ten rows and currently renders bare identifiers. Add it or document a deliberate exclusion that is
consistent with the "every table" requirement. More broadly, `Workspace` currently supplies comprehensive
location maps primarily for JADE and Chen; P-Median, transportation, and gold tabs do not all receive an
equivalent map. Define a generic per-model `locationById` projection covering base entities and
snapshot/scenario-added entities, list every consuming table, and define the behavior for identifier
collisions. Tests must exercise at least one previously unwired non-JADE model rather than only the four
newly named JADE tabs.

### [P1] Preserve the deliberate JADE-only Filter Menu scope

Item 3 says to fix the misalignment in "every other model's input tabs," but the current product decision
deliberately enables these Filter Menus only for JADE. State that this is a placement/alignment change for
tabs where the Filter Menu is already enabled; it must not silently enable Filter Menus for non-JADE
models. If expanding filter availability is now intended, call that out as a separate product-scope change
requiring explicit approval.

### [P2] Treat `>10` as an upgrade trigger, not a suppression rule

Several tables, including Assignments, Flows, Open Warehouses, Capability Matrix, and Service Stats,
already render location-plus-identifier cells when location data is available, including at ten or fewer
rows. Interpreting "≤10 rows: plain ID" literally would regress those tables and make the Open Warehouses
reference behavior depend on its result count. Define `>10` as the trigger for upgrading currently bare-ID
tables, while preserving already-rich cells at every row count. Also state that the threshold uses the
unfiltered physical table row count. Add a ≤10-row preservation test for an already-rich table as well as
the 10/11 boundary test for a newly upgraded table.

### [P2] Separate canonical lookup ID from the displayed identifier

The reference table displays `displayCode ?? id`, but the proposed `EntityIdCell` accepts only `id`.
Passing the canonical ID preserves the location lookup but can expose UUID-like internal identifiers;
passing the display code preserves the UI but breaks an ID-keyed location lookup. Define an interface such
as `entityId`, `displayId`, and `location`, with the visible value consistently defined as
`displayCode ?? id`. Apply the same rule to marker tooltips and add a test using a scenario-added entity.

### [P2] Resolve the distance-band label and unit contradictions

The design says table cells continue to use `bandLabel` and also says cells remain "Band N," but the
current overflow value from `bandLabel` is `Overflow`. State explicitly that configured-band cells remain
`Band N`, overflow cells remain `Overflow`, and only Filter Menu options receive range-aware labels. The
DoD also mentions Chen kilometre Filter Menu labels even though the Distance Band filters described here
are JADE-only. Keep a unit test for the generic kilometre formatter if useful, but remove the Chen UI claim
unless adding a Chen Distance Band filter is intentionally brought into scope.

---

## 12. Review resolution (Codex, 2026-09-20)

**Current status: RESOLVED — no open items.** All folded into §1–§9.

| # | Comment | Disposition |
|---|---------|-------------|
| P1 | JADE can reach zero bands (chip editor empties → `.min(1)` 422) | **Accepted.** §7 disables the `×` on the last remaining band in BOTH editors (`length<=1` guard) — closes it for p-median/transport/gold-au too; backend `.min(1)` + empty-rejection test. |
| P1 | Item 4 omitted the Input-Map `EntityMarkers` renderer | **Accepted.** Verified `EntityMarkers` tooltips show only `displayCode`. §4 now covers BOTH `NetworkMap` (output) and `EntityMarkers` (input), threading role label + city/state, `formatCityState`; tests for both. |
| P1 | Incomplete table inventory + no generic location map | **Accepted.** §2 adds `LegDistancesTab`, a generic `buildLocationById(modelId, dataset, displayedInputs)` (base ∪ added, base wins on collision), the full consumer list, and a non-JADE test. |
| P1 | Item 3 must not silently enable non-JADE filters | **Accepted.** Verified filters are `enableFilters={modelId==="two-echelon-jade-us"}`. §3 is alignment-only where the filter is already enabled (JADE); expanding availability is flagged as separate approval. |
| P2 | `>10` should upgrade, not suppress | **Accepted.** §2: already-rich tables keep rich cells at ALL counts; `>10` (unfiltered physical count) only upgrades bare-id tables; ≤10 no-regression test added. |
| P2 | Canonical id vs displayed id | **Accepted.** §2 `EntityIdCell{entityId, displayId=displayCode??id, location}`; lookup by canonical, show display; same for marker tooltips; added-entity + collision tests. |
| P2 | Band label/unit contradictions | **Accepted.** §6: only FilterMenu options get ranges; cells stay `Band N`/`Overflow` (bandLabel untouched); no Chen filter UI (JADE-only) — km kept as a formatter unit test. |
