/**
 * Permission audit primitives for the harness retro.
 *
 * Two data sources, both machine-local (never committed):
 *  - standing grants:  `.claude/settings.local.json` → permissions.{allow,deny,ask}
 *  - runtime denials:  the session transcript JSONL under ~/.claude/projects/<slug>/, where a
 *                      user-denied tool call surfaces as a tool_result carrying the canonical
 *                      "The user doesn't want to proceed with this tool use." message.
 *
 * This module is pure (parse + classify only); all I/O lives in audit-permissions.ts.
 */

// Redaction/digest primitives are dependency-free plain ESM shared with the standalone Claude
// Code hook (`.claude/hooks/permission-ledger.mjs`, which cannot import an uncompiled .ts module)
// — re-exported here rather than duplicated, per the permission-review-loop design (Important 5).
export {
  escapeCell,
  redactCommand,
  scanSensitive,
  sha256Hex,
} from "../../../../.claude/hooks/lib/permissionsCore.mjs";

export type GrantLevel = "destructive" | "risky" | "broad" | "ok";

export interface GrantClass {
  entry: string;
  level: GrantLevel;
  ruleId: string;
  reason: string;
}

export interface StandingPerms {
  allow: string[];
  deny: string[];
  ask: string[];
}

export interface Denial {
  at: string;
  tool: string;
  input: string;
  toolUseId: string;
}

export interface AllowDiff {
  added: string[];
  removed: string[];
}

export interface Window {
  start?: string;
  end?: string;
}

/** Read permissions.{allow,deny,ask} from a parsed settings.local.json (tolerant of missing keys). */
export function parseStandingPermissions(json: unknown): StandingPerms {
  const p = (json as { permissions?: Record<string, unknown> })?.permissions ?? {};
  const list = (k: string): string[] => (Array.isArray(p[k]) ? (p[k] as unknown[]).map(String) : []);
  return { allow: list("allow"), deny: list("deny"), ask: list("ask") };
}

