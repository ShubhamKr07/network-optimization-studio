import type { SolveResult } from "@workspace/api-client-react";
import { useListModels } from "@workspace/api-client-react";
import { downloadEntityExport } from "@/lib/exportEntity";

interface ServiceStatsTabProps {
  result: SolveResult | null;
  scenarioId: number;
  // Optional: callers that don't yet thread the active model id through
  // (pre-existing call sites) fall back to "mi" below, same as before this
  // change — this prop is additive, not a breaking requirement.
  modelId?: string;
}

// Reads the solver's own metrics.bandCoverage directly (a point-in-time
// snapshot of the actual solved result) — deliberately NOT the interactive
// client-recomputed-from-edges band display the Output Map / Reports tab
// use, which lets a student re-color/re-bucket post-solve without
// re-solving (E1.1). This tab shows what the solve ACTUALLY achieved.
export function ServiceStatsTab({ result, scenarioId, modelId }: ServiceStatsTabProps) {
  // R9 — distanceUnit is sourced from the model manifest (G1.1) via
  // GET /api/models, defaulting to "mi" both when the manifest field is
  // absent (T2's ModelInfo.distanceUnit may not have landed yet, or the
  // model simply hasn't set one — the public boundary already defaults
  // absent -> "mi") and while models/modelId haven't resolved yet. Cast
  // rather than a hard type dependency on ModelInfo.distanceUnit so this
  // compiles independent of T2's landing order (see plan Task T3 note).
  const { data: models } = useListModels();
  const activeModel = models?.find(m => m.id === modelId) as
    | { distanceUnit?: string }
    | undefined;
  const distanceUnit = activeModel?.distanceUnit ?? "mi";

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
      {/* R9 — demand-weighted, not a customer count: metrics.bandCoverage[].percent
          is computed from flow/demand, so the label says so explicitly. */}
      <p className="px-2 pt-2 text-xs text-muted-foreground flex-shrink-0">
        Percent of demand served within the selected distance bands
      </p>
      {bandCoverage.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground" data-testid="service-stats-no-bands">No band coverage data for this solve.</div>
      ) : (
        <div className="p-4 space-y-2">
          {/* jade-T14 — model-integration-precheck.md Gate 4: a `band: -1`
              entry (Ch10's own existing overflow convention, extended to
              Chapter 9 JADE) is flow beyond every configured boundary and
              gets a distinct "> {last boundary}" label — never rendered as
              "≤ -1", and never folded into the last real boundary's row. The
              boundary shown is derived from the OTHER rows in this same
              array (not hardcoded to 1600), so this works for any model's
              band configuration. */}
          {(() => {
            const maxBoundary = bandCoverage.reduce((max, b) => (b.band !== -1 && b.band > max ? b.band : max), 0);
            return bandCoverage.map(b => {
              const isOverflow = b.band === -1;
              const label = isOverflow ? `> ${maxBoundary} ${distanceUnit}` : `≤ ${b.band} ${distanceUnit}`;
              return (
                <div key={b.band} data-testid={`service-stats-band-${b.band}`} className="flex items-center gap-2 text-sm">
                  <span className="w-24 flex-shrink-0 font-mono">{label}</span>
                  <div className="flex-1 bg-muted rounded h-3 overflow-hidden">
                    <div className="bg-primary h-full" style={{ width: `${Math.min(b.percent, 100)}%` }} />
                  </div>
                  <span className="w-10 text-right font-mono">{b.percent}%</span>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
