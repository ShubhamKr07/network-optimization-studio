import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Pencil, Copy, Trash2, Menu } from "lucide-react";
import { iconForEntity, SCENARIOS_ICON } from "@/components/workspace/entityIcons";

export interface SidebarScenarioItem {
  id: number;
  name: string;
}

export interface SidebarEntry {
  id: string;
  label: string;
}

interface SidebarTreeProps {
  scenarios: SidebarScenarioItem[];
  activeScenarioId: number | null;
  onSelectScenario: (id: number) => void;
  onCreateScenario: () => void;
  inputs: SidebarEntry[];
  outputs: SidebarEntry[];
  /**
   * Outputs entries are greyed out/disabled until this is true (A0.1 brief:
   * "until a solved run exists for the active scenario"). A3.2: the caller
   * combines `result != null` with `!stale` before passing this down — a
   * solved-but-stale scenario also greys Outputs, not just an unsolved one.
   */
  hasSolvedRun: boolean;
  /**
   * SBR-2 — initial collapsed state, for tests and for any future caller that
   * needs determinism. An explicitly supplied value WINS over the persisted
   * preference; persistence only fills the `undefined` case. The first draft
   * of this had the opposite precedence, which made the prop — invented for
   * determinism — hostage to test order, because jsdom localStorage persists
   * across tests in a file and src/__tests__/setup.ts never clears it.
   */
  defaultCollapsed?: boolean;
  /** Currently-open/active tab's entity id, for highlighting. */
  activeEntityId?: string | null;
  onOpenInput: (entry: SidebarEntry) => void;
  onOpenOutput: (entry: SidebarEntry) => void;

  // A4.1 — per-scenario-row operations. Rename fires immediately (its own
  // isolated `{name}`-only PATCH) rather than deferring to any tab's Save
  // toolbar — see Workspace.tsx's handleRenameScenario for the rationale
  // (a sibling row's rename has no "active scenario" editing context to
  // defer to). Clone is immediate (matches Studio.tsx — no confirm step);
  // Delete requires an explicit confirm click (matches Studio.tsx's
  // confirmDeleteId pattern) before the callback fires.
  onRenameScenario: (id: number, name: string) => void;
  onCloneScenario: (id: number) => void;
  onDeleteScenario: (id: number) => void;
}

/**
 * KNOWN LIMIT of the collapsed rail's height (review finding 2).
 *
 * The rail deliberately has NO scroll container: `overflow-y-auto` would make
 * `overflow-x` compute to `auto` too and clip the `left-full` label pills
 * horizontally. Its height is therefore a hard ceiling, and the parent
 * (`Workspace.tsx`'s `flex-1 min-h-0 flex overflow-hidden`) clips anything past
 * it with no way to scroll to it.
 *
 * Measured on the longest rail, `two-echelon-jade-us` (8 inputs + 6 outputs):
 * at 1366x768 the last output icon's bottom sits at ~585px against a 768px
 * viewport — comfortable. `py-1.5` rather than `py-2` on rail rows (see
 * entryClass) buys ~56px over the first implementation.
 *
 * The residual: a window whose INNER height drops below roughly 530px will
 * clip the last output icons on that one model. The escape hatch is the
 * hamburger — the expanded panel keeps `overflow-y-auto` and scrolls normally,
 * so nothing is permanently unreachable. If this ever needs a real fix, the
 * only shapes that work are a scroll wrapper with the pills moved to `fixed`
 * positioning (or a portal) — NOT adding `overflow-y-auto` here, which would
 * silently eat the pills.
 */

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
    // py-1.5, not py-2 (review finding 2): the collapsed rail has no scroll
    // container by design — overflow-y-auto would clip the left-full pill
    // horizontally — so its total height is a hard limit, and the parent
    // (Workspace.tsx's `flex-1 min-h-0 flex overflow-hidden`) clips anything
    // past it with no way to scroll. 4px per row x 14 rows on the longest rail
    // (two-echelon-jade-us) buys ~56px of headroom. See the module note below
    // for the residual limit that remains.
    ? "w-full flex items-center justify-center py-1.5 border-l-2"
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

