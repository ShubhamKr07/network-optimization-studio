import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseArgs,
  computeWindow,
  canonicalJson,
  runCapture,
  writeCaptureResult,
  buildMarkdown,
  type CaptureInputs,
} from "../harness/permissions-capture.js";
import type { ManagedMap } from "../harness/lib/permissionManaged.js";

function ledgerLine(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}

function ledgerPrompted(toolUseId: string, at: string, command: string): string {
  return ledgerLine({ at, sessionId: "s1", toolUseId, event: "prompted", command, permissionMode: "default" });
}

function ledgerExecuted(toolUseId: string, at: string): string {
  return ledgerLine({ at, sessionId: "s1", toolUseId, event: "executed", permissionMode: "default" });
}

function baseInputs(overrides: Partial<CaptureInputs> = {}): CaptureInputs {
  return {
    ledgerText: "",
    transcriptText: "",
    trackedSettings: { permissions: { allow: ["Bash(pnpm -v)"] } },
    localSettings: {},
    managed: {},
    now: new Date("2026-09-15T12:00:00.000Z"),
    weeksAgo: 0,
    sourceCommit: "abc1234",
    ...overrides,
  };
}

describe("parseArgs", () => {
  it("defaults to weeksAgo 0, dryRun false", () => {
    expect(parseArgs([])).toEqual({ weeksAgo: 0, dryRun: false });
  });

  it("parses --weeks-ago and --dry-run", () => {
    expect(parseArgs(["--weeks-ago", "2", "--dry-run"])).toEqual({ weeksAgo: 2, dryRun: true });
  });
});

describe("computeWindow", () => {
  it("returns a 7-day window ending at now when weeksAgo=0", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    const w = computeWindow(0, now);
    expect(w.end).toBe("2026-09-15T12:00:00.000Z");
    expect(w.start).toBe("2026-09-08T12:00:00.000Z");
  });

  it("shifts the window back by N weeks", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    const w = computeWindow(1, now);
    expect(w.end).toBe("2026-09-08T12:00:00.000Z");
    expect(w.start).toBe("2026-09-01T12:00:00.000Z");
  });
});

describe("canonicalJson", () => {
  it("sorts object keys recursively for a reproducible serialization", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });
});

