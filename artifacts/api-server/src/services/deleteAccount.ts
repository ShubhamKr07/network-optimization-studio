import { and, asc, eq, inArray } from "drizzle-orm";
import { db, scenariosTable, solveJobsTable, usersTable } from "@workspace/db";

export type DeleteAccountOutcome = "deleted" | "busy";

/**
 * WQF-B5 — deletes ONE user's own rows. Every statement is scoped by `userId`;
 * there is no unscoped mode (root CLAUDE.md: a destructive helper must not be
 * able to run wide from a test). Order is forced by FKs without cascade:
 * solve_jobs.{user_id,scenario_id} and scenarios.user_id (schema/solve_jobs.ts:34-35,
 * schema/scenarios.ts:8). scenarios.{result_run_id,latest_solve_job_id} are
 * ON DELETE SET NULL, so deleting solve_jobs first is safe. watbot_* rows go
 * by ON DELETE CASCADE from users. result_cache and feedback carry no user
 * link and are never touched.
 *
 * Lock order is enqueueScenarioSolve's (jobRunner.ts: the scenario row FOR
 * UPDATE, then the users row FOR NO KEY UPDATE): this user's scenario rows
 * first, by id, then the users row FOR UPDATE. Taking the same locks in the
 * same order makes a concurrent enqueue on any of those scenarios queue instead
 * of deadlock: if the enqueue holds the scenario lock first, its job commits
 * and the active-job check below answers "busy"; if this transaction holds it
 * first, the enqueue's SELECT ... FOR UPDATE finds no row once this commits
 * and answers not_found. While the users row is locked, no new scenario or
 * solve job can be inserted for this user (their FKs take FOR KEY SHARE on it).
 * Any database error rolls the whole transaction back, and the route answers
 * "Nothing was deleted" (plan D9). If a concurrent delete of the same account
 * committed first, every statement here matches nothing: the account is gone
 * either way, so there is no separate outcome for it.
 */
export async function deleteAccountData(userId: string): Promise<DeleteAccountOutcome> {
  return db.transaction(async (tx) => {
    await tx.select({ id: scenariosTable.id }).from(scenariosTable)
      .where(eq(scenariosTable.userId, userId)).orderBy(asc(scenariosTable.id)).for("update");
    await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.id, userId)).for("update");

    const [active] = await tx.select({ id: solveJobsTable.id }).from(solveJobsTable)
      .where(and(eq(solveJobsTable.userId, userId), inArray(solveJobsTable.status, ["queued", "running"])))
      .limit(1);
    if (active) return "busy" as const;

    await tx.delete(solveJobsTable).where(eq(solveJobsTable.userId, userId));
    await tx.delete(scenariosTable).where(eq(scenariosTable.userId, userId));
    await tx.delete(usersTable).where(eq(usersTable.id, userId));
    return "deleted" as const;
  });
}
