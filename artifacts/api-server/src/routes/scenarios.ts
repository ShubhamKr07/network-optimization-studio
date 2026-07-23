import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, scenariosTable, solveJobsTable } from "@workspace/db";
import { enqueueSolveJob, getQueueDepth, QUEUE_DEPTH_LIMIT } from "../solver/jobRunner.js";
import type { SolveInput } from "../solver/pmedian.js";
import { requireAuth } from "../middlewares/auth.js";
import { validateInputsForModel } from "../validation/inputs/index.js";
import {
  TEMPLATE_VERSION,
  applyWarehouseOverrides,
  applyCustomerOverrides,
  warehouseRowsToCsv,
  customerRowsToCsv,
} from "../services/templates.js";
import { parseAndValidateImport } from "../services/import.js";
import type { ImportRowChange } from "../services/import.js";

const router = Router();

router.use(requireAuth);

const VALID_MODEL_IDS = new Set([
  "p-median-us",
  "transport-coal",
  "p-median-brazil",
  "max_coverage",
  "p_center",
  "set_cover",
]);

// Derived, never stored — true when inputs changed after the last solve.
// Unsolved scenarios (result === null) are never "stale"; that's a distinct
// state. `solvedAt` is always set alongside `result` by the solve route, so
// result !== null implies solvedAt !== null.
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
    stale: isStale(row),
  };
}

router.get("/scenarios", async (req, res) => {
  const modelId = req.query.modelId as string | undefined;
  const where = modelId
    ? and(eq(scenariosTable.userId, req.userId!), eq(scenariosTable.modelId, modelId))
    : eq(scenariosTable.userId, req.userId!);
  const rows = await db.select().from(scenariosTable)
    .where(where)
    .orderBy(scenariosTable.createdAt);
  res.json(rows.map(toApiScenario));
});

router.post("/scenarios", async (req, res) => {
  const body = req.body;
  if (!VALID_MODEL_IDS.has(body.modelId)) {
    res.status(422).json({ error: "modelId is required and must be a valid model" });
    return;
  }
  const validation = validateInputsForModel(body.modelId, body.inputs);
  if (!validation.success) {
    res.status(422).json({ error: validation.error });
    return;
  }
  const [row] = await db.insert(scenariosTable).values({
    name: body.name,
    userId: req.userId!,
    modelId: body.modelId,
    inputs: validation.data,
    result: null,
  }).returning();
  res.status(201).json(toApiScenario(row));
});

// Compare accepts 2-4 scenarios that (a) all belong to the caller, (b) share
// a model, and (c) are all solved and not stale. Response carries each
// scenario's opaque `inputs` plus its standardized result envelope, unchanged
// — no server-side flattening/aggregation; F2.1's frontend diff engine reads
// these generically.
router.post("/scenarios/compare", async (req, res) => {
  const ids: unknown = req.body.scenarioIds;
  if (
    !Array.isArray(ids) ||
    ids.length < 2 ||
    ids.length > 4 ||
    !ids.every((id) => Number.isInteger(id))
  ) {
    res.status(400).json({ error: "Provide 2 to 4 scenario IDs" });
    return;
  }

  const rows = await db.select().from(scenariosTable)
    .where(and(inArray(scenariosTable.id, ids), eq(scenariosTable.userId, req.userId!)));

  // Ownership/existence check first (404, never 403 — avoids ID enumeration):
  // if any requested ID doesn't resolve to a row owned by this caller, reject
  // without revealing which ones did or didn't.
  if (rows.length !== ids.length) {
    res.status(404).json({ error: "One or more scenarios not found" });
    return;
  }

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const orderedRows = ids.map((id) => rowById.get(id)!);

  const modelIds = new Set(orderedRows.map((r) => r.modelId));
  if (modelIds.size > 1) {
    res.status(422).json({
      error: `Scenarios must share the same model to compare (found: ${[...modelIds].join(", ")})`,
    });
    return;
  }

  const offendingIds = orderedRows.filter((r) => r.result == null || isStale(r)).map((r) => r.id);
  if (offendingIds.length > 0) {
    res.status(422).json({
      error: "All scenarios must be solved and not stale to compare",
      offendingIds,
    });
    return;
  }

  res.json({ scenarios: orderedRows.map(toApiScenario) });
});

router.get("/scenarios/:scenarioId", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const [row] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toApiScenario(row));
});

