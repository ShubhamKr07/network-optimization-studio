import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../harness/lib/derive.js";

interface HookCommand {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookCommand[];
}

interface Settings {
  $schema?: string;
  env?: Record<string, string>;
  hooks?: Record<string, HookMatcher[]>;
}

describe(".claude/settings.json — permission ledger hook registration (T7)", () => {
  const settingsPath = join(repoRoot(), ".claude", "settings.json");
  const raw = readFileSync(settingsPath, "utf8");

  it("parses as valid JSON", () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  const settings = JSON.parse(raw) as Settings;

  it("preserves the pre-existing env block", () => {
    expect(settings.env).toEqual({ NOS_GLM_DELEGATION: "disabled" });
  });

  it("registers both PermissionRequest and PostToolUse for a Bash matcher, each pointing at the committed hook", () => {
    expect(settings.hooks).toBeDefined();
    for (const event of ["PermissionRequest", "PostToolUse"] as const) {
      const matchers = settings.hooks?.[event];
      expect(Array.isArray(matchers)).toBe(true);
      expect(matchers!.length).toBeGreaterThan(0);

      const bashMatcher = matchers!.find((m) => m.matcher === "Bash");
      expect(bashMatcher, `expected a Bash matcher under hooks.${event}`).toBeDefined();
      expect(Array.isArray(bashMatcher!.hooks)).toBe(true);
      expect(bashMatcher!.hooks.length).toBeGreaterThan(0);

      for (const h of bashMatcher!.hooks) {
        expect(h.type).toBe("command");
        expect(typeof h.command).toBe("string");
        expect(h.command).toContain(".claude/hooks/permission-ledger.mjs");
      }
    }
  });

  it("the referenced hook file actually exists in the repo", () => {
    // Both registrations point at the same file per Task 6 (one script, dispatches on hook_event_name).
    const hookPath = join(repoRoot(), ".claude", "hooks", "permission-ledger.mjs");
    expect(() => readFileSync(hookPath, "utf8")).not.toThrow();
  });
});
