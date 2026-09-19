/**
 * Deterministic apply/authorization core (permission-review-loop plan, Tasks 12-13 — the SECURITY
 * CRUX of the whole feature). This module and `permissions-apply.ts` are the ONLY code allowed to
 * mutate the tracked `.claude/settings.json` / `permissions-managed.json`. Authorization and
 * enforcement live here as deterministic code, never in a skill or in model discretion (Global
 * Constraint: "Authorization is deterministic code, never SKILL.md").
 *
 * Task 12 — decision model + per-decision-authorized parser:
 *   `parseDecisions`, `isFrozen`, `allDecidedOrDeferred`.
 * Task 13 — deterministic apply core (Critical 1/2, Important 2):
 *   `applyDecisions`.
 *
 * See `docs/superpowers/plans/2026-09-18-permission-review-loop.md` (Tasks 12-13) and
 * `docs/superpowers/specs/2026-09-18-permission-review-loop-design.md` ("Review Resolution",
 * Critical 1/2) for the full design this implements.
 */

import { classifyRule, type GrantLevel, type Candidate } from "./permissions.js";
import type { ManagedMap, ManagedRuleInfo } from "./permissionManaged.js";

// --- Task 12: decision model + parser --------------------------------------

export type Keyword = "allow" | "allow-risky" | "allow-destructive" | "deny" | "revoke" | "defer";

export interface Decision {
  id: string;
  keyword: Keyword;
  /** The `Bash(<rule>)` text from an `as Bash(<rule>)` override clause, verbatim. */
  overrideRule?: string;
  /** The comment's author — who made this decision. */
  actor: string;
  /** The comment author's association (e.g. GitHub `author_association`: OWNER/MEMBER/...). */
  association: string;
  rationale?: string;
  commentId: string;
  at: string;
}

/** One PR (or equivalent) review comment, as fed to `parseDecisions`/`isFrozen`. */
export interface DecisionComment {
  commentId: string;
  body: string;
  author: string;
  association: string;
  at: string;
}

/** `{ [rule]: { start?, end? } }` — imported structurally-compatible with `permissions.ts`'s `Window`. */
export interface ArtifactWindow {
  start?: string;
  end?: string;
}

/**
 * The committed weekly artifact shape (structurally identical to `permissions-capture.ts`'s
 * `CaptureArtifact` — redeclared here rather than imported, so this security-critical module has
 * no dependency on the capture CLI's file).
 */
export interface Artifact {
  schemaVersion: number;
  sourceCommit: string;
  trackedSettingsDigest: string;
  window: ArtifactWindow;
  generatedAt: string;
  candidates: Candidate[];
}

/**
 * Authorize a (author, association) pair. Deliberately an INPUT — never hardcoded here — so the
 * caller (the apply CLI, or a test) decides what "authorized" means (e.g. GitHub
 * `author_association` in {OWNER, MEMBER, COLLABORATOR}), matching the Global Constraint that
 * authorization is deterministic code driven by real, verifiable identity, not a fixed list baked
 * into this module.
 */
export type IsAuthorized = (author: string, association: string) => boolean;

export interface ParseDecisionsOptions {
  isAuthorized: IsAuthorized;
  /**
   * Optional id -> candidate-kind lookup, enabling early rejection of an illegal keyword/kind
   * pair (e.g. `allow` against a `deny`-kind candidate) at parse time. When omitted, or when an id
   * is unknown to it, pairing is NOT validated here — `applyDecisions` (Task 13) independently
   * re-validates every decision's keyword against the authoritative artifact's candidate kind
   * regardless of whether it went through this parser, so omitting this is safe, never a bypass.
   */
  candidateKind?: (id: string) => Candidate["kind"] | undefined;
}

// Grant candidates: allow*/defer. Deny candidates: deny/defer. Revoke candidates: revoke/defer.
// Restrictive decisions (deny/revoke/defer) intentionally sit outside the allow-keyword level
// ordering (design doc, "Classification levels").
const LEGAL_KEYWORDS_FOR_KIND: Record<Candidate["kind"], readonly Keyword[]> = {
  grant: ["allow", "allow-risky", "allow-destructive", "defer"],
  deny: ["deny", "defer"],
  revoke: ["revoke", "defer"],
};

