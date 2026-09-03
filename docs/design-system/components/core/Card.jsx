import React from "react";
export function Card({ kicker, title, description, children, footer, selected, hoverable, onClick, style }) {
  return (
    <div
      onClick={onClick}
      style={Object.assign({
        background: "var(--surface-card)",
        border: "1px solid " + (selected ? "var(--green-400)" : "var(--border-default)"),
        borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)",
        fontFamily: "var(--font-sans)", color: "var(--text-body)",
        cursor: onClick || hoverable ? "pointer" : "default", overflow: "hidden"
      }, style)}
    >
      {(kicker || title || description) ? (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {kicker ? <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-muted)" }}>{kicker}</div> : null}
          {title ? <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "15px", lineHeight: 1.25 }}>{title}</div> : null}
          {description ? <div style={{ fontSize: "12.5px", color: "var(--text-muted)", lineHeight: 1.45 }}>{description}</div> : null}
        </div>
      ) : null}
      {children ? <div style={{ padding: "0 16px 14px" }}>{children}</div> : null}
      {footer ? <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border-default)", background: "var(--surface-sunken)" }}>{footer}</div> : null}
    </div>
  );
}
