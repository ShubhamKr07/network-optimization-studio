import { useGamification } from "@/context/GamificationContext";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import type { SolveResult } from "@workspace/api-client-react";

interface ObjectiveBarProps {
  pValue: number;
  result: SolveResult | null;
  scenarioId: number | undefined;
}

interface QuestGoal {
  questId: number;
  chapter: string;
  title: string;
  tagline: string;
  maxWarehouses: number;
  maxAvgDistance: number;
  targetDistance: number;
}

const QUEST_GOALS: Record<number, QuestGoal> = {
  1: {
    questId: 1,
    chapter: "Chapter 3 · Al's Athletics · Quest",
    title: "Beat 390 mi using ≤ 3 warehouses",
    tagline: "serve all 200 customers.",
    maxWarehouses: 3,
    maxAvgDistance: 390,
    targetDistance: 360,
  },
  2: {
    questId: 2,
    chapter: "Chapter 5 · Coal Transport LP · Quest",
    title: "Beat 500 mi using ≤ 5 supply nodes",
    tagline: "minimise haul distance across all demand points.",
    maxWarehouses: 5,
    maxAvgDistance: 500,
    targetDistance: 430,
  },
};

const XP_MAP: Record<number, number> = { 1: 150, 2: 300, 3: 450 };

function computeStars(result: SolveResult, pValue: number, goal: QuestGoal): number {
  const warehousesOk = pValue <= goal.maxWarehouses;
  const distanceOk = result.weightedAvgDistanceMi < goal.maxAvgDistance;
  if (!warehousesOk || !distanceOk) return 1;
  if (result.weightedAvgDistanceMi < goal.targetDistance) return 3;
  return 2;
}

export function ObjectiveBar({ pValue, result, scenarioId }: ObjectiveBarProps) {
  const { awardXP, state } = useGamification();
  const { toast } = useToast();
  const [xpBurst, setXpBurst] = useState<{ amount: number; key: number } | null>(null);
  const lastAwardedKey = useRef<string | null>(null);

  const goal = (scenarioId && QUEST_GOALS[scenarioId]) ? QUEST_GOALS[scenarioId] : QUEST_GOALS[1];

  const warehousesOk = pValue <= goal.maxWarehouses;
  const distanceOk = result ? result.weightedAvgDistanceMi < goal.maxAvgDistance : false;

  useEffect(() => {
    if (!result || !scenarioId || result.status !== "optimal") return;
    const stars = computeStars(result, pValue, goal);
    const xpAmount = XP_MAP[stars] ?? 150;

    const awardKey = `${scenarioId}-${stars}-${result.weightedAvgDistanceMi.toFixed(1)}`;
    if (lastAwardedKey.current === awardKey) return;

    const existingSolve = state.solvedScenarios[scenarioId];
    const alreadySolvedBetter = existingSolve && existingSolve.stars >= stars;
    if (alreadySolvedBetter) return;

    lastAwardedKey.current = awardKey;
    awardXP(xpAmount, scenarioId, stars, result.weightedAvgDistanceMi);
    setXpBurst({ amount: xpAmount, key: Date.now() });

    const starStr = "★".repeat(stars) + "☆".repeat(3 - stars);
    const context = stars >= 2
      ? `${starStr}  Avg distance: ${result.weightedAvgDistanceMi.toFixed(1)} mi`
      : `${starStr}  ${pValue > goal.maxWarehouses ? `Used ${pValue} nodes (target ≤ ${goal.maxWarehouses})` : `Avg ${result.weightedAvgDistanceMi.toFixed(1)} mi (target < ${goal.maxAvgDistance})`}`;

    toast({
      title: `+${xpAmount} XP${stars >= 2 ? " · scenario cleared 🎉" : " · keep going!"}`,
      description: context,
    });
    setTimeout(() => setXpBurst(null), 3000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.status, result?.weightedAvgDistanceMi, scenarioId, pValue]);

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
          {goal.chapter}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <b style={{ fontFamily: "var(--arc-display)", fontSize: "13px", fontWeight: 600, color: "var(--arc-paper)" }}>
            {goal.title}
          </b>
          <span style={{ color: "var(--arc-muted)", fontSize: "12px" }}>— {goal.tagline}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: "7px", flexShrink: 0 }}>
        <GoalPill label={`≤ ${goal.maxWarehouses} nodes${warehousesOk ? " ✓" : ` (P=${pValue})`}`} hit={warehousesOk} />
        <GoalPill
          label={result ? `avg ${result.weightedAvgDistanceMi.toFixed(0)} mi${distanceOk ? " ✓" : ""}` : `avg < ${goal.maxAvgDistance} mi`}
          hit={distanceOk}
        />
      </div>

      {xpBurst && (
        <div key={xpBurst.key} style={{
          position: "absolute", right: "20px", top: "50%", transform: "translateY(-50%)",
          fontFamily: "var(--arc-mono)", fontSize: "13px", color: "var(--arc-amber)",
          animation: "arc-xp-burst 2.5s ease-out forwards",
          pointerEvents: "none",
        }}>
          +{xpBurst.amount} XP 🎉
        </div>
      )}
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
