import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, solveJobsTable, scenariosTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { getManifest } from "../registry/modelRegistry.js";
import { derivePublicFailure } from "../solver/jobRunner.js";
import { StoredScenarioResultSchema, normalizeStoredResult } from "../solver/resultEnvelope.js";

const router = Router();

router.use(requireAuth);

// A8 (SCND Correctness, §2.7.1) — "resultSummary gains a typed
// legacyUnverified marker; legacy summaries read as-is, tagged unverified,
// never promoted to proven." A non-succeeded row has no result at all, so
// there is nothing to (un)verify — false. A succeeded row is verified ONLY
// if its full stored envelope parses as a genuine v2 published result
// (envelopeVersion:2, per resultEnvelope.ts's normalizeStoredResult — the
// SAME discriminator routes/scenarios.ts's export gate uses); anything else
// — historical-unversioned, B's truthful-but-unversioned, missing, or
// malformed — is conservatively legacyUnverified:true.
function deriveLegacyUnverified(status: string, result: Record<string, unknown> | null | undefined): boolean {
  if (status !== "succeeded") return false;
  const parsed = StoredScenarioResultSchema.safeParse(result ?? null);
  if (!parsed.success) return true;
  return normalizeStoredResult(parsed.data).legacyUnverified;
}

// Bundle 5 — one row per scenario: the newest solve job (any status) per
// scenario, newest-first, limited. The dedupe runs in SQL (DISTINCT ON) — the
// DB does the dedupe and the RESPONSE to Node is bounded to `limit` rows
// (never fetch-all-then-dedupe in the app). Note: Postgres still filters+sorts
// the user's jobs under the `user_id` index; that scan is O(user's jobs), which
// is fine at pilot scale. Add a composite index only if a real EXPLAIN shows
// pain — no schema change here.
router.get("/solve-history", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 50);

  // Inner: DISTINCT ON (scenario_id) keeps the first row per scenario under the
  // ORDER BY, so scenario_id must lead the ordering; queued_at DESC then id DESC
  // (stable tiebreaker for equal timestamps) picks that scenario's newest job.
  const latest = db
    .selectDistinctOn([solveJobsTable.scenarioId], {
      id: solveJobsTable.id,
      scenarioId: solveJobsTable.scenarioId,
      status: solveJobsTable.status,
      resultSummary: solveJobsTable.resultSummary,
      // A8 (§2.7.1) — the FULL stored result envelope, needed to derive
      // legacyUnverified below. resultSummary (above) is a small hand-picked
      // projection (jobRunner.ts's markSucceeded) that never carries
      // envelopeVersion, so it alone can't answer "is this a v2 published
      // result" — only the full envelope can.
      result: solveJobsTable.result,
      queuedAt: solveJobsTable.queuedAt,
      finishedAt: solveJobsTable.finishedAt,
      scenarioName: scenariosTable.name,
      modelId: scenariosTable.modelId,
      // A5 — typed-only inputs to derivePublicFailure() below. The raw
      // `error`/`errorDetail` columns are deliberately NOT selected here —
      // they must never reach this route at all, let alone the response.
      errorCode: solveJobsTable.errorCode,
      failureReason: solveJobsTable.failureReason,
      failureStage: solveJobsTable.failureStage,
    })
    .from(solveJobsTable)
    .innerJoin(scenariosTable, eq(solveJobsTable.scenarioId, scenariosTable.id))
    .where(eq(solveJobsTable.userId, req.userId!))
    .orderBy(solveJobsTable.scenarioId, desc(solveJobsTable.queuedAt), desc(solveJobsTable.id))
    .as("latest");

  const rows = await db
    .select()
    .from(latest)
    .orderBy(desc(latest.queuedAt), desc(latest.id))
    .limit(limit);

  res.json(rows.map((r) => {
    const summary = r.resultSummary as {
      objective?: number;
      objectiveMode?: string | null;
      weightedAvgDistance?: number;
      weightedAvgDistanceMi?: number;
      distanceUnit?: string;
      runTimeSec?: number;
    } | null;
    // D21/C4.10 — unit-carrying shape. distanceUnit is NEVER null:
    //  - a new solve writes it from the model manifest (jobRunner markSucceeded);
    //  - a LEGACY successful summary (has only weightedAvgDistanceMi, no
    //    distanceUnit) falls back to the literal "mi" — those rows were all
    //    mile-model solves, so "mi" is correct for them specifically;
    //  - any other case (a failed/absent summary — status != succeeded) derives
    //    the unit from the model's manifest, so a failed job still reports its
    //    own model's unit rather than a misleading "mi".
    const modelUnit = getManifest(r.modelId)?.distanceUnit ?? "mi";
    const distanceUnit =
      summary?.distanceUnit ??
      (summary != null && r.status === "succeeded" ? "mi" : modelUnit);
    // A5 — same permanent public failure shape as the job-poll endpoint
    // (routes/scenarios.ts), derived ONLY from typed columns. The raw
    // `error`/`errorDetail` columns were never selected into `r` at all
    // (see the inner query above), so there is nothing raw to leak here.
    const failure = derivePublicFailure({
      status: r.status,
      errorCode: r.errorCode,
      failureReason: r.failureReason,
      failureStage: r.failureStage,
    });
    return {
      id: r.id,
      scenarioId: r.scenarioId,
      scenarioName: r.scenarioName,
      modelId: r.modelId,
      status: r.status,
      objective: summary?.objective ?? null,
      objectiveMode: summary?.objectiveMode ?? null,
      weightedAvgDistance: summary?.weightedAvgDistance ?? summary?.weightedAvgDistanceMi ?? null,
      distanceUnit,
      errorCode: failure?.errorCode ?? null,
      errorMessage: failure?.errorMessage ?? null,
      runTimeSec: summary?.runTimeSec ?? null,
      legacyUnverified: deriveLegacyUnverified(r.status, r.result as Record<string, unknown> | null | undefined),
      queuedAt: r.queuedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    };
  }));
});

export default router;
