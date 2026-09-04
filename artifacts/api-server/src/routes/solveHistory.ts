import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, solveJobsTable, scenariosTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.use(requireAuth);

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
      queuedAt: solveJobsTable.queuedAt,
      finishedAt: solveJobsTable.finishedAt,
      scenarioName: scenariosTable.name,
      modelId: scenariosTable.modelId,
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
    const summary = r.resultSummary as { objective?: number; weightedAvgDistanceMi?: number; runTimeSec?: number } | null;
    return {
      id: r.id,
      scenarioId: r.scenarioId,
      scenarioName: r.scenarioName,
      modelId: r.modelId,
      status: r.status,
      objective: summary?.objective ?? null,
      weightedAvgDistanceMi: summary?.weightedAvgDistanceMi ?? null,
      runTimeSec: summary?.runTimeSec ?? null,
      queuedAt: r.queuedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    };
  }));
});

export default router;
