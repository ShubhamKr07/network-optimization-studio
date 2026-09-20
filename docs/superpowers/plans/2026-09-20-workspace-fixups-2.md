# Workspace fixups 2 — Implementation Plan

**Date:** 2026-09-20 · **Base:** `main` (`577086e`) · **Spec:** `docs/superpowers/specs/2026-09-20-workspace-fixups-2-design.md` (approved, 3 review rounds folded).
**Execution:** agent-team, **pre-provisioned dedicated locked worktrees per task** (last-bundle lesson — `isolation:"worktree"` is racy; do NOT use it). Controller cherry-picks each task onto the bundle branch + re-gates. Mostly frontend; item 7 adds one backend Zod line + one api-server test. `e2e_accuracy.py` NOT run (no solver/dataset change).

## Process (standing lessons baked in)
- **Controller pre-creates each task's worktree** (`git worktree add --lock <path> -b <task>-work <base-sha>`) and dispatches the agent WITHOUT `isolation`, pinned to that exact path. Each agent's FIRST Bash command is `cd <path>` + a `git rev-parse --abbrev-ref HEAD` sanity check (must equal `<task>-work`, else STOP). Never touch the controller's `jade-ch9` dir.
- **Wave worktrees are cut from the INTEGRATED head of the prior wave, NOT the plan base (Codex plan-review P1).** The dependency graph (T9←T5, T10/T11←T3) means a Wave-2 worktree cut from `577086e` would LACK its Wave-1 prerequisites. So: run Wave 1 → controller cherry-picks all Wave-1 commits onto the bundle branch + gates → THEN provision Wave-2 worktrees from that post-Wave-1 tip → run Wave 2 → cherry-pick + gate → THEN provision INT's worktree from the post-Wave-2 tip → THEN QA's from the post-INT tip. Never pre-create all worktrees up front from the original base. (This is exactly the sequencing the last bundle used successfully.)
- **Explicit-pathspec commits** (`git commit -m … -- <paths>`), `git status` before commit. Agents never push or edit `main`.
- **Optional-props pattern for per-commit-green: EVERY integrated commit passes the zero-error controller gate (Codex plan-review-2 P2).** Leaf tasks add new props optional-with-safe-default, and defer any interface/branch deletion until its last caller is gone, so no task is ever intentionally typecheck-red. INT (sole `Workspace.tsx` writer) wires the real values. There is NO "transient-red / known-error-set" allowance — if a genuinely atomic caller/callee migration is ever needed, merge it as ONE integration unit rather than weakening the gate.
- Docs merged to local `main` on creation; QA is a first-class task.

## File → task ownership (no overlaps)
| File(s) | Task |
|---|---|
| `lib/bands.ts` (+ test) | T1 |
| `lib/chapters.ts` (+ test) | T2 |
| `components/tables/EntityIdCell.tsx` (new) + `lib/entityIdentity.ts` (new) (+ tests) | T3 |
| `artifacts/api-server/src/validation/inputs/jadeInputs.ts` + `artifacts/api-server/src/__tests__/routes.test.ts` (JADE band cases) + the jade schema test | T4 |
| `components/NetworkMap.tsx` + `components/workspace/map/EntityMarkers.tsx` (+ tests) | T5 |
| base tabs `{Warehouses,Customers,Mines,Stations,Plants}Tab.tsx` + inner tables `{Warehouse,Customer,Mine,Station}Table.tsx` (+ tests) — **filter relocation ONLY** | T8 |
| `components/workspace/tabs/InputMapTab.tsx` + `components/workspace/tabs/OutputMapTab.tsx` (+ tests) | T9 |
| output report tables `AssignmentsTab`/`FlowsTab`/`JadeAssignmentsTab`/`JadeFlowsTab`/`ServiceStatsTab`/`OpenWarehousesTab` (+ tests) | T10 |
| input/distance/cost tables `DistancesTab`/`JadeDistancesTab`/`LegDistancesTab`/`LaneCostsTab`/`CapabilityMatrixTab`/`CostSummaryTab` (+ tests) | T11 |
| `pages/Workspace.tsx` (+ `Workspace.*.test.tsx` incl. `Workspace.Integration.test.tsx`) + `SolveDialog.tsx` + `OptimizationParametersTab.tsx` + DELETE `JadeBandEditor.tsx` + DELETE `AddedEntitiesTab.tsx`+test — **item 1 + 2 + 4-wiring + 7-frontend, atomic** | INT |
| base tabs `{Warehouses,Customers,Mines,Stations,Plants}Tab.tsx` + their 5 test files — **branch-collapse + test-rewrite + prop-delete** | CLEANUP (after INT) |
| `e2e/workspace-fixups-2.spec.ts` (new) | QA |

