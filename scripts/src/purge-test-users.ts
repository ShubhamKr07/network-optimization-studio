import { fileURLToPath } from "node:url";
import { and, inArray, notInArray, or, sql } from "drizzle-orm";
import { db, pool, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";

// HND-A — delete the accounts e2e runs leave behind.
//
// Every Playwright spec registers a fresh account per test for isolation and
// cleans up its SCENARIOS in a `finally`/`afterAll`, but never its USER —
// Playwright has no DB access and there is no self-delete endpoint. Measured
// 2026-10-01 on `nos_dev`: 2040 users, of which 2039 were residue, ~90% of it
// created in two days by sibling worktrees sharing one database.
//
// TWO PREDICATES, deliberately different, because the two callers have
// different risk profiles:
//
//   * This script (automated, runs after every e2e suite) deletes ONLY
//     addresses matching a known test shape on a known test domain. It cannot
//     touch a developer's own account even if they are logged into the same
//     database, because a human address matches neither list.
//   * The ONE-TIME purge (2026-10-01, human-approved, taken after a pg_dump)
//     used the inverse: keep `seed@local`, delete everything else. That is the
//     right call for a known-dirty database with a human watching, and the
//     wrong default for a hook that fires unattended. Do not "simplify" this
//     script into that predicate.
//
// The shapes are derived from what the suite actually produces, not guessed.
// Re-derive before trusting this list on another database:
//   SELECT regexp_replace(split_part(email,'@',1), '[0-9].*$', ''), count(*)
//   FROM users GROUP BY 1 ORDER BY 2 DESC;

/** Local-part prefixes the test suites generate. */
export const TEST_LOCAL_PREFIXES = [
  "e2e-",
  "journey_test_",
  "qa-",
  "repro-",
  "probe-",
  "smoke+",
  "diag",
  "uidiag",
  "ch9diag",
  "hnd-", // api-server vitest helpers (these DO clean up after themselves;
          // listed so a failed run's leftovers are still collectable)
  "ch4-2s-",
];

/** Domains the suites use. A real address is never on one of these. */
export const TEST_DOMAINS = ["test.com", "example.com", "example.test"];

/**
 * Addresses that must NEVER be deleted regardless of shape. `seed@local` is
 * the seeded demo account every local database is expected to have.
 */
export const PROTECTED_EMAILS = ["seed@local"];

/**
 * Hosts this script may delete from. **An ALLOWLIST, deliberately — the first
 * version was a denylist of hosting providers and it did not match this repo's
 * own production database.**
 *
 * `render.yaml:41-42` records that `nos-api`'s `DATABASE_URL` was set in the
 * Dashboard to Render's **INTERNAL** connection string, whose host is the bare
 * instance id with no domain suffix (`…@dpg-d9hg4bmpbkes73a0j6l0-a/nos_postgres`).
 * A `/render\.com|…/` denylist refuses the *external* URL and sails straight
 * past the internal one that production actually uses. The same denylist also
 * missed Supabase's `…pooler.supabase.com` (it only listed `.co`) and Neon's
 * `.build` hosts — a provider denylist loses this race permanently, because it
 * has to enumerate every hostname anyone might ever deploy to.
 *
 * `PURGE_ALLOW_HOST` is the escape hatch for a non-local test database (a
 * throwaway container on another host, say). It is opt-in per invocation and
 * never defaulted.
 */
export const ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

export function assertPurgeableDatabase(databaseUrl: string | undefined): void {
  if (!databaseUrl) {
    throw new Error("Refusing to purge: DATABASE_URL is not set.");
  }
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("Refusing to purge: DATABASE_URL is not a parseable URL.");
  }
  const allowed = [...ALLOWED_HOSTS];
  if (process.env.PURGE_ALLOW_HOST) allowed.push(process.env.PURGE_ALLOW_HOST);
  if (!allowed.includes(host)) {
    throw new Error(
      `Refusing to purge: database host ${JSON.stringify(host)} is not in the allowlist ` +
      `(${allowed.join(", ")}). This script deletes rows unattended after every e2e run and is ` +
      `for local/CI test databases only. If this really is a throwaway database, set ` +
      `PURGE_ALLOW_HOST=${host} for that invocation.`,
    );
  }
}

type Db = typeof db;

export interface TestUserCounts {
  userIds: string[];
  scenarioCount: number;
  jobCount: number;
}

/**
 * Users whose email matches BOTH a test prefix AND a test domain, minus the
 * protected list. Both halves are required: `diag…@example.com` is residue,
 * but a hypothetical `diagnostics@realcompany.com` is not.
 */