/** Split `Tool(arg)` → {tool, arg}; a bare `Tool` (no parens) yields arg=null. */
function toolAndArg(entry: string): { tool: string; arg: string | null } {
  const m = entry.match(/^([^(]+)\(([\s\S]*)\)$/);
  if (m) return { tool: m[1], arg: m[2] };
  return { tool: entry, arg: null };
}

const KNOWN_TOOLS = new Set([
  "Bash", "Read", "Write", "Edit", "MultiEdit", "WebFetch", "WebSearch",
  "Glob", "Grep", "Task", "NotebookEdit",
]);

interface Rule {
  id: string;
  level: GrantLevel;
  reason: string;
  test: (entry: string, tool: string, arg: string | null) => boolean;
}

// Ordered — first match wins. Destructive rules are ordered FIRST so an irreversible/system-level
// command is never shadowed by a broader risky/broad rule that happens to also match (e.g.
// `git push --force *` must classify as destructive, not merely as the risky `git_push` rule).
// Risky rules follow, then broad. Rules only SURFACE grants for human review; they never auto-decide.
const RULES: Rule[] = [
  {
    id: "destructive_bash",
    level: "destructive",
    reason: "destructive/irreversible shell command",
    test: (_e, tool, arg) =>
      tool === "Bash" && arg !== null &&
      /\brm\s+-[a-z]*r|\brm\s+-rf\b|\bsudo\b|\bchmod\b|\bchown\b|\bmkfs\b|\bdd\s+if=|\bgit\s+clean\b/.test(arg),
  },
  {
    id: "git_reset_hard_or_force",
    level: "destructive",
    reason: "force/hard-reset — overwrites history or state irreversibly",
    test: (_e, tool, arg) =>
      tool === "Bash" && arg !== null && /--force\b|\breset\s+--hard\b|\bcheckout\s+--force\b/.test(arg),
  },
  {
    id: "sql_destructive",
    level: "destructive",
    reason: "destructive SQL — drops or truncates data irreversibly",
    test: (_e, tool, arg) => tool === "Bash" && arg !== null && /\b(DROP|TRUNCATE)\b/i.test(arg),
  },
  {
    id: "whole_tool_grant",
    level: "risky",
    reason: "whole-tool grant — every invocation of this tool is pre-approved",
    test: (_e, tool, arg) => arg === null && KNOWN_TOOLS.has(tool),
  },
  {
    id: "wildcard_all",
    level: "risky",
    reason: "unrestricted wildcard — matches any argument",
    test: (_e, _tool, arg) => arg !== null && /^\s*:?\*?\s*$/.test(arg),
  },
  {
    id: "git_push",
    level: "risky",
    reason: "outward push — mutates a remote",
    test: (_e, tool, arg) => tool === "Bash" && arg !== null && /\bgit\s+push\b/.test(arg),
  },
  {
    id: "secret_exposure",
    level: "risky",
    reason: "may read/print secrets or environment",
    test: (_e, tool, arg) =>
      tool === "Bash" && arg !== null &&
      (/\bprintenv\b/.test(arg) || /^\s*env\s*$/.test(arg) || /\b(SECRET|TOKEN|API[_-]?KEY|PASSWORD|CREDENTIAL)\b/i.test(arg)),
  },
  {
    id: "arbitrary_sql",
    level: "risky",
    reason: "arbitrary SQL — unscoped database access",
    test: (_e, tool, arg) => tool === "Bash" && arg !== null && /\bpsql\b[\s\S]*\*\s*$/.test(arg),
  },
  {
    id: "whole_mcp_server",
    level: "risky",
    reason: "whole MCP server grant — every tool on this server is pre-approved",
    test: (entry) => /^mcp__[A-Za-z0-9-]+$/.test(entry),
  },
  {
    id: "scoped_wildcard",
    level: "broad",
    reason: "scoped wildcard — broad but bounded to a verb/domain",
    test: (_e, _tool, arg) => arg !== null && /\*\s*$/.test(arg),
  },
];

/**
 * Classify a full `Tool(pattern)` rule — e.g. a settings.local.json allow entry, or a proposed
 * rule after a human edit/override. First matching rule wins; unmatched entries are `ok`. This is
 * the "post-edit" classification path: callers must always re-run this on the *effective* rule
 * (after any override), never trust a classification computed before the edit.
 */
export function classifyRule(rule: string): GrantClass {
  const { tool, arg } = toolAndArg(rule);
  for (const r of RULES) {
    if (r.test(rule, tool, arg)) return { entry: rule, level: r.level, ruleId: r.id, reason: r.reason };
  }
  return { entry: rule, level: "ok", ruleId: "specific", reason: "fully-specified" };
}

/** Classify one allow entry (OBS-12 name, kept for existing call sites). Delegates to `classifyRule`. */
export function classifyGrant(entry: string): GrantClass {
  return classifyRule(entry);
}

export function classifyAll(allow: string[]): GrantClass[] {
  return allow.map(classifyGrant);
}

// Regex metacharacters that must be escaped in the LITERAL rule text before the permission
// syntax's own `*` wildcard is expanded to `.*` — otherwise, e.g., a rule like
// `Bash(cat notes.txt)` would let "." act as regex "match any character" and incorrectly report
// coverage for `cat notesXtxt`, or `Bash(echo a|b)` would let "|" act as top-level alternation and
// incorrectly report coverage for any command merely starting with "echo a". Order is: escape
// these metachars FIRST, THEN expand the (still-literal, un-escaped) `*` to `.*`, THEN anchor with
// ^...$.
const REGEX_METACHARS = /[$[\]()\\.+?^{}|]/g;

/**
 * Does `command` appear to be covered by an entry in `allow` (a project-scoped Bash allowlist —
 * e.g. the merged content of the two inspected project allowlist files)?
 *
 * IMPORTANT — this is a NARROW claim, not a reimplementation of Claude Code's full permission
 * evaluation: it only checks the `Bash(<pattern>)` entries in the two allowlists PASSED IN, via a
 * metachar-safe glob translation of each entry's `*` wildcard. It does not model compound-command
 * splitting, safe-environment-prefix normalization, built-in read-only commands, deny/ask
 * precedence, or managed/CLI/user-scope rules. Callers must describe the result only as "present
 * (or not present) in the inspected project allowlists" — never as "would be auto-approved" (or
 * "would be denied").
 */
export function matchesProjectAllow(command: string, allow: string[]): boolean {
  for (const entry of allow) {
    const { tool, arg } = toolAndArg(entry);
    if (tool !== "Bash") continue; // non-Bash entries ignored
    if (arg === null) return true; // bare `Bash` — whole-tool grant covers any command
    const escaped = arg.replace(REGEX_METACHARS, "\\$&");
    const expanded = escaped.replace(/\*/g, ".*");
    const re = new RegExp(`^${expanded}$`);
    if (re.test(command)) return true;
  }
  return false;
}

/** Set difference of the current allow list against a stored baseline. */
export function diffAllow(current: string[], baseline: string[]): AllowDiff {
  const base = new Set(baseline);
  const cur = new Set(current);
  return {
    added: current.filter((e) => !base.has(e)),
    removed: baseline.filter((e) => !cur.has(e)),
  };
}

function inWindow(ts: string, w?: Window): boolean {
  if (!w || !ts) return true; // no window, or an undated line → best-effort include
  if (w.start && w.start !== "unknown" && ts < w.start) return false;
  if (w.end && w.end !== "unknown" && ts > w.end) return false;
  return true;
}

function isDenial(content: string, isError: unknown): boolean {
  const c = content.trimStart();
  // Canonical Claude Code denial message (strict prefix avoids matching transcript text that merely
  // quotes the phrase, e.g. an earlier grep of the transcripts themselves).
  if (c.startsWith("The user doesn't want to proceed with this tool use")) return true;
  if (isError === true && /^User rejected tool use\b/.test(c)) return true;
  return false;
}

function summarizeInput(input: unknown): string {
  if (input && typeof input === "object" && "command" in (input as Record<string, unknown>)) {
    return String((input as Record<string, unknown>).command).slice(0, 120);
  }
  return JSON.stringify(input ?? null).slice(0, 120);
}

/**
 * Parse denied tool calls from concatenated transcript JSONL. Builds a tool_use_id → {name,input}
 * map across all lines first, then attributes each denial back to its originating call. `window`
 * filters by the line's ISO `timestamp` (lexicographic compare is valid for UTC ISO-8601).
 */
export function parseDenials(jsonlText: string, window?: Window): Denial[] {
  const lines = jsonlText.split("\n").filter(Boolean);
  const toolUse = new Map<string, { name: string; input: unknown }>();
  const parsed: Array<{ ts: string; blocks: Record<string, unknown>[] }> = [];

  for (const line of lines) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = o.message as { content?: unknown } | undefined;
    const blocks = Array.isArray(msg?.content) ? (msg!.content as Record<string, unknown>[]) : [];
    for (const b of blocks) {
      if (b?.type === "tool_use" && typeof b.id === "string") {
        toolUse.set(b.id, { name: String(b.name ?? "unknown"), input: b.input });
      }
    }
    parsed.push({ ts: typeof o.timestamp === "string" ? o.timestamp : "", blocks });
  }

  const denials: Denial[] = [];
  for (const { ts, blocks } of parsed) {
    for (const b of blocks) {
      if (b?.type !== "tool_result") continue;
      const raw = b.content;
      const c = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
      if (!isDenial(c, b.is_error)) continue;
      if (!inWindow(ts, window)) continue;
      const tuId = typeof b.tool_use_id === "string" ? b.tool_use_id : "";
      const tu = toolUse.get(tuId);
      denials.push({
        at: ts,
        tool: tu?.name ?? "unknown",
        input: tu ? summarizeInput(tu.input) : "",
        toolUseId: tuId,
      });
    }
  }
  return denials;
}

/** Most frequent denied tool, or "" if none. */
export function topDeniedTool(denials: Denial[]): string {
  const c = new Map<string, number>();
  for (const d of denials) c.set(d.tool, (c.get(d.tool) ?? 0) + 1);
  let top = "";
  let n = 0;
  for (const [k, v] of c) if (v > n) { top = k; n = v; }
  return top;
}
