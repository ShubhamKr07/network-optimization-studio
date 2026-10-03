# Model-page sidebar — collapsible hamburger rail with per-entry icons

**Date:** 2026-10-03
**Surface:** `artifacts/studio/src/components/workspace/SidebarTree.tsx` (all 7 model pages)
**Status:** design, review rounds 1 and 2 (Fable 5 adversarial passes) incorporated — plan written at `docs/superpowers/plans/2026-10-03-sidebar-hamburger-rail.md`
**Nature:** cosmetic/UX only. No API, no DB, no solver, no generated-code change.

All paths below are relative to `artifacts/studio/` unless stated otherwise.

---

## 1. Problem

Every model page renders a fixed-width (`w-56`) always-visible left sidebar (`SidebarTree`, 319
lines, mounted once at `src/pages/Workspace.tsx:4580`). It cannot be collapsed, so it permanently
costs 224px of horizontal room on grid-heavy tabs (Distances, Capability Matrix, Customer
Assignments), and its rows are text-only — scanning them is a read, not a glance.

Verified current state:

| Fact | Evidence |
|---|---|
| One sidebar component serves every model page | all 7 chapters carry `workspace: true` (`src/lib/chapters.ts:46,56,68,79,89,99,110`), and `App.tsx:75-82` routes those to `Workspace` |
| `Studio.tsx` is dead for model routes | the `authedOnly(<Studio …>)` arm at `App.tsx:84` is only reachable for `workspace: false`, of which there are none |
| Sidebar is a fixed-width nav with no collapse state | `SidebarTree.tsx:70` — `className="w-56 border-r flex flex-col overflow-y-auto flex-shrink-0 …"` |
| Rows are text-only | `SidebarTree.tsx:115` / `:139` render `{entry.label}` and nothing else |
| 19 distinct entity ids can appear | `inputEntriesForModel()` (`Workspace.tsx:1251-1325`, 13 input ids across 7 models) + `OUTPUT_ENTRIES` (`Workspace.tsx:1347-1354`, 6 output ids) |

## 2. Goal

1. Sidebar collapses to a narrow icon rail and expands back, toggled by a hamburger.
2. Every entry row carries a unique, relevant icon in both states.
3. Collapsed: hovering a rail icon slides out that one row's label; the rest of the rail stays
   collapsed. Only the hamburger moves the whole panel.
4. Default on load is **collapsed**, and the user's choice persists.

Non-goals: no change to what the sidebar lists, to tab opening, to scenario CRUD semantics, to the
Workspace header, to `Studio.tsx`, or to any API/DB/solver surface.

## 3. Resolved decisions

Each of these was an open fork; all are closed. No alternatives remain open.

| # | Decision | Chosen | Rejected |
|---|---|---|---|
| D1 | What "slides out" means | Panel collapses to an **icon rail**; a rail icon's label flies out as a per-row flyout | "clicked row flies into the TabBar"; "overlay drawer that auto-closes on pick" |
| D2 | Flyout trigger | **Hover** (plus keyboard focus), CSS-only for the 19 entry pills; a click still opens the tab in one go | click-to-pin for entry rows; icons with native `title` only (no flyout) |
| D3 | Scenarios section when collapsed | **One rail icon** whose flyout is the real scenario list (rows + rename/clone/delete), with `+` always visible on the rail | hide scenarios while collapsed; show active scenario only |
| D4 | Default state + persistence | **Collapsed by default, choice persisted** in `localStorage` | expanded-and-persist; expanded-never-persist |
| D5 | Hamburger placement | **First row of the rail/panel itself** | Workspace header far-left; both (header button + panel chevron) |
| D6 | Scenarios flyout vs. in-row editing (review round 1) | Flyout **latches open** via one boolean while a row is renaming or confirming delete; released on commit/cancel | pure CSS with no latch (loses a rename to `onBlur` the moment the cursor leaves — see §7); dropping rename/clone/delete from the flyout (contradicts D3) |
| D7 | Scenarios rail icon's click (review round 1) | Click **expands the whole sidebar** (it has no tab of its own), giving touch and keyboard a path that does not depend on hover | no click handler; tap-and-hold (unreliable on iOS) |
| D8 | Collapsed-by-default, **re-decided** once the `cosmetic-ui` bundle made the sidebar the sole navigator | **Keep collapsed-by-default** (user's call, 2026-10-03, made with the sole-navigator fact and both agents' contrary leans on the table) | expanded-by-default on first run (the recommendation from *both* this session and the Cosmetics session); auto-collapse after first solve |
| D9 | Execution order against `cosmetic-ui` | **Cosmetics merges first; this branch rebases onto the resulting `main`**, then executes | this branch first; parallel execution with a shared integration branch |

### D8 — the adverse facts, recorded because the decision went against them

The user chose collapsed-by-default knowing all of this. Do not quietly reverse it; if it needs revisiting, that is a new user decision.

