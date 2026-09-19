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

// --- Task 13: deterministic apply core (Critical 1/2, Important 2) ---------

export interface PermissionsBlock {
  allow?: string[];
  deny?: string[];
  ask?: string[];
}

/** The tracked `.claude/settings.json` shape this module reads/writes. Any other top-level key
 * (e.g. `$schema`, `env`, `hooks`) is preserved verbatim, untouched. */
export interface SettingsJson {
  permissions?: PermissionsBlock;
  [key: string]: unknown;
}

export interface AppliedRecord {
  id: string;
  keyword: Keyword;
  /** The rule that ended up written to (or removed from) settings — absent only for a skipped `defer`. */
  rule?: string;
}

export interface RefusedRecord {
  id: string;
  reason: string;
}

export interface ApplyDecisionsInput {
  artifact: Artifact;
  decisions: Decision[];
  settings: SettingsJson;
  managed: ManagedMap;
  /** ISO now, used for managed-map `firstSeen`/`lastSeen`. */
  now: string;
  /**
   * Whether the fetched artifact JSON is provably bound to the blob committed at
   * `artifact.sourceCommit` (Important 2) — computed by the caller (the apply CLI, which has the
   * actual fetch/comparison machinery), never by this pure function. When `false`, EVERY decision
   * is refused and neither `settings` nor `managed` is mutated at all — a candidate id alone is
   * not authenticity; the whole artifact must be provably untampered before any decision in it is
   * trusted.
   */
  sourceBlobMatches: boolean;
}

export interface ApplyDecisionsResult {
  settings: SettingsJson;
  managed: ManagedMap;
  applied: AppliedRecord[];
  refused: RefusedRecord[];
}

interface NormalizedSettings extends Omit<SettingsJson, "permissions"> {
  permissions: { allow: string[]; deny: string[]; ask: string[] };
}

/** Deep-clone just enough of `settings` for a pure, non-mutating apply. */
function cloneSettings(settings: SettingsJson): NormalizedSettings {
  const { permissions, ...rest } = settings;
  return {
    ...rest,
    permissions: {
      allow: [...(permissions?.allow ?? [])],
      deny: [...(permissions?.deny ?? [])],
      ask: [...(permissions?.ask ?? [])],
    },
  };
}

function addUnique(list: string[], rule: string): void {
  if (!list.includes(rule)) list.push(rule);
}

function removeRule(list: string[], rule: string): void {
  const idx = list.indexOf(rule);
  if (idx !== -1) list.splice(idx, 1);
}

// allow=0, allow-risky=1, allow-destructive=2 — must be >= the effective rule's level rank.
const ALLOW_KEYWORD_RANK: Record<"allow" | "allow-risky" | "allow-destructive", number> = {
  allow: 0,
  "allow-risky": 1,
  "allow-destructive": 2,
};

// ok/broad=0, risky=1, destructive=2 — mirrors ALLOW_KEYWORD_RANK so "keyword >= level" is a
// simple numeric comparison.
const LEVEL_RANK: Record<GrantLevel, number> = {
  ok: 0,
  broad: 0,
  risky: 1,
  destructive: 2,
};

/**
 * Deterministically apply a frozen, authorized `decisions` set onto `settings`/`managed`. This
 * function and the CLI that calls it are the ONLY code allowed to produce a new tracked
 * `.claude/settings.json` / managed map — every enforcement rule below is load-bearing security
 * logic, not a suggestion:
 *
 *  - a `reviewLocalOnly` candidate (sensitive — no `proposedRule` ever left the local machine) can
 *    NEVER be targeted by ANY decision via this remote path (Critical 1), regardless of keyword;
 *  - the keyword must be >= the EFFECTIVE rule's re-classified level (`overrideRule ??
 *    candidate.proposedRule`, always re-run through `classifyRule` — never trust a level computed
 *    before an edit) — a bare `allow` can never promote a `risky`/`destructive` rule, including via
 *    an `as Bash(<rule>)` override that reclassifies upward (Critical 2);
 *  - a destructive-classified effective rule must equal the candidate's captured
 *    `proposedRule` byte-for-byte — no override at all once either side of the comparison is
 *    destructive-level (Decision B: destructive is exact-only, never generalized, never
 *    substituted for a different destructive command under the same reviewed id);
 *  - the whole artifact must be `sourceBlobMatches` (Important 2) or every decision is refused
 *    outright, with zero mutation;
 *  - `allow`/`deny` writes dedupe against the existing list and never reorder/remove an existing
 *    entry; `revoke` removes the rule from `allow` and from `managed`.
 *
 * Pure: returns new `settings`/`managed` objects, writes nothing to disk, never mutates its inputs.
 */
