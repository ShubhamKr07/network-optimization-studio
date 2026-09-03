import React from "react";
(function(){if(typeof document==="undefined"||document.getElementById("scnd-input-css"))return;var s=document.createElement("style");s.id="scnd-input-css";s.textContent=
".scnd-input{display:flex;width:100%;box-sizing:border-box;height:var(--control-h,36px);border-radius:var(--radius-md);border:1px solid var(--border-input);background:var(--surface-card);padding:0 10px;font-family:var(--font-sans);font-size:13px;color:var(--text-body);transition:border-color .14s ease}"+
".scnd-input::placeholder{color:var(--text-faint)}"+
".scnd-input:focus-visible{outline:2px solid var(--focus-ring);outline-offset:0;border-color:var(--green-500)}"+
".scnd-input[disabled]{opacity:.5;cursor:not-allowed}"+
".scnd-input--sm{height:var(--control-h-sm,30px);font-size:12px;padding:0 8px}"+
".scnd-input--mono{font-family:var(--font-mono)}";
document.head.appendChild(s);})();

export function Input({ size = "default", mono, label, style, ...rest }) {
  var cls = "scnd-input" + (size === "sm" ? " scnd-input--sm" : "") + (mono ? " scnd-input--mono" : "");
  var input = <input className={cls} style={style} {...rest} />;
  if (!label) return input;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontFamily: "var(--font-sans)" }}>
      <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)" }}>{label}</span>
      {input}
    </label>
  );
}
