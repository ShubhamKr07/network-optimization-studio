import { describe, it, expect } from "vitest";
import {
  parseDecisions,
  isFrozen,
  allDecidedOrDeferred,
  applyDecisions,
  type Decision,
  type DecisionComment,
  type Artifact,
  type SettingsJson,
} from "../harness/lib/permissionApply.js";
import type { Candidate } from "../harness/lib/permissions.js";
import type { ManagedMap } from "../harness/lib/permissionManaged.js";

// --- fixtures ---------------------------------------------------------------

/** Authorized iff association is OWNER — matches this test suite's fixtures only; never hardcoded
 * inside permissionApply.ts itself (Global Constraint: authorization is an input predicate). */
const isOwner = (_author: string, association: string) => association === "OWNER";

function comment(overrides: Partial<DecisionComment> = {}): DecisionComment {
  return {
    commentId: "c1",
    body: "",
    author: "shubham",
    association: "OWNER",
    at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    schemaVersion: 1,
    id: "aaaaaaaaaaaa",
    kind: "grant",
    commandDigest: "digest-1",
    redactedPreview: "git status",
    proposedRule: "Bash(git status)",
    level: "ok",
    provenance: "prompted_and_executed",
    count: 1,
    firstSeen: "2026-09-01T00:00:00.000Z",
    lastSeen: "2026-09-01T00:00:00.000Z",
    sensitive: false,
    reviewLocalOnly: false,
    ...overrides,
  };
}

