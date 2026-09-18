/**
 * Provenance ledger — TWO-hook correlating parse (permission-review-loop plan, Task 6,
 * T0-confirmed signal). `PermissionRequest` fires only when a Bash command needs a permission
 * decision; `PostToolUse` fires after a tool call succeeds. Neither hook reports the human's
 * chosen option, but correlating both by `toolUseId` yields the observable, evidence-backed
 * `prompted_and_executed` signal — see
 * `docs/superpowers/specs/2026-09-18-permission-provenance-spike.md`.
 *
 * The raw ledger (`.harness/permissions/ledger.jsonl`, written by the standalone
 * `.claude/hooks/permission-ledger.mjs` hook) is gitignored and machine-local; this module only
 * parses/correlates text already read from disk — no I/O here.
 */

import type { Window } from "./permissions.js";
import { sha256Hex } from "../../../../.claude/hooks/lib/permissionsCore.mjs";

export type Provenance = "prompted_and_executed" | "prompted_and_denied" | "auto_no_prompt" | "bypass" | "unknown";

export interface LedgerEvent {
  at: string;
  sessionId: string;
  toolUseId: string;
  event: "prompted" | "executed";
  /** Full, local-only, present only on a "prompted" event (PostToolUse never carries it). */
  command?: string;
  permissionMode: string;
}

export interface LedgerRecord {
  at: string;
  sessionId: string;
  toolUseId: string;
  /** Full, local-only. Empty when no "prompted" event exists for this tool_use_id (nothing to recover). */
  command: string;
  commandDigest: string;
  provenance: Provenance;
  /** Human-readable label derived 1:1 from `provenance` — granted/denied/auto/bypass/unknown. */
  decision: string;
}

const BYPASS_MODE = "bypassPermissions";

function inWindow(ts: string, w?: Window): boolean {
  if (!w || !ts) return true;
  if (w.start && w.start !== "unknown" && ts < w.start) return false;
  if (w.end && w.end !== "unknown" && ts > w.end) return false;
  return true;
}

/** Parse gitignored ledger JSONL (one JSON object per line) into typed events, tolerant of malformed/unrecognized lines. */
export function parseLedger(jsonl: string, window?: Window): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.event !== "prompted" && o.event !== "executed") continue;
    const at = typeof o.at === "string" ? o.at : "";
    if (!inWindow(at, window)) continue;
    out.push({
      at,
      sessionId: typeof o.sessionId === "string" ? o.sessionId : "",
      toolUseId: typeof o.toolUseId === "string" ? o.toolUseId : "",
      event: o.event,
      command: typeof o.command === "string" ? o.command : undefined,
      permissionMode: typeof o.permissionMode === "string" ? o.permissionMode : "",
    });
  }
  return out;
}

function decisionFor(p: Provenance): string {
  switch (p) {
    case "prompted_and_executed":
      return "granted";
    case "prompted_and_denied":
      return "denied";
    case "auto_no_prompt":
      return "auto";
    case "bypass":
      return "bypass";
    default:
      return "unknown";
  }
}

/**
 * Correlate `prompted` (PermissionRequest) + `executed` (PostToolUse) events by `toolUseId` into
 * one record per tool_use_id, classified per T0's evidence table:
 *   both, non-bypass        -> prompted_and_executed (promotable)
 *   prompted only           -> prompted_and_denied
 *   executed only           -> auto_no_prompt (already allowlisted; no full command was ever logged)
 *   any event in bypass mode -> bypass (overrides the above)
 * Multiple duplicate events for the same toolUseId+event (e.g. a hook double-fire) collapse into
 * the same single record (dedupe). An event with no `toolUseId` cannot be correlated with
 * anything and becomes its own `unknown` record.
 */
export function correlate(events: LedgerEvent[]): LedgerRecord[] {
  const groups = new Map<string, LedgerEvent[]>();
  const uncorrelated: LedgerEvent[] = [];

  for (const e of events) {
    if (!e.toolUseId) {
      uncorrelated.push(e);
      continue;
    }
    const list = groups.get(e.toolUseId) ?? [];
    list.push(e);
    groups.set(e.toolUseId, list);
  }

  const out: LedgerRecord[] = [];

  for (const [toolUseId, group] of groups) {
    const prompted = group.find((e) => e.event === "prompted");
    const executed = group.find((e) => e.event === "executed");
    const anyBypass = group.some((e) => e.permissionMode === BYPASS_MODE);

    let provenance: Provenance;
    if (anyBypass) provenance = "bypass";
    else if (prompted && executed) provenance = "prompted_and_executed";
    else if (prompted && !executed) provenance = "prompted_and_denied";
    else if (!prompted && executed) provenance = "auto_no_prompt";
    else provenance = "unknown";

    const command = prompted?.command ?? "";
    const at = prompted?.at ?? executed?.at ?? "";
    const sessionId = prompted?.sessionId ?? executed?.sessionId ?? "";

    out.push({
      at,
      sessionId,
      toolUseId,
      command,
      commandDigest: sha256Hex(command),
      provenance,
      decision: decisionFor(provenance),
    });
  }

  for (const e of uncorrelated) {
    const command = e.command ?? "";
    out.push({
      at: e.at,
      sessionId: e.sessionId,
      toolUseId: "",
      command,
      commandDigest: sha256Hex(command),
      provenance: "unknown",
      decision: "unknown",
    });
  }

  return out;
}

/**
 * Only `prompted_and_executed` records are promotable (T0-confirmed observable signal; the loop's
 * global constraint: promotable = the observable `prompted_and_executed` signal). Full command is
 * retained (local-only); `commandDigest` is kept alongside as an integrity check.
 */
export function promotableCommands(records: LedgerRecord[]): LedgerRecord[] {
  return records.filter((r) => r.provenance === "prompted_and_executed");
}