export async function countTestUsers(database: Db = db): Promise<TestUserCounts> {
  // An empty protected list would silently disable both guards rather than
  // fail: `notInArray(col, [])` renders `and true`, and the collision check
  // below would find no rows to compare against. Make the emptiness loud.
  if (PROTECTED_EMAILS.length === 0) {
    throw new Error("Refusing to purge: PROTECTED_EMAILS is empty, which would disable every guard.");
  }

  // Composed with or()/like() rather than `LIKE ANY (<array>)`. Drizzle
  // renders a JS array into SQL as a parenthesised parameter list — a ROW
  // constructor, `($1, $2, …)` — which Postgres rejects for `LIKE ANY`, since
  // that wants a genuine array. Caught by running this script, not by
  // typecheck: the types are identical either way. Verified with
  // drizzle-orm@0.45.2.
  //
  // Everything is compared `lower()`-folded on both sides. Postgres `LIKE` is
  // case-sensitive and the `unique()` index on `email` is too, so without this
  // a protected entry whose case differs from the stored row protects nothing —
  // `QA-RealPerson@test.com` in the list leaves `qa-realperson@test.com`
  // matched for deletion. `auth.ts` normalises new rows to lowercase, so this
  // is defence for legacy/hand-inserted rows and for the next person who adds
  // a protected entry, not for the current data.
  //
  // `_` is escaped because it is a single-character LIKE wildcard: the
  // unescaped `journey_test_%` also matches `journeyXtestY-1@test.com`
  // (verified). Confined to the test domains, so it could never have reached a
  // real address — but the predicate should mean what it says.
  const esc = (s: string) => s.replace(/([%_\\])/g, "\\$1");
  const lowerEmail = sql`lower(${usersTable.email})`;
  const matchesPrefix = or(...TEST_LOCAL_PREFIXES.map((p) => sql`${lowerEmail} LIKE ${`${esc(p.toLowerCase())}%`}`));
  const matchesDomain = or(...TEST_DOMAINS.map((d) => sql`${lowerEmail} LIKE ${`%@${esc(d.toLowerCase())}`}`));
  const notProtected = sql`${lowerEmail} NOT IN ${PROTECTED_EMAILS.map((e) => e.toLowerCase())}`;

  const rows = await database
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(matchesPrefix, matchesDomain, notProtected));
  const userIds = rows.map((r) => r.id);

  if (userIds.length === 0) {
    return { userIds, scenarioCount: 0, jobCount: 0 };
  }

  const scenarios = await database
    .select({ id: scenariosTable.id })
    .from(scenariosTable)
    .where(inArray(scenariosTable.userId, userIds));
  const jobs = await database
    .select({ id: solveJobsTable.id })
    .from(solveJobsTable)
    .where(inArray(solveJobsTable.userId, userIds));

  return { userIds, scenarioCount: scenarios.length, jobCount: jobs.length };
}

export interface PurgeResult {
  userCount: number;
  scenarioCount: number;
  jobCount: number;
}

/**
 * Deletes in FK order — solve_jobs, then scenarios, then users. Both FKs to
 * `users` are NO ACTION (verified 2026-10-01), so a wrong order fails loudly
 * instead of cascading silently; the order here is what makes it succeed, not
 * a formality.
 *
 * Re-counts inside the call rather than trusting the caller's number, so a
 * population that changed since the caller looked cannot be deleted against a
 * stale confirmation. Same guard as migrate-delete-chens-scenarios.ts.
 */
