# Workspace fixups bundle — Implementation Plan

**Date:** 2026-09-19 · **Base:** `main` (`15144a0`) · **Spec:** `docs/superpowers/specs/2026-09-19-workspace-fixups-bundle-design.md` (approved, 2 review rounds folded).
**Execution:** agent-team, isolated git worktrees; controller cherry-picks each task onto the branch + re-gates on the merged state. **Frontend-only** — zero backend/solver/dataset/OpenAPI/Python. `e2e_accuracy.py` not run.

## Process (standing lessons baked in)
- **Base guard** on every agent prompt (JADE-bundle lesson): before implementing, run
  `git merge-base --is-ancestor <branch-tip> HEAD` and report `BASE_OK`/`BASE_STALE`; stop if stale.
- **Explicit-pathspec commits** (`git commit -m … -- <paths>`), `git status` before commit, agents never
  push or touch `main` — controller integrates.
- **Optional-props pattern** for per-commit-green: leaf tasks add new props/flags as
  optional-with-safe-default so their standalone commit typechecks; the single Workspace writer (INT)
  wires the real values at the call sites.
- **Single-writer files:** `Workspace.tsx` → INT only. Every other file has exactly one owning task.
- Docs merged to local `main` on creation; QA is a first-class task (standing feedback).

## File → task ownership (no overlaps)
| File | Task |
|---|---|
| `lib/bands.ts` (+ test) | T1 |
| `lib/formatLocation.ts` (+ test) | T2 |
| `components/workspace/map/EntityMarkers.tsx`, `index.css`, `__tests__/designTokens.contract.test.ts` | T3 |
| `components/workspace/tabs/CapabilityMatrixTab.tsx` (+ test) | T4 |
| `components/workspace/tabs/ServiceStatsTab.tsx` (+ test) | T5 |
| `components/workspace/tabs/JadeFlowsTab.tsx` (+ test) | T6 |
| `components/workspace/tabs/JadeAssignmentsTab.tsx` (+ test) | T7 |
| `components/workspace/tabs/{Warehouses,Customers,Mines,Stations,Plants}Tab.tsx` (+ tests) | T8 |
| `components/workspace/tabs/AddedEntitiesTab.tsx` (new, + test) | T9 |
| `pages/Workspace.tsx` (+ `Workspace.*.test.tsx`, `Workspace.TabCoverage.test.tsx`) | INT |
| `e2e/workspace-fixups.spec.ts` (new) | QA |

## Waves
- **Wave 1 (parallel, file-disjoint):** T1, T2, T3, T8.
- **Wave 2 (parallel, after deps):** T4 (needs T2), T5 (needs T2), T6 (needs T1+T2), T7 (needs T1), T9 (needs T8).
- **Wave 3:** INT (needs T6 + T8 + T9). Sole `Workspace.tsx` writer.
- **Wave 4:** QA.

---

## T1 — `bandRangeLabel` helper (item 5 foundation) · leaf
**File:** `artifacts/studio/src/lib/bands.ts` (+ `bands.test.ts`). Spec §5.
- Add `export function bandRangeLabel(distance: number, bands: number[], unit: string): string`.
  - Sort a copy first: `const sorted = [...bands].sort((a,b)=>a-b);` — classify AND build the label off
    `sorted` (parity with `bandLabel`/`assignBandOrOverflow`).
  - `sorted.length === 0` → `"All distances"`.
  - Reuse `assignBandOrOverflow(distance, sorted)` for the bucket index; `OVERFLOW_BAND` → `"> <last> <unit>"`.
  - index 0 → `"≤ <sorted[0]> <unit>"`; index i>0 → `"<sorted[i-1]>–<sorted[i]> <unit>"`.
  - Number formatting: match the tabs' existing numeric display (integer boundaries; no thousands sep
    unless `bandLabel`'s neighbors already use one — keep consistent with the cell).
**Tests:** each band + overflow for `mi` and `km`; **exact-boundary** distances (a distance equal to a
boundary lands in that boundary's band, matching `assignBandOrOverflow`'s `<=`); **unsorted** input
(`[500,250,1000]`) yields the same labels as sorted; empty `[]` → `"All distances"`.

