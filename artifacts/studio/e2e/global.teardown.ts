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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

// The child must always be the thing that gives up first, so the two budgets
// are ordered deliberately: Playwright 120s > child 45s. The first version had
// them INVERTED (config's 30s default test timeout < a 60s child timeout) and
// used `execFileSync`, which blocks the worker's event loop so Playwright's
// timeout cannot even fire while it runs — the worker would block for the full
// 60s and Playwright would then report a TIMED-OUT test, i.e. a red suite
// caused by cleanup failing, which is exactly what "non-fatal" is supposed to
// prevent, and which the try/catch cannot absorb because the failure is
// Playwright's rather than the child's. Measured at ~1.0-1.2s against a clean
// database, so it was latent — and a large residue backlog or a loaded machine
// (this repo's documented load-flake class) is precisely when it would bite.
const CHILD_TIMEOUT_MS = 45_000;
const TEARDOWN_TIMEOUT_MS = 120_000;

teardown("purge the accounts this run created", async () => {
  teardown.setTimeout(TEARDOWN_TIMEOUT_MS);

  if (!process.env.DATABASE_URL) {
    console.log("[teardown] no DATABASE_URL — skipping test-user purge (specs ran against a remote target).");
    return;
  }

  try {
    // One invocation path, via the package script, so the script name and this
    // call site cannot drift apart.
    const { stdout } = await execFileAsync(
      "pnpm",
      ["--silent", "--filter", "@workspace/scripts", "run", "purge-test-users", "--", "--execute"],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: CHILD_TIMEOUT_MS },
    );
    console.log(`[teardown] ${stdout.trim()}`);
  } catch (err) {
    // Deliberately swallowed — see NON-FATAL above. Note the one case this
    // cannot distinguish: if the child is killed after its COMMIT landed, the
    // warning overstates the failure. The delete itself is still atomic — a
    // killed connection rolls back an uncommitted transaction — so the
    // database is never left half-purged either way.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[teardown] test-user purge failed (non-fatal, next run will collect them): ${msg}`);
  }
});
