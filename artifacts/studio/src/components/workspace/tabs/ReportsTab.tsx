import type { Scenario } from "@workspace/api-client-react";
import { computeBandCoverage, type BandEdge } from "@/lib/bands";

interface ReportsTabProps {
  baseline: Pick<Scenario, "id" | "name" | "result"> | null;
  current: Pick<Scenario, "id" | "name" | "result"> | null;
  bands: number[];
}

function formatDelta(baselineValue: number, currentValue: number): string {
  const delta = currentValue - baselineValue;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toLocaleString()}`;
}

// Band semantics stay exclusive at the lib/bands.ts layer (Round 3
// decision) — this is the one place Phase C renders a CUMULATIVE rollup
// (running sum over the exclusive bins) on top of it, per the source
// plan's C2.1 note: the wireframe reads bands cumulatively
// ("% demand within <=250/<=500/<=750 mi"), but the underlying computation
// stays exclusive everywhere else (map coloring, Service Stats tab).
function cumulativeBandCoverage(exclusive: ReturnType<typeof computeBandCoverage>) {
  let running = 0;
  return exclusive.map(b => {
    running += b.percent;
    return { band: b.band, percent: running };
  });
}

export function ReportsTab({ baseline, current, bands }: ReportsTabProps) {
  if (!current?.result) {
    return <div className="p-4 text-sm text-muted-foreground" data-testid="reports-empty">No solved result to report on yet.</div>;
  }

  const baselineResult = baseline?.result ?? null;
  const currentResult = current.result;

  const bandEdges: BandEdge[] = currentResult.edges.map(e => ({ distance: e.distance, flow: e.flow }));
  const cumulative = cumulativeBandCoverage(computeBandCoverage(bandEdges, bands));

  return (
    <div className="p-4 space-y-6 overflow-auto h-full" data-testid="reports-tab">
      <section>
        <h3 className="text-sm font-semibold mb-2">Cost Breakdown</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-1">Metric</th>
              <th className="p-1 text-right">Baseline</th>
              <th className="p-1 text-right">Current</th>
              <th className="p-1 text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="p-1">Objective</td>
              <td className="p-1 text-right" data-testid="report-objective-baseline">{baselineResult ? baselineResult.objective.toLocaleString() : "—"}</td>
              <td className="p-1 text-right" data-testid="report-objective-current">{currentResult.objective.toLocaleString()}</td>
              <td className="p-1 text-right" data-testid="report-objective-delta">
                {baselineResult ? formatDelta(baselineResult.objective, currentResult.objective) : "—"}
              </td>
            </tr>
            <tr className="border-b">
              <td className="p-1">Weighted avg. distance</td>
              <td className="p-1 text-right">{baselineResult?.metrics.weightedAvgDistance?.toFixed(1) ?? "—"}</td>
              <td className="p-1 text-right">{currentResult.metrics.weightedAvgDistance?.toFixed(1) ?? "—"}</td>
              <td className="p-1 text-right">
                {baselineResult?.metrics.weightedAvgDistance != null && currentResult.metrics.weightedAvgDistance != null
                  ? formatDelta(baselineResult.metrics.weightedAvgDistance, currentResult.metrics.weightedAvgDistance)
                  : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Service Level (cumulative)</h3>
        <div className="space-y-2">
          {cumulative.map(b => (
            <div key={b.band} data-testid={`report-band-${b.band}`} className="flex items-center gap-2 text-sm">
              <span className="w-28 flex-shrink-0">Within {b.band} mi</span>
              <div className="flex-1 bg-muted rounded h-3 overflow-hidden">
                <div className="bg-primary h-full" style={{ width: `${Math.min(b.percent, 100)}%` }} />
              </div>
              <span className="w-10 text-right">{b.percent}%</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Warehouse Utilization</h3>
        <div className="space-y-2">
          {(currentResult.metrics.utilizationByNode ?? []).map(u => (
            <div key={u.warehouseId} data-testid={`report-utilization-${u.warehouseId}`} className="flex items-center gap-2 text-sm">
              <span className="w-28 flex-shrink-0">{u.warehouseId}</span>
              <div className="flex-1 bg-muted rounded h-3 overflow-hidden">
                <div className="bg-primary h-full" style={{ width: `${Math.min(u.utilization * 100, 100)}%` }} />
              </div>
              <span className="w-10 text-right">{Math.round(u.utilization * 100)}%</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
