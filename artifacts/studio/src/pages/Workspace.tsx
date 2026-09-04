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
  useGetSolveJob,
  useListModels,
  usePrecheckScenario,
  precheckScenario,
  getGetScenarioQueryKey,
  getListScenariosQueryKey,
  getGetSolveJobQueryKey,
  getGetDatasetQueryKey,
  getPrecheckScenarioQueryKey,
  type Scenario,
  type SolveResult,
} from "@workspace/api-client-react";
import { ArrowLeft, ChevronLeft, ChevronRight, Save } from "lucide-react";
import { AppFooter } from "@/components/AppFooter";
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
import { ToastAction } from "@/components/ui/toast";
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
import { InputMapTab, type TransportMapInputs, type TwoEchelonMapInputs } from "@/components/workspace/tabs/InputMapTab";
import { OutputMapTab } from "@/components/workspace/tabs/OutputMapTab";
import { AssignmentsTab } from "@/components/workspace/tabs/AssignmentsTab";
import { OpenWarehousesTab } from "@/components/workspace/tabs/OpenWarehousesTab";
import { CostSummaryTab } from "@/components/workspace/tabs/CostSummaryTab";
import { ServiceStatsTab } from "@/components/workspace/tabs/ServiceStatsTab";
import { FlowsTab } from "@/components/workspace/tabs/FlowsTab";
import { StaleOutputBanner } from "@/components/workspace/StaleOutputBanner";
import type { WarehouseOverride } from "@/components/tables/WarehouseTable";
import type { CustomerOverride } from "@/components/tables/CustomerTable";
import type { MineOverride } from "@/components/tables/MineTable";
import type { StationOverride } from "@/components/tables/StationTable";
import type { DistanceOverride } from "@/components/workspace/tabs/DistancesTab";
import type { LaneCostOverride } from "@/components/workspace/tabs/LaneCostsTab";
import type { LegDistanceOverride } from "@/components/workspace/tabs/LegDistancesTab";
import type {
  MapWarehouse,
  MapCustomer,
  PMedianMapInputs,
  AddedWarehouseInput,
  AddedCustomerInput,
} from "@/components/workspace/map/types";
import type { WhStatus } from "@/components/workspace/map/statusPresentation";
import {
  workspaceTabsReducer,
  workspaceTabId,
  initialWorkspaceTabState,
  type WorkspaceTab,
} from "@/lib/workspaceTabs";
import { chapterForModelId, type StudioModelType } from "@/lib/chapters";
import { toast } from "@/hooks/use-toast";
import {
  completenessCountForWarehouse,
  completenessCountForCustomer,
  completenessCountForMine,
  completenessCountForStation,
  type PrecheckErrorLike,
} from "@/lib/precheckDisplay";

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

// T8 (Input Map v2) — added-row readers typed against map/types.ts's own
// AddedWarehouseInput/AddedCustomerInput (which carry T1's `displayCode`
// field) rather than WarehousesTab.tsx/CustomersTab.tsx's own AddedWarehouse/
// AddedCustomer types (addedWarehousesFromInputs/addedCustomersFromInputs
// above) — those two type families describe the exact same JSON shape from
// two different call sites' points of view; kept separate rather than
// widening the *Tab types so this file's map-only surface doesn't force an
// unrelated prop-type change on WarehousesTab.tsx/CustomersTab.tsx (owned by
// T9 in this same wave).
function mapAddedWarehousesFromInputs(inputs: Record<string, unknown> | null): AddedWarehouseInput[] {
  const raw = inputs?.addedWarehouses;
  return Array.isArray(raw) ? (raw as AddedWarehouseInput[]) : [];
}

function mapAddedCustomersFromInputs(inputs: Record<string, unknown> | null): AddedCustomerInput[] {
  const raw = inputs?.addedCustomers;
  return Array.isArray(raw) ? (raw as AddedCustomerInput[]) : [];
}

// T8 — effective-row view models for the p-median-us Input Map tab: base
// dataset rows with warehouseOverrides/customerOverrides APPLIED (a
// warehouse's effective status/capacity, a customer's effective demand +
// excluded flag), UNIONED with scenario-local added rows (isAdded:true).
// This is the single source of truth EntityMarkers/the map's edit dialogs
// render from and write back to — mirrors Studio.tsx's own NetworkMap
// override-application pattern, just producing a MapWarehouse/MapCustomer
// instead of a color/status prop. A base row's `displayCode` is its id
// (dataset ids are already human-readable, e.g. "CHI") — only added rows
// carry a separately-generated display code (T3).
function pmedianMapWarehouses(
  dataset: { warehouses: { id: string; city: string; state: string; lat: number; lng: number }[] } | undefined,
  inputs: Record<string, unknown> | null,
): MapWarehouse[] {
  const overrideById = new Map(warehouseOverridesFromInputs(inputs).map(o => [o.id, o]));
  const base: MapWarehouse[] = (dataset?.warehouses ?? []).map(w => {
    const o = overrideById.get(w.id);
    return {
      id: w.id,
      displayCode: w.id,
      city: w.city,
      state: w.state,
      lat: w.lat,
      lng: w.lng,
      capacity: o?.capacity ?? null,
      status: (o?.status ?? "active") as WhStatus,
      isAdded: false,
    };
  });
  const added: MapWarehouse[] = mapAddedWarehousesFromInputs(inputs).map(w => ({
    id: w.id,
    displayCode: w.displayCode ?? w.id,
    city: w.city,
    state: w.state,
    lat: w.lat,
    lng: w.lng,
    capacity: w.capacity ?? null,
    status: w.status,
    isAdded: true,
  }));
  return [...base, ...added];
}

function pmedianMapCustomers(
  dataset: { customers: { id: string; city: string; state: string; lat: number; lng: number; demand: number }[] } | undefined,
  inputs: Record<string, unknown> | null,
): MapCustomer[] {
  const overrideById = new Map(customerOverridesFromInputs(inputs).map(o => [o.id, o]));
  const base: MapCustomer[] = (dataset?.customers ?? []).map(c => {
    const o = overrideById.get(c.id);
    return {
      id: c.id,
      displayCode: c.id,
      city: c.city,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
      demand: o?.demand ?? c.demand,
      excluded: o?.status === "excluded",
      isAdded: false,
    };
  });
  // T9 (A3 projection) — an added customer's `excluded` flag is now derived
  // from its own `status` field (T1/T8's `AddedCustomerInput.status`),
  // instead of the old hardcoded `false`. This function is shared verbatim
  // by two-echelon-gold-au's Input Map customers render (see the
  // `customers={pmedianMapCustomers(...)}` call site below) — reusing
  // p-median-us's exact addedCustomers/status field name/shape (T7's own
  // comment on why no separate two-echelon wrapper exists) — so this one fix
  // covers both models' added-customer projection, not just p-median-us.
  const added: MapCustomer[] = mapAddedCustomersFromInputs(inputs).map(c => ({
    id: c.id,
    displayCode: c.displayCode ?? c.id,
    city: c.city,
    state: c.state,
    lat: c.lat,
    lng: c.lng,
    demand: c.demand,
    excluded: c.status === "excluded",
    isAdded: true,
  }));
  return [...base, ...added];
}

// The `inputs` slice InputMapTab's "pmedian" mode actually edits — a typed
// view over the same raw `localInputs` blob every other tab reads, carrying
// the extra fields (`[k: string]: unknown`) through untouched so a round
// trip via `onInputsChange` never silently drops an unrelated field (gap,
// timeLimitSec, distanceBands, p, ...).
function pmedianMapInputsSlice(inputs: Record<string, unknown> | null): PMedianMapInputs {
  return {
    ...(inputs ?? {}),
    addedWarehouses: mapAddedWarehousesFromInputs(inputs),
    addedCustomers: mapAddedCustomersFromInputs(inputs),
    warehouseOverrides: warehouseOverridesFromInputs(inputs),
    customerOverrides: customerOverridesFromInputs(inputs),
    distanceOverrides: distanceOverridesFromInputs(inputs),
    capacityMode: capacityModeFromInputs(inputs),
  } as PMedianMapInputs;
}

// T6 (Bundle 2) — transport-coal's sparse mineCapacities/stationDemands
// readers, Record-shaped (not array-of-{id,status,capacity} like
// warehouseOverrides/customerOverrides) — mirrors
// mineOverridesFromInputs/stationOverridesFromInputs's own raw-field read,
// just without the array translation those two do for MineTable/
// StationTable's own overrides prop (the map's TransportMapInputs slice
// wants the raw record, since its own mutators — editBaseMineCapacity/
// editBaseStationDemand in InputMapTab.tsx — operate on it directly, same
// as MineTable.tsx/StationTable.tsx's own `upsert` does).
function mineCapacitiesRecordFromInputs(inputs: Record<string, unknown> | null): Record<string, number> {
  const raw = inputs?.mineCapacities;
  return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
}

