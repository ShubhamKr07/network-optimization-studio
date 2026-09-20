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

**Change — one shared cell + broad application:**
- Add a shared `<EntityIdCell id={..} location={loc} />` (new `components/tables/EntityIdCell.tsx`)
  rendering exactly the Open-WHs stacked pattern (`formatCityState` primary + mono id; bare id fallback).
- Apply it to the **entity-ID column of every table whose row count can exceed 10 AND that does not
  already have City/State as separate columns.** Verified inventory:
  - **Exempt — already have City/State columns:** the input base tables (`WarehouseTable`,
    `CustomerTable`, `MineTable`, `StationTable`) — no change.
  - **Apply (output/report tables with bare id columns):** `AssignmentsTab` (customer + assigned
    warehouse), `FlowsTab`, `JadeAssignmentsTab` (customer, warehouse), `JadeFlowsTab` (plant, warehouse,
    customer), `ServiceStatsTab` (plant/warehouse rows), `LaneCostsTab`, `DistancesTab`/`JadeDistancesTab`
    (From/To are entity ids), `CapabilityMatrixTab` (plant rows — already `plantIdCityState`, keep/align),
    `OpenWarehousesTab` (already compliant — the reference).
  - Each affected table needs a `locationById: Record<id, {city,state}>` — MOST output tabs already
    receive one (`AssignmentsTab`/`FlowsTab`/`CostSummaryTab`/`DistancesTab`/`JadeDistancesTab`/
    `OpenWarehousesTab`/`CapabilityMatrixTab` do). Wire it into the ones that don't yet
    (`JadeAssignmentsTab`, `JadeFlowsTab`, `ServiceStatsTab`, `LaneCostsTab`) from `Workspace.tsx`'s
    existing per-model location maps (`jadeOutputLocationById`/`chenOutputLocationById`/a warehouse+
    customer+plant union). Build the union from the SOLVED snapshot (`dataset` ∪ `displayedInputs` added
    entities), consistent with the other output tabs' snapshot contract.
- The **>10-row** condition mirrors the existing FilterMenu gate (`totalCount > 10`): below 11 rows the
  plain id is fine (a table you can eyeball). Apply the stacked cell only when the table's row count > 10.
  *(Open question for the plan: whether to always show the stacked cell regardless of count for
  consistency — the request says ">10", so gate on >10.)*

**DoD:** every output/report table that can exceed 10 rows shows `City, State` above a mono ID for each
entity-ID cell (matching Open WHs), except tables that already have City/State columns; a table with ≤10
rows is unchanged; a lookup miss falls back to the bare id (never blank).

---

## 3. Item 3 — Filter on the same line as Import/Export (input tabs)

**Current (verified):** the CSV toolbar (`Download CSV/JSON`, `Upload`) is rendered by the base tab
(`WarehousesTab.tsx:264`, a `flex items-center gap-1.5 mb-2` row). The FilterMenu is rendered separately
INSIDE the table component (`WarehouseTable.tsx:100-102`, its own `flex justify-end mb-1.5` row) — a
different row, so Filter and Import/Export are visually misaligned on two lines.

**Change:** render the FilterMenu on the SAME row as the toolbar. Cleanest structure: the base input tab
owns one header row — `flex items-center justify-between` — with the Import/Export buttons on the left and
the FilterMenu on the right. Lift the FilterMenu out of the inner table component up to the base tab's
toolbar row (the base tab already threads `enableFilters`; move the `useTableFilters`/`FilterMenu`
mount to the toolbar row, keeping the `>10` gate). Apply to every input tab that has both a toolbar and a
filter: `WarehousesTab`/`CustomerTable`-tab/`MineTable`-tab/`StationTable`-tab (+ refineries reuse). Do
not change output tabs (their filter placement is separate and not called out).

**DoD:** in every input entity tab, the Filter control sits on the same horizontal line as the
Import/Export buttons (toolbar left, Filter right), no orphaned second filter row; the `>10`-row gate and
all filtering behavior are unchanged.

---

## 4. Item 4 — map marker hover: Type + ID + City, State

**Current (verified, `NetworkMap.tsx`):** warehouse markers show `{id} — {city}, {state}` (+ `(mine)`);
plant markers `{id} — {city}, {state}`; customer markers `{city}, {state} · demand`. Type is mostly
absent; customer shows no id.

