import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot, mainCheckoutRoot } from "../harness/lib/derive.js";

/**
 * Regression tests for the harness:permissions WORKTREE BLIND SPOT.
 *
 * The bug was not that the audit reported wrong numbers — it is that it PASSED.
 * Run from a git worktree, `repoRoot()` resolved to the worktree (a worktree is a
 * full checkout, and repoRoot walks up from the script's own file), where
 * `.claude/settings.local.json` does not exist because it is gitignored and
 * machine-local. `existsSync` failed, allow/deny became empty, the gate found no
 * risky grants in an empty list, and the command printed 0 allow / 0 deny /
 * 0 broad / 0 risky and exited 0 — indistinguishable to any caller from a
 * genuinely clean audit.
 *
 * It happened twice (ch9-tc and cleanups, both 2026-10-02, recorded in
 * permissions.csv as `NOT MEASURED` with `unknown` counts rather than 0 so the
 * rows could not be misread as "grants dropped to zero").
 *
 * So these tests assert the two halves of the fix: resolve against the MAIN
 * checkout, and refuse to pass when the file is absent.
 */

const thisFile = fileURLToPath(import.meta.url);
const auditScript = join(dirname(thisFile), "..", "harness", "audit-permissions.ts");

describe("mainCheckoutRoot", () => {
  it("resolves to the checkout holding the shared .git, not the caller's worktree", () => {
    // From the main checkout the two agree; the distinction only appears in a
    // worktree, which the integration test below covers.
    expect(mainCheckoutRoot()).toBe(repoRoot());
  });

  it("points at a directory that actually contains .git", () => {
    expect(existsSync(join(mainCheckoutRoot(), ".git"))).toBe(true);
  });
});

describe("audit-permissions: refuses to pass while blind", () => {
  it("exits NON-ZERO when the settings file is absent, instead of reporting 0/0/0/0", () => {
    // Point --settings at a path that certainly does not exist. Before the fix
    // this warned and continued to a clean-looking 0/0/0/0 with exit 0.
    const missing = join(mkdtempSync(join(tmpdir(), "perm-blindspot-")), "settings.local.json");
    let code = 0;
    let stderr = "";
    try {
      execFileSync("npx", ["tsx", auditScript, "--", "--task", "blindspot-test", "--settings", missing], {
        cwd: join(repoRoot(), "scripts"),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as { status?: number; stderr?: string };
      code = err.status ?? -1;
      stderr = err.stderr ?? "";
    }

    expect(code).not.toBe(0);
    expect(stderr).toContain("NOT MEASURED");
    // The message must name the path it looked at — the original failure was
    // impossible to diagnose precisely because nobody could see which file it read.
    expect(stderr).toContain(missing);
  });
});

describe("the git property mainCheckoutRoot relies on", () => {
  it("`git rev-parse --git-common-dir` from a worktree points back at the MAIN checkout", () => {
    // mainCheckoutRoot() is only correct if this git property holds, so test the
    // property against real git rather than mocking it.
    //
    // Deliberately NOT an end-to-end import from inside the worktree: a freshly
    // created worktree has no node_modules, so tsx cannot run there. That is a
    // limitation of the test environment, not of the fix — the resolution itself
    // is pure git plumbing, which is exactly what this asserts.
    const root = repoRoot();
    const wt = mkdtempSync(join(tmpdir(), "perm-wt-"));
    const path = join(wt, "probe");
    try {
      execFileSync("git", ["worktree", "add", "--detach", path, "HEAD"], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      });

      // A worktree is a full checkout, so a repoRoot()-style walk lands HERE...
      expect(existsSync(join(path, "pnpm-workspace.yaml"))).toBe(true);
      // ...but the machine-local settings file does NOT exist here. This single
      // assertion is the bug: resolving against the worktree finds nothing.
      expect(existsSync(join(path, ".claude", "settings.local.json"))).toBe(false);

      const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
        cwd: path,
        encoding: "utf8",
      }).trim();
      const resolvedMain = dirname(resolve(path, common));

      expect(resolvedMain).toBe(root);
      // And the file the audit actually needs is there.
      expect(existsSync(join(resolvedMain, ".claude", "settings.local.json"))).toBe(true);
    } finally {
      try {
        execFileSync("git", ["worktree", "remove", "--force", path], { cwd: root, stdio: "pipe" });
      } catch {
        /* best effort */
      }
      rmSync(wt, { recursive: true, force: true });
    }
  }, 120_000);
});
