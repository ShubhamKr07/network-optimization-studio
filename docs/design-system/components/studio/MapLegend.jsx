import React from "react";
function Tri({ mode }) {
  var stroke = mode === "dashed" ? "var(--map-inactive)" : mode === "filled" ? "var(--green-700)" : "var(--map-warehouse)";
  return (
    <svg width="16" height="14" style={{ flexShrink: 0 }}>
      <polygon points="8,2 15,13 1,13" fill={mode === "filled" ? "var(--map-warehouse-open)" : "none"} stroke={stroke} strokeWidth="1.5" strokeDasharray={mode === "dashed" ? "3 2" : "none"} />
    </svg>
  );
}
export function MapLegend({ demandRefs = [5000, 15000, 30000], style }) {
  var statuses = [["outline", "Potential"], ["filled", "Fixed-Open"], ["dashed", "Inactive"]];
  return (
    <div style={Object.assign({ background: "var(--surface-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)", padding: 8, display: "flex", flexDirection: "column", gap: 8, fontFamily: "var(--font-sans)", fontSize: "11px", pointerEvents: "none", width: "fit-content" }, style)}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {statuses.map(function (s) {
          return <span key={s[0]} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)" }}><Tri mode={s[0]} />{s[1]}</span>;
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {demandRefs.map(function (d, i) {
          var r = 4 + i * 4;
          return (
            <span key={d} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)" }}>
              <svg width={r * 2 + 4} height={r * 2 + 4}><circle cx={r + 2} cy={r + 2} r={r} fill="var(--map-customer)" fillOpacity=".55" stroke="var(--map-customer-stroke)" strokeWidth="1.2" /></svg>
              {d.toLocaleString()}
            </span>
          );
        })}
      </div>
    </div>
  );
}
