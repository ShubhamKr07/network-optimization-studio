/**
 * Preflight for `pnpm --filter api-server test`.
 *
 * WHY THIS EXISTS (gates/other.md, approved 2026-10-05): this suite imports
 * `lib/db` at module load via `routes/scenarios.ts`, and `lib/db/src/index.ts:8`
 * throws `DATABASE_URL must be set…` at import time. Without the variable, that
 * is not one clear error — it is **21 files failing at COLLECTION**, which reads
 * exactly like a broad structural regression across registration, orphan proofs,
 * export integrity, max-coverage steps and four solver suites. It has twice cost
 * a full ~10-minute suite run plus a diagnostic run to attribute to a missing
 * environment variable.
 *
 * The problem was never that it fails. It is that it fails 21 times in a shape
 * that disguises the cause. This fails once, in under a second, naming it.
 *
 * Deliberately NOT solved by making the `lib/db` import lazy: that would hide the
 * misconfiguration until the first query and scatter the failure across runtime
 * instead of startup.
 */
if (!process.env.DATABASE_URL) {
  process.stderr.write(
    "\n  DATABASE_URL is not set.\n\n" +
      "  The api-server suite imports lib/db at module load, so EVERY test file fails at\n" +
      "  COLLECTION — not at an assertion. That looks like a broad structural regression\n" +
      "  and is not one. Set the variable and re-run:\n\n" +
      '    DATABASE_URL="postgresql://<user>@localhost:5432/nos_dev" pnpm --filter api-server test\n\n',
  );
  process.exit(1);
}
