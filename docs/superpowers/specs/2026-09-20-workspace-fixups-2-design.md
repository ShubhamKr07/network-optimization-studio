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
   buttons; fix the same misalignment in **every other JADE input tab where the Filter Menu is enabled**
   (alignment only — this does NOT add filters to non-JADE models; see §3).
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
  `displayCode ?? id` (the reference renders `displayCode ?? id`). **Fallback contract (Codex round-2 P2 —
  the "never a raw uid" absolute was impossible):** `displayCode` is intentionally OPTIONAL in the
  persisted schemas, so a valid legacy added-row can lack one; the contract is therefore **"prefer
  `displayCode`, fall back to the canonical `id` when absent."** A scenario-added row that HAS a display
  code never shows its `aw-…` uid; a legacy row with no display code honestly shows its id (the only
  available label) rather than blanking. Tests cover the missing-`displayCode` case, not only the
  has-code case. The same canonical-lookup/display-value split applies to the marker tooltips (item 4).
- **`>10` is an UPGRADE trigger, not a suppression rule (Codex P2).** Tables that ALREADY render
  location+id when data is available (`AssignmentsTab`, `FlowsTab`, `OpenWarehousesTab`,
  `CapabilityMatrixTab`, `ServiceStatsTab`, …) keep their rich cells at EVERY row count — do not regress
  them. `>10` only governs whether a currently **bare-id** table upgrades to the stacked cell. The
  threshold uses the **unfiltered physical row count** (not the post-filter count).
- **One snapshot-matched IDENTITY projection carrying BOTH location AND display id (Codex round-3 P1).**
  `EntityIdCell` needs `displayId`, but several output consumers have no source for a scenario-added
  entity's display code today (verified: `FlowsTab` gets only `{result, scenarioId, locationById}`;
  `JadeFlowsTab` has no `displayedInputs`/display-id map; shared `AssignmentsTab.displayCodeById` merges
  added **facilities** only, NOT added customers). A location-only map would make them fall back to the
  canonical id even when a display code exists — violating "prefer `displayCode`." So the helper returns
  **`Record<canonicalId, {city, state, displayId}>`**: `buildEntityIdentityById(modelId, dataset, inputs)`
  unions ALL base entities (warehouses/customers/mines/stations/refineries/plants) with `inputs.added*`,
  keyed by canonical id, **base wins on id collision**; `displayId = <added row's displayCode> ?? id`.
  Derive TWO maps in `Workspace.tsx`, each fed to the tables that already use that snapshot for their rows:
  - `outputIdentityById = buildEntityIdentityById(modelId, dataset, displayedInputs)` — OUTPUT/report
    tables (`OpenWarehousesTab`, `AssignmentsTab` incl. added CUSTOMERS, `FlowsTab`, `JadeAssignmentsTab`,
    `JadeFlowsTab`, `ServiceStatsTab`) — the solved snapshot.
  - `inputIdentityById = buildEntityIdentityById(modelId, dataset, localInputs)` — INPUT tables
    (`DistancesTab`, `JadeDistancesTab`, `LegDistancesTab`, `LaneCostsTab`, `CapabilityMatrixTab`) — the
    EDITABLE draft, so an entity added/moved in the current unsaved draft shows correct location + code
    immediately (a `displayedInputs`-only map would be stale/missing until the next solve).
  Wire it into EVERY listed consumer (extend the props of `FlowsTab`/`JadeFlowsTab`/`AssignmentsTab` etc.
  that only had `locationById` today to carry the `displayId` too). Regression test: an unsaved input edit
  updates an input grid WITHOUT relabelling a previously-solved output/history entry; and an added
  customer/facility renders its display code (not the canonical id) in shared Flows, JADE Flows, AND shared
  Assignments — not just the map + one generic cell unit.
- **CostSummary compare mode is a per-scenario exception (Codex round-3 P1).** `CostSummaryTab` compare
  renders multiple `compareScenarios`, each with its OWN `result` + `inputs`; it already resolves added
  facilities per-column off `s.inputs` (never `localInputs`). Cloned scenarios commonly share an
  added-entity canonical id yet move it to different locations/codes — so looking every column up through
  the single active `outputIdentityById` would show the WRONG City/State/code in another column. **Exclude
  CostSummary compare from the single-map contract:** each compare column resolves location + display id
  from ITS OWN `s.inputs` (a per-scenario identity map, keyed by scenario id, or the existing per-column
  `s.inputs` path extended to location). Regression: compare two scenarios that share an added-facility id
  but store different locations/display codes → each column shows its own.
