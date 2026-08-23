import type { SolveResult } from "@workspace/api-client-react";
import { downloadEntityExport } from "@/lib/exportEntity";

interface CostSummaryTabProps {
  result: SolveResult | null;
  scenarioId: number;
}

export function CostSummaryTab({ result, scenarioId }: CostSummaryTabProps) {
  if (!result) {
    return <div className="p-4 text-sm text-muted-foreground" data-testid="cost-summary-empty">No solved result yet.</div>;
  }

  const rows: Array<[string, string]> = [
    ["Objective", result.objective.toLocaleString()],
    ["Weighted avg. distance", result.metrics.weightedAvgDistance != null ? `${result.metrics.weightedAvgDistance.toFixed(1)} mi` : "—"],
    ["Runtime", `${result.runTimeSec.toFixed(2)}s`],
    ["Quality", result.quality],
    ["Solver", result.solverUsed],
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Cost Summary</span>
        <button
          type="button"
          data-testid="button-download-cost-summary-csv"
          className="text-xs border rounded px-2 py-1 hover:bg-muted"
          onClick={() => downloadEntityExport(scenarioId, "costSummary", "csv")}
        >
          Download CSV
        </button>
      </div>
      <dl className="p-4 space-y-2 text-sm" data-testid="cost-summary-list">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between border-b pb-1">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium" data-testid={`cost-summary-value-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
