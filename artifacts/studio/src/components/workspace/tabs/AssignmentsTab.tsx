import type { SolveResult } from "@workspace/api-client-react";
import { downloadEntityExport } from "@/lib/exportEntity";

interface AssignmentsTabProps {
  result: SolveResult | null;
  scenarioId: number;
}

// Phase C, Task 3 — one row per solved edge (customer <- warehouse
// assignment). Purely a read of the already-solved result; no local state,
// no editing (output tabs are read-only, unlike the input grid tabs).
export function AssignmentsTab({ result, scenarioId }: AssignmentsTabProps) {
  if (!result) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-testid="assignments-empty">
        No solved result yet.
      </div>
    );
  }

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
              <th className="text-right p-2">Distance (mi)</th>
              <th className="text-right p-2">Flow</th>
            </tr>
          </thead>
          <tbody>
            {result.edges.map(e => (
              <tr key={e.toId} data-testid={`assignment-row-${e.toId}`} className="border-b">
                <td className="p-2">{e.toId}</td>
                <td className="p-2">{e.fromId}</td>
                <td className="p-2 text-right">{e.distance.toFixed(1)}</td>
                <td className="p-2 text-right">{e.flow.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
