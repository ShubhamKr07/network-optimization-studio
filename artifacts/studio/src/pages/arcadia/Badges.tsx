import { useGamification } from "@/context/GamificationContext";

interface Badge {
  id: string;
  label: string;
  desc: string;
  icon: string;
}

const BADGES: Badge[] = [
  { id: "first_solve", label: "First Solve", desc: "Cleared your first scenario", icon: `<path d="M12 2l2.4 7.4H22l-6 4.5 2.3 7.1L12 16.5 5.7 21l2.3-7.1-6-4.5h7.6z"/>` },
  { id: "three_stars", label: "Three Stars", desc: "Perfected a model", icon: `<path d="M5 13l4 4L19 7"/>` },
  { id: "flow_master", label: "Flow Master", desc: "Solved the transport LP", icon: `<path d="M3 12h18M3 12l4-4M3 12l4 4"/>` },
  { id: "speed_solver", label: "Speed Solver", desc: "Solved under 30 seconds", icon: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>` },
  { id: "capacitated", label: "Capacitated", desc: "Beat the Brazil case", icon: `<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/>` },
  { id: "pareto_pioneer", label: "Pareto Pioneer", desc: "Map a trade-off frontier", icon: `<path d="M12 3v18M3 12h18"/>` },
  { id: "architect", label: "Architect", desc: "Finish the capstone", icon: `<path d="M5 21V7l7-4 7 4v14"/>` },
  { id: "cohort_champion", label: "Cohort Champion", desc: "Reach #1 for a week", icon: `<path d="M6 9a6 6 0 0012 0V4H6z"/>` },
];

const SKILLS = [
  { label: "Facility location", level: 4, pct: 78 },
  { label: "Linear programming", level: 3, pct: 61 },
  { label: "Capacity & flow", level: 2, pct: 40 },
  { label: "Service-level design", level: 3, pct: 55 },
  { label: "Solver fluency", level: 1, pct: 18 },
];

const RECENT_UNLOCKS = [
  { emoji: "⚡", color: "#F2B45C", label: "Optimal on first try", desc: "solved a scenario with no failed runs", xp: 120 },
  { emoji: "📍", color: "#57D0C9", label: "Coast to coast", desc: "served all 4 US regions under 400 mi", xp: 90 },
  { emoji: "🔥", color: "#F2745C", label: "Week-long streak", desc: "7 days in the lab", xp: 150 },
];

export function Badges() {
  const { state } = useGamification();
  const earned = new Set(state.earnedBadges);

  return (
    <div style={{ padding: "26px 28px 60px", maxWidth: "1320px", width: "100%", animation: "arc-rise 0.4s cubic-bezier(.2,.7,.2,1)" }}>
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--arc-amber)", marginBottom: "4px" }}>Progress</div>
        <h1 style={{ fontFamily: "var(--arc-display)", fontSize: "26px", marginBottom: "6px", color: "var(--arc-paper)" }}>Badges &amp; mastery</h1>
        <p style={{ color: "var(--arc-muted)", maxWidth: "60ch", margin: 0 }}>
          Skills level up as you solve more scenarios and beat targets. Badges mark the milestones worth showing off.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", marginBottom: "24px" }}>
        {/* Skill mastery */}
        <div className="arc-card" style={{ padding: "18px 20px" }}>
          <h3 style={{ fontFamily: "var(--arc-display)", fontSize: "15px", marginBottom: "18px", color: "var(--arc-paper)" }}>Concept mastery</h3>
          {SKILLS.map(skill => (
            <div key={skill.label} style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "7px" }}>
                <b style={{ fontWeight: 600, color: "var(--arc-paper)" }}>{skill.label}</b>
                <span style={{ fontFamily: "var(--arc-mono)", fontSize: "11px", color: "var(--arc-amber)" }}>Lv {skill.level} · {skill.pct}%</span>
              </div>
              <div style={{ height: "8px", borderRadius: "20px", background: "var(--arc-ink-3)", overflow: "hidden", border: "1px solid var(--arc-grat-soft)" }}>
                <div style={{ height: "100%", width: `${skill.pct}%`, background: "linear-gradient(90deg, var(--arc-cyan), var(--arc-amber))", borderRadius: "20px" }} />
              </div>
            </div>
          ))}
        </div>

        {/* Recent unlocks */}
        <div className="arc-card" style={{ padding: "18px 20px" }}>
          <h3 style={{ fontFamily: "var(--arc-display)", fontSize: "15px", marginBottom: "18px", color: "var(--arc-paper)" }}>Recent unlocks</h3>
          {RECENT_UNLOCKS.map(u => (
            <div key={u.label} style={{
              display: "flex", alignItems: "center", gap: "12px",
              padding: "8px 0", borderBottom: "1px dashed var(--arc-grat-soft)"
            }}>
              <div style={{ width: "34px", height: "34px", borderRadius: "9px", display: "grid", placeItems: "center", background: u.color, fontSize: "18px", flexShrink: 0 }}>{u.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13.5px", fontWeight: 500, color: "var(--arc-paper)" }}>{u.label}</div>
                <small style={{ display: "block", fontFamily: "var(--arc-mono)", fontSize: "10px", color: "var(--arc-muted)" }}>{u.desc}</small>
              </div>
              <div style={{ fontFamily: "var(--arc-mono)", fontSize: "12px", color: "var(--arc-muted)" }}>+{u.xp}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Badge grid */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", margin: "30px 2px 14px" }}>
        <h2 style={{ fontFamily: "var(--arc-display)", fontSize: "19px", color: "var(--arc-paper)" }}>Badge collection</h2>
        <span style={{ fontFamily: "var(--arc-mono)", fontSize: "12px", color: "var(--arc-muted)" }}>
          <b style={{ color: "var(--arc-paper)" }}>{earned.size}</b> of 24 earned
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "14px" }}>
        {BADGES.map(badge => {
          const isEarned = earned.has(badge.id);
          return (
            <div key={badge.id} className="arc-card" style={{ padding: "18px 14px", textAlign: "center" }}>
              <div style={{
                width: "64px", height: "64px", margin: "0 auto 12px", borderRadius: "50%",
                display: "grid", placeItems: "center",
                background: isEarned
                  ? "radial-gradient(circle at 35% 30%, rgba(242,180,92,.25), rgba(242,180,92,.05))"
                  : "radial-gradient(circle at 35% 30%, var(--arc-ink-3), var(--arc-ink-2))",
                border: `2px solid ${isEarned ? "var(--arc-amber)" : "var(--arc-grat)"}`,
                color: isEarned ? "var(--arc-amber)" : "var(--arc-muted-2)",
                boxShadow: isEarned ? "0 0 26px -6px rgba(242,180,92,.4)" : "none",
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                  dangerouslySetInnerHTML={{ __html: badge.icon }} />
              </div>
              <h4 style={{
                fontFamily: "var(--arc-display)", fontSize: "13px", marginBottom: "4px",
                color: "var(--arc-paper)", opacity: isEarned ? 1 : 0.55
              }}>{badge.label}</h4>
              <p style={{ fontSize: "11px", color: "var(--arc-muted)", margin: 0, lineHeight: 1.4, opacity: isEarned ? 1 : 0.55 }}>{badge.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