- **Verified inventory (every consuming table):**
  - **Exempt — already have City/State columns:** input base tables `WarehouseTable` / `CustomerTable` /
    `MineTable` / `StationTable` — no change.
  - **Apply / already-rich (keep rich at any count; upgrade bare-id at >10):** `OpenWarehousesTab` (the
    reference), `AssignmentsTab`, `FlowsTab`, `CostSummaryTab`, `DistancesTab`, `JadeDistancesTab`,
    `CapabilityMatrixTab` (plant rows, already `plantIdCityState`), `JadeAssignmentsTab`, `JadeFlowsTab`,
    `ServiceStatsTab`, `LaneCostsTab`, **`LegDistancesTab`** (gold-au From/To, user-defined rows can
    exceed 10, currently bare ids — Codex P1, added to the inventory).
  - Tabs not yet receiving a location map (`JadeAssignmentsTab`, `JadeFlowsTab`, `ServiceStatsTab`,
    `LaneCostsTab`, `LegDistancesTab`, and any non-JADE consumer) get the appropriate map above.
  - **Explicitly EXCLUDED — transient modal/preview tables (Codex round-2 P2):** `ImportDialog`'s "Changes"
    preview table (raw CSV rows mid-validation, an `ID` column, no City/State, can exceed 10 rows) is NOT
    in scope — its rows are un-persisted parse output with no scenario-entity identity to key a location
    lookup on. Item 2 covers **persistent workspace input/output grids only**; transient preview tables
    are out of scope. This makes the inventory literally complete.

**DoD:** every listed persistent grid shows `City, State` above a mono display-id for each entity-ID cell
(matching Open WHs) once eligible — already-rich tables stay rich at ALL row counts; a currently bare-id
table upgrades when its unfiltered row count > 10; input tables read `inputIdentityById` (live), output
tables read `outputIdentityById` (solved snapshot), and CostSummary compare columns resolve per-column
from their OWN scenario's inputs (not the single active map); every consumer can render `displayId` (added
customers/facilities show their display code); `LegDistancesTab` is covered; a lookup miss falls back to
the display id (or the canonical id if no display code); the `ImportDialog` preview table is unchanged;
at least one previously-unwired **non-JADE** model (e.g. p-median `AssignmentsTab` or gold-au
`LegDistancesTab`) is exercised in tests.

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

**THREE marker sites, all must change (Codex round-1 + round-2 P1):**
- **Output map** `NetworkMap.tsx` — warehouse markers show `{id} — {city}, {state}` (+ `(mine)`); plant
  `{id} — {city}, {state}`; customer `{city}, {state} · demand`. Type mostly absent; customer shows no id.
- **Input map** `EntityMarkers.tsx` (used by `InputMapTab.tsx`) — verified: plant/warehouse/customer
  tooltips render ONLY `{displayCode}` (`EntityMarkers.tsx:205/231/249`) — no type, no location. Thread the
  role label + city/state in (its `MapPlant`/`MapWarehouse`/`MapCustomer` rows carry city/state; a
  role→type label comes from `InputMapTab`).
- **Fixed gold-mine marker (Codex round-2 P1)** — verified: `InputMapTab.tsx` renders the gold-au fixed
  mine as a bare `<Marker>` OUTSIDE `EntityMarkers` (lines ~197-204), tooltip `<displayCode> (mine, fixed)`.
  It must get the same contract: `Mine · <displayId> · <City>, <State>`, keeping the useful `(fixed)`
  qualifier as an extra suffix.
