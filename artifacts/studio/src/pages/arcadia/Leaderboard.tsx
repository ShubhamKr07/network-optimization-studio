import { useGamification } from "@/context/GamificationContext";

const COHORT_OTHERS = [
  { initials: "PR", name: "Priya R.", models: 7, bestDist: 309, xp: 7140, color: "#F2B45C", cls: "top1" },
  { initials: "JK", name: "Jordan K.", models: 7, bestDist: 318, xp: 6205, color: "#C7D3D6", cls: "top2" },
  { initials: "MA", name: "Mateo A.", models: 6, bestDist: 324, xp: 5990, color: "#F2745C", cls: "top3" },
  { initials: "LZ", name: "Lena Z.", models: 5, bestDist: 342, xp: 4510, color: "#8aa" },
  { initials: "TO", name: "Tomás O.", models: 5, bestDist: 351, xp: 4300, color: "#9b8" },
  { initials: "AN", name: "Aisha N.", models: 4, bestDist: 358, xp: 3980, color: "#b89" },
  { initials: "DM", name: "Diego M.", models: 4, bestDist: 372, xp: 3650, color: "#a9b" },
];

export function Leaderboard() {
  const { state } = useGamification();

  const solvedScenarios = Object.values(state.solvedScenarios);
  const solvedCount = solvedScenarios.length;
  const bestAvgDist = solvedScenarios.length > 0
    ? Math.round(Math.min(...solvedScenarios.map(s => s.avgDistance)))
    : null;

  const meRow = {
    initials: "SC",
    name: "You",
    models: solvedCount,
    bestDist: bestAvgDist,
    xp: state.xp,
    color: "#57D0C9",
    isMe: true,
  };

  const allRows = [
    ...COHORT_OTHERS.map(r => ({ ...r, isMe: false })),
    meRow,
  ].sort((a, b) => b.xp - a.xp);

  const ranked = allRows.map((r, i) => ({ ...r, rank: i + 1 }));

  const rankColor = (rank: number) => {
    if (rank === 1) return "var(--arc-amber)";
    if (rank === 2) return "#C7D3D6";
    if (rank === 3) return "var(--arc-coral)";
    return "var(--arc-muted)";
  };

  return (
    <div style={{ padding: "26px 28px 60px", maxWidth: "1320px", width: "100%", animation: "arc-rise 0.4s cubic-bezier(.2,.7,.2,1)" }}>
      <div style={{ marginBottom: "18px" }}>
        <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--arc-amber)", marginBottom: "4px" }}>
          Cohort · MEM Operations · Spring
        </div>
        <h1 style={{ fontFamily: "var(--arc-display)", fontSize: "26px", marginBottom: "6px", color: "var(--arc-paper)" }}>Leaderboard</h1>
        <p style={{ color: "var(--arc-muted)", maxWidth: "60ch", margin: 0 }}>
          Ranked by XP across every solved scenario. Beating a target distance or clearing a daily challenge moves you up — efficiency is the whole game.
        </p>
      </div>

      <div className="arc-card" style={{ padding: "6px 0" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "54px 1fr 120px 120px 90px",
          alignItems: "center", padding: "11px 22px", gap: "12px",
          fontFamily: "var(--arc-mono)", fontSize: "10.5px", letterSpacing: "0.1em",
          textTransform: "uppercase", color: "var(--arc-muted)",
          borderBottom: "1px solid var(--arc-grat-soft)"
        }}>
          <span>Rank</span>
          <span>Solver</span>
          <span>Models</span>
          <span>Best avg</span>
          <span>XP</span>
        </div>

        {ranked.map((row, i) => {
          const isMe = !!row.isMe;
          const modelsDisplay = isMe
            ? `${row.models} / 7`
            : `${row.models} / 7`;
          const bestDistDisplay = isMe
            ? (row.bestDist !== null ? `${row.bestDist} mi` : "—")
            : `${row.bestDist} mi`;

          return (
            <div key={row.initials + row.rank} style={{
              display: "grid", gridTemplateColumns: "54px 1fr 120px 120px 90px",
              alignItems: "center", padding: "11px 22px", gap: "12px",
              borderBottom: i < ranked.length - 1 ? "1px dashed var(--arc-grat-soft)" : "none",
              ...(isMe ? {
                background: "linear-gradient(90deg, rgba(242,180,92,.08), transparent)",
                borderRadius: "10px"
              } : {}),
            }}>
              <span style={{
                fontFamily: "var(--arc-display)", fontSize: "18px",
                color: rankColor(row.rank)
              }}>
                {row.rank}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "11px", fontWeight: 500 }}>
                <div style={{
                  width: "34px", height: "34px", borderRadius: "9px", flexShrink: 0,
                  display: "grid", placeItems: "center",
                  fontFamily: "var(--arc-display)", fontSize: "12px", color: "var(--arc-ink)",
                  background: row.color
                }}>
                  {row.initials}
                </div>
                <span style={{ color: isMe ? "var(--arc-amber)" : "var(--arc-paper)" }}>{row.name}</span>
              </div>
              <span style={{ fontFamily: "var(--arc-mono)", fontSize: "13px", color: "var(--arc-muted)" }}>{modelsDisplay}</span>
              <span style={{ fontFamily: "var(--arc-mono)", fontSize: "13px", color: "var(--arc-muted)" }}>{bestDistDisplay}</span>
              <span style={{ fontFamily: "var(--arc-mono)", color: "var(--arc-amber)" }}>{row.xp.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
