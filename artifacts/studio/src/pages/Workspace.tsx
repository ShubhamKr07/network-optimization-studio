import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useSearch, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListScenarios,
  useGetScenario,
  useGetDataset,
  useUpdateScenario,
  getGetScenarioQueryKey,
  getListScenariosQueryKey,
  type GetDatasetModelId,
} from "@workspace/api-client-react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTree, type SidebarEntry } from "@/components/workspace/SidebarTree";
import { TabBar } from "@/components/workspace/TabBar";
import { WarehousesTab } from "@/components/workspace/tabs/WarehousesTab";
import { CustomersTab } from "@/components/workspace/tabs/CustomersTab";
import type { WarehouseOverride } from "@/components/tables/WarehouseTable";
import type { CustomerOverride } from "@/components/tables/CustomerTable";
import {
  workspaceTabsReducer,
  workspaceTabId,
  initialWorkspaceTabState,
  type WorkspaceTab,
} from "@/lib/workspaceTabs";
import type { StudioModelType } from "@/lib/chapters";

function warehouseOverridesFromInputs(inputs: Record<string, unknown> | null): WarehouseOverride[] {
  const raw = inputs?.warehouseOverrides;
  return Array.isArray(raw) ? (raw as WarehouseOverride[]) : [];
}

function customerOverridesFromInputs(inputs: Record<string, unknown> | null): CustomerOverride[] {
  const raw = inputs?.customerOverrides;
  return Array.isArray(raw) ? (raw as CustomerOverride[]) : [];
}

