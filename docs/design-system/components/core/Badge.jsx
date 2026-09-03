import React from "react";
var PALETTE = {
  default:   { bg: "var(--primary)", fg: "var(--text-on-primary)", border: "var(--green-700)" },
  secondary: { bg: "var(--green-050)", fg: "var(--green-700)", border: "var(--green-200)" },
  outline:   { bg: "transparent", fg: "var(--text-body)", border: "var(--line-strong)" },
  success:   { bg: "var(--success-bg)", fg: "var(--success)", border: "var(--success-border)" },
  warning:   { bg: "var(--warning-bg)", fg: "var(--warning)", border: "var(--warning-border)" },
  danger:    { bg: "var(--danger-bg)", fg: "var(--danger)", border: "var(--danger-border)" }
};
export function Badge({ variant = "default", mono, children, style }) {
  var p = PALETTE[variant] || PALETTE.default;
  return (
    <span style={Object.assign({
      display: "inline-flex", alignItems: "center", whiteSpace: "nowrap",
      borderRadius: "var(--radius-sm)", border: "1px solid " + p.border,
      background: p.bg, color: p.fg,
      fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
      fontSize: "10.5px", fontWeight: 600, padding: "2px 8px", lineHeight: 1.5
    }, style)}>{children}</span>
  );
}
