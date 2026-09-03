import React from "react";
(function(){if(typeof document==="undefined"||document.getElementById("scnd-chip-css"))return;var s=document.createElement("style");s.id="scnd-chip-css";s.textContent=
".scnd-chip{font-family:var(--font-mono);font-size:10px;padding:2px 7px;border-radius:var(--radius-sm);border:1px solid var(--border-default);background:var(--surface-card);color:var(--text-muted);cursor:pointer;transition:border-color .12s ease,color .12s ease;white-space:nowrap}"+
".scnd-chip:hover{border-color:var(--green-400);color:var(--text-body)}";
document.head.appendChild(s);})();

export function ConstraintChips({ chips = [], stale }) {
  return (
    <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", background: "var(--surface-sunken)" }}>
      {chips.map(function (c, i) {
        var chip = typeof c === "string" ? { label: c } : c;
        return <button key={i} type="button" className="scnd-chip" onClick={chip.onClick}>{chip.label}</button>;
      })}
      {stale ? (
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-sm)", border: "1px solid var(--warning-border)", background: "var(--warning-bg)", color: "var(--warning)" }}>Stale</span>
      ) : null}
    </div>
  );
}
