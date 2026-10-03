# Sidebar Hamburger Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the model-page sidebar into a hamburger-toggled icon rail — collapsed by default with the choice persisted, a unique icon per entry, and a hover flyout that reveals one row's label at a time.

**Architecture:** All behaviour lands in one component, `SidebarTree.tsx`, which gains its own `collapsed` state (no new props plumbed through `Workspace.tsx`). Collapsed/expanded is a width change on the existing `<nav>` inside the existing flex row — not an overlay. Label flyouts are pure CSS (`group-hover`), with one exception: the Scenarios flyout latches open via a single boolean while a row is being renamed or confirmed-for-delete. A separate one-component fix in `NetworkMap.tsx` makes Leaflet redraw when the rail changes width.

**Tech Stack:** React 18 + TypeScript, Tailwind, lucide-react 0.545.0, vitest + React Testing Library, Playwright, react-leaflet 4 / leaflet 1.9.4.

**Spec:** `docs/superpowers/specs/2026-10-03-sidebar-hamburger-rail-design.md` (read it first; §3's D1–D7 are closed decisions, do not reopen them).

## Global Constraints

Every task's requirements implicitly include all of these. They come from the spec's review round 1 and each one is load-bearing — breaking any of them breaks existing tests or ships visibly broken UI.

- **All paths are relative to `artifacts/studio/`** unless stated otherwise. Run every `pnpm` command from the repo root `/Users/shubhamkr/network-optimization-studio`.
- **Never commit on `main`.** Before every `git commit`, run: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`. The branch for this work is `sidebar-hamburger-rail`.
- **Commit message format:** `[SBR-<n>] <imperative summary>`, one task per commit. End every message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **The label pill must be a child of the entry `<button>`**, not a sibling. Four existing assertions read the button's own subtree via `toHaveTextContent` (`SidebarTree.test.tsx:66-67`, `Workspace.test.tsx:1189-1191`).
- **Hidden pills use `opacity-0 pointer-events-none`, never `invisible`/`hidden`/`visibility:hidden`.** `e2e/empty-first-run-workspace.spec.ts:53` calls `.toBeVisible()` on sidebar content and Playwright's visibility check ignores `opacity`; `visibility:hidden` would break it.
- **The collapsed rail has no scroll container.** Per CSS, if either overflow axis is not `visible` the other computes to `auto`, so *any* `overflow-y-auto` ancestor inside the nav clips a `left-full` child horizontally. `overflow-y-auto` belongs to the expanded panel only.
- **Rail-mode entry rows must not carry `truncate`** (`overflow:hidden` clips the absolutely positioned pill). Truncation moves onto the label `<span>` in expanded mode.
- **All three `div[data-testid="sidebar-section-*"]` wrappers exist in both states**, and the "No scenarios yet" row stays inside `sidebar-section-scenarios` in both states.
- **`data-testid` parity:** every `sidebar-input-*`, `sidebar-output-*`, `sidebar-scenario-*`, `button-create-scenario`, `button-rename-scenario-*`, `button-clone-scenario-*`, `button-delete-scenario-*`, `button-confirm-delete-*`, `button-cancel-delete-*` testid exists in *both* states, and each is **mounted exactly once** — rendering a scenario list in both containers simultaneously would make 18 existing references strict-mode violations.
- **Icon size is `w-3.5 h-3.5`** (this directory's dominant size: 42 uses vs 23 of `w-3`, 1 of `w-4`).
- **Use `Grid3x3`, not `Grid3X3`.** Both export from lucide-react 0.545.0; do not "correct" the spelling.
- **`localStorage` key is `nos:sidebar-collapsed`** (matches `UnitContext.tsx:16`'s `nos:display-unit-pref` convention). Every access `try`/`catch`ed.
- **Motion:** every transition carries `motion-reduce:transition-none`.

---

### Task SBR-1: entity → icon map

**Files:**
- Create: `src/components/workspace/entityIcons.ts`
- Test: `src/__tests__/entityIcons.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `iconForEntity(id: string): LucideIcon` (falls back to `Circle` for unknown ids), `SCENARIOS_ICON: LucideIcon`, `ENTITY_ICON_IDS: string[]`. Tasks SBR-2 and SBR-4 import these.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/entityIcons.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Circle } from "lucide-react";
import { iconForEntity, SCENARIOS_ICON, ENTITY_ICON_IDS } from "@/components/workspace/entityIcons";
import { inputEntriesForModel } from "@/pages/Workspace";
import type { StudioModelType } from "@/lib/chapters";

// Every model whose chapter has `workspace: true` (src/lib/chapters.ts).
const MODEL_IDS: StudioModelType[] = [
  "p-median-us",
  "p-median-brazil",
  "transport-coal",
  "two-echelon-gold-au",
  "two-echelon-jade-us",
  "max-coverage-us",
  "delivery-teaching-us",
];

// Mirrors OUTPUT_ENTRIES in src/pages/Workspace.tsx:1347-1354, which is
// module-private. If that list grows, this array must grow with it — the
// "no entity falls back to Circle" assertion below is what catches a new
// output entity shipping without an icon.
const OUTPUT_IDS = [
  "output-map",
  "cost-summary",
  "open-warehouses",
  "customer-assignments",
  "flows",
  "service-stats",
];

