/**
 * HND-A — delete the accounts this suite just created.
 *
 * Every spec registers a fresh account per test for isolation and cleans up
 * its SCENARIOS in a `finally`/`afterAll`, but never its USER: a Playwright
 * process has no database access and there is no self-delete endpoint. The
 * result measured on 2026-10-01 was 2040 rows in `nos_dev` of which 2039 were
 * residue, roughly 90% of it produced in two days by sibling worktrees sharing
 * one database.
 *
 * Why a run-level teardown rather than a per-spec `afterAll`: specs reach the
 * server only over HTTP, so a per-spec hook would need a `DELETE /auth/me`
 * endpoint — real production surface added for a test-only need. A teardown
 * that runs once, out-of-band, in the Node process that already has the repo
 * on disk, costs no production surface at all.
 *
 * Why it shells out instead of importing: `artifacts/studio` depends on
 * neither `pg` nor `@workspace/db`, and adding a database driver to the
 * frontend package to clean up after tests is the wrong trade. The real logic,
 * its predicate, its guards and its FK ordering live in
 * `scripts/src/purge-test-users.ts` next to the other destructive-cleanup
 * scripts.
 *
 * NON-FATAL BY DESIGN. A teardown that fails the run because cleanup failed
 * turns a hygiene problem into a red suite and teaches everyone to ignore it.
 * It warns and returns: the accounts are harmless, just untidy, and the next
 * run collects them.
 *
 * Skips silently without `DATABASE_URL` — the common case of running specs
 * against a deployed target from a machine with no database access.
 */
import { test as teardown } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

teardown("purge the accounts this run created", async () => {
  if (!process.env.DATABASE_URL) {
    console.log("[teardown] no DATABASE_URL — skipping test-user purge (specs ran against a remote target).");
    return;
  }

  try {
    const out = execFileSync(
      "pnpm",
      ["--filter", "@workspace/scripts", "exec", "tsx", "src/purge-test-users.ts", "--execute"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    console.log(`[teardown] ${out.trim()}`);
  } catch (err) {
    // Deliberately swallowed — see NON-FATAL above.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[teardown] test-user purge failed (non-fatal, next run will collect them): ${msg}`);
  }
});