router.patch("/scenarios/:scenarioId", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const body = req.body;

  if ("modelId" in body) {
    res.status(422).json({ error: "modelId is fixed at creation and cannot be changed" });
    return;
  }

  const updateObj: Partial<typeof scenariosTable.$inferInsert> = {};
  if (body.name !== undefined) updateObj.name = body.name;
  if (body.inputs !== undefined) {
    const [existing] = await db.select().from(scenariosTable)
      .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    const validation = validateInputsForModel(existing.modelId, body.inputs);
    if (!validation.success) {
      res.status(422).json({ error: validation.error });
      return;
    }
    updateObj.inputs = validation.data;
    updateObj.inputsUpdatedAt = new Date();
  }
  if (body.result !== undefined) updateObj.result = body.result;

  const [row] = await db.update(scenariosTable)
    .set({ ...updateObj, updatedAt: new Date() })
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toApiScenario(row));
});

router.delete("/scenarios/:scenarioId", async (req, res) => {
  const id = Number(req.params.scenarioId);
  await db.delete(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  res.status(204).send();
});

// Fixed conservative estimate for the Retry-After header (seconds) when the
// solve queue is at capacity. Not derived from live queue depth / average
// solve time — this pilot has no measured average solve time yet (P1.1), and
// a fixed value is simple and won't under-promise if load is heavier than
// expected. 30s is roughly one solve's worth of wall-clock time for this
// dataset size; callers should treat it as a hint to back off, not a precise
// ETA.
const SOLVE_RETRY_AFTER_SECONDS = 30;

router.post("/scenarios/:scenarioId/solve", async (req, res) => {
  // Backpressure check first (before any DB work) so an overloaded server
  // sheds load as cheaply as possible — same ordering as auth.ts's login
  // rate limiter, which checks before querying the DB.
  if (getQueueDepth() >= QUEUE_DEPTH_LIMIT) {
    res.status(429)
      .set("Retry-After", String(SOLVE_RETRY_AFTER_SECONDS))
      .json({ error: "Solver is at capacity, try again shortly" });
    return;
  }

  const id = Number(req.params.scenarioId);
  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  const validation = validateInputsForModel(scenario.modelId, scenario.inputs);
  if (!validation.success) {
    res.status(422).json({ error: validation.error });
    return;
  }

  const jobId = await enqueueSolveJob(
    id,
    req.userId!,
    { modelId: scenario.modelId, inputs: validation.data } as SolveInput,
  );

  res.status(202).json({ jobId });
});

router.get("/scenarios/:scenarioId/solve-jobs/:jobId", async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const jobId = Number(req.params.jobId);

  const [job] = await db.select().from(solveJobsTable)
    .where(and(
      eq(solveJobsTable.id, jobId),
      eq(solveJobsTable.scenarioId, scenarioId),
      eq(solveJobsTable.userId, req.userId!),
    ));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }

  res.json({
    id: job.id,
    status: job.status,
    error: job.error ?? null,
    resultSummary: job.resultSummary ?? null,
    queuedAt: job.queuedAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  });
});

router.get("/scenarios/:scenarioId/export", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const entity = req.query.entity as string | undefined;
  const format = req.query.format as string | undefined;

  if (entity !== "warehouses" && entity !== "customers") {
    res.status(422).json({ error: "entity must be 'warehouses' or 'customers'" });
    return;
  }
  if (format !== "csv" && format !== "json") {
    res.status(422).json({ error: "format must be 'csv' or 'json'" });
    return;
  }

  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  // Export reads solvers/p-median-us's own warehouse/customer dataset directly
  // (via services/templates.ts) — Brazil uses a different dataset/id
  // namespace entirely and transport has no warehouse/customer overrides
  // concept at all, same boundary D1.1/D2/D3 already drew.
  if (scenario.modelId !== "p-median-us") {
    res.status(422).json({ error: "Export is only supported for p-median-us scenarios" });
    return;
  }

  const inputs = scenario.inputs as { warehouseOverrides?: unknown[]; customerOverrides?: unknown[] };
  const rows = entity === "warehouses"
    ? applyWarehouseOverrides((inputs.warehouseOverrides ?? []) as Parameters<typeof applyWarehouseOverrides>[0])
    : applyCustomerOverrides((inputs.customerOverrides ?? []) as Parameters<typeof applyCustomerOverrides>[0]);

  if (format === "csv") {
    const csv = entity === "warehouses"
      ? warehouseRowsToCsv(rows as Parameters<typeof warehouseRowsToCsv>[0])
      : customerRowsToCsv(rows as Parameters<typeof customerRowsToCsv>[0]);
    res.type("text/csv").send(csv);
    return;
  }

  res.json({ templateVersion: TEMPLATE_VERSION, entity, rows });
});