describe("entityIcons", () => {
  it("maps every input entity of every model to a real icon, never the fallback", () => {
    for (const modelId of MODEL_IDS) {
      for (const entry of inputEntriesForModel(modelId)) {
        expect(iconForEntity(entry.id), `${modelId}/${entry.id}`).not.toBe(Circle);
      }
    }
  });

  it("maps every output entity to a real icon, never the fallback", () => {
    for (const id of OUTPUT_IDS) {
      expect(iconForEntity(id), id).not.toBe(Circle);
    }
  });

  it("never gives two different entities the same icon", () => {
    const seen = new Map<unknown, string>();
    for (const id of ENTITY_ICON_IDS) {
      const icon = iconForEntity(id);
      const previous = seen.get(icon);
      expect(previous, `${id} shares an icon with ${previous}`).toBeUndefined();
      seen.set(icon, id);
    }
    // The Scenarios rail icon must not collide with an entity icon either.
    expect(seen.has(SCENARIOS_ICON)).toBe(false);
  });

  it("falls back to Circle for an unmapped id instead of throwing", () => {
    expect(iconForEntity("some-entity-that-does-not-exist-yet")).toBe(Circle);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter studio test src/__tests__/entityIcons.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/workspace/entityIcons"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/workspace/entityIcons.ts`:

```ts
import {
  Anvil,
  ArrowRightLeft,
  BarChart3,
  Circle,
  CircleDollarSign,
  ClipboardList,
  DoorOpen,
  Factory,
  FolderOpen,
  Grid3x3,
  Map,
  MapPinned,
  Pickaxe,
  Route,
  Ruler,
  SlidersHorizontal,
  Truck,
  Users,
  Warehouse,
  Waypoints,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Sidebar entity id -> icon. Ids come from inputEntriesForModel() and
 * OUTPUT_ENTRIES in Workspace.tsx. Icons are unique across the WHOLE set, not
 * merely within one model's list, so two chapters never share a glyph for
 * different concepts (entityIcons.test.ts enforces this).
 *
 * Four of these are deliberately not the obvious pick, because the obvious
 * pick misleads a student (spec 2026-10-03 §4.6):
 *  - cost-summary's LABEL is "Solution Summary", and for max-coverage-us the
 *    objective is covered demand, not cost — a receipt would be wrong there.
 *  - customer-assignments is a customer->warehouse mapping; Link2 is the
 *    universal hyperlink glyph.
 *  - refineries: FlaskConical reads "lab/experiment" in an app whose pages are
 *    titled "... Model Lab"; a gold refinery is an industrial processing node.
 *  - open-warehouses: PackageCheck reads "parcel delivered", not "facility open".
 */
const ENTITY_ICONS: Record<string, LucideIcon> = {
  // inputs
  "input-map": Map,
  customers: Users,
  warehouses: Warehouse,
  distances: Ruler,
  "optimization-parameters": SlidersHorizontal,
  deliveryCosts: Truck,
  mines: Pickaxe,
  stations: Zap,
  laneCosts: Route,
  refineries: Anvil,
  plants: Factory,
  "capability-matrix": Grid3x3,
  transportCosts: CircleDollarSign,
  // outputs
  "output-map": MapPinned,
  "cost-summary": ClipboardList,
  "open-warehouses": DoorOpen,
  "customer-assignments": ArrowRightLeft,
  flows: Waypoints,
  "service-stats": BarChart3,
};

/**
 * The Scenarios section's rail icon. FolderOpen rather than Layers: the Input
 * Map tab already has a UI concept called the Layers row (Workspace.tsx's
 * saveInLayersRow*), and two unrelated "layers" on one screen is a teaching
 * hazard.
 */
export const SCENARIOS_ICON: LucideIcon = FolderOpen;

/** Every mapped id, for the uniqueness test. */
export const ENTITY_ICON_IDS: string[] = Object.keys(ENTITY_ICONS);

/**
 * A future sidebar entry with no mapping renders a generic dot rather than
 * crashing the rail.
 */
export function iconForEntity(id: string): LucideIcon {
  return ENTITY_ICONS[id] ?? Circle;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter studio test src/__tests__/entityIcons.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/workspace/entityIcons.ts artifacts/studio/src/__tests__/entityIcons.test.ts
git commit -m "$(cat <<'EOF'
[SBR-1] add sidebar entity -> icon map with uniqueness test

One icon per sidebar entity id across all 7 models, unique across the whole
set rather than per model, with a Circle fallback so an unmapped future entry
renders a dot instead of crashing the rail. The test enumerates
inputEntriesForModel() for every model, so a new entity shipping without an
icon fails here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task SBR-2: collapse state, hamburger, and the rail skeleton

Collapsed/expanded state, persistence, the hamburger, and the icon rail for Inputs/Outputs. Scenarios keeps rendering its **expanded** markup in this task (its rail treatment is SBR-4), so the rail is testable on its own without the flyout machinery.

**Files:**
- Modify: `src/components/workspace/SidebarTree.tsx` (whole file; currently 319 lines)
- Test: `src/__tests__/SidebarTree.test.tsx` (append a new describe block; do **not** edit the existing 188 lines)

**Interfaces:**
- Consumes: `iconForEntity` from SBR-1.
- Produces: `SidebarTreeProps` gains `defaultCollapsed?: boolean`. New exported-for-nobody internals: `EntryRow`, `entryClass`, `labelPillClass`, `STORAGE_KEY`. SBR-3 restyles `labelPillClass`; SBR-4 adds the Scenarios rail branch.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/SidebarTree.test.tsx`:

```tsx
// SBR-2 — collapse state, persistence, rail parity.
describe("SidebarTree — collapsed rail", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders collapsed when there is no stored preference and no prop", () => {
    render(<SidebarTree {...baseProps()} />);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("button-toggle-sidebar")).toHaveAttribute("aria-expanded", "false");
  });

  it("lets an explicit defaultCollapsed prop win over the stored preference", () => {
    window.localStorage.setItem("nos:sidebar-collapsed", "true");
    render(<SidebarTree {...baseProps()} defaultCollapsed={false} />);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
  });

  it("uses the stored preference when no prop is supplied", () => {
    window.localStorage.setItem("nos:sidebar-collapsed", "false");
    render(<SidebarTree {...baseProps()} />);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
  });

  it("toggles both ways from the hamburger and persists the choice", async () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    const toggle = screen.getByTestId("button-toggle-sidebar");

    await userEvent.click(toggle);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
    expect(window.localStorage.getItem("nos:sidebar-collapsed")).toBe("false");

    await userEvent.click(toggle);
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "true");
    expect(window.localStorage.getItem("nos:sidebar-collapsed")).toBe("true");
  });

  it("exposes the identical entry testids collapsed and expanded, each exactly once", () => {
    const ids = [
      "sidebar-input-warehouses",
      "sidebar-input-customers",
      "sidebar-output-open-warehouses",
      "sidebar-output-flows",
    ];

    const collapsed = render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    for (const id of ids) expect(collapsed.container.querySelectorAll(`[data-testid="${id}"]`)).toHaveLength(1);
    collapsed.unmount();

    const expanded = render(<SidebarTree {...baseProps()} defaultCollapsed={false} />);
    for (const id of ids) expect(expanded.container.querySelectorAll(`[data-testid="${id}"]`)).toHaveLength(1);
  });

  it("keeps all three section wrappers in the collapsed rail", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    expect(screen.getByTestId("sidebar-section-scenarios")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-section-inputs")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-section-outputs")).toBeInTheDocument();
  });

  it("keeps each entry label in the DOM inside its own button while collapsed", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    // toHaveTextContent reads the button's OWN subtree — this is what the four
    // pre-existing assertions in this file and Workspace.test.tsx depend on.
    expect(screen.getByTestId("sidebar-input-warehouses")).toHaveTextContent("Warehouses");
    expect(screen.getByTestId("sidebar-output-flows")).toHaveTextContent("Flows");
  });

  it("renders an icon in every entry row in both states", () => {
    const collapsed = render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    expect(screen.getByTestId("sidebar-input-warehouses").querySelector("svg")).not.toBeNull();
    collapsed.unmount();

    render(<SidebarTree {...baseProps()} defaultCollapsed={false} />);
    expect(screen.getByTestId("sidebar-input-warehouses").querySelector("svg")).not.toBeNull();
  });

  it("still disables unsolved outputs in the collapsed rail", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} hasSolvedRun={false} />);
    const output = screen.getByTestId("sidebar-output-flows");
    expect(output).toBeDisabled();
    expect(output).toHaveAttribute("aria-disabled", "true");
  });

  it("never applies truncate to a collapsed entry button (it would clip the label pill)", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    expect(screen.getByTestId("sidebar-input-warehouses").className).not.toContain("truncate");
  });

  it("drops the scroll container when collapsed and restores it when expanded", () => {
    const collapsed = render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    // An overflow-y-auto ancestor also clips horizontally, which would eat the
    // left-full label pill — see the spec's §4.5 constraint 3.
    expect(screen.getByTestId("sidebar-tree").className).not.toContain("overflow-y-auto");
    collapsed.unmount();

    render(<SidebarTree {...baseProps()} defaultCollapsed={false} />);
    expect(screen.getByTestId("sidebar-tree").className).toContain("overflow-y-auto");
  });
});
```

Add `beforeEach` to the file's vitest import — change line 1 from
`import { describe, it, expect, vi } from "vitest";` to
`import { describe, it, expect, vi, beforeEach } from "vitest";`. That is the **only** permitted edit to the existing lines.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter studio test src/__tests__/SidebarTree.test.tsx`
Expected: FAIL — the 11 new tests fail on `Unable to find an element by: [data-testid="button-toggle-sidebar"]` and on the missing `data-collapsed` attribute. The 12 pre-existing tests still pass.

- [ ] **Step 3: Rewrite `SidebarTree.tsx`**

Replace lines 1–2 (the imports) with:

```tsx
import { useRef, useState, type ReactNode } from "react";
import { Plus, Pencil, Copy, Trash2, Menu } from "lucide-react";
import { iconForEntity } from "@/components/workspace/entityIcons";
```

Add to the `SidebarTreeProps` interface, immediately after the `keepOutputsClickable` field:

```tsx
  /**
   * SBR-2 — initial collapsed state, for tests and for any future caller that
   * needs determinism. An explicitly supplied value WINS over the persisted
   * preference; persistence only fills the `undefined` case. The first draft
   * of this had the opposite precedence, which made the prop — invented for
   * determinism — hostage to test order, because jsdom localStorage persists
   * across tests in a file and src/__tests__/setup.ts never clears it.
   */
  defaultCollapsed?: boolean;
```

Insert these module-level helpers immediately above `export function SidebarTree`:

```tsx
// SBR-2 — matches the repo's one existing persistence key, UnitContext.tsx:16's
// "nos:display-unit-pref": colon namespace, kebab name.
const STORAGE_KEY = "nos:sidebar-collapsed";

function readStoredCollapsed(): boolean | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    // localStorage throws in private-mode Safari. Degrade to the default.
    return null;
  }
}

function writeStoredCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Non-fatal: the session keeps working, the choice just doesn't survive.
  }
}