function artifact(candidates: Candidate[]): Artifact {
  return {
    schemaVersion: 1,
    sourceCommit: "deadbeef",
    trackedSettingsDigest: "digest",
    window: { start: "2026-08-25T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
    generatedAt: "2026-09-01T00:00:00.000Z",
    candidates,
  };
}

// --- parseDecisions -----------------------------------------------------------

describe("parseDecisions", () => {
  it("drops a decision from an unauthorized author before last-writer-wins", () => {
    const comments = [
      comment({
        commentId: "c1",
        author: "attacker",
        association: "NONE",
        at: "2026-09-01T00:00:00.000Z",
        body: "@claude allow aaaaaaaaaaaa",
      }),
    ];
    const decisions = parseDecisions(comments, { isAuthorized: isOwner });
    expect(decisions).toEqual([]);
  });

  it("keeps a decision from an authorized author", () => {
    const comments = [
      comment({
        commentId: "c1",
        author: "shubham",
        association: "OWNER",
        at: "2026-09-01T00:00:00.000Z",
        body: "@claude allow aaaaaaaaaaaa",
      }),
    ];
    const decisions = parseDecisions(comments, { isAuthorized: isOwner });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      id: "aaaaaaaaaaaa",
      keyword: "allow",
      actor: "shubham",
      association: "OWNER",
      commentId: "c1",
    });
  });

  it("last-writer-wins among authorized comments for the same id", () => {
    const comments = [
      comment({ commentId: "c1", at: "2026-09-01T00:00:00.000Z", body: "@claude allow aaaaaaaaaaaa" }),
      comment({ commentId: "c2", at: "2026-09-02T00:00:00.000Z", body: "@claude deny aaaaaaaaaaaa" }),
    ];
    const decisions = parseDecisions(comments, { isAuthorized: isOwner });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].keyword).toBe("deny");
    expect(decisions[0].commentId).toBe("c2");
  });

  it("last-writer-wins is based on timestamp, not array order", () => {
    const comments = [
      comment({ commentId: "later", at: "2026-09-05T00:00:00.000Z", body: "@claude deny aaaaaaaaaaaa" }),
      comment({ commentId: "earlier", at: "2026-09-01T00:00:00.000Z", body: "@claude allow aaaaaaaaaaaa" }),
    ];
    const decisions = parseDecisions(comments, { isAuthorized: isOwner });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].commentId).toBe("later");
    expect(decisions[0].keyword).toBe("deny");
  });

  it("an unauthorized comment never wins even if it is chronologically last", () => {
    const comments = [
      comment({ commentId: "c1", at: "2026-09-01T00:00:00.000Z", body: "@claude allow aaaaaaaaaaaa" }),
      comment({
        commentId: "c2",
        author: "attacker",
        association: "NONE",
        at: "2026-09-09T00:00:00.000Z",
        body: "@claude deny aaaaaaaaaaaa",
      }),
    ];
    const decisions = parseDecisions(comments, { isAuthorized: isOwner });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].keyword).toBe("allow");
    expect(decisions[0].commentId).toBe("c1");
  });

  it("supports defer for any candidate kind", () => {
    const comments = [comment({ body: "@claude defer aaaaaaaaaaaa" })];
    const decisions = parseDecisions(comments, {
      isAuthorized: isOwner,
      candidateKind: () => "deny",
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].keyword).toBe("defer");
  });

  it("rejects an illegal kind/keyword pair (allow against a deny candidate)", () => {
    const comments = [comment({ body: "@claude allow aaaaaaaaaaaa" })];
    const decisions = parseDecisions(comments, {
      isAuthorized: isOwner,
      candidateKind: (id) => (id === "aaaaaaaaaaaa" ? "deny" : undefined),
    });
    expect(decisions).toEqual([]);
  });

  it("accepts a legal kind/keyword pair (deny against a deny candidate)", () => {
    const comments = [comment({ body: "@claude deny aaaaaaaaaaaa" })];
    const decisions = parseDecisions(comments, {
      isAuthorized: isOwner,
      candidateKind: (id) => (id === "aaaaaaaaaaaa" ? "deny" : undefined),
    });
    expect(decisions).toHaveLength(1);
  });

  it("rejects allow-destructive against a revoke candidate", () => {
    const comments = [comment({ body: "@claude allow-destructive aaaaaaaaaaaa" })];
    const decisions = parseDecisions(comments, {
      isAuthorized: isOwner,
      candidateKind: () => "revoke",
    });
    expect(decisions).toEqual([]);
  });

  it("accepts revoke against a revoke candidate", () => {
    const comments = [comment({ body: "@claude revoke aaaaaaaaaaaa" })];
    const decisions = parseDecisions(comments, {
      isAuthorized: isOwner,
      candidateKind: () => "revoke",
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].keyword).toBe("revoke");
  });

  it("does not validate kind/keyword legality when candidateKind is omitted (permissive parse-time default)", () => {
    const comments = [comment({ body: "@claude allow aaaaaaaaaaaa" })];
    const decisions = parseDecisions(comments, { isAuthorized: isOwner });
    expect(decisions).toHaveLength(1);
  });

  it("captures an `as Bash(<rule>)` override", () => {
    const comments = [comment({ body: "@claude allow aaaaaaaaaaaa as Bash(git status *)" })];
    const decisions = parseDecisions(comments, { isAuthorized: isOwner });
    expect(decisions[0].overrideRule).toBe("Bash(git status *)");
  });

  it("captures trailing free text as rationale, stripping a leading separator", () => {
    const comments = [comment({ body: "@claude allow aaaaaaaaaaaa - read-only, safe to allow" })];
    const decisions = parseDecisions(comments, { isAuthorized: isOwner });
    expect(decisions[0].rationale).toBe("read-only, safe to allow");
  });

  it("leaves rationale undefined when there is no trailing text", () => {
    const comments = [comment({ body: "@claude allow aaaaaaaaaaaa" })];
    const decisions = parseDecisions(comments, { isAuthorized: isOwner });
    expect(decisions[0].rationale).toBeUndefined();
  });

  it("parses multiple decisions out of one comment body, one per line", () => {
    const comments = [
      comment({
        body: ["@claude allow aaaaaaaaaaaa", "@claude deny bbbbbbbbbbbb"].join("\n"),
      }),
    ];
    const decisions = parseDecisions(comments, { isAuthorized: isOwner });
    expect(decisions.map((d) => d.id).sort()).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
  });

  it("ignores unrecognized text with no @claude decision grammar", () => {
    const comments = [comment({ body: "looks fine to me, approving separately" })];
    expect(parseDecisions(comments, { isAuthorized: isOwner })).toEqual([]);
  });
});

// --- isFrozen -----------------------------------------------------------------

describe("isFrozen", () => {
  it("is false with no freeze comment", () => {
    const comments = [comment({ body: "@claude allow aaaaaaaaaaaa" })];
    expect(isFrozen(comments, { isAuthorized: isOwner })).toBe(false);
  });

  it("is true given an authorized freeze comment", () => {
    const comments = [comment({ body: "@claude apply permission review" })];
    expect(isFrozen(comments, { isAuthorized: isOwner })).toBe(true);
  });

  it("is false given only an unauthorized freeze comment", () => {
    const comments = [
      comment({ author: "attacker", association: "NONE", body: "@claude apply permission review" }),
    ];
    expect(isFrozen(comments, { isAuthorized: isOwner })).toBe(false);
  });
});

// --- allDecidedOrDeferred -------------------------------------------------------

