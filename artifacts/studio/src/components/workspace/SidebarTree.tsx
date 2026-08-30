import { useRef, useState, type ReactNode } from "react";
import { Plus, Pencil, Copy, Trash2 } from "lucide-react";

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

// A0.1 — left sidebar shell: Scenarios (+ create), Inputs, Outputs
// (greyed pre-solve). A4.1 adds real per-row scenario operations (rename,
// clone, delete) — see ScenarioRow below.
export function SidebarTree({
  scenarios,
  activeScenarioId,
  onSelectScenario,
  onCreateScenario,
  inputs,
  outputs,
  hasSolvedRun,
  activeEntityId = null,
  onOpenInput,
  onOpenOutput,
  onRenameScenario,
  onCloneScenario,
  onDeleteScenario,
}: SidebarTreeProps) {
  return (
    <nav className="w-56 border-r flex flex-col overflow-y-auto flex-shrink-0 text-sm bg-background" data-testid="sidebar-tree">
      <SidebarSection
        title="Scenarios"
        testid="sidebar-section-scenarios"
        action={
          <button
            type="button"
            data-testid="button-create-scenario"
            aria-label="Create new scenario"
            onClick={onCreateScenario}
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        }
      >
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
      </SidebarSection>

      <SidebarSection title="Inputs" testid="sidebar-section-inputs">
        <ul>
          {inputs.map(entry => (
            <li key={entry.id}>
              <button
                type="button"
                data-testid={`sidebar-input-${entry.id}`}
                aria-current={entry.id === activeEntityId}
                onClick={() => onOpenInput(entry)}
                className={rowClass(entry.id === activeEntityId)}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </SidebarSection>

      <SidebarSection title="Outputs" testid="sidebar-section-outputs">
        <ul>
          {outputs.map(entry => (
            <li key={entry.id}>
              <button
                type="button"
                data-testid={`sidebar-output-${entry.id}`}
                disabled={!hasSolvedRun}
                aria-disabled={!hasSolvedRun}
                aria-current={entry.id === activeEntityId}
                onClick={() => onOpenOutput(entry)}
                className={
                  !hasSolvedRun
                    ? "w-full text-left px-3 py-1.5 truncate text-muted-foreground/40 cursor-not-allowed"
                    : rowClass(entry.id === activeEntityId)
                }
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </SidebarSection>
    </nav>
  );
}

function rowClass(active: boolean): string {
  return `w-full text-left px-3 py-1.5 truncate ${
    active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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
}: {
  scenario: SidebarScenarioItem;
  isActive: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onClone: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editingValue, setEditingValue] = useState(scenario.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const committedRef = useRef(false);

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
  children,
}: {
  title: string;
  testid: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-testid={testid} className="border-b py-1.5">
      <div className="flex items-center justify-between px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}