/**
 * The hidden-until-hovered label pill. Four rules here are load-bearing:
 *  - it is a CHILD of the entry <button>, so toHaveTextContent (which reads the
 *    button's own subtree) keeps passing for the four pre-existing assertions;
 *  - `opacity-0`, never `invisible`: Playwright's visibility check ignores
 *    opacity, and e2e/empty-first-run-workspace.spec.ts:53 calls .toBeVisible()
 *    on sidebar content;
 *  - `pointer-events-none` is what actually stops a click landing on a
 *    non-hovered pill;
 *  - it is positioned against the <li class="group/row relative">, so `left-full`
 *    means "just past the rail's right edge".
 */
const labelPillClass =
  "absolute left-full top-0 ml-1 z-50 whitespace-nowrap rounded border bg-popover px-2 py-1.5 " +
  "text-foreground shadow-md opacity-0 pointer-events-none translate-x-1 " +
  "transition-[opacity,transform] duration-150 motion-reduce:transition-none " +
  "group-hover/row:opacity-100 group-hover/row:translate-x-0 " +
  "group-focus-within/row:opacity-100 group-focus-within/row:translate-x-0";

function entryClass({
  collapsed,
  active,
  disabled,
}: {
  collapsed: boolean;
  active: boolean;
  disabled: boolean;
}): string {
  // NOTE: no `truncate` in either branch. `truncate` is overflow:hidden, which
  // clips the absolutely positioned pill; in expanded mode the truncation lives
  // on the label <span> instead (see EntryRow).
  const base = collapsed
    ? "w-full flex items-center justify-center py-2 border-l-2"
    : "w-full flex items-center text-left px-3 py-1.5 border-l-2";
  if (disabled) return `${base} border-transparent text-muted-foreground/40 cursor-not-allowed`;
  return active
    ? `${base} bg-[color:var(--surface-selected)] text-[color:var(--text-brand)] font-medium border-[color:var(--green-500)]`
    : `${base} border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground`;
}