## T2 — `plantIdCityState` helper (item 2 foundation) · leaf
**File:** `artifacts/studio/src/lib/formatLocation.ts` (+ its test). Spec §2.
- Add `export function plantIdCityState(plant: { id: string; city: string; state: string; name?: string }): string`
  → `` `${plant.id} — ${formatCityState(plant.city, plant.state)}` `` (reuse existing `formatCityState`).
  `name?` is in the type (documents the name-ignored contract + avoids TS excess-property errors when a
  literal with `name` is passed — Codex plan-review P2) but is deliberately NOT read.
**Tests:** id + City, State; a plant object literal WITH a `name` still returns id + City, State (name
ignored — compiles because `name?` is in the param type); empty state → `formatCityState`'s existing behavior.

## T3 — plant factory icon + token (item 1) · leaf
**Files:** `EntityMarkers.tsx`, `index.css`, `__tests__/designTokens.contract.test.ts` (+ `EntityMarkers` test). Spec §1.
- `index.css`: add `--map-plant: #2E7D32;` in the same `--map-*` block (line ~361).
- `EntityMarkers.plantSquareSvg()`: replace the `<rect>` body with a filled factory silhouette
  (saw-tooth roof + 3 windows), `fill="var(--map-plant)"`, keeping `width/height=20`, `viewBox 0 0 24 24`.
- `designTokens.contract.test.ts`: add `--map-plant` (`#2E7D32`) to the exhaustive raw-token inventory.
- `EntityMarkers` test: `plantSquareSvg()` output contains `var(--map-plant)` and the factory path
  (no bare `<rect …stroke=…/>` square). Marker sizing unchanged (still 20/24 envelope).
**Note:** single edit — Output-map `createPlantIcon` + legend both consume `plantSquareSvg`, so they
inherit the factory with no further change (verify by reading, do not edit those call sites).

## T4 — Capability Matrix: plant row + info line + Units (items 2 & 3) · leaf, needs T2
**File:** `CapabilityMatrixTab.tsx` (+ test). Spec §2, §3.
- Item 2: the per-plant row header cell uses `plantIdCityState(plant)` (import from T2).
- Item 3a: info `<p>` (line 127) — remove `max-w-md`, add `md:whitespace-nowrap`. Text unchanged.
- Item 3b: capacity readout (~line 170) → append `" Units"` (enabled value AND the disabled `0` → `0 Units`).
**Tests:** plant row shows `<id> — <City>, <State>`; info `<p>` has `md:whitespace-nowrap` and NOT
`max-w-md`; a capacity readout renders `… Units` (and `0 Units` for a disabled cell).
**Standalone-green:** import `plantIdCityState` from T2 — if T2 not yet merged in the worktree, the base
guard + wave ordering guarantees T2 landed first; do not stub.

## T5 — Plant Production plant label (item 2) · leaf, needs T2
**File:** `ServiceStatsTab.tsx` (+ test). Spec §2.
- Plant Production row: `plantLabel` (line 106, currently `plant.name ?? plant.id`) → `plantIdCityState(plant)`.
  Uses the already-passed `effectivePlants` (dataset ∪ addedPlants snapshot) — no new prop.
**Tests:** a Plant Production row (incl. one sourced from an added plant already in `effectivePlants`)
renders `<id> — <City>, <State>`.

