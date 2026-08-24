import type { SolveResult } from "@workspace/api-client-react";
import { downloadEntityExport } from "@/lib/exportEntity";

interface FlowsTabProps {
  result: SolveResult | null;
  scenarioId: number;
}

// C6.1 — the transport-coal/two-echelon equivalent of Customer Assignments.
// Mirrors templates.ts's buildFlowRows filter exactly (exclude
// refinery_to_customer edges — those belong to AssignmentsTab) so the
// on-screen table and the CSV export never disagree.
function flowRows(result: SolveResult) {
  return result.edges.filter(e => e.leg !== "refinery_to_customer");
}

export function FlowsTab({ result, scenarioId }: FlowsTabProps) {
  if (!result) {
    return <div className="p-4 text-sm text-muted-foreground" data-testid="flows-empty">No solved result yet.</div>;
  }
  const rows = flowRows(result);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Flows</span>
        <button
          type="button"
          data-testid="button-download-flows-csv"
          className="text-xs border rounded px-2 py-1 hover:bg-muted"
          onClick={() => downloadEntityExport(scenarioId, "flows", "csv")}
        >
          Download CSV
        </button>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b">
            <tr>
              <th className="text-left p-2">From</th>
              <th className="text-left p-2">To</th>
              <th className="text-right p-2">Distance (mi)</th>
              <th className="text-right p-2">Flow</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(e => (
              <tr key={`${e.fromId}-${e.toId}`} data-testid={`flow-row-${e.fromId}-${e.toId}`} className="border-b">
                <td className="p-2">{e.fromId}</td>
                <td className="p-2">{e.toId}</td>
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