/** One Inputs/Outputs row, in either state. */
function EntryRow({
  entry,
  kind,
  collapsed,
  active,
  disabled,
  onOpen,
}: {
  entry: SidebarEntry;
  kind: "input" | "output";
  collapsed: boolean;
  active: boolean;
  disabled: boolean;
  onOpen: (entry: SidebarEntry) => void;
}) {
  const Icon = iconForEntity(entry.id);
  return (
    <li className="group/row relative">
      <button
        type="button"
        data-testid={`sidebar-${kind}-${entry.id}`}
        disabled={disabled}
        aria-disabled={disabled}
        aria-current={active}
        onClick={() => onOpen(entry)}
        className={entryClass({ collapsed, active, disabled })}
      >
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${collapsed ? "" : "mr-2"}`} aria-hidden="true" />
        <span className={collapsed ? labelPillClass : "truncate"}>{entry.label}</span>
      </button>
    </li>
  );
}
```

Replace the component body (the current `return (` through the closing `</nav>` and `}`, lines 69–147) with:

```tsx
}: SidebarTreeProps) {
  const [collapsed, setCollapsed] = useState<boolean>(
    () => defaultCollapsed ?? readStoredCollapsed() ?? true,
  );

  // The only writer of the persisted preference. SBR-4's Scenarios rail icon
  // calls it too, so there is exactly one persistence path.
  function applyCollapsed(value: boolean) {
    setCollapsed(value);
    writeStoredCollapsed(value);
  }

  function toggleCollapsed() {
    applyCollapsed(!collapsed);
  }

  const createScenarioButton = (
    <button
      type="button"
      data-testid="button-create-scenario"
      aria-label="Create new scenario"
      onClick={onCreateScenario}
      className="text-muted-foreground hover:text-foreground"
    >
      <Plus className="w-3.5 h-3.5" />
    </button>
  );

  const scenarioList = (
    <ul>
      {scenarios.map(s => (
        <ScenarioRow
          key={s.id}
          scenario={s}
          isActive={s.id === activeScenarioId}
          onSelect={() => onSelectScenario(s.id)}
          onRename={name => onRenameScenario(s.id, name)}
          onClone={() => onCloneScenario(s.id)}
          onDelete={() => onDeleteScenario(s.id)}
        />
      ))}
      {scenarios.length === 0 && (
        <li className="px-3 py-1.5 text-xs text-muted-foreground">No scenarios yet</li>
      )}
    </ul>
  );

  return (
    <nav
      id="workspace-sidebar"
      data-testid="sidebar-tree"
      data-collapsed={collapsed}
      // `relative z-50`: .leaflet-container carries an explicit z-index:0
      // (index.css:16-18) and the nav precedes the content column in DOM order,
      // so without this the label pills paint UNDER the map on the auto-opened
      // Input Map tab. Content-column overlays sit at z-40.
      //
      // Collapsed has NO scroll container: per CSS, a non-visible overflow axis
      // forces the other to `auto`, so overflow-y-auto would clip a left-full
      // pill horizontally. The expanded panel has no pills, so it keeps it.
      className={`relative z-50 border-r flex flex-col flex-shrink-0 text-sm bg-background transition-[width] duration-200 motion-reduce:transition-none ${
        collapsed ? "w-11 overflow-visible" : "w-56 overflow-y-auto"
      }`}
    >
      <div className={`border-b py-1.5 flex items-center ${collapsed ? "justify-center" : "px-3"}`}>
        <button
          type="button"
          data-testid="button-toggle-sidebar"
          aria-expanded={!collapsed}
          aria-controls="workspace-sidebar"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleCollapsed}
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <Menu className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* SBR-4 replaces this with the rail icon + flyout when collapsed. */}
      <SidebarSection
        title="Scenarios"
        testid="sidebar-section-scenarios"
        collapsed={false}
        action={createScenarioButton}
      >
        {scenarioList}
      </SidebarSection>

      <SidebarSection title="Inputs" testid="sidebar-section-inputs" collapsed={collapsed}>
        <ul>
          {inputs.map(entry => (
            <EntryRow
              key={entry.id}
              entry={entry}
              kind="input"
              collapsed={collapsed}
              active={entry.id === activeEntityId}
              disabled={false}
              onOpen={onOpenInput}
            />
          ))}
        </ul>
      </SidebarSection>

      <SidebarSection title="Outputs" testid="sidebar-section-outputs" collapsed={collapsed}>
        <ul>
          {outputs.map(entry => (
            <EntryRow
              key={entry.id}
              entry={entry}
              kind="output"
              collapsed={collapsed}
              active={entry.id === activeEntityId}
              disabled={!hasSolvedRun && !keepOutputsClickable}
              onOpen={onOpenOutput}
            />
          ))}
        </ul>
      </SidebarSection>
    </nav>
  );
}
```

Add `defaultCollapsed` to the destructured parameter list (immediately after `keepOutputsClickable = false,`):

```tsx
  defaultCollapsed,
```

Replace `SidebarSection` (currently lines 299–319) with:

```tsx
function SidebarSection({
  title,
  testid,
  action,
  collapsed = false,
  className,
  children,
}: {
  title: string;
  testid: string;
  action?: ReactNode;
  /** Collapsed hides the title text but KEEPS the wrapper + its testid. */
  collapsed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-testid={testid} className={`border-b py-1.5 ${className ?? ""}`}>
      {!collapsed && (
        <div className="flex items-center justify-between px-3 py-1 text-[10px] font-mono font-semibold uppercase tracking-wide text-muted-foreground">
          <span>{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
```

Leave `rowClass` and `ScenarioRow` exactly as they are — `rowClass` keeps its `truncate` because scenario rows never host a pill.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter studio test src/__tests__/SidebarTree.test.tsx`
Expected: PASS, 23 tests (12 pre-existing + 11 new).

Note on why the pre-existing scenario-operation tests still pass: Tailwind's stylesheet is not loaded in jsdom, so `pointer-events-none` has no computed effect there and `userEvent.click` is not blocked. That is also why SBR-4 adds an explicit interaction test for the flyout rather than relying on these.

- [ ] **Step 5: Run the whole studio suite and the typecheck**

First check for a concurrent run (another session's vitest makes unrelated files time out — a documented trap):

```bash
ps aux | grep "[v]itest" | grep -v "zsh -c"
```
Expected: no rows. If there are rows, wait — do not interpret the result.

Run: `pnpm run typecheck && pnpm --filter studio test`
Expected: typecheck exit 0; full suite green.

- [ ] **Step 6: Commit**

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/workspace/SidebarTree.tsx artifacts/studio/src/__tests__/SidebarTree.test.tsx
git commit -m "$(cat <<'EOF'
[SBR-2] collapse the model-page sidebar to an icon rail behind a hamburger

Collapsed by default, choice persisted under nos:sidebar-collapsed, with an
explicit defaultCollapsed prop taking precedence so tests are not hostage to
jsdom's cross-test localStorage. Inputs/Outputs rows render an icon in both
states and keep their label in the DOM inside their own button, so every
existing testid and toHaveTextContent assertion still resolves.

Three constraints are encoded as tests because each one silently breaks
something: no truncate on a collapsed row (clips the pill), no scroll container
when collapsed (a non-visible overflow axis forces the other to auto, clipping
the pill horizontally), and relative z-50 on the nav (leaflet-container has an
explicit z-index 0, so pills would otherwise paint under the map).

Scenarios still renders its expanded markup; SBR-4 gives it the rail treatment.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task SBR-3: Leaflet redraws when the rail changes width

Independent of the sidebar's own markup, and the reason it is before SBR-4: after SBR-2 the rail already changes width, so from here on every manual check of the sidebar on a map tab would show a stale map.

**Files:**
- Modify: `src/components/NetworkMap.tsx` (add a component next to `FitBounds` at `:225`, mount it next to `<FitBounds />` at `:645`)
- Test: `src/__tests__/NetworkMapInvalidateOnResize.test.tsx` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `InvalidateOnResize` — module-private; the test imports it via a named export so it can be driven in isolation. Export it as `export function InvalidateOnResize()`.

- [ ] **Step 1: Write the failing test**

`src/__tests__/setup.ts` stubs `ResizeObserver` as a no-op class, so the test must install its own capturing stub and fire the callback by hand.

Create `src/__tests__/NetworkMapInvalidateOnResize.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { InvalidateOnResize } from "@/components/NetworkMap";

const invalidateSize = vi.fn();
const container = document.createElement("div");

// react-leaflet's useMap() only works inside a MapContainer, which needs a real
// Leaflet instance. Mock the hook instead: this test is about the observer
// wiring, not about Leaflet.
vi.mock("react-leaflet", () => ({
  useMap: () => ({ invalidateSize, getContainer: () => container }),
}));

let observed: Element[] = [];
let fire: (() => void) | null = null;
const disconnect = vi.fn();
const realResizeObserver = global.ResizeObserver;

beforeEach(() => {
  invalidateSize.mockClear();
  disconnect.mockClear();
  observed = [];
  fire = null;
  global.ResizeObserver = class {
    constructor(callback: () => void) {
      fire = callback;
    }
    observe(element: Element) {
      observed.push(element);
    }
    unobserve() {}
    disconnect = disconnect;
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  global.ResizeObserver = realResizeObserver;
});

describe("InvalidateOnResize", () => {
  it("observes the map's own container element", () => {
    render(<InvalidateOnResize />);
    expect(observed).toEqual([container]);
  });

  it("calls map.invalidateSize() when the container resizes", () => {
    render(<InvalidateOnResize />);
    expect(invalidateSize).not.toHaveBeenCalled();
    fire!();
    expect(invalidateSize).toHaveBeenCalledTimes(1);
  });

  it("disconnects the observer on unmount", () => {
    const view = render(<InvalidateOnResize />);
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter studio test src/__tests__/NetworkMapInvalidateOnResize.test.tsx`
Expected: FAIL — `InvalidateOnResize` is not exported from `@/components/NetworkMap`.

- [ ] **Step 3: Write the implementation**

In `src/components/NetworkMap.tsx`, immediately after the `FitBounds` component (which ends at `:231`), add:

```tsx
/**
 * SBR-3 — leaflet 1.9.4's `trackResize` subscribes to **window** resize only
 * (node_modules/leaflet/src/map/Map.js:1324-1326), so a container that changes
 * width without the window changing — exactly what collapsing or expanding the
 * sidebar rail does — leaves the map rendered at its old width: a blank strip or
 * cropped tiles until the window itself is resized. Input Map is auto-opened on
 * entry to a model page, so this is the default state, not an edge case.
 */
export function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const element = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [map]);
  return null;
}
```

`useMap` and `useEffect` are already imported (`:2` and `:1`) — add nothing to the imports.

Then mount it inside `<MapContainer>`, immediately after `<FitBounds bounds={effectiveBounds} />` at `:645`:

```tsx
        <FitBounds bounds={effectiveBounds} />
        <InvalidateOnResize />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter studio test src/__tests__/NetworkMapInvalidateOnResize.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full studio suite and typecheck**

Run: `pnpm run typecheck && pnpm --filter studio test`
Expected: typecheck exit 0; suite green. If map-related suites time out, re-check for a concurrent vitest run (`ps aux | grep "[v]itest" | grep -v "zsh -c"`) before treating it as a regression.

- [ ] **Step 6: Commit**

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/NetworkMap.tsx artifacts/studio/src/__tests__/NetworkMapInvalidateOnResize.test.tsx
git commit -m "$(cat <<'EOF'
[SBR-3] redraw the map when its container resizes, not just the window

leaflet's trackResize listens to window resize only, so the sidebar rail
collapsing or expanding left Input Map / Output Map at their old width — a blank
strip or cropped tiles until the window itself resized. One ResizeObserver
inside MapContainer calls invalidateSize instead. The repo had zero
invalidateSize or ResizeObserver calls in non-test source before this.

The test installs its own capturing ResizeObserver because setup.ts's global
stub is a deliberate no-op.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task SBR-4: Scenarios rail icon, flyout, and the rename latch

**Files:**
- Modify: `src/components/workspace/SidebarTree.tsx`
- Test: `src/__tests__/SidebarTree.test.tsx` (append)

**Interfaces:**
- Consumes: `SCENARIOS_ICON` from SBR-1; `collapsed`, `scenarioList`, `createScenarioButton`, `SidebarSection`'s `collapsed`/`className` props from SBR-2.
- Produces: `button-open-scenarios-flyout` testid; `ScenarioRow` gains `onInteractionStateChange?: (active: boolean) => void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/SidebarTree.test.tsx`:

```tsx
// SBR-4 — the Scenarios rail icon, its flyout, and the rename/confirm latch.
describe("SidebarTree — collapsed Scenarios flyout", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders a Scenarios rail trigger when collapsed and none when expanded", () => {
    const collapsed = render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    expect(screen.getByTestId("button-open-scenarios-flyout")).toBeInTheDocument();
    collapsed.unmount();

    render(<SidebarTree {...baseProps()} defaultCollapsed={false} />);
    expect(screen.queryByTestId("button-open-scenarios-flyout")).not.toBeInTheDocument();
  });

  it("expands the whole sidebar when the Scenarios rail icon is activated (D7)", async () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    await userEvent.click(screen.getByTestId("button-open-scenarios-flyout"));
    expect(screen.getByTestId("sidebar-tree")).toHaveAttribute("data-collapsed", "false");
    expect(window.localStorage.getItem("nos:sidebar-collapsed")).toBe("false");
  });

  it("mounts every scenario row exactly once while collapsed", () => {
    const { container } = render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    for (const id of ["sidebar-scenario-1", "sidebar-scenario-2", "button-delete-scenario-1"]) {
      expect(container.querySelectorAll(`[data-testid="${id}"]`), id).toHaveLength(1);
    }
  });

  it("keeps the create button and the empty row inside the scenarios section while collapsed", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} scenarios={[]} activeScenarioId={null} />);
    const section = screen.getByTestId("sidebar-section-scenarios");
    expect(section).toContainElement(screen.getByTestId("button-create-scenario"));
    // e2e/empty-first-run-workspace.spec.ts:53,95 scope this string to the
    // section, because the first-run CTA duplicates it.
    expect(section).toContainElement(screen.getByText(/no scenarios yet/i));
  });

  it("scenario rows are still interactive inside the collapsed flyout", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} defaultCollapsed={true} />);
    await userEvent.click(screen.getByTestId("button-clone-scenario-2"));
    expect(props.onCloneScenario).toHaveBeenCalledWith(2);
  });

  it("latches the flyout open while a row is renaming, and releases it on commit (D6)", async () => {
    const props = baseProps();
    render(<SidebarTree {...props} defaultCollapsed={true} />);
    const flyout = screen.getByTestId("sidebar-scenarios-flyout");

    expect(flyout).toHaveAttribute("data-pinned", "false");
    await userEvent.click(screen.getByTestId("button-rename-scenario-1"));
    expect(flyout).toHaveAttribute("data-pinned", "true");

    await userEvent.type(screen.getByTestId("input-rename-scenario-1"), "{Enter}");
    expect(screen.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "false");
  });

  it("latches the flyout open while a delete is awaiting confirmation, and releases it on cancel (D6)", async () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    await userEvent.click(screen.getByTestId("button-delete-scenario-2"));
    expect(screen.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "true");

    await userEvent.click(screen.getByTestId("button-cancel-delete-2"));
    expect(screen.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "false");
  });

  it("gives the flyout its own scroll box so a long list cannot clip", () => {
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    const scroller = screen.getByTestId("sidebar-scenarios-flyout-scroll");
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.className).toContain("max-h-");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter studio test src/__tests__/SidebarTree.test.tsx`
Expected: FAIL — 8 new failures on the missing `button-open-scenarios-flyout` and `sidebar-scenarios-flyout` testids. The 23 earlier tests still pass.

- [ ] **Step 3: Write the implementation**

Add `SCENARIOS_ICON` to the `entityIcons` import in `SidebarTree.tsx`:

```tsx
import { iconForEntity, SCENARIOS_ICON } from "@/components/workspace/entityIcons";
```

Inside `SidebarTree`, after the `toggleCollapsed` function, add the latch:

```tsx
  // D6 — the Scenarios flyout is hover-driven, but ScenarioRow's rename input
  // commits on blur (see ScenarioRow's own comment). Moving the cursor off a
  // hover-only flyout mid-rename would therefore unmount the input and commit a
  // half-typed name — a path that does not exist in the expanded panel. While
  // any row is renaming or confirming a delete, the flyout is pinned open and
  // ignores mouse-out. A Set, not a boolean, because `scenarios` is a list and
  // two rows could in principle be mid-interaction.
  const [interactingRows, setInteractingRows] = useState<ReadonlySet<number>>(() => new Set());
  const scenariosFlyoutPinned = interactingRows.size > 0;

  function setRowInteracting(id: number, active: boolean) {
    setInteractingRows(previous => {
      if (active === previous.has(id)) return previous;
      const next = new Set(previous);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }
```

Thread it through `scenarioList` — add one prop to the `<ScenarioRow>` call:

```tsx
          onInteractionStateChange={active => setRowInteracting(s.id, active)}
```

Replace the SBR-2 placeholder Scenarios section (the `<SidebarSection title="Scenarios" … collapsed={false} …>` block) with:

```tsx
      {collapsed ? (
        <SidebarSection
          title="Scenarios"
          testid="sidebar-section-scenarios"
          collapsed
          className="group/scenarios relative"
        >
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              data-testid="button-open-scenarios-flyout"
              aria-label="Scenarios"
              // D7 — this icon has no tab of its own, so its click expands the
              // whole sidebar. That is also the touch and keyboard path: iOS
              // emulates :hover unreliably, and tap-and-hold starts a selection.
              onClick={() => applyCollapsed(false)}
              className="text-muted-foreground hover:text-foreground p-1"
            >
              <SCENARIOS_ICON className="w-3.5 h-3.5" />
            </button>
            {createScenarioButton}
          </div>
          <div
            data-testid="sidebar-scenarios-flyout"
            data-pinned={scenariosFlyoutPinned}
            // `pl-1` rather than `ml-1`: a margin would leave a 4px dead gap
            // between the rail and the flyout that belongs to no element, so
            // the cursor crossing it would drop :hover and close the flyout
            // mid-travel. Padding keeps the hover box touching the rail.
            className={`absolute left-full top-0 z-50 pl-1 w-56 transition-[opacity,transform] duration-150 motion-reduce:transition-none ${
              scenariosFlyoutPinned
                ? "opacity-100 translate-x-0"
                : "opacity-0 pointer-events-none translate-x-1 group-hover/scenarios:opacity-100 group-hover/scenarios:translate-x-0 group-hover/scenarios:pointer-events-auto group-focus-within/scenarios:opacity-100 group-focus-within/scenarios:translate-x-0 group-focus-within/scenarios:pointer-events-auto"
            }`}
          >
            <div className="rounded border bg-popover shadow-md">
              {/* The flyout itself must never clip what it exists to show, so a
                  long scenario list scrolls INSIDE it. */}
              <div
                data-testid="sidebar-scenarios-flyout-scroll"
                className="max-h-[calc(100vh-8rem)] overflow-y-auto"
              >
                {scenarioList}
              </div>
            </div>
          </div>
        </SidebarSection>
      ) : (
        <SidebarSection
          title="Scenarios"
          testid="sidebar-section-scenarios"
          action={createScenarioButton}
        >
          {scenarioList}
        </SidebarSection>
      )}
```

`applyCollapsed` already exists from SBR-2 and is the single persistence path — do not add a second writer here.

In `ScenarioRow`, add the prop to its signature and type:

```tsx
  onInteractionStateChange,
}: {
  scenario: SidebarScenarioItem;
  isActive: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onClone: () => void;
  onDelete: () => void;
  /** D6 — reports "this row is mid-rename or mid-delete-confirm" upward so the
   *  collapsed Scenarios flyout can pin itself open. */
  onInteractionStateChange?: (active: boolean) => void;
}) {
```

and report changes with an effect placed immediately after the row's `useState`/`useRef` declarations:

```tsx
  const interacting = editing || confirmingDelete;
  useEffect(() => {
    onInteractionStateChange?.(interacting);
  }, [interacting, onInteractionStateChange]);
```

Add `useEffect` to the React import at line 1:

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
```

Because `onInteractionStateChange` is an inline arrow in `scenarioList`, it is a new function identity on every render; the effect's guard against a pointless state write lives in `setRowInteracting` (`if (active === previous.has(id)) return previous`), which returns the identical Set and so does not re-render. Do not "optimise" that guard away.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter studio test src/__tests__/SidebarTree.test.tsx`
Expected: PASS, 31 tests (12 pre-existing + 11 from SBR-2 + 8 new).

- [ ] **Step 5: Run the full studio suite and typecheck**

Run: `pnpm run typecheck && pnpm --filter studio test`
Expected: typecheck exit 0; suite green. `Workspace.test.tsx:1189-1191`'s `toHaveTextContent` assertions are the canary for the in-button pill — if they fail, the pill was rendered as a sibling.

- [ ] **Step 6: Commit**

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/workspace/SidebarTree.tsx artifacts/studio/src/__tests__/SidebarTree.test.tsx
git commit -m "$(cat <<'EOF'
[SBR-4] give Scenarios a rail icon, a hover flyout, and a rename latch

Collapsed, Scenarios is one icon whose flyout carries the real scenario list —
rename, clone, delete, and the empty row — mounted exactly once, so the 18
existing scenario testids stay unambiguous. The create button sits on the rail.

Two non-obvious details are deliberate. The flyout pins itself open while a row
is renaming or confirming a delete (D6): ScenarioRow commits a rename on blur,
so a purely hover-driven flyout would commit a half-typed name the moment the
cursor left. And the flyout box is padded, not margined, so no dead gap exists
between rail and flyout for the cursor to cross and lose :hover in.

Clicking the rail icon expands the sidebar (D7) — it has no tab of its own, and
this is the touch/keyboard path, since iOS emulates :hover unreliably.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task SBR-5: repoint the three collapsed-state e2e interactions

Three Playwright clicks land on controls that now live inside the collapsed Scenarios flyout. Every other sidebar reference in the suite — 187 in e2e, 252 in RTL — needs no change, because the rail buttons keep their testids and stay visible.

**Files:**
- Modify: `e2e/empty-first-run-workspace.spec.ts:136-142`
- Modify: `e2e/two-echelon.spec.ts:133`

**Interfaces:**
- Consumes: `button-open-scenarios-flyout` from SBR-4.
- Produces: nothing.

- [ ] **Step 1: Read the two call sites and confirm they are unchanged from the plan's assumptions**

```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/studio
sed -n '130,145p' e2e/empty-first-run-workspace.spec.ts
sed -n '128,136p' e2e/two-echelon.spec.ts
grep -rn "HEADER_TIMEOUT" e2e/empty-first-run-workspace.spec.ts e2e/two-echelon.spec.ts | head -3
```
Expected: the delete/confirm pair at `:141-142`, the clone click at `:133`, and a `HEADER_TIMEOUT` already imported or defined in both files. If `HEADER_TIMEOUT` is absent from either, use the literal `{ timeout: 15000 }` instead and note it in the commit body.

- [ ] **Step 2: Edit `e2e/empty-first-run-workspace.spec.ts`**

Replace the delete block (currently `:138-142`) with:

```ts
    const deleteBtn = page.locator('[data-testid^="button-delete-scenario-"]').first();
    const testId = await deleteBtn.getAttribute("data-testid");
    const id = testId!.replace("button-delete-scenario-", "");
    // SBR — the sidebar now loads collapsed, so the scenario rows live in the
    // rail's hover flyout. Hover the rail icon first; the flyout pins itself
    // open for the confirm step (SidebarTree's D6 latch), so one hover covers
    // both clicks. Explicit timeouts per CLAUDE.md: an unbounded Playwright
    // interaction inherits the whole remaining test budget.
    await page.getByTestId("button-open-scenarios-flyout").hover({ timeout: HEADER_TIMEOUT });
    await deleteBtn.click({ timeout: HEADER_TIMEOUT });
    await page.getByTestId(`button-confirm-delete-${id}`).click({ timeout: HEADER_TIMEOUT });
```

- [ ] **Step 3: Edit `e2e/two-echelon.spec.ts`**

Replace the clone click at `:133` with:

```ts
      // SBR — collapsed-by-default sidebar: the clone button is in the rail's
      // Scenarios flyout now.
      await page.getByTestId("button-open-scenarios-flyout").hover({ timeout: HEADER_TIMEOUT });
      await page.getByTestId(`button-clone-scenario-${originalId}`).click({ timeout: HEADER_TIMEOUT });
```

- [ ] **Step 4: Run just these two specs**

Start the stack (two terminals, or background both):

```bash
cd /Users/shubhamkr/network-optimization-studio
DATABASE_URL="postgresql://shubhamkr@localhost:5432/nos_dev" PORT=3001 pnpm --filter api-server run dev
# then, separately:
PORT=5199 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 pnpm --filter studio run dev
```

Then:

```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/studio
E2E_BASE_URL=http://localhost:5199 npx playwright test e2e/empty-first-run-workspace.spec.ts e2e/two-echelon.spec.ts
```
Expected: PASS. If a test fails on a *different* sidebar control, that control is also inside the flyout — add the same hover, and record it in the commit body as a plan miss.

- [ ] **Step 5: Grep for any sibling spec this plan missed**

```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/studio
grep -rn --include="*.ts" "button-rename-scenario-\|button-clone-scenario-\|button-delete-scenario-\|button-confirm-delete-\|button-cancel-delete-" e2e
```
Expected: only the two edited files (plus comment-only lines). Any `.click()`/`.fill()` on one of these in another spec needs the same hover — this is the repo's standing `spec_gap` discipline, and the e2e job is blocking in CI (`.github/workflows/ci.yml:123`).

- [ ] **Step 6: Commit**

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/e2e/empty-first-run-workspace.spec.ts artifacts/studio/e2e/two-echelon.spec.ts
git commit -m "$(cat <<'EOF'
[SBR-5] hover the Scenarios rail before the three collapsed-flyout clicks

The sidebar now loads collapsed, so scenario delete/confirm-delete
(empty-first-run-workspace) and clone (two-echelon) sit in the rail's hover
flyout. One hover per site covers the pair, because the flyout pins itself open
across the confirm step. Explicit timeouts, per the unbounded-interaction
gotcha.

Every other sidebar reference in the suite is untouched: rail buttons keep their
testids and stay visible, so the 187 e2e and 252 RTL row references resolve
exactly as before.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task SBR-6: full gate, QA pass, changelog

**Files:**
- Modify: `docs/CHANGELOG-implementation.md` (append at the bottom)

**Interfaces:**
- Consumes: everything above.
- Produces: the record. No code.

- [ ] **Step 1: Confirm no concurrent test run, then run the repo verification gate**

```bash
ps aux | grep "[v]itest" | grep -v "zsh -c"
ps aux | grep "[p]ytest" | grep -v "zsh -c"
```
Expected: no rows for either.

```bash
cd /Users/shubhamkr/network-optimization-studio
pnpm run typecheck && pnpm --filter api-server test && pnpm --filter studio test \
  && (cd artifacts/api-server/src/solver && python3 -m pytest tests/ -x)
```
Expected: all green. Known load-induced flakes in the api-server suite (`cors`, `jobRunnerDispatcher`, `resultEnvelope`, `routes`, …) and `test_transport.py::TestSingleSource` re-run clean in isolation — this change touches no API or solver code, so re-run the named file alone before treating any such failure as a regression.

- [ ] **Step 2: Run the e2e gate**

```bash
cd /Users/shubhamkr/network-optimization-studio
pnpm e2e:gate
```
Expected: green. **Read `artifacts/studio/e2e/report/results.json` (`stats.unexpected` and `stats.flaky`), not the console tail** — the summary folds retried failures away silently.

- [ ] **Step 3: Real-browser QA pass**

Against the local stack from SBR-5 step 4, check each of these and record the result:

1. Collapse and expand on a p-median-us model page; the rail shows an icon per entry.
2. With Input Map open, collapse then expand: the map redraws at the new width with no blank strip (SBR-3).
3. Hover one Inputs rail icon: only that row's label slides out, over the map, unclipped.
4. Hover the Scenarios rail icon: rename a scenario, then clone, then delete-with-confirm. The flyout must not close mid-rename when the cursor drifts off it.
5. Reload: the collapsed/expanded choice survives.
6. Log in as a brand-new account with zero scenarios: the first-run CTA still reads clearly with the rail collapsed.
7. Resize the browser to **1366×768** and open the JADE chapter (`two-echelon-jade-us`, the longest rail: 17 rows + 3 dividers). Confirm the bottom Outputs icons are reachable. Playwright will not catch clipping here — `scrollIntoViewIfNeeded` can scroll an `overflow:hidden` ancestor, so its clicks pass regardless. If rows are cut off, tighten rail row height; do **not** add a scroll container (it would clip the pills).

- [ ] **Step 4: Append the changelog entry**

Append at the bottom of `docs/CHANGELOG-implementation.md`, following the format of the existing final entry (read it first; match its heading level and field names). Content to record: the five commits and their SHAs; collapsed-by-default + `nos:sidebar-collapsed`; the four corrected icon choices; the three review-round-1 defects caught before implementation (self-defeating overflow mitigation, flyouts under the map, Leaflet not reflowing); the corrected measurement (227 → 193, because the first count swept `e2e/report/`); the three e2e hover edits; gate numbers from steps 1–2; and the QA results from step 3.

- [ ] **Step 5: Commit**

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add docs/CHANGELOG-implementation.md
git commit -m "$(cat <<'EOF'
[SBR-6] record the sidebar rail bundle in the implementation changelog

Gate numbers, QA results, and the three defects review round 1 caught before any
code was written.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Stop. Do not merge.**

Report to the user: the branch is complete, all gates green, QA recorded. Then **wait for explicit merge approval** — the repo's merge-to-main pipeline is a hard stop at this point, merge approval is not push approval, and push approval is not deploy approval. After an approved merge, run the whole-branch review on the merged state, and `/harness-retro SBR` before the branch is considered finished.

---

## Self-review

**Spec coverage.** Every spec section maps to a task: §4.1 state/persistence → SBR-2; §4.2 expanded icons → SBR-2; §4.3 rail + section wrappers + single-mount → SBR-2 and SBR-4; §4.4 width transition and the Leaflet fix → SBR-2 (classes) and SBR-3; §4.5 all four pill constraints, stacking, the Scenarios flyout, the `pl-1` gap → SBR-2 and SBR-4; §4.6 icon map → SBR-1; §4.7 accessibility (`aria-expanded`, `aria-controls`, no redundant `aria-label`, focus-within flyout) → SBR-2 and SBR-4; §6 test plan → the test steps of SBR-1/2/4 plus SBR-5; §7 risks → SBR-6 step 3 items 6 and 7, and the D6 latch in SBR-4; §8 DoD → SBR-6.

**Known deviation from the spec, deliberate:** the spec's §6 test list has 8 numbered RTL cases; this plan writes 19 across SBR-2 and SBR-4, splitting several of the spec's cases (e.g. its case 1 becomes three precedence tests) and adding assertions for the class-level constraints (`truncate`, `overflow-y-auto`) that only a className check can cover. Superset, not a gap.

**Type consistency.** `iconForEntity(id: string): LucideIcon` and `SCENARIOS_ICON: LucideIcon` are used with those exact names in SBR-2 and SBR-4. `defaultCollapsed?: boolean` is declared in SBR-2 and consumed by SBR-4's tests. `onInteractionStateChange?: (active: boolean) => void` is declared and called with the same signature within SBR-4. `applyCollapsed(value: boolean)` is introduced in SBR-2 as the single writer of the stored preference, and SBR-4's D7 handler calls that same function rather than adding a second persistence path. `InvalidateOnResize()` takes no props and is referenced by that name in both its test and its mount site.
