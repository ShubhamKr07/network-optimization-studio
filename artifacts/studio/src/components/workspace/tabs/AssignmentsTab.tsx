import type { SolveResult } from "@workspace/api-client-react";
import { downloadEntityExport } from "@/lib/exportEntity";
import { formatCityState } from "@/lib/formatLocation";

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
  /** C4.11 — active model's distance unit (manifest ModelInfo.distanceUnit).
   * Optional/defaults to "mi" so existing callers stay unchanged; Chen passes "km". */
  distanceUnit?: string;
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

// Phase C, Task 3 — one row per solved edge (customer <- warehouse
// assignment). Purely a read of the already-solved result; no local state,
// no editing (output tabs are read-only, unlike the input grid tabs).
export function AssignmentsTab({ result, scenarioId, displayedInputs, locationById, distanceUnit = "mi" }: AssignmentsTabProps) {
  if (!result) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="assignments-empty">
        No solved result yet.
      </div>
    );
  }
  const codeById = displayCodeById(displayedInputs);
  const rows = aggregatedAssignmentRows(result);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Customer Assignments</span>
        <button
          type="button"
          data-testid="button-download-assignments-csv"
          className="text-xs border rounded px-2 py-1 hover:bg-muted"
          onClick={() => downloadEntityExport(scenarioId, "assignments", "csv")}
        >
          Download CSV
        </button>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b">
            <tr>
              <th className="text-left p-2">Customer</th>
              <th className="text-left p-2">Warehouse</th>
              <th className="text-right p-2">Distance ({distanceUnit})</th>
              <th className="text-right p-2">Flow</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.customerId} data-testid={`assignment-row-${r.customerId}`} className="border-b">
                <td className="p-2">{idCell(r.customerId, r.customerId, locationById)}</td>
                <td className="p-2">{idCell(r.warehouseId, codeById[r.warehouseId] ?? r.warehouseId, locationById)}</td>
                <td className="p-2 text-right font-mono">{r.distance.toFixed(1)}</td>
                <td className="p-2 text-right font-mono">{r.flow.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