function capacityModeFromInputs(inputs: Record<string, unknown> | null): "none" | "uniform" | "per_wh" {
  const raw = inputs?.capacityMode;
  return raw === "uniform" || raw === "per_wh" ? raw : "none";
}

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
  const queryClient = useQueryClient();
  const scenarioIdStr = new URLSearchParams(search).get("scenario");
  const scenarioIdFromUrl = scenarioIdStr ? parseInt(scenarioIdStr, 10) : undefined;

  const { data: scenarios } = useListScenarios({ modelId });
  const { data: scenarioFromApi } = useGetScenario(scenarioIdFromUrl!, {
    query: { enabled: !!scenarioIdFromUrl, queryKey: getGetScenarioQueryKey(scenarioIdFromUrl!) },
  });
  // The generated hook's `modelId` param is narrower than StudioModelType
  // (it has no "p-median-brazil" value — Brazil has no dataset endpoint
  // entry). Cast to the hook's own real param type rather than a single
  // hand-picked literal, so this stays correct if/when a future model flip
  // (A5.1-A5.3) passes a different modelId through.
  const { data: dataset } = useGetDataset({ modelId: modelId as GetDatasetModelId | undefined });
  const updateScenario = useUpdateScenario();

  const currentScenario = scenarioFromApi ?? scenarios?.find(s => s.id === scenarioIdFromUrl) ?? scenarios?.[0];
  const hasSolvedRun = currentScenario?.result != null;

  // A1.1 — local draft of the active scenario's `inputs` blob, decoupled
  // from the persisted row so an in-progress edit (e.g. a warehouse status
  // click) isn't visually reverted by a background refetch mid-edit — same
  // rationale as Studio.tsx's localConfig/savedConfig split
  // (configFromScenario/buildInputsForSave), scoped here to the raw inputs
  // object directly since PATCH replaces the whole `inputs` blob and A1.2's
  // Optimization Parameters tab (not yet built) owns the rest of its fields.
  //
  // Save is explicit (Studio.tsx's manual Save-button pattern), not
  // debounced/auto-saved: an earlier version of this file auto-saved on a
  // 600ms debounce, which review flagged as a real data-loss bug — a
  // pending edit inside the debounce window was silently dropped if the
  // student switched scenarios or navigated away before it fired. Manual
  // Save (this scenario's inputs blob is only ever written on an explicit
  // click) has no such window: nothing is ever "pending" without the
  // student knowing. This is now the standing pattern for every future
  // Workspace input tab (A1.2, B5.1, ...), not just this one.
  const [localInputs, setLocalInputs] = useState<Record<string, unknown> | null>(null);
  const savedInputsRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (currentScenario) {
      setLocalInputs(currentScenario.inputs);
      savedInputsRef.current = currentScenario.inputs;
    }
  }, [currentScenario?.id]);

  const isDirty =
    localInputs != null &&
    savedInputsRef.current != null &&
    JSON.stringify(localInputs) !== JSON.stringify(savedInputsRef.current);

  function updateInputsField(key: string, value: unknown) {
    setLocalInputs(prev => (prev ? { ...prev, [key]: value } : prev));
  }

  function handleSaveInputs() {
    if (!currentScenario || !localInputs || !isDirty) return;
    const scenarioId = currentScenario.id;
    const inputs = localInputs;
    updateScenario.mutate(
      { scenarioId, data: { inputs } },
      {
        onSuccess: () => {
          savedInputsRef.current = inputs;
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetScenarioQueryKey(scenarioId) });
        },
      },
    );
  }

  const [tabState, dispatch] = useReducer(workspaceTabsReducer, initialWorkspaceTabState);
  const activeTab = useMemo(
    () => tabState.tabs.find(t => t.id === tabState.activeTabId) ?? null,
    [tabState.tabs, tabState.activeTabId],
  );

  // A1.1 — the Save toolbar (below) shows for any input tab that's actually
  // wired to `localInputs` today. A1.2/B5.1 add their own entities to this
  // set as each one is wired up; every other entry stays an inert
  // placeholder with nothing to save yet.
  const isEditableInputTab =
    activeTab?.kind === "input" && (activeTab.entity === "warehouses" || activeTab.entity === "customers");

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

  function renderTabContent(): ReactNode {
    if (!activeTab) return null;

    if (activeTab.kind === "input" && activeTab.entity === "warehouses") {
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <WarehousesTab
          warehouses={dataset.warehouses}
          overrides={warehouseOverridesFromInputs(localInputs)}
          capacityMode={capacityModeFromInputs(localInputs)}
          onChange={next => updateInputsField("warehouseOverrides", next)}
        />
      );
    }

    if (activeTab.kind === "input" && activeTab.entity === "customers") {
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <CustomersTab
          customers={dataset.customers}
          overrides={customerOverridesFromInputs(localInputs)}
          onChange={next => updateInputsField("customerOverrides", next)}
        />
      );
    }

    // Every other entry (Demand, Distances, Optimization Parameters, every
    // Output) is a later task (A1.2-A3.1) — unchanged placeholder.
    return (
      <span className="text-muted-foreground" data-testid="tab-content-placeholder">
        {activeTab.label} — content wired in a later task (A1.2-A3.1).
      </span>
    );
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
          {isEditableInputTab && (
            // A1.1 (fix) — explicit Save, replacing the earlier debounced
            // auto-save. Mirrors Studio.tsx's toolbar Save button
            // (isDirty-gated, useUpdateScenario on click) rather than
            // writing on every edit.
            <div className="flex items-center justify-end gap-2 px-4 py-2 border-b flex-shrink-0 bg-muted/10">
              {isDirty && (
                <span className="text-xs text-muted-foreground" data-testid="text-unsaved-changes">
                  Unsaved changes
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveInputs}
                disabled={!isDirty || updateScenario.isPending}
                data-testid="button-save"
                className={isDirty ? "border-primary text-primary hover:bg-primary/10" : ""}
              >
                <Save className="w-3.5 h-3.5 mr-1" />
                {updateScenario.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="flex-1 min-w-0 overflow-y-auto p-4 text-sm" data-testid="tab-content-region">
              {activeTab ? renderTabContent() : <span className="text-muted-foreground">Pick an item from the sidebar to open it as a tab.</span>}
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
