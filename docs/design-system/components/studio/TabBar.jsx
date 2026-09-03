import React from "react";
export function TabBar({ tabs = [], activeTabId, onActivate, onClose }) {
  if (!tabs.length) {
    return (
      <div style={{ height: "var(--tabbar-h, 36px)", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", padding: "0 12px", fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--text-muted)", background: "var(--surface-sunken)", flexShrink: 0 }}>
        No tabs open — pick an item from the sidebar.
      </div>
    );
  }
  return (
    <div role="tablist" style={{ height: "var(--tabbar-h, 36px)", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "stretch", overflowX: "auto", background: "var(--surface-sunken)", flexShrink: 0, fontFamily: "var(--font-sans)" }}>
      {tabs.map(function (tab) {
        var active = tab.id === activeTabId;
        return (
          <div key={tab.id} role="tab" aria-selected={active}
            onClick={function () { if (onActivate) onActivate(tab.id); }}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "0 12px",
              borderRight: "1px solid var(--border-default)", fontSize: "11.5px",
              cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
              background: active ? "var(--surface-card)" : "transparent",
              color: active ? "var(--text-body)" : "var(--text-muted)",
              fontWeight: active ? 500 : 400,
              boxShadow: active ? "inset 0 2px 0 var(--green-500)" : "none"
            }}>
            <span>{tab.label}</span>
            {onClose ? (
              <button type="button" aria-label={"Close " + tab.label}
                onClick={function (e) { e.stopPropagation(); onClose(tab.id); }}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0, color: "inherit", opacity: .55 }}>
                <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.3" /></svg>
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
