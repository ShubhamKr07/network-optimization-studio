import React from "react";
import { Button } from "../core/Button.jsx";
import { Input } from "../core/Input.jsx";

// Canned stub replies, isolated behind getReply(text, ctx) so a real LLM call
// can replace this whole function in Bundle 7 without touching the panel — the
// props/ctx contract stays the same. Keyed on the suggested prompts, with a
// context-aware fallback for anything else.
var CANNED = {
  "Explain this solve":
    "This scenario opens p warehouses to minimize total demand-weighted distance. (Stub reply — a real explanation lands in Bundle 7.)",
  "Why was Reno not opened?":
    "Reno's demand was cheaper to serve from nearer open sites, so opening it wouldn't lower the objective. (Stub reply.)",
  "What happens if p = 5?":
    "Raising p to 5 opens one more warehouse — usually lowering weighted distance with diminishing returns. (Stub reply.)"
};

export function getReply(text, ctx) {
  ctx = ctx || {};
  var hit = CANNED[(text || "").trim()];
  if (hit) return hit;
  if (!ctx.solved) return "Run the optimizer first, then I can explain the result. (Stub reply.)";
  if (ctx.stale) return "The inputs changed since the last solve — re-run for a current answer. (Stub reply.)";
  return "I can help interpret this solve (scenario “" + (ctx.scenario || "") + "”, p = " +
    (ctx.p != null ? ctx.p : "?") + "). (Stub reply — real answers in Bundle 7.)";
}

var SUGGESTIONS = ["Explain this solve", "Why was Reno not opened?", "What happens if p = 5?"];

export function AssistantPanel({ scenario, solved, stale, p, onClose }) {
  var ms = React.useState([]); // messages: { role: "user" | "ai", text }
  var messages = ms[0], setMessages = ms[1];
  var is = React.useState("");
  var input = is[0], setInput = is[1];
  var scrollRef = React.useRef(null);

  React.useEffect(function () {
    var el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function send(text) {
    var t = (text != null ? text : input).trim();
    if (!t) return;
    var reply = getReply(t, { scenario: scenario, solved: solved, stale: stale, p: p });
    setMessages(function (prev) { return prev.concat([{ role: "user", text: t }, { role: "ai", text: reply }]); });
    setInput("");
  }

  return (
    <div style={{ width: 300, flexShrink: 0, height: "100%", display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border-default)", background: "var(--surface-card)", fontFamily: "var(--font-sans)" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border-default)", flexShrink: 0 }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green-500)", flexShrink: 0 }} />
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-body)" }}>Assistant</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "9.5px", color: "var(--text-faint)", marginLeft: "auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{scenario}</span>
        <button type="button" aria-label="Close assistant" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0, color: "var(--text-muted)" }}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
      </div>

      {/* messages / empty state */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: "12px", lineHeight: 1.5 }}>
            <div style={{ marginBottom: 10 }}>Ask about this solve — what opened, why, and what changes if you tweak the inputs.</div>
            {SUGGESTIONS.map(function (q) {
              return (
                <button key={q} type="button" onClick={function () { send(q); }}
                  style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 6, padding: "7px 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", background: "var(--surface-sunken)", color: "var(--text-body)", fontFamily: "var(--font-sans)", fontSize: "12px", cursor: "pointer" }}>
                  {q}
                </button>
              );
            })}
          </div>
        ) : messages.map(function (m, i) {
          var user = m.role === "user";
          return (
            <div key={i} style={{ display: "flex", justifyContent: user ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "82%", padding: "7px 10px", fontSize: "12px", lineHeight: 1.45,
                background: user ? "var(--green-700)" : "var(--surface-sunken)",
                color: user ? "#fff" : "var(--text-body)",
                border: user ? "none" : "1px solid var(--border-default)",
                borderRadius: user ? "12px 12px 3px 12px" : "12px 12px 12px 3px",
                whiteSpace: "pre-wrap", wordBreak: "break-word"
              }}>{m.text}</div>
            </div>
          );
        })}
      </div>

      {/* footer */}
      <div style={{ display: "flex", gap: 6, padding: "10px 12px", borderTop: "1px solid var(--border-default)", flexShrink: 0 }}>
        <Input size="sm" value={input}
          onChange={function (e) { setInput(e.target.value); }}
          onKeyDown={function (e) { if (e.key === "Enter") { e.preventDefault(); send(); } }}
          placeholder="Ask the assistant…"
          style={{ flex: 1, minWidth: 0 }} />
        <Button size="sm" onClick={function () { send(); }}>Send</Button>
      </div>
    </div>
  );
}
