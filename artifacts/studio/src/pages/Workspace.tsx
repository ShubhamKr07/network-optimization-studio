import { useMemo, useReducer } from "react";
import { useSearch, useLocation } from "wouter";
import { useListScenarios, useGetScenario, getGetScenarioQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { SidebarTree, type SidebarEntry } from "@/components/workspace/SidebarTree";
import { TabBar } from "@/components/workspace/TabBar";
import {
  workspaceTabsReducer,
  workspaceTabId,
  initialWorkspaceTabState,
  type WorkspaceTab,
} from "@/lib/workspaceTabs";
import type { StudioModelType } from "@/lib/chapters";

// A0.1 — pilot Inputs/Outputs entity list, matching the wireframe's example
// set verbatim (SCN Design.pdf, screen 1a·1). Per-model tab config (A5.1-A5.3)
// and real tab content (A1.1-A3.1) both come later — this task only needs
// the sidebar to have something real to list and open.
const INPUT_ENTRIES: SidebarEntry[] = [
  { id: "customers", label: "Customers" },
  { id: "demand", label: "Demand" },
  { id: "warehouses", label: "Warehouses" },
  { id: "distances", label: "Distances" },
  { id: "optimization-parameters", label: "Optimization Parameters" },
];

const OUTPUT_ENTRIES: SidebarEntry[] = [
  { id: "open-warehouses", label: "Open Warehouses" },
  { id: "customer-assignments", label: "Customer Assignments" },
  { id: "flows", label: "Flows" },
  { id: "cost-summary", label: "Cost Summary" },
  { id: "service-stats", label: "Service Stats" },
];

interface WorkspaceProps {
  modelId: StudioModelType;
  /** Passed in by the routing layer (mirrors AppShellProps) rather than fetched here, so this page doesn't duplicate auth-fetching. */
  userEmail: string;
}

export function Workspace({ modelId, userEmail }: WorkspaceProps) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const scenarioIdStr = new URLSearchParams(search).get("scenario");
  const scenarioIdFromUrl = scenarioIdStr ? parseInt(scenarioIdStr, 10) : undefined;

  const { data: scenarios } = useListScenarios({ modelId });
  const { data: scenarioFromApi } = useGetScenario(scenarioIdFromUrl!, {
    query: { enabled: !!scenarioIdFromUrl, queryKey: getGetScenarioQueryKey(scenarioIdFromUrl!) },
  });

  const currentScenario = scenarioFromApi ?? scenarios?.find(s => s.id === scenarioIdFromUrl) ?? scenarios?.[0];
  const hasSolvedRun = currentScenario?.result != null;

  const [tabState, dispatch] = useReducer(workspaceTabsReducer, initialWorkspaceTabState);
  const activeTab = useMemo(
    () => tabState.tabs.find(t => t.id === tabState.activeTabId) ?? null,
    [tabState.tabs, tabState.activeTabId],
  );

  function openTab(kind: WorkspaceTab["kind"], entry: SidebarEntry) {
    dispatch({ type: "open", tab: { id: workspaceTabId(kind, entry.id), kind, entity: entry.id, label: entry.label } });
  }

  function handleSelectScenario(id: number) {
    navigate(`?scenario=${id}`);
  }

  function handleCreateScenario() {
    // TODO(A4.1): real scenario creation (name prompt + per-model default
    // inputs via useCreateScenario). Out of scope for A0.1's shell — this
    // task only needs the "+" affordance to exist and be wired to a
    // callback, per the brief.
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" data-testid="workspace-page">
      <header className="h-14 border-b flex items-center px-4 gap-4 flex-shrink-0 bg-background">
        <span className="font-semibold text-sm" data-testid="text-app-name">
          Network Optimization Studio
        </span>
        <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
          <span className="flex-shrink-0">Scenario:</span>
          <select
            aria-label="Scenario"
            data-testid="select-scenario-context"
            className="bg-transparent border rounded px-1.5 py-0.5 text-foreground text-sm max-w-[220px] truncate"
            value={currentScenario?.id ?? ""}
            onChange={e => handleSelectScenario(parseInt(e.target.value, 10))}
            disabled={!scenarios?.length}
          >
            {!scenarios?.length && <option value="">No scenarios yet</option>}
            {scenarios?.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1" />
        <div className="flex flex-col items-end gap-1">
          <span className="text-sm text-muted-foreground" data-testid="text-user-email">
            {userEmail}
          </span>
          <Button size="sm" disabled={!currentScenario} data-testid="button-run-optimizer">
            Run Optimizer
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <SidebarTree
          scenarios={(scenarios ?? []).map(s => ({ id: s.id, name: s.name }))}
          activeScenarioId={currentScenario?.id ?? null}
          onSelectScenario={handleSelectScenario}
          onCreateScenario={handleCreateScenario}
          inputs={INPUT_ENTRIES}
          outputs={OUTPUT_ENTRIES}
          hasSolvedRun={hasSolvedRun}
          activeEntityId={activeTab?.entity ?? null}
          onOpenInput={entry => openTab("input", entry)}
          onOpenOutput={entry => openTab("output", entry)}
        />

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <TabBar
            tabs={tabState.tabs}
            activeTabId={tabState.activeTabId}
            onActivate={id => dispatch({ type: "activate", id })}
            onClose={id => dispatch({ type: "close", id })}
          />
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="flex-1 min-w-0 overflow-y-auto p-4 text-sm text-muted-foreground" data-testid="tab-content-region">
              {activeTab ? (
                <span data-testid="tab-content-placeholder">
                  {activeTab.label} — content wired in a later task (A1.1-A3.1).
                </span>
              ) : (
                <span>Pick an item from the sidebar to open it as a tab.</span>
              )}
            </div>
            <div
              className="w-[420px] flex-shrink-0 border-l flex items-center justify-center text-xs text-muted-foreground bg-muted/20"
              data-testid="map-placeholder"
            >
              Map — wired in A3.1
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
