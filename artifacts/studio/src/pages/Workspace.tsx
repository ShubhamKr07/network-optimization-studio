import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useSearch, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListScenarios,
  useGetScenario,
  useGetDataset,
  useUpdateScenario,
  useSolveScenario,
  useCreateScenario,
  useCloneScenario,
  useDeleteScenario,
  useResetScenarioToBaseline,
  useGetSolveJob,
  useListModels,
  useLogoutUser,
  usePrecheckScenario,
  getGetScenarioQueryKey,
  getListScenariosQueryKey,
  getGetSolveJobQueryKey,
  getGetCurrentAuthUserQueryKey,
  getGetDatasetQueryKey,
  getPrecheckScenarioQueryKey,
  type GetDatasetModelId,
  type Scenario,
  type SolveResult,
} from "@workspace/api-client-react";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SidebarTree, type SidebarEntry } from "@/components/workspace/SidebarTree";
import { TabBar } from "@/components/workspace/TabBar";
import { SolveDialog, type SolveDialogPhase } from "@/components/workspace/SolveDialog";
import { WarehousesTab, type AddedWarehouse } from "@/components/workspace/tabs/WarehousesTab";
import { CustomersTab, type AddedCustomer } from "@/components/workspace/tabs/CustomersTab";
import { MinesTab, type AddedMine } from "@/components/workspace/tabs/MinesTab";
import { StationsTab, type AddedStation } from "@/components/workspace/tabs/StationsTab";
import { OptimizationParametersTab } from "@/components/workspace/tabs/OptimizationParametersTab";
import { DistancesTab } from "@/components/workspace/tabs/DistancesTab";
import { LaneCostsTab } from "@/components/workspace/tabs/LaneCostsTab";
import { LegDistancesTab } from "@/components/workspace/tabs/LegDistancesTab";
import { OutputMapTab } from "@/components/workspace/tabs/OutputMapTab";
import { AssignmentsTab } from "@/components/workspace/tabs/AssignmentsTab";
import { OpenWarehousesTab } from "@/components/workspace/tabs/OpenWarehousesTab";
import { CostSummaryTab } from "@/components/workspace/tabs/CostSummaryTab";
import { ServiceStatsTab } from "@/components/workspace/tabs/ServiceStatsTab";
import { ReportsTab } from "@/components/workspace/tabs/ReportsTab";
import { StaleOutputBanner } from "@/components/workspace/StaleOutputBanner";
import { pickBaseline } from "@/lib/pickBaseline";
import type { WarehouseOverride } from "@/components/tables/WarehouseTable";
import type { CustomerOverride } from "@/components/tables/CustomerTable";
import type { MineOverride } from "@/components/tables/MineTable";
import type { StationOverride } from "@/components/tables/StationTable";
import type { DistanceOverride } from "@/components/workspace/tabs/DistancesTab";
import type { LaneCostOverride } from "@/components/workspace/tabs/LaneCostsTab";
import type { LegDistanceOverride } from "@/components/workspace/tabs/LegDistancesTab";
import {
  workspaceTabsReducer,
  workspaceTabId,
  initialWorkspaceTabState,
  type WorkspaceTab,
} from "@/lib/workspaceTabs";
import type { StudioModelType } from "@/lib/chapters";
import { toast } from "@/hooks/use-toast";

// A5.1-A5.3 — every model's default `inputs` shape for a brand-new scenario,
// copied verbatim from Studio.tsx's handleCreateConfirm switch
// (Studio.tsx:681-690) rather than invented — one branch per model, matching
// that switch's own structure so a future model flip only needs a new case
// here, not a rewrite.
function defaultInputsForModel(modelId: StudioModelType): Record<string, unknown> {
  switch (modelId) {
    case "transport-coal":
      return { distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120, capacityFactor: 1.0, singleSource: false, capacityInactive: false };
    case "p-median-brazil":
      return { p: 7, distanceBands: [500, 1000, 2000, 4000], capacityMode: "uniform", uniformCapacity: 20000000, warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 120, singleSource: true };
    case "two-echelon-gold-au":
      return { bomRatio: 1.1, refineryOverrides: [], customerOverrides: [], distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120 };
    case "p-median-us":
    default:
      return { p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null, warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 120 };
  }
}

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

// A1.2 — `p` is undefined (not 0) for models with no P concept
// (transport-coal, two-echelon-gold-au), so OptimizationParametersTab can
// omit that section entirely rather than showing a misleading "0".
function pFromInputs(inputs: Record<string, unknown> | null): number | undefined {
  const raw = inputs?.p;
  return typeof raw === "number" ? raw : undefined;
}

function gapFromInputs(inputs: Record<string, unknown> | null): number {
  const raw = inputs?.gap;
  return typeof raw === "number" ? raw : 0;
}

function timeLimitSecFromInputs(inputs: Record<string, unknown> | null): number {
  const raw = inputs?.timeLimitSec;
  return typeof raw === "number" ? raw : 120;
}

function distanceBandsFromInputs(inputs: Record<string, unknown> | null): number[] {
  const raw = inputs?.distanceBands;
  return Array.isArray(raw) ? (raw as number[]) : [];
}

// A5.1 — transport-coal's mineCapacities/stationDemands persist as sparse
// dicts (`Record<string, number>`), not arrays with a status field — unlike
// warehouseOverrides/customerOverrides/refineryOverrides. Mirrors Studio.tsx's
// configFromScenario translation (Studio.tsx:127-128) exactly.
function mineOverridesFromInputs(inputs: Record<string, unknown> | null): MineOverride[] {
  const raw = inputs?.mineCapacities as Record<string, number> | undefined;
  return raw ? Object.entries(raw).map(([id, capacity]) => ({ id, capacity })) : [];
}

function stationOverridesFromInputs(inputs: Record<string, unknown> | null): StationOverride[] {
  const raw = inputs?.stationDemands as Record<string, number> | undefined;
  return raw ? Object.entries(raw).map(([id, demand]) => ({ id, demand })) : [];
}

// A5.3 — two-echelon-gold-au's refineryOverrides is array-shaped exactly
// like warehouseOverrides ({id, status}, no capacity field in its schema —
// see solvers/two-echelon-gold-au/manifest.json) — reuse WarehouseOverride's
// reader/shape rather than inventing a parallel type.
function refineryOverridesFromInputs(inputs: Record<string, unknown> | null): WarehouseOverride[] {
  const raw = inputs?.refineryOverrides;
  return Array.isArray(raw) ? (raw as WarehouseOverride[]) : [];
}

// A5.1/A5.3 — model-specific scalar solve parameters, each undefined when
// the active model's inputs shape has no such field (same convention as
// `pFromInputs`).
function capacityFactorFromInputs(inputs: Record<string, unknown> | null): number | undefined {
  const raw = inputs?.capacityFactor;
  return typeof raw === "number" ? raw : undefined;
}

function singleSourceFromInputs(inputs: Record<string, unknown> | null): boolean | undefined {
  const raw = inputs?.singleSource;
  return typeof raw === "boolean" ? raw : undefined;
}

function capacityInactiveFromInputs(inputs: Record<string, unknown> | null): boolean | undefined {
  const raw = inputs?.capacityInactive;
  return typeof raw === "boolean" ? raw : undefined;
}

function bomRatioFromInputs(inputs: Record<string, unknown> | null): number | undefined {
  const raw = inputs?.bomRatio;
  return typeof raw === "number" ? raw : undefined;
}

// B5.1 — Distances tab. `distanceOverrides` (B1.1) has no fixed baseline to
// enumerate (same reasoning B4.3 already applied to the distances export) —
// unlike warehouseOverridesFromInputs/customerOverridesFromInputs, there's no
// merged-with-dataset counterpart, just this array read straight off inputs.
function distanceOverridesFromInputs(inputs: Record<string, unknown> | null): DistanceOverride[] {
  const raw = inputs?.distanceOverrides;
  return Array.isArray(raw) ? (raw as DistanceOverride[]) : [];
}

// B5.1 — cheap client-side existence check for DistancesTab's inline
// reference-integrity warning: base dataset ids plus any scenario-local
// addedWarehouses/addedCustomers (B1.1) the student has already created
// (B5.2 builds the UI for creating them; read here defensively in case any
// already exist, e.g. from an import). The authoritative check stays B2.1's
// server-side precheck, gating the Solve flow — this is a non-blocking
// early warning only.
function knownWarehouseIds(dataset: { warehouses: { id: string }[] } | undefined, inputs: Record<string, unknown> | null): string[] {
  const added = Array.isArray(inputs?.addedWarehouses) ? (inputs!.addedWarehouses as { id: string }[]) : [];
  return [...(dataset?.warehouses ?? []).map(w => w.id), ...added.map(w => w.id)];
}

