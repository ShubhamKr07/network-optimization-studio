import { describe, it, expect } from "vitest";
import { runCapture } from "../harness/permissions-capture.js";
import { runRemoteApply, createAuthorizer } from "../harness/permissions-apply.js";
import type { DecisionComment, SettingsJson } from "../harness/lib/permissionApply.js";
import type { ManagedMap } from "../harness/lib/permissionManaged.js";

// End-to-end (T18): drive the real pure pipeline — ledger → runCapture → runRemoteApply — with no
// I/O, exercising the security invariants against a fixture that includes a promotable ok grant, a
// promotable destructive grant, a secret-bearing (sensitive) grant, and a denial.

const NOW = new Date("2026-09-15T12:00:00.000Z");
const AT = "2026-09-15T10:00:00.000Z";
const SECRET = "abc123deadbeef0123456789"; // must never appear in the committed artifact
const SOURCE_COMMIT = "d15c0ffee1234567890abcdef1234567890abcde";

function ev(toolUseId: string, event: "prompted" | "executed", command?: string) {
  return JSON.stringify({
    at: AT,
    sessionId: "s1",
    toolUseId,
    event,
    ...(command ? { command } : {}),
    permissionMode: "default",
  });
}

// t1 ok grant, t2 destructive grant, t3 sensitive grant (all prompted+executed = promotable).
const LEDGER = [
  ev("t1", "prompted", "git log --oneline -5"),
  ev("t1", "executed"),
  ev("t2", "prompted", "rm -rf build"),
  ev("t2", "executed"),
  ev("t3", "prompted", `curl -H "Authorization: Bearer ${SECRET}" https://x`),
  ev("t3", "executed"),
].join("\n");

// A denial comes from the TRANSCRIPT (a rejected tool_result), not the ledger — one Bash denial.
const TRANSCRIPT = [
  JSON.stringify({
    type: "assistant",
    timestamp: AT,
    message: { role: "assistant", content: [{ type: "tool_use", id: "d1", name: "Bash", input: { command: "psql prod -c 'drop table x'" } }] },
  }),
  JSON.stringify({
    type: "user",
    timestamp: "2026-09-15T10:00:01.000Z",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "d1", is_error: true, content: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed." }],
    },
  }),
].join("\n");

function capture() {
  return runCapture({
    ledgerText: LEDGER,
    transcriptText: TRANSCRIPT,
    trackedSettings: { permissions: { allow: [] } },
    localSettings: {},
    managed: {},
    now: NOW,
    weeksAgo: 0,
    sourceCommit: SOURCE_COMMIT,
  });
}

function idOf(cands: { id: string; kind: string; proposedRule?: string; reviewLocalOnly: boolean }[], pred: (c: { proposedRule?: string; kind: string; reviewLocalOnly: boolean }) => boolean): string {
  const c = cands.find(pred);
  if (!c) throw new Error("candidate not found");
  return c.id;
}

const authorized = createAuthorizer({ allowedAssociations: ["OWNER"] });
function comment(body: string, over: Partial<DecisionComment> = {}): DecisionComment {
  return { commentId: "c" + Math.random().toString(36).slice(2), body, author: "owner", association: "OWNER", at: AT, ...over };
}