- **Output-map display-code plumbing (Codex round-2 P1):** verified — `OutputMapTab`'s `effectiveDataset`
  projection (`OutputMapTab.tsx:252`) maps added warehouses/customers to `{id, city, state, lat, lng}`,
  **DROPPING `displayCode`**, so `NetworkMap` can't show a human display id for an added output marker.
  `displayCode` MUST survive the `Workspace → OutputMapTab → NetworkMap` path (extend the projected row
  type + the `EffectiveAddedWarehouse`/`EffectiveAddedCustomer` shapes to carry `displayCode`), or pass an
  explicit canonical-id→display-id resolver into `NetworkMap`. Tests must include an added warehouse, an
  added customer, and an added plant output marker (base-marker tests can't prove the uid stays hidden).

**Change — every marker tooltip (both maps) reads `<Type> · <DisplayId> · <City>, <State>`** (approver-confirmed):
- **Type label by role:** Warehouse → `Warehouse`; a `kind==="mine"` warehouse-role marker → `Mine`;
  gold-au facility → `Refinery`; JADE plant → `Plant`; transport station (customer-role marker in the
  transport model) → `Station`; every other customer marker → `Customer`. Derive from the marker branch +
  `kind` + `modelId`.
- **DisplayId** = `displayCode ?? id` (item-2 fallback contract: prefer display code, fall back to
  canonical id when absent); customer markers gain it (currently omitted).
- **City, State** via the shared `formatCityState` (so a missing state doesn't produce malformed
  `City, ` text). Keep existing extras (demand, band, open-warehouse customer-count, `(fixed)`) after the
  location.
- Format `·`-separated, matching the existing tooltip style.

**DoD:** hovering ANY marker (warehouse/mine/refinery/customer/station/plant — including the gold-au fixed
mine) on BOTH the Input and Output map shows its type, its display id, and City, State (via
`formatCityState`); an added output marker with a display code shows that code (not its `aw-` uid);
existing extras preserved; tests cover ALL THREE sites (`NetworkMap`, `EntityMarkers`, the InputMapTab
fixed-mine `<Marker>`) plus added output markers.

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
  fallback on a location miss — **never a raw uid WHEN a display code exists** (Codex round-3 P2); a legacy
  row with NO display code shows its canonical id — the two are separate tested cases, not a contradiction);
  RTL that a **bare-id** output table upgrades to the stacked cell when its unfiltered row count > 10 AND a
  10-row one does not (10/11 boundary); RTL that an **already-rich** table (e.g. `AssignmentsTab`) keeps its
  rich cells at **≤10** rows (no regression); a **non-JADE** consumer (p-median `AssignmentsTab` or gold-au
  `LegDistancesTab`) resolves identity from the generic `buildEntityIdentityById`; an added
  **customer/facility** renders its display code (not the canonical id) in **shared Flows, JADE Flows, AND
  shared Assignments** (Codex round-3 P1 — the display-id path, not just the map + cell unit); id-collision
  (added id == base id) resolves to the base; an added row WITHOUT a display code shows its canonical id
  (missing-`displayCode` fallback); an **unsaved input edit** updates an INPUT grid while a previously-solved
  OUTPUT/history entry is NOT relabelled (input-live vs output-solved split); **CostSummary compare** of two
  scenarios sharing an added-facility id but storing different locations/codes shows EACH column's own
  (Codex round-3 P1); the `ImportDialog` preview table is unchanged.
- **Item 3:** RTL that a JADE input tab renders the FilterMenu in the same header row as the Import/Export
  toolbar (single row), not a separate filter row; a non-JADE input tab renders NO FilterMenu (unchanged).
- **Item 4:** RTL/unit for ALL THREE marker sites — `NetworkMap` (output), `EntityMarkers` (input), and
  the InputMapTab fixed-mine `<Marker>` — each tooltip contains `<Type> · <displayId> · <City>, <State>`
  (warehouse, mine, refinery, customer, station, plant), via `formatCityState` (missing state → no
  trailing comma); the fixed mine keeps `(fixed)`; an ADDED output marker (warehouse/customer/plant) with
  a display code shows that code, not its `aw-` uid (proves the OutputMapTab→NetworkMap displayCode path).
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

---

## 13. Re-review comments — Codex (2026-09-20) — SUPERSEDED / RESOLVED (history)

**Status: RESOLVED.** All 5 round-2 comments folded into §2/§4/§8; see §14. Retained for history. Original
round-2 status was "changes requested".

