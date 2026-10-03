# Sidebar Hamburger Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the model-page sidebar into a hamburger-toggled icon rail — collapsed by default with the choice persisted, a unique icon per entry, and a hover flyout that reveals one row's label at a time.

**Architecture:** All sidebar behaviour lands in one component, `SidebarTree.tsx`, which gains its own `collapsed` state (no new props plumbed through `Workspace.tsx`). Collapsed/expanded is a width change on the existing `<nav>` inside the existing flex row — not an overlay. Label flyouts are pure CSS (`group-hover`), with one exception: the Scenarios flyout latches open while a row is being renamed or confirmed-for-delete. A separate shared component, mounted in **all five** `<MapContainer>`s, makes Leaflet redraw when the rail changes width.

**Tech Stack:** React **19.1.0** + TypeScript, Tailwind **v4.3.0** (CSS-first: `@import "tailwindcss"` in `index.css:3`, `@tailwindcss/vite`, **no `tailwind.config.*`**), lucide-react 0.545.0, vitest + React Testing Library, Playwright, react-leaflet / leaflet 1.9.4.

**Spec:** `docs/superpowers/specs/2026-10-03-sidebar-hamburger-rail-design.md` (read it first; §3's D1–D7 are closed decisions, do not reopen them).

## Global Constraints

Every task's requirements implicitly include all of these. They come from the spec's review round 1 and each one is load-bearing — breaking any of them breaks existing tests or ships visibly broken UI.

- **All paths are relative to `artifacts/studio/`** unless stated otherwise. Run every `pnpm` command from the repo root `/Users/shubhamkr/network-optimization-studio`.
- **Never commit on `main`.** Before every `git commit`, run: `[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }`. The branch for this work is `sidebar-hamburger-rail`.
- **Commit message format:** `[SBR-<n>] <imperative summary>`, one task per commit. End every message with the attribution line **the executing session's own system reminder specifies** — do not copy a model name out of this plan, which was written in a different session.
- **Tailwind is v4, and v4 wraps `hover:`/`group-hover:` in `@media (hover: hover)`.** On a touch device the label pills and the Scenarios flyout therefore never appear at all. That is consistent with D7 but changes its status: the Scenarios rail icon's click-to-expand is the **only** touch path to scenario management, not a fallback. Do not add a touch-specific hover shim.
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
  // Aliased: a bare `Map` import shadows the global Map constructor in a module
  // that is a natural place to later write `new Map()`.
  Map as MapIcon,
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
  "input-map": MapIcon,
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
Expected: exit 0, no errors. Note what this does **not** cover: `tsconfig.json` excludes `**/*.test.ts` (but not `*.test.tsx`), so `entityIcons.test.ts` is not typechecked — step 4 passing is the only evidence it is well-typed.

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

<ATTRIBUTION — replace with the exact line your session's reminder specifies>
EOF
)"
```

---

### Task SBR-2: collapse state, hamburger, and the rail skeleton

Collapsed/expanded state, persistence, the hamburger, and the icon rail for Inputs/Outputs. Scenarios keeps rendering its **expanded** markup in this task (its rail treatment is SBR-4), so the rail is testable on its own without the flyout machinery.

**This commit is deliberately not a shippable intermediate state, and the commit body says so.** A `collapsed={false}` Scenarios section inside a `w-11 overflow-visible` nav means `px-3` padding, `truncate`d scenario names and a ~60px hover-action strip inside a 44px rail — the `+` and the action icons overflow the nav and paint over the content column. The tests pass because jsdom has no layout. SBR-4 closes it. Do not ship or demo this commit on its own; if you would rather not have a broken commit in the history at all, squash SBR-2 and SBR-4 together (their tests partition cleanly) and say so in the message.

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

  it("stacks the nav above the map, which carries an explicit z-index", () => {
    // .leaflet-container has z-index:0 (index.css:16-18) and the nav precedes the
    // content column in DOM order, so without this the pills paint under the map.
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    const nav = screen.getByTestId("sidebar-tree");
    expect(nav.className).toContain("relative");
    expect(nav.className).toContain("z-50");
  });

  it("hides the collapsed label pill with opacity, never with visibility", () => {
    // Playwright's visibility check ignores opacity, and
    // e2e/empty-first-run-workspace.spec.ts:53 calls .toBeVisible() on sidebar
    // content; `invisible`/`hidden` would break it. pointer-events-none is what
    // actually stops a click landing on a non-hovered pill.
    render(<SidebarTree {...baseProps()} defaultCollapsed={true} />);
    const pill = screen.getByTestId("sidebar-input-warehouses").querySelector("span");
    expect(pill?.className).toContain("opacity-0");
    expect(pill?.className).toContain("pointer-events-none");
    expect(pill?.className).not.toContain("invisible");
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
Expected: **10 of the 13 new tests fail** on `Unable to find an element by: [data-testid="button-toggle-sidebar"]` and on the missing `data-collapsed` attribute. The other 3 already pass against the old component and are regression guards, not drivers — "keeps all three section wrappers", "keeps each entry label in the DOM inside its own button", and "still disables unsolved outputs". The **17** pre-existing tests still pass (measured by running this file at HEAD — not 12; do not expect 12 anywhere in this plan).

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

Replace **lines 68–147** — that is, the `}: SidebarTreeProps) {` line *and* the body through the closing `</nav>` and `}`. (The replacement block below starts with that same line; replacing only 69–147 leaves two consecutive `}: SidebarTreeProps) {` lines and a syntax error.)

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
Expected: PASS, **30** tests (17 pre-existing + 13 new).

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

<ATTRIBUTION — replace with the exact line your session's reminder specifies>
EOF
)"
```

---

### Task SBR-3: Leaflet redraws when any map container changes width

Independent of the sidebar's own markup, and the reason it comes before SBR-4: after SBR-2 the rail already changes width, so from here on every manual check of the sidebar on a map tab would show a stale map.

**There are five `<MapContainer>` mount sites in production code, not one.** `grep -rn "<MapContainer" src` gives `NetworkMap.tsx:634` and `InputMapTab.tsx:1059, :1562, :2057, :2640`. `InputMapTab` does **not** use `NetworkMap` (zero references) — it builds its own map. `NetworkMap`'s only consumers are `OutputMapTab.tsx` and the dead `Studio.tsx`. So fixing `NetworkMap` alone would leave the **auto-opened Input Map** — the exact tab the spec and QA item 2 single out — unfixed. Hence a shared component, mounted in all five.

**Files:**
- Create: `src/components/workspace/map/InvalidateOnResize.tsx`
- Modify: `src/components/NetworkMap.tsx` (mount next to `<FitBounds />` at `:645`)
- Modify: `src/components/workspace/tabs/InputMapTab.tsx` (mount in all four `<MapContainer>`s: `:1059, :1562, :2057, :2640`)
- Modify: `src/__tests__/Workspace.TabCoverage.test.tsx:58` (extend the `useMap` mock)
- Modify: `src/__tests__/deliveryEditableInputs.test.tsx:40` (extend the `useMap` mock)
- Test: `src/__tests__/InvalidateOnResize.test.tsx` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `InvalidateOnResize` — a props-less component, exported from `@/components/workspace/map/InvalidateOnResize`. Must be rendered as a child of a `<MapContainer>` (it calls `useMap()`).

- [ ] **Step 1: Extend the two react-leaflet mocks that will otherwise crash**

This step comes first because without it the next step's test run is drowned in unrelated failures. Both files mock `useMap` with a two-method stub; the new effect calls `map.getContainer()`, which throws a TypeError from inside a `useEffect` — React surfaces that as an unhandled error and the test fails. `Workspace.TabCoverage.test.tsx` renders the real `OutputMapTab` (its sweep clicks `sidebar-output-output-map` at `:169`), so it hits this immediately; `deliveryEditableInputs.test.tsx` carries the identical mock.

In **both** `src/__tests__/Workspace.TabCoverage.test.tsx` (line 58) and `src/__tests__/deliveryEditableInputs.test.tsx` (line 40), replace:

```ts
    useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn() }),
```

with:

```ts
    // SBR-3 — InvalidateOnResize observes the map's container and calls
    // invalidateSize; a two-method stub makes it throw from inside an effect.
    useMap: () => ({
      setView: vi.fn(),
      fitBounds: vi.fn(),
      getContainer: () => document.createElement("div"),
      invalidateSize: vi.fn(),
    }),
```

Do **not** instead guard the production code with `typeof map.getContainer === "function"`. That is production code bending to a test mock.

- [ ] **Step 2: Write the failing test**

`src/__tests__/setup.ts` stubs `ResizeObserver` as a no-op class, so the test must install its own capturing stub and fire the callback by hand.

Create `src/__tests__/InvalidateOnResize.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { InvalidateOnResize } from "@/components/workspace/map/InvalidateOnResize";

const invalidateSize = vi.fn();
const container = document.createElement("div");

// Spread importActual rather than replacing the module wholesale — the pattern
// every other react-leaflet mock in this repo uses. InvalidateOnResize itself
// only imports useMap, but the spread keeps this honest if that changes.
vi.mock("react-leaflet", async () => {
  const actual = await vi.importActual<typeof import("react-leaflet")>("react-leaflet");
  return {
    ...actual,
    useMap: () => ({ invalidateSize, getContainer: () => container }),
  };
});

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
    disconnect = disconnect;
    constructor(callback: () => void) {
      fire = callback;
    }
    observe(element: Element) {
      observed.push(element);
    }
    unobserve() {}
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

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter studio test src/__tests__/InvalidateOnResize.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/workspace/map/InvalidateOnResize"`.

- [ ] **Step 4: Write the implementation**

Create `src/components/workspace/map/InvalidateOnResize.tsx`:

```tsx
import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * SBR-3 — leaflet 1.9.4's `trackResize` subscribes to **window** resize only
 * (node_modules/leaflet/src/map/Map.js:1324-1326), so a container that changes
 * width without the window changing — exactly what collapsing or expanding the
 * sidebar rail does — leaves the map rendered at its old width: a blank strip or
 * cropped tiles until the window itself is resized. Input Map is auto-opened on
 * entry to a model page, so this is the default state, not an edge case.
 *
 * Must be rendered as a child of a <MapContainer> (it calls useMap()). Mounted
 * in all five production map containers: NetworkMap.tsx and InputMapTab.tsx's
 * four. InputMapTab does NOT go through NetworkMap, which is why this lives in
 * its own module rather than inside NetworkMap.
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

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter studio test src/__tests__/InvalidateOnResize.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Mount it in all five map containers**

In `src/components/NetworkMap.tsx`, add the import below the existing `@/components/workspace/map/MapLegend` import:

```tsx
import { InvalidateOnResize } from "@/components/workspace/map/InvalidateOnResize";
```

and mount it immediately after `<FitBounds bounds={effectiveBounds} />` at `:645`:

```tsx
        <FitBounds bounds={effectiveBounds} />
        <InvalidateOnResize />
```

In `src/components/workspace/tabs/InputMapTab.tsx`, add the same import, then add `<InvalidateOnResize />` as the **first child** of each of the four `<MapContainer>` elements (`:1059, :1562, :2057, :2640`). Find each by its opening tag's closing `>` and insert on the next line. Verify you got all four:

```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/studio
grep -c "<InvalidateOnResize />" src/components/workspace/tabs/InputMapTab.tsx   # expect 4
grep -c "<InvalidateOnResize />" src/components/NetworkMap.tsx                    # expect 1
```

- [ ] **Step 7: Run the full studio suite and typecheck**

Run: `pnpm run typecheck && pnpm --filter studio test`
Expected: typecheck exit 0; suite green — **including `Workspace.TabCoverage.test.tsx` and `deliveryEditableInputs.test.tsx`**, which are green only because of step 1. If either reports `map.getContainer is not a function`, step 1 was skipped or applied to one file. If unrelated map suites time out, re-check for a concurrent vitest run (`ps aux | grep "[v]itest" | grep -v "zsh -c"`) before treating it as a regression.

- [ ] **Step 8: Commit**

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/src/components/workspace/map/InvalidateOnResize.tsx \
        artifacts/studio/src/components/NetworkMap.tsx \
        artifacts/studio/src/components/workspace/tabs/InputMapTab.tsx \
        artifacts/studio/src/__tests__/InvalidateOnResize.test.tsx \
        artifacts/studio/src/__tests__/Workspace.TabCoverage.test.tsx \
        artifacts/studio/src/__tests__/deliveryEditableInputs.test.tsx
git commit -m "$(cat <<'EOF'
[SBR-3] redraw every map when its container resizes, not just the window

leaflet's trackResize listens to window resize only, so the sidebar rail
collapsing or expanding left the maps at their old width — a blank strip or
cropped tiles until the window itself resized. One shared ResizeObserver
component, mounted in all five production MapContainers.

Five, not one: InputMapTab builds its own map and does not go through
NetworkMap, so a NetworkMap-only fix would have missed the auto-opened Input Map
— the default tab, and the one state this is most visible in.

Two existing react-leaflet mocks stub useMap with setView/fitBounds only; they
gain getContainer/invalidateSize, because a two-method stub makes the new effect
throw. The production code is deliberately not guarded against that — a mock
does not get to shape the real component.

EOF
)"
```

(Append the attribution line the executing session's reminder specifies before committing.)
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

  it("releases the latch when a row unmounts mid-rename (a list refetch dropping it)", async () => {
    const props = baseProps();
    const view = render(<SidebarTree {...props} defaultCollapsed={true} />);
    await userEvent.click(screen.getByTestId("button-rename-scenario-1"));
    expect(screen.getByTestId("sidebar-scenarios-flyout")).toHaveAttribute("data-pinned", "true");

    // Scenario 1 disappears from the list while its rename is open.
    view.rerender(<SidebarTree {...props} defaultCollapsed={true} scenarios={[{ id: 2, name: "Best 3-4 DCs" }]} />);
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
Expected: **6 of the 9 new tests fail** on the missing `button-open-scenarios-flyout` and `sidebar-scenarios-flyout` testids. Three already pass against SBR-2's component and are regression guards — "mounts every scenario row exactly once", "keeps the create button and the empty row inside the scenarios section", and "scenario rows are still interactive". The 30 earlier tests still pass.

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

  // Stable identity (it touches nothing but the setter), so ScenarioRow can list
  // it in an effect's deps AND run a cleanup without looping. With an unstable
  // callback, a cleanup that clears the flag would re-add it on the next render,
  // forever. The `active === previous.has(id)` bail-out returns the IDENTICAL Set
  // so React drops the re-render — do not "simplify" it away.
  const setRowInteracting = useCallback((id: number, active: boolean) => {
    setInteractingRows(previous => {
      if (active === previous.has(id)) return previous;
      const next = new Set(previous);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
```

Add `useCallback` to the React import:

```tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
```

Thread the latch through `scenarioList` by passing the **stable function itself** — not an inline arrow, which would be a new identity every render and defeat the cleanup in `ScenarioRow`:

```tsx
          onInteractionStateChange={setRowInteracting}
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
   *  collapsed Scenarios flyout can pin itself open. Takes the id, so the row can
   *  also clear its own flag on unmount without the parent tracking which row
   *  reported what. */
  onInteractionStateChange?: (id: number, active: boolean) => void;
}) {
```

and report changes with an effect placed immediately after the row's `useState`/`useRef` declarations:

```tsx
  const interacting = editing || confirmingDelete;
  useEffect(() => {
    onInteractionStateChange?.(scenario.id, interacting);
    // The cleanup matters: a row that unmounts mid-rename or mid-confirm — a
    // scenario-list refetch drops it — would otherwise leave its id in the
    // parent's Set and pin the flyout open until something else toggled it.
    // Safe from looping ONLY because onInteractionStateChange is a stable
    // useCallback; an inline arrow here would re-add the flag every render.
    return () => onInteractionStateChange?.(scenario.id, false);
  }, [scenario.id, interacting, onInteractionStateChange]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter studio test src/__tests__/SidebarTree.test.tsx`
Expected: PASS, **39** tests (17 pre-existing + 13 from SBR-2 + 9 new).

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

<ATTRIBUTION — replace with the exact line your session's reminder specifies>
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
# then, separately — note the two VITE_* vars:
PORT=5199 BASE_PATH=/ API_PROXY_TARGET=http://localhost:3001 \
  VITE_POSTHOG_KEY=phc_local_dummy_key \
  VITE_SENTRY_DSN=https://x@o.ingest.sentry.io/1 \
  pnpm --filter studio run dev
```

**Why those two dummy values matter.** Without them, `e2e/posthog-analytics.spec.ts` and
`e2e/sentry-capture.spec.ts` fail for a purely environmental reason and *look* like real breakage:
`analytics.ts:14` returns early unless `VITE_POSTHOG_KEY` is truthy, so nothing is ever captured and
both specs assert against captures. `ci.yml:202-203` supplies them as repository secrets; a local
shell has neither. **Dummy values are correct, not a workaround** — both specs document it
themselves (`posthog-analytics.spec.ts:63-64`, `sentry-capture.spec.ts:80-83`): every request to the
ingest host is intercepted and stubbed before it leaves the page, so no real key is ever contacted.
The DSN must merely be *syntactically* valid; the shape above matches
`src/lib/errorTracking.test.ts:18`. The Cosmetics session hit exactly these two as its only
unexpected e2e failures — with the vars set, they should run for real instead.

Then:

```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/studio
E2E_BASE_URL=http://localhost:5199 npx playwright test e2e/empty-first-run-workspace.spec.ts e2e/two-echelon.spec.ts
```
Expected: PASS. If a test fails on a *different* sidebar control, that control is also inside the flyout — add the same hover, and record it in the commit body as a plan miss.

- [ ] **Step 5: Grep for any sibling spec this plan missed**

```bash
cd /Users/shubhamkr/network-optimization-studio/artifacts/studio
grep -rn --include="*.ts" "button-rename-scenario-\|button-clone-scenario-\|button-delete-scenario-\|button-confirm-delete-\|button-cancel-delete-\|input-rename-scenario-\|sidebar-scenario-" e2e
```
Expected: `sidebar-scenario-` appears in `bundle6-ui-tweaks.spec.ts:157-158` as `toHaveAttribute` reads (no hover needed), and the rest only in the two edited files plus comment-only lines.

**Also re-run `e2e/bundle6-ui-tweaks.spec.ts` specifically, even though this bundle does not edit it.** The `cosmetic-ui` bundle rewrote it: `:165-166` now assert `getByTestId("sidebar-input-input-map")` has `aria-current="true"` and `input-map-tab` is visible, and a case below that **clicks `sidebar-input-warehouses`** and asserts a toolbar swap. The rail keeps that testid, keeps it visible and keeps `aria-current`, so it should pass untouched — but it is a sibling spec that depends on sidebar navigation, and proving it green before merge is this repo's standing `spec_gap` discipline:

```bash
E2E_BASE_URL=http://localhost:5199 npx playwright test e2e/bundle6-ui-tweaks.spec.ts
``` Any `.click()`/`.fill()`/`.hover()`-less interaction with one of these in another spec needs the same hover — the repo's standing `spec_gap` discipline, and the e2e job is blocking in CI (`.github/workflows/ci.yml:123`).

- [ ] **Step 6: Run the repo verification gate**

Confirm nothing else is running first — another session's vitest or pytest makes unrelated files time out, and that is a documented trap, not a regression:

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
Expected: all green. Known load-induced flakes in the api-server suite (`cors`, `jobRunnerDispatcher`, `resultEnvelope`, `routes`, …) and `test_transport.py::TestSingleSource` re-run clean in isolation — this change touches no API or solver code at all, so re-run the named file alone before treating any such failure as a regression.

- [ ] **Step 7: Run the e2e gate against the LOCAL stack**

`playwright.config.ts:3-5` defaults `BASE_URL` to a **dead Replit host** when `E2E_BASE_URL` is unset, and there is no `webServer` block — so a bare `pnpm e2e:gate` runs the whole suite against nothing. Keep both dev servers from step 4 running and pass the base URL explicitly:

```bash
cd /Users/shubhamkr/network-optimization-studio
E2E_BASE_URL=http://localhost:5199 pnpm e2e:gate
```
Expected: green. **Read `artifacts/studio/e2e/report/results.json` (`stats.unexpected` and `stats.flaky`), not the console tail** — the summary folds retried failures away silently, and this repo has a documented list of load-sensitive specs that pass only on retry.

- [ ] **Step 8: Real-browser QA pass**

Against the same local stack, check each of these and record the result:

1. Collapse and expand on a p-median-us model page; the rail shows an icon per entry.
2. With **Input Map** open (it auto-opens), collapse then expand: the map redraws at the new width with no blank strip and no cropped tiles. This is the tab that proves SBR-3 was mounted in `InputMapTab`'s four containers and not just `NetworkMap`'s one.
3. Repeat item 2 with **Output Map** open (that is the `NetworkMap` path).
4. Hover one Inputs rail icon: only that row's label slides out, over the map, unclipped.
5. Hover the Scenarios rail icon: rename a scenario, then clone, then delete-with-confirm. The flyout must not close mid-rename when the cursor drifts off it.
6. Reload: the collapsed/expanded choice survives.
7. Log in as a brand-new account with zero scenarios: the first-run CTA still reads clearly with the rail collapsed.
8. Resize to **375px wide** and open a p-median-us model page. The Cosmetics session measured, on `cosmetic-ui`, that the fixed 224px sidebar leaves ~119px of usable row against a 147px button group, clipping `2. Min Distance`, the Layers chips, the map legend and the Leaflet attribution — a pre-existing squeeze. Collapsed, the rail gives 180px of that back. Record whether each of those four actually stops clipping. This is the strongest evidence for the collapsed-by-default decision (spec D8), so it is measured, not assumed.
9. Check the **feedback launcher's overlap with the chapter-card grid at 768px and 900px**, with the
   rail both collapsed and expanded. The Cosmetics session measured the launcher intercepting clicks
   on a small corner of one card in the 768–900px band (0 cards at 375px, 1 at 768px, 1 at 900px) —
   cosmetic, bounded, and no spec exercises those widths. It is listed here because this bundle
   changes the content column's width, which can move where that overlap lands. If the rail makes it
   worse, say so in the QA record; do not fix it here — the launcher is `cosmetic-ui`'s surface.
10. Resize to **1366×768** and open the JADE chapter (`two-echelon-jade-us`, the longest rail: 17 rows + 3 dividers). Confirm the bottom Outputs icons are reachable. Playwright will not catch clipping here — `scrollIntoViewIfNeeded` can scroll an `overflow:hidden` ancestor, so its clicks pass regardless. If rows are cut off, tighten rail row height; do **not** add a scroll container (it would clip the pills).

- [ ] **Step 9: Append the changelog entry**

Append at the bottom of `docs/CHANGELOG-implementation.md`, following the format of the existing final entry (read it first; match its heading level and field names). Record: the five commits and their SHAs; collapsed-by-default + `nos:sidebar-collapsed`; the four corrected icon choices; the defects the two Fable 5 review rounds caught before they shipped (round 1 on the spec: self-defeating overflow mitigation, flyouts under the map, Leaflet not reflowing at all; round 2 on the plan: the Leaflet fix targeting the wrong component, two react-leaflet mocks that would have crashed, the e2e gate pointed at a dead Replit host); the corrected measurements (227 → 193 sidebar refs, because the first count swept `e2e/report/`; 12 → 17 pre-existing `SidebarTree` tests); the three e2e hover edits; gate numbers from steps 6–7; and the QA results from step 8.

- [ ] **Step 10: Commit the e2e edits and the changelog together**

One commit, so the record ships with the work it describes (CLAUDE.md hard rule 9, and the spec's own §8). This is why the gate and QA run *before* this commit rather than after it.

```bash
cd /Users/shubhamkr/network-optimization-studio
[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ] || { echo "ON MAIN — commit refused"; exit 1; }
git add artifacts/studio/e2e/empty-first-run-workspace.spec.ts \
        artifacts/studio/e2e/two-echelon.spec.ts \
        docs/CHANGELOG-implementation.md
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

Carries the changelog entry for the whole bundle, with the gate and QA numbers,
per hard rule 9 — the record ships in the same commit as the work.

EOF
)"
```

(Append the attribution line the executing session's reminder specifies before committing.)

---

### Task SBR-6: stop

No files. No commit. This task exists so the pipeline's hard stop is a tracked step rather than something to remember.

- [ ] **Step 1: Confirm the branch is clean and every task's gate was recorded**

```bash
cd /Users/shubhamkr/network-optimization-studio
git status --short            # expect empty
git log --oneline sidebar-hamburger-rail ^main
```
Expected: the three doc commits plus the five task commits, nothing uncommitted.

- [ ] **Step 2: Report to the user and STOP**

Report: branch complete, which gates ran and their numbers, the QA results including items 2, 3 and 8, and anything deferred.

Then **wait for explicit merge approval.** Do not merge, do not push, do not deploy. The repo's pipeline is: all tasks done → **prompt the user** → merge to local `main` → whole-branch review on the merged state → push → (separately approved) deploy. Merge approval is not push approval; push approval is not deploy approval. If the review returns findings, `git switch sidebar-hamburger-rail` **before** fixing them — step 4 leaves HEAD on `main` and the fixes are a new commit.

- [ ] **Step 3: After an approved merge and review, run the retro**

`/harness-retro SBR` — a branch is not finished until it has run. It records the metrics row, logs each gate failure by cause, and fires the second-occurrence gate rule.

## Self-review

**Spec coverage.** §4.1 state/persistence → SBR-2; §4.2 expanded icons → SBR-2; §4.3 rail, section wrappers, single-mount → SBR-2 + SBR-4; §4.4 width transition + the Leaflet fix → SBR-2 (classes) + SBR-3; §4.5's four pill constraints, stacking and the `pl-1` gap → SBR-2 + SBR-4 (every one now has an assertion, including the two that are class-string facts); §4.6 icon map → SBR-1; §4.7 accessibility → SBR-2 + SBR-4; §6 test plan → the test steps of SBR-1/2/4 plus SBR-5 step 5; §7 risks → SBR-5 step 8 items 7 and 8, plus the D6 latch in SBR-4; §8 DoD → SBR-5 steps 6-9 and SBR-6.

**Deliberate deviations from the spec, both supersets:**
1. The spec's §6 lists 8 RTL cases; this plan writes 22 across SBR-2 (13) and SBR-4 (9), splitting some of the spec's cases and adding className checks for constraints only a class assertion can cover.
2. **The spec's §4.4 and §5 are wrong about where the Leaflet fix goes** — they name `NetworkMap.tsx` only, but `InputMapTab.tsx` builds its own four `<MapContainer>`s and never goes through `NetworkMap`, so the auto-opened Input Map would have been left unfixed. SBR-3 mounts a shared component in all five. §4.4 and §5 of the spec were corrected in place at the same commit as this plan revision — the spec is the canonical copy and must not stay wrong. Nothing left for the executor to fix there.

**Type consistency.** `iconForEntity(id: string): LucideIcon` and `SCENARIOS_ICON: LucideIcon` are used under those exact names in SBR-2 and SBR-4. `defaultCollapsed?: boolean` is declared in SBR-2 and consumed by SBR-4's tests. `onInteractionStateChange?: (id: number, active: boolean) => void` — the id-taking signature — is declared in SBR-4 and called with that signature in both the effect and its cleanup, and the value passed is the stable `useCallback`'d `setRowInteracting`, never an inline arrow. `applyCollapsed(value: boolean)` is introduced in SBR-2 as the single writer of the stored preference; SBR-4's D7 handler calls it rather than adding a second path. `InvalidateOnResize()` takes no props and is referenced by that name in its test, its module path, and all five mount sites.

**Counts, measured not guessed.** `SidebarTree.test.tsx` has **17** tests at HEAD (ran it) → 30 after SBR-2 → 39 after SBR-4. `grep -rn "<MapContainer" src` → **5** production sites. The first draft of this plan said 12 / 23 / 31 and one map site; all four numbers were wrong.

---

## Appendix A — citations pre-derived against `cosmetic-ui@18a7d99`

Computed read-only while the gate lock was held by the Cosmetics session, so that the
citation-re-derivation pass (task #2, the first act of execution) is a confirmation rather than a
discovery. **Re-verify after the real merge** — `main` may move again before then, and a merge
commit is not guaranteed to produce the same line numbers as the branch tip.

| Citation | In plan/spec (pre-COSM `main`) | On `cosmetic-ui@18a7d99` | Delta |
|---|---|---|---|
| `Workspace.tsx` — `<SidebarTree` mount | `:4580` | `:4580` | **unchanged** |
| `Workspace.tsx` — `create-first-scenario-cta` block | `:4665-4672` | `:4692-4699` | **+27** |
| `Workspace.tsx` — total lines | 4835 | 4862 | +27 |
| `Workspace.test.tsx` — the three `toHaveTextContent` canaries | `:1189-1191` | `:1190-1192` | **+1**, assertions byte-identical |
| `InputMapTab.tsx` — the four `<MapContainer>`s | `:1059, :1562, :2057, :2640` | `:1074, :1577, :2072, :2655` | **+15 each** |
| `NetworkMap.tsx` — `function FitBounds` | `:225` | `:225` | unchanged |
| `NetworkMap.tsx` — `<FitBounds …/>` mount | `:645` | `:645` | unchanged |
| `SidebarTree.tsx` — total lines (SBR-2 replaces `68-147`) | 319 | 319 | **untouched — the line range in SBR-2 step 3 is still valid** |

Also confirmed by `git diff --name-only main...18a7d99`: `SidebarTree.tsx`, `NetworkMap.tsx`,
`empty-first-run-workspace.spec.ts` and `two-echelon.spec.ts` appear **nowhere** in the Cosmetics
bundle. Every file this plan writes to is either new or exclusively this branch's.

Two things the pre-derivation changes about execution:

1. **SBR-3's `InputMapTab` insertion points are all `+15`.** The instruction to locate them by content
   stands regardless — the merge could shift them again — but the expected targets are now known, so
   an unexpected number of `<MapContainer>` hits is a signal to stop rather than to improvise.
2. **`InputMapTab.tsx`'s four containers are byte-identical to each other**
   (`<MapContainer key={mapKey} {...boundsProps} zoom={4} className="h-full w-full" scrollWheelZoom>`),
   so a naive find-and-replace on that string would hit all four — convenient, but it also means a
   `grep -c` of the opening tag cannot distinguish them. Count `<InvalidateOnResize />` (expect 4),
   not the container tag, when verifying the edit.
