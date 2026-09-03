import type { SolveResult } from "@workspace/api-client-react";
import { downloadEntityExport } from "@/lib/exportEntity";

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
  addedWarehouses?: { id: string; displayCode?: string }[];
  addedRefineries?: { id: string; displayCode?: string }[];
}

interface OpenWarehousesTabProps {
  result: SolveResult | null;
  scenarioId: number;
  /** Optional (back-compat default: Utilization shown, ids rendered raw). */
  displayedInputs?: OpenWarehousesDisplayedInputs | null;
}

interface OpenWarehouseRow {
  warehouseId: string;
  totalFlow: number;
  utilization: number | null;
}

// Mirrors templates.ts's buildOpenWarehouseRows exactly (same "sum flow per
// distinct fromId, skip mine_to_refinery edges, join utilizationByNode"
// logic) so the on-screen table and the CSV export never disagree.
function openWarehouseRows(result: SolveResult): OpenWarehouseRow[] {
  const flowByWarehouse = new Map<string, number>();
  for (const e of result.edges) {
    if (e.leg === "mine_to_refinery") continue;
    flowByWarehouse.set(e.fromId, (flowByWarehouse.get(e.fromId) ?? 0) + e.flow);
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

export function OpenWarehousesTab({ result, scenarioId, displayedInputs }: OpenWarehousesTabProps) {
  if (!result) {
    return <div className="p-4 text-sm text-muted-foreground" data-testid="open-warehouses-empty">No solved result yet.</div>;
  }
  const rows = openWarehouseRows(result);
  // Back-compat: no `displayedInputs` at all -> show Utilization as today.
  const showUtilization = displayedInputs?.capacityMode !== "none";
  const codeById = displayCodeById(displayedInputs);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Open Warehouses</span>
        <button
          type="button"
          data-testid="button-download-open-warehouses-csv"
          className="text-xs border rounded px-2 py-1 hover:bg-muted"
          onClick={() => downloadEntityExport(scenarioId, "openWarehouses", "csv")}
        >
          Download CSV
        </button>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b">
            <tr>
              <th className="text-left p-2">Warehouse</th>
              <th className="text-right p-2">Total Flow</th>
              {showUtilization && <th className="text-right p-2">Utilization</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.warehouseId} data-testid={`open-warehouse-row-${r.warehouseId}`} className="border-b">
                <td className="p-2">{codeById[r.warehouseId] ?? r.warehouseId}</td>
                <td className="p-2 text-right font-mono">{r.totalFlow.toLocaleString()}</td>
                {showUtilization && (
                  <td className="p-2 text-right font-mono">{r.utilization != null ? `${Math.round(r.utilization)}%` : "—"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
