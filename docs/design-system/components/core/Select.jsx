import React from "react";
(function(){if(typeof document==="undefined"||document.getElementById("scnd-select-css"))return;var s=document.createElement("style");s.id="scnd-select-css";s.textContent=
".scnd-select{appearance:none;-webkit-appearance:none;width:100%;box-sizing:border-box;height:var(--control-h,36px);border-radius:var(--radius-md);border:1px solid var(--border-input);background:var(--surface-card);padding:0 28px 0 10px;font-family:var(--font-sans);font-size:13px;color:var(--text-body);cursor:pointer}"+
".scnd-select:focus-visible{outline:2px solid var(--focus-ring);outline-offset:0}"+
".scnd-select--sm{height:var(--control-h-sm,30px);font-size:12px}";
document.head.appendChild(s);})();

export function Select({ options = [], value, onChange, size = "default", label, disabled, style }) {
  var sel = (
    <span style={{ position: "relative", display: "inline-flex", width: "100%" }}>
      <select
        className={"scnd-select" + (size === "sm" ? " scnd-select--sm" : "")}
        value={value}
        disabled={disabled}
        onChange={function (e) { if (onChange) onChange(e.target.value); }}
        style={style}
      >
        {options.map(function (o) {
          var opt = typeof o === "string" ? { value: o, label: o } : o;
          return <option key={opt.value} value={opt.value}>{opt.label}</option>;
        })}
      </select>
      <svg width="10" height="6" viewBox="0 0 10 6" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
        <path d="M1 1l4 4 4-4" fill="none" stroke="var(--ink-500)" strokeWidth="1.5" />
      </svg>
    </span>
  );
  if (!label) return sel;
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontFamily: "var(--font-sans)" }}>
      <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)" }}>{label}</span>
      {sel}
    </label>
  );
}
