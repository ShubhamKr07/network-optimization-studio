import { useMemo } from "react";
import type { SolveResult } from "@workspace/api-client-react";
import { useExport } from "@/contexts/ExportContext";
import { formatCityState } from "@/lib/formatLocation";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import type { EntityIdentity } from "@/lib/entityIdentity";

// B2.2-T6 — a read-only SNAPSHOT of the fields this tab needs from
// Scenario.inputs, passed by Workspace.tsx (T9 wires the real call site;
// this stays optional so this file's own commit typechecks standalone).
// Deliberately NOT `localInputs` — this must be the last-SAVED inputs the
// solved `result` actually reflects, not any unsaved in-progress edit
// (snapshot invariant). `addedWarehouses`/`addedRefineries` share the same
// `aw-` uid family (two-echelon's added facilities are refineries, not
// warehouses) so both are merged into one id -> displayCode lookup, mirroring
// DistancesTab.tsx's existing `displayCodeById` pattern.
export interface OpenWarehousesDisplayedInputs {
  capacityMode?: string;
  // jade-T14 — Chapter 9 JADE only. Mirrors the manifest's own
  // `capabilities.capacityModes` array (always present on the real
  // ModelInfo); optional here so pre-existing call sites that never thread
  // it keep behaving exactly as before this task. An explicit EMPTY array
  // is semantically distinct from "not passed at all" — JADE's uncapacitated
  // model has no percentage-utilization denominator (§2.1), so its Open
  // Warehouses grid shows demand-served tons instead of a "%" column. Do not
  // conflate this with `capacityMode === "none"` above (p-median-us's own
  // uncapacitated mode, which hides the column entirely with no
  // replacement) — JADE explicitly wants a value shown, just not a percent.
  capacityModes?: string[];
  addedWarehouses?: { id: string; displayCode?: string }[];
  addedRefineries?: { id: string; displayCode?: string }[];
}

interface OpenWarehousesTabProps {
  result: SolveResult | null;
  scenarioId: number;
  /** Optional (back-compat default: Utilization shown, ids rendered raw). */
  displayedInputs?: OpenWarehousesDisplayedInputs | null;
  /** JADE/Chen-only — id -> {city, state} (base dataset ∪ added entities),
   * built by Workspace.tsx's `jadeLocationMapFromInputs`/
   * `chenLocationMapFromInputs` off the SAME snapshot `displayedInputs`
   * reflects. When present, the Warehouse cell shows the city (JADE: "City,
   * ST"; Chen: city-only, via formatCityState()) as the primary label with
   * the id/displayCode as a mono sub-label (mirrors JadeDistancesTab.tsx).
   * Absent for every other model (undefined) -> unchanged id-only rendering. */
  locationById?: Record<string, { city: string; state: string }>;
  /** workspace-fixups-2, T10 (item 2) — the snapshot-matched identity
   * projection (`buildEntityIdentityById`, T3), covering BOTH base dataset
   * rows AND scenario-added rows keyed by canonical id. When an entry exists
   * for a given warehouse id, it takes PRECEDENCE over `locationById`/the
   * `addedWarehouses`/`addedRefineries` derived `codeById` below (the
   * compatibility resolver — see `resolveWarehouseIdentity`). Optional/
   * `undefined` for every pre-existing call site until INT wires it, so this
   * component's output is byte-unchanged for any caller that never passes
   * it. */
  identityById?: Record<string, EntityIdentity>;
}

interface OpenWarehouseRow {
  warehouseId: string;
  totalFlow: number;
  utilization: number | null;
}

// Mirrors templates.ts's buildOpenWarehouseRows exactly (same "sum flow per
// distinct fromId, skip source->facility legs, join utilizationByNode"
// logic) so the on-screen table and the CSV export never disagree.
function openWarehouseRows(result: SolveResult): OpenWarehouseRow[] {
  const flowByWarehouse = new Map<string, number>();
  for (const e of result.edges) {
    // jade-T14 — plant_to_warehouse joins mine_to_refinery here: both are
    // source->facility legs whose `fromId` is the SOURCE (plant/mine), not
    // the warehouse/refinery — summing them into flowByWarehouse would
    // fabricate a row keyed by a plant/mine id.
    if (e.leg === "mine_to_refinery" || e.leg === "plant_to_warehouse") continue;
    flowByWarehouse.set(e.fromId, (flowByWarehouse.get(e.fromId) ?? 0) + e.flow);
  }
  // jade-T14 — metrics.openFacilityIds (Chapter 9 JADE) is authoritative and
  // includes a forced-open warehouse serving zero outbound flow, which the
  // edge-derived map above would silently omit entirely (a warehouse with no
  // outbound edges never appears as a `fromId`). Purely additive: other
  // models never populate this optional field, so their row set is
  // byte-identical to before this task.
  for (const id of result.metrics.openFacilityIds ?? []) {
    if (!flowByWarehouse.has(id)) flowByWarehouse.set(id, 0);
  }
  const utilByWarehouse = new Map((result.metrics.utilizationByNode ?? []).map(u => [u.warehouseId, u.utilization]));
  return [...flowByWarehouse.entries()].map(([warehouseId, totalFlow]) => ({
    warehouseId,
    totalFlow,
    utilization: utilByWarehouse.get(warehouseId) ?? null,
  }));
}

