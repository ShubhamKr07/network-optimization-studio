# Workspace fixups 2 — Implementation Plan

**Date:** 2026-09-20 · **Base:** `main` (`577086e`) · **Spec:** `docs/superpowers/specs/2026-09-20-workspace-fixups-2-design.md` (approved, 3 review rounds folded).
**Execution:** agent-team, **pre-provisioned dedicated locked worktrees per task** (last-bundle lesson — `isolation:"worktree"` is racy; do NOT use it). Controller cherry-picks each task onto the bundle branch + re-gates. Mostly frontend; item 7 adds one backend Zod line + one api-server test. `e2e_accuracy.py` NOT run (no solver/dataset change).

## Process (standing lessons baked in)
- **Controller pre-creates each task's worktree** (`git worktree add --lock <path> -b <task>-work <base-sha>`) and dispatches the agent WITHOUT `isolation`, pinned to that exact path. Each agent's FIRST Bash command is `cd <path>` + a `git rev-parse --abbrev-ref HEAD` sanity check (must equal `<task>-work`, else STOP). Never touch the controller's `jade-ch9` dir.
- **Wave worktrees are cut from the INTEGRATED head of the prior wave, NOT the plan base (Codex plan-review P1).** The dependency graph (T9←T5, T10/T11←T3) means a Wave-2 worktree cut from `577086e` would LACK its Wave-1 prerequisites. So: run Wave 1 → controller cherry-picks all Wave-1 commits onto the bundle branch + gates → THEN provision Wave-2 worktrees from that post-Wave-1 tip → run Wave 2 → cherry-pick + gate → THEN provision INT's worktree from the post-Wave-2 tip → THEN QA's from the post-INT tip. Never pre-create all worktrees up front from the original base. (This is exactly the sequencing the last bundle used successfully.)
- **Explicit-pathspec commits** (`git commit -m … -- <paths>`), `git status` before commit. Agents never push or edit `main`.
- **Optional-props pattern** for per-commit-green: leaf tasks add new props optional-with-safe-default so their standalone commit typechecks; INT (sole `Workspace.tsx` writer) wires the real values.
- **Transient typecheck-red between coupled tasks is acceptable** where a leaf removes something INT must re-wire (e.g. item 1/7) — leaf gates on studio tests + "no NEW typecheck errors beyond the known set"; INT closes them; final consolidated gate is fully green.
- Docs merged to local `main` on creation; QA is a first-class task.

## File → task ownership (no overlaps)
| File(s) | Task |
|---|---|
| `lib/bands.ts` (+ test) | T1 |
| `lib/chapters.ts` (+ test) | T2 |
| `components/tables/EntityIdCell.tsx` (new) + `lib/entityIdentity.ts` (new) (+ tests) | T3 |
| `artifacts/api-server/src/validation/inputs/jadeInputs.ts` (+ api-server jade schema test) | T4 |
| `components/NetworkMap.tsx` + `components/workspace/map/EntityMarkers.tsx` (+ tests) | T5 |
| `components/workspace/SolveDialog.tsx` + `components/workspace/tabs/OptimizationParametersTab.tsx` + DELETE `JadeBandEditor.tsx` (+ tests) | T7 |
| base tabs `{Warehouses,Customers,Mines,Stations,Plants}Tab.tsx` + inner tables `{Warehouse,Customer,Mine,Station}Table.tsx` (+ tests) | T8 |
| `components/workspace/tabs/InputMapTab.tsx` + `components/workspace/tabs/OutputMapTab.tsx` (+ tests) | T9 |
| output report tables `AssignmentsTab`/`FlowsTab`/`JadeAssignmentsTab`/`JadeFlowsTab`/`ServiceStatsTab`/`OpenWarehousesTab` (+ tests) | T10 |
| input/distance/cost tables `DistancesTab`/`JadeDistancesTab`/`LegDistancesTab`/`LaneCostsTab`/`CapabilityMatrixTab`/`CostSummaryTab` (+ tests) | T11 |
| `pages/Workspace.tsx` (+ `Workspace.*.test.tsx`) + DELETE `AddedEntitiesTab.tsx`+test | INT |
| `e2e/workspace-fixups-2.spec.ts` (new) | QA |