## Waves
- **Wave 1 (parallel):** T1, T2, T3, T4, T5.
- **Wave 2 (parallel):** T8 (filter only), T9 (needs T5's marker prop shape), T10 (needs T3), T11 (needs T3). (Item-7 frontend is folded into INT — see below — so there is no T7.)
- **Wave 3:** INT (needs T3/T5/T8/T9/T10/T11). Sole `Workspace.tsx` writer; also owns the item-7 editor swap (SolveDialog/OptParams/delete JadeBandEditor) + its Workspace integration-test rewrite, atomically.
- **Wave 4:** CLEANUP (needs INT — the base-tab branch collapse + test rewrite + dead-prop deletion, now that `AddedEntitiesTab` + its two tests are gone).
- **Wave 5:** QA.

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
**Files:** `artifacts/api-server/src/validation/inputs/jadeInputs.ts` + the jade schema test + `artifacts/api-server/src/__tests__/routes.test.ts` (its JADE distanceBands cases). Spec §7.
- `jadeInputs.ts:158` — `distanceBands`: `.length(4)` → `.min(1)` (keep the strictly-ascending `.refine`). Match `pMedian`/`transportLp`/`twoEchelon` shape.
- **Update the refine MESSAGE (Codex plan-review P2):** it currently reads `distanceBands must be exactly 4 strictly-ascending positive integers` — now false. Change to describe **one-or-more strictly-ascending positive integers** (e.g. `distanceBands must be one or more strictly-ascending positive integers`).
- **Update `routes.test.ts` (Codex plan-review-3 P1):** it currently asserts a **3-entry** JADE `distanceBands` request returns **422** (was "exactly 4"). That assertion is now intentionally false. Replace it with route-level ACCEPTANCE of the free-band rule (a 1/3/5-band request succeeds); KEEP the non-positive and non-ascending REJECTION cases.
- Extend the jade schema test: accept 1/3/5 ascending bands; reject **empty** and descending; assert the NEW message on the descending case.
**Gate:** typecheck + `pnpm --filter api-server test` green. (No OpenAPI/codegen — `inputs` opaque; no solver change.)

## T5 — map marker tooltips: Type · DisplayId · City, State (item 4, both renderers) · leaf
**Files:** `components/NetworkMap.tsx` (output) + `components/workspace/map/EntityMarkers.tsx` (input) (+ tests). Spec §4.
- Define the tooltip string builder once (a small shared helper or duplicated identically): `<Type> · <displayId> · <formatCityState(city,state)>` + existing extras (demand/band/customer-count/`(fixed)`) appended.
- **Type by role:** Warehouse→`Warehouse`; `kind==="mine"`→`Mine`; gold-au facility→`Refinery`; JADE plant→`Plant`; transport station→`Station`; other customer→`Customer`. Derive from marker branch + `kind` + `modelId` (pass `modelId` into `EntityMarkers` if not already there).
- **DisplayId — different sources for the two renderers, to honor input-live vs output-solved (Codex plan-review-3 P2):**
  - `NetworkMap` (OUTPUT map) — add an OPTIONAL `displayIdById?: Record<string,string>` prop (default `{}`): `displayId = displayIdById[id] ?? id`. Customer markers gain the id. (INT feeds this from the SOLVED `outputIdentityById`.)
  - `EntityMarkers` (INPUT map) — **NO output identity-map prop.** Its `MapWarehouse`/`MapCustomer`/`MapPlant` rows already carry `displayCode` — format `displayCode ?? id` DIRECTLY from the live row. This keeps the input map labelled from the live draft, never a stale solved snapshot.
- **City/State:** via `formatCityState` (import shared). `NetworkMap` warehouse/plant rows carry city/state; customer rows too (read the real props). `EntityMarkers` rows carry city/state.
- Optional props default to today's behavior so the standalone commit is unchanged for callers until INT wires `displayIdById`/`modelId`.
**Tests:** each renderer's tooltip contains `<Type> · <displayId> · City, State` for warehouse/mine/refinery/customer/station/plant; `formatCityState` handles a missing state (no trailing comma).
**Gate:** typecheck + studio test green.

*(Item 7 frontend — the JADE chip-editor swap + last-band guard + `JadeBandEditor` deletion — is folded into INT (Codex plan-review-3 P1), because removing the fixed editor breaks `Workspace.Integration.test.tsx`'s `jade-band-slot-*`/`jade-band-error`/invalid-draft-blocking assertions in the SAME unit that INT rewrites the Workspace validity gate. There is no standalone T7.)*

## T8 — item 3 filter-in-toolbar (input tabs) ONLY · leaf
**Files:** `components/workspace/tabs/{Warehouses,Customers,Mines,Stations,Plants}Tab.tsx` + `components/tables/{Warehouse,Customer,Mine,Station}Table.tsx` (+ tests). Spec §3.
- **Scope note (Codex plan-review-3 P1):** T8 does NOT touch the `showBaseTable`/`showAddedSection` branches — the `AddedEntitiesTab` + its two tests are still LIVE until INT, and they REQUIRE `showBaseTable={false}` to hide the base table; collapsing the branch in T8 would fail its own full studio-test gate. The base-tab branch collapse + test rewrite + prop deletion is the separate **CLEANUP** task, after INT deletes `AddedEntitiesTab`. T8 = item 3 only.
- **Item 3 filter relocation:** move the FilterMenu from inside the inner table (`WarehouseTable.tsx:100` `flex justify-end mb-1.5` row) up to the base tab's toolbar row, so Import/Export + Filter share ONE `flex items-center justify-between` header row (toolbar left, Filter right). Lift the `useTableFilters`/`FilterMenu` mount (or expose via a render-prop/context) keeping the `>10` gate. **JADE-enabled tabs only** — do NOT enable filters for non-JADE (the `enableFilters` prop already gates this; unchanged). Do not alter the add-section/base-table branches.
**Tests:** a JADE-enabled input tab renders the FilterMenu in the same header row as the toolbar (single row), not a separate row; a non-JADE input tab renders NO FilterMenu (unchanged). (Existing `showBaseTable`/`showAddedSection` base-tab tests remain untouched — CLEANUP rewrites them post-INT.)
**Gate:** typecheck + studio test green.

## T9 — map-tab plumbing: fixed-mine marker + output display-id forwarding (item 4) · needs T5
**Files:** `components/workspace/tabs/InputMapTab.tsx` + `components/workspace/tabs/OutputMapTab.tsx` (+ tests). Spec §4.
- **InputMapTab (input-live, NO output identity map — Codex plan-review-3 P2):** the fixed gold-mine bare `<Marker>` (~lines 197-204) tooltip → `Mine · <displayId> · <City>, <State>` + keep `(fixed)`, where `displayId = <the live mine row's displayCode> ?? id` (formatted DIRECTLY from the live row, not from any solved map). Thread only the role-type label + `modelId` into `EntityMarkers` (T5). **Do NOT pass `displayIdById` into the input path** — `EntityMarkers`/the fixed mine self-format from their own live `displayCode ?? id`, so an unsaved input rename/add is never labelled from a stale solved snapshot.
- **OutputMapTab — FORWARD ONLY, single path (Codex plan-review-2 P1):** `OutputMapTab` does NOT build `displayIdById` itself (added PLANTS aren't in its effective added-warehouse/customer arrays — they arrive via the separate `plants` prop, so a self-built map would miss them and show a plant's `aw-` uid). Instead `OutputMapTab` takes a `displayIdById?: Record<string,string>` prop and FORWARDS it to `<NetworkMap displayIdById={…}>`. **INT builds the ONE map from `outputIdentityById` (which already covers warehouses + customers + plants) and passes it down.** No `effectiveDataset`/`displayCode` change is needed for the id (city/state already survive the projection; the human display id now comes from `displayIdById`).
**Tests:** the fixed-mine tooltip shows `Mine · <displayId> · City, State (fixed)`; an added output warehouse, customer, AND **plant** marker each show their display code (not `aw-` uid) via the single `displayIdById` path (end-to-end through OutputMapTab→NetworkMap).
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

## INT — Workspace integration (sole `Workspace.tsx` writer) + item-7 editor swap, atomic · needs T3/T5/T8/T9/T10/T11
**Files:** `pages/Workspace.tsx` (+ `Workspace.*.test.tsx` incl. `Workspace.Integration.test.tsx`), `components/workspace/SolveDialog.tsx`, `components/workspace/tabs/OptimizationParametersTab.tsx`, DELETE `components/workspace/tabs/JadeBandEditor.tsx` (+ test), DELETE `components/workspace/tabs/AddedEntitiesTab.tsx` + `__tests__/AddedEntitiesTab.test.tsx` + `__tests__/Workspace.AddedEntities.test.tsx`. Spec §1, §2, §4, §7.
1. **Item 1 revert — complete enumeration (Codex plan-review P2):** remove the `added-entities` entry from every `inputEntriesForModel`; remove the `renderTabContent` `added-entities` branch; remove the dead `activeTab.entity === "added-entities"` **Save-placement/allowlist** condition; remove every base-tab `showAddedSection={false}`/`showBaseTable={false}` **call-site override** (leaving the base tabs' own branches for CLEANUP to collapse); DELETE `AddedEntitiesTab.tsx` + `AddedEntitiesTab.test.tsx` + `Workspace.AddedEntities.test.tsx`; update/remove the `Workspace.TabCoverage` matrix references to `added-entities`. **Finish with `rg "added-entities|AddedEntitiesTab" artifacts/studio/src` → expected: zero live references** (report the output). *(The base tabs still render inline by default once no caller passes `={false}`; their vestigial branches/props are collapsed in CLEANUP.)*
2. **Item 2 wiring:** build `outputIdentityById = buildEntityIdentityById(modelId, dataset, displayedInputs)` and `inputIdentityById = buildEntityIdentityById(modelId, dataset, localInputs)` (T3 helper). Pass `outputIdentityById` to the T10 output tables and `inputIdentityById` to the T11 input tables. (CostSummary compare resolves per-scenario internally — pass `scenarios`/`dataset` as it already does; no single-map prop for compare.)
3. **Item 4 wiring — ONE display-id map, OUTPUT PATH ONLY (Codex plan-review-2 P1 + plan-review-3 P2):** derive `displayIdById` (canonical→display) from `outputIdentityById` (covers warehouses+customers+plants). Pass `modelId` + that single `displayIdById` into `NetworkMap` **via `OutputMapTab` (output map) ONLY**. **Do NOT pass `displayIdById` into `InputMapTab`/`EntityMarkers`** — the input map self-formats from live rows (T5/T9), preserving input-live vs output-solved. Pass `modelId` into `InputMapTab`/`EntityMarkers` for the role label.
4. **Item 7 editor swap (ATOMIC — Codex plan-review-3 P1):** remove the `isJade`/`JadeBandEditor` branch in `SolveDialog` + `OptimizationParametersTab` → JADE renders the shared chip editor; add the **last-band `×` disabled at `length<=1`** guard in the shared chip editor; DELETE `JadeBandEditor.tsx`+test; remove the JADE band-validity gating on Save/Run in `Workspace.tsx` and the `onBandValidityChange`/fixed-4 plumbing; **rewrite `Workspace.Integration.test.tsx`'s obsolete `jade-band-slot-*`/`jade-band-error`/invalid-draft-blocking cases** to the chip-editor behavior — all in this one commit so the studio-test gate stays green.
**Tests (Workspace):** no `added-entities` sidebar entry for any model; each base tab shows its inline add-section; identity maps reach the tables; **input-live vs output-solved: an unsaved input display-code edit updates the Input Map WITHOUT relabelling the Output Map / a solved output grid** (Codex plan-review-3 P2); an added output warehouse/customer/plant marker shows its display code; JADE renders the chip editor + Save works with a 3/5-band scenario (no validity block); last band `×` disabled at length 1.
**Gate:** FULL — `pnpm run typecheck` 0 errors, `pnpm --filter studio test` green (documented CPU-contention flakes acceptable only if they pass isolated).

## CLEANUP — base-tab branch collapse + test rewrite + prop deletion (item 1) · needs INT
**Files:** `components/workspace/tabs/{Warehouses,Customers,Mines,Stations,Plants}Tab.tsx` + their 5 test files. Spec §1.
Runs AFTER INT (which deleted `AddedEntitiesTab` + `AddedEntitiesTab.test.tsx` + `Workspace.AddedEntities.test.tsx` and removed every `showBaseTable={false}`/`showAddedSection={false}` caller — Codex plan-review-3 P1). Now that no caller passes the flags and no live test requires the added-only rendering:
- **Collapse the branches:** remove each base tab's `!showBaseTable` early-return + the `showAddedSection`-gate so each ALWAYS renders its base table + inline add-section (the permanent post-revert shape).
- **Rewrite the 5 base-tab tests:** replace the obsolete `showBaseTable={false}`/`showAddedSection={false}` cases with permanent inline-add assertions (base table + toolbar + `+ Add …` all present).
- **Delete the props:** remove the now-dead `showBaseTable`/`showAddedSection` prop declarations + destructuring.
**Gate:** `pnpm run typecheck` (0) AND `pnpm --filter studio test` green — a full studio run (behavioral cleanup, not just typecheck). Executed by a dedicated agent in its own worktree (cut from the post-INT tip), cherry-picked + re-gated like every task.

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
`pnpm run typecheck` (0) + `pnpm --filter studio test` + `pnpm --filter api-server test` (T4) — every integrated commit passes zero-error typecheck (no transient-red allowance). No `e2e_accuracy.py` (no solver/dataset change). Whole-branch review (independent fable lens) → merge to local `main`. **Deploy impact (Codex plan-review-2 P2): BOTH services** — `nos-studio` (all frontend items) AND `nos-api` (T4's runtime `jadeInputs` validation change). Deploy held unless approved; when approved, redeploy both.

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

---

## Re-review comments — Codex (2026-09-20) — SUPERSEDED / RESOLVED (history)

**Status: RESOLVED.** All 4 round-2 comments folded into Process/T8/T9/INT/POST-INT/Gate; see the round-2
resolution table below. Retained for history. Original round-2 status was "changes requested".

### [P1] Complete the post-INT base-tab cleanup and run the affected tests

The POST-INT step says to remove `showBaseTable` (and optionally `showAddedSection`) only from the five
base-tab interfaces and destructuring. Those variables are also used by conditional render branches in
each tab, so deleting only the prop declarations leaves either compile errors or obsolete branches. The
existing `WarehousesTab`, `CustomersTab`, `MinesTab`, `StationsTab`, and `PlantsTab` tests also explicitly
exercise `showBaseTable={false}` and `showAddedSection={false}`. The cleanup must remove/collapse the
associated render branches and rewrite/remove those obsolete test cases in favor of permanent inline-add
assertions, as required by spec section 1. Assign the five test files to this cleanup in the ownership map
and run `pnpm --filter studio test` as well as `pnpm run typecheck`; typecheck alone does not prove the
behavioral cleanup.

### [P1] Define one output-map display-ID path that includes added plants

T9 says `OutputMapTab` builds `displayIdById` from the effective added warehouse/customer arrays plus base
data, while INT says it passes `displayIdById` through `OutputMapTab`. These are conflicting ownership/data-
flow descriptions. More importantly, added plants are not in either effective added array: they arrive via
the separate `plants` prop, with the current projection storing `displayCode ?? id` in `Plant.name`. A
literal T9 implementation can therefore pass the warehouse/customer tests but still show an added plant's
canonical uid, contrary to the listed added-plant test and spec section 4. Choose one explicit contract.
The preferred approach is for INT to derive the canonical-id-to-display-id projection from
`outputIdentityById`, pass it to `OutputMapTab`, and have `OutputMapTab` forward it to `NetworkMap`; this
single path covers warehouses, customers, and plants. If T9 owns construction instead, it must explicitly
include the `plants` prop (`name ?? id`) and document precedence/collision behavior. Make the added-plant
test exercise the chosen end-to-end path.

### [P2] Make the per-cherry-pick typecheck policy internally consistent

Process currently permits transient typecheck-red leaf commits with a "known set" of errors, but the
controller Gate requires `pnpm run typecheck` with zero errors after every cherry-pick. The revised T7/T8
sequencing was specifically changed to keep leaf commits green, and no remaining task defines a concrete
expected-error set. Remove the transient-red allowance and require every integrated commit to pass the
zero-error controller gate. If a genuinely atomic caller/callee migration is later found, merge it as one
integration unit rather than weakening the gate with an unspecified exception.

### [P2] Correct the deployment impact statement

The final Gate says the change is `nos-studio` only and then immediately says `nos-api` needs a redeploy.
T4 changes runtime API validation, so the deployment note must state that both `nos-studio` and `nos-api`
are affected when deployment is approved. Deployment may remain held pending approval, but the service
scope must not be contradictory.

---

## Review resolution — round 2 (Codex plan review, 2026-09-20)

**Current status: RESOLVED — no open items.**

| # | Comment | Disposition |
|---|---------|-------------|
| P1 | Post-INT cleanup must collapse branches + rewrite tests, not just delete decls | **Accepted.** T8 (owns base tabs + their 5 tests) now collapses the `showBaseTable`/`showAddedSection` render branches AND rewrites the 5 tests to permanent inline-add assertions, keeping only vestigial optional prop decls; POST-INT deletes just the decls + runs studio test AND typecheck. |
| P1 | One output-map display-id path incl. added plants | **Accepted.** Single path: INT builds `displayIdById` from `outputIdentityById` (covers warehouses+customers+**plants**); `OutputMapTab` only FORWARDS it to `NetworkMap`; no `effectiveDataset`/`displayCode` change. Added-plant marker tested end-to-end. |
| P2 | Transient-red vs zero-error gate inconsistency | **Accepted.** Removed the transient-red allowance — every integrated commit passes the zero-error gate (no task is intentionally red after the round-1 folds); atomic caller/callee migrations merge as one unit if ever needed. |
| P2 | Contradictory deploy scope | **Accepted.** Gate now states BOTH `nos-studio` (frontend) AND `nos-api` (T4 runtime validation) are affected; deploy held, redeploy both when approved. |

---

## Re-review comments — round 3 (Codex, 2026-09-20) — SUPERSEDED / RESOLVED (history)

**Status: RESOLVED.** All 4 round-3 comments folded into the ownership map/waves/T4/T5/T8/T9/INT/CLEANUP;
see the round-3 resolution table below. Retained for history. Original round-3 status was "changes requested".

### [P1] T8 cannot collapse the base-tab branches before INT deletes Added Entities

T8 now makes the five base tabs ignore `showBaseTable={false}` and `showAddedSection={false}`, while the
`AddedEntitiesTab` component, its test, and `Workspace.AddedEntities.test.tsx` remain live until INT. Those
tests explicitly require `showBaseTable={false}` to render only the added section and hide each base table/
toolbar. Consequently T8's required full `pnpm --filter studio test` gate will fail before INT is
cherry-picked; the intermediate application also renders full base tables inside the still-present Added
Entities tab. Keep T8 limited to the filter relocation. After INT removes the Added Entities entry,
component, and its two tests, perform the five-tab branch collapse, base-tab test rewrites, and prop
deletion as one post-INT cleanup (or merge those changes atomically with INT), then run typecheck + the full
studio suite.

### [P1] T7 must update the Workspace fixed-band integration tests in the same green unit

T7 replaces `JadeBandEditor` with the free chip editor, but the existing
`Workspace.Integration.test.tsx` still mounts the real fixed editor and asserts `jade-band-slot-*`,
`jade-band-error`, and invalid-draft Save/Solve blocking. The plan assigns `Workspace.*.test.tsx` to the
later INT task, so T7's standalone full studio-test gate cannot be green. Either give T7 ownership of the
affected Workspace integration tests and replace the obsolete fixed-editor/gating cases in that task, or
move the editor replacement, Workspace validity-gate removal, and test rewrite into one atomic integration
unit. Preserve the zero-error/per-cherry-pick green rule.

### [P1] T4 must update the route-level wrong-count assertion

`artifacts/api-server/src/__tests__/routes.test.ts` currently asserts that a three-entry JADE
`distanceBands` request returns 422 because the schema requires exactly four. T4 changes the schema to
`.min(1)` but only lists the schema unit test, so its full `pnpm --filter api-server test` gate will retain
an assertion that is now intentionally false. Add `routes.test.ts` to T4 ownership and replace the obsolete
wrong-count rejection with route-level acceptance coverage for the new free-band rule; keep the
non-positive and non-ascending rejection cases.

### [P2] Do not pass the solved output identity projection into the live input map

T5 correctly defines input marker display identity from each live `MapWarehouse`/`MapCustomer`/`MapPlant`
row's `displayCode ?? id`; it adds `displayIdById` only to `NetworkMap`. T9 nevertheless refers to an
`EntityMarkers` `displayIdById` prop as though T5 created it, and INT says to derive that map from
`outputIdentityById` (`displayedInputs`) and pass it to both output and input maps. An unsaved input rename/
add can therefore be labelled from the stale solved snapshot, contrary to the input-live/output-solved
split. Keep the solved `displayIdById` path exclusive to `OutputMapTab` → `NetworkMap`. `EntityMarkers` and
the fixed mine in `InputMapTab` should format their live row's own `displayCode ?? id` directly; no output
identity-map prop is needed on the input path. Add or retain a regression proving an unsaved input display-
code edit updates the Input Map without relabelling the Output Map.

---

## Review resolution — round 3 (Codex plan review, 2026-09-20)

**Current status: RESOLVED — no open items.**

| # | Comment | Disposition |
|---|---------|-------------|
| P1 | T8 can't collapse base-tab branches before INT deletes Added Entities | **Accepted.** T8 is now **filter-relocation only**; the base-tab branch collapse + test rewrite + prop deletion moved to a dedicated **CLEANUP** task after INT deletes `AddedEntitiesTab` + its two tests. Each stays green. |
| P1 | T7 editor swap breaks `Workspace.Integration.test.tsx` in its own unit | **Accepted.** T7 dissolved — the item-7 editor swap (SolveDialog/OptParams/delete JadeBandEditor + last-band guard) is folded into **INT**, atomic with the Workspace validity-gate removal AND the `Workspace.Integration.test.tsx` rewrite. |
| P1 | T4 must fix the route-level wrong-count assertion | **Accepted.** T4 now owns `routes.test.ts`'s JADE band cases — replaces the obsolete 3-entry→422 assertion with free-band acceptance; keeps non-positive/non-ascending rejection. |
| P2 | Don't pass solved output identity into the live input map | **Accepted.** `displayIdById` (from solved `outputIdentityById`) goes ONLY to `OutputMapTab`→`NetworkMap`; `EntityMarkers` + the fixed mine self-format from their live rows' `displayCode ?? id`; INT passes no identity map to the input path; regression: unsaved input display-code edit updates the Input Map, not the Output Map. |