// Applies validated row changes onto a scenario's existing sparse overrides
// array — same "active/null is the no-op default, omit the entry" rule
// applied everywhere else this shape is edited (Studio's tables, D1.1's
// solve.py translation).
function mergeChangesIntoOverrides(
  entity: "warehouses" | "customers",
  currentOverrides: Array<{ id: string; status: string; capacity?: number | null; demand?: number | null }>,
  changes: ImportRowChange[],
): Array<Record<string, unknown>> {
  const valueField = entity === "warehouses" ? "capacity" : "demand";
  const rest = currentOverrides.filter(o => !changes.some(c => c.id === o.id));
  const applied = changes
    .map(c => ({ id: c.id, status: c.after.status, [valueField]: c.after.value }))
    .filter(o => !(o.status === "active" && o[valueField] == null));
  return [...rest, ...applied];
}

router.post("/scenarios/:scenarioId/import", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const { entity, csvText } = req.body as { entity?: string; csvText?: string };

  if (entity !== "warehouses" && entity !== "customers") {
    res.status(422).json({ error: "entity must be 'warehouses' or 'customers'" });
    return;
  }
  if (typeof csvText !== "string") {
    res.status(422).json({ error: "csvText is required" });
    return;
  }

  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }
  if (scenario.modelId !== "p-median-us") {
    res.status(422).json({ error: "Import is only supported for p-median-us scenarios" });
    return;
  }

  const inputs = scenario.inputs as { p: number; warehouseOverrides?: unknown[]; customerOverrides?: unknown[] };
  const preview = parseAndValidateImport(entity, csvText, inputs as Parameters<typeof parseAndValidateImport>[2], inputs.p);
  res.json(preview);
});

router.post("/scenarios/:scenarioId/import/apply", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const { entity, csvText, mode } = req.body as { entity?: string; csvText?: string; mode?: string };

  if (entity !== "warehouses" && entity !== "customers") {
    res.status(422).json({ error: "entity must be 'warehouses' or 'customers'" });
    return;
  }
  if (typeof csvText !== "string") {
    res.status(422).json({ error: "csvText is required" });
    return;
  }
  const applyMode = mode === "partial" ? "partial" : "all_or_nothing";

  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }
  if (scenario.modelId !== "p-median-us") {
    res.status(422).json({ error: "Import is only supported for p-median-us scenarios" });
    return;
  }

  // Always re-validate against the live scenario state — never trust a
  // client-held preview, which may be stale by the time apply is called.
  const inputs = scenario.inputs as { p: number; warehouseOverrides?: unknown[]; customerOverrides?: unknown[] };
  const preview = parseAndValidateImport(entity, csvText, inputs as Parameters<typeof parseAndValidateImport>[2], inputs.p);

  if (applyMode === "all_or_nothing" && preview.errors.length > 0) {
    res.status(422).json({ error: "Import has errors; nothing was applied (all-or-nothing mode)", preview });
    return;
  }

  const overrideKey = entity === "warehouses" ? "warehouseOverrides" : "customerOverrides";
  const currentOverrides = (inputs[overrideKey] ?? []) as Array<{ id: string; status: string; capacity?: number | null; demand?: number | null }>;
  const nextOverrides = mergeChangesIntoOverrides(entity, currentOverrides, preview.changes);

  const [updated] = await db.update(scenariosTable)
    .set({
      inputs: { ...inputs, [overrideKey]: nextOverrides },
      inputsUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
    .returning();

  res.json({ scenario: toApiScenario(updated), applied: preview.changes.length, errors: preview.errors });
});

router.post("/scenarios/:scenarioId/reset-to-baseline", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }
  if (scenario.modelId !== "p-median-us") {
    res.status(422).json({ error: "Reset to baseline is only supported for p-median-us scenarios" });
    return;
  }

  const inputs = scenario.inputs as Record<string, unknown>;
  const [updated] = await db.update(scenariosTable)
    .set({
      inputs: { ...inputs, warehouseOverrides: [], customerOverrides: [] },
      inputsUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
    .returning();

  res.json(toApiScenario(updated));
});

router.post("/scenarios/:scenarioId/clone", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  const [clone] = await db.insert(scenariosTable).values({
    name: `${scenario.name} (copy)`,
    userId: req.userId!,
    modelId: scenario.modelId,
    inputs: scenario.inputs,
    result: null,
  }).returning();

  res.status(201).json(toApiScenario(clone));
});

export default router;
