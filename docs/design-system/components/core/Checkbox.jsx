import React from "react";
export function Checkbox({ checked, onChange, label, disabled }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--text-body)" }}>
      <span
        role="checkbox"
        aria-checked={!!checked}
        tabIndex={disabled ? -1 : 0}
        onClick={function () { if (!disabled && onChange) onChange(!checked); }}
        onKeyDown={function (e) { if (!disabled && (e.key === " " || e.key === "Enter")) { e.preventDefault(); if (onChange) onChange(!checked); } }}
        style={{
          width: 15, height: 15, flexShrink: 0, borderRadius: "var(--radius-sm)", boxSizing: "border-box",
          border: "1px solid " + (checked ? "var(--green-700)" : "var(--border-input)"),
          background: checked ? "var(--primary)" : "var(--surface-card)",
          display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "background .12s ease"
        }}
      >
        {checked ? <svg width="9" height="7" viewBox="0 0 9 7"><path d="M1 3.5L3.4 6 8 1" fill="none" stroke="#fff" strokeWidth="1.6" /></svg> : null}
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  );
}
