# Model-page sidebar — collapsible hamburger rail with per-entry icons

**Date:** 2026-10-03
**Surface:** `artifacts/studio/src/components/workspace/SidebarTree.tsx` (all 7 model pages)
**Status:** design, approved in brainstorming — ready to plan
**Nature:** cosmetic/UX only. No API, no DB, no solver, no generated-code change.

---

## 1. Problem

Every model page renders a fixed-width (`w-56`) always-visible left sidebar (`SidebarTree`, 319
lines, mounted once at `Workspace.tsx:4580`). It cannot be collapsed, so it permanently costs 224px
of horizontal room on grid-heavy tabs (Distances, Capability Matrix, Customer Assignments), and its
rows are text-only — scanning them is a read, not a glance.

Verified current state:

| Fact | Evidence |
|---|---|
| One sidebar component serves every model page | all 7 chapters carry `workspace: true` (`src/lib/chapters.ts`), and `App.tsx:76-83` routes those to `Workspace` |
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

Each of these was an open fork during brainstorming; all are closed. No alternatives remain open.

| # | Decision | Chosen | Rejected |
|---|---|---|---|
| D1 | What "slides out" means | Panel collapses to an **icon rail**; a rail icon's label flies out as a per-row flyout | "clicked row flies into the TabBar"; "overlay drawer that auto-closes on pick" |
| D2 | Flyout trigger | **Hover** (plus keyboard focus), CSS-only; a click still opens the tab in one go | click-to-pin (needs state + outside-click); icons with native `title` only (no flyout) |
| D3 | Scenarios section when collapsed | **One `Layers` rail icon** whose flyout is the real scenario list (rows + rename/clone/delete), with `+` always visible on the rail | hide scenarios while collapsed; show active scenario only |
| D4 | Default state + persistence | **Collapsed by default, choice persisted** in `localStorage` | expanded-and-persist; expanded-never-persist |
| D5 | Hamburger placement | **First row of the rail/panel itself** | Workspace header far-left; both (header button + panel chevron) |

## 4. Design

### 4.1 Ownership and state

`SidebarTree` owns the collapsed flag itself:

```ts
const STORAGE_KEY = "nos.sidebar.collapsed";
// absent key => collapsed (D4). Any read/write is try/caught: localStorage throws
// in private-mode Safari and is absent in some test environments.
const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed(defaultCollapsed));
```

Writing on toggle only (not in an effect on every render). A new optional prop
`defaultCollapsed?: boolean` lets a test render either state deterministically without touching
`localStorage`; when the stored key exists it wins over the prop, matching "the user's choice
persists".

Rationale for local ownership over lifting to `Workspace`: nothing else in `Workspace` reads or
needs the flag, and `Workspace.tsx` is already 4835 lines. Lifting would add a prop pair to a
component whose test suites (16 RTL files reference sidebar testids) would then need updating for
no behavioural gain.

### 4.2 Expanded state

Today's panel, unchanged in structure (`w-56`, three `SidebarSection`s, `+`, `ScenarioRow` with
rename/clone/delete), with two additions:

- a hamburger row above the Scenarios section, full-width, left-aligned;
- an icon rendered before each Inputs/Outputs label (`w-4 h-4`, `flex-shrink-0`, `mr-2`).

### 4.3 Collapsed state (the rail)

`w-11` rail, same vertical order as expanded, so nothing moves category when the state changes:

```
☰            hamburger (aria-expanded)
──────────   divider
🗂  Layers   Scenarios  → flyout = full scenario list
+            create scenario (always visible)
──────────   divider
🗺 👥 🏭 …    one icon per Inputs entry, in list order
──────────   divider
🗺̇ 🧾 📦 …    one icon per Outputs entry, in list order
```

Section titles ("SCENARIOS"/"INPUTS"/"OUTPUTS") are not rendered as text on the rail; the dividers
carry the grouping. They return on expand.

### 4.4 Width transition