**Change — every marker tooltip reads `<Type> · <ID> · <City>, <State>`** (approver-confirmed):
- **Type label by role:** Warehouse → `Warehouse`; a `kind==="mine"` warehouse-role marker → `Mine`;
  gold-au facility → `Refinery`; JADE plant → `Plant`; transport station (customer-role marker in the
  transport model) → `Station`; every other customer marker → `Customer`. Derive the type from the marker
  branch + `kind` + model (pass a small `warehouseRoleLabel`/`customerRoleLabel` in, or compute from
  `modelId` + `kind`). Keep any existing extra suffix (open-warehouse customer count) after the location.
- **Customer markers** gain the ID (currently omitted): `Customer · <id> · <City>, <State> · <demand>…`.
- Format is `·`-separated, matching the existing tooltip style.

**DoD:** hovering any marker (warehouse/mine/refinery/customer/station/plant) on the Input or Output map
shows its type, its id, and City, State; existing extras (demand, band, customer-count) are preserved.

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
This keeps the band NUMBER (which the last bundle had dropped) AND the range. The table **cell** stays
`bandLabel` → "Band N" (unchanged). All three JADE band filters (Flows pw/wc, Assignments) inherit it via
the shared helper; the live memo-deps + clear-on-change from the last bundle are unchanged.

**DoD:** a Distance-Band filter option reads e.g. `Band 1: 0 mi - 250 mi`, `Band 2: 250 mi - 500 mi`,
`Band 5: > 1000 mi` (km for chens); band-1 lower bound is 0; overflow shows `> <last>`; cells still say
"Band N".

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
  unused → delete it (+ its test) and remove the now-unused `onBandValidityChange`/fixed-4 plumbing wired
  for it (the chip editor has no validity-gate — matches every other model).
- **Auto-bands / history:** JADE's existing `computeAutoBands`/history-step band restore keep working
  (they already produce ascending arrays; count is no longer constrained).

**DoD:** JADE's Run Optimizer AND Optimization Parameters tab show the same free chip band editor as
Chapter 3 (add/remove any number ≥1 of ascending bands); a 3- or 5-band JADE scenario saves and solves
without a 422; `JadeBandEditor` is deleted; `e2e_accuracy.py` is untouched (no solver change) — but the
api-server jade schema test must be updated to the `.min(1)` rule.

---

## 8. Tests
- **Item 1:** base-tab tests assert the inline add-section (button → form) is present again; a Workspace
  test asserts no `added-entities` sidebar entry for any model; `AddedEntitiesTab` test deleted.
- **Item 2:** `EntityIdCell` unit (stacked City,State + mono id; bare-id fallback); RTL that an output
  table with >10 rows shows the stacked cell and a ≤10-row table shows the plain id; one per newly-wired
  tab (JadeAssignments/JadeFlows/ServiceStats/LaneCosts) resolves location from the snapshot.
- **Item 3:** RTL that the input Warehouses tab renders the FilterMenu in the same row container as the
  Import/Export toolbar (single header row), not a separate filter row.
- **Item 4:** RTL/unit that each marker tooltip string contains its type + id + City, State (warehouse,
  mine, refinery, customer, station, plant).
- **Item 5:** Landing/chapters test that the AL's Athletics card title has no "P-Median".
- **Item 6:** `bandRangeLabel` unit — `Band 1: 0 mi - 250 mi`, mid bands, `Band N: > 1000 mi`, km, empty.
- **Item 7:** api-server jade schema test accepts 1/3/5 ascending bands and rejects descending; RTL that
  JADE's SolveDialog + Optimization Parameters render the chip editor, not the fixed-4 editor.
- **QA (qa-sdet, real browser):** §9.

## 9. QA (real browser, local-served merged branch, explicit E2E_BASE_URL)
- Added Entities tab gone; each input tab has an inline "+ Add" button that adds an entity → Save persists.
- An output table with >10 rows shows City, State above the mono ID (matches Open WHs).
- Input Warehouses tab: Filter is on the same line as Import/Export.
- Hover a warehouse, a customer, and a plant marker → each shows Type · ID · City, State.
- Homepage AL's Athletics card shows no "P-Median".
- A JADE Distance-Band filter option reads `Band 1: 0 mi - 250 mi` … `Band N: > 1000 mi`.
- JADE Run Optimizer shows the same free chip band editor as Chapter 3; add a 5th band, Save, solve — no error.

## 10. Out of scope
- Any solver / dataset / OpenAPI change (item 7 is a single Zod line; `inputs` stays opaque).
- Output-table filter placement (item 3 is input tabs only).
- Changing the table **cell** band label (stays "Band N").
- Consolidating the two plant projections (carried-over follow-up from the last bundle).
