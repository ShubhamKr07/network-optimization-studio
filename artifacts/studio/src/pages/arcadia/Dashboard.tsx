import { useGamification, LEVEL_NAMES, XP_THRESHOLDS } from "@/context/GamificationContext";

const COHORT_OTHERS = [
  { initials: "PR", name: "Priya R.", xp: 7140, color: "#F2B45C" },
  { initials: "JK", name: "Jordan K.", xp: 6205, color: "#C7D3D6" },
  { initials: "MA", name: "Mateo A.", xp: 5990, color: "#F2745C" },
  { initials: "LZ", name: "Lena Z.", xp: 4510, color: "#8aa" },
  { initials: "TO", name: "Tomás O.", xp: 4300, color: "#9b8" },
  { initials: "AN", name: "Aisha N.", xp: 3980, color: "#b89" },
];

const TOTAL_COHORT = 86;

function computeCohortRank(userXp: number): number {
  const higher = COHORT_OTHERS.filter(r => r.xp > userXp).length;
  return higher + 1;
}

function buildMiniLeaderboard(userXp: number) {
  const allRows = [
    ...COHORT_OTHERS.map(r => ({ ...r, isMe: false })),
    { initials: "SC", name: "You", xp: userXp, color: "#57D0C9", isMe: true },
  ].sort((a, b) => b.xp - a.xp);

  const meIdx = allRows.findIndex(r => r.isMe);
  const start = Math.max(0, meIdx - 2);
  const end = Math.min(allRows.length, start + 5);
  const slice = allRows.slice(start, end);

  return slice.map((r, i) => ({ ...r, rank: start + i + 1 }));
}

