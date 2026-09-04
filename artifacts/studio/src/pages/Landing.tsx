import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHAPTERS, chapterPathForModelId, chapterForModelId } from "@/lib/chapters";
import { useGetSolveHistory } from "@workspace/api-client-react";

function chapterNumber(chapterLabel: string): string {
  const n = chapterLabel.match(/\d+/)?.[0] ?? "";
  return n.padStart(2, "0");
}

export function Landing() {
  const { data: history } = useGetSolveHistory({ limit: 5 });

  return (
    <div className="max-w-[860px] mx-auto p-8">
      <h1 className="scnd-display text-2xl font-semibold mb-1">Labs</h1>
      <p className="text-muted-foreground mb-6">Pick a chapter to start or continue a scenario.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {CHAPTERS.filter((c) => !c.hiddenFromLanding).map((c) => (
          <Link key={c.path} href={c.path} data-testid={`link-${c.path}`}>
            <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full">
              <CardHeader>
                <p className="scnd-kicker">{c.chapter}</p>
                <CardTitle className="scnd-display text-base">{c.title}</CardTitle>
                <CardDescription>{c.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between" data-testid={`landing-card-footer-${c.modelId}`}>
                  <span className="scnd-display font-bold" style={{ fontSize: "15px", color: "var(--green-400)" }}>{chapterNumber(c.chapter)}</span>
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "10.5px", color: "var(--text-faint)" }}>start →</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {history && history.length > 0 && (
        <div className="mt-10">
          <h2 className="scnd-display text-sm font-semibold text-foreground mb-1">Recent solves</h2>
          <p className="text-xs text-muted-foreground mb-3">Recent solve attempts — click to open one.</p>
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
