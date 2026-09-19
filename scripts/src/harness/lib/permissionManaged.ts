/**
 * Managed-rule provenance + revocation (permission-review-loop plan, Task 5 — MOVED EARLIER per
 * the plan review's Important 6, so `buildCandidates` (Task 8) has a real revoke source to consume
 * from its first commit).
 *
 * `docs/superpowers/metrics/permissions-managed.json` (seeded `{}`) is a rule-keyed map of every
 * permission rule this loop has promoted into the tracked `.claude/settings.json`, carrying
 * owner/rationale/first-last-seen/usage-count/optional-expiry — so authority granted by this loop
 * is never additive-only (Review 7 / Design "Safety invariant 6"): a rule unused for `staleWeeks`
 * or past its `expiry` is proposed for `revoke`, not left standing forever.
 */

import { sha256Hex, escapeCell } from "../../../../.claude/hooks/lib/permissionsCore.mjs";
import { classifyRule, matchesProjectAllow, type GrantLevel } from "./permissions.js";

export interface ManagedRuleInfo {
  owner: string;
  rationale: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  expiry?: string;
}

/** Rule-keyed (not digest-keyed) — the sidecar's top-level shape is `{ [rule]: ManagedRuleInfo }`. */
export type ManagedMap = Record<string, ManagedRuleInfo>;

export const CANDIDATE_SCHEMA_VERSION = 1;

/**
 * A `kind: "revoke"` candidate. Structurally identical to the full `Candidate` type
 * `permissions.ts` formally declares in Task 8 — deliberately NOT imported from there (this file
 * is committed a task earlier, and permissions.ts (T8) imports THIS file's `proposeRevocations`,
 * so importing `Candidate` back from permissions.ts would create a value-level import cycle on
 * top of the already-existing one; TypeScript's structural typing makes a `RevokeCandidate[]`
 * assignable everywhere a `Candidate[]` is expected without any import at all).
 */
export interface RevokeCandidate {
  schemaVersion: number;
  id: string;
  kind: "revoke";
  commandDigest: string;
  redactedPreview: string;
  proposedRule: string;
  level: GrantLevel;
  provenance: "unknown";
  count: number;
  firstSeen: string;
  lastSeen: string;
  sensitive: false;
  reviewLocalOnly: false;
}

/**
 * `id = sha256Hex(kind + "\0" + proposedRuleOrDigest).slice(0, 12)` — the one candidate-id formula
 * used by every kind (grant/deny here via T8's `buildCandidates`, revoke below). Binds the id to
 * the immutable proposed rule (or, for a sensitive candidate with no rule, its command digest).
 */
export function computeCandidateId(kind: string, proposedRuleOrDigest: string): string {
  return sha256Hex(`${kind}\0${proposedRuleOrDigest}`).slice(0, 12);
}

export interface ExecutedCommand {
  command: string;
  at: string;
}

/**
 * Refresh usage on the managed map from a batch of executed commands (typically every Bash
 * command seen in the week's transcript, regardless of provenance — an already-managed/allowed
 * rule generates no `PermissionRequest`, so its traffic never appears in the ledger's own
 * "prompted" events; the transcript is the only place that usage is still observable).
 *
 * Matches each executed command against each managed rule's OWN pattern via `matchesProjectAllow`
 * (glob semantics) — NOT a digest-vs-key comparison, which would silently miss every wildcard
 * managed rule (Important 8). Pure: returns a new map, never mutates `managed`.
 */
export function refreshUsage(managed: ManagedMap, executedCommands: ExecutedCommand[]): ManagedMap {
  const next: ManagedMap = {};
  for (const [rule, info] of Object.entries(managed)) next[rule] = { ...info };

  for (const { command, at } of executedCommands) {
    for (const rule of Object.keys(next)) {
      if (!matchesProjectAllow(command, [rule])) continue;
      const info = next[rule];
      next[rule] = {
        ...info,
        count: info.count + 1,
        lastSeen: !info.lastSeen || at > info.lastSeen ? at : info.lastSeen,
      };
    }
  }
  return next;
}

/**
 * Propose `revoke` for any managed rule unused for >= `staleWeeks` (by `lastSeen`, relative to
 * `now`) or already past its `expiry`. Authority is not additive-only (Review 7 / Safety
 * invariant 6) — this is the loop's only source of revoke candidates.
 */
export function proposeRevocations(managed: ManagedMap, now: string, staleWeeks: number): RevokeCandidate[] {
  const nowMs = Date.parse(now);
  const staleMs = staleWeeks * 7 * 24 * 60 * 60 * 1000;
  const out: RevokeCandidate[] = [];

  for (const [rule, info] of Object.entries(managed)) {
    const lastSeenMs = Date.parse(info.lastSeen);
    const isStale = Number.isFinite(nowMs) && Number.isFinite(lastSeenMs) && nowMs - lastSeenMs >= staleMs;
    const expiryMs = info.expiry ? Date.parse(info.expiry) : NaN;
    const isExpired = Number.isFinite(expiryMs) && Number.isFinite(nowMs) && nowMs >= expiryMs;
    if (!isStale && !isExpired) continue;

    out.push({
      schemaVersion: CANDIDATE_SCHEMA_VERSION,
      id: computeCandidateId("revoke", rule),
      kind: "revoke",
      commandDigest: sha256Hex(rule),
      redactedPreview: escapeCell(rule),
      proposedRule: rule,
      level: classifyRule(rule).level,
      provenance: "unknown",
      count: info.count,
      firstSeen: info.firstSeen,
      lastSeen: info.lastSeen,
      sensitive: false,
      reviewLocalOnly: false,
    });
  }
  return out;
}