### [P1] Use separate live-input and solved-output location projections

Section 2 defines one map from `displayedInputs` and wires it into every table. Output reports must use
`displayedInputs`, but input tables such as Distances, Lane Costs, Jade Distances, and Leg Distances must
use the editable `localInputs`; otherwise an entity added or moved in the current draft shows a stale or
missing location until another solve. Define a pure helper accepting an arbitrary input snapshot, then
derive at least `inputLocationById = buildLocationById(modelId, dataset, localInputs)` and
`outputLocationById = buildLocationById(modelId, dataset, displayedInputs)`. Keep each table on the same
snapshot it already uses for its rows and display-code lookup. Add a regression test proving that an
unsaved input edit updates an input grid without relabelling a previously solved output/history entry.

### [P1] Cover the fixed gold-mine marker in Item 4

The two named renderers are not the complete input-marker inventory. The gold model's fixed mine is a
third marker site rendered directly in `InputMapTab.tsx`, outside `EntityMarkers`; its current tooltip is
`<displayCode> (mine, fixed)`. It would therefore fail the "every icon" DoD even after both named
renderers change. Add this fixed marker to Item 4 and assert the same
`Mine · <displayId> · <City>, <State>` contract while preserving the useful `fixed` qualifier as an extra.

### [P1] Preserve display codes through the output-map projection

`OutputMapTab`'s effective added-warehouse/customer types omit `displayCode`, and its effective-dataset
projection currently retains only canonical id and coordinates. `NetworkMap` therefore cannot implement
the required human-readable display ID for added output markers from its current props. Require
`displayCode` to survive the `Workspace → OutputMapTab → NetworkMap` path, or pass an explicit
canonical-id-to-display-id resolver. Include added warehouse, customer, and plant output-marker tests;
base-marker tests alone cannot prove that opaque scenario-local ids remain hidden when a display code is
available.

### [P2] Resolve the impossible "never raw uid" fallback contract

The spec defines `displayId = displayCode ?? id` while also requiring that a raw `aw-…` uid is never
shown. Persisted schemas intentionally keep `displayCode` optional, so a valid legacy row can lack one;
in that case the canonical id is the only available fallback. Either change the contract to "prefer
`displayCode`, fall back to canonical id when absent," or define a deterministic backfill/synthetic-label
strategy for legacy rows. Tests must cover the selected missing-display-code behavior rather than only a
row that already has a display code.

### [P2] Include or explicitly exclude the Import Preview Changes table

The "verified inventory" is not literally every table. `ImportDialog` has a Changes table that can exceed
ten rows, contains an `ID` column, and has no dedicated City/State columns. Either include it and define how
preview rows resolve locations, or narrow Item 2's scope explicitly to persistent workspace input/output
tables and identify transient modal/preview tables as out of scope. Leaving it implicit makes both the
"Everywhere" requirement and the claimed complete inventory unverifiable.

---

## 14. Review resolution — round 2 (Codex, 2026-09-20)

**Current status: RESOLVED — no open items.**

| # | Comment | Disposition |
|---|---------|-------------|
| P1 | Separate live-input vs solved-output location maps | **Accepted.** §2: one pure `buildLocationById(modelId, dataset, inputs)` → `inputLocationById`(localInputs, for Distances/JadeDistances/LegDistances/LaneCosts/CapabilityMatrix) + `outputLocationById`(displayedInputs, for output reports); regression that an unsaved input edit doesn't relabel a solved output/history entry. |
| P1 | Fixed gold-mine marker omitted from Item 4 | **Accepted.** Verified it's a bare `<Marker>` in `InputMapTab` outside `EntityMarkers`. §4 now has THREE marker sites; the fixed mine gets `Mine · <displayId> · <City>, <State>` + keeps `(fixed)`. |
| P1 | Display codes dropped in the output-map projection | **Accepted.** Verified `OutputMapTab.tsx:252` drops `displayCode`. §4 requires it to survive Workspace→OutputMapTab→NetworkMap; added-warehouse/customer/plant output-marker tests. |
| P2 | Impossible "never a raw uid" fallback | **Accepted.** §2 contract changed to "prefer `displayCode`, fall back to canonical id when absent" (legacy rows lack the optional code); missing-`displayCode` test. |
| P2 | Import Preview Changes table unaddressed | **Accepted.** §2 explicitly EXCLUDES transient modal/preview tables (`ImportDialog` Changes) — Item 2 = persistent workspace grids only; inventory now literally complete. |

