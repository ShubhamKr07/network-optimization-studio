import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, scenariosTable, solveJobsTable, resultCacheTable } from "@workspace/db";

// Ch4 dataset migration (MIG-16), Task 2 -- the production deletion script.
// Written and tested here; NOT executed by this task. Running it against
// production student data is a separate, human-gated operation described
// in docs/ops/ch4-migration-runbook.md's Stage C.
//
// The old Chapter 4 model (`chens-cosmetics-cn`) is being replaced wholesale
// by a renamed model on a different dataset (`max-coverage-us`). Existing
// chens-cosmetics-cn scenarios cannot survive that rename -- their `inputs`
// and cached `result` reference China entity ids the new dataset doesn't
// have -- so this script deletes every trace of them: their solve_jobs,
// the scenarios themselves, and any result_cache rows keyed to this model
// (result_cache is NOT an FK child of scenarios -- pk is inputs_hash, plus
// a plain model_id column -- so those rows would otherwise strand China
// payloads forever).
export const CHENS_MODEL_ID = "chens-cosmetics-cn";

type Db = typeof db;

export interface AffectedCounts {
  scenarioCount: number;
  jobCount: number;
  scenarioIds: number[];
}

// Finding #1 (T2), encoded here rather than left as prose: solve_jobs.model_id
// is an A1 "Class 1" column -- added NULLABLE, never backfilled, so it is
// NULL on every pre-A1 row. Filtering jobs on
// `solve_jobs.model_id = 'chens-cosmetics-cn'` would silently exclude
// exactly the OLDEST chens jobs (the ones most likely to still exist and
// most in need of cleanup). Scope jobs through the parent scenario instead --
// a plain join against scenarios.model_id, which has been NOT NULL since
// D0.2 and is the true source of truth for "which model does this job
// belong to."
export async function countAffected(database: Db = db): Promise<AffectedCounts> {
  const scenarioRows = await database
    .select({ id: scenariosTable.id })
    .from(scenariosTable)
    .where(eq(scenariosTable.modelId, CHENS_MODEL_ID));
  const scenarioIds = scenarioRows.map((r) => r.id);

  // Parent-scenario join -- never solve_jobs.model_id (see the header
  // comment above: that column is nullable pre-A1 and would silently miss
  // the oldest jobs).
  const jobRows = await database
    .select({ id: solveJobsTable.id })
    .from(solveJobsTable)
    .innerJoin(scenariosTable, eq(scenariosTable.id, solveJobsTable.scenarioId))
    .where(eq(scenariosTable.modelId, CHENS_MODEL_ID));

  return {
    scenarioCount: scenarioIds.length,
    jobCount: jobRows.length,
    scenarioIds,
  };
}

export interface Chapter4DeletionConfirmation {
  confirmedCount: number;
}

export interface Chapter4DeletionResult {
  scenarioCount: number;
  jobCount: number;
  resultCacheCount: number;
}

// Refuses to run unless `confirmation.confirmedCount` matches a FRESH
// countAffected() taken inside this same call -- a stale/eyeballed number
// can't authorize a delete against a population that has since changed
// (e.g. a new scenario created between when a human read a count on a
// terminal and when this actually ran).
//
// Deletes solve_jobs (joined through scenarios), then scenarios, then
// result_cache -- all in one transaction, matching routes/scenarios.ts's
// existing child-before-parent delete ordering. Never writes a job
// `status` -- cancelJob()/cancelAllActiveJobs() have no place in this
// script; by the time this runs, the runbook's Stage B has already driven
// every affected job to a terminal status by keeping workers running and
// polling, not by force-writing one here.
export async function deleteChapter4Data(
  database: Db = db,
  confirmation: Chapter4DeletionConfirmation,
): Promise<Chapter4DeletionResult> {
  const fresh = await countAffected(database);
  if (confirmation.confirmedCount !== fresh.scenarioCount) {
    throw new Error(
      `Refusing to delete: confirmedCount (${confirmation.confirmedCount}) does not match ` +
      `a fresh countAffected() scenarioCount (${fresh.scenarioCount}). Re-run countAffected ` +
      `and re-confirm before retrying.`,
    );
  }

  // NOTE: result_cache is NOT scoped by scenarioIds -- it is keyed by
  // model_id alone (see the header comment). It must be purged even when
  // fresh.scenarioIds is EMPTY (e.g. a student already deleted their own
  // chens-cosmetics-cn scenarios via the ordinary scenario-delete route,
  // which never touches result_cache -- see routes/scenarios.ts). So the
  // two scenario-scoped deletes are guarded on scenarioIds.length, but the
  // result_cache delete and the surrounding transaction are NOT -- an
  // earlier version of this function returned before the transaction in
  // the empty-scenarios case, which stranded orphaned result_cache rows
  // forever. Guarding the scenario-scoped deletes here is a defensive
  // choice, not a requirement of this drizzle version: verified empirically
  // (2026-09-28, drizzle-orm@0.45.2) that `inArray(column, [])` compiles to
  // a literal `WHERE false`, not invalid SQL -- so this guard exists for
  // readability/clarity, not to avoid a query error.
  return database.transaction(async (tx) => {
    let deletedJobsCount = 0;
    let deletedScenariosCount = 0;

    if (fresh.scenarioIds.length > 0) {
      const deletedJobs = await tx
        .delete(solveJobsTable)
        .where(inArray(solveJobsTable.scenarioId, fresh.scenarioIds))
        .returning({ id: solveJobsTable.id });
      deletedJobsCount = deletedJobs.length;

      const deletedScenarios = await tx
        .delete(scenariosTable)
        .where(and(eq(scenariosTable.modelId, CHENS_MODEL_ID), inArray(scenariosTable.id, fresh.scenarioIds)))
        .returning({ id: scenariosTable.id });
      deletedScenariosCount = deletedScenarios.length;
    }

    // Always runs, regardless of scenarioIds -- scoped by model_id alone,
    // independent of which (if any) scenarios still exist.
    const deletedResultCache = await tx
      .delete(resultCacheTable)
      .where(eq(resultCacheTable.modelId, CHENS_MODEL_ID))
      .returning({ inputsHash: resultCacheTable.inputsHash });

    return {
      scenarioCount: deletedScenariosCount,
      jobCount: deletedJobsCount,
      resultCacheCount: deletedResultCache.length,
    };
  });
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  console.error(
    "This script has no CLI entrypoint -- it is invoked from an operator " +
    "runbook step that supplies an explicit, freshly-confirmed count. See " +
    "docs/ops/ch4-migration-runbook.md Stage C. Refusing to run bare.",
  );
  pool.end().finally(() => process.exit(1));
}
