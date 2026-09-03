import React from "react";
export function Tabs({ tabs = [], activeId, onChange, style }) {
  return (
    <div role="tablist" style={Object.assign({ display: "flex", gap: "2px", borderBottom: "1px solid var(--border-default)", fontFamily: "var(--font-sans)" }, style)}>
      {tabs.map(function (t) {
        var tab = typeof t === "string" ? { id: t, label: t } : t;
        var active = tab.id === activeId;
        return (
          <button
            key={tab.id} role="tab" aria-selected={active} type="button"
            onClick={function () { if (onChange) onChange(tab.id); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "8px 12px", fontSize: "12.5px",
              fontWeight: active ? 600 : 400,
              color: active ? "var(--green-700)" : "var(--text-muted)",
              borderBottom: "2px solid " + (active ? "var(--green-500)" : "transparent"),
              marginBottom: "-1px", fontFamily: "inherit"
            }}
          >{tab.label}</button>
        );
      })}
    </div>
  );
}