function stationDemandsRecordFromInputs(inputs: Record<string, unknown> | null): Record<string, number> {
  const raw = inputs?.stationDemands;
  return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
}

// T6 — effective-row view models for transport-coal's Input Map tab, the
// mine/station analogue of pmedianMapWarehouses/pmedianMapCustomers above:
// base dataset rows (dataset.warehouses = mines, dataset.customers =
// stations, per this file's own knownMineIds/knownStationIds comment) with
// mineCapacities/stationDemands overrides APPLIED, unioned with
// scenario-local addedMines/addedStations (isAdded:true). Mines never carry
// a `status` (MapWarehouse.status stays undefined — MINE_ROLE's
// hasStatus:false, see types.ts), and stations have no "excluded" concept
// at all (transport-coal has no equivalent), so it's always false.
function transportMapMines(
  dataset: { warehouses: { id: string; city: string; state: string; lat: number; lng: number }[] } | undefined,
  inputs: Record<string, unknown> | null,
): MapWarehouse[] {
  const capacities = mineCapacitiesRecordFromInputs(inputs);
  const base: MapWarehouse[] = (dataset?.warehouses ?? []).map(m => ({
    id: m.id,
    displayCode: m.id,
    city: m.city,
    state: m.state,
    lat: m.lat,
    lng: m.lng,
    capacity: capacities[m.id] ?? null,
    isAdded: false,
  }));
  const added: MapWarehouse[] = addedMinesFromInputs(inputs).map(m => ({
    id: m.id,
    displayCode: m.displayCode ?? m.id,
    city: m.city,
    state: m.state,
    lat: m.lat,
    lng: m.lng,
    capacity: m.capacity ?? null,
    isAdded: true,
  }));
  return [...base, ...added];
}

function transportMapStations(
  dataset: { customers: { id: string; city: string; state: string; lat: number; lng: number; demand: number }[] } | undefined,
  inputs: Record<string, unknown> | null,
): MapCustomer[] {
  const demands = stationDemandsRecordFromInputs(inputs);
  const base: MapCustomer[] = (dataset?.customers ?? []).map(s => ({
    id: s.id,
    displayCode: s.id,
    city: s.city,
    state: s.state,
    lat: s.lat,
    lng: s.lng,
    demand: demands[s.id] ?? s.demand,
    excluded: false,
    isAdded: false,
  }));
  const added: MapCustomer[] = addedStationsFromInputs(inputs).map(s => ({
    id: s.id,
    displayCode: s.displayCode ?? s.id,
    city: s.city,
    state: s.state,
    lat: s.lat,
    lng: s.lng,
    demand: s.demand,
    excluded: false,
    isAdded: true,
  }));
  return [...base, ...added];
}

// The `inputs` slice InputMapTab's "transport" mode edits — same role
// pmedianMapInputsSlice plays for "pmedian" mode, one level down (see
// TransportMapInputs's own comment for why the shapes genuinely differ).
function transportMapInputsSlice(inputs: Record<string, unknown> | null): TransportMapInputs {
  return {
    ...(inputs ?? {}),
    addedMines: addedMinesFromInputs(inputs),
    addedStations: addedStationsFromInputs(inputs),
    laneCostOverrides: laneCostOverridesFromInputs(inputs),
    mineCapacities: mineCapacitiesRecordFromInputs(inputs),
    stationDemands: stationDemandsRecordFromInputs(inputs),
  } as TransportMapInputs;
}

// T7 (Bundle 2) — two-echelon-gold-au's added-refinery reader, typed against
// map/types.ts's own AddedWarehouseInput (T1's displayCode field) rather
// than WarehousesTab.tsx's AddedWarehouse (addedRefineriesFromInputs
// above) — same "two type families, one JSON shape" reasoning
// mapAddedWarehousesFromInputs/mapAddedCustomersFromInputs already document
// for p-median-us.
function mapAddedRefineriesFromInputs(inputs: Record<string, unknown> | null): AddedWarehouseInput[] {
  const raw = inputs?.addedRefineries;
  return Array.isArray(raw) ? (raw as AddedWarehouseInput[]) : [];
}

// T7 — effective-row view model for two-echelon-gold-au's Input Map tab: base
// REFINERY candidates (dataset.warehouses filtered to kind !== "mine", same
// split knownGoldRefineryIds already uses) with refineryOverrides applied,
// unioned with scenario-local addedRefineries (isAdded:true). No capacity
// field at all — refineries have no capacity concept (TwoEchelonMapInputs's
// own comment). The Customers side reuses pmedianMapCustomers verbatim at
// the render call site below — customerOverrides/addedCustomers share
// p-median-us's exact field names/shape for this model too, so a dedicated
// wrapper here would just be a pass-through.
function twoEchelonMapRefineries(
  dataset: { warehouses: { id: string; city: string; state: string; lat: number; lng: number; kind?: string }[] } | undefined,
  inputs: Record<string, unknown> | null,
): MapWarehouse[] {
  const overrideById = new Map(refineryOverridesFromInputs(inputs).map(o => [o.id, o]));
  const base: MapWarehouse[] = (dataset?.warehouses ?? [])
    .filter(w => w.kind !== "mine")
    .map(w => {
      const o = overrideById.get(w.id);
      return {
        id: w.id,
        displayCode: w.id,
        city: w.city,
        state: w.state,
        lat: w.lat,
        lng: w.lng,
        status: (o?.status ?? "active") as WhStatus,
        isAdded: false,
      };
    });
  const added: MapWarehouse[] = mapAddedRefineriesFromInputs(inputs).map(r => ({
    id: r.id,
    displayCode: r.displayCode ?? r.id,
    city: r.city,
    state: r.state,
    lat: r.lat,
    lng: r.lng,
    status: r.status,
    isAdded: true,
  }));
  return [...base, ...added];
}

// T7 — the dataset's single fixed WarehouseCandidate.kind==="mine" row,
// translated to MapWarehouse purely for InputMapTab's read-only `mine` prop
// (displayCode/city/state/lat/lng only — see that prop's own comment on why
// status/isAdded/capacity are never read for it). Null when the dataset
// hasn't resolved a mine row yet.
function twoEchelonMapMine(
  dataset: { warehouses: { id: string; city: string; state: string; lat: number; lng: number; kind?: string }[] } | undefined,
): MapWarehouse | null {
  const mine = (dataset?.warehouses ?? []).find(w => w.kind === "mine");
  if (!mine) return null;
  return { id: mine.id, displayCode: mine.id, city: mine.city, state: mine.state, lat: mine.lat, lng: mine.lng, isAdded: false };
}

// The `inputs` slice InputMapTab's "twoEchelon" mode edits — same role
// pmedianMapInputsSlice/transportMapInputsSlice play for their own modes,
// one level down (see TwoEchelonMapInputs's own comment for why the shape
// genuinely differs from PMedianMapInputs). Every reader here (
// refineryOverridesFromInputs/customerOverridesFromInputs/
// distanceOverridesFromInputs) already exists and is already generic enough
// to read two-echelon-gold-au's own field names verbatim — no new readers
// needed beyond mapAddedRefineriesFromInputs above.
function twoEchelonMapInputsSlice(inputs: Record<string, unknown> | null): TwoEchelonMapInputs {
  return {
    ...(inputs ?? {}),
    addedRefineries: mapAddedRefineriesFromInputs(inputs),
    addedCustomers: mapAddedCustomersFromInputs(inputs),
    refineryOverrides: refineryOverridesFromInputs(inputs),
    customerOverrides: customerOverridesFromInputs(inputs),
    distanceOverrides: distanceOverridesFromInputs(inputs),
  } as TwoEchelonMapInputs;
}