// Merges addedWarehouses ∪ addedRefineries into one id -> displayCode
// lookup. Absent `displayedInputs` (back-compat) yields an empty map, so
// every id falls through to its raw value unchanged.
function displayCodeById(displayedInputs: OpenWarehousesDisplayedInputs | null | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  const sources = [displayedInputs?.addedWarehouses ?? [], displayedInputs?.addedRefineries ?? []];
  for (const rows of sources) {
    for (const row of rows) {
      if (row.displayCode) map[row.id] = row.displayCode;
    }
  }
  return map;
}

// workspace-fixups-2, T10 (item 2) — compatibility resolver: prefer the new
// `identityById` entry, else fall back to the EXISTING `codeById`/
// `locationById` sources unchanged (so `identityById` unset produces
// byte-identical output to before this task — the no-regression contract).
// `OpenWarehousesTab` is the item-2 REFERENCE table — already renders the
// stacked City,State + mono displayId cell at every row count, so no `>10`
// gate is applied here (matches the spec's "already-rich, keep rich at
// every count" bucket).
function resolveWarehouseIdentity(
  id: string,
  codeById: Record<string, string>,
  locationById: Record<string, { city: string; state: string }> | undefined,
  identityById: Record<string, EntityIdentity> | undefined,
): { displayId: string; location?: { city: string; state: string } } {
  const identity = identityById?.[id];
  if (identity) {
    return {
      displayId: identity.displayId,
      location: (identity.city || identity.state) ? { city: identity.city, state: identity.state } : undefined,
    };
  }
  return { displayId: codeById[id] ?? id, location: locationById?.[id] };
}

// SCU-2.P3.1 (spec B2.1/B2.2/B2.4) — rendered by the shared DataTable: filter
// menu on every model once > 10 rows (the JADE-only `enableFilters` opt-in is
// gone), pager > 50, number columns centred, Download ▾ CSV/JSON (server).
export function OpenWarehousesTab({ result, scenarioId, displayedInputs, locationById, identityById }: OpenWarehousesTabProps) {
  const { download, disabledReasonFor } = useExport();
  const rows = useMemo(() => (result ? openWarehouseRows(result) : []), [result]);
  // jade-T14 — an explicit EMPTY `capacityModes` array (JADE's uncapacitated,
  // demand-served-in-tons model, manifest `capacityModes: []`) means "show
  // Demand Served, never a %"; `capacityModes` absent falls through to the
  // original `capacityMode`-string gate unchanged.
  const showDemandServed = displayedInputs?.capacityModes != null && displayedInputs.capacityModes.length === 0;
  // Back-compat: no `displayedInputs` at all -> show Utilization as today.
  const showUtilization = !showDemandServed && displayedInputs?.capacityMode !== "none";
  const codeById = useMemo(() => displayCodeById(displayedInputs), [displayedInputs]);

  const columns = useMemo<ColumnDef<OpenWarehouseRow>[]>(() => {
    const identity = (r: OpenWarehouseRow) => resolveWarehouseIdentity(r.warehouseId, codeById, locationById, identityById);
    const cols: ColumnDef<OpenWarehouseRow>[] = [
      {
        id: "warehouse",
        header: "Warehouse",
        kind: "text",
        // Pinned: today's descriptor is free text (matrix §5.5), never a select.
        filter: "text",
        value: r => {
          const { displayId, location } = identity(r);
          return location ? `${formatCityState(location.city, location.state)} ${displayId}` : displayId;
        },
        cell: r => {
          const { displayId, location } = identity(r);
          return <EntityIdCell entityId={r.warehouseId} displayId={displayId} location={location} />;
        },
      },
      {
        id: "flow",
        header: showDemandServed ? "Demand Served" : "Total Flow",
        kind: "number",
        cellClassName: "font-mono",
        value: r => r.totalFlow,
        cell: r => r.totalFlow.toLocaleString(),
      },
    ];
    if (showUtilization) {
      cols.push({
        id: "utilization",
        header: "Utilization",
        kind: "number",
        cellClassName: "font-mono",
        value: r => r.utilization,
        cell: r => (r.utilization != null ? `${Math.round(r.utilization)}%` : "—"),
      });
    }
    return cols;
  }, [codeById, locationById, identityById, showDemandServed, showUtilization]);

  if (!result) {
    return <div className="p-4 text-sm text-muted-foreground" data-testid="open-warehouses-empty">No solved result yet.</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="overflow-auto flex-1 p-2">
        <DataTable<OpenWarehouseRow>
          rows={rows}
          rowKey={r => r.warehouseId}
          columns={columns}
          testIds={{
            row: r => `open-warehouse-row-${r.warehouseId}`,
            pager: "open-warehouses-pager",
            pagerPrev: "button-open-warehouses-prev",
            pagerNext: "button-open-warehouses-next",
            pageIndicator: "open-warehouses-page-indicator",
          }}
          toolbar={{
            download: (
              <DownloadMenu
                testId="button-download-open-warehouses"
                itemTestIds={{ csv: "button-download-open-warehouses-csv", json: "button-download-open-warehouses-json", xlsx: "button-download-open-warehouses-xlsx" }}
                onDownload={format => download("openWarehouses", format)}
                disabledReason={disabledReasonFor("openWarehouses")}
              />
            ),
            // SCU-2.P3 (user decision 2026-10-17) — output tables keep Download on the right (B1.4).
            downloadAlign: "right",
          }}
        />
      </div>
    </div>
  );
}