describe("runCapture", () => {
  it("produces no secret in the artifact JSON or markdown for a sensitive command", () => {
    const secretToken = "sk_live_51H8abcdEFGH1234ijkl";
    const command = `mycli --deploy ${secretToken}`;
    const ledgerText = [ledgerPrompted("t1", "2026-09-14T10:00:00.000Z", command), ledgerExecuted("t1", "2026-09-14T10:00:01.000Z")].join(
      "\n",
    );
    const result = runCapture(baseInputs({ ledgerText }));
    const jsonText = JSON.stringify(result.artifact);
    expect(jsonText).not.toContain(secretToken);
    expect(jsonText).not.toContain(command);
    expect(result.markdown).not.toContain(secretToken);
    expect(result.markdown).not.toContain(command);
  });

  it("a sensitive candidate carries no proposedRule and is reviewLocalOnly", () => {
    const secretToken = "sk_live_51H8abcdEFGH1234ijkl";
    const command = `mycli --deploy ${secretToken}`;
    const ledgerText = [ledgerPrompted("t1", "2026-09-14T10:00:00.000Z", command), ledgerExecuted("t1", "2026-09-14T10:00:01.000Z")].join(
      "\n",
    );
    const result = runCapture(baseInputs({ ledgerText }));
    const grant = result.artifact.candidates.find((c) => c.kind === "grant");
    expect(grant).toBeDefined();
    expect(grant!.sensitive).toBe(true);
    expect(grant!.reviewLocalOnly).toBe(true);
    expect(grant!.proposedRule).toBeUndefined();
    expect(grant!.redactedPreview).toBe("sensitive — review locally");
    // The local sidecar DOES retain the full command, for local human review.
    expect(Object.values(result.local.commands)).toContain(command);
  });

  it("renders a destructive non-sensitive candidate in full under the Destructive section", () => {
    const command = "git reset --hard HEAD~3";
    const ledgerText = [ledgerPrompted("t1", "2026-09-14T10:00:00.000Z", command), ledgerExecuted("t1", "2026-09-14T10:00:01.000Z")].join(
      "\n",
    );
    const result = runCapture(baseInputs({ ledgerText }));
    const grant = result.artifact.candidates.find((c) => c.kind === "grant");
    expect(grant!.level).toBe("destructive");
    expect(grant!.sensitive).toBe(false);
    expect(grant!.redactedPreview).toBe(command); // nothing to redact, full text
    expect(result.markdown).toContain("## ⚠ Destructive — review in full");
    expect(result.markdown).toContain(command);
  });

  it("computes trackedSettingsDigest from the tracked settings' permissions object only (CI-reproducible)", () => {
    const trackedSettings = { permissions: { allow: ["Bash(git log *)"] }, env: { FOO: "bar" } };
    const localSettings = { permissions: { allow: ["Bash(pnpm -v)"] } };
    const a = runCapture(baseInputs({ trackedSettings, localSettings }));
    // Local-only settings must NOT affect the tracked digest (CI never has settings.local.json).
    const b = runCapture(baseInputs({ trackedSettings, localSettings: {} }));
    expect(a.artifact.trackedSettingsDigest).toBe(b.artifact.trackedSettingsDigest);
    // But it DOES change if the tracked permissions object changes.
    const c = runCapture(
      baseInputs({ trackedSettings: { permissions: { allow: ["Bash(git status *)"] } }, localSettings }),
    );
    expect(a.artifact.trackedSettingsDigest).not.toBe(c.artifact.trackedSettingsDigest);
  });

  it("filters an already-allowed command out of the grant candidates", () => {
    const ledgerText = [ledgerPrompted("t1", "2026-09-14T10:00:00.000Z", "pnpm -v"), ledgerExecuted("t1", "2026-09-14T10:00:01.000Z")].join(
      "\n",
    );
    const result = runCapture(baseInputs({ ledgerText })); // "Bash(pnpm -v)" already in trackedSettings
    expect(result.artifact.candidates.filter((c) => c.kind === "grant")).toHaveLength(0);
  });

  it("includes revoke proposals for stale managed rules", () => {
    const managed: ManagedMap = {
      "Bash(git log *)": {
        owner: "shubham",
        rationale: "test",
        firstSeen: "2026-01-01T00:00:00.000Z",
        lastSeen: "2026-01-01T00:00:00.000Z",
        count: 3,
      },
    };
    const result = runCapture(baseInputs({ managed }));
    const revoke = result.artifact.candidates.find((c) => c.kind === "revoke");
    expect(revoke).toBeDefined();
    expect(result.markdown).toContain("## Revoke proposals");
  });

  it("artifact carries schemaVersion/sourceCommit/window/generatedAt/candidates", () => {
    const result = runCapture(baseInputs());
    expect(result.artifact.schemaVersion).toBeGreaterThan(0);
    expect(result.artifact.sourceCommit).toBe("abc1234");
    expect(result.artifact.window.start).toBeDefined();
    expect(result.artifact.window.end).toBeDefined();
    expect(result.artifact.generatedAt).toBe("2026-09-15T12:00:00.000Z");
    expect(Array.isArray(result.artifact.candidates)).toBe(true);
  });
});

describe("buildMarkdown", () => {
  it("includes the decision legend and all four sections even when empty", () => {
    const md = buildMarkdown(
      "2026-38",
      { generatedAt: "2026-09-15T12:00:00.000Z", window: { start: "a", end: "b" }, sourceCommit: "abc" },
      [],
    );
    expect(md).toContain("Decision legend");
    expect(md).toContain("## Grant candidates");
    expect(md).toContain("## Deny candidates");
    expect(md).toContain("## Revoke proposals");
    expect(md).toContain("## ⚠ Destructive — review in full");
  });
});

describe("writeCaptureResult", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "perm-capture-write-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("--dry-run writes nothing", () => {
    const result = runCapture(baseInputs());
    const paths = writeCaptureResult(result, { root: dir, dryRun: true });
    expect(existsSync(paths.jsonPath)).toBe(false);
    expect(existsSync(paths.mdPath)).toBe(false);
    expect(existsSync(paths.localPath)).toBe(false);
  });

  it("a real run writes the json/md artifact and the gitignored local sidecar", () => {
    const result = runCapture(baseInputs());
    const paths = writeCaptureResult(result, { root: dir, dryRun: false });
    expect(existsSync(paths.jsonPath)).toBe(true);
    expect(existsSync(paths.mdPath)).toBe(true);
    expect(existsSync(paths.localPath)).toBe(true);

    const written = JSON.parse(readFileSync(paths.jsonPath, "utf8"));
    expect(written.schemaVersion).toBe(result.artifact.schemaVersion);
    expect(paths.jsonPath).toContain(join("docs", "superpowers", "metrics", "permissions-review"));
    expect(paths.localPath).toContain(join(".harness", "permissions"));
  });
});