## T6 — JadeFlowsTab: plant label + effective-plants prop + band ranges (items 2 & 5) · leaf, needs T1+T2
**File:** `JadeFlowsTab.tsx` (+ test). Spec §2, §5.
- **Item 2:** add an OPTIONAL prop `effectivePlants?: Plant[]` (default `undefined` → falls back to
  `dataset?.plants`, so the standalone commit is green and unchanged for base plants). The P→W Plant
  column resolves via `plantIdCityState` against `effectivePlants ?? dataset?.plants ?? []`. INT will
  pass the real `dataset.plants ∪ addedPlantsFromInputs(displayedInputs)`.
  **`pwRows` memo dep (Codex plan-review round 2 P1):** `pwRows` is memoized `[result, dataset,
  effectiveBands.join(",")]` and builds `plantLabel` via `plantIdCityState` — so it MUST also depend on
  the effective plants' **label fields, not just ids**. An id-only signature
  (`…map(p=>p.id).join(",")`) is INSUFFICIENT: a plant keeping its id while its City/State changes would
  leave a stale label. Use one of: (a) a signature serializing `id`+`city`+`state` with safe separators
  (e.g. `…map(p=>`${p.id}|${p.city}|${p.state}`).join(";")`); OR (b) a plant-id→label `Map` memoized on
  the actual memoized `effectivePlants` reference, with `pwRows` depending on that Map. `wcRows` builds
  no plant label — leave it unchanged.
