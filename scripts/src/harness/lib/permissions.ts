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
import {
  escapeCell,
  redactCommand,
  scanSensitive,
  sha256Hex,
} from "../../../../.claude/hooks/lib/permissionsCore.mjs";
export { escapeCell, redactCommand, scanSensitive, sha256Hex };

import { PERMISSION_TEMPLATES, pnpmRunTemplateRule } from "./permissionTemplates.js";
import { parseLedger, correlate, promotableCommands, type Provenance } from "./permissionLedger.js";
import {
  proposeRevocations,
  computeCandidateId,
  CANDIDATE_SCHEMA_VERSION,
  type ManagedMap,
} from "./permissionManaged.js";

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

/**
 * Suggest the `Bash(<rule>)` permission rule for a raw command. Exact by default — generalization
 * to a wildcard happens ONLY when the command matches an entry in the small, reviewed
 * `PERMISSION_TEMPLATES` registry (`permissionTemplates.ts`). A command whose exact-wrapped rule
 * classifies as `destructive` is NEVER generalized, even if it superficially resembles a template
 * (e.g. `git push --force ...` still contains `git push`, but must stay the exact literal command).
 * An unmatched command also falls back to exact.
 */
export function suggestRule(command: string): string {
  const trimmed = command.trim();
  const exact = `Bash(${trimmed})`;
  if (classifyRule(exact).level === "destructive") return exact;

  for (const t of PERMISSION_TEMPLATES) {
    if (t.test(trimmed)) return t.rule;
  }
  const runRule = pnpmRunTemplateRule(trimmed);
  if (runRule) return runRule;

  return exact;
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

// NOT truncated (permission-review-loop Task 6 / Important 7): the full command is required for
// exact deny candidates and full-command digests downstream (buildCandidates, Task 8) — a 120-char
// cut would silently corrupt both. Denied commands never enter git untransformed anyway (they go
// through redactCommand/scanSensitive before anything is committed), so retaining the full text
// here is safe.
function summarizeInput(input: unknown): string {
  if (input && typeof input === "object" && "command" in (input as Record<string, unknown>)) {
    return String((input as Record<string, unknown>).command);
  }
  return JSON.stringify(input ?? null);
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

// --- Task 8: buildCandidates ------------------------------------------------

/**
 * A reviewable unit surfaced to the weekly permission-review artifact. `proposedRule` is the exact
 * literal rule text that would be written into `.claude/settings.json` if accepted — present for
 * every non-sensitive candidate (Critical 1's "non-sensitive exact rules may enter Git" branch),
 * omitted entirely for a `sensitive` one (which is `reviewLocalOnly` and never usable via the
 * remote apply path). `level` classifies the PROPOSED rule (or, when sensitive, the hypothetical
 * exact rule — never the raw command text itself, which never appears here).
 */
export interface Candidate {
  schemaVersion: number;
  id: string;
  kind: "grant" | "deny" | "revoke";
  commandDigest: string;
  redactedPreview: string;
  proposedRule?: string;
  level: GrantLevel;
  provenance: Provenance;
  count: number;
  firstSeen: string;
  lastSeen: string;
  sensitive: boolean;
  reviewLocalOnly: boolean;
}

export interface BuildCandidatesInput {
  /** Raw gitignored ledger JSONL text (`.harness/permissions/ledger.jsonl`). */
  ledger: string;
  /** Raw concatenated transcript JSONL text. */
  transcript: string;
  /** The merged content of the inspected project Bash allowlists (tracked + local). */
  projectAllow: string[];
  managed: ManagedMap;
  window?: Window;
  /** ISO now, for revoke staleness — defaults to the current time. */
  now?: string;
  /** Weeks of no usage before a managed rule is proposed for revoke — defaults to 8. */
  staleWeeks?: number;
}

const DEFAULT_STALE_WEEKS = 8;

interface CandidateAccum {
  proposedRule?: string;
  sensitive: boolean;
  redactedPreview: string;
  level: GrantLevel;
  commandDigest: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

function accumKey(sensitive: boolean, proposedRule: string | undefined, digest: string): string {
  return sensitive ? `sensitive:${digest}` : `rule:${proposedRule}`;
}

function upsertAccum(groups: Map<string, CandidateAccum>, key: string, at: string, digest: string, seed: () => CandidateAccum): void {
  const existing = groups.get(key);
  if (!existing) {
    groups.set(key, seed());
    return;
  }
  existing.count += 1;
  if (at && (!existing.lastSeen || at > existing.lastSeen)) {
    existing.lastSeen = at;
    existing.commandDigest = digest;
  }
  if (at && (!existing.firstSeen || at < existing.firstSeen)) existing.firstSeen = at;
}

function accumToCandidate(kind: "grant" | "deny", provenance: Provenance, g: CandidateAccum): Candidate {
  const idSource = g.sensitive ? g.commandDigest : (g.proposedRule as string);
  return {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    id: computeCandidateId(kind, idSource),
    kind,
    commandDigest: g.commandDigest,
    redactedPreview: g.redactedPreview,
    proposedRule: g.proposedRule,
    level: g.level,
    provenance,
    count: g.count,
    firstSeen: g.firstSeen,
    lastSeen: g.lastSeen,
    sensitive: g.sensitive,
    reviewLocalOnly: g.sensitive,
  };
}

/**
 * Build the full candidate list for the weekly permission-review artifact:
 *  - grant candidates: promotable ledger commands (`prompted_and_executed`, T6) not already present
 *    in `projectAllow` (T3's narrow claim), deduped by their effective proposed rule;
 *  - deny candidates: transcript denials (`parseDenials`, now full-command per Important 7), deduped
 *    the same way;
 *  - revoke candidates: stale/expired managed rules (T5's `proposeRevocations`).
 * Every candidate's `level` classifies its PROPOSED rule (Critical 2), and a sensitive command
 * (Critical 1) never gets a `proposedRule` at all — only `redactedPreview: "sensitive — review
 * locally"`, `sensitive: true`, `reviewLocalOnly: true`.
 */
export function buildCandidates(input: BuildCandidatesInput): Candidate[] {
  const { ledger, transcript, projectAllow, managed, window } = input;
  const now = input.now ?? new Date().toISOString();
  const staleWeeks = input.staleWeeks ?? DEFAULT_STALE_WEEKS;

  const candidates: Candidate[] = [];

  // --- grant candidates ---
  const promotable = promotableCommands(correlate(parseLedger(ledger, window)));
  const grantGroups = new Map<string, CandidateAccum>();

  for (const rec of promotable) {
    if (matchesProjectAllow(rec.command, projectAllow)) continue; // already covered — not a candidate
    // Sensitivity is judged on the RULE that would actually be committed, not the raw command:
    // a command that generalizes to a safe wildcard template (e.g. `git log *`) stays promotable
    // even if its raw form held an email/token, but any rule whose own text still carries a
    // secret (the exact-rule path — destructive/unmatched) is withheld. `scanSensitive` catches
    // high-entropy residue; the `redactCommand(...) !== inner` check catches anything redaction
    // would mask (Critical 1: no secret text ever reaches the committed artifact via proposedRule).
    const candidateRule = suggestRule(rec.command);
    const ruleInner = candidateRule.replace(/^Bash\(/, "").replace(/\)$/, "");
    const sensitive = scanSensitive(ruleInner) || redactCommand(ruleInner) !== ruleInner;
    const proposedRule = sensitive ? undefined : candidateRule;
    const level = classifyRule(candidateRule).level;
    const redactedPreview = sensitive ? "sensitive — review locally" : escapeCell(redactCommand(rec.command));
    const key = accumKey(sensitive, proposedRule, rec.commandDigest);

    upsertAccum(grantGroups, key, rec.at, rec.commandDigest, () => ({
      proposedRule,
      sensitive,
      redactedPreview,
      level,
      commandDigest: rec.commandDigest,
      count: 1,
      firstSeen: rec.at,
      lastSeen: rec.at,
    }));
  }

  for (const g of grantGroups.values()) candidates.push(accumToCandidate("grant", "prompted_and_executed", g));

  // --- deny candidates ---
  const denials = parseDenials(transcript, window);
  const denyGroups = new Map<string, CandidateAccum>();

  for (const d of denials) {
    if (d.tool !== "Bash" || !d.input) continue; // Bash-centric per the loop's scope
    const command = d.input;
    // Sensitivity judged on the would-be rule, not the raw command (see the grant loop above —
    // Critical 1: a secret in the rule text is withheld; a safe wildcard template is kept).
    const candidateRule = suggestRule(command);
    const ruleInner = candidateRule.replace(/^Bash\(/, "").replace(/\)$/, "");
    const sensitive = scanSensitive(ruleInner) || redactCommand(ruleInner) !== ruleInner;
    const proposedRule = sensitive ? undefined : candidateRule;
    const level = classifyRule(candidateRule).level;
    const redactedPreview = sensitive ? "sensitive — review locally" : escapeCell(redactCommand(command));
    const digest = sha256Hex(command);
    const key = accumKey(sensitive, proposedRule, digest);

    upsertAccum(denyGroups, key, d.at, digest, () => ({
      proposedRule,
      sensitive,
      redactedPreview,
      level,
      commandDigest: digest,
      count: 1,
      firstSeen: d.at,
      lastSeen: d.at,
    }));
  }

  for (const g of denyGroups.values()) candidates.push(accumToCandidate("deny", "prompted_and_denied", g));

  // --- revoke candidates ---
  for (const r of proposeRevocations(managed, now, staleWeeks)) candidates.push(r);

  return candidates;
}
