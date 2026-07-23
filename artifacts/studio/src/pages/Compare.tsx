import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListScenarios,
  useCompareScenarios,
  useSolveScenario,
  useGetSolveJob,
  getListScenariosQueryKey,
  getGetSolveJobQueryKey,
} from "@workspace/api-client-react";
import type { Scenario, ErrorEnvelope, CompareRejection } from "@workspace/api-client-react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chapterPathForModelId } from "@/lib/chapters";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  diffInputs,
  diffOutputs,
  type DiffScenarioResult,
  type InputDiffRow,
  type MetricDiffRow,
} from "@/lib/compareDiff";

const MAX_COMPARE = 4;
const MIN_COMPARE = 2;

// p-median models keep their p-value under inputs.p — used only as a display
// hint in the picker (not read by the diff engine, which is generic-by-key).
function pHint(s: Scenario): string {
  const p = s.inputs.p;
  return typeof p === "number" ? ` (P=${p})` : "";
}

function prettifyKey(key: string): string {
  const words = key.replace(/([A-Z])/g, " $1").trim().split(/\s+/);
  return words.map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return JSON.stringify(v);
}

function formatItemFields(item: Record<string, unknown> | undefined, keyField: string): string {
  if (!item) return "";
  return Object.entries(item)
    .filter(([k]) => k !== keyField)
    .map(([k, v]) => `${k}=${formatScalar(v)}`)
    .join(", ");
}

function formatDelta(deltaAbs: number | null, deltaPct: number | null): string | null {
  if (deltaAbs == null) return null;
  if (deltaAbs === 0) return null; // baseline / unchanged — de-emphasize by omitting
  const sign = deltaAbs > 0 ? "+" : "";
  const pctStr = deltaPct != null ? ` (${sign}${deltaPct.toFixed(1)}%)` : "";
  return `${sign}${Number.isInteger(deltaAbs) ? deltaAbs : deltaAbs.toFixed(1)}${pctStr}`;
}

// Async solve-and-poll for a single scenario — same pattern as
// Studio.tsx's handleSolve/jobStatus (Phase 3.5, G3.1), scoped to one
// component instance per scenario so each picker row / needs-solving column
// can poll independently without a variable number of hook calls.
function SolveButton({ scenario }: { scenario: Scenario }) {
  const queryClient = useQueryClient();
  const solveScenario = useSolveScenario();
  const [jobId, setJobId] = useState<number | null>(null);

  const { data: job } = useGetSolveJob(scenario.id, jobId!, {
    query: {
      enabled: jobId != null,
      queryKey: getGetSolveJobQueryKey(scenario.id, jobId ?? -1),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "queued" || status === "running" ? 800 : false;
      },
    },
  });

  useEffect(() => {
    if (!job) return;
    if (job.status === "succeeded") {
      setJobId(null);
      queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
    } else if (job.status === "failed") {
      setJobId(null);
      toast({
        title: "Solve failed",
        description: job.error ?? "The solver did not complete. Try again.",
        variant: "destructive",
      });
    }
  }, [job, queryClient]);

  const isBusy = jobId != null && job?.status !== "succeeded" && job?.status !== "failed";

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      disabled={isBusy}
      onClick={() =>
        solveScenario.mutate({ scenarioId: scenario.id }, { onSuccess: (j) => setJobId(j.jobId) })
      }
      data-testid={`button-solve-${scenario.id}`}
    >
      {isBusy ? "Solving…" : scenario.result == null ? "Solve" : "Re-solve"}
    </Button>
  );
}

function InputDiffCell({ row, index }: { row: InputDiffRow; index: number }) {
  if (row.itemDiffs) {
    const present = row.itemDiffs.filter((d) => d.values[index] !== undefined);
    if (present.length === 0) return <span className="text-muted-foreground">—</span>;
    return (
      <ul className="space-y-0.5">
        {present.map((d) => (
          <li
            key={d.itemId}
            className={d.changed ? "font-semibold text-amber-700" : "text-muted-foreground"}
          >
            {d.itemId}
            {(() => {
              const fields = formatItemFields(d.values[index], "id");
              return fields ? `: ${fields}` : "";
            })()}
          </li>
        ))}
      </ul>
    );
  }
  return <>{formatScalar(row.values[index])}</>;
}

