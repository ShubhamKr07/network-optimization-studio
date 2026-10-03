# Model-page sidebar — collapsible hamburger rail with per-entry icons

**Date:** 2026-10-03
**Surface:** `artifacts/studio/src/components/workspace/SidebarTree.tsx` (all 7 model pages)
**Status:** design, review round 1 (Fable 5 adversarial pass) incorporated — ready to plan
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

Fix, in scope: a `ResizeObserver` on the map container calling `map.invalidateSize()` in
`src/components/NetworkMap.tsx` (which already imports `useMap`, `:2`).

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
| `src/components/NetworkMap.tsx` | `ResizeObserver` → `map.invalidateSize()` (§4.4) |
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
a map tab reflowing correctly on toggle (§4.4); hover flyout on an Inputs icon; the Scenarios
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