export async function purgeTestUsers(database: Db = db): Promise<PurgeResult> {
  // Enforced here, not only in the CLI, so an importer cannot bypass it.
  assertPurgeableDatabase(process.env.DATABASE_URL);
  const fresh = await countTestUsers(database);
  if (fresh.userIds.length === 0) {
    return { userCount: 0, scenarioCount: 0, jobCount: 0 };
  }

  // Belt-and-braces: a protected address must never reach the delete, even if
  // the SQL predicate above were edited wrongly later.
  const protectedRows = await database
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(inArray(usersTable.email, PROTECTED_EMAILS));
  const protectedIds = new Set(protectedRows.map((r) => r.id));
  const colliding = fresh.userIds.filter((id) => protectedIds.has(id));
  if (colliding.length > 0) {
    throw new Error(
      `Refusing to purge: the match set contains protected account(s) ${colliding.join(", ")}. ` +
      `This means the predicate in countTestUsers() is wrong — fix it rather than this guard.`,
    );
  }

  // Cross-ownership pre-flight. Both of these are reachable and both are bad
  // in a way the delete itself would not report:
  //
  //   (a) a solve_job owned by a SURVIVING user but attached to a matched
  //       user's scenario -> `delete from scenarios` violates
  //       solve_jobs_scenario_id_scenarios_id_fk, the transaction rolls back
  //       (correctly, nothing is orphaned) and the teardown swallows the
  //       error, so every later run deletes nothing and nobody is told.
  //   (b) a SURVIVING user's scenario pointing at a matched user's job -> the
  //       ON DELETE SET NULL FK silently nulls `result_run_id`/
  //       `latest_solve_job_id` on a row that was never meant to be touched,
  //       and the purge log reports only the rows it deleted.
  //
  // The production path cannot produce either: `enqueueScenarioSolve` locks an
  // ownership-filtered scenario and stamps that same userId. But the
  // lower-level `enqueueSolveJob(scenarioId, userId, input)` takes the two
  // independently and is documented as used directly by tests, and several
  // api-server suites insert solve_jobs with hand-chosen ids against the same
  // nos_dev this teardown now purges. Zero instances existed at the one-time
  // purge; this guard is for the recurring case.
  const matched = fresh.userIds;
  const crossJobs = await database.execute(sql`
    SELECT j.id FROM solve_jobs j
    JOIN scenarios s ON s.id = j.scenario_id
    WHERE s.user_id IN ${matched} AND j.user_id NOT IN ${matched}
  `);
  const crossScenarios = await database.execute(sql`
    SELECT s.id FROM scenarios s
    WHERE s.user_id NOT IN ${matched}
      AND (s.result_run_id IN (SELECT id FROM solve_jobs WHERE user_id IN ${matched})
           OR s.latest_solve_job_id IN (SELECT id FROM solve_jobs WHERE user_id IN ${matched}))
  `);
  if (crossJobs.rows.length > 0 || crossScenarios.rows.length > 0) {
    throw new Error(
      `Refusing to purge: cross-ownership references would make this delete either fail or ` +
      `silently mutate a surviving row. ` +
      `solve_jobs owned by a survivor on a matched user's scenario: ` +
      `[${crossJobs.rows.map((r) => (r as { id: number }).id).join(", ")}]. ` +
      `Surviving scenarios pointing at a matched user's job: ` +
      `[${crossScenarios.rows.map((r) => (r as { id: number }).id).join(", ")}]. ` +
      `Resolve these rows by hand, then re-run.`,
    );
  }

  return database.transaction(async (tx) => {
    const jobs = await tx.delete(solveJobsTable)
      .where(inArray(solveJobsTable.userId, fresh.userIds))
      .returning({ id: solveJobsTable.id });
    const scenarios = await tx.delete(scenariosTable)
      .where(inArray(scenariosTable.userId, fresh.userIds))
      .returning({ id: scenariosTable.id });
    const users = await tx.delete(usersTable)
      .where(inArray(usersTable.id, fresh.userIds))
      .returning({ id: usersTable.id });

    return {
      userCount: users.length,
      scenarioCount: scenarios.length,
      jobCount: jobs.length,
    };
  });
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const execute = process.argv.includes("--execute");

  // `DATABASE_URL` is read here only for the message; lib/db throws at import
  // if it is unset, so this branch is about giving a human a sentence instead
  // of a stack trace. The real enforcement is inside purgeTestUsers().
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. This script needs a local/CI test database.");
    process.exit(1);
  }

  (async () => {
    assertPurgeableDatabase(process.env.DATABASE_URL);
    const counts = await countTestUsers();

    // Under-collection is otherwise invisible: a suite that starts using a new
    // email shape leaks silently while this still prints "Purged N". Report
    // anything on a test domain that the prefix list did NOT claim.
    // Built with the query builder, NOT a raw `sql` template. The first
    // version wrote `id <> ALL (${ids})` and hit the very bug documented in
    // countTestUsers() above — drizzle renders a JS array as `(($4))`, a row
    // constructor, which Postgres rejects. `notInArray` renders a real
    // `not in ($1, $2, …)`. Repeating that mistake one function away from its
    // own warning comment is why the predicate now has a test.
    const onTestDomain = or(...TEST_DOMAINS.map((d) => sql`lower(${usersTable.email}) LIKE ${`%@${d.toLowerCase()}`}`));
    const unmatched = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(
        and(
          onTestDomain,
          sql`lower(${usersTable.email}) NOT IN ${PROTECTED_EMAILS.map((e) => e.toLowerCase())}`,
          ...(counts.userIds.length > 0 ? [notInArray(usersTable.id, counts.userIds)] : []),
        ),
      );
    if (unmatched.length > 0) {
      console.warn(
        `[warn] ${unmatched.length} account(s) sit on a test domain but match no known ` +
        `prefix, so they will NOT be collected: ` +
        `${unmatched.slice(0, 5).map((r) => r.email).join(", ")}` +
        `${unmatched.length > 5 ? ", …" : ""}. ` +
        `If a suite has started using a new shape, add it to TEST_LOCAL_PREFIXES.`,
      );
    }

    if (!execute) {
      console.log(
        `[dry-run] would delete ${counts.userIds.length} test user(s), ` +
        `${counts.scenarioCount} scenario(s), ${counts.jobCount} solve job(s). ` +
        `Re-run with --execute to apply.`,
      );
      return;
    }
    const result = await purgeTestUsers();
    console.log(
      `Purged ${result.userCount} test user(s), ${result.scenarioCount} scenario(s), ` +
      `${result.jobCount} solve job(s).`,
    );
  })()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      return pool.end().finally(() => process.exit(1));
    });
}