function MetricRowCells({
  row,
  eligibleIds,
  columnIds,
}: {
  row: MetricDiffRow;
  eligibleIds: number[];
  columnIds: number[];
}) {
  return (
    <>
      {columnIds.map((id) => {
        const eIdx = eligibleIds.indexOf(id);
        if (eIdx === -1) {
          return (
            <td key={id} className="py-3 px-4 border-l text-muted-foreground">
              —
            </td>
          );
        }
        if (row.kind === "numeric") {
          const value = row.values[eIdx];
          const delta = formatDelta(row.deltaAbs?.[eIdx] ?? null, row.deltaPct?.[eIdx] ?? null);
          // Per-cell, not per-row: a column identical to the current baseline
          // stays de-emphasized even if some other selected column differs.
          return (
            <td
              key={id}
              className={cn("py-3 px-4 border-l", delta ? "font-semibold" : "text-muted-foreground")}
            >
              {formatScalar(value)}
              {delta && <span className="ml-1 text-xs text-slate-500">{delta}</span>}
            </td>
          );
        }
        if (row.kind === "keyed-array" && row.itemDiffs && row.keyField) {
          const arr = (row.values[eIdx] as Record<string, unknown>[] | undefined) ?? [];
          if (arr.length === 0) {
            return (
              <td key={id} className="py-3 px-4 border-l text-muted-foreground">
                —
              </td>
            );
          }
          return (
            <td key={id} className="py-3 px-4 border-l">
              <ul className="space-y-0.5">
                {row.itemDiffs.map((d) => {
                  const item = d.values[eIdx] as Record<string, unknown> | undefined;
                  if (!item) return null;
                  return (
                    <li key={d.itemKey} className={d.changed ? "font-semibold text-amber-700" : "text-muted-foreground"}>
                      {d.itemKey}: {formatItemFields(item, row.keyField!)}
                    </li>
                  );
                })}
              </ul>
            </td>
          );
        }
        return (
          <td key={id} className={cn("py-3 px-4 border-l", row.changed ? "font-semibold" : "text-muted-foreground")}>
            {formatScalar(row.values[eIdx])}
          </td>
        );
      })}
    </>
  );
}