describe("allDecidedOrDeferred", () => {
  it("is false when a candidate has no decision at all", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa" }), candidate({ id: "bbbbbbbbbbbb", kind: "deny" })]);
    const decisions: Decision[] = [
      { id: "aaaaaaaaaaaa", keyword: "allow", actor: "shubham", association: "OWNER", commentId: "c1", at: "t" },
    ];
    expect(allDecidedOrDeferred(art, decisions)).toBe(false);
  });

  it("is true once every candidate has a decision (defer counts)", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa" }), candidate({ id: "bbbbbbbbbbbb", kind: "deny" })]);
    const decisions: Decision[] = [
      { id: "aaaaaaaaaaaa", keyword: "allow", actor: "shubham", association: "OWNER", commentId: "c1", at: "t" },
      { id: "bbbbbbbbbbbb", keyword: "defer", actor: "shubham", association: "OWNER", commentId: "c2", at: "t" },
    ];
    expect(allDecidedOrDeferred(art, decisions)).toBe(true);
  });

  it("is vacuously true for an empty candidate list", () => {
    expect(allDecidedOrDeferred(artifact([]), [])).toBe(true);
  });
});

// --- applyDecisions (Task 13 — the security crux) ------------------------------

function emptySettings(): SettingsJson {
  return { permissions: { allow: [], deny: [], ask: [] } };
}

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "aaaaaaaaaaaa",
    keyword: "allow",
    actor: "shubham",
    association: "OWNER",
    commentId: "c1",
    at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const NOW = "2026-09-08T00:00:00.000Z";