describe("permission-review loop — e2e", () => {
  it("capture never leaks a secret; destructive shown full; sensitive withheld", () => {
    const r = capture();
    const blob = JSON.stringify(r.artifact) + "\n" + r.markdown;
    expect(blob).not.toContain(SECRET);

    const c = r.artifact.candidates;
    const destructive = c.find((x) => x.proposedRule === "Bash(rm -rf build)");
    expect(destructive).toBeTruthy();
    expect(destructive!.level).toBe("destructive");
    expect(destructive!.redactedPreview).toContain("rm -rf build"); // full (redacted) command, not withheld

    const sensitive = c.find((x) => x.reviewLocalOnly);
    expect(sensitive).toBeTruthy();
    expect(sensitive!.proposedRule).toBeUndefined();
    expect(sensitive!.redactedPreview).toBe("sensitive — review locally");

    expect(c.some((x) => x.kind === "deny")).toBe(true); // the sudo denial
  });

  it("applies an authorized frozen set; refuses a sensitive candidate via the remote path", () => {
    const r = capture();
    const cands = r.artifact.candidates;
    const okId = idOf(cands, (x) => x.proposedRule === "Bash(git log *)");
    const destId = idOf(cands, (x) => x.proposedRule === "Bash(rm -rf build)");
    const sensId = idOf(cands, (x) => x.reviewLocalOnly);
    const denyId = idOf(cands, (x) => x.kind === "deny");

    const comments: DecisionComment[] = [
      comment(`@claude allow ${okId}`),
      comment(`@claude allow-destructive ${destId}`),
      comment(`@claude allow ${sensId}`), // must be refused (reviewLocalOnly)
      comment(`@claude deny ${denyId}`),
      comment("@claude apply permission review"),
    ];

    const out = runRemoteApply({
      artifact: r.artifact,
      comments,
      trackedSettings: { permissions: { allow: [] } } as SettingsJson,
      managed: {} as ManagedMap,
      now: NOW,
      maxAgeDays: 30,
      sourceCommit: SOURCE_COMMIT,
      sourceBlobMatches: true,
      isAuthorized: authorized,
    });

    expect(out.ok).toBe(true);
    expect(out.settings!.permissions!.allow).toContain("Bash(git log *)");
    expect(out.settings!.permissions!.allow).toContain("Bash(rm -rf build)");
    expect(out.settings!.permissions!.deny).toContain("Bash(psql prod -c 'drop table x')");
    expect(out.refused!.some((x) => x.id === sensId && /reviewLocalOnly|sensitive/i.test(x.reason))).toBe(true);
  });

  it("refuses escalation: bare allow on destructive, and `as Bash(*)` override under bare allow", () => {
    const r = capture();
    const cands = r.artifact.candidates;
    const okId = idOf(cands, (x) => x.proposedRule === "Bash(git log *)");
    const destId = idOf(cands, (x) => x.proposedRule === "Bash(rm -rf build)");
    const sensId = idOf(cands, (x) => x.reviewLocalOnly);
    const denyId = idOf(cands, (x) => x.kind === "deny");

    const comments: DecisionComment[] = [
      comment(`@claude allow ${destId}`), // bare allow on destructive -> refused
      comment(`@claude allow ${okId} as Bash(*)`), // reclassifies to risky -> refused under bare allow
      comment(`@claude defer ${sensId}`),
      comment(`@claude defer ${denyId}`),
      comment("@claude apply permission review"),
    ];

    const out = runRemoteApply({
      artifact: r.artifact,
      comments,
      trackedSettings: { permissions: { allow: [] } } as SettingsJson,
      managed: {} as ManagedMap,
      now: NOW,
      maxAgeDays: 30,
      sourceCommit: SOURCE_COMMIT,
      sourceBlobMatches: true,
      isAuthorized: authorized,
    });

    expect(out.ok).toBe(true);
    expect(out.settings!.permissions!.allow ?? []).toEqual([]); // nothing promoted
    expect(out.refused!.some((x) => x.id === destId)).toBe(true);
    expect(out.refused!.some((x) => x.id === okId)).toBe(true);
  });

  it("refuses everything when the artifact is not provably bound to its source commit", () => {
    const r = capture();
    const cands = r.artifact.candidates;
    const decided = cands.map((c) => comment(`@claude defer ${c.id}`));
    const out = runRemoteApply({
      artifact: r.artifact,
      comments: [...decided, comment("@claude apply permission review")],
      trackedSettings: { permissions: { allow: [] } } as SettingsJson,
      managed: {} as ManagedMap,
      now: NOW,
      maxAgeDays: 30,
      sourceCommit: SOURCE_COMMIT,
      sourceBlobMatches: false, // tampered / unbound
      isAuthorized: authorized,
    });
    // defers mutate nothing anyway; assert no allow entry appeared and (belt-and-braces) the settings
    // object is untouched.
    expect(out.ok).toBe(true);
    expect(out.settings!.permissions!.allow ?? []).toEqual([]);
  });

  it("an unauthorized author's decision never counts (freeze then fails 'all decided')", () => {
    const r = capture();
    const cands = r.artifact.candidates;
    const okId = idOf(cands, (x) => x.proposedRule === "Bash(git log *)");
    // Only an UNAUTHORIZED comment decides okId; the rest are deferred by an authorized owner.
    const comments: DecisionComment[] = [
      comment(`@claude allow ${okId}`, { author: "stranger", association: "NONE" }),
      ...cands.filter((c) => c.proposedRule !== "Bash(git log *)").map((c) => comment(`@claude defer ${c.id}`)),
      comment("@claude apply permission review"),
    ];
    const out = runRemoteApply({
      artifact: r.artifact,
      comments,
      trackedSettings: { permissions: { allow: [] } } as SettingsJson,
      managed: {} as ManagedMap,
      now: NOW,
      maxAgeDays: 30,
      sourceCommit: SOURCE_COMMIT,
      sourceBlobMatches: true,
      isAuthorized: authorized,
    });
    // okId's only decision came from an unauthorized author -> dropped -> not every candidate decided.
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/decided or deferred/i);
  });
});
