import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHAPTERS, chapterPathForModelId, chapterForModelId } from "@/lib/chapters";
import { useGetSolveHistory, useGetLandingSummary } from "@workspace/api-client-react";
import { formatRelativeTime } from "@/lib/relativeTime";
import { formatChenObjective, formatObjective as formatObjectiveShared } from "@/lib/formatObjective";
import { useDisplayUnit, type UnitApi } from "@/contexts/UnitContext";
import type { CanonicalUnit } from "@workspace/units";
import { isRetryableFailureCode } from "@/lib/solveFailure";

function chapterNumber(chapterLabel: string): string {
  const n = chapterLabel.match(/\d+/)?.[0] ?? "";
  return n.padStart(2, "0");
}

// `GetSolveHistoryResponseItem.distanceUnit` is a plain `string` at the
// schema level, but the contract (see its own description) guarantees it is
// always "mi"|"km", never anything else, never absent — narrowed defensively
// here rather than trusted blindly.
function asCanonicalUnit(raw: string): CanonicalUnit | null {
  return raw === "km" || raw === "mi" ? raw : null;
}

// D14/C4.10, chen-bands-units Part D decision 6 — every recent-solves row
// carries BOTH `modelId` and `distanceUnit` synchronously (no manifest fetch
// needed, unlike ObjectiveBar/CostSummaryTab), so the six-model
// `formatObjective` contract is used unconditionally per row rather than
// gated on an async resolution. `formatChenObjective`'s narrower
// mode-agnostic default is kept only as a genuinely-defensive fallback for a
// malformed/unexpected `distanceUnit` value, which the contract says cannot
// happen — not a "canonical unresolved" case.
function formatHistoryObjective(
  h: { objective: number; objectiveMode: string | null; modelId: string; distanceUnit: string },
  unit: UnitApi,
): string {
  const canonical = asCanonicalUnit(h.distanceUnit);
  if (canonical != null) {
    return formatObjectiveShared(h.modelId, h.objectiveMode, h.objective, canonical, unit);
  }
  return formatChenObjective(h.objective, h.objectiveMode) ?? `obj ${h.objective.toExponential(2)}`;
}

function formatHistoryDistance(h: { weightedAvgDistance: number; distanceUnit: string }, unit: UnitApi): string {
  const canonical = asCanonicalUnit(h.distanceUnit);
  if (canonical != null) {
    return `${unit.toDisplay(h.weightedAvgDistance, canonical).toFixed(1)} ${unit.effectiveUnit(canonical)}`;
  }
  return `${h.weightedAvgDistance.toFixed(1)} ${h.distanceUnit}`;
}