The `<nav>` keeps `transition-[width] duration-200` and stays in the existing flex row, so the tab
content area reflows as the rail narrows. The panel is **not** an overlay — "slides out" is the
nav's own width animating from `w-56` to `w-11` with the content taking the freed space.

`prefers-reduced-motion: reduce` disables the width transition and the flyout slide (Tailwind's
`motion-reduce:` variants).

### 4.5 Hover flyout — CSS only

Each rail row is wrapped in `group/row relative`. The label renders in an absolutely positioned
pill at `left-full top-0 ml-1`, `opacity-0 pointer-events-none translate-x-1`, flipping to
`opacity-100 translate-x-0` under `group-hover/row:` and `group-focus-within/row:`.

**The label text is always in the DOM** — visually hidden when not hovered, never conditionally
unmounted. This is load-bearing for test compatibility (§6) and for screen readers.

The Scenarios flyout (D3) is the same mechanism at a larger size: a bordered, `bg-popover`,
`shadow-md` panel anchored `left-full top-0` containing the existing `ScenarioRow` list and the
"No scenarios yet" empty row. One shared `group/scenarios` wrapper spans the trigger icon and the
flyout, so moving the cursor from icon into the flyout keeps it open — no JS state, no portal, no
Radix popover, no outside-click handler.

Output entries disabled pre-solve keep their existing gate (`!hasSolvedRun && !keepOutputsClickable`)
and render as muted, `cursor-not-allowed` rail icons; their flyout label still appears, so a student
can identify a locked entry without expanding.

### 4.6 Icon map

A module-level `const ENTITY_ICONS: Record<string, LucideIcon>` with a `Circle` fallback for any id
not listed (so a future entry can never crash the rail — it renders a generic dot until mapped).
All 22 icon names involved (19 entity icons + `Layers`, `Menu`, and the `Circle` fallback) were
verified present in the installed `lucide-react@0.545.0`.

| Entity id | Icon | Entity id | Icon |
|---|---|---|---|
| `input-map` | `Map` | `plants` | `Factory` |
| `customers` | `Users` | `capability-matrix` | `Grid3x3` |
| `warehouses` | `Warehouse` | `transportCosts` | `CircleDollarSign` |
| `distances` | `Ruler` | `output-map` | `MapPinned` |
| `optimization-parameters` | `SlidersHorizontal` | `cost-summary` | `Receipt` |
| `deliveryCosts` | `Truck` | `open-warehouses` | `PackageCheck` |
| `mines` | `Pickaxe` | `customer-assignments` | `Link2` |
| `stations` | `Zap` | `flows` | `Waypoints` |
| `laneCosts` | `Route` | `service-stats` | `BarChart3` |
| `refineries` | `FlaskConical` | *(Scenarios / hamburger)* | `Layers` / `Menu` |

Icons are unique across the whole set, not merely within one model's list, so two chapters never
share a glyph for different concepts.

`added-entities` deliberately has no entry: three e2e specs assert
`getByTestId("sidebar-input-added-entities")` has **count 0** (`workspace-fixups.spec.ts:261,502`,
`workspace-fixups-2.spec.ts:72`) — it is a removed entry, not a live one.

### 4.7 Accessibility

- Hamburger: `aria-label` "Collapse sidebar" / "Expand sidebar", `aria-expanded={!collapsed}`,
  `aria-controls` pointing at the nav's id, `data-testid="button-toggle-sidebar"`.
- Rail entry buttons keep `aria-current` as today and gain `aria-label={entry.label}` when
  collapsed, so the accessible name never depends on the hover flyout.
- Keyboard: tabbing onto a rail icon opens its flyout via `group-focus-within`, so a keyboard user
  sees the same label a mouse user does.

## 5. Files