// A0.1 — left sidebar shell: Scenarios (+ create), Inputs, Outputs
// (greyed pre-solve). A4.1 adds real per-row scenario operations (rename,
// clone, delete) — see ScenarioRow below. SBR-2 makes the whole thing
// collapsible to an icon rail behind a hamburger.
export function SidebarTree({
  scenarios,
  activeScenarioId,
  onSelectScenario,
  onCreateScenario,
  inputs,
  outputs,
  hasSolvedRun,
  defaultCollapsed,
  activeEntityId = null,
  onOpenInput,
  onOpenOutput,
  onRenameScenario,
  onCloneScenario,
  onDeleteScenario,
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

  // SBR-6 (review finding 1) — the latch above has no self-release for a delete
  // that is STARTED and then abandoned. A rename self-heals, because the input's
  // onBlur fires commitRename; a delete-confirm has no equivalent. Without this,
  // clicking a trash icon and then moving the mouse away leaves the flyout
  // pinned forever — and the pinned branch deliberately drops
  // `pointer-events-none`, so a 224px-wide interactive panel sits over the
  // content column swallowing clicks on the map and grids beneath it. There is
  // no outside-click or Escape path, by design, so nothing else would release
  // it. Leaving the flyout therefore cancels any pending confirm; renames are
  // left alone, since blur already handles them and cancelling mid-rename could
  // discard typing.
  const [cancelConfirmSignal, setCancelConfirmSignal] = useState(0);
  const releasePendingConfirms = useCallback(() => setCancelConfirmSignal(n => n + 1), []);

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
          onInteractionStateChange={setRowInteracting}
          cancelConfirmSignal={cancelConfirmSignal}
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

      {collapsed ? (
        <SidebarSection
          title="Scenarios"
          testid="sidebar-section-scenarios"
          collapsed
          className="group/scenarios relative"
          onMouseLeave={releasePendingConfirms}
        >
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              data-testid="button-open-scenarios-flyout"
              // Review finding 6 — this button EXPANDS the sidebar (D7); it does
              // not open the flyout, which is hover-driven. The testid is kept
              // despite naming the wrong behaviour because two e2e specs hover
              // it by that name; the accessible name and state are corrected
              // here so a screen-reader user is told what actually happens,
              // matching the hamburger above.
              aria-label="Expand sidebar to manage scenarios"
              aria-expanded={false}
              aria-controls="workspace-sidebar"
              // D7 — this icon has no tab of its own, so its click expands the
              // whole sidebar. That is also the touch and keyboard path: Tailwind
              // v4 wraps group-hover in @media (hover: hover), so on touch the
              // flyout never appears at all.
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
              // CH4O-P1 — `hasSolvedRun` alone. The `keepOutputsClickable`
              // opt-out (CH4-18) had exactly one caller, max-coverage-us, and
              // this branch removed the two-step workflow it existed for; it
              // is gone rather than left as live-looking dead API.
              disabled={!hasSolvedRun}
              onOpen={onOpenOutput}
            />
          ))}
        </ul>
      </SidebarSection>
    </nav>
  );
}

function rowClass(active: boolean): string {
  return `w-full text-left px-3 py-1.5 truncate border-l-2 ${
    active
      ? "bg-[color:var(--surface-selected)] text-[color:var(--text-brand)] font-medium border-[color:var(--green-500)]"
      : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
  }`;
}

