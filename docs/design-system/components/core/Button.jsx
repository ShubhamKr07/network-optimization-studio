import React from "react";
(function(){if(typeof document==="undefined"||document.getElementById("scnd-btn-css"))return;var s=document.createElement("style");s.id="scnd-btn-css";s.textContent=
".scnd-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;border-radius:var(--radius-md);font-family:var(--font-sans);font-size:13px;font-weight:500;cursor:pointer;transition:background .14s ease,border-color .14s ease;border:1px solid transparent;min-height:var(--control-h,36px);padding:0 16px;background:transparent;color:var(--text-body)}"+
".scnd-btn:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}"+
".scnd-btn[disabled]{opacity:.5;pointer-events:none}"+
".scnd-btn--primary{background:var(--primary);color:var(--text-on-primary);border-color:var(--green-700)}"+
".scnd-btn--primary:hover{background:var(--primary-hover)}"+
".scnd-btn--primary:active{background:var(--primary-active)}"+
".scnd-btn--secondary{background:var(--green-050);color:var(--green-700);border-color:var(--green-200)}"+
".scnd-btn--secondary:hover{background:var(--green-100)}"+
".scnd-btn--outline{background:var(--surface-card);color:var(--text-body);border-color:var(--border-input)}"+
".scnd-btn--outline:hover{background:var(--surface-sunken);border-color:var(--ink-400)}"+
".scnd-btn--ghost{color:var(--text-muted)}"+
".scnd-btn--ghost:hover{background:var(--surface-sunken);color:var(--text-body)}"+
".scnd-btn--destructive{background:var(--danger);color:#fff;border-color:#B91C1C}"+
".scnd-btn--destructive:hover{background:#B91C1C}"+
".scnd-btn--link{color:var(--link);text-decoration:underline;text-underline-offset:3px;min-height:0;padding:0;border:none}"+
".scnd-btn--link:hover{color:var(--link-hover)}"+
".scnd-btn--size-sm{min-height:var(--control-h-sm,30px);padding:0 12px;font-size:12px}"+
".scnd-btn--size-lg{min-height:40px;padding:0 24px;font-size:14px}"+
".scnd-btn--size-icon{width:36px;padding:0}";
document.head.appendChild(s);})();

export function Button({ variant = "primary", size = "default", disabled, children, onClick, style, type = "button", ...rest }) {
  var cls = "scnd-btn scnd-btn--" + variant + (size !== "default" ? " scnd-btn--size-" + size : "");
  return (
    <button type={type} className={cls} disabled={disabled} onClick={onClick} style={style} {...rest}>
      {children}
    </button>
  );
}