| File | Change |
|---|---|
| `src/components/workspace/SidebarTree.tsx` | the whole feature: collapsed state, persistence, hamburger, rail, flyouts, icons |
| `src/components/workspace/entityIcons.ts` *(new)* | `ENTITY_ICONS` map + `iconForEntity()` fallback accessor |
| `src/pages/Workspace.tsx` | none expected (`SidebarTree`'s existing props are unchanged) |
| `src/__tests__/SidebarTree.test.tsx` | new cases (§6), existing 188 lines expected to pass unmodified |
| 4 e2e specs | add a `.hover()` before collapsed-state scenario-row interactions (§6) |

## 6. Test impact — measured

Counted this session, not estimated:

- **227** sidebar testid references across **26** e2e files and **16** RTL files.
- Repo-wide there is exactly **one** text-based (non-testid) selector matching a sidebar label —
  `e2e/input-map-v2.spec.ts:143`, and it targets a **toast**, not the sidebar.
- The ~195 input/output row references (`sidebar-input-*` / `sidebar-output-*`) keep working with
  **no spec edits**: the rail button carries the same `data-testid` and is visible in the collapsed
  state. Clicking it opens the tab exactly as today.
- RTL assertions on row text keep passing because labels stay in the DOM — e.g.
  `SidebarTree.test.tsx:66` `expect(getByTestId("sidebar-input-warehouses")).toHaveTextContent("Warehouses")`.

**What does need editing.** Scenario-row operations sit inside the Scenarios flyout when collapsed,
so Playwright (which requires visibility) must hover the rail's Scenarios icon first. Affected: 4
e2e files, 6 references — `sidebar-scenario-` ×2, `button-clone-scenario-` ×2,
`button-delete-scenario-` ×2. `button-create-scenario` (×3) is unaffected: `+` stays on the rail.

New coverage in `SidebarTree.test.tsx`:

1. renders collapsed by default with no stored key; expanded when the stored key says so.
2. hamburger toggles both ways and writes `localStorage`.
3. every entry in a given `inputs`/`outputs` list renders an icon, and two different ids never
   render the same icon.
4. collapsed rail exposes the identical set of `sidebar-input-*` / `sidebar-output-*` testids as the
   expanded panel (the parity guarantee the 195 untouched references rest on).
5. labels are present in the DOM while collapsed.
6. the pre-solve Outputs disabled gate still applies in the collapsed rail.

Plus a real-browser QA pass (repo standing requirement) covering: collapse/expand on a model page,
hover flyout on an Inputs icon, the Scenarios flyout's rename/clone/delete, persistence across a
reload, and the first-run empty state (§7).

## 7. Risks

| Risk | Mitigation |
|---|---|
| Collapsed-by-default changes first-run UX — a new user lands on an icon rail, and scenario discovery runs through a hover flyout | the `create-first-scenario-cta` in the content region (`Workspace.tsx:4665-4672`) is unchanged and remains the primary first-run path; QA verifies it reads clearly with the rail collapsed |
| Hover-only flyouts are touch-hostile | hover maps to tap-and-hold on touch, and the hamburger is always available to expand to a fully tappable panel; no touch-specific work in scope |
| A CSS-only flyout can be clipped by an ancestor's `overflow` | the nav itself is `overflow-y-auto` (`SidebarTree.tsx:70`), which would clip a `left-full` child — the collapsed rail must move scrolling to an inner wrapper and keep the nav `overflow-visible`. Explicit implementation step, and case 5 of §6 plus the QA pass are what prove it |
| `localStorage` unavailable/throwing | all access try/caught; failure degrades to the `defaultCollapsed` value, never an exception |

## 8. Definition of done

- Hamburger collapses/expands on all 7 model pages; choice survives a reload.
- Every Inputs/Outputs entry shows a unique icon in both states; Scenarios has its rail icon + `+`.
- Hovering one rail icon reveals only that row's label.
- `pnpm run typecheck`, `pnpm --filter studio test`, `pnpm --filter api-server test`, and the solver
  pytest suite all pass.
- `pnpm e2e:gate` green, including the 4 hover-edited specs.
- Real-browser QA pass recorded.
- Changelog entry in `docs/CHANGELOG-implementation.md`, same commit as the work.
