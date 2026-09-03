import type { SolveResult } from "@workspace/api-client-react";
import { chapterForModelId } from "@/lib/chapters";

interface ObjectiveBarProps {
  result: SolveResult | null;
  scenarioId: number | undefined;
  modelId?: string;
  scenarioName?: string;
}

// Neutral model-summary bar. This was previously a gamified "Beat X mi" goal
// box (Phase 1 A3.1/A3.2 "Remove gamification" was never cleaned up here, and
// it was also broken for two-echelon-gold-au, which had no MODEL_TARGETS
// entry). Now it shows the active model's chapter/title/teaching-intent
// description (all sourced from lib/chapters, the single source of truth —
// no second per-model table), the scenario name when present, and plain
// solve stats read straight off `result` when available. No arbitrary
// targets, no hit/miss coloring, no checkmarks.
export function ObjectiveBar({ result, modelId, scenarioName }: ObjectiveBarProps) {
  const chapter = chapterForModelId(modelId);
  const avgDistance = result?.metrics.weightedAvgDistance;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "16px",
      padding: "10px 16px",
      background: "hsl(var(--card))",
      border: "1px solid var(--line)",
      boxShadow: "var(--shadow-sm)",
      borderRadius: "var(--radius-md)",
      margin: "6px 8px 0",
      position: "relative",
      flexShrink: 0,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "9.5px", letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "1px" }}>
          {chapter?.chapter ?? "Model"}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
          <b style={{ fontFamily: "var(--app-font-display)", fontSize: "13px", fontWeight: 600, color: "var(--text-body)" }}>
            {chapter?.title ?? ""}
          </b>
          {scenarioName ? (
            <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>· {scenarioName}</span>
          ) : null}
        </div>
        {chapter?.description ? (
          <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "2px", lineHeight: 1.35 }}>
            {chapter.description}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: "7px", flexShrink: 0 }}>
        {result ? (
          <>
            <StatPill label={`objective ${result.objective.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
            {avgDistance != null && <StatPill label={`avg distance ${avgDistance.toFixed(0)} mi`} />}
            <StatPill label={`run ${result.runTimeSec.toFixed(2)}s`} />
          </>
        ) : (
          <StatPill label="Not yet solved" />
        )}
      </div>
    </div>
  );
}

function StatPill({ label }: { label: string }) {
  return (
    <div style={{
      fontFamily: "var(--app-font-mono)", fontSize: "11px",
      padding: "5px 9px", borderRadius: "7px",
      border: "1px solid var(--line)",
      color: "var(--text-muted)",
      background: "transparent",
      whiteSpace: "nowrap",
    }}>
      {label}
    </div>
  );
}
