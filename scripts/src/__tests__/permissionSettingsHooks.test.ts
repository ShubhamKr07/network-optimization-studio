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

  // toMatchObject, not toEqual: the point is that T7 did not clobber an existing
  // key, not that env is frozen — other rules legitimately add keys to it.
  it("preserves the pre-existing env block", () => {
    expect(settings.env).toMatchObject({ NOS_GLM_DELEGATION: "disabled" });
  });

  // The half the loosening above would otherwise drop. Everything in `env` is
  // injected into every tool and hook child process, so an unreviewed key here
  // is a real escalation surface — e.g. anything re-enabling GLM delegation
  // against hard rule #10, or repointing the API base URL. Adding a key is
  // fine; adding it to this allowlist in the same commit is the gate.
  it("carries no env key outside the reviewed allowlist", () => {
    expect(Object.keys(settings.env ?? {}).sort()).toEqual([
      "NOS_GLM_DELEGATION",
      "PONYTAIL_SUBAGENT_MATCHER",
    ]);
  });

  // Hard rule #12: ponytail's SubagentStart hook injects into every subagent
  // unless scoped, and qa-sdet must stay exempt. Widening this regex silently
  // re-injects the ruleset into qa-sdet and every reviewer/Explore subagent.
  it("scopes the ponytail subagent ruleset to the four engineering roles only", () => {
    const pattern = settings.env?.PONYTAIL_SUBAGENT_MATCHER;
    expect(pattern).toBeDefined();
    const re = new RegExp(pattern as string, "i");
    for (const role of ["backend-engineer", "frontend-engineer", "solver-engineer", "devops-engineer"]) {
      expect(re.test(role)).toBe(true);
    }
    for (const exempt of ["qa-sdet", "Explore", "general-purpose"]) {
      expect(re.test(exempt)).toBe(false);
    }
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