function knownCustomerIds(dataset: { customers: { id: string }[] } | undefined, inputs: Record<string, unknown> | null): string[] {
  const added = Array.isArray(inputs?.addedCustomers) ? (inputs!.addedCustomers as { id: string }[]) : [];
  return [...(dataset?.customers ?? []).map(c => c.id), ...added.map(c => c.id)];
}

// Task 30 (B6.1 stage 4) — transport-coal analogues of the two helpers
// above, for the new Lane costs tab's client-side existence check.
// `dataset.warehouses`/`dataset.customers` carry transport-coal's mine/
// station rows (GET /dataset's own description — see the Mines/Stations
// render branches below).
function knownMineIds(dataset: { warehouses: { id: string }[] } | undefined, inputs: Record<string, unknown> | null): string[] {
  const added = Array.isArray(inputs?.addedMines) ? (inputs!.addedMines as { id: string }[]) : [];
  return [...(dataset?.warehouses ?? []).map(m => m.id), ...added.map(m => m.id)];
}

function knownStationIds(dataset: { customers: { id: string }[] } | undefined, inputs: Record<string, unknown> | null): string[] {
  const added = Array.isArray(inputs?.addedStations) ? (inputs!.addedStations as { id: string }[]) : [];
  return [...(dataset?.customers ?? []).map(s => s.id), ...added.map(s => s.id)];
}

// B6.2 — two-echelon-gold-au analogues for the new Leg distances tab's
// client-side existence check and leg-type badge. `dataset.warehouses`
// carries BOTH the fixed mine and the refinery candidates (same
// WarehouseCandidate.kind field WarehousesTab's own mine-filter already
// reads) — split by kind rather than reusing knownWarehouseIds/
// knownMineIds, since neither of those existing helpers distinguishes a
// third role the way this model needs. No addedMines concept (the mine is
// fixed) so mine ids are base-dataset-only.
function knownGoldMineIds(dataset: { warehouses: { id: string; kind?: string }[] } | undefined): string[] {
  return (dataset?.warehouses ?? []).filter(w => w.kind === "mine").map(w => w.id);
}

function knownGoldRefineryIds(dataset: { warehouses: { id: string; kind?: string }[] } | undefined, inputs: Record<string, unknown> | null): string[] {
  const added = Array.isArray(inputs?.addedRefineries) ? (inputs!.addedRefineries as { id: string }[]) : [];
  return [...(dataset?.warehouses ?? []).filter(w => w.kind !== "mine").map(w => w.id), ...added.map(r => r.id)];
}

function knownGoldCustomerIds(dataset: { customers: { id: string }[] } | undefined, inputs: Record<string, unknown> | null): string[] {
  const added = Array.isArray(inputs?.addedCustomers) ? (inputs!.addedCustomers as { id: string }[]) : [];
  return [...(dataset?.customers ?? []).map(c => c.id), ...added.map(c => c.id)];
}

// B5.2 — readers for the add/delete grids, same convention as
// warehouseOverridesFromInputs/customerOverridesFromInputs above.
function addedWarehousesFromInputs(inputs: Record<string, unknown> | null): AddedWarehouse[] {
  const raw = inputs?.addedWarehouses;
  return Array.isArray(raw) ? (raw as AddedWarehouse[]) : [];
}

function addedCustomersFromInputs(inputs: Record<string, unknown> | null): AddedCustomer[] {
  const raw = inputs?.addedCustomers;
  return Array.isArray(raw) ? (raw as AddedCustomer[]) : [];
}

// B6.2 — two-echelon-gold-au's addedRefineries reader. Reuses
// WarehousesTab's own AddedWarehouse type (its shape — id/city/state/lat/
// lng/status, optional capacity — matches addedRefinerySchema exactly minus
// the never-set capacity field, see WarehousesTab.tsx's own comment on this
// reuse) rather than inventing a parallel AddedRefinery type.
function addedRefineriesFromInputs(inputs: Record<string, unknown> | null): AddedWarehouse[] {
  const raw = inputs?.addedRefineries;
  return Array.isArray(raw) ? (raw as AddedWarehouse[]) : [];
}

// Task 30 (B6.1 stage 4) — transport-coal analogues.
function addedMinesFromInputs(inputs: Record<string, unknown> | null): AddedMine[] {
  const raw = inputs?.addedMines;
  return Array.isArray(raw) ? (raw as AddedMine[]) : [];
}

function addedStationsFromInputs(inputs: Record<string, unknown> | null): AddedStation[] {
  const raw = inputs?.addedStations;
  return Array.isArray(raw) ? (raw as AddedStation[]) : [];
}

// Task 30 — laneCostOverrides has no fixed baseline to enumerate, same
// reasoning distanceOverridesFromInputs already documents for p-median-us.
function laneCostOverridesFromInputs(inputs: Record<string, unknown> | null): LaneCostOverride[] {
  const raw = inputs?.laneCostOverrides;
  return Array.isArray(raw) ? (raw as LaneCostOverride[]) : [];
}

// A3.1/A5.3 — same derivation Studio.tsx applies at its NetworkMap call site
// (`(localConfig?.warehouseOverrides ?? []).filter(o => o.status !==
// "active").map(...)`), generalized per model: two-echelon-gold-au's forced-
// open/inactive concept lives on `refineryOverrides`, not
// `warehouseOverrides`; transport-coal's mines/stations have no status
// concept at all (mineCapacities/stationDemands are plain value overrides).
// "active" overrides carry no marker-status meaning of their own
// (NetworkMap's getStatus already falls back to "potential" for anything
// absent from this list).
function warehouseStatusesFromInputs(
  inputs: Record<string, unknown> | null,
  modelId: StudioModelType,
): { warehouseId: string; status: "forced_open" | "inactive" }[] {
  if (modelId === "transport-coal") return [];
  const overrides = modelId === "two-echelon-gold-au" ? refineryOverridesFromInputs(inputs) : warehouseOverridesFromInputs(inputs);
  return overrides
    .filter(o => o.status !== "active")
    .map(o => ({ warehouseId: o.id, status: o.status as "forced_open" | "inactive" }));
}

// A5.1-A5.3 — per-model Inputs sidebar entries. p-median-us's original list
// (A0.1, matching the wireframe's example set verbatim, SCN Design.pdf
// screen 1a·1) is now one case among four rather than a single constant.
//
// p-median-brazil keeps "Warehouses"/"Customers" labels for naming parity
// with the pilot, but their tab CONTENT stays a placeholder (see
// renderTabContent below) — confirmed against the real repo state, not
// invented: `GET /dataset` (openapi.yaml's `modelId` enum) genuinely has no
// p-median-brazil entry, and Studio.tsx itself has zero warehouse/customer
// override UI for this model (Studio.tsx:1396's Overrides section is
// `modelId === "p-median-us"` only). Building a real table here would need a
// backend dataset endpoint that doesn't exist — out of this task's scope per
// its own "no lib/db, no api-spec, no api-server/validation changes"
// guarantee. Documented as a deferred follow-up in the task report, not a
// silent gap.
function inputEntriesForModel(modelId: StudioModelType): SidebarEntry[] {
  switch (modelId) {
    case "transport-coal":
      return [
        { id: "mines", label: "Mines" },
        { id: "stations", label: "Stations" },
        { id: "demand", label: "Demand" },
        // Task 30 — was a "distances" placeholder entry (B6.1 stages 1-3
        // shipped the backend; this task builds the tab). Named "Lane
        // costs" (its own entity id, not the shared "distances" one),
        // matching stage 1-3's established vocabulary for this model — see
        // laneCostOverrideSchema's own naming comment.
        { id: "laneCosts", label: "Lane costs" },
        { id: "optimization-parameters", label: "Optimization Parameters" },
      ];
    case "two-echelon-gold-au":
      return [
        { id: "refineries", label: "Refineries" },
        { id: "customers", label: "Customers" },
        { id: "demand", label: "Demand" },
        { id: "distances", label: "Distances" },
        { id: "optimization-parameters", label: "Optimization Parameters" },
      ];
    case "p-median-brazil":
    case "p-median-us":
    default:
      return [
        { id: "customers", label: "Customers" },
        { id: "demand", label: "Demand" },
        { id: "warehouses", label: "Warehouses" },
        { id: "distances", label: "Distances" },
        { id: "optimization-parameters", label: "Optimization Parameters" },
      ];
  }
}

