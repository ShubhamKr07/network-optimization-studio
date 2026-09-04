import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHAPTERS, chapterPathForModelId, chapterForModelId } from "@/lib/chapters";
import { useGetSolveHistory, useGetLandingSummary } from "@workspace/api-client-react";
import { formatRelativeTime } from "@/lib/relativeTime";

function chapterNumber(chapterLabel: string): string {
  const n = chapterLabel.match(/\d+/)?.[0] ?? "";
  return n.padStart(2, "0");
}

export function Landing() {
  const { data: history } = useGetSolveHistory({ limit: 5 });
  const { data: summary, isPending, isError } = useGetLandingSummary();
  // TanStack retains the last successful `data` through a background-refetch
  // error, so `summary != null` alone would treat a stale-then-errored summary
  // as ready. Gate on the flags too — pending OR errored falls back to the T2
  // baseline (number + start →, no stats line), never a half-filled footer.
  const ready = !isPending && !isError && summary != null;
  const byModel = new Map((summary?.perChapter ?? []).map((r) => [r.modelId, r]));

  // The single most-recently-solved chapter (across ALL rows, incl. hidden) —
  // that card shows "active"; every other shows "start →".
  let activeModelId: string | undefined;
  let activeAt = -Infinity;
  for (const r of summary?.perChapter ?? []) {
    if (!r.lastSucceededSolveAt) continue;
    const t = new Date(r.lastSucceededSolveAt).getTime();
    if (t > activeAt) { activeAt = t; activeModelId = r.modelId; }
  }

  const visibleLabs = CHAPTERS.filter((c) => !c.hiddenFromLanding).length;

  return (
    <div className="max-w-[860px] mx-auto p-8">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="scnd-display text-2xl font-semibold mb-1">Labs</h1>
          <p className="text-muted-foreground">Pick a chapter to start or continue a scenario.</p>
        </div>
        {ready && summary && (
          <span data-testid="landing-stats-line" className="font-mono text-[10.5px] text-muted-foreground whitespace-nowrap">
            {visibleLabs} labs · {summary.totals.scenarios} scenarios · {summary.totals.solvedScenarios} solved
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

      {history && history.length > 0 && (
        <div className="mt-10">
          <h2 className="scnd-display text-sm font-semibold text-foreground mb-1">Recent solves</h2>
          <p className="text-xs text-muted-foreground mb-3">Most recent solve per scenario — click to open one.</p>
          <div className="border rounded-lg divide-y bg-white">
            {history.map((h) => {
              const chapterPath = chapterPathForModelId(h.modelId);
              const row = (
                <div className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/40 transition-colors">
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
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0 font-mono">
                    {h.objective != null && <span>obj {h.objective.toExponential(2)}</span>}
                    {h.weightedAvgDistanceMi != null && <span>{h.weightedAvgDistanceMi.toFixed(1)} mi</span>}
                    {h.runTimeSec != null && <span>{h.runTimeSec.toFixed(2)}s</span>}
                  </div>
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