function isLegalPair(kind: Candidate["kind"] | undefined, keyword: Keyword): boolean {
  if (!kind) return true; // unknown/unresolvable here -- applyDecisions re-checks against the real artifact
  return LEGAL_KEYWORDS_FOR_KIND[kind].includes(keyword);
}

// Longest-alternative-first so "allow-risky"/"allow-destructive" aren't shadowed by the bare
// "allow" prefix. The id is a non-whitespace token (candidate ids are 12 lowercase-hex chars, but
// matched generically here). An optional `as Bash(<rule>)` override may follow; anything left on
// the line after that is captured as free-text rationale.
const DECISION_LINE_RE =
  /@claude\s+(allow-destructive|allow-risky|allow|deny|revoke|defer)\s+(\S+)(?:\s+as\s+(Bash\([^)]*\)))?\s*(.*)$/i;

function normalizeRationale(raw: string): string | undefined {
  const trimmed = raw
    .trim()
    .replace(/^[-:—]+\s*/, "")
    .trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractLineDecisions(comment: DecisionComment): Decision[] {
  const out: Decision[] = [];
  for (const rawLine of comment.body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(DECISION_LINE_RE);
    if (!m) continue;
    out.push({
      id: m[2],
      keyword: m[1].toLowerCase() as Keyword,
      overrideRule: m[3] || undefined,
      actor: comment.author,
      association: comment.association,
      rationale: normalizeRationale(m[4] ?? ""),
      commentId: comment.commentId,
      at: comment.at,
    });
  }
  return out;
}

/**
 * Parse every `@claude <keyword> <id> [as Bash(<rule>)]` decision out of `comments`.
 *
 * Authorization happens FIRST: comments from an author `isAuthorized` rejects are dropped
 * entirely before any decision is extracted from them, so an unauthorized comment can never win
 * last-writer-wins even if it is chronologically last (Important 3's core requirement — every
 * decision is authorized, not just the final freeze trigger).
 *
 * Then, among authorized comments only, decisions are grouped by candidate `id` and the
 * chronologically last one wins (ties broken by input order). An individual decision whose
 * keyword is illegal for its candidate's kind (per `options.candidateKind`, when supplied) is
 * dropped before the last-writer-wins reduction, as if it were never written.
 */
export function parseDecisions(comments: DecisionComment[], options: ParseDecisionsOptions): Decision[] {
  const authorized = comments.filter((c) => options.isAuthorized(c.author, c.association));

  const ordered = authorized
    .map((c, index) => ({ c, index }))
    .sort((a, b) => {
      if (a.c.at === b.c.at) return a.index - b.index;
      return a.c.at < b.c.at ? -1 : 1;
    })
    .map((x) => x.c);

  const byId = new Map<string, Decision>();
  for (const comment of ordered) {
    for (const decision of extractLineDecisions(comment)) {
      if (!isLegalPair(options.candidateKind?.(decision.id), decision.keyword)) continue;
      byId.set(decision.id, decision); // last-writer-wins
    }
  }
  return [...byId.values()];
}

const FREEZE_RE = /@claude\s+apply\s+permission\s+review\b/i;

/**
 * True iff at least one AUTHORIZED comment contains the final freeze trigger
 * `@claude apply permission review`. An unauthorized freeze comment never counts.
 */
export function isFrozen(comments: DecisionComment[], options: { isAuthorized: IsAuthorized }): boolean {
  return comments.some((c) => options.isAuthorized(c.author, c.association) && FREEZE_RE.test(c.body));
}

/**
 * True iff every candidate in `artifact.candidates` has a decision (any keyword, `defer`
 * included) in `decisions`. This is the freeze precondition: the two-phase design (design doc,
 * Apply section) requires every candidate decided-or-deferred before the one settings commit.
 */
export function allDecidedOrDeferred(artifact: Artifact, decisions: Decision[]): boolean {
  const decided = new Set(decisions.map((d) => d.id));
  return artifact.candidates.every((c) => decided.has(c.id));
}