// A3.1 builds this tab's real content (re-homed NetworkMap + layer toggles)
// — A2.1 only needs the sidebar/tab-bar entry to exist so a successful solve
// has something real to open+activate.
const OUTPUT_MAP_ENTRY: SidebarEntry = { id: "output-map", label: "Output Map" };

const OUTPUT_ENTRIES: SidebarEntry[] = [
  OUTPUT_MAP_ENTRY,
  { id: "open-warehouses", label: "Open Warehouses" },
  { id: "customer-assignments", label: "Customer Assignments" },
  { id: "flows", label: "Flows" },
  { id: "cost-summary", label: "Cost Summary" },
  { id: "service-stats", label: "Service Stats" },
];

// Phase C, Task 4 — Reports sidebar section, a single entry for now (C3.1's
// compare fold-in, Task 8, extends this SAME tab's content — not a second
// entry).
const REPORT_ENTRIES: SidebarEntry[] = [{ id: "reports", label: "Reports" }];

interface WorkspaceProps {
  modelId: StudioModelType;
  /** Passed in by the routing layer (mirrors AppShellProps) rather than fetched here, so this page doesn't duplicate auth-fetching. */
  userEmail: string;
}

// Task 6 (C5.1) — mirrors Studio.tsx:48's `ResultHistoryEntry` exactly (same
// shape, module-scope declaration), adapted to Workspace.tsx's own
// `localInputs`-equivalent type (a plain `Record<string, unknown>`, not
// Studio.tsx's `LocalConfig`).
interface ResultHistoryEntry {
  result: SolveResult;
  inputs: Record<string, unknown>;
}