export function Dashboard() {
  const { state, setView, xpToNextLevel } = useGamification();
  const { pct } = xpToNextLevel();
  const levelName = LEVEL_NAMES[state.level - 1] ?? "Network Architect";
  const nextThreshold = XP_THRESHOLDS[state.level] ?? state.xp;

  const solvedCount = Object.keys(state.solvedScenarios).length;
  const badgesCount = state.earnedBadges.length;

  const solvedList = Object.values(state.solvedScenarios);
  const bestAvgDist = solvedList.length > 0
    ? Math.round(Math.min(...solvedList.map(s => s.avgDistance)))
    : null;

  const cohortRank = computeCohortRank(state.xp);
  const miniLeaderboard = buildMiniLeaderboard(state.xp);

  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const today = new Date();
  const dayName = days[today.getDay()];

  return (
    <div style={{ padding: "26px 28px 60px", maxWidth: "1320px", width: "100%", animation: "arc-rise 0.4s cubic-bezier(.2,.7,.2,1)" }}>
      {/* Hero + Continue */}
      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: "18px", marginBottom: "18px" }}>
        {/* Hero card */}
        <div className="arc-card" style={{ padding: "26px 28px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(420px 200px at 92% 8%, rgba(87,208,201,.10), transparent 70%)", pointerEvents: "none" }} />
          <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--arc-muted)" }}>
            {dayName} · Day {state.streakDays} streak 🔥
          </div>
          <h1 style={{ fontFamily: "var(--arc-display)", fontSize: "30px", lineHeight: 1.1, margin: "10px 0 6px", color: "var(--arc-paper)" }}>
            Welcome back, Shubham.
          </h1>
          <p style={{ color: "var(--arc-muted)", maxWidth: "46ch", margin: "0 0 20px", fontSize: "14px" }}>
            {solvedCount === 0
              ? "Start your first scenario to earn XP and climb the cohort leaderboard."
              : solvedCount < 4
              ? `You've solved ${solvedCount} scenario${solvedCount > 1 ? "s" : ""} — keep going to master Facility Location.`
              : "You're making great progress! Your next badge is within reach."}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "14px", marginTop: "6px" }}>
            <div style={{
              width: "58px", height: "58px", flexShrink: 0, borderRadius: "16px",
              display: "grid", placeItems: "center",
              background: "linear-gradient(150deg, var(--arc-amber), var(--arc-amber-deep))",
              color: "var(--arc-ink)", fontFamily: "var(--arc-display)",
              boxShadow: "0 10px 24px -10px var(--arc-amber-deep)"
            }}>
              <small style={{ display: "block", fontSize: "9px", fontFamily: "var(--arc-mono)", letterSpacing: "0.1em", opacity: 0.8, textAlign: "center", marginBottom: "-2px" }}>LVL</small>
              <b style={{ fontSize: "22px", lineHeight: 1 }}>{state.level}</b>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--arc-mono)", fontSize: "11.5px", color: "var(--arc-muted)", marginBottom: "7px" }}>
                <span>{levelName}</span>
                <span>{state.xp.toLocaleString()} / {nextThreshold.toLocaleString()} XP</span>
              </div>
              <div style={{ height: "9px", borderRadius: "30px", background: "var(--arc-ink-3)", overflow: "hidden", border: "1px solid var(--arc-grat-soft)" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, var(--arc-amber), var(--arc-cyan))", borderRadius: "30px", transition: "width 0.7s" }} />
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "22px" }}>
            <button className="arc-btn" onClick={() => setView("lab")} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 5v14l11-7z"/></svg>
              Resume scenario
            </button>
            <button className="arc-btn arc-btn--ghost" onClick={() => setView("quest")}>View the map</button>
          </div>
        </div>

        {/* Continue card */}
        <div className="arc-card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{
            height: "128px",
            background: "linear-gradient(transparent, rgba(11,31,42,.7)), radial-gradient(circle at 30% 40%, rgba(242,180,92,.25), transparent 9%), radial-gradient(circle at 62% 58%, rgba(242,116,92,.22), transparent 7%), radial-gradient(circle at 78% 35%, rgba(87,208,201,.22), transparent 8%), repeating-linear-gradient(0deg, transparent 0 22px, var(--arc-grat-soft) 22px 23px), repeating-linear-gradient(90deg, transparent 0 22px, var(--arc-grat-soft) 22px 23px), var(--arc-ink-3)",
            position: "relative"
          }} />
          <div style={{ padding: "16px 18px 18px", flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--arc-cyan)", marginBottom: "8px" }}>
              Continue · Chapter 3
            </div>
            <h3 style={{ fontFamily: "var(--arc-display)", fontSize: "17px", marginBottom: "4px", color: "var(--arc-paper)" }}>Al's Athletics — Best Warehouses</h3>
            <p style={{ color: "var(--arc-muted)", fontSize: "13px", margin: "0 0 14px" }}>
              Scenario 3 of 4 · find the best 4-warehouse network
            </p>
            <div style={{ height: "7px", borderRadius: "20px", background: "var(--arc-ink-3)", overflow: "hidden", marginBottom: "14px", border: "1px solid var(--arc-grat-soft)" }}>
              <div style={{ height: "100%", width: `${Math.min(100, (solvedCount / 4) * 100)}%`, background: "var(--arc-cyan)" }} />
            </div>
            <button className="arc-btn arc-btn--cyan" onClick={() => setView("lab")} style={{ width: "100%", justifyContent: "center" }}>
              Open in Lab
            </button>
          </div>
        </div>
      </div>

      {/* Stat grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "22px" }}>
        <StatCard label="Models mastered" value={`${solvedCount}`} suffix="/ 7" color="var(--arc-cyan)" />
        <StatCard label="Badges earned" value={`${badgesCount}`} suffix="/ 24" color="var(--arc-amber)" />
        <StatCard
          label="Cohort rank"
          value={`#${cohortRank}`}
          suffix={`of ${TOTAL_COHORT}`}
          color="var(--arc-coral)"
        />
        <StatCard
          label="Best avg distance"
          value={bestAvgDist !== null ? `${bestAvgDist}` : "—"}
          suffix={bestAvgDist !== null ? "mi" : "no solves yet"}
          color="var(--arc-paper)"
          mono
        />
      </div>

      {/* Today's run */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", margin: "30px 2px 14px" }}>
        <h2 style={{ fontFamily: "var(--arc-display)", fontSize: "19px", color: "var(--arc-paper)" }}>Today's run</h2>
        <button onClick={() => setView("board")} style={{ fontFamily: "var(--arc-mono)", fontSize: "12px", color: "var(--arc-cyan)", background: "none", border: "none", cursor: "pointer" }}>
          Cohort leaderboard →
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "18px" }}>
        {/* Daily challenge */}
        <div className="arc-card" style={{ padding: "22px 24px", position: "relative", overflow: "hidden", border: "1px solid rgba(242,116,92,.35)" }}>
          <div style={{ position: "absolute", right: "-40px", top: "-40px", width: "180px", height: "180px", borderRadius: "50%", background: "radial-gradient(circle, rgba(242,116,92,.22), transparent 65%)" }} />
          <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--arc-coral)" }}>Daily Challenge · resets in 6h</div>
          <h3 style={{ fontFamily: "var(--arc-display)", fontSize: "18px", margin: "10px 0 6px", color: "var(--arc-paper)" }}>The 3-Warehouse Squeeze</h3>
          <p style={{ color: "var(--arc-muted)", maxWidth: "40ch", margin: "0 0 16px", fontSize: "14px" }}>
            Serve every customer with exactly 3 warehouses and a weighted average distance under <b style={{ color: "var(--arc-paper)" }}>380 miles</b>. Lubbock must stay open.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--arc-mono)", fontSize: "12px", color: "var(--arc-amber)", marginBottom: "16px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="#F2B45C"/></svg>
            +250 XP · ⭐⭐⭐ if you beat 360 mi
          </div>
          <button className="arc-btn" onClick={() => setView("lab")}>Take the challenge</button>
        </div>

        {/* Mini leaderboard */}
        <div className="arc-card" style={{ padding: "18px 20px" }}>
          <h3 style={{ fontFamily: "var(--arc-display)", fontSize: "15px", marginBottom: "14px", color: "var(--arc-paper)", display: "flex", alignItems: "center", gap: "8px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--arc-amber)" strokeWidth="2"><path d="M6 9a6 6 0 0012 0V4H6z"/></svg>
            This week's top solvers
          </h3>
          {miniLeaderboard.map((row, i) => (
            <div key={row.initials + row.rank} style={{
              display: "flex", alignItems: "center", gap: "12px",
              padding: "8px 0",
              borderBottom: i < miniLeaderboard.length - 1 ? "1px dashed var(--arc-grat-soft)" : "none",
              ...(row.isMe ? { color: "var(--arc-amber)" } : {})
            }}>
              <div style={{ fontFamily: "var(--arc-mono)", fontSize: "13px", color: row.isMe ? "var(--arc-amber)" : "var(--arc-muted)", width: "22px" }}>{row.rank}</div>
              <div style={{ width: "30px", height: "30px", borderRadius: "9px", display: "grid", placeItems: "center", fontFamily: "var(--arc-display)", fontSize: "12px", color: "var(--arc-ink)", background: row.color, flexShrink: 0 }}>{row.initials}</div>
              <div style={{ flex: 1, fontSize: "13.5px", fontWeight: 500, color: row.isMe ? "var(--arc-amber)" : "var(--arc-paper)" }}>{row.name}</div>
              <div style={{ fontFamily: "var(--arc-mono)", fontSize: "12px", color: "var(--arc-muted)" }}>{row.xp.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, suffix, color, mono }: { label: string; value: string; suffix: string; color: string; mono?: boolean }) {
  return (
    <div className="arc-card" style={{ padding: "16px 18px" }}>
      <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", color: "var(--arc-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontFamily: mono ? "var(--arc-mono)" : "var(--arc-display)", fontSize: mono ? "26px" : "30px", marginTop: "8px", display: "flex", alignItems: "baseline", gap: "7px", color }}>
        {value}
        <small style={{ fontSize: "13px", color: "var(--arc-muted)", fontFamily: "var(--arc-mono)" }}>{suffix}</small>
      </div>
    </div>
  );
}
