import { describe, it, expect } from "vitest";
import { parseComment, parseReviewComments, planResolution, type Finding } from "../harness/lib/reviewComments.js";

describe("parseComment", () => {
  it("recognizes each form, case-insensitively, first-token", () => {
    expect(parseComment("keep")).toEqual({ decision: "keep" });
    expect(parseComment("APPLY")).toEqual({ decision: "apply" });
    expect(parseComment("edit: use the new path instead")).toEqual({ decision: "edit", arg: "use the new path instead" });
    expect(parseComment("Delete")).toEqual({ decision: "delete" });
    expect(parseComment("defer")).toEqual({ decision: "defer" });
    expect(parseComment("dismiss: false positive, path moved")).toEqual({ decision: "dismiss", arg: "false positive, path moved" });
  });
  it("treats anything unrecognized as a question", () => {
    expect(parseComment("why did you flag this?")).toEqual({ decision: "question" });
    expect(parseComment("hmm not sure")).toEqual({ decision: "question" });
  });
});

describe("planResolution — three findings from two stacked sweeps + an unrecognized comment", () => {
  // Fixture: 3 repo findings (commits) + 1 memory finding across two sweeps.
  const findings: Finding[] = [
    { id: "aaaaaaaaaa", commitSha: "c0ffee1", origin: "repo" },
    { id: "bbbbbbbbbb", commitSha: "c0ffee2", origin: "repo" },
    { id: "cccccccccc", commitSha: "c0ffee3", origin: "repo" },
    { id: "dddddddddd", commitSha: "", origin: "memory" },
  ];
  const comments = [
    { findingId: "aaaaaaaaaa", body: "apply" },
    { findingId: "bbbbbbbbbb", body: "keep" },
    { findingId: "cccccccccc", body: "edit: replace with the current heading" },
    { findingId: "dddddddddd", body: "apply" },
    { findingId: "aaaaaaaaaa", body: "wait, what does this touch?" }, // unrecognized → question (last wins in map)
  ];

  it("maps decisions to the expected actions and commit operations", () => {
    const parsed = parseReviewComments(comments);
    const plan = planResolution(findings, parsed);
    const byId = Object.fromEntries(plan.map((p) => [p.findingId, p]));

    // aaaa: last comment for it is the unrecognized one → question (no change)
    expect(byId["aaaaaaaaaa"]).toMatchObject({ decision: "question", action: "answer" });
    // bbbb: keep → revert its commit
    expect(byId["bbbbbbbbbb"]).toMatchObject({ decision: "keep", action: "revert", target: "c0ffee2" });
    // cccc: edit → new commit
    expect(byId["cccccccccc"]).toMatchObject({ decision: "edit", action: "new-commit-edit" });
    // dddd: memory apply → apply-memory (no git)
    expect(byId["dddddddddd"]).toMatchObject({ decision: "apply", action: "apply-memory", target: "memory" });

    // resulting git commit-affecting ops: exactly one revert + one new-commit; keeps/questions/memory don't add commits
    const reverts = plan.filter((p) => p.action === "revert");
    const newCommits = plan.filter((p) => p.action.startsWith("new-commit"));
    expect(reverts.map((r) => r.target)).toEqual(["c0ffee2"]);
    expect(newCommits).toHaveLength(1);
  });

  it("defaults: a repo finding with no comment = apply (keep commit); memory with no comment = defer", () => {
    const plan = planResolution(findings, parseReviewComments([]));
    expect(plan.find((p) => p.findingId === "aaaaaaaaaa")).toMatchObject({ decision: "apply", action: "keep" });
    expect(plan.find((p) => p.findingId === "dddddddddd")).toMatchObject({ decision: "defer" });
  });
});
