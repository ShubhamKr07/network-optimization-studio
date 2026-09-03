import React from "react";
(function(){if(typeof document==="undefined"||document.getElementById("scnd-side-css"))return;var s=document.createElement("style");s.id="scnd-side-css";s.textContent=
".scnd-siderow{display:block;width:100%;text-align:left;padding:6px 12px;border:none;background:none;font-family:var(--font-sans);font-size:12.5px;color:var(--text-muted);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box;border-left:2px solid transparent}"+
".scnd-siderow:hover{background:var(--surface-sunken);color:var(--text-body)}"+
".scnd-siderow--active{background:var(--surface-selected);color:var(--green-700);font-weight:500;border-left-color:var(--green-500)}"+
".scnd-siderow[disabled]{color:var(--ink-300);cursor:not-allowed;background:none}";
document.head.appendChild(s);})();

export function SidebarTree({ sections = [], activeId, onSelect, width, style }) {
  return (
    <nav style={Object.assign({ width: width || "var(--sidebar-w, 224px)", borderRight: "1px solid var(--border-default)", background: "var(--surface-card)", overflowY: "auto", fontFamily: "var(--font-sans)", flexShrink: 0, display: "flex", flexDirection: "column" }, style)}>
      {sections.map(function (sec) {
        return (
          <div key={sec.title} style={{ borderBottom: "1px solid var(--border-default)", padding: "6px 0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 12px", fontFamily: "var(--font-mono)", fontSize: "9.5px", fontWeight: 600, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)" }}>
              <span>{sec.title}</span>
              {sec.onAction ? (
                <button type="button" aria-label={sec.actionLabel || "Add"} onClick={sec.onAction} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, lineHeight: 0 }}>
                  <svg width="11" height="11" viewBox="0 0 11 11"><path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.4" /></svg>
                </button>
              ) : null}
            </div>
            {(sec.items || []).map(function (it) {
              var active = it.id === activeId;
              return (
                <button key={it.id} type="button" disabled={it.disabled}
                  className={"scnd-siderow" + (active ? " scnd-siderow--active" : "")}
                  onClick={function () { if (!it.disabled && onSelect) onSelect(it.id); }}>
                  {it.label}
                </button>
              );
            })}
            {(sec.items || []).length === 0 ? <div style={{ padding: "5px 12px", fontSize: "11px", color: "var(--text-faint)" }}>{sec.emptyLabel || "Empty"}</div> : null}
          </div>
        );
      })}
    </nav>
  );
}
