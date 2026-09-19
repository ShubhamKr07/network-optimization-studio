#!/usr/bin/env node
// permission-ledger.mjs — Two-hook (PermissionRequest + PostToolUse) ledger for the weekly
// permission-review loop (permission-review-loop plan, Task 6). Registered in
// `.claude/settings.json` (Task 7) under BOTH hook events, matcher "Bash". Appends one JSONL
// record per Bash tool_use_id transition to the gitignored `.harness/permissions/ledger.jsonl`,
// correlated later (by tool_use_id) via `scripts/src/harness/lib/permissionLedger.ts`'s
// `correlate()` — see `docs/superpowers/specs/2026-09-18-permission-provenance-spike.md` (Task 0)
// for why two hooks, not one, are required to observe the promotable `prompted_and_executed`
// signal (neither hook alone reports the human's chosen option).
//
// NEVER blocks: on any error, for any non-Bash tool, or for any hook_event_name it doesn't
// recognize, it exits 0 immediately without writing anything. It never emits hook output either
// (this is a pure observer, not a permission decision) — a real `PermissionRequest`/`PostToolUse`
// registration must not add latency or risk to the tool call it's observing.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
// Dependency-free plain ESM shared with the TS harness (scripts/src/harness/lib/permissions.ts
// re-exports the same module) so the hook and the TS side always compute identical digests for
// the same command — see permissionsCore.mjs's own header comment (Important 5/7: no .ts import
// from a standalone hook script, and no duplicated security-sensitive logic).
import { sha256Hex } from "./lib/permissionsCore.mjs";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    // Never hang the hook waiting on stdin that never arrives.
    setTimeout(() => resolve(data), 2000);
  });
}

function ledgerPath(cwd) {
  const root = cwd || process.cwd();
  return join(root, ".harness", "permissions", "ledger.jsonl");
}

function appendLine(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(obj) + "\n");
}

(async () => {
  try {
    const raw = await readStdin();
    const payload = JSON.parse(raw || "{}");

    if (payload.tool_name !== "Bash") {
      process.exit(0);
    }

    const at = new Date().toISOString();
    const sessionId = payload.session_id || "";
    const toolUseId = payload.tool_use_id || "";
    const permissionMode = payload.permission_mode || "";
    const path = ledgerPath(payload.cwd);

    if (payload.hook_event_name === "PermissionRequest") {
      const command = (payload.tool_input && payload.tool_input.command) || "";
      appendLine(path, {
        at,
        sessionId,
        toolUseId,
        event: "prompted",
        command,
        // Extra field beyond the TS LedgerEvent spine — a same-source-of-truth integrity check
        // for the destructive byte-for-byte apply path; the TS side recomputes its own digest
        // from `command` regardless, so this is informational, not trusted blindly.
        commandDigest: sha256Hex(command),
        permissionMode,
      });
    } else if (payload.hook_event_name === "PostToolUse") {
      // Deliberately NO command field here: PostToolUse fires for every successful tool call,
      // including ones that never went through PermissionRequest (already allowlisted / builtin
      // read-only) -- logging a command on this arm would misrepresent what was actually
      // observed as "prompted" for those already-auto-approved calls.
      appendLine(path, { at, sessionId, toolUseId, event: "executed", permissionMode });
    }
    // Any other hook_event_name: not our concern, write nothing.
  } catch {
    // Never block a tool call on hook failure.
  }
  process.exit(0);
})();
