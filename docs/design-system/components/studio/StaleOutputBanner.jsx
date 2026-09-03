import React from "react";
import { Button } from "../core/Button.jsx";
export function StaleOutputBanner({ onRunOptimizer, solved = true }) {
  return (
    <div style={{ height: "100%", minHeight: 220, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", padding: 16, fontFamily: "var(--font-sans)" }}>
      <svg width="26" height="24" viewBox="0 0 26 24"><path d="M13 2L25 22H1L13 2z" fill="none" stroke="var(--warning)" strokeWidth="1.8" strokeLinejoin="round"/><path d="M13 9v6" stroke="var(--warning)" strokeWidth="1.8"/><circle cx="13" cy="18.4" r="1.1" fill="var(--warning)"/></svg>
      <p style={{ margin: 0, fontSize: "13px", fontWeight: 500, color: "var(--text-body)" }}>
        {solved ? "Inputs changed since last solve" : "Not yet solved"}
      </p>
      <p style={{ margin: 0, fontSize: "11.5px", color: "var(--text-muted)", maxWidth: 340, lineHeight: 1.5 }}>
        {solved
          ? "This scenario's outputs no longer reflect its current inputs. Re-run the optimizer to see up-to-date results."
          : "Run the optimizer to generate outputs for this scenario."}
      </p>
      <Button size="sm" onClick={onRunOptimizer}>Run Optimizer</Button>
    </div>
  );
}
