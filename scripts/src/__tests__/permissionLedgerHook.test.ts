import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../harness/lib/derive.js";

// Real subprocess test against the standalone hook script -- it must be directly runnable by
// Claude Code (plain node, no bundler), so we invoke it exactly the way settings.json will
// (`node <hook path>`, hook JSON piped on stdin) rather than importing it as a module.
const HOOK = join(repoRoot(), ".claude", "hooks", "permission-ledger.mjs");

function runHook(payload: Record<string, unknown>, cwd: string): { status: number | null } {
  try {
    execFileSync("node", [HOOK], { input: JSON.stringify(payload), cwd, encoding: "utf8" });
    return { status: 0 };
  } catch (e: unknown) {
    return { status: (e as { status?: number }).status ?? 1 };
  }
}

function ledgerPath(cwd: string): string {
  return join(cwd, ".harness", "permissions", "ledger.jsonl");
}

describe("permission-ledger.mjs hook (T6)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "perm-ledger-hook-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends a 'prompted' line on PermissionRequest for a Bash tool call", () => {
    const { status } = runHook(
      {
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: { command: "git status" },
        session_id: "s1",
        tool_use_id: "t1",
        permission_mode: "default",
        cwd: dir,
      },
      dir,
    );
    expect(status).toBe(0);
    const raw = readFileSync(ledgerPath(dir), "utf8").trim();
    const record = JSON.parse(raw);
    expect(record.event).toBe("prompted");
    expect(record.command).toBe("git status");
    expect(record.toolUseId).toBe("t1");
    expect(record.sessionId).toBe("s1");
    expect(record.permissionMode).toBe("default");
  });

  it("appends an 'executed' line on PostToolUse for a Bash tool call, with no command field", () => {
    const { status } = runHook(
      {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        session_id: "s1",
        tool_use_id: "t1",
        permission_mode: "default",
        cwd: dir,
      },
      dir,
    );
    expect(status).toBe(0);
    const record = JSON.parse(readFileSync(ledgerPath(dir), "utf8").trim());
    expect(record.event).toBe("executed");
    expect(record.command).toBeUndefined();
  });

  it("never writes anything for a non-Bash tool", () => {
    const { status } = runHook(
      { hook_event_name: "PermissionRequest", tool_name: "Edit", tool_input: { file_path: "x" }, cwd: dir },
      dir,
    );
    expect(status).toBe(0);
    expect(existsSync(ledgerPath(dir))).toBe(false);
  });

  it("never blocks (exit 0) even on malformed stdin JSON", () => {
    const result = (() => {
      try {
        execFileSync("node", [HOOK], { input: "{ not json", cwd: dir, encoding: "utf8" });
        return 0;
      } catch (e: unknown) {
        return (e as { status?: number }).status ?? 1;
      }
    })();
    expect(result).toBe(0);
    expect(existsSync(ledgerPath(dir))).toBe(false);
  });

  it("never blocks (exit 0) for an unrecognized hook_event_name", () => {
    const { status } = runHook({ hook_event_name: "SomethingElse", tool_name: "Bash", cwd: dir }, dir);
    expect(status).toBe(0);
    expect(existsSync(ledgerPath(dir))).toBe(false);
  });
});