## Waves
- **Wave 1 (parallel):** T1, T2, T3, T4, T5.
- **Wave 2 (parallel):** T7, T8, T9 (needs T5's marker prop shape), T10 (needs T3), T11 (needs T3).
- **Wave 3:** INT (needs T3/T5/T7/T8/T9/T10/T11). Sole `Workspace.tsx` writer.
- **Wave 4:** QA.

---

## T1 — bandRangeLabel format `Band N: X mi - Y mi` (item 6) · leaf
**File:** `artifacts/studio/src/lib/bands.ts` + `src/__tests__/bands.test.ts`. Spec §6.
- Change `bandRangeLabel(distance, bands, unit)` (sort a copy first, unchanged):
  - empty → `"All distances"`.
  - Band 0 → `` `Band 1: 0 ${unit} - ${sorted[0]} ${unit}` ``.
  - Band i (0<i≤last) → `` `Band ${i+1}: ${sorted[i-1]} ${unit} - ${sorted[i]} ${unit}` ``.
  - Overflow → `` `Band ${sorted.length+1}: > ${sorted[sorted.length-1]} ${unit}` ``.
- Do NOT touch `bandLabel` (the CELL label stays `Band N`/`Overflow`).
**Tests:** `Band 1: 0 mi - 250 mi`, mid, `Band 5: > 1000 mi`, km, empty; plus an explicit test that `bandLabel` output is UNCHANGED.
**Gate:** typecheck + `pnpm --filter studio test`, both green.

## T2 — drop "— P-Median" from AL's Athletics (item 5) · leaf
**File:** `artifacts/studio/src/lib/chapters.ts` (+ its test if any / a Landing test). Spec §5.
- `chapters.ts:27` `title: "AL's Athletics — P-Median"` → `title: "AL's Athletics"`. Leave `labHeaderTitle`/`labHeaderSubtitle` untouched.
**Tests:** the AL's Athletics chapter `title` has no "P-Median" (Landing/chapters test).
**Gate:** typecheck + studio test green.

## T3 — EntityIdCell + buildEntityIdentityById (item 2 foundation) · leaf
**Files:** new `components/tables/EntityIdCell.tsx`, new `lib/entityIdentity.ts` (+ unit tests). Spec §2.
- `entityIdentity.ts`: `export function buildEntityIdentityById(modelId, dataset, inputs): Record<string, {city:string; state:string; displayId:string}>` — pure. Union ALL base entities (`dataset.warehouses`/`customers`/`plants`; mines/stations/refineries are `dataset.warehouses` with `kind`, or the model's own arrays — read the real Dataset shape) with `inputs.added*` (addedWarehouses/addedCustomers/addedMines/addedStations/addedRefineries/addedPlants). Keyed by canonical id, **base wins on id collision**. `displayId = <added row's displayCode> ?? id`; base rows' `displayId = id` (or their own displayCode if the base type has one). city/state from each entity.
- `EntityIdCell.tsx`: props `{entityId: string; displayId: string; location?: {city:string; state:string}}`. Renders the Open-WHs stacked pattern: `location ? (<div className="flex flex-col"><span>{formatCityState(location.city, location.state)}</span><span className="font-mono text-[10px] text-muted-foreground">{displayId}</span></div>) : displayId`. (No `entityId` lookup inside — the CALLER looks up `identityById[entityId]` and passes `location` + `displayId`; `entityId` is kept on the props only if a test needs it, else drop it and pass `displayId`+`location` — keep the interface minimal but documented.)
**Tests:**
- `EntityIdCell`: stacked City,State + mono displayId; bare displayId on missing location; displayId = display code vs canonical id.
- **`buildEntityIdentityById` direct matrix (Codex plan-review P2 — the core projection, owned by no other task):** every base entity family (warehouse/customer/plant + mine/station/refinery as the model exposes them) AND every added family; `displayId = displayCode ?? id`; a missing/empty state; and the **base-wins-on-canonical-id-collision** rule (an added row whose id equals a base id resolves to the BASE city/state/displayId). These fail independently of rendering so a missing source array or wrong merge order is caught at the helper boundary.
**Gate:** typecheck + studio test green.

## T4 — relax JADE bands to `.min(1)` (item 7 backend) · leaf
**File:** `artifacts/api-server/src/validation/inputs/jadeInputs.ts` + its api-server test. Spec §7.
- `jadeInputs.ts:158` — `distanceBands`: `.length(4)` → `.min(1)` (keep the strictly-ascending `.refine`). Match `pMedian`/`transportLp`/`twoEchelon` shape.
- **Update the refine MESSAGE (Codex plan-review P2):** it currently reads `distanceBands must be exactly 4 strictly-ascending positive integers` — now false. Change to describe **one-or-more strictly-ascending positive integers** (e.g. `distanceBands must be one or more strictly-ascending positive integers`).
- Update/extend the api-server jade schema test: accept 1/3/5 ascending bands; reject **empty** array and descending; assert the NEW message on the descending-input case.
**Gate:** typecheck + `pnpm --filter api-server test` green. (No OpenAPI/codegen — `inputs` opaque; no solver change.)

## T5 — map marker tooltips: Type · DisplayId · City, State (item 4, both renderers) · leaf
**Files:** `components/NetworkMap.tsx` (output) + `components/workspace/map/EntityMarkers.tsx` (input) (+ tests). Spec §4.
- Define the tooltip string builder once (a small shared helper or duplicated identically): `<Type> · <displayId> · <formatCityState(city,state)>` + existing extras (demand/band/customer-count/`(fixed)`) appended.
- **Type by role:** Warehouse→`Warehouse`; `kind==="mine"`→`Mine`; gold-au facility→`Refinery`; JADE plant→`Plant`; transport station→`Station`; other customer→`Customer`. Derive from marker branch + `kind` + `modelId` (pass `modelId` into `EntityMarkers` if not already there).
- **DisplayId:** `NetworkMap` — add an OPTIONAL `displayIdById?: Record<string,string>` prop (default `{}`): `displayId = displayIdById[id] ?? id`. Customer markers gain the id. `EntityMarkers` — its rows already carry `displayCode`; `displayId = displayCode ?? id`.
- **City/State:** via `formatCityState` (import shared). `NetworkMap` warehouse/plant rows carry city/state; customer rows too (read the real props). `EntityMarkers` rows carry city/state.
- Optional props default to today's behavior so the standalone commit is unchanged for callers until INT wires `displayIdById`/`modelId`.
**Tests:** each renderer's tooltip contains `<Type> · <displayId> · City, State` for warehouse/mine/refinery/customer/station/plant; `formatCityState` handles a missing state (no trailing comma).
**Gate:** typecheck + studio test green.

## T7 — JADE uses the chip band editor everywhere + last-band guard (item 7 frontend) · leaf
**Files:** `components/workspace/SolveDialog.tsx`, `components/workspace/tabs/OptimizationParametersTab.tsx`, DELETE `components/workspace/tabs/JadeBandEditor.tsx` (+ its test) (+ update these files' tests). Spec §7.
- Remove the `isJade`/`JadeBandEditor` branch in BOTH `SolveDialog` and `OptimizationParametersTab` → JADE renders the shared chip editor (add value+Enter, remove ×, any count ≥1) like Chapter 3.
- **Last-band guard:** in the shared chip editor, disable the `×` remove control when `distanceBands.length <= 1` (both editors) — the list can never reach 0.
- Delete `JadeBandEditor.tsx` + its test; remove the now-unused `onBandValidityChange`/fixed-4 plumbing on the EDITOR side. **Leave the `onBandValidityChange` PROP on SolveDialog/OptParams as an optional no-op if `Workspace.tsx` still passes it** (INT removes the Workspace-side gating) — this keeps T7's commit typecheck-green standalone; note it for INT.
**Tests:** JADE SolveDialog + OptParams render the chip editor (not the fixed-4); the last band's `×` is disabled at length 1; a 5-band add works.
**Gate:** studio test green; typecheck green in these files (any residual Workspace-side error from removed validity gating is INT's — report it).

## T8 — item 1 base-tab cleanup + item 3 filter-in-toolbar (input tabs) · leaf
**Files:** `components/workspace/tabs/{Warehouses,Customers,Mines,Stations,Plants}Tab.tsx` + `components/tables/{Warehouse,Customer,Mine,Station}Table.tsx` (+ tests). Spec §1, §3.
- **Item 1 — do NOT delete `showBaseTable`/`showAddedSection` here (Codex plan-review P1).** Before INT lands, `Workspace.tsx` STILL passes `showBaseTable={false}`/`showAddedSection={false}` at the Added-Entities call sites; deleting those props from the base-tab interfaces now would make T8's own `typecheck` gate RED (the pattern is "defer interface deletion until its final caller is removed"). So T8 leaves both props in place (optional, `showAddedSection` default `true` → the inline add-section renders by default = the "button within the tab", item 1). INT removes the `={false}` call-site overrides; the now-dead `showBaseTable` prop is removed in a **final controller cleanup commit AFTER INT** (a trivial base-tab edit once no caller passes it) — listed as a post-INT step, not T8's. T8's item-1 work is thus: confirm the inline add-section renders by default (no interface deletion).
- **Item 3 filter relocation:** move the FilterMenu from inside the inner table (`WarehouseTable.tsx:100` `flex justify-end mb-1.5` row) up to the base tab's toolbar row, so Import/Export + Filter share ONE `flex items-center justify-between` header row (toolbar left, Filter right). Lift the `useTableFilters`/`FilterMenu` mount (or expose via a render-prop/context) keeping the `>10` gate. **JADE-enabled tabs only** — do NOT enable filters for non-JADE (the `enableFilters` prop already gates this; unchanged).
**Tests:** base tab renders its inline `+ Add …` section by default (item 1); a JADE-enabled input tab renders the FilterMenu in the same header row as the toolbar (single row), not a separate row; a non-JADE input tab renders NO FilterMenu (unchanged).
**Gate:** typecheck + studio test green.

## T9 — map-tab plumbing: fixed-mine marker + output displayCode (item 4) · needs T5
**Files:** `components/workspace/tabs/InputMapTab.tsx` + `components/workspace/tabs/OutputMapTab.tsx` (+ tests). Spec §4.
- **InputMapTab:** the fixed gold-mine bare `<Marker>` (~lines 197-204) tooltip → `Mine · <displayId> · <City>, <State>` + keep `(fixed)`. Thread the role-type label + `modelId` (+ `displayIdById` if needed) into `EntityMarkers` (T5's new props).
- **OutputMapTab:** extend `EffectiveAddedWarehouse`/`EffectiveAddedCustomer` + the `effectiveDataset` projection (`:249-252`) to CARRY `displayCode`; build a `displayIdById` (canonical→`displayCode ?? id`) from the effective added arrays + base, and pass it to `<NetworkMap displayIdById={…}>` (T5's new prop). (INT supplies the added arrays WITH `displayCode` from Workspace.)
**Tests:** the fixed-mine tooltip shows `Mine · <displayId> · City, State (fixed)`; an added output warehouse/customer/plant marker shows its display code (not `aw-` uid) via the threaded `displayIdById`.
**Gate:** studio test green; typecheck green (optional props from T5 must exist — Wave-2 ordering guarantees T5 landed).

## T10 — output report tables use EntityIdCell + identity (item 2) · needs T3
**Files:** `AssignmentsTab`/`FlowsTab`/`JadeAssignmentsTab`/`JadeFlowsTab`/`ServiceStatsTab`/`OpenWarehousesTab` (+ tests). Spec §2.
- Each: add an OPTIONAL `identityById?: Record<string,{city,state,displayId}>` prop (default `undefined`). **KEEP the existing props (`locationById`/`displayedInputs`/`displayCodeById`) — do NOT remove them (Codex plan-review P1).** Use a per-cell **compatibility resolver**: prefer the new `identityById` entry, else fall back to the component's EXISTING location/display-code sources, else the canonical id. So with `identityById` unset, an already-rich table renders EXACTLY as today (no regression); when INT passes `identityById`, it takes precedence. `<EntityIdCell entityId={id} displayId={identityById?.[id]?.displayId ?? existingDisplayCode(id) ?? id} location={identityById?.[id] ?? existingLoc(id)} />`. Apply the `>10` UPGRADE rule: a currently bare-id table upgrades when its **unfiltered** row count > 10; already-rich tables keep rich cells at every count. `OpenWarehousesTab` aligns to `EntityIdCell`. (Legacy props are removed only in a later pass once INT has migrated every caller — not in this leaf.)
**Tests:** a >10-row bare-id table upgrades (10/11 boundary); **an already-rich component rendered through its OLD props with `identityById` UNSET produces UNCHANGED output** (the no-regression proof, Codex plan-review P1); an added CUSTOMER and an added FACILITY show their display code in shared Flows / JADE Flows / shared Assignments (the display-id path, via `identityById`); a lookup miss falls back to displayId then id.
**Gate:** typecheck + studio test green (with `identityById` unset, behavior byte-unchanged).

## T11 — input/distance/cost tables use EntityIdCell + identity; CostSummary compare per-scenario (item 2) · needs T3
**Files:** `DistancesTab`/`JadeDistancesTab`/`LegDistancesTab`/`LaneCostsTab`/`CapabilityMatrixTab`/`CostSummaryTab` (+ tests). Spec §2.
- Distance/lane/capability tables: same optional `identityById` + `EntityIdCell` + **compatibility resolver preserving existing props** as T10 (do NOT drop `locationById`/`displayCodeById`; unset `identityById` → byte-unchanged output; no-regression test per table), on From/To/plant/warehouse id cells; `>10` upgrade rule; INT passes `inputIdentityById` (LIVE `localInputs`).
- **CostSummaryTab compare (per-scenario, Codex round-3 P1):** compare columns must NOT use a single active map. Each column resolves location + displayId from ITS OWN `s.inputs` (build a per-scenario identity inline via `buildEntityIdentityById(modelId, dataset, s.inputs)`, or extend the existing per-column `s.inputs` extraction to location). `dataset` is the shared base; only the added-entity overlay differs per scenario.
**Tests:** an input distance table upgrades at >10 and shows live location on an unsaved add/move; CapabilityMatrix aligns to EntityIdCell; **CostSummary compare** of two scenarios sharing an added-facility id but different locations/codes shows EACH column's own City/State/displayId.
**Gate:** typecheck + studio test green.

## INT — Workspace integration (sole `Workspace.tsx` writer) · needs T3/T5/T7/T8/T9/T10/T11
**Files:** `pages/Workspace.tsx` (+ `Workspace.*.test.tsx`), DELETE `components/workspace/tabs/AddedEntitiesTab.tsx` + `__tests__/Workspace.AddedEntities.test.tsx`. Spec §1, §2, §4, §7.
1. **Item 1 revert — complete enumeration (Codex plan-review P2):** remove the `added-entities` entry from every `inputEntriesForModel`; remove the `renderTabContent` `added-entities` branch; remove the dead `activeTab.entity === "added-entities"` **Save-placement/allowlist** condition; remove every base-tab `showAddedSection={false}`/`showBaseTable={false}` call-site override (base tabs default to the inline add-section); DELETE both `components/workspace/tabs/AddedEntitiesTab.tsx` AND `__tests__/AddedEntitiesTab.test.tsx` AND `__tests__/Workspace.AddedEntities.test.tsx`; update/remove the `Workspace.TabCoverage` matrix references to `added-entities`; restore base-tab call sites to the pre-last-bundle inline shape. **Finish with `rg "added-entities|AddedEntitiesTab" artifacts/studio/src` → expected: zero live references** (report the output).
2. **Item 2 wiring:** build `outputIdentityById = buildEntityIdentityById(modelId, dataset, displayedInputs)` and `inputIdentityById = buildEntityIdentityById(modelId, dataset, localInputs)` (T3 helper). Pass `outputIdentityById` to the T10 output tables and `inputIdentityById` to the T11 input tables. (CostSummary compare resolves per-scenario internally — pass `scenarios`/`dataset` as it already does; no single-map prop for compare.)
3. **Item 4 wiring:** pass `modelId` + `displayIdById` (canonical→display) into `NetworkMap` (via OutputMapTab) and `EntityMarkers`/fixed-mine (via InputMapTab); ensure the added arrays passed to `OutputMapTab` now CARRY `displayCode` (T9 extended the types).
4. **Item 7 wiring:** remove the JADE band-validity gating on Save/Run in `Workspace.tsx` (the fixed-4 `onBandValidityChange` gate is gone — JADE now saves like every free-band model); stop passing the fixed-4 validity plumbing.
**Tests (Workspace):** no `added-entities` sidebar entry for any model; each base tab shows its inline add-section; the identity maps reach the tables (input-live vs output-solved: an unsaved input edit updates an input grid WITHOUT relabelling a solved output/history entry); an added output marker shows its display code; JADE Save works with a 3/5-band scenario (no validity block).
**Gate:** FULL — `pnpm run typecheck` 0 errors, `pnpm --filter studio test` green (documented CPU-contention flakes acceptable only if they pass isolated).

## POST-INT cleanup (controller, tiny) · after INT, before QA
Once INT has removed every `showBaseTable`/`showAddedSection={false}` caller, remove the now-dead
`showBaseTable` prop from the 5 base-tab interfaces + destructuring (a trivial base-tab edit — deferred from
T8 per the "delete an interface only after its last caller is gone" rule). Optionally drop `showAddedSection`
too if no caller remains. Controller does this directly on the bundle branch, then re-runs `pnpm run typecheck`.

## QA — real browser (qa-sdet) · last
**File:** `artifacts/studio/e2e/workspace-fixups-2.spec.ts` (new). Spec §9. Serve the merged branch locally (api-server `DATABASE_URL=… PORT=3001`, studio `API_PROXY_TARGET=http://localhost:3001`), explicit `E2E_BASE_URL=http://127.0.0.1:<port>`, run TWICE green. Report product bugs to controller.
- No Added Entities tab; each input tab has an inline "+ Add" button that adds an entity → Save persists.
- A >10-row output table shows City, State above the mono display-ID (matches Open WHs).
- A JADE input tab: Filter on the same line as Import/Export; a non-JADE input tab has no filter.
- Hover a warehouse, a customer, a plant, AND the gold-au fixed mine on BOTH Input and Output map → each shows Type · ID · City, State (mine keeps `(fixed)`).
- Homepage AL's Athletics card shows no "P-Median".
- A JADE Distance-Band filter option reads `Band 1: 0 mi - 250 mi` … `Band N: > 1000 mi`; cells still `Band N`/`Overflow`.
- JADE Run Optimizer shows the Ch3 chip editor; add a 5th band, Save, solve — no error; removing to one band leaves the last `×` disabled.

## Gate (controller, on merged state after each cherry-pick + final)
`pnpm run typecheck` (0) + `pnpm --filter studio test` + `pnpm --filter api-server test` (T4). No `e2e_accuracy.py` (no solver/dataset change). Whole-branch review (independent fable lens) → merge to local `main`. Deploy held unless approved (frontend + one Zod line → `nos-studio` only; `nos-api` needs a redeploy for the jade schema change — surface at deploy time).

---

## Review comments — Codex (2026-09-20) — SUPERSEDED / RESOLVED (history)

**Status: RESOLVED.** All 6 comments folded into Process/T3/T4/T8/T10/T11/INT + the POST-INT step; see the
resolution table below. Retained for history. Original round status was "changes requested".

### [P1] Dependent Wave-2 worktrees must contain their Wave-1 prerequisites

The process says each task receives a pre-provisioned worktree created from `<base-sha>`, while T9
requires T5 and T10/T11 require T3. If all task worktrees are created from the plan base `577086e`, those
prerequisite commits are absent despite the wave ordering; T9 cannot use T5's props and T10/T11 cannot
import T3's new modules. State the operational rule explicitly: merge and gate all Wave-1 commits on the
controller first, then create Wave-2 worktrees from that post-Wave-1 integrated head. Alternatively,
cherry-pick each prerequisite commit into its dependent worktree before dispatch. Do not pre-create every
task worktree from the original plan base. Apply the same rule when creating INT's worktree from the fully
integrated Wave-2 head.

### [P1] T8 cannot remove `showBaseTable` and still pass its green typecheck gate

Before INT lands, `Workspace.tsx` still passes `showBaseTable={false}` at multiple Added-Entities branch
call sites. Removing that prop from the five base-tab interfaces in T8 therefore creates TypeScript errors,
contradicting T8's `typecheck + studio test green` gate. Choose one executable sequence: retain a deprecated
optional `showBaseTable` compatibility prop through T8 and remove it in a post-INT cleanup task; move the
base-tab prop deletion into an atomic integration commit that also removes all Workspace call sites; or
document the exact expected transient diagnostics instead of claiming a green leaf. The preferred
per-commit-green pattern is to defer interface deletion until its final caller has been removed.

### [P1] T10/T11 must preserve legacy rich-cell behavior until INT wires identity maps

The proposed cell expression reads only `identityById`, but the current rich tables obtain location and
display identity from existing `locationById`, `displayedInputs`, and `displayCodeById` props. Before INT
wires the new maps, an unset `identityById` would make Assignments/Open Warehouses and the distance tables
lose existing location/display-code behavior, contradicting the plan's claim that optional props leave
behavior unchanged. Specify a compatibility resolver for each leaf: prefer the new identity entry, then
fall back to the component's existing location/display-code sources, then fall back to the canonical id.
Remove legacy props only after INT has migrated every caller, or merge the caller and callee migration
atomically. Add a leaf test that renders each already-rich component through its old props with
`identityById` unset and proves its output is unchanged.

### [P2] Add a direct unit-test matrix for `buildEntityIdentityById`

T3's listed tests exercise only `EntityIdCell`; they do not prove the core cross-model projection. Add
direct helper tests covering every base and added entity family, `displayCode ?? id`, a missing/empty state,
and the approved **base-wins-on-canonical-id-collision** rule. The collision assertion is required by the
spec and is not currently owned by any later task. These tests should fail independently of rendering so a
missing source array or wrong merge order is diagnosed at the helper boundary.

### [P2] Update the JADE validation message with the schema rule

T4 changes `.length(4)` to `.min(1)` but does not mention the existing refine message, which currently
says `distanceBands must be exactly 4 strictly-ascending positive integers`. Leaving it unchanged would
produce a false error for a descending 1/3/5-band request. Change it to describe one-or-more strictly
ascending positive integers and assert the new message in the descending-input schema test.

### [P2] Enumerate every Added Entities cleanup target

INT must explicitly delete both `AddedEntitiesTab.test.tsx` and `Workspace.AddedEntities.test.tsx`, remove
the dead `activeTab.entity === "added-entities"` Save-placement condition, and update/remove the tab-coverage
matrix references. Finish the integration task with an `rg "added-entities|AddedEntitiesTab"` check over
studio source and tests; expected result is no live reference. The current wording mentions overlapping
test cleanup incompletely and can leave both an obsolete unit test and dead Workspace behavior behind.

---

## Review resolution (Codex plan review, 2026-09-20)

**Current status: RESOLVED — no open items.**

| # | Comment | Disposition |
|---|---------|-------------|
| P1 | Wave-2/INT worktrees must contain their prerequisites | **Accepted.** Process now cuts each wave's worktrees from the INTEGRATED head of the prior wave (cherry-pick+gate Wave 1 → provision Wave 2 → … → INT → QA), never all from the plan base. |
| P1 | T8 can't delete `showBaseTable` and stay green | **Accepted.** T8 no longer deletes it (defer interface removal past its last caller); INT drops the call-site overrides; a POST-INT controller step removes the dead prop. |
| P1 | T10/T11 must preserve legacy rich cells until INT wires maps | **Accepted.** T10/T11 KEEP existing `locationById`/`displayCodeById` props + a compatibility resolver (prefer `identityById`, else existing sources, else id); a no-regression test renders each already-rich component via old props with `identityById` unset → unchanged. |
| P2 | Direct `buildEntityIdentityById` unit matrix | **Accepted.** T3 adds a direct helper test matrix (every base+added family, `displayCode ?? id`, missing state, base-wins-collision) failing independently of rendering. |
| P2 | Update the JADE refine message | **Accepted.** T4 changes the message to "one or more strictly-ascending positive integers" and asserts it in the descending-input test. |
| P2 | Enumerate every Added Entities cleanup target | **Accepted.** INT lists both test files, the dead Save-placement condition, the tab-coverage matrix refs, and finishes with `rg "added-entities|AddedEntitiesTab"` = zero live references. |
