import { Router } from "express";
import { and, eq, max, count, countDistinct } from "drizzle-orm";
import { db, scenariosTable, solveJobsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.use(requireAuth);

// Bundle 4 — per-chapter + total scenario/solve counts for the Landing page.
// Two grouped queries, no per-chapter loop. Both tenant columns are filtered
// on the solve query (solve_jobs.user_id AND scenarios.user_id are independent
// columns; filtering only the former would let a malformed A-owned job that
// points at a B-owned scenario leak B's data into A's summary).
router.get("/landing-summary", async (req, res) => {
  const userId = req.userId!;

  const scenarioRows = await db
    .select({ modelId: scenariosTable.modelId, scenarioCount: count() })
    .from(scenariosTable)
    .where(eq(scenariosTable.userId, userId))
    .groupBy(scenariosTable.modelId);

  const solveRows = await db
    .select({
      modelId: scenariosTable.modelId,
      lastSucceededSolveAt: max(solveJobsTable.finishedAt),
      solvedScenarios: countDistinct(solveJobsTable.scenarioId),
    })
    .from(solveJobsTable)
    .innerJoin(scenariosTable, eq(solveJobsTable.scenarioId, scenariosTable.id))
    .where(and(
      eq(solveJobsTable.userId, userId),
      eq(scenariosTable.userId, userId),
      eq(solveJobsTable.status, "succeeded"),
    ))
    .groupBy(scenariosTable.modelId);

  const solveByModel = new Map(solveRows.map((r) => [r.modelId, r]));

  const perChapter = scenarioRows.map((r) => {
    const s = solveByModel.get(r.modelId);
    return {
      modelId: r.modelId,
      scenarioCount: Number(r.scenarioCount),
      // max() over a timestamp column is typed `Date | null`; serialize it
      // directly — the TS `Date` constructor's types reject another `Date`.
      lastSucceededSolveAt: s?.lastSucceededSolveAt?.toISOString() ?? null,
    };
  });

  const totals = {
    scenarios: scenarioRows.reduce((a, r) => a + Number(r.scenarioCount), 0),
    solvedScenarios: solveRows.reduce((a, r) => a + Number(r.solvedScenarios ?? 0), 0),
  };

  res.json({ perChapter, totals });
});

export default router;