- **Item 5 (both inner tables):** for BOTH `pwDescriptors` and `wcDescriptors`, change the `band`
  descriptor `accessor` to `r => bandRangeLabel(r.distance, effectiveBands, unit)` (import T1's helper);
  add `[effectiveBands.join(","), unit]` to each `useMemo` dep array; add a clear-on-change effect PER
  inner table that resets only that table's `band` filter key when `[effectiveBands.join(","), unit]`
  changes (leave the table's other filters intact). `unit` = the tab's existing `distanceUnit`.
**Tests:** P→W Plant column shows `<id> — <City>, <State>`; **added-plant via `effectivePlants` prop**
resolves to id+City,State not raw id; **rerender with SAME `result`+`dataset`+plant-`id` but a CHANGED
City/State in `effectivePlants` updates the P→W label** (proves the label-field signature, not just
membership/new-id — Codex round-2 P1); both
inner-table band filters list ranges; a rerender with changed `bands` changes the options with no
network call (proves memo deps); selecting a range in each inner table then changing bands clears THAT
table's `band` key while a non-band filter in the same table survives; the two inner tables' clears are
independent.

## T7 — JadeAssignmentsTab: band ranges (item 5) · leaf, needs T1
**File:** `JadeAssignmentsTab.tsx` (+ test). Spec §5.
- `filterDescriptors`: `band` accessor → `r => bandRangeLabel(r.distanceMi, effectiveBands, unit)`;
  add `[effectiveBands.join(","), unit]` to the `useMemo` deps; add the clear-on-change effect for
  `tableFilters`' `band` key.
**Tests:** band filter lists ranges; rerender-with-changed-bands updates options (no network); select
range → edit bands → band filter cleared, non-band filter survives.

## T8 — base tabs: showAddedSection / showBaseTable flags (item 4 part A) · leaf
**Files:** `WarehousesTab.tsx`, `CustomersTab.tsx`, `MinesTab.tsx`, `StationsTab.tsx`, `PlantsTab.tsx` (+ tests). Spec §4.
- Each tab: add `showAddedSection?: boolean` (default `true`) and `showBaseTable?: boolean` (default `true`).
- **`showBaseTable={false}`** must hide: base `<Table>`, base count/filter, base empty state, CSV
  Upload/Download toolbar, AND the import dialog. Leaves ONLY: add-row form + added-rows table +
  precheck chips + delete.
- **`showAddedSection={false}`** hides: add-row form + added-rows table (the `addedSection`). Leaves the
  base table + count/filter + empty state + toolbar + import dialog.
- Defaults `true`/`true` → existing render byte-identical; standalone commit green.
- **Dead-prefill cleanup — T8's half (Codex plan-review P1, deterministic split):** remove the
  `prefillCoords` / `onPrefillConsumed` props from all five base-tab prop interfaces + their
  destructuring, remove the now-dead prefill open-effect in each, and delete the prefill / null-prefill
  component tests in each base tab's test file. **T8 does NOT touch `Workspace.tsx`** (INT removes the
  call-site props + `pendingPrefill` state — see INT). Neither task edits the other's files.
**Tests (per tab that has both regions) — match the REAL add-form state machine (Codex round-2 P2):**
the base tabs render a `+ Add …` button while `addingRow` is false and the form only after it's clicked
(`setAddingRow(true)`) — do NOT assert an open form on initial render (that would contradict
"byte-identical" and push an unintended UX change).
1. `showBaseTable={false}`: the added-only region + the `+ Add …` affordance render, while the base
   table, CSV toolbar, import trigger, and base filter do NOT.
2. Click `+ Add …` → the add form renders.
3. `showAddedSection={false}`: neither the add affordance nor the form nor the added-rows table renders,
   while the base table + toolbar remain.
4. Default (both `true`): unchanged.
Prefill tests deleted (flow dead).

## T9 — AddedEntitiesTab (item 4 part B) · needs T8
**File:** `AddedEntitiesTab.tsx` (new, + test). Spec §4.
- New component: props = model's supported added-entity sub-tab set + all the pass-through props each
  base tab needs (`addedWarehouses`/`onAddedWarehousesChange`/…, precheck errors, `hasStateColumn`, etc.).
- Renders a segmented inner-tab control (mirror `JadeFlowsTab`'s `innerTab` state + styling) with one
  sub-tab per supported type; each sub-tab body = the corresponding base `*Tab` rendered with
  `showBaseTable={false}`.
- Sub-tab sets: us/brazil → Warehouses, Customers; transport → Mines, Stations; gold-au → Refineries,
  Customers; jade → Plants, Warehouses, Customers; chens → Warehouses, Customers. (Component takes the
  set as a prop; INT supplies it per model — do not hardcode a model switch inside the component.)
**Tests:** given a 2-sub-tab set, both inner tabs render; switching inner tabs swaps the base tab
(added-only); no base table/toolbar in any sub-tab; add/delete callbacks fire through.

## INT — Workspace integration (items 2, 4, 5 wiring + cleanup) · sole `Workspace.tsx` writer · needs T6+T8+T9
**Files:** `pages/Workspace.tsx`, `Workspace.*.test.tsx`, `Workspace.TabCoverage.test.tsx`. Spec §2, §4.
1. **Item 2 Flows wiring:** pass a **deduped, memoized** effective-plants projection to `<JadeFlowsTab>`
   — the SOLVED snapshot `displayedInputs`, never `localInputs`. Concatenation does NOT dedupe (Codex
   plan-review P2). Actual algorithm: seed a `Map` with base `dataset.plants` keyed by id, then add each
   `addedPlantsFromInputs(displayedInputs)` plant ONLY if its id is absent (base wins on collision);
   `[...map.values()]`. Memoize on `[dataset, displayedInputs]` so unrelated Workspace renders don't
   rebuild the array (keeps `JadeFlowsTab`'s `pwRows` memo stable). Add an **id-collision regression**:
   an added plant sharing a base plant's id resolves to the BASE plant's City/State.
2. **Item 4 sidebar:** append `{ id: "added-entities", label: "Added Entities" }` to every model's
   `inputEntriesForModel(...)` list (after the last entity tab, before Optimization Parameters).
3. **Item 4 renderTabContent:** new branch `activeTab.entity === "added-entities"` → `<AddedEntitiesTab …>`
   with the per-model sub-tab set + all base-tab pass-through props.
4. **Item 4 base call sites:** every base `*Tab` render passes `showAddedSection={false}`.
5. **Item 4 save gate:** add `added-entities` to the save-eligible allowlist (`Workspace.tsx:1811+`).
6. **Dead-code cleanup — INT's half (Codex plan-review P1):** remove `pendingPrefill` state +
   `setPendingPrefill` from `Workspace.tsx` and remove every `prefillCoords`/`onPrefillConsumed` prop
   passed at the base-tab call sites. **INT does NOT touch the base-tab files** — T8 owns the interface,
   destructuring, dead effects, and prefill component tests (see T8). The two halves are disjoint by file.
**Tests:**
- **Workspace-level added-plant snapshot regression:** displayed snapshot has an added plant, unsaved
  `localInputs` draft differs → Flows plant label resolves from the snapshot; step result history and
  assert lookup + displayed result advance together.
- **Per-model Added-Entities integration matrix — all SIX model ids (Codex round-2 P2):** data-driven
  over every route, each executed (US and Brazil may share a fixture builder but BOTH must run — today's
  `Workspace.TabCoverage.test.tsx` has suites for only us/transport/gold/jade; Brazil is deliberately
  excluded there and Chen absent, so "extend for every model" needs NEW Brazil + Chen coverage, not just
  edits):
  1. `p-median-us` → {Warehouses, Customers}
  2. `p-median-brazil` → {Warehouses, Customers}
  3. `transport-coal` → {Mines, Stations}
  4. `two-echelon-gold-au` → {Refineries, Customers}
  5. `two-echelon-jade-us` → {Plants, Warehouses, Customers}
  6. `chens-cosmetics-cn` → {Warehouses, Customers}
  Assert each renders EXACTLY its inner sub-tab set + the presentation wiring (JADE Customers per-product
  demand mode, Gold `entity="refineries"`, Chen `hasStateColumn={false}`).
- **Model-specific data + mutation wiring proof (Codex round-2 P2) — substantiates the "add/edit/delete/
  precheck byte-identical, just relocated" DoD:** for at least Gold (highest risk — its Refineries
  sub-tab reuses `WarehousesTab`, so INT must bind the generic `addedWarehouses`/`onAddedWarehousesChange`
  props to the model's `addedRefineries` array and translate edits/deletes back to `addedRefineries`,
  NOT `addedWarehouses`), prove: (a) an existing added row RENDERS from the correct model-specific array;
  (b) editing an added-row field calls the correct callback and updates the correct `localInputs` key;
  (c) delete removes from the correct key; (d) the model's precheck chip reaches the relocated row.
  Repeat (a)+(b) for one non-reuse model (e.g. JADE Plants → `addedPlants`) so the pattern isn't
  Gold-specific.
- `Workspace.TabCoverage.test.tsx` extended with `added-entities` for every model that has a suite; add
  Brazil + Chen suites (or fold their `added-entities` coverage into the new matrix above).
- RTL: base tab shows no inline add section; Added Entities tab shows the correct sub-tabs; placing an
  entity on the Input Map (existing in-place flow) makes the row appear in the Added Entities sub-tab.

## QA — real browser (qa-sdet) · last
**File:** `e2e/workspace-fixups.spec.ts` (new). Spec §7. Run **twice**; report product bugs to controller.
- **Target the MERGED branch, not the config default (Codex plan-review P1):** `playwright.config.ts`
  defaults `BASE_URL` to a remote Replit URL and defines no `webServer`, so an unset `E2E_BASE_URL`
  would test stale remote code. Serve the merged branch locally (CLAUDE.md recipe): api-server
  `DATABASE_URL=... PORT=3001 pnpm --filter api-server run dev`; studio
  `PORT=<p> BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 pnpm --filter studio run dev`; run
  `E2E_BASE_URL=http://127.0.0.1:<p> npx playwright test e2e/workspace-fixups.spec.ts` (from
  `artifacts/studio`). **Both green runs must be recorded against the explicit local branch URL** — a
  run against the config's default remote URL is not accepted evidence.
- Plant markers = factory on Input + Output maps + legend (JADE).
- A plant-bearing table shows id + City, State.
- Capability Matrix: single-line info at desktop; readouts end in `Units`.
- Added Entities tab present for ≥2 models; place an entity on the Input Map → row appears in the
  correct Added Entities sub-tab → Save persists; base tab has no inline add section; CSV toolbar only
  on the base tab.
- **Band-range clear via a mount-preserving surface (Codex plan-review QA note):** with a JADE OUTPUT
  tab (Flows or Customer Assignments) active and a range filter selected, edit the bands via the **Run
  Optimizer (SolveDialog) modal** — it hosts `JadeBandEditor` and opens OVER the active tab WITHOUT
  unmounting it (verified). Navigating to the Optimization Parameters tab instead would unmount the
  report and reset filters — a false "cleared". Assert: options re-range live (no `/solve` fired by the
  edit itself), an **unrelated non-band filter in the same table survives**, and the band filter is
  cleared. Also verify filtering by a range selects the right rows.

## Gate (controller, on merged state after each cherry-pick + final)
`pnpm run typecheck` + `pnpm --filter studio test`. (api-server/pytest unaffected — frontend-only; do
NOT run `e2e_accuracy.py`.) Then whole-branch review (independent lens) → merge to local `main`.
Deploy held unless approved (frontend-only → `nos-studio`).

---

## Review comments — Codex (2026-09-19) — SUPERSEDED / RESOLVED (history)

**Status: RESOLVED.** All seven comments folded into the task bodies above; see the resolution table at
the end. Retained verbatim for history. Original round status was "changes requested".

### [P1] Point browser QA at the merged branch, not the default remote deployment

The plan schedules real-browser QA before deployment and then explicitly holds deployment unless it is
approved. However, `artifacts/studio/playwright.config.ts` defaults `BASE_URL` to an existing remote
Replit deployment when `E2E_BASE_URL` is absent and defines no local `webServer`. As written, both QA
runs can pass while exercising none of the code from this branch.

Specify how the merged branch is served locally or through an approved preview, set `E2E_BASE_URL`
explicitly, and provide the exact targeted Playwright command. The QA evidence/final gate must record
two successful runs against that explicit branch URL; do not accept a run against the config's default
remote URL. For example, if local auth/API configuration supports it, start the merged Studio build on
a known port and run the targeted spec twice with `E2E_BASE_URL=http://127.0.0.1:<port>`.

### [P1] Add `effectivePlants` to the P→W row memo contract

T6 changes P→W plant resolution to read the new `effectivePlants` prop, but only prescribes new memo
dependencies for the filter descriptors. The current `pwRows` value is itself memoized with
`[result, dataset, effectiveBands.join(",")]`. If `effectivePlants` changes without one of those values
changing, the table retains stale plant labels.

Require `effectivePlants` (or a stable plant-lookup signature derived from it) in the `pwRows` memo
dependencies. Because INT currently proposes an inline array, either memoize the effective-plants
projection in Workspace or use a stable signature/lookup in `JadeFlowsTab` so unrelated Workspace
renders do not force row reconstruction. Add a component regression that rerenders with the same
`result` and `dataset` but a changed `effectivePlants` collection and observes the new plant label.

### [P1] Assign dead-prefill cleanup according to the single-writer map

The ownership table assigns the five base tab files and their tests exclusively to T8, and
`Workspace.tsx` exclusively to INT. The INT task nevertheless says "T8 or INT" may remove a base
tab's prefill effect. That is ambiguous and permits either an ownership violation or incomplete
cleanup.

Assign the work deterministically:

- **T8:** remove `prefillCoords` / `onPrefillConsumed` from all five base-tab prop interfaces and
  destructuring; remove the five dead effects and the ten existing prefill/null-prefill component
  tests.
- **INT:** remove `pendingPrefill` / `setPendingPrefill` from Workspace and remove every base-tab
  call-site prop.

Neither task should edit the other's owned files.

### [P2] Prove every model's Added Entities sub-tab contract

T9 tests only an arbitrary two-subtab set, while Tab Coverage proves only that the outer
`added-entities` entry renders. Neither test guarantees that INT supplies the correct per-model inner
set or the model-specific props required by the reused base components.

Add a data-driven Workspace integration matrix covering all five configurations:

- `p-median-us` / `p-median-brazil`: Warehouses, Customers
- `transport-coal`: Mines, Stations
- `two-echelon-gold-au`: Refineries, Customers
- `two-echelon-jade-us`: Plants, Warehouses, Customers
- `chens-cosmetics-cn`: Warehouses, Customers

Also exercise the highest-risk model-specific wiring: JADE Customers remains in per-product demand
mode; Gold passes `entity="refineries"`; Chen passes `hasStateColumn={false}`. A generic T9 callback
test alone will not detect those integration regressions.

### [P2] Make the T2 helper type consistent with the name-ignored test

T2 declares `plantIdCityState` with the structural parameter
`{ id: string; city: string; state: string }`, but its test explicitly passes a plant with `name` to
prove the name is ignored. A direct object literal with `name` fails TypeScript excess-property
checking.

Include `name?: string` in the helper's structural parameter type (while deliberately not reading it),
or type the test fixture as the generated `Plant` before passing it. The former documents the
name-ignored contract more clearly.

### [P2] Replace the non-deduplicating effective-plants example

INT says to pass
`[...(dataset?.plants ?? []), ...addedPlantsFromInputs(displayedInputs)]` and labels it "dedupe by id,
base wins," but concatenation does not deduplicate. Replace the example with the actual projection
algorithm: seed a keyed collection with base plants, then add only scenario plants whose ids are not
already present. Add an ID-collision regression proving the base plant wins.

### QA clarification — preserve the mounted report while editing bands

The real-browser test for clearing an active band filter must edit bands through a surface that leaves
the output report mounted, such as the Run Optimizer modal over the active output tab. Navigating to a
different Workspace tab may unmount the report and discard all filter state, producing a false-positive
"cleared" result without exercising the keyed clear-on-change effect. State the exact UI path in the QA
task and assert that an unrelated active filter survives the band edit.

---

## Review resolution (Codex plan review, 2026-09-19)

**Current status: RESOLVED — no open items.** All folded into the task bodies.

| # | Comment | Disposition |
|---|---------|-------------|
| P1 | QA points at default remote deployment | **Accepted.** Verified `playwright.config.ts` defaults `BASE_URL` to a Replit URL, no `webServer`. QA task now mandates local serve + explicit `E2E_BASE_URL` + exact command; both green runs recorded against the local branch URL. |
| P1 | `effectivePlants` missing from `pwRows` memo | **Accepted.** Verified `pwRows` deps `[result, dataset, effectiveBands.join(",")]` build `plantLabel`. T6 adds an effective-plants signature to `pwRows` deps + a changed-effectivePlants-only regression. |
| P1 | Dead-prefill cleanup ownership ambiguous | **Accepted.** Deterministic split: T8 owns base-tab interfaces/destructuring/dead effects/prefill tests; INT owns `pendingPrefill` state + call-site props. Disjoint by file. |
| P2 | Prove every model's Added-Entities sub-tab set | **Accepted.** INT adds a data-driven 5-config matrix + high-risk wiring asserts (JADE per-product demand, Gold `entity="refineries"`, Chen `hasStateColumn={false}`). |
| P2 | T2 helper type vs name-ignored test | **Accepted.** `name?: string` added to the param type (not read). |
| P2 | Non-dedup effective-plants concat | **Accepted.** INT uses a keyed `Map` projection (base wins), memoized on `[dataset, displayedInputs]`; id-collision regression. |
| QA | Edit bands via a mount-preserving surface | **Accepted.** Verified SolveDialog hosts `JadeBandEditor` and opens over the active tab without unmounting. QA edits bands via the Run Optimizer modal over an active output tab; asserts an unrelated filter survives + band filter clears. |

---

## Deep re-review comments — Codex (2026-09-19) — SUPERSEDED / RESOLVED (history)

**Status: RESOLVED.** All four round-2 comments folded into T6/T8/INT above; see the round-2 resolution
table at the very end. Retained verbatim for history. Original round-2 status was "changes requested".

### [P1] Include plant label fields in the `pwRows` memo contract

T6 now requires `pwRows` to depend on `effectivePlants`, but its suggested stable signature contains
only plant IDs:

```ts
(effectivePlants ?? dataset?.plants ?? []).map(p => p.id).join(",")
```

That signature is insufficient because the displayed value is produced by `plantIdCityState` and
therefore depends on `id`, `city`, and `state`. If an added plant retains its ID while City or State
changes, the signature is unchanged; with the same result, dataset, and bands, `pwRows` can retain the
old location label.

Require one of these equivalent implementations:

- include every label field in an unambiguous signature (at least `id`, `city`, and `state`, with safe
  separators/serialization); or
- memoize the lookup from the actual memoized `effectivePlants` reference and make `pwRows` depend on
  that lookup/reference.

Strengthen the component regression: rerender with the same `result`, `dataset`, and plant ID, but
change that plant's City/State in `effectivePlants`; assert that the P→W label updates. Merely changing
collection membership or introducing a new ID does not prove this contract.

### [P2] Enumerate all six model IDs in Added Entities integration coverage

INT calls its matrix "all five configs" and combines `p-median-us` / `p-median-brazil` into one entry,
but the application exposes six distinct model routes:

1. `p-median-us`
2. `p-median-brazil`
3. `transport-coal`
4. `two-echelon-gold-au`
5. `two-echelon-jade-us`
6. `chens-cosmetics-cn`

The existing `Workspace.TabCoverage.test.tsx` contains suites for only four of them: p-median US,
Transport, Gold, and JADE. It currently has no Brazil or Chen suite, so "extended with
`added-entities` for every model" cannot be satisfied by merely modifying the existing cases.

Make the INT matrix explicitly data-driven over all six model IDs (the US and Brazil cases may share a
fixture builder, but both must execute). Add the Added Entities outer-tab coverage for Brazil and Chen
as well; do not rely on the combined `us/brazil` label as evidence that both routes were exercised.

### [P2] Prove model-specific Added Entities data and mutation wiring

T9 says the wrapper accepts all base-tab pass-through props, but its proposed test covers only generic
add/delete callbacks. INT's matrix verifies the inner-tab names and three presentation props (JADE
product mode, Gold `entity="refineries"`, and Chen `hasStateColumn={false}`), but it does not prove that
the wrapper reads and writes each model's correct input field or forwards precheck data.

This is particularly risky for Gold: its Refineries sub-tab reuses `WarehousesTab`, but must translate
`addedRefineries` into the component's generic `addedWarehouses` prop and translate edits/deletes back
to `addedRefineries`. A test that asserts only `entity="refineries"` can pass while the table is empty
or updates `addedWarehouses` incorrectly.

Add integration coverage that proves:

- an existing added row renders from the correct model-specific array;
- an editable added-row field calls the correct callback and updates the correct `localInputs` key;
- the model's precheck chip reaches the relocated row; and
- Gold Refineries specifically reads, edits, and deletes through `addedRefineries`, not
  `addedWarehouses`.

This is required to substantiate the spec's "add / edit / delete / precheck-chip behaviors are
byte-identical, just relocated" DoD.

### [P2] Correct T8's initial add-form assertion

T8 currently says `showBaseTable={false}` "renders the add form." The existing base tabs do not render
an open form initially: they render a `+ Add ...` button while `addingRow` is false, and render the form
only after that button is clicked. Requiring the form on initial render conflicts with the same task's
"existing render byte-identical" requirement and could encourage an unintended UX change merely to
make the new test pass.

Rewrite the tests to assert the existing state transition:

1. With `showBaseTable={false}`, the added-only region and `+ Add ...` affordance render, while the base
   table, toolbar, import trigger, and base filter do not.
2. Click `+ Add ...`, then assert that the add form renders.
3. With `showAddedSection={false}`, assert that neither the add affordance nor the add form nor the
   added-rows table renders, while the base table and toolbar remain.

---

## Review resolution — round 2 (Codex plan review, 2026-09-19)

**Current status: RESOLVED — no open items.**

| # | Comment | Disposition |
|---|---------|-------------|
| P1 | `pwRows` signature must cover label fields, not just id | **Accepted.** T6 signature serializes `id`+`city`+`state` (or a Map on the memoized `effectivePlants` ref); regression changes City/State on the SAME id and asserts the label updates. |
| P2 | Enumerate all SIX model ids | **Accepted.** Verified TabCoverage has only us/transport/gold/jade suites (Brazil excluded, Chen absent). INT matrix is data-driven over all 6, each executed; new Brazil + Chen coverage added. |
| P2 | Prove model-specific data + mutation wiring (Gold refineries) | **Accepted.** Verified Gold binds `addedRefineries` into `WarehousesTab`. INT adds render/edit/delete/precheck proof against the correct model array (Gold `addedRefineries`, plus a non-reuse model). |
| P2 | T8 initial add-form assertion wrong | **Accepted.** Verified base tabs render a `+ Add …` button (form only after click). T8 tests rewritten to the real state transition; no open-form-on-mount assertion. |