export function Landing() {
  const unit = useDisplayUnit();
  const { data: history } = useGetSolveHistory({ limit: 5 });
  const { data: summary, isPending, isError } = useGetLandingSummary();
  // TanStack retains the last successful `data` through a background-refetch
  // error, so `summary != null` alone would treat a stale-then-errored summary
  // as ready. Gate on the flags too — pending OR errored falls back to the T2
  // baseline (number + start →, no stats line), never a half-filled footer.
  const ready = !isPending && !isError && summary != null;
  const byModel = new Map((summary?.perChapter ?? []).map((r) => [r.modelId, r]));

  const hiddenModelIds = new Set<string>(CHAPTERS.filter((c) => c.hiddenFromLanding).map((c) => c.modelId));
  const visibleHistory = history?.filter((h) => !hiddenModelIds.has(h.modelId));
  const visiblePerChapter = (summary?.perChapter ?? []).filter((r) => !hiddenModelIds.has(r.modelId));

  // The single most-recently-solved VISIBLE chapter — that card shows
  // "active"; every other shows "start →".
  let activeModelId: string | undefined;
  let activeAt = -Infinity;
  for (const r of visiblePerChapter) {
    if (!r.lastSucceededSolveAt) continue;
    const t = new Date(r.lastSucceededSolveAt).getTime();
    if (t > activeAt) { activeAt = t; activeModelId = r.modelId; }
  }

  const visibleLabs = CHAPTERS.filter((c) => !c.hiddenFromLanding).length;
  const visibleScenarios = visiblePerChapter.reduce((sum, r) => sum + r.scenarioCount, 0);
  const visibleSolved = visiblePerChapter.reduce((sum, r) => sum + r.solvedScenarioCount, 0);

  return (
    <div className="max-w-[860px] mx-auto p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="scnd-display text-2xl font-semibold mb-1">Labs</h1>
          <p className="text-muted-foreground">Pick a chapter to start or continue a scenario.</p>
        </div>
        {ready && summary && (
          <span data-testid="landing-stats-line" className="font-mono text-[10.5px] text-muted-foreground whitespace-nowrap">
            {visibleLabs} labs · {visibleScenarios} scenarios · {visibleSolved} solved
          </span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {CHAPTERS.filter((c) => !c.hiddenFromLanding).map((c) => (
          <Link key={c.path} href={c.path} data-testid={`link-${c.path}`}>
            <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full flex flex-col overflow-hidden">
              <CardHeader>
                <p className="scnd-kicker">{c.chapter}</p>
                <CardTitle className="scnd-display text-lg">{c.title}</CardTitle>
                <CardDescription>{c.description}</CardDescription>
              </CardHeader>
              {(() => {
                const entry = byModel.get(c.modelId);
                const status = !ready
                  ? null
                  : !entry || entry.scenarioCount === 0
                    ? "no scenarios yet"
                    : entry.lastSucceededSolveAt
                      ? `${entry.scenarioCount} scenarios · solved ${formatRelativeTime(entry.lastSucceededSolveAt)}`
                      : `${entry.scenarioCount} scenarios`;
                const isActive = ready && c.modelId === activeModelId;
                return (
                  <div
                    className="mt-auto flex items-center justify-between gap-2 border-t px-6 py-3"
                    style={{ background: "var(--surface-sunken)", borderColor: "var(--line)" }}
                    data-testid={`landing-card-footer-${c.modelId}`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="scnd-display font-bold flex-shrink-0" style={{ fontSize: "15px", color: "var(--green-700)" }}>{chapterNumber(c.chapter)}</span>
                      {status && <span className="truncate" style={{ fontFamily: "var(--app-font-mono)", fontSize: "10.5px", color: "var(--text-muted)" }}>{status}</span>}
                    </span>
                    {isActive
                      ? <Badge variant="outline" className="text-[10px] text-[color:var(--success)] border-[color:var(--success-border)] bg-[color:var(--success-bg)]">active</Badge>
                      : <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "10.5px", color: "var(--text-faint)" }}>start →</span>}
                  </div>
                );
              })()}
            </Card>
          </Link>
        ))}
      </div>

      {visibleHistory && visibleHistory.length > 0 && (
        <div className="mt-10">
          <h2 className="scnd-display text-sm font-semibold text-foreground mb-1">Recent solves</h2>
          <p className="text-xs text-muted-foreground mb-3">Most recent solve per scenario — click to open one.</p>
          <div className="border rounded-lg divide-y bg-white">
            {visibleHistory.map((h) => {
              const chapterPath = chapterPathForModelId(h.modelId);
              // A9 (SCND correctness, §2.7.1) — `h.status` is the job-
              // lifecycle status, always authoritative on its own: a
              // superseded-but-successful job (A7) is a real "succeeded"
              // status here and must render as such, NEVER as a failure —
              // this badge is derived from `h.status` alone, with no
              // second-guessing from any other field. `legacyUnverified` is
              // an orthogonal PROOF-STATE concern layered on top only for a
              // succeeded row: a normalized-legacy/unverified result still
              // "succeeded" as a job, it just isn't a verified proof — so it
              // gets an ADDITIONAL neutral "unverified" badge, never
              // promoted to (and never rendered as) anything resembling
              // "Proven optimal".
              const isRetryable = h.status === "failed" && isRetryableFailureCode(h.errorCode);
              const row = (
                <div className="flex flex-col gap-0.5 px-4 py-2.5 text-sm hover:bg-muted/40 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {chapterForModelId(h.modelId)?.chapter ?? ""} ·
                      </span>
                      <span className="truncate font-medium text-foreground">{h.scenarioName}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          h.status === "succeeded" ? "text-[color:var(--success)] border-[color:var(--success-border)] bg-[color:var(--success-bg)]" :
                          h.status === "failed" ? "text-[color:var(--danger)] border-[color:var(--danger-border)] bg-[color:var(--danger-bg)]" :
                          "text-[color:var(--warning)] border-[color:var(--warning-border)] bg-[color:var(--warning-bg)]"
                        }`}
                      >
                        {h.status}
                      </Badge>
                      {h.status === "succeeded" && h.legacyUnverified && (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-muted-foreground border-muted-foreground/40 bg-muted/30"
                          data-testid={`badge-legacy-unverified-${h.id}`}
                        >
                          unverified
                        </Badge>
                      )}
                      {isRetryable && (
                        <span
                          className="text-[10px] font-medium text-[color:var(--danger)]"
                          data-testid={`link-retry-solve-history-${h.id}`}
                        >
                          Retry →
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0 font-mono">
                      {h.objective != null && <span>{formatHistoryObjective({ ...h, objective: h.objective }, unit)}</span>}
                      {h.weightedAvgDistance != null && <span>{formatHistoryDistance({ ...h, weightedAvgDistance: h.weightedAvgDistance }, unit)}</span>}
                      {h.runTimeSec != null && <span>{h.runTimeSec.toFixed(2)}s</span>}
                    </div>
                  </div>
                  {/* A9 — failure rendering consumes errorCode/errorMessage
                      (A5's permanent, server-owned safe strings), never a
                      raw diagnostic; there is no raw diagnostic anywhere on
                      this typed response to fall back to. */}
                  {h.status === "failed" && h.errorMessage && (
                    <p className="text-[10.5px] text-muted-foreground pl-[3.25rem]" data-testid={`text-error-message-${h.id}`}>
                      {h.errorMessage}
                    </p>
                  )}
                </div>
              );
              return chapterPath ? (
                <Link key={h.id} href={`${chapterPath}?scenario=${h.scenarioId}`} data-testid={`link-solve-history-${h.id}`}>
                  {row}
                </Link>
              ) : (
                <div key={h.id}>{row}</div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
