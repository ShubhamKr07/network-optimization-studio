import { useMemo } from "react";
import type { SolveResult } from "@workspace/api-client-react";
import { useExport } from "@/contexts/ExportContext";
import { formatCityState } from "@/lib/formatLocation";
import { EntityIdCell } from "@/components/tables/EntityIdCell";
import { DataTable } from "@/components/data-table/DataTable";
import { DownloadMenu } from "@/components/data-table/DownloadMenu";
import type { ColumnDef } from "@/components/data-table/types";
import type { EntityIdentity } from "@/lib/entityIdentity";
import { useDisplayUnit } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";

// B2.2-T6 — same snapshot shape as OpenWarehousesTab.tsx's
// OpenWarehousesDisplayedInputs (kept as a separate local declaration per
// file rather than a shared import, matching this task's file-disjoint
// scope). Deliberately NOT `localInputs` — must be the last-SAVED inputs the
// solved `result` reflects, not an unsaved edit (snapshot invariant).
export interface AssignmentsDisplayedInputs {
  addedWarehouses?: { id: string; displayCode?: string }[];
  addedRefineries?: { id: string; displayCode?: string }[];
}

interface AssignmentsTabProps {
  result: SolveResult | null;
  scenarioId: number;
  /** Optional (back-compat default: ids rendered raw). */
  displayedInputs?: AssignmentsDisplayedInputs | null;
  /** JADE/Chen-only — id -> {city, state} (base dataset ∪ added entities),
   * built by Workspace.tsx's `jadeLocationMapFromInputs`/
   * `chenLocationMapFromInputs` off the SAME snapshot `displayedInputs`
   * reflects. When present, both the Customer and Warehouse cells show the
   * city (JADE: "City, ST"; Chen: city-only, via formatCityState()) as the
   * primary label with the id/displayCode as a mono sub-label (mirrors
   * JadeDistancesTab.tsx). Absent for every other model (undefined) ->
   * unchanged id-only rendering. */
  locationById?: Record<string, { city: string; state: string }>;
  /** workspace-fixups-2, T10 (item 2) — the snapshot-matched identity
   * projection (`buildEntityIdentityById`, T3), covering BOTH base dataset
   * rows AND scenario-added rows (customers included — unlike `codeById`
   * below, which only merges added warehouses/refineries) keyed by canonical
   * id. Takes PRECEDENCE over `locationById`/`codeById` when an entry exists
   * (the compatibility resolver — see `resolveCell`). Optional/`undefined`
   * for every pre-existing call site until INT wires it, so this component's
   * output is byte-unchanged for any caller that never passes it. Already a
   * "rich" table (shows both id and location whenever `locationById` has an
   * entry, at any row count) — no `>10` gate applied. */
  identityById?: Record<string, EntityIdentity>;
  /** C4.11 — active model's CANONICAL distance unit (manifest
   * ModelInfo.distanceUnit). chen-bands-units, Part D "No fallback unit —
   * reads": `undefined`/`null` means the canonical unit hasn't resolved yet
   * — the Distance column and every row's value show a loading placeholder
   * instead of ever guessing "mi" (Chen is km — a guess would render a
   * correct number under a wrong label). */
  distanceUnit?: CanonicalUnit | null;
}

// Merges addedWarehouses ∪ addedRefineries into one id -> displayCode
// lookup, mirroring DistancesTab.tsx's existing `displayCodeById` pattern.
// Absent `displayedInputs` (back-compat) yields an empty map.
function displayCodeById(displayedInputs: AssignmentsDisplayedInputs | null | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  const sources = [displayedInputs?.addedWarehouses ?? [], displayedInputs?.addedRefineries ?? []];
  for (const rows of sources) {
    for (const row of rows) {
      if (row.displayCode) map[row.id] = row.displayCode;
    }
  }
  return map;
}

// jade-T14 — legs that carry facility->demand ("customer assignment") flow.
// Single-echelon models (p-median-us/brazil, transport-coal) have no `leg`
// field at all and their edges ARE the assignment set already; those pass
// straight through unfiltered (back-compat, byte-identical to before this
// task). Two-echelon models tag every edge with a leg — only the
// facility->demand leg belongs here (Ch10's `refinery_to_customer`, Ch9
// JADE's `warehouse_to_customer`); the source->facility leg
// (`mine_to_refinery`/`plant_to_warehouse`) belongs to FlowsTab, not here.
// Semantic classification, never a literal Chapter-10-only allowlist.
const FACILITY_TO_DEMAND_LEGS = new Set<string>(["refinery_to_customer", "warehouse_to_customer"]);

interface AssignmentRow {
  customerId: string;
  warehouseId: string;
  distance: number;
  flow: number;
}

// jade-T14 — one row per customer. Per spec, JADE's own warehouse_to_customer
// edges are already aggregated per customer at the envelope layer (single-
// source: one serving warehouse per customer, flow = total tons across all
// products), so this aggregation is a defensive safety net rather than the
// primary mechanism — it never changes p-median-us/Ch10's existing one-edge-
// per-customer output (each edge already keys to a distinct `toId` there).
function aggregatedAssignmentRows(result: SolveResult): AssignmentRow[] {
  const hasLegs = result.edges.some(e => e.leg != null);
  const edges = hasLegs
    ? result.edges.filter(e => e.leg != null && FACILITY_TO_DEMAND_LEGS.has(e.leg))
    : result.edges;

  const byCustomer = new Map<string, AssignmentRow>();
  for (const e of edges) {
    const existing = byCustomer.get(e.toId);
    if (existing) {
      existing.flow += e.flow;
    } else {
      byCustomer.set(e.toId, { customerId: e.toId, warehouseId: e.fromId, distance: e.distance, flow: e.flow });
    }
  }
  return [...byCustomer.values()];
}

