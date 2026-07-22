import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, scenariosTable } from "@workspace/db";
import { solve } from "../solver/pmedian.js";
import type { SolveInput } from "../solver/pmedian.js";
import { WAREHOUSES } from "../data/dataset.js";
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

function toApiScenario(row: typeof scenariosTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    modelId: row.modelId,
    inputs: row.inputs,
    result: row.result ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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

router.post("/scenarios/compare", async (req, res) => {
  const ids: number[] = req.body.scenarioIds ?? [];
  if (!Array.isArray(ids) || ids.length < 2) {
    res.status(400).json({ error: "Provide at least 2 scenario IDs" });
    return;
  }
  const allRows: Array<typeof scenariosTable.$inferSelect> = [];
  for (const id of ids) {
    const [r] = await db.select().from(scenariosTable)
      .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
    if (r) allRows.push(r);
  }
  const scenarios = allRows.map(row => {
    const result = row.result as Record<string, unknown> | null;
    const util = (result?.utilization as Array<{ utilization: number }> | undefined) ?? [];
    const avgUtil = util.length ? Math.round(util.reduce((s, u) => s + u.utilization, 0) / util.length) : 0;
    const openIds = (result?.openWarehouseIds as string[]) ?? [];
    const openSites = openIds.map((id: string) => {
      const wh = WAREHOUSES.find(w => w.id === id);
      return wh ? wh.city : id;
    });
    return {
      scenarioId: row.id,
      name: row.name,
      openSites,
      weightedAvgDistanceMi: (result?.weightedAvgDistanceMi as number) ?? 0,
      objective: (result?.objective as number) ?? 0,
      bandDemandPercent: (result?.bandCoverage as Array<{ band: number; percent: number }>) ?? [],
      avgUtilization: avgUtil,
      solverStatus: result ? (result.status as string) : "unsolved",
    };
  });
  res.json({ scenarios });
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

router.post("/scenarios/:scenarioId/solve", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  const validation = validateInputsForModel(scenario.modelId, scenario.inputs);
  if (!validation.success) {
    res.status(422).json({ error: validation.error });
    return;
  }

  const result = solve({ modelId: scenario.modelId, inputs: validation.data } as SolveInput);

  const [updated] = await db.update(scenariosTable)
    .set({ result: result as unknown as Record<string, unknown>, solvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
    .returning();

  res.json(toApiScenario(updated));
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