export function applyDecisions(input: ApplyDecisionsInput): ApplyDecisionsResult {
  const applied: AppliedRecord[] = [];
  const refused: RefusedRecord[] = [];

  if (!input.sourceBlobMatches) {
    for (const d of input.decisions) {
      refused.push({
        id: d.id,
        reason: "tampered artifact: sourceBlobMatches is false (the artifact is not provably bound to its sourceCommit)",
      });
    }
    return { settings: input.settings, managed: input.managed, applied, refused };
  }

  const settings = cloneSettings(input.settings);
  const managed: ManagedMap = { ...input.managed };
  const candidateById = new Map(input.artifact.candidates.map((c) => [c.id, c]));

  for (const d of input.decisions) {
    const candidate = candidateById.get(d.id);
    if (!candidate) {
      refused.push({ id: d.id, reason: "unknown candidate id (not present in this artifact)" });
      continue;
    }

    if (d.keyword === "defer") continue; // decided-to-defer -- no mutation, not applied, not refused

    if (candidate.reviewLocalOnly) {
      refused.push({
        id: d.id,
        reason: "candidate is reviewLocalOnly/sensitive -- not promotable via remote apply",
      });
      continue;
    }

    if (!isLegalPair(candidate.kind, d.keyword)) {
      refused.push({ id: d.id, reason: `keyword "${d.keyword}" is not legal for a "${candidate.kind}" candidate` });
      continue;
    }

    if (d.keyword === "deny") {
      const rule = d.overrideRule ?? candidate.proposedRule;
      if (!rule) {
        refused.push({ id: d.id, reason: "no rule available to deny" });
        continue;
      }
      addUnique(settings.permissions.deny, rule);
      applied.push({ id: d.id, keyword: d.keyword, rule });
      continue;
    }

    if (d.keyword === "revoke") {
      const rule = d.overrideRule ?? candidate.proposedRule;
      if (!rule) {
        refused.push({ id: d.id, reason: "no rule available to revoke" });
        continue;
      }
      removeRule(settings.permissions.allow, rule);
      delete managed[rule];
      applied.push({ id: d.id, keyword: d.keyword, rule });
      continue;
    }

    // allow / allow-risky / allow-destructive
    const effectiveRule = d.overrideRule ?? candidate.proposedRule;
    if (!effectiveRule) {
      refused.push({ id: d.id, reason: "no rule available to allow" });
      continue;
    }

    const candidateLevel = candidate.proposedRule ? classifyRule(candidate.proposedRule).level : undefined;
    const effectiveLevel = classifyRule(effectiveRule).level;

    // Decision B: once EITHER side of the comparison is destructive-level, the effective rule must
    // equal the captured command byte-for-byte -- blocks overriding a destructive candidate to
    // anything else, AND overriding any candidate into an unrelated destructive rule.
    if ((candidateLevel === "destructive" || effectiveLevel === "destructive") && effectiveRule !== candidate.proposedRule) {
      refused.push({
        id: d.id,
        reason: "destructive rule must match the captured command byte-for-byte; overrides are not permitted",
      });
      continue;
    }

    const requiredRank = LEVEL_RANK[effectiveLevel];
    const keywordRank = ALLOW_KEYWORD_RANK[d.keyword as "allow" | "allow-risky" | "allow-destructive"];
    if (keywordRank < requiredRank) {
      refused.push({
        id: d.id,
        reason: `keyword "${d.keyword}" is insufficient for effective level "${effectiveLevel}" (rule "${effectiveRule}")`,
      });
      continue;
    }

    addUnique(settings.permissions.allow, effectiveRule);
    const existing = managed[effectiveRule];
    const info: ManagedRuleInfo = {
      owner: d.actor,
      rationale: d.rationale ?? existing?.rationale ?? "",
      firstSeen: existing?.firstSeen ?? input.now,
      lastSeen: input.now,
      count: candidate.count,
    };
    if (existing?.expiry) info.expiry = existing.expiry;
    managed[effectiveRule] = info;
    applied.push({ id: d.id, keyword: d.keyword, rule: effectiveRule });
  }

  return { settings, managed, applied, refused };
}