// JADE-only "City, ST" primary + id/displayCode mono sub-label, mirroring
// JadeDistancesTab.tsx's From/To cell. Falls back to the raw id/displayCode
// (unchanged) when `locationById` is absent or has no entry for this id.
function idCell(id: string, displayLabel: string, locationById: Record<string, { city: string; state: string }> | undefined) {
  const loc = locationById?.[id];
  if (!loc) return displayLabel;
  return (
    <div className="flex flex-col">
      <span>{formatCityState(loc.city, loc.state)}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{displayLabel}</span>
    </div>
  );
}

// workspace-fixups-2, T10 (item 2) — compatibility resolver: prefer the new
// `identityById` entry (covers added CUSTOMERS too, unlike the pre-existing
// `idCell`/`codeById` path above, which never resolved a customer's display
// code at all — only `fromId` warehouses/refineries did); else delegate to
// the pre-existing, UNTOUCHED `idCell` function so `identityById` unset
// renders byte-identical output to before this task.
function resolveCell(
  id: string,
  fallbackDisplayLabel: string,
  locationById: Record<string, { city: string; state: string }> | undefined,
  identityById: Record<string, EntityIdentity> | undefined,
) {
  const identity = identityById?.[id];
  if (identity) {
    return (
      <EntityIdCell
        entityId={id}
        displayId={identity.displayId}
        location={(identity.city || identity.state) ? { city: identity.city, state: identity.state } : undefined}
      />
    );
  }
  return idCell(id, fallbackDisplayLabel, locationById);
}

// SCU-2.P3.2 — the raw text a filter matches for one entity cell (never the
// rendered JSX): "City, ST displayId" when a location is known, else the
// display id — the same accessor shape OpenWarehousesTab's warehouse filter uses.
function entityFilterText(
  id: string,
  fallbackDisplayLabel: string,
  locationById: Record<string, { city: string; state: string }> | undefined,
  identityById: Record<string, EntityIdentity> | undefined,
): string {
  const identity = identityById?.[id];
  if (identity) {
    return identity.city || identity.state ? `${formatCityState(identity.city, identity.state)} ${identity.displayId}` : identity.displayId;
  }
  const loc = locationById?.[id];
  return loc ? `${formatCityState(loc.city, loc.state)} ${fallbackDisplayLabel}` : fallbackDisplayLabel;
}

// Phase C, Task 3 — one row per solved edge (customer <- warehouse
// assignment). Purely a read of the already-solved result; no local state,
// no editing (output tabs are read-only, unlike the input grid tabs).
// SCU-2.P3.2 (spec B2.1/B2.2/B2.4) — rendered by the shared DataTable: filter
// menu > 10 rows, pager > 50 (p-median-us's 200 customers now page), number
// columns centred, Download ▾ CSV/JSON (server `assignments`).
export function AssignmentsTab({ result, scenarioId, displayedInputs, locationById, identityById, distanceUnit }: AssignmentsTabProps) {
  const unit = useDisplayUnit();
  const { download, disabledReasonFor } = useExport();
  const canonicalResolved = distanceUnit != null;
  const distanceHeaderLabel = canonicalResolved ? `Distance (${unit.effectiveUnit(distanceUnit)})` : "Distance";
  const codeById = useMemo(() => displayCodeById(displayedInputs), [displayedInputs]);
  const rows = useMemo(() => (result ? aggregatedAssignmentRows(result) : []), [result]);

  const columns = useMemo<ColumnDef<AssignmentRow>[]>(() => [
    {
      id: "customer",
      header: "Customer",
      kind: "text",
      value: r => entityFilterText(r.customerId, r.customerId, locationById, identityById),
      cell: r => resolveCell(r.customerId, r.customerId, locationById, identityById),
    },
    {
      id: "warehouse",
      header: "Warehouse",
      kind: "text",
      value: r => entityFilterText(r.warehouseId, codeById[r.warehouseId] ?? r.warehouseId, locationById, identityById),
      cell: r => resolveCell(r.warehouseId, codeById[r.warehouseId] ?? r.warehouseId, locationById, identityById),
    },
    {
      id: "distance",
      header: distanceHeaderLabel,
      filterLabel: distanceHeaderLabel,
      kind: "number",
      cellClassName: "font-mono",
      // Filter range is in the DISPLAY unit — the number the student reads in the cell.
      value: r => (canonicalResolved ? unit.toDisplay(r.distance, distanceUnit) : null),
      cell: r => (canonicalResolved ? unit.toDisplay(r.distance, distanceUnit).toFixed(1) : "—"),
    },
    {
      id: "flow",
      header: "Flow",
      kind: "number",
      cellClassName: "font-mono",
      value: r => r.flow,
      cell: r => r.flow.toLocaleString(),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [codeById, locationById, identityById, distanceHeaderLabel, canonicalResolved, distanceUnit, unit.pref]);

  if (!result) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="assignments-empty">
        No solved result yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="overflow-auto flex-1 p-2">
        <DataTable<AssignmentRow>
          rows={rows}
          rowKey={r => r.customerId}
          columns={columns}
          ctx={{ readOnly: true, demandEditable: false }}
          testIds={{
            row: r => `assignment-row-${r.customerId}`,
            pager: "assignments-pager",
            pagerPrev: "button-assignments-prev",
            pagerNext: "button-assignments-next",
            pageIndicator: "assignments-page-indicator",
          }}
          toolbar={{
            download: (
              <DownloadMenu
                testId="button-download-assignments"
                itemTestIds={{ csv: "button-download-assignments-csv", json: "button-download-assignments-json" }}
                onDownload={format => download("assignments", format)}
                disabledReason={disabledReasonFor("assignments")}
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
