import { describe, it, expect } from "vitest";
import {
  parseDecisions,
  isFrozen,
  allDecidedOrDeferred,
  type Decision,
  type DecisionComment,
  type Artifact,
} from "../harness/lib/permissionApply.js";
import type { Candidate } from "../harness/lib/permissions.js";

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
