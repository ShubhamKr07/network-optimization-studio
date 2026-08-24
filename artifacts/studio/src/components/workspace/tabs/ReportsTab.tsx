import { useState } from "react";
import { useCompareScenarios } from "@workspace/api-client-react";
import type { ErrorEnvelope, CompareRejection, Scenario } from "@workspace/api-client-react";
import { computeBandCoverage, type BandEdge } from "@/lib/bands";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { diffInputs, diffOutputs, type DiffScenarioInputs, type DiffScenarioResult } from "@/lib/compareDiff";
import { pickBaseline } from "@/lib/pickBaseline";

const MIN_COMPARE = 2;
const MAX_COMPARE = 4;

export interface ReportsCompareCandidate {
  id: number;
  name: string;
  modelId: string;
}

interface ReportsTabProps {
  baseline: Pick<Scenario, "id" | "name" | "result"> | null;
  current: Pick<Scenario, "id" | "name" | "result"> | null;
  bands: number[];
  /**
   * Candidate scenarios for the "Compare scenarios" picker (C3.1 — folds
   * F2.1's compare capability into Reports instead of a separate page).
   * Callers (Workspace.tsx) source this from `useListScenarios({ modelId })`,
   * which is already model-scoped — `modelId` here is a defensive second
   * filter so this component doesn't silently rely on the caller always
   * pre-scoping (Global Constraints: "your UI should filter to the right
   * model client-side too, not just rely on the 422").
   */
  availableScenarios?: ReportsCompareCandidate[];
  modelId?: string;
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

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

// C3.1 — folds F2.1's scenario-compare capability into Reports rather than
// keeping it a separate page. Deliberately simpler than Compare.tsx's own
// picker: no per-row needs-solving/stale chips (this component's
// `availableScenarios` prop only carries id/name/modelId, not result/stale
// — the compare endpoint's own solved-and-not-stale 422 is the guard here,
// surfaced via a toast), just enough to pick 2-4 scenarios and see a diff.
function CompareSection({
  current,
  availableScenarios,
  modelId,
}: {
  current: { id: number };
  availableScenarios: ReportsCompareCandidate[];
  modelId?: string;
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [compareScenarios, setCompareScenarios] = useState<Scenario[] | null>(null);
  const compareMutation = useCompareScenarios();

  const candidates = availableScenarios.filter(
    s => s.id !== current.id && (modelId == null || s.modelId === modelId),
  );

  function toggle(id: number) {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  }

  function handleRunCompare() {
    compareMutation.mutate(
      { data: { scenarioIds: selectedIds } },
      {
        onSuccess: (result: { scenarios: Scenario[] }) => setCompareScenarios(result.scenarios),
        onError: (err: unknown) => {
          const data = (err as { data?: ErrorEnvelope | CompareRejection | string | null })?.data;
          const errorMessage = data && typeof data === "object" ? data.error : undefined;
          toast({
            title: "Comparison failed",
            description: errorMessage ?? "Could not compare these scenarios.",
            variant: "destructive",
          });
        },
      },
    );
  }

  // Compare's own solved-and-not-stale precondition (F1.1) means every
  // scenario the endpoint returns already has a `result` — the `!= null`
  // filter here is defense-in-depth, not an expected real filter. Using
  // this SAME filtered array for both the diff computation and the table's
  // rendered columns (rather than the raw `compareScenarios`) keeps their
  // indices/ids in lockstep even in that defensive edge case.
  const resultScenarios = compareScenarios?.filter(s => s.result != null) ?? null;
  const diffBaseline = resultScenarios && resultScenarios.length > 0 ? pickBaseline(resultScenarios) : null;
  const inputDiffRows =
    resultScenarios &&
    diffInputs(resultScenarios.map((s): DiffScenarioInputs => ({ id: s.id, name: s.name, inputs: s.inputs })));
  const outputDiff =
    resultScenarios && diffBaseline
      ? diffOutputs(
          resultScenarios.map(
            (s): DiffScenarioResult => ({
              id: s.id,
              name: s.name,
              objective: s.result!.objective,
              edges: s.result!.edges,
              metrics: s.result!.metrics as Record<string, unknown>,
            }),
          ),
          diffBaseline.id,
        )
      : null;

  return (
    <section>
      <h3 className="text-sm font-semibold mb-2 font-heading">Compare Scenarios</h3>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No other scenarios to compare against yet.</p>
      ) : (
        <>
          <div className="space-y-1 mb-3" data-testid="compare-scenario-picker">
            {candidates.map(s => (
              <div key={s.id} className="flex items-center gap-2">
                <Checkbox
                  id={`compare-scenario-${s.id}`}
                  checked={selectedIds.includes(s.id)}
                  disabled={!selectedIds.includes(s.id) && selectedIds.length >= MAX_COMPARE}
                  onCheckedChange={() => toggle(s.id)}
                  data-testid={`compare-scenario-checkbox-${s.id}`}
                />
                <label htmlFor={`compare-scenario-${s.id}`} className="text-sm cursor-pointer">
                  {s.name}
                </label>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={selectedIds.length < MIN_COMPARE || selectedIds.length > MAX_COMPARE}
            onClick={handleRunCompare}
            data-testid="button-run-compare"
          >
            Run compare
          </Button>

          {resultScenarios && outputDiff && (
            <table className="w-full text-sm mt-4" data-testid="compare-diff-table">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="p-1">Metric</th>
                  {resultScenarios.map(s => (
                    <th key={s.id} className="p-1 text-right">
                      {s.name}
                      {s.id === diffBaseline?.id ? " (baseline)" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="p-1">Objective</td>
                  {outputDiff.objective.values.map((v, i) => (
                    <td key={resultScenarios[i].id} className="p-1 text-right">
                      {formatValue(v)}
                    </td>
                  ))}
                </tr>
                {outputDiff.metrics
                  .filter(row => row.kind === "numeric")
                  .map(row => (
                    <tr key={row.key} className="border-b">
                      <td className="p-1">{row.key}</td>
                      {row.values.map((v, i) => (
                        <td key={resultScenarios[i].id} className="p-1 text-right">
                          {formatValue(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                {inputDiffRows &&
                  inputDiffRows
                    .filter(row => row.changed)
                    .map(row => (
                      <tr key={`input-${row.key}`} className="border-b">
                        <td className="p-1 text-muted-foreground">Input: {row.key}</td>
                        {row.values.map((v, i) => (
                          <td key={resultScenarios[i].id} className="p-1 text-right">
                            {formatValue(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

export function ReportsTab({ baseline, current, bands, availableScenarios, modelId }: ReportsTabProps) {
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
        <h3 className="text-sm font-semibold mb-2 font-heading">Cost Breakdown</h3>
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
        <h3 className="text-sm font-semibold mb-2 font-heading">Service Level (cumulative)</h3>
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
        <h3 className="text-sm font-semibold mb-2 font-heading">Warehouse Utilization</h3>
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

      <CompareSection current={current} availableScenarios={availableScenarios ?? []} modelId={modelId} />
    </div>
  );
}