// T8 — detects which added rows a map edit CREATED or MOVED (a new id, or an
// existing id whose lat/lng changed), so handlePMedianMapInputsChange can
// register a post-Save "N distances estimated" watch for exactly those
// entities (Workspace.tsx's own `pendingEstimateWatches`, a sibling of the
// existing `pendingPrecheckWatches` mechanism but answering a different
// question — see that state's own comment). Edits that only change
// status/capacity/demand (no coordinate change) and deletes are not watched.
function detectMapWatches(
  prevRows: { id: string; lat: number; lng: number; displayCode?: string }[],
  nextRows: { id: string; lat: number; lng: number; displayCode?: string }[],
): { id: string; displayCode: string }[] {
  const prevById = new Map(prevRows.map(r => [r.id, r]));
  const watched: { id: string; displayCode: string }[] = [];
  for (const row of nextRows) {
    const before = prevById.get(row.id);
    const displayCode = row.displayCode ?? row.id;
    if (!before) {
      watched.push({ id: row.id, displayCode });
    } else if (before.lat !== row.lat || before.lng !== row.lng) {
      watched.push({ id: row.id, displayCode });
    }
  }
  return watched;
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

// Followup — `id -> displayCode` map for the distance-type grids
// (DistancesTab/LaneCostsTab/LegDistancesTab), so From/To columns show a
// scenario-local added entity's human-readable displayCode (e.g.
// "WH-CO-DENVER-01") instead of its opaque uid. Only added entities ever
// carry a displayCode (T3) — base dataset rows have none and simply have no
// entry here, so those grids' existing `?? id` fallback keeps showing the
// textbook id unchanged. Merges across all five added-entity arrays
// unconditionally rather than switching on modelId — each grid only ever
// looks up ids that actually appear in its own fromId/toId values, so the
// unused entries for other models' entity kinds are harmless.
function displayCodeMapFromInputs(inputs: Record<string, unknown> | null): Record<string, string> {
  const map: Record<string, string> = {};
  const sources = [
    addedWarehousesFromInputs(inputs),
    addedCustomersFromInputs(inputs),
    addedMinesFromInputs(inputs),
    addedStationsFromInputs(inputs),
    addedRefineriesFromInputs(inputs),
  ];
  for (const rows of sources) {
    for (const row of rows) {
      if (row.displayCode) map[row.id] = row.displayCode;
    }
  }
  return map;
}

// T9 (T6 wiring) — the snapshot shape OpenWarehousesTab.tsx's
// OpenWarehousesDisplayedInputs and AssignmentsTab.tsx's
// AssignmentsDisplayedInputs both accept (a structural superset covers
// both — capacityMode is simply unused by AssignmentsTab). Built from
// `displayedInputs` (the SAVED snapshot that produced `displayedResult`),
// NEVER `localInputs` — the snapshot invariant both tabs' own comments
// document. `addedWarehouses`/`addedRefineries` share the `aw-` uid family
// (two-echelon's added facilities are refineries), so both are always
// included regardless of the active model — the unused one is just empty.
function facilityDisplayedInputs(inputs: Record<string, unknown> | null): {
  capacityMode: string;
  addedWarehouses: { id: string; displayCode?: string }[];
  addedRefineries: { id: string; displayCode?: string }[];
} {
  return {
    capacityMode: capacityModeFromInputs(inputs),
    addedWarehouses: addedWarehousesFromInputs(inputs),
    addedRefineries: addedRefineriesFromInputs(inputs),
  };
}

// T9 (T7 wiring) — base-dataset warehouse/customer ids currently inactive/
// excluded in the scenario's LIVE (unsaved) localInputs draft — DistancesTab's
// own view filter over its immutable reference matrix (never refetched, just
// hides rows whose endpoint is presently inactive/excluded). `warehouseOverrides`/
// `customerOverrides` only ever key base-dataset ids (added entities carry
// their own status on addedWarehouses/addedCustomers, never on these
// override arrays), so no separate dataset cross-reference is needed here.
function inactiveWarehouseIdsFromInputs(inputs: Record<string, unknown> | null): string[] {
  return warehouseOverridesFromInputs(inputs)
    .filter(o => o.status === "inactive")
    .map(o => o.id);
}

function excludedCustomerIdsFromInputs(inputs: Record<string, unknown> | null): string[] {
  return customerOverridesFromInputs(inputs)
    .filter(o => o.status === "excluded")
    .map(o => o.id);
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
// with the pilot. T5 (Bundle 2) gave this model both a real Input Map (T3's
// own GET /dataset entry + T1's manifest parity) AND real
// Warehouses/Customers/Distances grid tabs (Step 2b — the SAME
// WarehousesTab/CustomersTab/DistancesTab components p-median-us already
// uses, incl. their Upload/Download CSV toolbars, T9's backend gate).
// Phase 3.2, Task 4 — "Input Map" is the first entry in every model's list.
// p-median-brazil shares this array with p-median-us (the switch's default
// case) so it gets the exact same sidebar entries — T5 (Bundle 2) wired
// every one of them to real content.
function inputEntriesForModel(modelId: StudioModelType): SidebarEntry[] {
  switch (modelId) {
    case "transport-coal":
      return [
        { id: "input-map", label: "Input Map" },
        { id: "mines", label: "Mines" },
        { id: "stations", label: "Stations" },
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
        { id: "input-map", label: "Input Map" },
        { id: "refineries", label: "Refineries" },
        { id: "customers", label: "Customers" },
        { id: "distances", label: "Distances" },
        { id: "optimization-parameters", label: "Optimization Parameters" },
      ];
    case "p-median-brazil":
    case "p-median-us":
    default:
      return [
        { id: "input-map", label: "Input Map" },
        { id: "customers", label: "Customers" },
        { id: "warehouses", label: "Warehouses" },
        { id: "distances", label: "Distances" },
        { id: "optimization-parameters", label: "Optimization Parameters" },
      ];
  }
}

// Phase 3.2, Task 4 — dispatches to precheckDisplay.ts's per-entity
// completeness readers (warehouses/refineries share the same "missing
// distances to N customers" message shape; mines have their own "missing
// lane costs" shape; customers/stations are the reverse-direction readers,
// which return a plain number rather than number|null).
function missingCountFor(kind: string, errors: PrecheckErrorLike[], id: string): number {
  if (kind === "warehouses" || kind === "refineries") return completenessCountForWarehouse(errors, id) ?? 0;
  if (kind === "mines") return completenessCountForMine(errors, id) ?? 0;
  if (kind === "customers") return completenessCountForCustomer(errors, id);
  if (kind === "stations") return completenessCountForStation(errors, id);
  return 0;
}

// A3.1 builds this tab's real content (re-homed NetworkMap + layer toggles)
// — A2.1 only needs the sidebar/tab-bar entry to exist so a successful solve
// has something real to open+activate.
const OUTPUT_MAP_ENTRY: SidebarEntry = { id: "output-map", label: "Output Map" };

// T9 (B4) — Solution Summary immediately follows Output Map, matching the
// wireframe's tab order (was last-but-one).
const OUTPUT_ENTRIES: SidebarEntry[] = [
  OUTPUT_MAP_ENTRY,
  { id: "cost-summary", label: "Solution Summary" },
  { id: "open-warehouses", label: "Open Warehouses" },
  { id: "customer-assignments", label: "Customer Assignments" },
  { id: "flows", label: "Flows" },
  { id: "service-stats", label: "Service Stats" },
];

// T9 (B2) — single translation point between the sidebar's kebab-case
// entity ids and the manifest's camelCase `capabilities.outputGrids`
// strings (C6.1's own vocabulary) — hoisted to module scope so BOTH the
// SidebarTree gate (which entries even appear) and renderTabContent's
// content gate (defense-in-depth, unchanged) share one definition instead of
// two independently-maintained copies drifting apart.
const OUTPUT_ENTITY_TO_CAPABILITY: Record<string, string> = {
  "open-warehouses": "openWarehouses",
  "customer-assignments": "assignments",
  "cost-summary": "costSummary",
  "service-stats": "serviceStats",
  "flows": "flows",
};

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

  const { data: scenarios } = useListScenarios({ modelId });
  const { data: scenarioFromApi } = useGetScenario(scenarioIdFromUrl!, {
    query: { enabled: !!scenarioIdFromUrl, queryKey: getGetScenarioQueryKey(scenarioIdFromUrl!) },
  });
  // T3 (Bundle 2) — `GetDatasetModelId` now includes "p-median-brazil" (its
  // own GET /dataset entry, openapi.yaml's modelId enum), so this hook's
  // `modelId` param is structurally identical to StudioModelType again — no
  // cast, no per-model `enabled` carve-out needed any more.
  const datasetParams = { modelId };
  const { data: dataset } = useGetDataset(datasetParams, {
    query: { queryKey: getGetDatasetQueryKey(datasetParams) },
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

  // Bundle 6 T2 (item 1) — default scenario when there's no `?scenario=` in
  // the URL: prefer the most-recently-solved scenario (greatest non-null
  // `solvedAt`), falling back to the most-recently-updated one when none are
  // solved yet — replaces the old `scenarios?.[0]` (array order, not
  // meaningful) fallback.
  const defaultScenario = useMemo(() => {
    const list = scenarios ?? [];
    if (!list.length) return undefined;
    const solved = list.filter(s => s.solvedAt != null);
    if (solved.length) {
      return solved.reduce((best, s) => (s.solvedAt! > best.solvedAt! ? s : best));
    }
    return list.reduce((best, s) => (s.updatedAt > best.updatedAt ? s : best));
  }, [scenarios]);
  const currentScenario = scenarioFromApi ?? scenarios?.find(s => s.id === scenarioIdFromUrl) ?? defaultScenario;

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

  // C5.1 fix — every OUTPUT surface (Output Map, the four output grid tabs,
  // Reports) must render whatever the stepper is currently pointed at, not
  // always the scenario's latest solve. Mirrors Studio.tsx:475-478's
  // `result` derivation exactly: while the stepper is parked on a historical
  // entry (`resultHistoryState.index >= 0` — it's initialized to -1 only
  // before the seeding effect above has ever run), read that entry's own
  // `.result`; otherwise (including the common case where history hasn't
  // been seeded yet on first render) fall back to the live scenario's
  // `result`. Deliberately NOT used by `hasFreshSolvedRun` above — staleness
  // is a property of the scenario's LATEST solve vs. its LATEST saved
  // inputs, not of whichever historical entry a student happens to be
  // browsing.
  const displayedResult =
    resultHistoryState.index >= 0
      ? (resultHistoryState.items[resultHistoryState.index]?.result ?? null)
      : (currentScenario?.result ?? null);

  // T4 — `displayedInputs`: the inputs snapshot that PRODUCED
  // `displayedResult` above (same resultHistoryState index, same fallback to
  // the live scenario), per R5's `displayedInputs` principle — every OUTPUT
  // surface (Output Map band coloring today; R7's effective dataset next,
  // T6) reads THIS, never the editable `localInputs` draft. So editing bands
  // in the Run Optimizer dialog or Optimization Parameters, or stepping the
  // result-history stepper, never recolors/re-geometries a solve that's
  // already on screen — only a fresh solve (which snapshots its own
  // inputs into a new history entry, see the seeding effect above) changes
  // what these surfaces show.
  const displayedInputs: Record<string, unknown> | null =
    resultHistoryState.index >= 0
      ? (resultHistoryState.items[resultHistoryState.index]?.inputs ?? null)
      : ((currentScenario?.inputs as Record<string, unknown> | undefined) ?? null);

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
    // T8 — pre-save snapshot, diffed post-save against the response's own
    // distanceOverrides to compute the "N distances estimated" toast (see
    // reportEstimatedDistanceWatches's own comment) — captured here, not
    // read from `savedInputsRef` inside onSuccess, since by the time
    // onSuccess runs `inputs` is what was actually SENT.
    const preSaveDistanceOverrides = distanceOverridesFromInputs(inputs);
    // T6 (Bundle 2) — transport-coal analogue, captured the same way and
    // for the same reason. A no-op read for every other model
    // (laneCostOverridesFromInputs on a non-transport `inputs` blob is
    // always []).
    const preSaveLaneCostOverrides = laneCostOverridesFromInputs(inputs);
    updateScenario.mutate(
      { scenarioId, data: { inputs } },
      {
        onSuccess: updated => {
          // T8 (Input Map v2) — adopt the RESPONSE inputs, not the pre-send
          // `inputs`: T1's backend normalizer can add estimated
          // distanceOverrides rows for any newly-created/moved entity, and
          // trusting the pre-send value here would mean those rows don't
          // show up until an unrelated refetch happens to land, AND would
          // immediately re-flag the scenario dirty (savedInputsRef would
          // disagree with what the server actually persisted the moment a
          // background refetch of currentScenario lands).
          setLocalInputs(updated.inputs);
          savedInputsRef.current = updated.inputs;
          queryClient.setQueryData(getGetScenarioQueryKey(scenarioId), updated);
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetScenarioQueryKey(scenarioId) });
          // B5.2 — refetch precheck against the just-saved inputs (see the
          // usePrecheckScenario call site's comment above).
          queryClient.invalidateQueries({ queryKey: getPrecheckScenarioQueryKey(scenarioId) });
          // Phase 3.2, Task 4 — resolve any pending Input Map precheck
          // watches for this scenario now that its inputs are persisted.
          void reportPendingPrecheckWatches(scenarioId);
          // T8 — resolve any pending map create/move estimate watches.
          reportEstimatedDistanceWatches(scenarioId, preSaveDistanceOverrides, distanceOverridesFromInputs(updated.inputs));
          // T6 (Bundle 2) — transport-coal's own "N lane costs estimated" watch.
          reportEstimatedLaneCostWatches(scenarioId, preSaveLaneCostOverrides, laneCostOverridesFromInputs(updated.inputs));
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
  // actually wired to `localInputs` today.
  const isEditableInputTab =
    activeTab?.kind === "input" &&
    (activeTab.entity === "optimization-parameters" ||
      // T8 (Input Map v2) — the map tab's own edits (add/move/copy/delete,
      // in-place override edits) write into localInputs exactly like every
      // other editable tab, so it needs the same manual-Save toolbar.
      // T5 (Bundle 2) — p-median-brazil joins p-median-us here: it shares
      // the exact same PMedianMapInputs shape (T1's manifest parity) and got
      // its own GET /dataset endpoint (T3), so it gets the real editor too.
      (activeTab.entity === "input-map" && (modelId === "p-median-us" || modelId === "p-median-brazil")) ||
      // T6 (Bundle 2) — transport-coal's own full-v2 editor
      // (mode="transport", InputMapTab.tsx) — a SEPARATE condition, not
      // folded into the pmedian check above: TransportLpInputs isn't
      // PMedianMapInputs-shaped (see TransportMapInputs's own comment).
      (activeTab.entity === "input-map" && modelId === "transport-coal") ||
      // T7 (Bundle 2) — two-echelon-gold-au's own full-v2 editor
      // (mode="twoEchelon", InputMapTab.tsx) — a THIRD, separate condition
      // for the same reason: TwoEchelonMapInputs isn't PMedianMapInputs-
      // shaped either (refineryOverrides not warehouseOverrides, no
      // capacityMode/capacity concept at all — see TwoEchelonMapInputs's
      // own comment).
      (activeTab.entity === "input-map" && modelId === "two-echelon-gold-au") ||
      // T5 (Bundle 2, Step 2b) — p-median-brazil joins p-median-us: same
      // WarehousesTab/CustomersTab components, same entity shapes (T1's
      // manifest parity), same T3 GET /dataset entry.
      (activeTab.entity === "warehouses" && (modelId === "p-median-us" || modelId === "p-median-brazil")) ||
      (activeTab.entity === "customers" && (modelId === "p-median-us" || modelId === "p-median-brazil" || modelId === "two-echelon-gold-au")) ||
      (activeTab.entity === "refineries" && modelId === "two-echelon-gold-au") ||
      (activeTab.entity === "mines" && modelId === "transport-coal") ||
      (activeTab.entity === "stations" && modelId === "transport-coal") ||
      // B5.1/B6.2/T5 — Distances grid. p-median-us AND p-median-brazil (same
      // {fromId,toId,distance} shape, T9's backend gate) render DistancesTab;
      // two-echelon-gold-au shares the same sidebar entity id ("distances")
      // but renders LegDistancesTab instead (a structurally different
      // three-id-space/two-leg component — see renderTabContent's own
      // branch below).
      (activeTab.entity === "distances" && (modelId === "p-median-us" || modelId === "p-median-brazil" || modelId === "two-echelon-gold-au")) ||
      // Task 30 (B6.1 stage 4) — Lane costs grid, transport-coal only.
      (activeTab.entity === "laneCosts" && modelId === "transport-coal"));

  // R4 — p-median-us's Input Map tab renders its OWN inline Save (in the
  // Layers row, see InputMapTab.tsx's `onSave` prop) instead of the shared
  // toolbar below; T5 — p-median-brazil joins it (same real editor, same
  // relocated Save).
  const saveInLayersRow =
    activeTab?.kind === "input" && activeTab.entity === "input-map" && (modelId === "p-median-us" || modelId === "p-median-brazil");
  // T6 (Bundle 2) — transport-coal's own Save-in-Layers gate, a SEPARATE
  // condition from the pmedian one above (same reasoning as
  // isEditableInputTab's own third branch) — its Layers row is a
  // structurally different component (InputMapTab.tsx's TransportInputMap),
  // just reusing the same relocated-Save UX/testids.
  const saveInLayersRowTransport = activeTab?.kind === "input" && activeTab.entity === "input-map" && modelId === "transport-coal";
  // T7 (Bundle 2) — two-echelon-gold-au's own Save-in-Layers gate, same
  // reasoning as saveInLayersRowTransport above (InputMapTab.tsx's
  // TwoEchelonInputMap is its own structurally-different Layers row).
  const saveInLayersRowTwoEchelon = activeTab?.kind === "input" && activeTab.entity === "input-map" && modelId === "two-echelon-gold-au";

  function openTab(kind: WorkspaceTab["kind"], entry: SidebarEntry) {
    dispatch({ type: "open", tab: { id: workspaceTabId(kind, entry.id), kind, entity: entry.id, label: entry.label } });
  }

  // Bundle 6 T2 (item 1, resolution #3) — one-shot Input Map seeding: opens
  // the Input Map tab exactly once per model entry, keyed on `modelId` (not
  // reactively on `activeTab === null`, which would reopen Input Map after
  // the user deliberately closes the last tab). Navigating to a different
  // chapter re-seeds once; closing the last tab does NOT reopen it — the
  // ref guard is already tripped for this model.
  const didSeedTabRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentScenario) return;
    if (didSeedTabRef.current === modelId) return; // already seeded for this model
    didSeedTabRef.current = modelId;
    const entry = inputEntriesForModel(modelId).find(e => e.id === "input-map");
    if (entry) openTab("input", entry);
  }, [currentScenario, modelId]);

  // Phase 3.2, Task 4 — Input Map click-to-place. `pendingPrefill` flows one
  // shot into whichever *Tab's prefillCoords prop, cleared via
  // onPrefillConsumed. `pendingPrecheckWatches` tracks every entity we owe a
  // post-Save precheck toast to, scoped by scenario — a list, not one bare
  // id, since more than one entity can be added before the next Save, and
  // scoped so switching scenarios mid-flow can't cross-contaminate.
  // `focusEntityId` flows one shot into the currently-active Distances/Lane
  // costs/Leg distances tab (whichever renders for this model) so the
  // toast's "jump to it" action can scroll to the new entity's row —
  // cleared here (the consumer), not by those tabs themselves, via a short
  // timer once set.
  const [pendingPrefill, setPendingPrefill] = useState<{ lat: number; lng: number } | null>(null);
  const [pendingPrecheckWatches, setPendingPrecheckWatches] = useState<{ scenarioId: number; kind: string; id: string }[]>([]);
  const [focusEntityId, setFocusEntityId] = useState<string | null>(null);
  // T8 — entities created/moved via the p-median-us Input Map, watched so
  // the post-Save toast can report how many of THEIR distanceOverrides rows
  // came back `estimated:true` from T1's backend normalizer. Deliberately a
  // SEPARATE list/mechanism from pendingPrecheckWatches above (which reports
  // *Tab add-row flows' missing-distance PRECHECK errors) — by the time a
  // Save round-trips, the normalizer has already filled every gap, so
  // precheck always reports zero missing for a map-created/moved entity;
  // the useful post-Save signal here is how many of its distances are
  // estimated (i.e. worth reviewing), computed by diffing pre-/post-Save
  // distanceOverrides directly, not by re-querying precheck.
  const [pendingEstimateWatches, setPendingEstimateWatches] = useState<{ scenarioId: number; id: string; displayCode: string }[]>([]);

  useEffect(() => {
    if (!focusEntityId) return;
    const t = setTimeout(() => setFocusEntityId(null), 3000);
    return () => clearTimeout(t);
  }, [focusEntityId]);

  function handleEntityAdded(kind: string, id: string) {
    if (!currentScenario) return;
    setPendingPrecheckWatches(prev => [...prev, { scenarioId: currentScenario.id, kind, id }]);
  }

  // Detects a genuine ADD (array grew by one) among the possible edit/add
  // combinations each *Tab's onAddedXChange callback can carry, and reports
  // the newly-added id to handleEntityAdded above. An edit (same length) or
  // a delete (handled via a separate onDeleteX callback, never through this
  // path) don't register a watch.
  function handleAddedArrayChange<T extends { id: string }>(kind: string, fieldKey: string, current: T[], next: T[]) {
    updateInputsField(fieldKey, next);
    if (next.length > current.length) {
      const currentIds = new Set(current.map(e => e.id));
      const added = next.find(e => !currentIds.has(e.id));
      if (added) handleEntityAdded(kind, added.id);
    }
  }

  // T8 — InputMapTab's "pmedian" mode onInputsChange. `next` is already a
  // full PMedianMapInputs (built by spreading the `inputs` prop it was
  // handed — see pmedianMapInputsSlice), so it's safe to adopt directly as
  // the new localInputs (PMedianMapInputs's own `[k: string]: unknown` index
  // signature makes it structurally a Record<string, unknown>). Before
  // adopting it, diffs the OLD added-warehouse/added-customer rows against
  // the NEW ones to detect a create or a coordinate change (move) and
  // registers a pendingEstimateWatches entry for each — status/capacity/
  // demand-only edits and deletes are not watched (see detectMapWatches's
  // own comment).
  function handlePMedianMapInputsChange(next: PMedianMapInputs) {
    if (currentScenario) {
      const scenarioId = currentScenario.id;
      const watched = [
        ...detectMapWatches(mapAddedWarehousesFromInputs(localInputs), next.addedWarehouses),
        ...detectMapWatches(mapAddedCustomersFromInputs(localInputs), next.addedCustomers),
      ];
      if (watched.length > 0) {
        setPendingEstimateWatches(prev => [...prev, ...watched.map(w => ({ scenarioId, id: w.id, displayCode: w.displayCode }))]);
      }
    }
    setLocalInputs(next);
  }

  // T6 (Bundle 2) — InputMapTab's "transport" mode onInputsChange, the
  // mine/station analogue of handlePMedianMapInputsChange immediately
  // above. Watches addedMines/addedStations for a create/move the same way,
  // registering the SAME pendingEstimateWatches list (it's already
  // model-agnostic, id-scoped) — reportEstimatedLaneCostWatches (below)
  // resolves it against laneCostOverrides instead of distanceOverrides.
  function handleTransportMapInputsChange(next: TransportMapInputs) {
    if (currentScenario) {
      const scenarioId = currentScenario.id;
      const watched = [
        ...detectMapWatches(addedMinesFromInputs(localInputs), next.addedMines),
        ...detectMapWatches(addedStationsFromInputs(localInputs), next.addedStations),
      ];
      if (watched.length > 0) {
        setPendingEstimateWatches(prev => [...prev, ...watched.map(w => ({ scenarioId, id: w.id, displayCode: w.displayCode }))]);
      }
    }
    setLocalInputs(next);
  }

  // T7 (Bundle 2) — InputMapTab's "twoEchelon" mode onInputsChange, the
  // refinery/customer analogue of handlePMedianMapInputsChange/
  // handleTransportMapInputsChange above. Watches addedRefineries/
  // addedCustomers for a create/move the same way — the mine is never
  // watched, since it can't be created/moved at all (it's never in either
  // array — see InputMapTab.tsx's own `mine` prop comment).
  function handleTwoEchelonMapInputsChange(next: TwoEchelonMapInputs) {
    if (currentScenario) {
      const scenarioId = currentScenario.id;
      const watched = [
        ...detectMapWatches(mapAddedRefineriesFromInputs(localInputs), next.addedRefineries),
        ...detectMapWatches(mapAddedCustomersFromInputs(localInputs), next.addedCustomers),
      ];
      if (watched.length > 0) {
        setPendingEstimateWatches(prev => [...prev, ...watched.map(w => ({ scenarioId, id: w.id, displayCode: w.displayCode }))]);
      }
    }
    setLocalInputs(next);
  }

  // Post-Save precheck toast (Input Map, Task 4). Called from
  // handleSaveInputs's onSuccess, after that handler's own existing
  // getPrecheckScenarioQueryKey invalidation — awaits a FRESH fetch of the
  // precheck result rather than trusting whatever's still in the query
  // cache from before the save, since a same-tick read of a stale closure
  // would silently show a pre-save (possibly incomplete) picture.
  async function reportPendingPrecheckWatches(scenarioId: number) {
    const relevant = pendingPrecheckWatches.filter(w => w.scenarioId === scenarioId);
    if (relevant.length === 0) return;
    await queryClient.invalidateQueries({ queryKey: getPrecheckScenarioQueryKey(scenarioId) });
    const fresh = await queryClient.fetchQuery({
      queryKey: getPrecheckScenarioQueryKey(scenarioId),
      queryFn: () => precheckScenario(scenarioId),
    });
    for (const watch of relevant) {
      const missing = missingCountFor(watch.kind, fresh.errors, watch.id);
      // Both p-median-us's "distances" and transport-coal's "laneCosts"
      // sidebar entries exist in inputEntriesForModel(modelId) for their
      // OWN model only — this lookup naturally resolves to whichever one
      // this model actually has, no per-kind branching needed.
      const targetEntityId = watch.kind === "mines" || watch.kind === "stations" ? "laneCosts" : "distances";
      const label = inputEntriesForModel(modelId).find(e => e.id === "distances" || e.id === "laneCosts")?.label ?? "Distances";
      if (missing > 0) {
        toast({
          description: `${watch.id}: missing ${missing} distance${missing === 1 ? "" : "s"} — see ${label}.`,
          action: (
            <ToastAction
              altText={`Go to ${label}`}
              onClick={() => {
                setFocusEntityId(watch.id);
                openTab("input", { id: targetEntityId, label });
              }}
            >
              {label}
            </ToastAction>
          ),
        });
      }
    }
    setPendingPrecheckWatches(prev => prev.filter(w => w.scenarioId !== scenarioId));
  }

  // T8 — post-Save "N distances estimated" toast for entities created/moved
  // via the Input Map (see pendingEstimateWatches's own comment on why this
  // is a separate mechanism from reportPendingPrecheckWatches above).
  // Synchronous (unlike reportPendingPrecheckWatches — no fresh fetch
  // needed): both the pre- and post-save distanceOverrides arrays are
  // already in hand from handleSaveInputs's onSuccess.
  function reportEstimatedDistanceWatches(
    scenarioId: number,
    preSaveOverrides: DistanceOverride[],
    postSaveOverrides: DistanceOverride[],
  ) {
    const relevant = pendingEstimateWatches.filter(w => w.scenarioId === scenarioId);
    if (relevant.length === 0) return;
    const preEstimatedKeys = new Set(preSaveOverrides.filter(o => o.estimated).map(o => `${o.fromId}|${o.toId}`));
    for (const watch of relevant) {
      const newlyEstimated = postSaveOverrides.filter(
        o => o.estimated && (o.fromId === watch.id || o.toId === watch.id) && !preEstimatedKeys.has(`${o.fromId}|${o.toId}`),
      ).length;
      if (newlyEstimated > 0) {
        toast({
          description: `${newlyEstimated} distance${newlyEstimated === 1 ? "" : "s"} estimated for ${watch.displayCode} — review.`,
          action: (
            <ToastAction
              altText="Go to Distances"
              onClick={() => {
                setFocusEntityId(watch.id);
                openTab("input", { id: "distances", label: "Distances" });
              }}
            >
              Distances
            </ToastAction>
          ),
        });
      }
    }
    setPendingEstimateWatches(prev => prev.filter(w => w.scenarioId !== scenarioId));
  }

  // T6 (Bundle 2) — transport-coal analogue of reportEstimatedDistanceWatches
  // immediately above, for its own "lane costs" vocabulary. Kept as its own
  // function (not a generalized merge of the two) — same "close mirror, not
  // shared abstraction" convention this file already applies to
  // transport-coal's network-edit machinery (see
  // deleteAddedTransportEntityAndOverrides's own comment). Typed
  // structurally rather than against LaneCostsTab.tsx's own exported
  // LaneCostOverride (which doesn't declare `estimated` — a pre-existing
  // gap in that component, out of this task's file list) — the real JSON
  // objects flowing through `inputs.laneCostOverrides` DO carry it
  // (laneCostOverrideSchema.estimated), this just widens the type enough to
  // read it here without touching that file.
  function reportEstimatedLaneCostWatches(
    scenarioId: number,
    preSaveOverrides: { fromId: string; toId: string; estimated?: boolean }[],
    postSaveOverrides: { fromId: string; toId: string; estimated?: boolean }[],
  ) {
    const relevant = pendingEstimateWatches.filter(w => w.scenarioId === scenarioId);
    if (relevant.length === 0) return;
    const preEstimatedKeys = new Set(preSaveOverrides.filter(o => o.estimated).map(o => `${o.fromId}|${o.toId}`));
    for (const watch of relevant) {
      const newlyEstimated = postSaveOverrides.filter(
        o => o.estimated && (o.fromId === watch.id || o.toId === watch.id) && !preEstimatedKeys.has(`${o.fromId}|${o.toId}`),
      ).length;
      if (newlyEstimated > 0) {
        toast({
          description: `${newlyEstimated} lane cost${newlyEstimated === 1 ? "" : "s"} estimated for ${watch.displayCode} — review.`,
          action: (
            <ToastAction
              altText="Go to Lane costs"
              onClick={() => {
                setFocusEntityId(watch.id);
                openTab("input", { id: "laneCosts", label: "Lane costs" });
              }}
            >
              Lane costs
            </ToastAction>
          ),
        });
      }
    }
    setPendingEstimateWatches(prev => prev.filter(w => w.scenarioId !== scenarioId));
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

    // T8 (Input Map v2) — Input Map tab. Every model now gets a real full-v2
    // map (T5/T6, Bundle 2, and T7 closing the last gap for
    // two-echelon-gold-au): effective-row refineries/mines/stations or
    // warehouses/customers (base dataset + overrides applied, unioned with
    // added rows) wired to their own onInputsChange so every map edit lands
    // in localInputs exactly like every other editable tab. Every mode below
    // (twoEchelon/transport/pmedian) has fully superseded the original
    // Phase 3.2 Task 4 click-to-place "legacy"/"placeholder" pin map — no
    // model routes to either anymore, so both were removed from
    // InputMapTab.tsx's mode union (cleanup pass) along with this file's own
    // now-unreferenced pinsForModel/placementOptionsForModel/handlePlacePoint.
    if (activeTab.kind === "input" && activeTab.entity === "input-map") {
      if (modelId === "two-echelon-gold-au") {
        if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
        return (
          <InputMapTab
            mode="twoEchelon"
            countryBounds={activeModelManifest?.countryBounds}
            mine={twoEchelonMapMine(dataset)}
            refineries={twoEchelonMapRefineries(dataset, localInputs)}
            // Two-echelon's customers share p-median-us's exact
            // customerOverrides/addedCustomers field names/shape — reused
            // directly rather than a pass-through wrapper (see
            // twoEchelonMapRefineries's own comment).
            customers={pmedianMapCustomers(dataset, localInputs)}
            inputs={twoEchelonMapInputsSlice(localInputs)}
            onInputsChange={handleTwoEchelonMapInputsChange}
            // R4 — Save moves into this tab's own Layers row for
            // two-echelon-gold-au too; saveInLayersRowTwoEchelon (below)
            // suppresses the shared toolbar Save exactly when this prop is
            // wired, so there is never a duplicate.
            isDirty={isDirty}
            onSave={handleSaveInputs}
            saving={updateScenario.isPending}
          />
        );
      }
      if (modelId === "transport-coal") {
        if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
        return (
          <InputMapTab
            mode="transport"
            countryBounds={activeModelManifest?.countryBounds}
            mines={transportMapMines(dataset, localInputs)}
            stations={transportMapStations(dataset, localInputs)}
            inputs={transportMapInputsSlice(localInputs)}
            onInputsChange={handleTransportMapInputsChange}
            // R4 — Save moves into this tab's own Layers row for
            // transport-coal too; saveInLayersRowTransport (below)
            // suppresses the shared toolbar Save exactly when this prop is
            // wired, so there is never a duplicate.
            isDirty={isDirty}
            onSave={handleSaveInputs}
            saving={updateScenario.isPending}
          />
        );
      }
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <InputMapTab
          mode="pmedian"
          countryBounds={activeModelManifest?.countryBounds}
          warehouses={pmedianMapWarehouses(dataset, localInputs)}
          customers={pmedianMapCustomers(dataset, localInputs)}
          inputs={pmedianMapInputsSlice(localInputs)}
          onInputsChange={handlePMedianMapInputsChange}
          // R4 — Save moves into this tab's own Layers row for p-median-us/
          // p-median-brazil; saveInLayersRow (below) suppresses the toolbar
          // Save exactly when this prop is wired, so there is never a
          // duplicate.
          isDirty={isDirty}
          onSave={handleSaveInputs}
          saving={updateScenario.isPending}
          // T5 (Bundle 2, Step 1b) — p-median-brazil's manifest declares
          // demandEditable:false (textbook-fixed region demand); every other
          // model on this branch (only p-median-us today) defaults true.
          demandEditable={activeModelManifest?.capabilities?.demandEditable ?? true}
          // T9 (T8 wiring) — "pmedian" mode is shared by p-median-us AND
          // p-median-brazil, so an explicit modelId is needed to resolve
          // `capabilities.supportsAddedCustomerExclusion` for the added-
          // customer status control (brazil's own capability is false — see
          // InputMapTab.tsx's own comment on this prop).
          modelId={modelId}
        />
      );
    }

    // A5.1 — p-median-us's real Warehouses tab. two-echelon-gold-au's
    // Refineries tab reuses the SAME component below (entity="refineries")
    // rather than forking one — see WarehousesTab's own comment on why.
    // T5 (Bundle 2, Step 2b) — p-median-brazil joins p-median-us here too:
    // same WarehouseCandidate shape (T3's own GET /dataset entry), same
    // warehouseOverrides field, same T9 backend import/export gate — no
    // per-model divergence needed beyond the condition itself.
    if (activeTab.kind === "input" && activeTab.entity === "warehouses" && (modelId === "p-median-us" || modelId === "p-median-brazil")) {
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
          onAddedWarehousesChange={next => handleAddedArrayChange("warehouses", "addedWarehouses", addedWarehousesFromInputs(localInputs), next)}
          onDeleteWarehouse={id => deleteAddedEntityAndOverrides("addedWarehouses", id)}
          precheckErrors={precheck?.errors}
          prefillCoords={pendingPrefill}
          onPrefillConsumed={() => setPendingPrefill(null)}
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
          onAddedWarehousesChange={next => handleAddedArrayChange("refineries", "addedRefineries", addedRefineriesFromInputs(localInputs), next)}
          onDeleteWarehouse={id => deleteAddedEntityAndOverrides("addedRefineries", id)}
          precheckErrors={precheck?.errors}
          prefillCoords={pendingPrefill}
          onPrefillConsumed={() => setPendingPrefill(null)}
        />
      );
    }

    // A1.1/A5.3 — Customers tab, shared by p-median-us, two-echelon-gold-au,
    // AND (T5, Bundle 2, Step 2b) p-median-brazil — all three use
    // `customerOverrides` and entity "customers" (the backend disambiguates
    // the shared entity name via the scenario's own modelId, not a
    // client-side param).
    if (activeTab.kind === "input" && activeTab.entity === "customers" && (modelId === "p-median-us" || modelId === "two-echelon-gold-au" || modelId === "p-median-brazil")) {
      if (!dataset || !localInputs) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      return (
        <CustomersTab
          customers={dataset.customers}
          overrides={customerOverridesFromInputs(localInputs)}
          onChange={next => updateInputsField("customerOverrides", next)}
          scenarioId={currentScenario?.id}
          onImportApplied={handleImportApplied}
          prefillCoords={pendingPrefill}
          onPrefillConsumed={() => setPendingPrefill(null)}
          // T5 (Step 1b/2b) — p-median-brazil's manifest declares
          // demandEditable:false (textbook-fixed region demand); every other
          // model here defaults true. Never applied to the "Added customers"
          // section below (a new region has no textbook demand to protect).
          demandEditable={activeModelManifest?.capabilities?.demandEditable ?? true}
          // B5.2/B6.2 — addedCustomers used to be a p-median-us-only concept
          // (twoEchelonInputsSchema had no such field); B6.2 gave
          // two-echelon-gold-au its own real addedCustomers field with the
          // exact same shape, so it joins this spread too now — all three
          // models read/write `addedCustomers` and `distanceOverrides` under
          // their own exact field names, so `addedCustomersFromInputs`/
          // `deleteAddedEntityAndOverrides` need no per-model branching here.
          {...(modelId === "p-median-us" || modelId === "two-echelon-gold-au" || modelId === "p-median-brazil"
            ? {
                addedCustomers: addedCustomersFromInputs(localInputs),
                onAddedCustomersChange: (next: AddedCustomer[]) => handleAddedArrayChange("customers", "addedCustomers", addedCustomersFromInputs(localInputs), next),
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
          onAddedMinesChange={next => handleAddedArrayChange("mines", "addedMines", addedMinesFromInputs(localInputs), next)}
          onDeleteMine={id => deleteAddedTransportEntityAndOverrides("addedMines", id)}
          precheckErrors={precheck?.errors}
          prefillCoords={pendingPrefill}
          onPrefillConsumed={() => setPendingPrefill(null)}
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
          onAddedStationsChange={next => handleAddedArrayChange("stations", "addedStations", addedStationsFromInputs(localInputs), next)}
          onDeleteStation={id => deleteAddedTransportEntityAndOverrides("addedStations", id)}
          precheckErrors={precheck?.errors}
          prefillCoords={pendingPrefill}
          onPrefillConsumed={() => setPendingPrefill(null)}
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

    // B5.1/T5 — Distances grid tab, p-median-us AND p-median-brazil (T5,
    // Bundle 2, Step 2b — same {fromId,toId,distance} shape, T9's backend
    // gate). Long-format rows read straight off localInputs.distanceOverrides
    // (no fixed baseline to enumerate, unlike Warehouses/Customers — B4.3's
    // same reasoning). `savedDistanceOverrides` is read from
    // savedInputsRef.current (not localInputs) purely to drive the
    // changed-row highlight — reading a ref during render is safe here
    // because it's only ever mutated inside handlers that themselves trigger
    // a re-render (handleSaveInputs/handleImportApplied/the scenario-switch
    // effect), so this value is never stale at paint time.
    if (activeTab.kind === "input" && activeTab.entity === "distances" && (modelId === "p-median-us" || modelId === "p-median-brazil")) {
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
          focusEntityId={focusEntityId}
          displayCodeById={displayCodeMapFromInputs(localInputs)}
          modelId={modelId}
          referenceCapable={activeModelManifest?.capabilities?.supportsReferenceDistances}
          inactiveWarehouseIds={inactiveWarehouseIdsFromInputs(localInputs)}
          excludedCustomerIds={excludedCustomerIdsFromInputs(localInputs)}
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
          focusEntityId={focusEntityId}
          displayCodeById={displayCodeMapFromInputs(localInputs)}
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
          focusEntityId={focusEntityId}
          displayCodeById={displayCodeMapFromInputs(localInputs)}
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
      // T5 (Bundle 2) — p-median-brazil migrated off BrazilMap (which needed
      // no `dataset`) onto the shared NetworkMap, same as every other model —
      // it now genuinely needs the dataset query to resolve first too (T3's
      // own GET /dataset entry).
      if (!dataset) return <span className="text-muted-foreground" data-testid="tab-content-loading">Loading…</span>;
      // T6/R7 (fast-followed to p-median-brazil by T5) — hide closed
      // candidates, and build the effective output dataset from THIS
      // solve's own added warehouses/customers (displayedInputs, not
      // localInputs — same snapshot principle as `bands` above), so an
      // unsaved add/move or a stepped-back history result renders the
      // geometry that solve actually used, not today's draft.
      //
      // T6 (Bundle 2) — these are TWO separate booleans, not one:
      // `projectsAddedEntities` (fold this solve's added rows into the
      // effective dataset so NetworkMap can resolve edges whose endpoints
      // are scenario-local — every model that HAS an added-entity concept
      // needs this) vs `hidesClosedFacilities` (R7's own hide-closed-
      // candidates behavior, meaningful only for models with a real facility
      // open/close concept — capabilities.supportsFacilityStatus's target
      // group. transport-coal is R7 N/A: solve_transport's openWarehouseIds
      // is always "all mines", so hiding "closed" ones would be a no-op at
      // best and a misleading concept at worst — stays false for it.
      // T7 (Bundle 2) — two-echelon-gold-au joins BOTH flags: it needs
      // added-entity projection for BOTH legs (an added refinery's
      // mine->refinery AND refinery->customer routes both need their
      // endpoints in the effective dataset — see NetworkMap.tsx's own
      // isMineLeg lookup comment) AND R7 hide-closed on refineries
      // (supportsFacilityStatus:true, same target group as p-median-us/
      // brazil — the fixed mine is retained regardless, via NetworkMap's
      // own `kind === "mine"` guard, T4 Step 2).
      // Cleanup pass — every model projects its added entities into the
      // output map (unlike hidesClosedFacilities below, this isn't a
      // capability gate at all: there's no model without an added-entity
      // concept to exclude), so the old modelId===A||B||C||D allowlist
      // (already covering all 4 models) simplified to a flat constant.
      const projectsAddedEntities = true;
      // R7 gate is capability-driven, NOT a hardcoded model list — a 5th
      // facility-status model must inherit hide-closed with zero changes
      // here (plan Global Constraint; the exact bug class this repo keeps
      // hitting). supportsFacilityStatus is true for p-median-us/brazil +
      // two-echelon (refineries), false for transport-coal (no open/close).
      const hidesClosedFacilities = activeModelManifest?.capabilities?.supportsFacilityStatus ?? false;
      return (
        <OutputMapTab
          dataset={dataset}
          // B2.1-T2 — the metric overlay resolves its distance unit from the
          // model's manifest (useListModels), so the tab needs the active id.
          modelId={modelId}
          // T6 — also displayedInputs, not localInputs: an unsaved
          // forced-open/inactive edit shouldn't retroactively re-style a
          // solve that's already on screen, for the same reason `bands`
          // reads displayedInputs (R5's displayedInputs principle, P1).
          warehouseStatuses={warehouseStatusesFromInputs(displayedInputs, modelId)}
          result={activeTab.entity === "output-map" ? displayedResult : null}
          // T4 — displayedInputs, not localInputs: editing draft bands (Run
          // Optimizer dialog / Optimization Parameters) must not recolor a
          // solve that's already displayed (R5's displayedInputs principle).
          bands={distanceBandsFromInputs(displayedInputs)}
          countryBounds={activeModelManifest?.countryBounds}
          addedWarehouses={
            !projectsAddedEntities
              ? []
              : modelId === "transport-coal"
                ? addedMinesFromInputs(displayedInputs)
                : modelId === "two-echelon-gold-au"
                  ? addedRefineriesFromInputs(displayedInputs)
                  : addedWarehousesFromInputs(displayedInputs)
          }
          addedCustomers={
            !projectsAddedEntities
              ? []
              : modelId === "transport-coal"
                ? addedStationsFromInputs(displayedInputs)
                : addedCustomersFromInputs(displayedInputs)
          }
          hideClosedWarehouses={hidesClosedFacilities}
        />
      );
    }

    // C6.1, Task 4 — Open Warehouses/Customer Assignments/Flows/Cost Summary/
    // Service Stats output grid tabs, gated by the active model's real
    // capabilities.outputGrids (Task 1's manifest field) instead of a
    // hardcoded modelId === "p-median-us" check — closes the "shared
    // component's per-model gate updated for one model, forgotten for a
    // sibling" bug class by construction. Every model×grid combination not
    // in its own outputGrids list falls through to the generic placeholder.
    if (
      activeTab.kind === "output" &&
      ["open-warehouses", "customer-assignments", "cost-summary", "service-stats", "flows"].includes(activeTab.entity)
    ) {
      if (!hasFreshSolvedRun) {
        return <StaleOutputBanner onRunOptimizer={openSolveDialog} />;
      }
      const outputGrids = activeModelManifest?.capabilities?.outputGrids ?? [];
      if (!outputGrids.includes(OUTPUT_ENTITY_TO_CAPABILITY[activeTab.entity])) {
        return (
          <span className="text-muted-foreground" data-testid="tab-content-placeholder">
            {activeTab.label} — not available for this model.
          </span>
        );
      }
      const result = displayedResult;
      if (activeTab.entity === "open-warehouses")
        return (
          <OpenWarehousesTab
            result={result}
            scenarioId={currentScenario!.id}
            displayedInputs={facilityDisplayedInputs(displayedInputs)}
          />
        );
      if (activeTab.entity === "customer-assignments")
        return (
          <AssignmentsTab
            result={result}
            scenarioId={currentScenario!.id}
            displayedInputs={facilityDisplayedInputs(displayedInputs)}
          />
        );
      // T5 — Solution Summary compare (R6+R8). `scenarios` is the same-model
      // list already fetched at the top of this component
      // (`useListScenarios({ modelId })`); each row already carries the full
      // `result`/`stale` envelope (toApiScenario), so no separate
      // per-scenario fetch is needed. `isBrowsingHistory` reuses
      // `canGoForwardResult` verbatim — it's already exactly "the stepper is
      // parked on a non-latest entry" (see that variable's own comment).
      if (activeTab.entity === "cost-summary")
        return (
          <CostSummaryTab
            result={result}
            scenarioId={currentScenario!.id}
            modelId={modelId}
            scenarios={scenarios ?? []}
            isBrowsingHistory={canGoForwardResult}
          />
        );
      if (activeTab.entity === "flows") return <FlowsTab result={result} scenarioId={currentScenario!.id} />;
      // T3 wired ServiceStatsTab's modelId prop (R9's per-model distance
      // unit) but left this call site unwired — closing that gap here.
      return <ServiceStatsTab result={result} scenarioId={currentScenario!.id} modelId={modelId} />;
    }

    // Every other entry (every remaining Output grid not already handled
    // above) is a later task (C1.1-C6.1) — unchanged placeholder. Task 30
    // closed transport-coal's own Distances gap (now the Lane costs tab,
    // handled above, not this fallback); T5 (Bundle 2, Step 2b) closed
    // p-median-brazil's Warehouses/Customers/Distances gap the same way.
    return (
      <span className="text-muted-foreground" data-testid="tab-content-placeholder">
        {activeTab.label} — content wired in a later task (A1.2-A3.1).
      </span>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden scn-theme" data-testid="workspace-page">
      {/* Bundle 6 T2 (items 1/2/3) — the old 3-track grid (scenario
          selector / centered chapter summary / email+logout+stepper) is
          gone: the scenario dropdown, user-email span, and logout button
          are all removed (Workspace no longer offers logout — Landing's
          own header still does), and the chapter/description summary moves
          into the LEFT zone next to the back-arrow instead of being
          centered. What's left is a responsive two-track grid — left
          (back-arrow + chapter summary) / right (result-history stepper +
          "Save as scenario" + Run Optimizer) — that stacks to one column
          below `md` (768px) so nothing overflows a 375px viewport. */}
      {/* Bundle 3 (T6) — book-cover dark band, matching the AppShell/auth
          band motif (T1's .scnd-band utility) instead of the plain
          bg-background bar. */}
      <header className="scnd-band flex-shrink-0">
        {/* Responsive grid (resolution #2): two tracks at md+ (summary | controls),
            collapses to one stacked column below md so nothing overflows 375px. */}
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:gap-4 px-4 py-1.5 min-h-14">
          {/* Left — back + chapter/summary */}
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => navigate("/")} data-testid="button-page-back" title="Back to models"
              className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 text-[color:var(--ink-300)] hover:text-[color:var(--surface-band-fg)] hover:bg-white/10 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            {(() => {
              const activeChapter = chapterForModelId(modelId);
              if (!activeChapter) return null;
              return (
                <div data-testid="workspace-chapter-summary" className="min-w-0 truncate text-xs"
                  title={`${activeChapter.chapter} · ${activeChapter.description}`}>
                  <span className="scnd-kicker">{activeChapter.chapter}</span>
                  <span className="text-[color:var(--ink-300)]"> · </span>
                  <span className="scnd-display text-[color:var(--surface-band-fg)]">{activeChapter.description}</span>
                </div>
              );
            })()}
          </div>
          {/* Right — stepper + save-as + run (own grid track at md+; wraps/stacks
              below md, never forces horizontal overflow). */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {resultHistoryState.items.length > 0 && (
              <div className="flex items-center gap-1 text-xs">
                <button type="button" data-testid="button-result-back" disabled={!canGoBackResult} onClick={stepResultBack} title="Previous result"
                  className="w-8 h-8 rounded flex items-center justify-center border border-[color:var(--ink-500)] text-[color:var(--surface-band-fg)] hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[color:var(--ink-300)] w-10 text-center font-mono" data-testid="text-result-history-position">
                  {resultHistoryState.index + 1}/{resultHistoryState.items.length}
                </span>
                <button type="button" data-testid="button-result-forward" disabled={!canGoForwardResult} onClick={stepResultForward} title="Next result"
                  className="w-8 h-8 rounded flex items-center justify-center border border-[color:var(--ink-500)] text-[color:var(--surface-band-fg)] hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button type="button" data-testid="button-save-as-scenario" onClick={handleSaveAsScenario} disabled={createScenario.isPending}
                  className="text-xs border border-[color:var(--ink-500)] text-[color:var(--ink-300)] rounded px-2 py-1 hover:bg-white/10 hover:text-[color:var(--surface-band-fg)]">
                  Save as scenario
                </button>
              </div>
            )}
            <Button size="sm" disabled={!currentScenario} onClick={openSolveDialog} data-testid="button-run-optimizer">Run Optimizer</Button>
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
          // T9 (B2) — gate the sidebar's Outputs list by the active model's
          // real capabilities.outputGrids (Output Map itself is always
          // listed — it's not a "grid" entity and has no entry in
          // OUTPUT_ENTITY_TO_CAPABILITY). Closes the "Flows visible on
          // p-median-us" gap: renderTabContent's own content-level gate
          // (unchanged, defense-in-depth) already blocked its CONTENT, but
          // the sidebar entry itself was ungated until now.
          outputs={OUTPUT_ENTRIES.filter(
            e =>
              e.id === OUTPUT_MAP_ENTRY.id ||
              (activeModelManifest?.capabilities?.outputGrids ?? []).includes(OUTPUT_ENTITY_TO_CAPABILITY[e.id]),
          )}
          hasSolvedRun={hasFreshSolvedRun}
          activeEntityId={activeTab?.entity ?? null}
          onOpenInput={entry => openTab("input", entry)}
          onOpenOutput={entry => openTab("output", entry)}
          onRenameScenario={handleRenameScenario}
          onCloneScenario={handleCloneScenario}
          onDeleteScenario={handleDeleteScenario}
        />

        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <TabBar
            tabs={tabState.tabs}
            activeTabId={tabState.activeTabId}
            onActivate={id => dispatch({ type: "activate", id })}
            onClose={id => dispatch({ type: "close", id })}
          />
          {isEditableInputTab && !saveInLayersRow && !saveInLayersRowTransport && !saveInLayersRowTwoEchelon && (
            // A1.1 (fix) — explicit Save, replacing the earlier debounced
            // auto-save. Mirrors Studio.tsx's toolbar Save button
            // (isDirty-gated, useUpdateScenario on click) rather than
            // writing on every edit. R4 — suppressed for p-median-us's/
            // transport-coal's/two-echelon-gold-au's Input Map tabs, which
            // each render this same Save control inline in their own Layers
            // row instead (see saveInLayersRow/saveInLayersRowTransport/
            // saveInLayersRowTwoEchelon above).
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
        // R5 — the DRAFT bands (localInputs), same as p/gap/timeLimitSec
        // above: this dialog edits what the NEXT solve will use, not what's
        // currently displayed (see displayedInputs's own comment).
        distanceBands={distanceBandsFromInputs(localInputs)}
        distanceUnit={activeModelManifest?.distanceUnit ?? "mi"}
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

      {/* T9 (C1) — footer, mounted as the LAST child of this root
          `h-screen flex flex-col` column, inside `.scn-theme`. `AppFooter`
          is `flex-shrink-0` (FOOTER_H fixed height), so it simply reserves
          its own space as a flex sibling of the body region's `flex-1
          min-h-0` wrapper above — no overlap, no extra height math needed
          here (flexbox already shrinks the body region to make room). Order
          relative to the Dialogs above is irrelevant — both Dialog and
          SolveDialog render via a Radix portal to document.body, not in
          this flex flow. */}
      <AppFooter />
    </div>
  );
}
