import React from "react";
export function Table({ columns = [], rows = [], compact, maxHeight, style }) {
  var cellPad = compact ? "6px 10px" : "9px 12px";
  return (
    <div style={Object.assign({ border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", overflow: "auto", maxHeight: maxHeight, background: "var(--surface-card)" }, style)}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-sans)", fontSize: "12.5px" }}>
        <thead>
          <tr>
            {columns.map(function (c) {
              return (
                <th key={c.key} style={{
                  position: "sticky", top: 0, background: "var(--surface-sunken)",
                  textAlign: c.align || "left", padding: cellPad,
                  fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 600,
                  letterSpacing: "var(--tracking-caps)", textTransform: "uppercase",
                  color: "var(--text-muted)", borderBottom: "1px solid var(--border-default)", whiteSpace: "nowrap"
                }}>{c.label}</th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(function (r, i) {
            return (
              <tr key={i} style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--border-default)" : "none" }}>
                {columns.map(function (c) {
                  return (
                    <td key={c.key} style={{
                      padding: cellPad, textAlign: c.align || "left",
                      fontFamily: c.mono ? "var(--font-mono)" : "var(--font-sans)",
                      fontSize: c.mono ? "12px" : "12.5px",
                      color: "var(--text-body)", whiteSpace: "nowrap"
                    }}>{r[c.key]}</td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
