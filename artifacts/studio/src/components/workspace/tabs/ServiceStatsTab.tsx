import type { SolveResult } from "@workspace/api-client-react";
import { downloadEntityExport } from "@/lib/exportEntity";

interface ServiceStatsTabProps {
  result: SolveResult | null;
  scenarioId: number;
}

// Reads the solver's own metrics.bandCoverage directly (a point-in-time
// snapshot of the actual solved result) — deliberately NOT the interactive
// client-recomputed-from-edges band display the Output Map / Reports tab
// use, which lets a student re-color/re-bucket post-solve without
// re-solving (E1.1). This tab shows what the solve ACTUALLY achieved.
export function ServiceStatsTab({ result, scenarioId }: ServiceStatsTabProps) {
  if (!result) {
    return <div className="p-4 text-sm text-muted-foreground" data-testid="service-stats-empty">No solved result yet.</div>;
  }
  const bandCoverage = result.metrics.bandCoverage ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between p-2 border-b flex-shrink-0">
        <span className="text-sm font-medium">Service Stats</span>
        <button
          type="button"
          data-testid="button-download-service-stats-csv"
          className="text-xs border rounded px-2 py-1 hover:bg-muted"
          onClick={() => downloadEntityExport(scenarioId, "serviceStats", "csv")}
        >
          Download CSV
        </button>
      </div>
      {bandCoverage.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground" data-testid="service-stats-no-bands">No band coverage data for this solve.</div>
      ) : (
        <div className="p-4 space-y-2">
          {bandCoverage.map(b => (
            <div key={b.band} data-testid={`service-stats-band-${b.band}`} className="flex items-center gap-2 text-sm">
              <span className="w-24 flex-shrink-0">≤ {b.band} mi</span>
              <div className="flex-1 bg-muted rounded h-3 overflow-hidden">
                <div className="bg-primary h-full" style={{ width: `${Math.min(b.percent, 100)}%` }} />
              </div>
              <span className="w-10 text-right">{b.percent}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
