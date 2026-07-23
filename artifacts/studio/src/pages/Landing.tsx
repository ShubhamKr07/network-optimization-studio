import { Link } from "wouter";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHAPTERS, chapterPathForModelId } from "@/lib/chapters";
import { useGetSolveHistory } from "@workspace/api-client-react";

export function Landing() {
  const { data: history } = useGetSolveHistory({ limit: 5 });

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-1">Labs</h1>
      <p className="text-muted-foreground mb-6">Pick a chapter to start or continue a scenario.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {CHAPTERS.map((c) => (
          <Link key={c.path} href={c.path} data-testid={`link-${c.path}`}>
            <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full">
              <CardHeader>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{c.chapter}</p>
                <CardTitle className="text-base">{c.title}</CardTitle>
                <CardDescription>{c.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>

      {history && history.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold text-foreground mb-3">Recent solves</h2>
          <div className="border rounded-lg divide-y bg-white">
            {history.map((h) => {
              const chapterPath = chapterPathForModelId(h.modelId);
              const row = (
                <div className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/40 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-medium text-foreground">{h.scenarioName}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        h.status === "succeeded" ? "text-green-700 border-green-300 bg-green-50" :
                        h.status === "failed" ? "text-red-600 border-red-300 bg-red-50" :
                        "text-amber-600 border-amber-300 bg-amber-50"
                      }`}
                    >
                      {h.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
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
