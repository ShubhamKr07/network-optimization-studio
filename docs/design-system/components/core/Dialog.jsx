import React from "react";
export function Dialog({ open, title, description, children, footer, onClose, width }) {
  if (!open) return null;
  return (
    <div
      onClick={function (e) { if (e.target === e.currentTarget && onClose) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(24,26,21,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
    >
      <div role="dialog" aria-modal="true" style={{
        background: "var(--surface-card)", borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-strong)", boxShadow: "var(--shadow-overlay)",
        width: width || 440, maxWidth: "calc(100vw - 48px)", fontFamily: "var(--font-sans)", color: "var(--text-body)"
      }}>
        <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            {title ? <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "17px" }}>{title}</div> : null}
            {description ? <div style={{ fontSize: "12.5px", color: "var(--text-muted)", marginTop: 4, lineHeight: 1.45 }}>{description}</div> : null}
          </div>
          {onClose ? (
            <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: 2, lineHeight: 0 }}>
              <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
          ) : null}
        </div>
        {children ? <div style={{ padding: "14px 20px" }}>{children}</div> : null}
        {footer ? <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-default)", display: "flex", justifyContent: "flex-end", gap: 8, background: "var(--surface-sunken)", borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>{footer}</div> : null}
      </div>
    </div>
  );
}