---

## 15. Re-review comments — round 3 (Codex, 2026-09-20) — SUPERSEDED / RESOLVED (history)

**Status: RESOLVED.** All 4 round-3 comments folded into §2/§0/§8; see §16. Retained for history. Original
round-3 status was "changes requested".

### [P1] Define a solved-snapshot display-identity projection for every output consumer

`EntityIdCell` requires a `displayId`, but `buildLocationById` returns only `{city,state}`. Several listed
output consumers have no source for a scenario-added entity's display code: `FlowsTab` receives only
`result`, `scenarioId`, and `locationById`; `JadeFlowsTab` has no solved `displayedInputs` or display-id
map; and shared `AssignmentsTab` resolves display codes only for added facilities, not added customers.
Those tables would therefore render a canonical id even when a display code exists, violating the
"prefer `displayCode`" contract. Define a snapshot-matched `displayIdById` projection (live for input
tables, solved for output tables), or enrich the shared projection to return `{city,state,displayId}`.
Wire it into every listed consumer and test an added customer/facility in shared Flows, JADE Flows, and
shared Assignments—not just the map and one generic cell unit.

### [P1] Keep Cost Summary comparison lookups scenario-local

The proposed `outputLocationById` comes from the single currently displayed scenario, but
`CostSummaryTab` comparison mode renders multiple `compareScenarios`, each with its own `result` and
`inputs`. Cloned scenarios commonly retain the same added-entity canonical id and can then move that
entity to different locations. Looking up every comparison column through the active scenario's map would
silently display the wrong City/State and display code in another column. Either exclude Cost Summary
comparison rows from the single `outputLocationById` contract and continue resolving each column from
`s.inputs`, or provide a projection keyed by scenario id. Add a regression comparing two scenarios that
share an added-facility id but store different locations/display codes.

### [P2] Correct the top-level JADE-only filter scope

Scope item 3 still says to fix the same misalignment in "every other model's input tabs," directly
contradicting §3's deliberate rule that no non-JADE tab gains a Filter Menu. Change the scope summary to
say "every other JADE input tab where the Filter Menu is enabled" so an implementation plan cannot
reasonably expand the feature to other models.

### [P2] Correct the stale raw-uid assertion in the test list

Section 2 correctly permits the canonical id when an optional `displayCode` is absent, but §8 still says
the bare-id fallback is "never a raw `aw-` uid." Replace that with "never a raw uid when a display code
exists" and retain the separate missing-display-code test. Otherwise the acceptance criteria require two
mutually exclusive outcomes for the same valid legacy row.

---

## 16. Review resolution — round 3 (Codex, 2026-09-20)

**Current status: RESOLVED — no open items.**

| # | Comment | Disposition |
|---|---------|-------------|
| P1 | Output consumers lack a display-id source | **Accepted.** Verified `FlowsTab` has only `locationById`, `AssignmentsTab.displayCodeById` covers facilities-not-customers, `JadeFlowsTab` has no map. §2 helper now returns `{city,state,displayId}` (`buildEntityIdentityById`), snapshot-matched, wired into every consumer; tests for added customer/facility in shared Flows, JADE Flows, shared Assignments. |
| P1 | CostSummary compare must be scenario-local | **Accepted.** Verified compare renders multiple `compareScenarios` off per-column `s.inputs`. §2 excludes CostSummary compare from the single map — each column resolves from its own scenario; regression on two scenarios sharing an added-facility id at different locations/codes. |
| P2 | Top-level item-3 scope contradicted §3 | **Accepted.** §0 item 3 reworded to "every other JADE input tab where the Filter Menu is enabled (does NOT add filters to non-JADE)." |
| P2 | §8 stale "never a raw uid" assertion | **Accepted.** §8 now says "never a raw uid WHEN a display code exists," with the missing-display-code (shows canonical id) as a separate tested case. |
