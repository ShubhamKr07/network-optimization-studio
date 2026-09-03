import React from "react";
export function StatPill({ label }) {
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", padding: "4px 9px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", color: "var(--text-muted)", whiteSpace: "nowrap", background: "var(--surface-card)" }}>{label}</span>
  );
}
export function ObjectiveBar({ kicker = "Model", title, scenarioName, description, stats = [] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 14px", background: "var(--surface-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", fontFamily: "var(--font-sans)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "9.5px", letterSpacing: "var(--tracking-caps-wide)", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 1 }}>{kicker}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <b style={{ fontFamily: "var(--font-display)", fontSize: "13.5px", fontWeight: 600, color: "var(--text-body)" }}>{title}</b>
          {scenarioName ? <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>&middot; {scenarioName}</span> : null}
        </div>
        {description ? <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: 2, lineHeight: 1.35 }}>{description}</div> : null}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {(stats.length ? stats : ["Not yet solved"]).map(function (s, i) { return <StatPill key={i} label={s} />; })}
      </div>
    </div>
  );
}
