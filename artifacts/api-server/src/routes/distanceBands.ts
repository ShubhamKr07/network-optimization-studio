import { Router } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db, scenariosTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { validateInputsForModel } from "../validation/inputs/index.js";

const router = Router();

router.use(requireAuth);

// Chen-bands-units bundle, Part G / T9 — field-scoped update of a scenario's
// `inputs.distanceBands` only. This is deliberately NOT a general
// PATCH /scenarios/:id shortcut: it exists specifically so a bands-only edit
// (a reporting-lens change, never a model-geometric one) can be persisted
// WITHOUT a select-merge-write of the whole `inputs` blob — a read-modify-
// write would still race a concurrent update to any other input field
// (spec decision 1f, fifth-review #3).
const distanceBandsBodySchema = z.object({
  distanceBands: z.array(z.number().positive()).min(1),
});

router.patch("/scenarios/:scenarioId/distance-bands", async (req, res) => {
  const id = Number(req.params.scenarioId);

  const parsedBody = distanceBandsBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Invalid distanceBands" });
    return;
  }

  // Ownership-scoped, 404 never 403 (hard rule #5) — an ID must not leak
  // whether a scenario exists at all to a non-owning caller.
  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  // Per-model validation delegated to the existing registry/validator, so
  // each model keeps its own rules (Chen: >=1, strictly ascending, unique,
  // positive; JADE: fixed cardinality (4) + strict ascent unchanged) — same
  // single source of truth every other write path already uses. Invalid
  // (including a model-specific cardinality/order violation) -> 400, before
  // any write.
  const candidateInputs = { ...(scenario.inputs as Record<string, unknown>), distanceBands: parsedBody.data.distanceBands };
  const revalidated = validateInputsForModel(scenario.modelId, candidateInputs);
  if (!revalidated.success) {
    res.status(400).json({ error: "Invalid distanceBands for this model" });
    return;
  }

  // Atomic, field-scoped write: a single jsonb_set, never a select-merge-
  // write of the whole `inputs` object — so a concurrent update to any OTHER
  // key in `inputs` (e.g. a warehouse-status edit landing between our SELECT
  // above and this UPDATE) cannot be lost. Deliberately does NOT bump
  // inputsUpdatedAt — a bands-only change is a reporting lens, not a
  // model-geometric one, so `Scenario.stale` must not flip.
  const [row] = await db.update(scenariosTable)
    .set({
      inputs: sql`jsonb_set(${scenariosTable.inputs}, '{distanceBands}', ${JSON.stringify(parsedBody.data.distanceBands)}::jsonb)`,
      // Generic "row touched" bookkeeping, same as every other mutating
      // scenario route (routes/scenarios.ts's PATCH handler). NOT
      // inputsUpdatedAt — that field is what isStale() compares against
      // solvedAt, and a bands-only change must not flip `stale`.
      updatedAt: new Date(),
    })
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
    .returning();

  res.json(toApiScenario(row));
});

// Deliberately duplicated from scenarios.ts's own (unexported) toApiScenario
// rather than importing it — scenarios.ts is this bundle's sole-writer file
// for a DIFFERENT reason (the export/solve route logic), and importing a
// private helper across route files would couple two otherwise-independent
// routers for a five-line projector. Kept in exact sync by hand; if this
// drifts, both places already have full route-level test coverage of the
// returned Scenario shape.
function isStale(row: typeof scenariosTable.$inferSelect): boolean {
  return row.result != null && row.inputsUpdatedAt > row.solvedAt!;
}

function toApiScenario(row: typeof scenariosTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    modelId: row.modelId,
    inputs: row.inputs,
    result: row.result ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    solvedAt: row.solvedAt ? row.solvedAt.toISOString() : null,
    stale: isStale(row),
    resultRunId: row.resultRunId ?? null,
  };
}

export default router;
