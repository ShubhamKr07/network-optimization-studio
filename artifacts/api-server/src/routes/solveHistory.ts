import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, solveJobsTable, scenariosTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.use(requireAuth);

// Phase 3.5 (G3.2) — no new table needed; solve_jobs already carries
// everything a "recent solves" list needs, joined to the scenario's name.
router.get("/solve-history", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 50);

  const rows = await db.select({
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
    .orderBy(desc(solveJobsTable.queuedAt))
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