export function Compare() {
  const queryClient = useQueryClient();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const currentScenarioId = params.get("scenario") ? parseInt(params.get("scenario")!, 10) : undefined;

  const { data: scenarios, isLoading } = useListScenarios();
  const currentScenario = scenarios?.find((s) => s.id === currentScenarioId);
  const backHref = currentScenarioId && currentScenario
    ? `${chapterPathForModelId(currentScenario.modelId) ?? "/"}?scenario=${currentScenarioId}`
    : "/";

  const availableModelIds = useMemo(
    () => [...new Set((scenarios ?? []).map((s) => s.modelId as string))].sort(),
    [scenarios],
  );

  const [selectedModelId, setSelectedModelId] = useState<string>("");
  useEffect(() => {
    if (selectedModelId && availableModelIds.includes(selectedModelId)) return;
    if (currentScenario) {
      setSelectedModelId(currentScenario.modelId);
      return;
    }
    // Default to whichever model has the most scenarios — most likely to
    // have >=2 to compare. (availableModelIds is alphabetical, fine for the
    // dropdown, but not a meaningful default order on its own.)
    const counts = new Map<string, number>();
    (scenarios ?? []).forEach((s) => counts.set(s.modelId, (counts.get(s.modelId) ?? 0) + 1));
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? availableModelIds[0] ?? "";
    setSelectedModelId(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableModelIds.join(","), currentScenario?.modelId]);

  const scenariosForModel = useMemo(
    () => (scenarios ?? []).filter((s) => s.modelId === selectedModelId),
    [scenarios, selectedModelId],
  );

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  useEffect(() => {
    if (!selectedModelId) return;
    const pool = (scenarios ?? []).filter((s) => s.modelId === selectedModelId);
    if (pool.length === 0) {
      setSelectedIds([]);
      return;
    }
    const first = currentScenario && currentScenario.modelId === selectedModelId ? currentScenario.id : pool[0].id;
    const rest = pool.filter((s) => s.id !== first);
    const second = rest.find((s) => s.result != null && !s.stale)?.id ?? rest[0]?.id;
    setSelectedIds(second ? [first, second] : [first]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId]);

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  }

  const selectedScenarios = useMemo(
    () => selectedIds.map((id) => scenariosForModel.find((s) => s.id === id)).filter((s): s is Scenario => !!s),
    [selectedIds, scenariosForModel],
  );

  // Case (a) — different models — is prevented upfront: the picker only ever
  // offers scenarios from `scenariosForModel`, all sharing `selectedModelId`.
  const [raceIneligibleIds, setRaceIneligibleIds] = useState<Set<number>>(new Set());
  const eligibleScenarios = selectedScenarios.filter(
    (s) => s.result != null && !s.stale && !raceIneligibleIds.has(s.id),
  );
  const needsSolvingIds = new Set(
    selectedScenarios.filter((s) => s.result == null || s.stale || raceIneligibleIds.has(s.id)).map((s) => s.id),
  );

  const [baselineId, setBaselineId] = useState<number | null>(null);
  const eligibleKey = eligibleScenarios.map((s) => s.id).sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (eligibleScenarios.length === 0) {
      setBaselineId(null);
      return;
    }
    if (!baselineId || !eligibleScenarios.some((s) => s.id === baselineId)) {
      setBaselineId(eligibleScenarios[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleKey]);

  // Case (b) — one or more selected scenarios unsolved/stale — is expected to
  // happen: the picker lets a student select them anyway. We only ever send
  // the compare API the already-known-eligible subset, so in the normal flow
  // this call should always 200; it's a defense-in-depth check against races
  // (e.g. a scenario going stale between selection and this call), handled
  // by demoting the offending ids locally rather than crashing.
  const compareMutation = useCompareScenarios();
  useEffect(() => {
    const ids = eligibleScenarios.map((s) => s.id);
    if (ids.length < MIN_COMPARE) return;
    compareMutation.mutate(
      { data: { scenarioIds: ids } },
      {
        onSuccess: () => setRaceIneligibleIds(new Set()),
        onError: (err) => {
          const data = (err as { data?: ErrorEnvelope | CompareRejection | null })?.data;
          const offendingIds = data && "offendingIds" in data ? data.offendingIds : undefined;
          if (offendingIds && offendingIds.length > 0) {
            setRaceIneligibleIds(new Set(offendingIds));
            toast({
              title: "Selection changed",
              description: "One or more scenarios need (re-)solving before they can be compared.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Comparison failed",
              description: data?.error ?? "Could not compare these scenarios.",
              variant: "destructive",
            });
          }
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleKey]);

  const inputDiffRows = diffInputs(selectedScenarios.map((s) => ({ id: s.id, name: s.name, inputs: s.inputs })));

  const eligibleForDiff: DiffScenarioResult[] = eligibleScenarios.map((s) => ({
    id: s.id,
    name: s.name,
    objective: s.result!.objective,
    edges: s.result!.edges,
    metrics: s.result!.metrics as Record<string, unknown>,
  }));
  const outputDiff = eligibleForDiff.length > 0 && baselineId != null ? diffOutputs(eligibleForDiff, baselineId) : null;
  const eligibleIdsInDiffOrder = eligibleForDiff.map((s) => s.id);

  if (isLoading) {
    return (
      <div className="studio-lab p-8">
        <Skeleton className="w-full h-14 mb-4" />
        <Skeleton className="w-full h-96" />
      </div>
    );
  }

  if (!scenarios || scenarios.length < MIN_COMPARE) {
    return (
      <div className="studio-lab p-8">
        <Link href={backHref} className="inline-flex items-center text-sm font-medium text-primary hover:underline mb-6">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Link>
        <div className="bg-slate-50 border rounded-lg p-8 text-center">
          <h2 className="text-lg font-bold mb-2">Not enough scenarios</h2>
          <p className="text-muted-foreground">You need at least two scenarios to compare them. Go back and create another one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-lab min-h-screen bg-slate-50 overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6">
        <header className="mb-8" style={{ background: "transparent", border: "none" }}>
          <Link href={backHref} className="inline-flex items-center text-sm font-medium text-primary hover:underline mb-4">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Compare Scenarios</h1>
            <p className="text-sm text-muted-foreground mt-1">Step 5</p>
          </div>
        </header>

        <div className="bg-white border rounded-xl shadow-sm p-5 mb-8">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Model</span>
              {availableModelIds.length > 1 ? (
                <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                  <SelectTrigger className="h-8 text-xs w-56" data-testid="select-model">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModelIds.map((id) => (
                      <SelectItem key={id} value={id} className="text-xs">
                        {id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm font-medium">{selectedModelId}</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {selectedIds.length} of {MAX_COMPARE} selected (min {MIN_COMPARE})
            </span>
          </div>

          {scenariosForModel.length < MIN_COMPARE ? (
            <p className="text-sm text-muted-foreground">
              Only one scenario exists for this model — create or open another to compare.
            </p>
          ) : (
            <div className="divide-y">
              {scenariosForModel.map((s) => {
                const checked = selectedIds.includes(s.id);
                const isUnsolved = s.result == null;
                const isStale = !isUnsolved && s.stale;
                return (
                  <div
                    key={s.id}
                    className={cn("flex items-center gap-3 py-2", (isUnsolved || isStale) && "opacity-90")}
                  >
                    <Checkbox
                      id={`scenario-${s.id}`}
                      checked={checked}
                      disabled={!checked && selectedIds.length >= MAX_COMPARE}
                      onCheckedChange={() => toggleSelected(s.id)}
                      data-testid={`checkbox-scenario-${s.id}`}
                    />
                    <label
                      htmlFor={`scenario-${s.id}`}
                      className={cn("flex-1 text-sm cursor-pointer", isUnsolved && "text-muted-foreground")}
                    >
                      {s.name}
                      {pHint(s)}
                    </label>
                    {isUnsolved && (
                      <Badge
                        variant="outline"
                        className="bg-slate-100 text-slate-600"
                        data-testid={`badge-needs-solving-${s.id}`}
                      >
                        Needs solving
                      </Badge>
                    )}
                    {isStale && (
                      <Badge
                        variant="outline"
                        className="bg-amber-50 text-amber-700 border-amber-300"
                        data-testid={`badge-stale-${s.id}`}
                      >
                        Stale
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {selectedScenarios.length >= MIN_COMPARE && (
          <>
            <div className="bg-white border rounded-xl shadow-sm overflow-hidden mb-8">
              <div className="px-4 py-3 border-b bg-slate-50/50">
                <h2 className="font-bold text-slate-900">Input diff</h2>
              </div>
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b bg-slate-50/50">
                    <th className="py-3 px-4 font-medium text-muted-foreground w-48">Input</th>
                    {selectedScenarios.map((s) => (
                      <th key={s.id} className="py-3 px-4 border-l min-w-[180px] align-top font-bold text-slate-900">
                        {s.name}
                        {s.id === currentScenarioId && (
                          <Badge variant="outline" className="ml-2 bg-blue-50 text-blue-700 border-blue-200">
                            Current
                          </Badge>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {inputDiffRows.map((row) => (
                    <tr key={row.key}>
                      <td className="py-3 px-4 font-medium text-slate-700">{prettifyKey(row.key)}</td>
                      {selectedScenarios.map((s, i) => (
                        <td
                          key={s.id}
                          data-testid={`input-diff-${row.key}-${s.id}`}
                          className={cn("py-3 px-4 border-l align-top", !row.changed && "text-muted-foreground")}
                        >
                          <InputDiffCell row={row} index={i} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white border rounded-xl shadow-sm overflow-hidden mb-8">
              <div className="px-4 py-3 border-b bg-slate-50/50">
                <h2 className="font-bold text-slate-900">Output diff</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Deltas are relative to the baseline column.</p>
              </div>
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b bg-slate-50/50">
                    <th className="py-3 px-4 font-medium text-muted-foreground w-48">Metric</th>
                    {selectedScenarios.map((s) => {
                      const isBaseline = s.id === baselineId;
                      const needsSolving = needsSolvingIds.has(s.id);
                      return (
                        <th key={s.id} className="py-3 px-4 border-l min-w-[200px] align-top">
                          <div className="font-bold text-slate-900 text-base mb-1">{s.name}</div>
                          <div className="flex flex-wrap gap-1 items-center">
                            {needsSolving ? (
                              <>
                                <Badge
                                  variant="outline"
                                  className={
                                    s.result == null
                                      ? "bg-slate-100 text-slate-600"
                                      : "bg-amber-50 text-amber-700 border-amber-300"
                                  }
                                  data-testid={s.result == null ? `badge-needs-solving-out-${s.id}` : `badge-stale-out-${s.id}`}
                                >
                                  {s.result == null ? "Needs solving" : "Stale"}
                                </Badge>
                                <SolveButton scenario={s} />
                              </>
                            ) : isBaseline ? (
                              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                Baseline
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs px-2"
                                onClick={() => setBaselineId(s.id)}
                                data-testid={`button-set-baseline-${s.id}`}
                              >
                                Set as baseline
                              </Button>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="py-3 px-4 font-medium text-slate-700">Objective</td>
                    {selectedScenarios.map((s) => {
                      const idx = eligibleIdsInDiffOrder.indexOf(s.id);
                      if (idx === -1 || !outputDiff) {
                        return (
                          <td key={s.id} data-testid={`output-objective-${s.id}`} className="py-3 px-4 border-l text-muted-foreground">
                            —
                          </td>
                        );
                      }
                      const delta = formatDelta(outputDiff.objective.deltaAbs[idx], outputDiff.objective.deltaPct[idx]);
                      return (
                        <td
                          key={s.id}
                          data-testid={`output-objective-${s.id}`}
                          className={cn("py-3 px-4 border-l", delta ? "font-semibold" : "text-muted-foreground")}
                        >
                          {formatScalar(outputDiff.objective.values[idx])}
                          {delta && <span className="ml-1 text-xs text-slate-500">{delta}</span>}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium text-slate-700">Open sites</td>
                    {selectedScenarios.map((s) => {
                      const entry = outputDiff?.openSites.find((o) => o.scenarioId === s.id);
                      if (!entry) {
                        return (
                          <td key={s.id} data-testid={`output-open-sites-${s.id}`} className="py-3 px-4 border-l text-muted-foreground">
                            —
                          </td>
                        );
                      }
                      return (
                        <td key={s.id} data-testid={`output-open-sites-${s.id}`} className="py-3 px-4 border-l">
                          <div className="truncate max-w-[200px]" title={entry.openSites.join(" · ")}>
                            {entry.openSites.join(" · ") || "—"}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium text-slate-700">Sites added vs baseline</td>
                    {selectedScenarios.map((s) => {
                      const entry = outputDiff?.openSites.find((o) => o.scenarioId === s.id);
                      if (!entry) {
                        return (
                          <td key={s.id} data-testid={`output-sites-added-${s.id}`} className="py-3 px-4 border-l text-muted-foreground">
                            —
                          </td>
                        );
                      }
                      return (
                        <td key={s.id} data-testid={`output-sites-added-${s.id}`} className="py-3 px-4 border-l">
                          {entry.added.length > 0 ? (
                            <span className="font-semibold text-green-700">+{entry.added.join(", +")}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium text-slate-700">Sites closed vs baseline</td>
                    {selectedScenarios.map((s) => {
                      const entry = outputDiff?.openSites.find((o) => o.scenarioId === s.id);
                      if (!entry) {
                        return (
                          <td key={s.id} className="py-3 px-4 border-l text-muted-foreground">
                            —
                          </td>
                        );
                      }
                      return (
                        <td key={s.id} className="py-3 px-4 border-l">
                          {entry.removed.length > 0 ? (
                            <span className="font-semibold text-red-700">−{entry.removed.join(", −")}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="py-3 px-4 font-medium text-slate-700">Reassigned customers vs baseline</td>
                    {selectedScenarios.map((s) => {
                      const idx = eligibleIdsInDiffOrder.indexOf(s.id);
                      const count = idx === -1 || !outputDiff ? undefined : outputDiff.reassignedCount[idx];
                      return (
                        <td
                          key={s.id}
                          data-testid={`output-reassigned-${s.id}`}
                          className={cn("py-3 px-4 border-l", count ? "font-semibold" : "text-muted-foreground")}
                        >
                          {count == null ? "—" : count}
                        </td>
                      );
                    })}
                  </tr>
                  {outputDiff?.metrics.map((row) => (
                    <tr key={row.key}>
                      <td className="py-3 px-4 font-medium text-slate-700">{prettifyKey(row.key)}</td>
                      <MetricRowCells row={row} eligibleIds={eligibleIdsInDiffOrder} columnIds={selectedScenarios.map((s) => s.id)} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