// A4.1 — one scenario row, with two mutually-exclusive states beyond the
// plain "select" row: renaming (inline input), confirming delete.
// `committedRef` guards against a rename firing twice (once from the Enter
// keydown, once from the input's blur as it unmounts) — both events can
// land in the same synchronous stack, before React's state update for
// `editing=null` has taken effect.
function ScenarioRow({
  scenario,
  isActive,
  onSelect,
  onRename,
  onClone,
  onDelete,
  onInteractionStateChange,
  cancelConfirmSignal,
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
  /** SBR-6 — bumped by the parent when the pointer leaves the collapsed
   *  Scenarios flyout. Clears a started-then-abandoned delete confirm, which
   *  has no self-release of its own (a rename's blur is its own release). */
  cancelConfirmSignal?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [editingValue, setEditingValue] = useState(scenario.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const committedRef = useRef(false);

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

  // Deliberately keyed on the signal alone: this must fire when the parent
  // bumps it, not when confirmingDelete changes.
  useEffect(() => {
    if (cancelConfirmSignal === undefined) return;
    setConfirmingDelete(false);
  }, [cancelConfirmSignal]);

  function startRename() {
    committedRef.current = false;
    setEditingValue(scenario.name);
    setEditing(true);
  }

  function commitRename() {
    if (committedRef.current) return;
    committedRef.current = true;
    setEditing(false);
    const trimmed = editingValue.trim();
    if (trimmed) onRename(trimmed);
  }

  function cancelRename() {
    committedRef.current = true;
    setEditing(false);
  }

  if (confirmingDelete) {
    return (
      <li>
        <div className="flex items-center gap-1 px-3 py-1.5 bg-red-50" data-testid={`sidebar-scenario-confirm-delete-${scenario.id}`}>
          <span className="text-xs text-red-700 flex-1 truncate">Delete &quot;{scenario.name}&quot;?</span>
          <button
            type="button"
            data-testid={`button-confirm-delete-${scenario.id}`}
            onClick={() => { onDelete(); setConfirmingDelete(false); }}
            className="text-xs font-semibold text-red-700 hover:text-red-900 flex-shrink-0"
          >
            Delete
          </button>
          <button
            type="button"
            data-testid={`button-cancel-delete-${scenario.id}`}
            onClick={() => setConfirmingDelete(false)}
            className="text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  if (editing) {
    return (
      <li>
        <div className="px-3 py-1">
          <input
            data-testid={`input-rename-scenario-${scenario.id}`}
            aria-label={`Rename ${scenario.name}`}
            className="w-full text-sm border rounded px-1.5 py-0.5 bg-background text-foreground"
            value={editingValue}
            onChange={e => setEditingValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") cancelRename();
            }}
            onBlur={commitRename}
            autoFocus
          />
        </div>
      </li>
    );
  }

  return (
    <li>
      <div className="group flex items-center">
        <button
          type="button"
          data-testid={`sidebar-scenario-${scenario.id}`}
          aria-current={isActive}
          onClick={onSelect}
          className={`${rowClass(isActive)} flex-1 min-w-0`}
        >
          {scenario.name}
        </button>
        <div className="flex items-center gap-0.5 pr-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            data-testid={`button-rename-scenario-${scenario.id}`}
            aria-label={`Rename ${scenario.name}`}
            title="Rename"
            onClick={startRename}
            className="text-muted-foreground hover:text-foreground p-0.5"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            type="button"
            data-testid={`button-clone-scenario-${scenario.id}`}
            aria-label={`Clone ${scenario.name}`}
            title="Clone"
            onClick={onClone}
            className="text-muted-foreground hover:text-foreground p-0.5"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            type="button"
            data-testid={`button-delete-scenario-${scenario.id}`}
            aria-label={`Delete ${scenario.name}`}
            title="Delete"
            onClick={() => setConfirmingDelete(true)}
            className="text-muted-foreground hover:text-destructive p-0.5"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </li>
  );
}

function SidebarSection({
  title,
  testid,
  action,
  collapsed = false,
  className,
  onMouseLeave,
  children,
}: {
  title: string;
  testid: string;
  action?: ReactNode;
  /** Collapsed hides the title text but KEEPS the wrapper + its testid. */
  collapsed?: boolean;
  className?: string;
  onMouseLeave?: () => void;
  children: ReactNode;
}) {
  return (
    <div data-testid={testid} className={`border-b py-1.5 ${className ?? ""}`} onMouseLeave={onMouseLeave}>
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
