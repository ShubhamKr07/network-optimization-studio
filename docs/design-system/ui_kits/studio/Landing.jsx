import React from "react";
import { Card } from "../../components/core/Card.jsx";
import { Badge } from "../../components/core/Badge.jsx";
import { Button } from "../../components/core/Button.jsx";
import { CHAPTERS } from "./data.js";

export function Landing({ onOpenChapter, onOpenSolve }) {
  var nums = ["03", "05", "05", "10"];
  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--surface-page)" }}>
      {/* dark band hero */}
      <div style={{ background: "var(--surface-band)", borderBottom: "2px solid var(--green-400)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "30px 24px", display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "var(--tracking-caps-wide)", textTransform: "uppercase", color: "var(--ink-300)", marginBottom: 8 }}>Optimization Studio by Prof. Michael Watson</div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "32px", color: "var(--green-400)", lineHeight: 1.1 }}>Network Design Labs</div>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--ink-300)", marginTop: 8 }}>Build a scenario on the map, solve it with a real optimizer, compare the results.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--ink-300)" }}>analyst@example.edu</span>
            <Button variant="ghost" size="sm" style={{ color: "var(--ink-300)" }}>Log out</Button>
          </div>
        </div>
      </div>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 600, margin: 0, color: "var(--text-body)" }}>Labs</h1>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--text-muted)", margin: "4px 0 18px" }}>Pick a chapter to start or continue a scenario.</p>
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", color: "var(--text-faint)" }}>4 labs · 2 scenarios · 3 solves</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {CHAPTERS.map(function (c, i) {
            return (
              <Card key={i} hoverable={i === 0} onClick={i === 0 ? onOpenChapter : undefined}
                kicker={c.chapter} title={c.title} description={c.description}
                footer={
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: "10.5px", color: "var(--text-muted)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px", color: "var(--green-400)" }}>{nums[i]}</span>
                      {i === 0 ? "2 scenarios · solved 2m ago" : "no scenarios yet"}
                    </span>
                    {i === 0 ? <Badge variant="success">active</Badge> : <span style={{ color: "var(--text-faint)" }}>start &rarr;</span>}
                  </span>
                } />
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 24, marginTop: 28, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, margin: "0 0 10px", color: "var(--text-body)" }}>Recent solves</h2>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "11.5px", color: "var(--text-muted)", margin: "-6px 0 10px" }}>Last completed solve per chapter — click to open it.</p>
            <div style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", background: "var(--surface-card)" }}>
              {[
                { ch: "Chapter 3", name: "Baseline", status: "succeeded", obj: "obj 2.38e+6", mi: "412.7 mi", s: "0.24s" }
              ].map(function (h, i, arr) {
                return (
                  <div key={i} onClick={function(){ if (onOpenSolve) onOpenSolve(h.name); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", borderBottom: i < arr.length - 1 ? "1px solid var(--border-default)" : "none", fontFamily: "var(--font-sans)", fontSize: "12.5px", cursor: "pointer" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", color: "var(--text-muted)" }}>{h.ch}</span>
                      <span style={{ color: "var(--text-faint)" }}>&middot;</span>
                      <b style={{ fontWeight: 500, color: "var(--text-body)" }}>{h.name}</b>
                      <Badge variant={h.status === "succeeded" ? "success" : h.status === "stale" ? "warning" : "danger"}>{h.status}</Badge>
                    </span>
                    <span style={{ display: "flex", gap: 12, fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
                      {h.obj ? <span>{h.obj}</span> : null}{h.mi ? <span>{h.mi}</span> : null}<span>run {h.s}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