1. `cosmetic-ui`'s COSM-1 deletes the open-tab strip, so **the sidebar is the only navigator**.
2. COSM-1 also removes the header's scenario dropdown (`select-scenario-context` is asserted absent at `bundle6-ui-tweaks.spec.ts`), so the sidebar's Scenarios section becomes the **only scenario switcher** — and collapsed, that switcher sits behind a hover flyout. D7's click-to-expand is the mitigation.
3. Tailwind v4 wraps `hover:`/`group-hover:` in `@media (hover: hover)`, so on touch there are no labels at all and D7's click is the only path.
4. Both this session and the Cosmetics session independently recommended expanded-by-default for first-run discoverability.

The counter-evidence that supports the user's choice, from the Cosmetics session's own COSM-2 measurement: at a 375px viewport the fixed 224px sidebar leaves ~119px of usable row against a 147px button group, clipping `2. Min Distance`, the Layers chips, the map legend and the Leaflet attribution. That is a pre-existing squeeze, and the rail reclaiming 224px is expected to resolve it without further work. **Verify that during QA** (new QA item) — it is the strongest argument for the collapsed default.

## 4. Design

### 4.1 Ownership and state

`SidebarTree` owns the collapsed flag itself:

```ts
// Matches the repo's one existing persistence key, UnitContext.tsx:16's
// "nos:display-unit-pref" — colon namespace, kebab name.
const STORAGE_KEY = "nos:sidebar-collapsed";
```

Precedence, deliberately the opposite of the first draft: **an explicitly supplied
`defaultCollapsed` prop wins; `localStorage` only fills the `undefined` case; absent both, the
default is collapsed (D4).** The first draft let storage win, which made the prop — invented for
test determinism — hostage to test order, because jsdom `localStorage` persists across tests in a
file and `src/__tests__/setup.ts` never clears it. `SidebarTree.test.tsx` additionally gets
`beforeEach(() => window.localStorage.clear())`, matching what every other persisting suite already
does (`UnitContext.test.tsx:13`, `TransportCostsTab.test.tsx:50`, `ServiceStatsTab.test.tsx:24`).

Written on toggle only, never from an effect. All access `try`/`catch`ed — `localStorage` throws in
private-mode Safari; failure degrades to the default, never an exception.

Rationale for local ownership over lifting to `Workspace`: nothing else in `Workspace` reads the
flag, and `Workspace.tsx` is already 4835 lines.

One further piece of state, Scenarios-only (D6): `scenariosFlyoutPinned`, set `true` while any
`ScenarioRow` is renaming or confirming delete, cleared on commit/cancel. The 19 entry pills stay
pure CSS.

### 4.2 Expanded state

Today's panel, unchanged in structure (`w-56`, three `SidebarSection`s, `+`, `ScenarioRow` with
rename/clone/delete), with two additions:

- a hamburger row above the Scenarios section, full-width, left-aligned;
- an icon before each Inputs/Outputs label (`w-3.5 h-3.5`, `flex-shrink-0`, `mr-2` — `w-3.5` is this
  directory's dominant icon size: 42 uses vs. 23 of `w-3` and 1 of `w-4`).

### 4.3 Collapsed state (the rail)

`w-11` rail, same vertical order as expanded, so nothing moves category when the state changes:

```
☰            hamburger (aria-expanded)
──────────   divider
🗂  FolderOpen  Scenarios → flyout = full scenario list; click expands (D7)
+            create scenario (always visible)
──────────   divider
🗺 👥 🏭 …    one icon per Inputs entry, in list order
──────────   divider
🗺̇ 📋 🚪 …    one icon per Outputs entry, in list order
```

Section *titles* ("SCENARIOS"/"INPUTS"/"OUTPUTS") are not rendered as text on the rail; the dividers
carry the grouping. Titles return on expand.

**The three `div[data-testid=sidebar-section-*]` wrappers (`SidebarTree.tsx:311`) survive in both
states**, and the "No scenarios yet" empty row stays inside `sidebar-section-scenarios` in both
states. This is a requirement, not an implementation detail: `SidebarTree.test.tsx:34-39` asserts all
three exist on a default render (which, post-D4, is the *collapsed* render), and
`e2e/empty-first-run-workspace.spec.ts:53,95` scope `getByText("No scenarios yet")` to
`sidebar-section-scenarios` precisely because the first-run CTA duplicates that string — unscoped it
is a strict-mode violation.

**The `ScenarioRow` list is mounted exactly once**; only its container differs by state (inline
section when expanded, flyout when collapsed). Rendering both and hiding one would turn all 18
`sidebar-scenario-<id>` / `button-*-scenario-<id>` references (13 RTL + 5 e2e) into Playwright
strict-mode violations.

### 4.4 Width transition, and the maps

The `<nav>` keeps `transition-[width] duration-200` and stays in the existing flex row, so the tab
content area's *box* reflows as the rail narrows. The panel is **not** an overlay.

**Leaflet does not follow that reflow.** `leaflet@1.9.4`'s `trackResize` subscribes to `window`
resize only (`node_modules/leaflet/src/map/Map.js:1324-1326`), and the repo has zero
`invalidateSize` or `ResizeObserver` calls in non-test source — verified. Collapsing or expanding
with Input Map or Output Map open would leave the map at its old width (blank strip or cropped
tiles) until the window itself resized. Input Map is auto-opened on entry
(`e2e/bundle6-ui-tweaks.spec.ts:160`), so this is the default state, not an edge case.

Fix, in scope: a shared `InvalidateOnResize` component
(`src/components/workspace/map/InvalidateOnResize.tsx`) that observes `map.getContainer()` and
calls `map.invalidateSize()`, mounted in **all five** production `<MapContainer>`s.

Five, not one — corrected in review round 2, and the correction matters: `grep -rn "<MapContainer" src`
gives `NetworkMap.tsx:634` **and `InputMapTab.tsx:1059, :1562, :2057, :2640`**. `InputMapTab` builds
its own map and has zero references to `NetworkMap`; `NetworkMap`'s only consumers are
`OutputMapTab.tsx` and the dead `Studio.tsx`. A `NetworkMap`-only fix would therefore have left the
**auto-opened Input Map** — the one tab this is most visible on — broken, while appearing done.

Two existing react-leaflet mocks stub `useMap` as `{ setView, fitBounds }`
(`Workspace.TabCoverage.test.tsx:58`, `deliveryEditableInputs.test.tsx:40`); they need
`getContainer`/`invalidateSize` added, or the new effect throws from inside `useEffect` and those
suites fail. The production component is deliberately **not** guarded with a
`typeof map.getContainer === "function"` check — production code does not bend to a mock.

`prefers-reduced-motion: reduce` disables the width transition and the flyout slide (Tailwind
`motion-reduce:` variants).

### 4.5 Hover flyout — CSS only, and the four things that would clip or hide it

Each rail row is wrapped in `group/row relative`. The label pill is **a child of the entry
`<button>` itself**, absolutely positioned at `left-full top-0 ml-1`, `opacity-0
pointer-events-none translate-x-1`, flipping to `opacity-100 translate-x-0` under `group-hover/row:`
and `group-focus-within/row:`.

Four structural constraints, each load-bearing:

1. **Pill inside the button, not a sibling.** `SidebarTree.test.tsx:66-67` and
   `Workspace.test.tsx:1189-1191` assert `getByTestId("sidebar-input-…").toHaveTextContent("…")`,
   which reads the button's *own* subtree. A sibling pill fails all four assertions. Because the
   text is therefore inside the button, the collapsed-mode `aria-label` floated in the first draft is
   **dropped** — the accessible name comes from the visible text, and an `aria-label` would override
   it (an a11y anti-pattern when text is present).
2. **`opacity-0`, never `invisible`/`hidden`.** `empty-first-run-workspace.spec.ts:53` calls
   `.toBeVisible()` on sidebar content; Playwright's visibility check ignores `opacity`, so an
   `opacity-0` pill still counts as visible there, while `visibility:hidden` would break it. The
   thing that actually blocks a *click* on a non-hovered pill is `pointer-events-none` failing the
   hit-target check — not visibility. (The first draft's stated reason for the hover edits in §6 was
   wrong about this.)
3. **The collapsed rail has no scroll container at all.** Keeping `overflow-y-auto` on an inner
   wrapper instead of the nav does nothing: per CSS, if either axis is not `visible` the other
   computes to `auto`, so any such wrapper is equally an `overflow-x` clipper for a `left-full`
   child. In the collapsed state the nav and every wrapper inside it are `overflow-visible`;
   `overflow-y-auto` is kept only in the expanded panel, which has no flyouts. (If §7's
   viewport-height case ever forces a scrolling rail, the only remaining options are `position:
   fixed` with measured coordinates or a portal — which would contradict this section, and must be
   an explicit decision, not a silent one.)
4. **Rail-mode rows drop `truncate`.** `rowClass()` (`SidebarTree.tsx:150`) and the disabled-output
   class (`:135`) both include `truncate` (= `overflow:hidden`), which clips an absolutely
   positioned child of that same button. Truncation is still wanted in expanded mode.

**Stacking.** `src/index.css:16-18` sets `.leaflet-container { z-index: 0 }` deliberately, so the
map is a positioned, z-indexed element; since the nav precedes the content column in DOM order, a
flyout at `z-index: auto` paints *under* the map. The nav gets `relative z-50` (content-column
overlays sit at `z-40`: `tabs/InputMapTab.tsx:435,512`, `map/MapActionMenu.tsx:146`).

**The Scenarios flyout** is the same mechanism at a larger size: a bordered, `bg-popover`,
`shadow-md` panel anchored `left-full top-0` with the existing `ScenarioRow` list plus the "No
scenarios yet" row. One shared `group/scenarios` wrapper spans trigger and flyout so moving the
cursor between them keeps it open, plus the D6 latch while a row is renaming/confirming. Its inner
list carries `max-h-[calc(100vh-8rem)] overflow-y-auto` so a long scenario list scrolls *inside* the
flyout — the flyout itself never clips anything it needs to show. No portal, no Radix popover, no
outside-click handler.

Output entries disabled pre-solve keep their existing gate
(`!hasSolvedRun && !keepOutputsClickable`) and render as muted, `cursor-not-allowed` rail icons;
their flyout label still appears, so a student can identify a locked entry without expanding.

### 4.6 Icon map

A module-level `const ENTITY_ICONS: Record<string, LucideIcon>` in a new `entityIcons.ts`, with a
`Circle` fallback for any unlisted id (a future entry renders a generic dot rather than crashing the
rail). All names below verified present in the installed `lucide-react@0.545.0`. Note `Grid3x3` and
`Grid3X3` both export — this spec and the plan use `Grid3x3`; a reviewer should not "correct" it.

| Entity id | Icon | Entity id | Icon |
|---|---|---|---|
| `input-map` | `Map` | `plants` | `Factory` |
| `customers` | `Users` | `capability-matrix` | `Grid3x3` |
| `warehouses` | `Warehouse` | `transportCosts` | `CircleDollarSign` |
| `distances` | `Ruler` | `output-map` | `MapPinned` |
| `optimization-parameters` | `SlidersHorizontal` | `cost-summary` | `ClipboardList` |
| `deliveryCosts` | `Truck` | `open-warehouses` | `DoorOpen` |
| `mines` | `Pickaxe` | `customer-assignments` | `ArrowRightLeft` |
| `stations` | `Zap` | `flows` | `Waypoints` |
| `laneCosts` | `Route` | `service-stats` | `BarChart3` |
| `refineries` | `Anvil` | *(Scenarios / hamburger)* | `FolderOpen` / `Menu` |

Icons are unique across the whole set, not merely within one model's list, so two chapters never
share a glyph for different concepts.

Four choices were corrected in review round 1, each because the obvious pick actively misleads:
`cost-summary`'s label is **"Solution Summary"** and for `max-coverage-us` the objective is covered
demand, not cost (`solvers/max-coverage-us/manifest.json:15` still lists `costSummary` as an output
grid), so a `Receipt` is wrong for that chapter — `ClipboardList`. `Link2` is the universal
hyperlink glyph, not a customer→warehouse mapping — `ArrowRightLeft`. `FlaskConical` reads as
"lab/experiment" in an app whose pages are literally titled "… · Model Lab"
(`chapters.ts:47,59,…`), while a gold refinery is an industrial processing node — `Anvil`.
`PackageCheck` reads as "parcel delivered" rather than "facility open" — `DoorOpen`. And Scenarios
uses `FolderOpen` rather than `Layers`, because the Input Map tab already has a UI concept called
the Layers row (`Workspace.tsx`'s `saveInLayersRow*`) and two unrelated "layers" on one screen is a
teaching hazard.

`added-entities` deliberately has no entry: three e2e specs assert
`getByTestId("sidebar-input-added-entities")` has **count 0** (`workspace-fixups.spec.ts:261,502`,
`workspace-fixups-2.spec.ts:72`) — it is a removed entry, not a live one.

### 4.7 Accessibility

- Hamburger: `aria-label` "Collapse sidebar" / "Expand sidebar", `aria-expanded={!collapsed}`,
  `aria-controls` pointing at the nav's id, `data-testid="button-toggle-sidebar"`.
- Rail entry buttons keep `aria-current` as today; their accessible name comes from the in-button
  label text (§4.5 constraint 1), so no `aria-label` is added.
- Keyboard: tabbing onto a rail icon opens its flyout via `group-focus-within`, so a keyboard user
  sees the same label a mouse user does. The Scenarios rail icon is a real button that expands the
  sidebar on activation (D7), so scenario management is reachable without hover.

## 5. Files

| File | Change |
|---|---|
| `src/components/workspace/SidebarTree.tsx` | the feature: collapsed state, persistence, hamburger, rail, flyouts, icons, rail-mode class changes (`truncate`, `relative z-50`, overflow) |
| `src/components/workspace/entityIcons.ts` *(new)* | `ENTITY_ICONS` map + `iconForEntity()` fallback accessor |
| `src/components/workspace/map/InvalidateOnResize.tsx` *(new)* | the `ResizeObserver` → `map.invalidateSize()` component (§4.4) |
| `src/components/NetworkMap.tsx` | mount `<InvalidateOnResize />` (1 container) |
| `src/components/workspace/tabs/InputMapTab.tsx` | mount `<InvalidateOnResize />` (4 containers) |
| `src/__tests__/Workspace.TabCoverage.test.tsx`, `src/__tests__/deliveryEditableInputs.test.tsx` | extend the `useMap` mocks with `getContainer`/`invalidateSize` (§4.4) |
| `src/pages/Workspace.tsx` | none expected (`SidebarTree`'s existing props are unchanged) |
| `src/__tests__/SidebarTree.test.tsx` | new cases (§6) + `localStorage.clear()` in `beforeEach`; existing 188 lines expected to pass unmodified |
| `e2e/empty-first-run-workspace.spec.ts`, `e2e/two-echelon.spec.ts` | hover before collapsed-state scenario operations (§6) |

## 6. Test impact — measured

Counted with `rg` over `*.ts`/`*.test.tsx` only. **The first draft's figure of 227 e2e references was
wrong: it swept `e2e/report/`, which holds Playwright run artifacts, not specs.** Corrected:

- **e2e:** 193 `sidebar-*` occurrences across 23 spec files.
- **RTL:** 277 occurrences across 16 files, of which one (`src/__tests__/designTokens.contract.test.ts:31-33,59`)
  matches only the shadcn token names `sidebar-accent-foreground` etc. — **15** real files.
- Repo-wide there is exactly **one** text-based (non-testid) selector matching a sidebar label:
  `e2e/input-map-v2.spec.ts:143`, and it targets a **toast**, not the sidebar.
- **Untouched by this change: 187 e2e + 252 RTL = 439 row references** (`sidebar-input-*`,
  `sidebar-output-*`, plus `sidebar-scenario-*` reads). They keep working with no spec edit because
  the rail button carries the same `data-testid`, is visible, and opens the tab exactly as today.
- RTL text assertions keep passing because the label stays in the DOM, inside the button —
  e.g. `SidebarTree.test.tsx:66`'s `toHaveTextContent("Warehouses")` (§4.5 constraint 1 is what
  guarantees this).

**What needs editing: 2 files, 3 clicks** — every *interaction* that lands inside the collapsed
Scenarios flyout. Each gets a `.hover()` on the rail's Scenarios icon first, with an explicit
`{ timeout: HEADER_TIMEOUT }` (CLAUDE.md's unbounded-interaction gotcha; both existing `.hover()`
calls in the suite already do this — `jade-ch9-workspace-bundle.spec.ts:374`,
`workspace-fixups-2.spec.ts:151`):

| Spec | Line | Control |
|---|---|---|
| `e2e/empty-first-run-workspace.spec.ts` | 141 | `button-delete-scenario-<id>` click |
| `e2e/empty-first-run-workspace.spec.ts` | 142 | `button-confirm-delete-<id>` click — **missed by the first draft**; the confirm row replaces the `ScenarioRow` *inside* the flyout (`SidebarTree.tsx:202-226`), so the D6 latch must hold the flyout open across that state change |
| `e2e/two-echelon.spec.ts` | 133 | `button-clone-scenario-<id>` click |

Not affected: `button-create-scenario` (×3 — `+` stays on the rail; `labs.spec.ts:66` is excluded
from the gate anyway), and `bundle6-ui-tweaks.spec.ts:157-158`, which only read `aria-current` and
need no hover.

New coverage in `SidebarTree.test.tsx`:

1. renders collapsed with no stored key and no prop; `defaultCollapsed` wins when supplied; stored
   key applies when the prop is absent.
2. hamburger toggles both ways and writes `localStorage`.
3. every entry renders an icon, and two different ids never render the same icon.
4. the collapsed rail exposes the identical set of `sidebar-input-*` / `sidebar-output-*` testids as
   the expanded panel — the parity guarantee the 439 untouched references rest on.
5. all three `sidebar-section-*` wrappers exist in the collapsed rail, with the empty "No scenarios
   yet" row inside `sidebar-section-scenarios`.
6. labels are present in the DOM, inside the entry button, while collapsed.
7. the pre-solve Outputs disabled gate still applies in the collapsed rail.
8. the D6 latch: a rename in progress keeps the flyout mounted; commit and cancel both release it.

Plus a real-browser QA pass (repo standing requirement) covering: collapse/expand on a model page;
both map tabs reflowing correctly on toggle — Input Map AND Output Map, since they are two different components (§4.4); hover flyout on an Inputs icon; the Scenarios
flyout's rename/clone/delete; persistence across reload; the first-run empty state (§7); and the
rail at **1366×768**, not just Playwright's 1280×720 (§7).

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Rail exceeds viewport height.** JADE's rail is 17 rows + 3 dividers ≈ 612px; at 1280×720 minus the `min-h-14` header there are 664px, so it fits — but a 1366×768 laptop with browser chrome leaves ~640px and the bottom Outputs icons are clipped by the ancestor `overflow-hidden` (`Workspace.tsx:4579`). Playwright will **not** catch it: `scrollIntoViewIfNeeded` can scroll an `overflow:hidden` ancestor, so the clicks still pass | QA explicitly at 1366×768. If clipped, the fix is a shorter row height / tighter dividers in rail mode — **not** adding a scroll container, which breaks §4.5 constraint 3 |
| **Rename lost to `onBlur`.** `ScenarioRow`'s rename input commits on blur (`SidebarTree.tsx:242`); inside a hover-only flyout, moving the cursor off the flyout mid-rename unmounts it and commits a half-typed name. No such path exists today | the D6 latch — while a row is renaming or confirming delete, the flyout is pinned and cannot close on mouse-out. Covered by new test 8 |
| Collapsed-by-default changes first-run UX — a new user lands on an icon rail | `create-first-scenario-cta` in the content region (`Workspace.tsx:4665-4672`) is unchanged and remains the primary first-run path; D7 gives the Scenarios icon a click that expands; QA verifies the empty state reads clearly with the rail collapsed |
| Hover-only flyouts are touch-hostile — iOS emulates `:hover` unreliably and tap-and-hold triggers selection | D7: tapping the Scenarios icon expands the sidebar to the fully tappable panel. Entry icons open their tab on tap directly, so the label flyout is never on the critical path |
| `localStorage` unavailable/throwing | all access `try`/`catch`ed; degrades to the default |

## 8. Definition of done

- Hamburger collapses/expands on all 7 model pages; choice survives a reload.
- Every Inputs/Outputs entry shows a unique icon in both states; Scenarios has its rail icon + `+`.
- Hovering one rail icon reveals only that row's label, over the map, unclipped.
- A map tab toggled open/closed redraws at the new width (§4.4).
- Repo verification gate green: `pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)`.
- `pnpm e2e:gate` green, including the 3 hover edits. The e2e job is **blocking in CI**
  (`.github/workflows/ci.yml:123`), so those sibling-spec edits ship in the same commit as the UI
  change — the repo's standing `spec_gap` discipline.
- Real-browser QA pass recorded, including the 1366×768 check.
- Changelog entry in `docs/CHANGELOG-implementation.md`, same commit as the work.
- Commits use this work's task ids (`[SBR-n] …`), and `/harness-retro SBR` has run — a branch is not
  finished until it has.

## 9. Cross-session coordination with `cosmetic-ui`

Two sessions are changing `artifacts/studio` at the same time: **Cosmetics** (branch `cosmetic-ui`,
worktree `/Users/shubhamkr/nos-cosmetic`, locked) and this one (branch `sidebar-hamburger-rail`,
primary checkout). This section is the written contract; the cross-session chat is not.

### 9.1 File ownership — measured on both sides, 2026-10-03

`git diff --name-only main...cosmetic-ui` is 15 files. Of this bundle's five contested paths,
`cosmetic-ui` touches **zero** — independently confirmed by both sessions:

| Path | Owner |
|---|---|
| `src/components/workspace/SidebarTree.tsx` | **this branch, exclusively** |
| `src/components/workspace/entityIcons.ts`, `.../map/InvalidateOnResize.tsx` (new) | this branch |
| `src/components/NetworkMap.tsx` | this branch |
| `e2e/empty-first-run-workspace.spec.ts`, `e2e/two-echelon.spec.ts` | this branch |
| `src/components/AppShell.tsx` (+ test) | **`cosmetic-ui`** (COSM-4 wraps `<main>` in a `relative` container, landed in `65c7794`; COSM-5 mounts a canvas behind it) — this branch must not touch it, **and is provably unaffected by it**: see below |
| `src/pages/Workspace.tsx`, `src/components/workspace/StepToggle.tsx`, `src/lib/workspaceView.ts`, `docs/design-system/**` | `cosmetic-ui` |
| `lib/db`, `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`, `artifacts/api-server/**` | `cosmetic-ui` (COSM-4) |

**COSM-4's `AppShell` topology change cannot reach this bundle, verified rather than assumed.**
Cosmetics flagged it as the piece of its bundle most likely to touch this work, because wrapping
`<main>` in a `relative` container is a DOM-topology change on every page that uses the shell, and
a new `relative` ancestor is a new containing block for absolutely positioned descendants — which is
exactly what this bundle's `left-full` label pills are. It does not apply here because **model pages
are deliberately routed outside `AppShell`**: `App.tsx:54-55`'s `authedOnly()` is what wraps a page
in the shell, and `App.tsx:82` renders `<Workspace …>` directly instead, with a comment recording
why (Workspace renders its own full header; wrapping it too would stack two headers). Confirmed by
grep: `AppShell` appears in `Workspace.tsx` only at `:1372`, `:4488` and `:4553`, all three in
*comments*, and zero times in `SidebarTree.tsx` or `NetworkMap.tsx`. The pills' containing block is
the rail's own `li.group/row.relative`, inside a nav that no shell wraps.

**The one real conflict: `src/components/workspace/tabs/InputMapTab.tsx`.** COSM-2 changed ~19 lines
in two places — the `mode: "pmedian"` union variant (added `showInlineSave?: boolean`, ~`:361-370`,
destructured ~`:392`) and the Save gate at ~`:1051`. None of it is near a `<MapContainer>`, so
SBR-3's four insertions should merge cleanly — but **every line number in SBR-3 has shifted. Locate
the four `<MapContainer>`s by content, not by the line numbers in the plan.**

### 9.2 Order of operations (D9)

1. Cosmetics completes COSM-3/4/5, gates, and **stops for the user's merge approval**.
2. Cosmetics merges to local `main` on approval. It announces that here.
3. This branch rebases onto the new `main`, then **re-verifies every citation in the spec and plan
   before executing** — §1's table, `Workspace.tsx:4580`/`:4665-4672`, `Workspace.test.tsx:1189-1191`,
   and SBR-3's five `<MapContainer>` sites all move. A citation re-derivation pass is the first act
   of execution, not an afterthought.
4. This branch executes SBR-1…SBR-5, gates, and stops for its own merge approval.
5. One combined whole-branch review on the merged state, then **one** push, then **one** deploy
   cycle. Push and deploy are separately approved; neither is implied by a merge approval.

### 9.2.1 The deploy-order hazard is real, and both documents describing it are wrong

Measured live via the Render API on 2026-10-03, not read from a doc:

| Service | `autoDeploy` | `autoDeployTrigger` | Branch | Runtime |
|---|---|---|---|---|
| `nos-api` (`srv-d9hglg6pbkes73a1j8b0`) | **yes** | **commit** | `main` | Docker |
| `nos-studio` (`srv-d9hg4gvlk1mc73dtp67g`) | **yes** | **commit** | `main` | static site |

Two standing claims are contradicted by that:

- **Two stale sites, and `render.yaml` contradicts itself.** The live service says `commit`.
  `render.yaml:20-28` already carries a dated 2026-09-30 correction recording exactly that (the A11
  suppression was never restored) and `:29` holds the correct `autoDeployTrigger: commit`. But two
  other places still assert the old `off`:

  | Site | Current text | Verdict |
  |---|---|---|
  | `CLAUDE.md:100` | "`autoDeployTrigger: off` in `render.yaml` (Blueprint-authoritative for this service). A push does **not** deploy it" | **wrong on both halves**, exactly as `render.yaml:20-28` already says |
  | `render.yaml:10` | `# NOTE: nos-api is Dashboard-managed (autoDeployTrigger off), so this` | **the parenthetical only** is wrong — nine lines above the correction that refutes it |
  | `render.yaml:29` | `autoDeployTrigger: commit` | already correct, leave alone |

  Note on `render.yaml:10`, which the Cosmetics session reported as wholly stale: the comment is
  attached to the `plan:` key, and its substantive point — that the Blueprint's `plan` value is inert
  under Dashboard management — is *not* refuted (live reports `plan: 1c-2g`, i.e. standard, matching
  `render.yaml:13`). Only the `(autoDeployTrigger off)` aside is false. So the fix is **two edits**,
  not three, and `:29` must not be touched.

  **Not fixed here** — ops/policy lines outside this bundle's scope, and documentation reaches `main`
  only via a reviewed PR. Both sessions independently agreed not to smuggle it into a cosmetic
  bundle's commit. Flagged to the user as its own small task.

### 9.2.2 A third site for that same doc task: the local e2e recipe is incomplete

`CLAUDE.md:168` carries this repo's local-e2e recipe — start api-server, then
`PORT=<any> BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 pnpm --filter studio run dev`, then
`E2E_BASE_URL=… npx playwright test`. It **omits `VITE_POSTHOG_KEY` and `VITE_SENTRY_DSN`**, and
`grep -c "VITE_POSTHOG_KEY\|VITE_SENTRY_DSN" CLAUDE.md` returns **0** — they appear nowhere in the
file. But `e2e/posthog-analytics.spec.ts:63-65` and `e2e/sentry-capture.spec.ts:80-83` both require
them and both say *"See CLAUDE.md / the plan's local run recipe."* The pointer points at a recipe
that cannot run them.

**This is not a cosmetic doc gap; it caused a real misjudgement.** Following the documented recipe,
the Cosmetics session's gate reported 2 unexpected e2e failures, filed them as environmental, and
declared the gate clean. Both specs had simply never executed — including PostHog's assertion that
no captured payload contains PII across every event the SDK actually sent, on a branch that adds a
route accepting free text a user is invited to write candidly. With dummy values both pass (verified:
4 passed in 8.5s, genuine 67/67, 0 flaky). "Explained" and "verified" are different states, and an
incomplete recipe is what let the weaker one be reported as the stronger.

Dummy values are correct rather than a workaround: `analytics.ts:14` is a bare truthiness check
(`if (!key || initialized) return;`) and both specs intercept and stub every ingest request before it
leaves the page, so no real key is ever contacted. A syntactically valid DSN suffices — the shape in
`src/lib/errorTracking.test.ts:18`.

So the doc-fix task the user has been handed is **three sites, two of them one-line**:

| Site | Fix |
|---|---|
| `CLAUDE.md:100` | `nos-api` does auto-deploy on push; rewrite both halves |
| `render.yaml:10` | strike the `(autoDeployTrigger off)` parenthetical, keep the sentence |
| `CLAUDE.md:168` | add `VITE_POSTHOG_KEY=phc_local_dummy_key` and `VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1` to the local e2e recipe, with the one-line reason |

`render.yaml:29` is already correct and must not be touched.
- The Cosmetics session's inference — "a push does not deploy `nos-api` but can deploy `nos-studio`,
  so the asymmetry is backwards from the order we want" — reaches a correct worry from a wrong
  premise. Both services are armed to deploy on the same push.

**The actual risk, which is worse.** Neither of us can order the deploys by sequencing the push,
because one push arms both. And the likely race outcome is the bad one: `nos-studio` is a static
site (install + Vite build) while `nos-api` is a Docker image build, so **the studio probably goes
live first** — putting COSM-4's feedback widget in front of a `POST /api/feedback` that still 404s.
`CLAUDE.md:159` records that the studio webhook has historically not fired on its own, which would
accidentally produce the safe order, but that is observed unreliability and must never be leaned on.

Three mitigations, in preference order. The choice is the user's at the deploy-approval step:

1. **COSM-4's widget degrades gracefully on a non-2xx** (Cosmetics owns this; it is the only fix that
   removes the window rather than narrowing it). **Specified as satisfied, pending confirmation from
   the built code** — per Cosmetics, 2026-10-03: the submit is wrapped so a non-2xx or network
   failure sets an error state instead of throwing; the panel stays open; an inline `feedback-error`
   renders; **the typed text is retained verbatim**; `429` gets its own message and everything else,
   including a skew-window `404`, gets a generic retryable one; and no success state shows unless the
   request actually succeeded, so a `404` cannot produce a false "Thanks — got it." A spec'd test
   covers the textarea retaining its value on error. Cosmetics will confirm against the real error
   path before merge approval is sought, and will fix it inside COSM-4 rather than inventing deploy
   sequencing if it does not behave as specified.

   **If that confirmation holds, the hazard is cosmetic** and no deploy choreography is needed: the
   skew window degrades to a form that accepts input and shows a retryable error. The one rough edge
   is that the retry also fails until `nos-api` is live — annoying, not harmful.
2. **Suspend `nos-studio` auto-deploy in the Dashboard before the push**, push, let `nos-api` finish,
   then deploy the studio deliberately. This is a config change on a live service and needs its own
   explicit approval.
3. **Accept a short window** in which the feedback form errors, and verify with `list_deploys`
   immediately after the push which service actually started building.

Whichever is chosen, verify the live `autoDeployTrigger` with `get_service` at deploy time rather
than trusting this table, `render.yaml`, or `CLAUDE.md` — all three are snapshots and one is already
known to have drifted.

### 9.3 Citation drift already confirmed by Cosmetics

- `Workspace.test.tsx:1189-1191` → **`:1190-1192`, assertions unchanged.** They read
  `getByTestId("sidebar-input-<id>")).toHaveTextContent(...)` — the button's *own* subtree — so
  §4.5 constraint 1 (pill is a child of the button) is exactly what keeps them green. Cosmetics
  flagged these as "broken by design" by a collapsed icon rail; that is **incorrect for this
  design**, verified by reading the assertions on both branches.
- `bundle6-ui-tweaks.spec.ts:157-158` (`sidebar-scenario-*` `aria-current` reads) → unchanged.
- `bundle6-ui-tweaks.spec.ts:160` → rewritten to `:165-166`: now
  `getByTestId("sidebar-input-input-map")).toHaveAttribute("aria-current", "true")` plus
  `getByTestId("input-map-tab")).toBeVisible()`. **New hazard:** COSM-1 added a case below it that
  *clicks* `sidebar-input-warehouses` and asserts a toolbar swap. The rail keeps that testid,
  keeps it visible and keeps `aria-current`, so it should pass — but it is now a sibling spec this
  bundle must re-run, and it is not in the plan's SBR-5 list. Add it to SBR-5's verification.

### 9.4 Gate protocol (mandatory, both sessions agreed)

Concurrent suite runs across sessions produce false failures in files neither branch touched — this
repo's documented flake class. Therefore:

- **Never run `pnpm --filter studio test`, `pnpm --filter api-server test`, pytest, or
  `pnpm e2e:gate` without announcing it cross-session first, and holding until the other side's
  run reports done.**
- **Announce the END of a run as well as the start.** Otherwise the other side blocks indefinitely.
- `ps aux | grep "[v]itest" | grep -v "zsh -c"` cannot see the other session's pytest or Playwright,
  so the announcement is the real safeguard and the `ps` check is only a backstop.
- New flake reported by Cosmetics, not yet in CLAUDE.md's list:
  `e2e/nonjade-servicestats-live-coverage.spec.ts:279` failed in a 10-spec parallel run and passed
  4/4 in isolation, on an untouched `two-echelon-gold-au` path. If this bundle sees it, it is load.