describe("applyDecisions", () => {
  it("appends a valid ok-level grant on bare `allow`", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(git status)", level: "ok" })]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.refused).toEqual([]);
    expect(result.applied).toEqual([{ id: "aaaaaaaaaaaa", keyword: "allow", rule: "Bash(git status)" }]);
    expect(result.settings.permissions?.allow).toEqual(["Bash(git status)"]);
    expect(result.managed["Bash(git status)"]).toMatchObject({ owner: "shubham", lastSeen: NOW });
  });

  it("refuses `allow <id> as Bash(*)` under bare `allow` (escalation via override)", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(git status)", level: "ok" })]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow", overrideRule: "Bash(*)" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([]);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0].id).toBe("aaaaaaaaaaaa");
    expect(result.settings.permissions?.allow).toEqual([]);
  });

  it("allows a risky candidate via allow-risky", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(git push)", level: "risky" })]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow-risky" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([{ id: "aaaaaaaaaaaa", keyword: "allow-risky", rule: "Bash(git push)" }]);
    expect(result.settings.permissions?.allow).toEqual(["Bash(git push)"]);
  });

  it("refuses a risky candidate via bare allow", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(git push)", level: "risky" })]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([]);
    expect(result.refused).toHaveLength(1);
  });

  it("refuses a destructive candidate via bare allow", () => {
    const art = artifact([
      candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(rm -rf ./build)", level: "destructive" }),
    ]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([]);
    expect(result.refused).toHaveLength(1);
    expect(result.settings.permissions?.allow).toEqual([]);
  });

  it("allows a destructive candidate via allow-destructive, exact byte-for-byte", () => {
    const art = artifact([
      candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(rm -rf ./build)", level: "destructive" }),
    ]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow-destructive" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([{ id: "aaaaaaaaaaaa", keyword: "allow-destructive", rule: "Bash(rm -rf ./build)" }]);
    expect(result.settings.permissions?.allow).toEqual(["Bash(rm -rf ./build)"]);
  });

  it("refuses a destructive override that differs byte-for-byte from the captured command", () => {
    const art = artifact([
      candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(rm -rf ./build)", level: "destructive" }),
    ]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow-destructive", overrideRule: "Bash(rm -rf ./other)" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([]);
    expect(result.refused).toHaveLength(1);
    expect(result.settings.permissions?.allow).toEqual([]);
  });

  it("refuses overriding an innocuous candidate into a destructive rule", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(echo hi)", level: "ok" })]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow-destructive", overrideRule: "Bash(rm -rf /)" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([]);
    expect(result.refused).toHaveLength(1);
  });

  it("refuses ANY decision targeting a reviewLocalOnly/sensitive candidate via remote apply", () => {
    const art = artifact([
      candidate({
        id: "aaaaaaaaaaaa",
        sensitive: true,
        reviewLocalOnly: true,
        proposedRule: undefined,
        redactedPreview: "sensitive — review locally",
      }),
    ]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([]);
    expect(result.refused).toEqual([
      { id: "aaaaaaaaaaaa", reason: expect.stringContaining("reviewLocalOnly") },
    ]);
  });

  it("refuses every decision when sourceBlobMatches is false (tamper check), leaving settings unchanged", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(git status)", level: "ok" })]);
    const settings = emptySettings();
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow" })],
      settings,
      managed: {},
      now: NOW,
      sourceBlobMatches: false,
    });
    expect(result.applied).toEqual([]);
    expect(result.refused).toEqual([
      { id: "aaaaaaaaaaaa", reason: expect.stringContaining("tamper") },
    ]);
    expect(result.settings).toEqual(settings);
    expect(result.managed).toEqual({});
  });

  it("is idempotent: applying the same valid decision twice never duplicates the rule", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(git status)", level: "ok" })]);
    const first = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    const second = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow" })],
      settings: first.settings,
      managed: first.managed,
      now: "2026-09-15T00:00:00.000Z",
      sourceBlobMatches: true,
    });
    expect(second.refused).toEqual([]);
    expect(second.applied).toEqual([{ id: "aaaaaaaaaaaa", keyword: "allow", rule: "Bash(git status)" }]);
    expect(second.settings.permissions?.allow).toEqual(["Bash(git status)"]);
    // firstSeen preserved across the idempotent re-apply; lastSeen advances.
    expect(second.managed["Bash(git status)"].firstSeen).toBe(NOW);
    expect(second.managed["Bash(git status)"].lastSeen).toBe("2026-09-15T00:00:00.000Z");
  });

  it("never mutates the input settings/managed objects (pure)", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(git status)", level: "ok" })]);
    const settings = emptySettings();
    const managed: ManagedMap = {};
    applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow" })],
      settings,
      managed,
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(settings.permissions?.allow).toEqual([]);
    expect(managed).toEqual({});
  });

  it("appends a deny rule regardless of level (restrictive decisions are outside level ordering)", () => {
    const art = artifact([
      candidate({
        id: "aaaaaaaaaaaa",
        kind: "deny",
        proposedRule: "Bash(git push --force)",
        level: "destructive",
      }),
    ]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "deny" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([{ id: "aaaaaaaaaaaa", keyword: "deny", rule: "Bash(git push --force)" }]);
    expect(result.settings.permissions?.deny).toEqual(["Bash(git push --force)"]);
    // deny never touches the managed (allow-rule) map.
    expect(result.managed).toEqual({});
  });

  it("revoke removes the rule from allow and from the managed map", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", kind: "revoke", proposedRule: "Bash(git log *)" })]);
    const settings: SettingsJson = { permissions: { allow: ["Bash(git log *)", "Bash(pnpm -v)"], deny: [], ask: [] } };
    const managed: ManagedMap = {
      "Bash(git log *)": {
        owner: "shubham",
        rationale: "frequent",
        firstSeen: "2026-01-01T00:00:00.000Z",
        lastSeen: "2026-01-01T00:00:00.000Z",
        count: 5,
      },
    };
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "revoke" })],
      settings,
      managed,
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([{ id: "aaaaaaaaaaaa", keyword: "revoke", rule: "Bash(git log *)" }]);
    expect(result.settings.permissions?.allow).toEqual(["Bash(pnpm -v)"]);
    expect(result.managed["Bash(git log *)"]).toBeUndefined();
  });

  it("refuses an illegal keyword/kind pair independently of parseDecisions (defense in depth)", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", kind: "deny", proposedRule: "Bash(git push --force)" })]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow" })], // allow is illegal against a deny-kind candidate
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([]);
    expect(result.refused).toHaveLength(1);
  });

  it("refuses an unknown candidate id", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa" })]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ id: "zzzzzzzzzzzz", keyword: "allow" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([]);
    expect(result.refused).toEqual([{ id: "zzzzzzzzzzzz", reason: expect.stringContaining("unknown candidate") }]);
  });

  it("skips a defer decision entirely: not applied, not refused, no mutation", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(git status)" })]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "defer" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([]);
    expect(result.refused).toEqual([]);
    expect(result.settings.permissions?.allow).toEqual([]);
  });

  it("honors a legal `as Bash(<rule>)` override that stays within the required keyword level", () => {
    const art = artifact([candidate({ id: "aaaaaaaaaaaa", proposedRule: "Bash(git status)", level: "ok" })]);
    const result = applyDecisions({
      artifact: art,
      decisions: [decision({ keyword: "allow", overrideRule: "Bash(git status *)" })],
      settings: emptySettings(),
      managed: {},
      now: NOW,
      sourceBlobMatches: true,
    });
    expect(result.applied).toEqual([{ id: "aaaaaaaaaaaa", keyword: "allow", rule: "Bash(git status *)" }]);
    expect(result.settings.permissions?.allow).toEqual(["Bash(git status *)"]);
  });
});
