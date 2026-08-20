import type { ReactNode } from "react";
import { Plus } from "lucide-react";

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
  /** Outputs entries are greyed out/disabled until this is true (A0.1 brief: "until a solved run exists for the active scenario"). */
  hasSolvedRun: boolean;
  /** Currently-open/active tab's entity id, for highlighting. */
  activeEntityId?: string | null;
  onOpenInput: (entry: SidebarEntry) => void;
  onOpenOutput: (entry: SidebarEntry) => void;
}

// A0.1 — left sidebar shell: Scenarios (+ create), Inputs, Outputs
// (greyed pre-solve). Scenario CRUD beyond "select"/"create" (rename,
// clone, delete, reset-to-baseline) is A4.1 — this task only needs the
// list + the "+" affordance to exist and be wired to a callback.
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
            <li key={s.id}>
              <button
                type="button"
                data-testid={`sidebar-scenario-${s.id}`}
                aria-current={s.id === activeScenarioId}
                onClick={() => onSelectScenario(s.id)}
                className={rowClass(s.id === activeScenarioId)}
              >
                {s.name}
              </button>
            </li>
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