export function Workspace({ modelId, userEmail }: WorkspaceProps) {
  const search = useSearch();
  // A4.1 — `chapterPath` (was discarded) is needed as the "clear the
  // ?scenario= param" navigation target once the last scenario is deleted,
  // mirroring Studio.tsx's `navigate(chapterPath)`.
  const [chapterPath, navigate] = useLocation();
  const queryClient = useQueryClient();
  const scenarioIdStr = new URLSearchParams(search).get("scenario");
  const scenarioIdFromUrl = scenarioIdStr ? parseInt(scenarioIdStr, 10) : undefined;

  // Task 10 — logout. Workspace renders its own self-contained header
  // (deliberately not wrapped in AppShell, to avoid a double-header — see
  // App.tsx's A0.2 comment), so it needs its own logout affordance rather
  // than inheriting AppShell's. Reuses AppShell.tsx's exact pattern verbatim
  // rather than reinventing it: navigating to "/login" immediately after the
  // logout mutation used to race Gate()'s auth-gated render against an async
  // cache invalidate+refetch (same bug class as the Login.tsx/Register.tsx/
  // Gate() race documented in this repo's CLAUDE.md), producing a 404. The
  // fix is writing { user: null } into the auth-user query cache
  // SYNCHRONOUSLY in onSuccess, strictly BEFORE navigate — not relying on
  // invalidateQueries alone before leaving an authed route.
  const logoutUser = useLogoutUser();

  function handleLogout() {
    logoutUser.mutate(undefined, {
      onSuccess: () => {
        queryClient.setQueryData(getGetCurrentAuthUserQueryKey(), { user: null });
        navigate("/login", { replace: true });
      },
    });
  }

  const { data: scenarios } = useListScenarios({ modelId });
  const { data: scenarioFromApi } = useGetScenario(scenarioIdFromUrl!, {
    query: { enabled: !!scenarioIdFromUrl, queryKey: getGetScenarioQueryKey(scenarioIdFromUrl!) },
  });
  // The generated hook's `modelId` param is narrower than StudioModelType
  // (it has no "p-median-brazil" value — Brazil has no dataset endpoint
  // entry, confirmed against openapi.yaml's `/dataset` `modelId` enum, not
  // just the generated type). Cast to the hook's own real param type for the
  // other three models; disabled entirely for p-median-brazil rather than
  // firing a request the backend will 400 on (see inputEntriesForModel's
  // comment on this same gap).
  const datasetParams = { modelId: modelId as GetDatasetModelId | undefined };
  const { data: dataset } = useGetDataset(datasetParams, {
    query: { enabled: modelId !== "p-median-brazil", queryKey: getGetDatasetQueryKey(datasetParams) },
  });
  const updateScenario = useUpdateScenario();

  // A3.1 — Output Map tab's countryBounds, sourced the same way Studio.tsx
  // sources activeModelManifest (Studio.tsx:225/239) — GET /api/models is
  // independent of GET /dataset with no ordering guarantee, so this can
  // resolve after NetworkMap's first mount; NetworkMap itself already
  // handles that (E5.1's remount-on-resolution fix), nothing extra needed
  // here beyond passing whatever's currently available.
  const { data: models } = useListModels();
  const activeModelManifest = models?.find(m => m.id === modelId);

  const currentScenario = scenarioFromApi ?? scenarios?.find(s => s.id === scenarioIdFromUrl) ?? scenarios?.[0];

  // B5.2 — B2.1's semantic precheck (completeness/id-collision/reference-
  // integrity), fetched whenever a p-median-us scenario is active (auto,
  // not gated to "only while the Warehouses/Customers tab is open" — a
  // single component-level query is simpler than per-tab fetching, and this
  // endpoint is cheap/read-only). Other models trivially get {ok:true,
  // errors:[]} server-side (B2.1's own doc note), so this is a no-op query
  // for them beyond the wasted round trip — narrowed to p-median-us here to
  // skip even that. Refetched after Save/import-apply (see
  // handleSaveInputs/handleImportApplied below) so the chips reflect the
  // scenario's just-persisted state, not a stale pre-save snapshot — this is
  // the "after save" half of the plan's "after save (or on-demand)" choice;
  // there's no separate manual "Check completeness" button (my call — see
  // task-22-report.md).
  // Task 30 (B6.1 stage 4) — transport-coal joins this query: stage 3 built
  // precheckTransportInputs and wired it into this same GET .../precheck
  // endpoint, but nothing fetched it from the frontend until MinesTab/
  // StationsTab's added-row precheck chips (this task) needed it.
  // B6.2 stage 4 — two-echelon-gold-au joins too, same reasoning: stage 3
  // built precheckTwoEchelonInputs, this task's Refineries/Customers
  // added-row precheck chips are the first frontend consumer.
  const { data: precheck } = usePrecheckScenario(currentScenario?.id ?? 0, {
    query: {
      enabled: !!currentScenario?.id && (modelId === "p-median-us" || modelId === "transport-coal" || modelId === "two-echelon-gold-au"),
      queryKey: getPrecheckScenarioQueryKey(currentScenario?.id ?? 0),
    },
  });

  // A3.2 — `result != null` (A0.1's `hasSolvedRun`) is necessary but not
  // sufficient: a scenario can have a non-null `result` and still be
  // `stale` (X1.1's `Scenario.stale` — derived server-side, always false
  // when `result` is null). The correct "outputs are fresh and viewable"
  // condition combines both; this drives BOTH the sidebar's Outputs
  // greying (SidebarTree's `hasSolvedRun` prop) AND, per-tab, whether
  // output-kind tab content renders for real or gets blanked behind
  // StaleOutputBanner (see renderTabContent's output-map branch below).
  const hasFreshSolvedRun = currentScenario?.result != null && !currentScenario?.stale;

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

  // Task 6 (C5.1) — result-history stepper. Session-local, non-persisted
  // history of this scenario's solve results AND the exact inputs that
  // produced each one (mirrors Studio.tsx:48/248/443-473's proven pattern,
  // ported here since Workspace.tsx had none — see the plan's own note that
  // this is real groundwork, not optional polish). This is deliberately a
  // THIRD, separate effect from BOTH the id-keyed localInputs-reset effect
  // immediately above (left untouched — see its own comment) and the
  // jobStatus-effect below (which only triggers the refetch; it has no
  // access to the fresh result itself — POST /solve's response is just
  // {jobId}, and the actual new `result` only becomes visible once
  // useGetScenario's query re-resolves and `currentScenario` gets a NEW
  // object with a new `.result` on a LATER render).
  //
  // Distinguishing "this result is new because the scenario switched"
  // (reseed to exactly one entry) from "this result is new because a solve
  // just completed on the SAME scenario" (append one entry) needs a ref
  // tracking which scenario id the history currently reflects, compared by
  // VALUE (id), not object identity — `currentScenario` itself is
  // recomputed each render from multiple possibly-changing sources
  // (scenarioFromApi ?? scenarios?.find(...) ?? scenarios?.[0]) and can
  // produce a new object reference for the same logical scenario.
  const [resultHistoryState, setResultHistoryState] = useState<{ items: ResultHistoryEntry[]; index: number }>({
    items: [],
    index: -1,
  });
  const historyScenarioIdRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (!currentScenario) return;
    if (historyScenarioIdRef.current !== currentScenario.id) {
      // Scenario switched (including the very first render) — reseed to
      // exactly one entry (the scenario's already-persisted result), or
      // empty if it's unsolved. Mirrors Studio.tsx:443-450's own seeding
      // effect.
      historyScenarioIdRef.current = currentScenario.id;
      if (currentScenario.result) {
        setResultHistoryState({
          items: [{ result: currentScenario.result, inputs: currentScenario.inputs as Record<string, unknown> }],
          index: 0,
        });
      } else {
        setResultHistoryState({ items: [], index: -1 });
      }
      return;
    }
    // Same scenario as last time this effect ran — only append if this is a
    // genuinely NEW, non-null result (not the same one already recorded as
    // the newest entry). Comparing by object reference is sufficient and
    // deliberate: TanStack Query's default structural sharing means an
    // unrelated background refetch that returns byte-identical data keeps
    // the same `.result` reference, so this also naturally guards against
    // double-appending on e.g. a window-refocus refetch, not just literal
    // re-renders.
    const latest = currentScenario.result;
    if (!latest) return;
    setResultHistoryState(prev => {
      const newest = prev.items[prev.items.length - 1];
      if (newest && newest.result === latest) return prev;
      const entry: ResultHistoryEntry = { result: latest, inputs: currentScenario.inputs as Record<string, unknown> };
      return { items: [...prev.items, entry], index: prev.items.length };
    });
  }, [currentScenario?.result, currentScenario?.id]);

  // Stepping through history also restores the exact inputs that produced
  // that result — savedInputsRef is synced too (not just localInputs), so
  // navigating alone is never treated as an unsaved edit (mirrors
  // Studio.tsx's goResultBack/goResultForward, which syncs both localConfig
  // AND savedConfig for the same reason). Side effects happen in the event
  // handler body, not inside the setResultHistoryState updater, which must
  // stay pure.
  function stepResultBack() {
    const nextIndex = Math.max(0, resultHistoryState.index - 1);
    const entry = resultHistoryState.items[nextIndex];
    if (!entry) return;
    setResultHistoryState(prev => ({ ...prev, index: nextIndex }));
    setLocalInputs(entry.inputs);
    savedInputsRef.current = entry.inputs;
  }

  function stepResultForward() {
    const nextIndex = Math.min(resultHistoryState.items.length - 1, resultHistoryState.index + 1);
    const entry = resultHistoryState.items[nextIndex];
    if (!entry) return;
    setResultHistoryState(prev => ({ ...prev, index: nextIndex }));
    setLocalInputs(entry.inputs);
    savedInputsRef.current = entry.inputs;
  }

  const canGoBackResult = resultHistoryState.index > 0;
  const canGoForwardResult = resultHistoryState.index >= 0 && resultHistoryState.index < resultHistoryState.items.length - 1;

  const isDirty =
    localInputs != null &&
    savedInputsRef.current != null &&
    JSON.stringify(localInputs) !== JSON.stringify(savedInputsRef.current);

  function updateInputsField(key: string, value: unknown) {
    setLocalInputs(prev => (prev ? { ...prev, [key]: value } : prev));
  }

  // B5.2/B6.2 — deleting an added warehouse/customer/refinery must ALSO
  // purge any distanceOverrides referencing its id, in the SAME localInputs
  // update (not two separate setLocalInputs calls, which would both read
  // the same stale closure and the second could clobber the first — same
  // hazard Round 3's map-multi-select bulk-action fix already documents
  // elsewhere in this file's history). A deleted id is checked against BOTH
  // fromId and toId even though a real warehouse/refinery id only ever
  // appears as fromId (and a customer id only as toId, and for two-echelon
  // a refinery id can be EITHER side — the toId of a mine leg or the fromId
  // of a customer leg) in a VALID override — defensive/symmetric so one
  // function serves every caller without needing to know which role its id
  // plays. `"addedRefineries"` (B6.2) reuses this SAME function unmodified —
  // two-echelon-gold-au's `distanceOverrides` field shares the exact name
  // and `{fromId, toId, distance}` shape p-median-us's does (a deliberate
  // naming choice made in this task's stage 1, specifically so this
  // function would generalize without a third near-duplicate).
  function deleteAddedEntityAndOverrides(arrayKey: "addedWarehouses" | "addedCustomers" | "addedRefineries", id: string) {
    setLocalInputs(prev => {
      if (!prev) return prev;
      const arr = Array.isArray(prev[arrayKey]) ? (prev[arrayKey] as { id: string }[]) : [];
      const overrides = Array.isArray(prev.distanceOverrides) ? (prev.distanceOverrides as DistanceOverride[]) : [];
      return {
        ...prev,
        [arrayKey]: arr.filter(e => e.id !== id),
        distanceOverrides: overrides.filter(o => o.fromId !== id && o.toId !== id),
      };
    });
  }

  // Task 30 (B6.1 stage 4) — transport-coal analogue of the function above:
  // deleting an added mine/station must ALSO purge any laneCostOverrides
  // referencing its id, in the SAME atomic localInputs update. A separate
  // function (not a generalized `arrayKey`/`overridesKey` parameterization
  // of the one above) — kept as a close, explicit mirror rather than a
  // shared abstraction, matching how this codebase already treats
  // p-median-us and transport-coal's network-edit machinery as parallel but
  // independent (precheckTransportInputs is its own function, not a call
  // into precheckPMedianInputs, for the same reasoning).
  function deleteAddedTransportEntityAndOverrides(arrayKey: "addedMines" | "addedStations", id: string) {
    setLocalInputs(prev => {
      if (!prev) return prev;
      const arr = Array.isArray(prev[arrayKey]) ? (prev[arrayKey] as { id: string }[]) : [];
      const overrides = Array.isArray(prev.laneCostOverrides) ? (prev.laneCostOverrides as LaneCostOverride[]) : [];
      return {
        ...prev,
        [arrayKey]: arr.filter(e => e.id !== id),
        laneCostOverrides: overrides.filter(o => o.fromId !== id && o.toId !== id),
      };
    });
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
          // B5.2 — refetch precheck against the just-saved inputs (see the
          // usePrecheckScenario call site's comment above).
          queryClient.invalidateQueries({ queryKey: getPrecheckScenarioQueryKey(scenarioId) });
        },
      },
    );
  }

  // A1.3 — mirrors Studio.tsx's `handleImportApplied`: an import-apply
  // replaces the scenario's whole `inputs` blob server-side, so the local
  // draft (and its "last saved" snapshot) must be resynced from the
  // response directly, same as a fresh Save success — otherwise the grid
  // would keep showing pre-import data until an unrelated refetch happened
  // to land. Also invalidates both queries Studio.tsx invalidates, so any
  // other consumer (sidebar scenario list, a background refetch) doesn't
  // see stale data either.
  function handleImportApplied(updated: Scenario) {
    setLocalInputs(updated.inputs);
    savedInputsRef.current = updated.inputs;
    queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetScenarioQueryKey(updated.id) });
    // B5.2 — same reasoning as handleSaveInputs's precheck invalidation.
    queryClient.invalidateQueries({ queryKey: getPrecheckScenarioQueryKey(updated.id) });
  }

  const [tabState, dispatch] = useReducer(workspaceTabsReducer, initialWorkspaceTabState);
  const activeTab = useMemo(
    () => tabState.tabs.find(t => t.id === tabState.activeTabId) ?? null,
    [tabState.tabs, tabState.activeTabId],
  );

  // A1.1/A5.1-A5.3 — the Save toolbar (below) shows for any input tab that's
  // actually wired to `localInputs` today. Model-aware, not just entity-aware
  // — p-median-brazil's "warehouses"/"customers" entries share entity ids
  // with p-median-us but stay placeholder content (no dataset endpoint, see
  // inputEntriesForModel's comment), so they must NOT be treated as
  // editable/saveable here even though the entity string matches. Every
  // other entry stays an inert placeholder with nothing to save yet.
  const isEditableInputTab =
    activeTab?.kind === "input" &&
    (activeTab.entity === "optimization-parameters" ||
      (activeTab.entity === "warehouses" && modelId === "p-median-us") ||
      (activeTab.entity === "customers" && (modelId === "p-median-us" || modelId === "two-echelon-gold-au")) ||
      (activeTab.entity === "refineries" && modelId === "two-echelon-gold-au") ||
      (activeTab.entity === "mines" && modelId === "transport-coal") ||
      (activeTab.entity === "stations" && modelId === "transport-coal") ||
      // B5.1/B6.2 — Distances grid. p-median-us renders DistancesTab;
      // two-echelon-gold-au shares the same sidebar entity id ("distances")
      // but renders LegDistancesTab instead (a structurally different
      // three-id-space/two-leg component — see renderTabContent's own
      // branch below) — p-median-brazil's dataset.warehouses/customers
      // still don't exist, so it stays excluded.
      (activeTab.entity === "distances" && (modelId === "p-median-us" || modelId === "two-echelon-gold-au")) ||
      // Task 30 (B6.1 stage 4) — Lane costs grid, transport-coal only.
      (activeTab.entity === "laneCosts" && modelId === "transport-coal"));

  function openTab(kind: WorkspaceTab["kind"], entry: SidebarEntry) {
    dispatch({ type: "open", tab: { id: workspaceTabId(kind, entry.id), kind, entity: entry.id, label: entry.label } });
  }

  function handleSelectScenario(id: number) {
    navigate(`?scenario=${id}`);
  }

  // A4.1 — sidebar scenario operations: create, rename, clone, delete,
  // reset-to-baseline. Create/clone/delete all replicate Studio.tsx's
  // documented cache-write-before-navigate fix (CLAUDE.md, "post-migration
  // bug audit," Task 2 finding): `queryClient.setQueryData` writes the
  // mutation's own response into the scenarios-list cache SYNCHRONOUSLY,
  // strictly BEFORE `navigate(...)`, so the destination renders against
  // fresh data instead of racing `invalidateQueries`' async refetch (which
  // is moved to strictly after navigate, as a non-blocking background
  // refresh). Do not reorder these — see Studio.tsx's handleClone/
  // handleDelete/handleCreateConfirm for the original fix and the bug it
  // replaced.
  const createScenario = useCreateScenario();
  const cloneScenario = useCloneScenario();
  const deleteScenario = useDeleteScenario();
  const resetToBaseline = useResetScenarioToBaseline();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState("");

  function handleCreateScenario() {
    setNewScenarioName(`Scenario ${(scenarios?.length ?? 0) + 1}`);
    setShowCreateDialog(true);
  }

  function handleCreateConfirm() {
    const name = newScenarioName.trim() || `Scenario ${(scenarios?.length ?? 0) + 1}`;
    createScenario.mutate(
      { data: { name, modelId, inputs: defaultInputsForModel(modelId) } },
      {
        onSuccess: created => {
          setShowCreateDialog(false);
          queryClient.setQueryData<Scenario[]>(getListScenariosQueryKey(), prev =>
            prev ? [...prev, created] : [created],
          );
          navigate(`?scenario=${created.id}`);
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
        },
      },
    );
  }

  function handleCloneScenario(id: number) {
    cloneScenario.mutate(
      { scenarioId: id },
      {
        onSuccess: cloned => {
          queryClient.setQueryData<Scenario[]>(getListScenariosQueryKey(), prev =>
            prev ? [...prev, cloned] : [cloned],
          );
          navigate(`?scenario=${cloned.id}`);
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
        },
      },
    );
  }

  function handleDeleteScenario(id: number) {
    deleteScenario.mutate(
      { scenarioId: id },
      {
        onSuccess: () => {
          queryClient.setQueryData<Scenario[]>(getListScenariosQueryKey(), prev =>
            prev ? prev.filter(s => s.id !== id) : prev,
          );
          if (id === currentScenario?.id) {
            const remaining = (scenarios ?? []).filter(s => s.id !== id);
            if (remaining.length > 0) {
              navigate(`?scenario=${remaining[0].id}`);
            } else {
              navigate(chapterPath);
            }
          }
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
        },
      },
    );
  }

  // Rename — resolved design nuance (see task-9-brief.md): SidebarTree lists
  // EVERY scenario, not just the active one, so a sibling row's rename
  // cannot defer to the active scenario's input-editing Save button (that
  // button is scoped to `localInputs`, which has no meaning for a scenario
  // that isn't currently open). Rename fires its own immediate,
  // isolated `{name}`-only PATCH via useUpdateScenario — independent of
  // A1.1/A1.2's manual-Save-toolbar flow, and it deliberately never touches
  // `localInputs`/`savedInputsRef` (even when renaming the ACTIVE scenario)
  // so an in-progress unsaved input edit is never disturbed by a rename.
  function handleRenameScenario(id: number, name: string) {
    updateScenario.mutate(
      { scenarioId: id, data: { name } },
      {
        onSuccess: updated => {
          queryClient.setQueryData<Scenario[]>(getListScenariosQueryKey(), prev =>
            prev ? prev.map(s => (s.id === id ? updated : s)) : prev,
          );
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetScenarioQueryKey(id) });
        },
      },
    );
  }

  // Reset-to-baseline — same D6.1 endpoint Studio.tsx uses, now reachable
  // per-row (any scenario, not just the active one) since SidebarTree lists
  // all of them. Only resync `localInputs`/`savedInputsRef` when the RESET
  // scenario is the currently ACTIVE one — resetting a sibling must not
  // clobber an in-progress unsaved edit on the scenario actually open in the
  // tabs (handleImportApplied's unconditional resync is correct for it, but
  // would be wrong reused verbatim here for an arbitrary sidebar row).
  function handleResetScenario(id: number) {
    resetToBaseline.mutate(
      { scenarioId: id },
      {
        onSuccess: updated => {
          if (id === currentScenario?.id) {
            setLocalInputs(updated.inputs);
            savedInputsRef.current = updated.inputs;
          }
          queryClient.setQueryData<Scenario[]>(getListScenariosQueryKey(), prev =>
            prev ? prev.map(s => (s.id === id ? updated : s)) : prev,
          );
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetScenarioQueryKey(id) });
        },
      },
    );
  }

  // A2.1 — Run Optimizer / Solve dialog. Solve is async (G3.1): POST /solve
  // enqueues a job and returns {jobId} immediately; useGetSolveJob below
  // polls it until it leaves queued/running — same mechanics as
  // Studio.tsx's handleSolve/pollingJobId, replicated here rather than
  // reinvented.
  const solveScenario = useSolveScenario();
  const [solveDialogOpen, setSolveDialogOpen] = useState(false);
  const [solvePhase, setSolvePhase] = useState<SolveDialogPhase>("idle");
  const [solveError, setSolveError] = useState<string | null>(null);
  const [pollingJobId, setPollingJobId] = useState<number | null>(null);

  function openSolveDialog() {
    setSolveError(null);
    setSolvePhase("idle");
    setSolveDialogOpen(true);
  }

  // CRITICAL — save-before-solve (CLAUDE.md's documented Round-2 bug):
  // POST /scenarios/:id/solve carries no body — it solves whatever is
  // ALREADY PERSISTED on the scenario row ("DB row is the source of truth").
  // Studio.tsx's handleSolve used to fire directly against that stale saved
  // value, silently discarding any dirty (unsaved) localConfig edit — e.g.
  // dragging a slider in this dialog or the Optimization Parameters tab,
  // then clicking Solve, solved the OLD value with zero indication anything
  // was wrong. Fix (now the standing pattern): if localInputs is dirty, save
  // it first and wait for that save to succeed, THEN enqueue the solve.
  // Never let this dialog become a second place where that bug can recur.
  function handleSolve() {
    if (!currentScenario) return;
    setSolveError(null);
    const scenarioId = currentScenario.id;

    const runSolve = () => {
      setSolvePhase("solving");
      solveScenario.mutate(
        { scenarioId },
        {
          onSuccess: job => setPollingJobId(job.jobId),
          onError: err => {
            const message = err instanceof Error ? err.message : "Could not enqueue the solve. Try again.";
            setSolvePhase("failed");
            setSolveError(message);
            toast({
              title: "Solve failed to start",
              description: message,
              variant: "destructive",
            });
          },
        },
      );
    };

    if (isDirty && localInputs) {
      setSolvePhase("saving");
      const inputs = localInputs;
      updateScenario.mutate(
        { scenarioId, data: { inputs } },
        {
          onSuccess: () => {
            savedInputsRef.current = inputs;
            queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetScenarioQueryKey(scenarioId) });
            runSolve();
          },
          // A save failing (e.g. a rejected input) used to fail completely
          // silently in Studio.tsx before that was fixed — Solve just quietly
          // did nothing. Surface it the same way here.
          onError: err => {
            const message = err instanceof Error ? err.message : "The scenario was not solved — fix the invalid input and try again.";
            setSolvePhase("failed");
            setSolveError(message);
            toast({
              title: "Couldn't save your changes",
              description: message,
              variant: "destructive",
            });
          },
        },
      );
    } else {
      runSolve();
    }
  }

  const { data: jobStatus } = useGetSolveJob(currentScenario?.id!, pollingJobId!, {
    query: {
      enabled: !!currentScenario && !!pollingJobId,
      queryKey: getGetSolveJobQueryKey(currentScenario?.id!, pollingJobId!),
      refetchInterval: query => {
        const status = query.state.data?.status;
        return status === "queued" || status === "running" ? 800 : false;
      },
    },
  });

  useEffect(() => {
    if (!jobStatus || !currentScenario) return;
    if (jobStatus.status === "succeeded") {
      setSolvePhase("idle");
      setPollingJobId(null);
      setSolveDialogOpen(false);
      openTab("output", OUTPUT_MAP_ENTRY);
      queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetScenarioQueryKey(currentScenario.id) });
    } else if (jobStatus.status === "failed") {
      const message = jobStatus.error ?? "The solver did not complete. Try again.";
      setSolvePhase("failed");
      setSolveError(message);
      setPollingJobId(null);
      toast({
        title: "Solve failed",
        description: message,
        variant: "destructive",
      });
    }
  }, [jobStatus, currentScenario?.id, queryClient]);

  // Task 7 (C5.1) — "Save as scenario" from a history entry (DD-7). Creates a
  // NEW scenario from the CURRENTLY-VIEWED history entry's inputs (not
  // necessarily the scenario's latest saved inputs — the whole point of the
  // stepper is to let a student land on an earlier entry first), then
  // triggers a solve on it. Reuses the exact same createScenario/
  // solveScenario mutation hooks and cache-write-before-navigate pattern as
  // handleCreateConfirm/handleSolve above — no new API surface, no
  // mutateAsync (this codebase's established style is .mutate + onSuccess/
  // onError callbacks, see handleCreateConfirm and handleSolve's runSolve).
  // A freshly-created scenario's inputs are exactly the entry's inputs, so
  // it's never dirty — safe to call solveScenario directly without
  // handleSolve's save-before-solve branch.
  function handleSaveAsScenario() {
    const entry = resultHistoryState.items[resultHistoryState.index];
    if (!entry) return;
    const name = `${currentScenario?.name ?? "Scenario"} (saved run)`;
    createScenario.mutate(
      { data: { name, modelId, inputs: entry.inputs } },
      {
        onSuccess: created => {
          queryClient.setQueryData<Scenario[]>(getListScenariosQueryKey(), prev =>
            prev ? [...prev, created] : [created],
          );
          navigate(`?scenario=${created.id}`);
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
          solveScenario.mutate(
            { scenarioId: created.id },
            {
              onSuccess: job => setPollingJobId(job.jobId),
              onError: err => {
                const message = err instanceof Error ? err.message : "Could not enqueue the solve. Try again.";
                toast({
                  title: "Solve failed to start",
                  description: message,
                  variant: "destructive",
                });
              },
            },
          );
        },
      },
    );
  }

  function renderTabContent(): ReactNode {
    if (!activeTab) return null;

    // A5.1 — p-median-us's real Warehouses tab. two-echelon-gold-au's
    // Refineries tab reuses the SAME component below (entity="refineries")
    // rather than forking one — see WarehousesTab's own comment on why.
    // p-median-brazil shares this entity id but stays a placeholder (falls
    // through to the generic placeholder at the bottom — no dataset endpoint
    // exists for it, see inputEntriesForModel's comment).
    if (activeTab.kind === "input" && activeTab.entity === "warehouses" && modelId === "p-median-us") {
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <WarehousesTab
          warehouses={dataset.warehouses}
          overrides={warehouseOverridesFromInputs(localInputs)}
          capacityMode={capacityModeFromInputs(localInputs)}
          onChange={next => updateInputsField("warehouseOverrides", next)}
          scenarioId={currentScenario?.id}
          onImportApplied={handleImportApplied}
          addedWarehouses={addedWarehousesFromInputs(localInputs)}
          onAddedWarehousesChange={next => updateInputsField("addedWarehouses", next)}
          onDeleteWarehouse={id => deleteAddedEntityAndOverrides("addedWarehouses", id)}
          precheckErrors={precheck?.errors}
        />
      );
    }

    // A5.3/B6.2 — two-echelon-gold-au's Refineries tab. `dataset.warehouses`
    // carries both the fixed mine and the refinery candidates
    // (WarehouseCandidate.kind) — WarehousesTab already filters out the
    // mine-kind row regardless of entity, so this is a straight reuse.
    // B6.2: addedRefineries/onAddedRefineriesChange/onDeleteRefinery/
    // precheckErrors join the props (WarehousesTab's addedSection is
    // capability-gated on onAddedWarehousesChange being wired, not on
    // `entity` — see that component's own comment), reusing
    // deleteAddedEntityAndOverrides unmodified since twoEchelonInputsSchema's
    // distanceOverrides shares p-median-us's exact field name/shape.
    if (activeTab.kind === "input" && activeTab.entity === "refineries" && modelId === "two-echelon-gold-au") {
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <WarehousesTab
          warehouses={dataset.warehouses}
          overrides={refineryOverridesFromInputs(localInputs)}
          capacityMode="none"
          onChange={next => updateInputsField("refineryOverrides", next)}
          scenarioId={currentScenario?.id}
          onImportApplied={handleImportApplied}
          entity="refineries"
          addedWarehouses={addedRefineriesFromInputs(localInputs)}
          onAddedWarehousesChange={next => updateInputsField("addedRefineries", next)}
          onDeleteWarehouse={id => deleteAddedEntityAndOverrides("addedRefineries", id)}
          precheckErrors={precheck?.errors}
        />
      );
    }

    // A1.1/A5.3 — Customers tab, shared by p-median-us AND
    // two-echelon-gold-au (both use `customerOverrides` and entity
    // "customers" — the backend disambiguates the shared entity name via the
    // scenario's own modelId, not a client-side param). p-median-brazil
    // shares this entity id too but stays a placeholder, same reasoning as
    // Warehouses above.
    if (activeTab.kind === "input" && activeTab.entity === "customers" && (modelId === "p-median-us" || modelId === "two-echelon-gold-au")) {
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <CustomersTab
          customers={dataset.customers}
          overrides={customerOverridesFromInputs(localInputs)}
          onChange={next => updateInputsField("customerOverrides", next)}
          scenarioId={currentScenario?.id}
          onImportApplied={handleImportApplied}
          // B5.2/B6.2 — addedCustomers used to be a p-median-us-only concept
          // (twoEchelonInputsSchema had no such field); B6.2 gave
          // two-echelon-gold-au its own real addedCustomers field with the
          // exact same shape, so it joins this spread too now — both models
          // read/write `addedCustomers` and `distanceOverrides` under their
          // own exact field names, so `addedCustomersFromInputs`/
          // `deleteAddedEntityAndOverrides` need no per-model branching here.
          {...(modelId === "p-median-us" || modelId === "two-echelon-gold-au"
            ? {
                addedCustomers: addedCustomersFromInputs(localInputs),
                onAddedCustomersChange: (next: AddedCustomer[]) => updateInputsField("addedCustomers", next),
                onDeleteCustomer: (id: string) => deleteAddedEntityAndOverrides("addedCustomers", id),
                precheckErrors: precheck?.errors,
              }
            : {})}
        />
      );
    }

    // A5.1 — transport-coal's Mines tab. `dataset.warehouses` carries mine
    // rows for this model (GET /dataset's own description: "transport-coal's
    // mines/stations mapped onto the same [warehouse/customer] shape").
    // Task 30 (B6.1 stage 4) — addedMines/onAddedMinesChange/onDeleteMine/
    // precheckErrors join the props, mirroring WarehousesTab's own added-* wiring.
    if (activeTab.kind === "input" && activeTab.entity === "mines" && modelId === "transport-coal") {
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <MinesTab
          mines={dataset.warehouses}
          overrides={mineOverridesFromInputs(localInputs)}
          onChange={next => updateInputsField("mineCapacities", Object.fromEntries(next.filter(o => o.capacity != null).map(o => [o.id, o.capacity])))}
          scenarioId={currentScenario?.id}
          onImportApplied={handleImportApplied}
          addedMines={addedMinesFromInputs(localInputs)}
          onAddedMinesChange={next => updateInputsField("addedMines", next)}
          onDeleteMine={id => deleteAddedTransportEntityAndOverrides("addedMines", id)}
          precheckErrors={precheck?.errors}
        />
      );
    }

    // A5.1 — transport-coal's Stations tab. `dataset.customers` carries
    // station rows for this model. Task 30 — addedStations/
    // onAddedStationsChange/onDeleteStation/precheckErrors join the props.
    if (activeTab.kind === "input" && activeTab.entity === "stations" && modelId === "transport-coal") {
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <StationsTab
          stations={dataset.customers}
          overrides={stationOverridesFromInputs(localInputs)}
          onChange={next => updateInputsField("stationDemands", Object.fromEntries(next.filter(o => o.demand != null).map(o => [o.id, o.demand])))}
          scenarioId={currentScenario?.id}
          onImportApplied={handleImportApplied}
          addedStations={addedStationsFromInputs(localInputs)}
          onAddedStationsChange={next => updateInputsField("addedStations", next)}
          onDeleteStation={id => deleteAddedTransportEntityAndOverrides("addedStations", id)}
          precheckErrors={precheck?.errors}
        />
      );
    }

    if (activeTab.kind === "input" && activeTab.entity === "optimization-parameters") {
      if (!localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <OptimizationParametersTab
          p={pFromInputs(localInputs)}
          gap={gapFromInputs(localInputs)}
          timeLimitSec={timeLimitSecFromInputs(localInputs)}
          distanceBands={distanceBandsFromInputs(localInputs)}
          capacityFactor={capacityFactorFromInputs(localInputs)}
          singleSource={singleSourceFromInputs(localInputs)}
          capacityInactive={capacityInactiveFromInputs(localInputs)}
          bomRatio={bomRatioFromInputs(localInputs)}
          onChange={(field, value) => updateInputsField(field, value)}
        />
      );
    }

    // B5.1 — Distances grid tab, p-median-us only (same boundary as
    // Warehouses/Customers — see isEditableInputTab's comment). Long-format
    // `{fromId, toId, distance}` rows read straight off
    // localInputs.distanceOverrides (no fixed baseline to enumerate, unlike
    // Warehouses/Customers — B4.3's same reasoning). `savedDistanceOverrides`
    // is read from savedInputsRef.current (not localInputs) purely to drive
    // the changed-row highlight — reading a ref during render is safe here
    // because it's only ever mutated inside handlers that themselves trigger
    // a re-render (handleSaveInputs/handleImportApplied/the scenario-switch
    // effect), so this value is never stale at paint time.
    if (activeTab.kind === "input" && activeTab.entity === "distances" && modelId === "p-median-us") {
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <DistancesTab
          distanceOverrides={distanceOverridesFromInputs(localInputs)}
          savedDistanceOverrides={distanceOverridesFromInputs(savedInputsRef.current)}
          warehouseIds={knownWarehouseIds(dataset, localInputs)}
          customerIds={knownCustomerIds(dataset, localInputs)}
          onChange={next => updateInputsField("distanceOverrides", next)}
          scenarioId={currentScenario?.id}
          onImportApplied={handleImportApplied}
        />
      );
    }

    // B6.2 stage 4 — Leg distances grid tab, two-echelon-gold-au only.
    // Shares the sidebar's "distances" entity id with p-median-us's own
    // Distances tab (inputEntriesForModel already lists it per-model, no
    // change needed there) but renders a DIFFERENT component — this
    // model's `distanceOverrides` spans two structurally different legs
    // (mine->refinery, refinery->customer) sharing one flat array, not one
    // single warehouse/customer role pairing. `distanceOverridesFromInputs`
    // is reused as-is (not a new reader) — twoEchelonInputsSchema's
    // distanceOverrides shares p-median-us's exact field name/shape
    // ({fromId, toId, distance}), a deliberate stage-1 naming choice.
    if (activeTab.kind === "input" && activeTab.entity === "distances" && modelId === "two-echelon-gold-au") {
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <LegDistancesTab
          distanceOverrides={distanceOverridesFromInputs(localInputs)}
          savedDistanceOverrides={distanceOverridesFromInputs(savedInputsRef.current)}
          mineIds={knownGoldMineIds(dataset)}
          refineryIds={knownGoldRefineryIds(dataset, localInputs)}
          customerIds={knownGoldCustomerIds(dataset, localInputs)}
          onChange={next => updateInputsField("distanceOverrides", next)}
          scenarioId={currentScenario?.id}
          onImportApplied={handleImportApplied}
        />
      );
    }

    // Task 30 (B6.1 stage 4) — Lane costs grid tab, transport-coal only —
    // the mine/station analogue of the Distances tab immediately above.
    // `dataset.warehouses`/`dataset.customers` carry transport-coal's mine/
    // station rows (same dataset the Mines/Stations tabs above already use).
    if (activeTab.kind === "input" && activeTab.entity === "laneCosts" && modelId === "transport-coal") {
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <LaneCostsTab
          laneCostOverrides={laneCostOverridesFromInputs(localInputs)}
          savedLaneCostOverrides={laneCostOverridesFromInputs(savedInputsRef.current)}
          mineIds={knownMineIds(dataset, localInputs)}
          stationIds={knownStationIds(dataset, localInputs)}
          onChange={next => updateInputsField("laneCostOverrides", next)}
          scenarioId={currentScenario?.id}
          onImportApplied={handleImportApplied}
        />
      );
    }

    // A3.1 — Output Map tab. `result` is passed only while this tab is
    // actually the active one (mirrors Studio.tsx's `activeTab === "output"
    // ? result : null` guard, Studio.tsx:1544/1554) even though
    // renderTabContent() itself is only invoked for the active tab — belt
    // and suspenders so a stale result can never bleed into an unrelated
    // tab if this component's mounting rules ever change.
    if (activeTab.kind === "output" && activeTab.entity === "output-map") {
      // A3.2 — blank this tab's real content behind the stale banner
      // whenever the scenario's outputs aren't trustworthy (unsolved or
      // stale), even if the tab was already open+active from before the
      // scenario transitioned to stale (e.g. solved once, then an input was
      // edited+saved again without re-solving). Checked before the dataset
      // loading guard so the banner never has to wait on the map's own data.
      if (!hasFreshSolvedRun) {
        return <StaleOutputBanner onRunOptimizer={openSolveDialog} />;
      }
      // A5.2 — p-median-brazil renders BrazilMap, which needs no `dataset`
      // at all (it only reads `result`/`showRoutes` — see BrazilMap.tsx;
      // Studio.tsx's own render branch checks `modelId === "p-median-brazil"`
      // BEFORE ever touching `dataset` for the exact same reason, Studio.tsx:
      // 1542). Every other model genuinely needs the dataset query to
      // resolve first.
      const useBrazilMap = modelId === "p-median-brazil";
      if (!useBrazilMap && !dataset) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <OutputMapTab
          dataset={dataset}
          warehouseStatuses={warehouseStatusesFromInputs(localInputs, modelId)}
          result={activeTab.entity === "output-map" ? (currentScenario?.result ?? null) : null}
          bands={distanceBandsFromInputs(localInputs)}
          countryBounds={activeModelManifest?.countryBounds}
          useBrazilMap={useBrazilMap}
        />
      );
    }

    // Phase C, Task 3 — Open Warehouses/Customer Assignments/Cost Summary/
    // Service Stats output grid tabs. p-median-us only for this pilot (same
    // boundary as Warehouses/Customers/Distances — see this task's own plan
    // doc's Global Constraints); every other model falls through to the
    // generic placeholder below. "Flows" (OUTPUT_ENTRIES' remaining
    // unhandled entry) is genuinely N/A for p-median-us and stays on that
    // same placeholder fallback — not built here, deferred to C6.1.
    if (
      activeTab.kind === "output" &&
      ["open-warehouses", "customer-assignments", "cost-summary", "service-stats"].includes(activeTab.entity)
    ) {
      if (!hasFreshSolvedRun) {
        return <StaleOutputBanner onRunOptimizer={openSolveDialog} />;
      }
      if (modelId !== "p-median-us") {
        return (
          <span className="text-muted-foreground" data-testid="tab-content-placeholder">
            {activeTab.label} — not available for this model yet.
          </span>
        );
      }
      const result = currentScenario?.result ?? null;
      if (activeTab.entity === "open-warehouses") return <OpenWarehousesTab result={result} scenarioId={currentScenario!.id} />;
      if (activeTab.entity === "customer-assignments") return <AssignmentsTab result={result} scenarioId={currentScenario!.id} />;
      if (activeTab.entity === "cost-summary") return <CostSummaryTab result={result} scenarioId={currentScenario!.id} />;
      return <ServiceStatsTab result={result} scenarioId={currentScenario!.id} />;
    }

    // Phase C, Task 4 — Reports tab: baseline (DD-3's pickBaseline) vs.
    // current scenario cost/service/utilization comparison. Not scoped to
    // p-median-us in the placeholder sense the output grids are — ReportsTab
    // itself degrades gracefully (baseline?.result can be null, e.g. an
    // unsolved baseline) — but it still needs a fresh solved CURRENT run,
    // same StaleOutputBanner gate every output-kind tab already uses.
    if (activeTab.kind === "report" && activeTab.entity === "reports") {
      if (!hasFreshSolvedRun) {
        return <StaleOutputBanner onRunOptimizer={openSolveDialog} />;
      }
      const baseline = pickBaseline((scenarios ?? []).filter(s => s.modelId === modelId));
      return (
        <ReportsTab
          baseline={baseline}
          current={currentScenario ?? null}
          bands={distanceBandsFromInputs(localInputs)}
          availableScenarios={(scenarios ?? []).map(s => ({ id: s.id, name: s.name, modelId: s.modelId }))}
          modelId={modelId}
        />
      );
    }

    // A5.2 — p-median-brazil's Warehouses/Customers entries share entity ids
    // with p-median-us for naming parity (inputEntriesForModel's comment)
    // but have no real content: `GET /dataset` genuinely has no
    // p-median-brazil entry (openapi.yaml's modelId enum), and Studio.tsx
    // itself has never had override-editing UI for this model either. A
    // distinct message rather than the generic "later task" copy below,
    // since this isn't simply unbuilt yet — it's blocked on a backend
    // capability this task's scope explicitly excludes adding.
    if (activeTab.kind === "input" && (activeTab.entity === "warehouses" || activeTab.entity === "customers") && modelId === "p-median-brazil") {
      return (
        <span className="text-muted-foreground" data-testid="tab-content-placeholder">
          {activeTab.label} — not available for this model yet (no per-row dataset endpoint exists for p-median-brazil).
        </span>
      );
    }

    // Every other entry (Demand, two-echelon-gold-au/p-median-brazil's
    // Distances — still an open fast-follow — and every remaining Output
    // grid) is a later task (C1.1-C6.1) — unchanged placeholder. Task 30
    // closed transport-coal's own Distances gap (now the Lane costs tab,
    // handled above, not this fallback).
    return (
      <span className="text-muted-foreground" data-testid="tab-content-placeholder">
        {activeTab.label} — content wired in a later task (A1.2-A3.1).
      </span>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" data-testid="workspace-page">
      <header className="h-14 border-b flex items-center px-4 gap-4 flex-shrink-0 bg-background">
        {/* Task 10 — back-to-Landing, matching Studio.tsx's page-back
            convention verbatim (same testid/icon/onClick target) rather than
            inventing new UX: Workspace was the only authed page with no way
            back to "/" other than the browser's own back button. */}
        <button
          onClick={() => navigate("/")}
          data-testid="button-page-back"
          title="Back to models"
          className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
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
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground" data-testid="text-user-email">
              {userEmail}
            </span>
            {/* Task 10 — logout, reusing AppShell.tsx's exact handleLogout
                pattern (see the comment on that function above). */}
            <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="button-logout">
              Log out
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {/* Task 6 (C5.1) — result-history stepper, only shown once there's
                at least one result to step through (Studio.tsx's own gate,
                mirrored here). */}
            {resultHistoryState.items.length > 0 && (
              <div className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  data-testid="button-result-back"
                  disabled={!canGoBackResult}
                  onClick={stepResultBack}
                  title="Previous result"
                  className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  ←
                </button>
                <span className="text-muted-foreground w-10 text-center" data-testid="text-result-history-position">
                  {resultHistoryState.index + 1}/{resultHistoryState.items.length}
                </span>
                <button
                  type="button"
                  data-testid="button-result-forward"
                  disabled={!canGoForwardResult}
                  onClick={stepResultForward}
                  title="Next result"
                  className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                >
                  →
                </button>
                {/* Task 7 (C5.1) — "Save as scenario" from the currently-viewed
                    history entry (DD-7). Same conditional gate as the stepper
                    itself (both need at least one history entry to make sense). */}
                <button
                  type="button"
                  data-testid="button-save-as-scenario"
                  onClick={handleSaveAsScenario}
                  disabled={createScenario.isPending}
                  className="text-xs border rounded px-2 py-1 hover:bg-muted"
                >
                  Save as scenario
                </button>
              </div>
            )}
            <Button
              size="sm"
              disabled={!currentScenario}
              onClick={openSolveDialog}
              data-testid="button-run-optimizer"
            >
              Run Optimizer
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <SidebarTree
          scenarios={(scenarios ?? []).map(s => ({ id: s.id, name: s.name }))}
          activeScenarioId={currentScenario?.id ?? null}
          onSelectScenario={handleSelectScenario}
          onCreateScenario={handleCreateScenario}
          inputs={inputEntriesForModel(modelId)}
          outputs={OUTPUT_ENTRIES}
          reports={REPORT_ENTRIES}
          hasSolvedRun={hasFreshSolvedRun}
          activeEntityId={activeTab?.entity ?? null}
          onOpenInput={entry => openTab("input", entry)}
          onOpenOutput={entry => openTab("output", entry)}
          onOpenReport={entry => openTab("report", entry)}
          onRenameScenario={handleRenameScenario}
          onCloneScenario={handleCloneScenario}
          onDeleteScenario={handleDeleteScenario}
          onResetScenario={handleResetScenario}
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
          </div>
        </div>
      </div>

      <SolveDialog
        open={solveDialogOpen}
        onOpenChange={setSolveDialogOpen}
        p={pFromInputs(localInputs)}
        gap={gapFromInputs(localInputs)}
        timeLimitSec={timeLimitSecFromInputs(localInputs)}
        onChange={(field, value) => updateInputsField(field, value)}
        phase={solvePhase}
        errorMessage={solveError}
        onSolve={handleSolve}
      />

      {/* A4.1 — create-scenario dialog, triggered by SidebarTree's "+".
          Workspace.tsx has a single unconditional return (no early-return
          branches like Studio.tsx's empty-scenarios states), so — unlike
          Studio.tsx's documented Dialog-in-an-unreachable-branch bug
          (CLAUDE.md's gotchas) — there's only one place this needs to be
          rendered, and it's always reachable. */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New scenario</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Scenario name</Label>
              <Input
                value={newScenarioName}
                onChange={e => setNewScenarioName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleCreateConfirm();
                }}
                placeholder="e.g. 5 Warehouses – West Coast"
                className="text-sm"
                autoFocus
                data-testid="input-new-scenario-name"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Starts with P = 3, CBC solver, default settings. You can change everything in the configure panel.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreateConfirm}
              disabled={createScenario.isPending}
              data-testid="button-create-confirm"
            >
              {createScenario.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
