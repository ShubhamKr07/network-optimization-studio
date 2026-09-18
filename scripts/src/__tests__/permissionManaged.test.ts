import { describe, it, expect } from "vitest";
import {
  refreshUsage,
  proposeRevocations,
  computeCandidateId,
  type ManagedMap,
} from "../harness/lib/permissionManaged.js";

function managed(overrides: Partial<ManagedMap[string]> = {}): ManagedMap[string] {
  return {
    owner: "shubham",
    rationale: "frequently used read-only git command",
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-01-01T00:00:00.000Z",
    count: 0,
    ...overrides,
  };
}

describe("refreshUsage", () => {
  it("matches an executed command against a wildcard managed rule via matchesProjectAllow (glob, not digest-vs-key)", () => {
    const m: ManagedMap = { "Bash(git log *)": managed() };
    const next = refreshUsage(m, [{ command: "git log -5 --oneline", at: "2026-02-01T00:00:00.000Z" }]);
    expect(next["Bash(git log *)"].count).toBe(1);
    expect(next["Bash(git log *)"].lastSeen).toBe("2026-02-01T00:00:00.000Z");
  });

  it("bumps count/lastSeen once per matching executed command, across multiple rules independently", () => {
    const m: ManagedMap = {
      "Bash(git log *)": managed(),
      "Bash(pnpm -v)": managed(),
    };
    const next = refreshUsage(m, [
      { command: "git log --oneline -3", at: "2026-02-01T00:00:00.000Z" },
      { command: "git log -1", at: "2026-02-02T00:00:00.000Z" },
      { command: "pnpm -v", at: "2026-02-03T00:00:00.000Z" },
    ]);
    expect(next["Bash(git log *)"].count).toBe(2);
    expect(next["Bash(git log *)"].lastSeen).toBe("2026-02-02T00:00:00.000Z");
    expect(next["Bash(pnpm -v)"].count).toBe(1);
    expect(next["Bash(pnpm -v)"].lastSeen).toBe("2026-02-03T00:00:00.000Z");
  });

  it("leaves a non-matching rule's count/lastSeen untouched", () => {
    const m: ManagedMap = { "Bash(pnpm -v)": managed({ count: 3, lastSeen: "2026-01-15T00:00:00.000Z" }) };
    const next = refreshUsage(m, [{ command: "git status", at: "2026-02-01T00:00:00.000Z" }]);
    expect(next["Bash(pnpm -v)"]).toEqual(m["Bash(pnpm -v)"]);
  });

  it("does not mutate the input map", () => {
    const m: ManagedMap = { "Bash(git log *)": managed() };
    refreshUsage(m, [{ command: "git log -1", at: "2026-02-01T00:00:00.000Z" }]);
    expect(m["Bash(git log *)"].count).toBe(0);
  });
});

describe("proposeRevocations", () => {
  const NOW = "2026-03-01T00:00:00.000Z"; // 8 weeks after 2026-01-01

  it("proposes revoke for a rule unused for >= staleWeeks", () => {
    const m: ManagedMap = { "Bash(git log *)": managed({ lastSeen: "2026-01-01T00:00:00.000Z" }) };
    const candidates = proposeRevocations(m, NOW, 8);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe("revoke");
    expect(candidates[0].proposedRule).toBe("Bash(git log *)");
    expect(candidates[0].sensitive).toBe(false);
    expect(candidates[0].reviewLocalOnly).toBe(false);
    expect(candidates[0].id).toHaveLength(12);
  });

  it("does not propose revoke for a recently-used rule", () => {
    const m: ManagedMap = { "Bash(git log *)": managed({ lastSeen: "2026-02-25T00:00:00.000Z" }) };
    expect(proposeRevocations(m, NOW, 8)).toEqual([]);
  });

  it("proposes revoke for a rule past its expiry even if recently used", () => {
    const m: ManagedMap = {
      "Bash(pnpm run build)": managed({ lastSeen: "2026-02-28T00:00:00.000Z", expiry: "2026-02-01T00:00:00.000Z" }),
    };
    const candidates = proposeRevocations(m, NOW, 8);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].proposedRule).toBe("Bash(pnpm run build)");
  });

  it("classifies the revoke candidate's level from the rule itself", () => {
    const m: ManagedMap = { "Bash(rm -rf test-results)": managed({ lastSeen: "2026-01-01T00:00:00.000Z" }) };
    const candidates = proposeRevocations(m, NOW, 8);
    expect(candidates[0].level).toBe("destructive");
  });
});

describe("computeCandidateId", () => {
  it("is stable for the same kind+rule", () => {
    const a = computeCandidateId("grant", "Bash(git log *)");
    const b = computeCandidateId("grant", "Bash(git log *)");
    expect(a).toBe(b);
    expect(a).toHaveLength(12);
  });

  it("differs across kind or rule", () => {
    const a = computeCandidateId("grant", "Bash(git log *)");
    const b = computeCandidateId("deny", "Bash(git log *)");
    const c = computeCandidateId("grant", "Bash(git status *)");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
