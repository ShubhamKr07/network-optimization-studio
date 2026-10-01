import { fileURLToPath } from "node:url";
import { and, inArray, like, notInArray, or } from "drizzle-orm";
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
  // Composed with or()/like() rather than `LIKE ANY (<array>)`. Drizzle
  // renders a JS array into SQL as a parenthesised parameter list — a ROW
  // constructor, `($1, $2, …)` — which Postgres rejects for `LIKE ANY`, since
  // that wants a genuine array. Caught by running this script, not by
  // typecheck: the types are identical either way. Verified with
  // drizzle-orm@0.45.2.
  const matchesPrefix = or(...TEST_LOCAL_PREFIXES.map((p) => like(usersTable.email, `${p}%`)));
  const matchesDomain = or(...TEST_DOMAINS.map((d) => like(usersTable.email, `%@${d}`)));

  const rows = await database
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(matchesPrefix, matchesDomain, notInArray(usersTable.email, PROTECTED_EMAILS)));
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

  // Production guard. This script is safe by predicate, but a connection
  // string pointing at a hosted database is never what an unattended teardown
  // should be touching — refuse rather than rely on the predicate alone.
  const url = process.env.DATABASE_URL ?? "";
  const looksHosted = /render\.com|amazonaws\.com|neon\.tech|supabase\.co/i.test(url);
  if (looksHosted) {
    console.error(
      "Refusing to run: DATABASE_URL points at a hosted database. This script is " +
      "for local/CI test databases. Purging a hosted database is a separate, " +
      "human-approved operation.",
    );
    pool.end().finally(() => process.exit(1));
  } else {
    countTestUsers()
      .then(async (counts) => {
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
      })
      .then(() => pool.end())
      .catch((err) => {
        console.error(err);
        return pool.end().finally(() => process.exit(1));
      });
  }
}
