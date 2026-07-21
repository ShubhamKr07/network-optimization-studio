import type { SolveResult } from "@workspace/api-client-react";

interface ObjectiveBarProps {
  pValue: number;
  result: SolveResult | null;
  scenarioId: number | undefined;
  problemType?: string;
}

interface ModelTarget {
  chapter: string;
  title: string;
  tagline: string;
  maxWarehouses: number;
  maxAvgDistance: number;
}

const MODEL_TARGETS: Record<number, ModelTarget> = {
  1: {
    chapter: "Chapter 3 · Al's Athletics",
    title: "Beat 390 mi using ≤ 3 warehouses",
    tagline: "serve all 200 customers.",
    maxWarehouses: 3,
    maxAvgDistance: 390,
  },
  2: {
    chapter: "Chapter 5 · Coal Transport LP",
    title: "Beat 500 mi using ≤ 5 supply nodes",
    tagline: "minimise haul distance across all demand points.",
    maxWarehouses: 5,
    maxAvgDistance: 500,
  },
  3: {
    chapter: "Chapter 5 · Brazil Capacity",
    title: "Beat 350 mi using ≤ 5 DCs",
    tagline: "try relax single-sourcing to split demand across DCs.",
    maxWarehouses: 5,
    maxAvgDistance: 350,
  },
};

export function ObjectiveBar({ pValue, result, problemType }: ObjectiveBarProps) {
  const modelIndex = problemType === "transport" ? 2 : problemType === "capacitated_pmedian" ? 3 : 1;
  const target = MODEL_TARGETS[modelIndex] ?? MODEL_TARGETS[1];

  const warehousesOk = pValue <= target.maxWarehouses;
  const distanceOk = result ? result.weightedAvgDistanceMi < target.maxAvgDistance : false;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "16px",
      padding: "10px 16px",
      background: "var(--arc-ink-2)",
      border: "1px solid rgba(87,208,201,.35)",
      borderRadius: "10px",
      margin: "6px 8px 0",
      position: "relative",
      overflow: "hidden",
      flexShrink: 0,
    }}>
      <div style={{
        width: "32px", height: "32px", flexShrink: 0, borderRadius: "9px",
        background: "rgba(87,208,201,.14)", display: "grid", placeItems: "center",
        color: "var(--arc-cyan)"
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l2.4 7.4H22l-6 4.5 2.3 7.1L12 16.5 5.7 21l2.3-7.1-6-4.5h7.6z"/>
        </svg>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--arc-mono)", fontSize: "9.5px", letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--arc-cyan)", marginBottom: "1px" }}>
          {target.chapter}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <b style={{ fontFamily: "var(--arc-display)", fontSize: "13px", fontWeight: 600, color: "var(--arc-paper)" }}>
            {target.title}
          </b>
          <span style={{ color: "var(--arc-muted)", fontSize: "12px" }}>— {target.tagline}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: "7px", flexShrink: 0 }}>
        <GoalPill label={`≤ ${target.maxWarehouses} nodes${warehousesOk ? " ✓" : ` (P=${pValue})`}`} hit={warehousesOk} />
        <GoalPill
          label={result ? `avg ${result.weightedAvgDistanceMi.toFixed(0)} mi${distanceOk ? " ✓" : ""}` : `avg < ${target.maxAvgDistance} mi`}
          hit={distanceOk}
        />
      </div>
    </div>
  );
}

function GoalPill({ label, hit }: { label: string; hit: boolean }) {
  return (
    <div style={{
      fontFamily: "var(--arc-mono)", fontSize: "11px",
      padding: "5px 9px", borderRadius: "7px",
      border: `1px solid ${hit ? "rgba(127,209,122,.5)" : "var(--arc-grat)"}`,
      color: hit ? "var(--arc-good)" : "var(--arc-muted)",
      background: hit ? "rgba(127,209,122,.08)" : "transparent",
      transition: "all 0.3s", whiteSpace: "nowrap",
    }}>
      {label}
    </div>
  );
}
