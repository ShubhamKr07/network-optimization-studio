import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, scenariosTable } from "@workspace/db";
import { solve } from "../solver/pmedian.js";
import type { SolveInput } from "../solver/pmedian.js";
import { WAREHOUSES } from "../data/dataset.js";

const router = Router();

function toApiScenario(row: typeof scenariosTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    problemType: row.problemType,
    pValue: row.pValue,
    distanceBands: row.distanceBands as number[],
    solver: row.solver,
    gap: row.gap,
    timeLimitSec: row.timeLimitSec,
    capacityMode: row.capacityMode,
    uniformCapacity: row.uniformCapacity ?? null,
    warehouseStatuses: row.warehouseStatuses as Array<{ warehouseId: string; status: string }>,
    capacityFactor: row.capacityFactor ?? 1.0,
    singleSource: row.singleSource ?? false,
    capacityInactive: row.capacityInactive ?? false,
    result: row.result ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/scenarios", async (_req, res) => {
  const rows = await db.select().from(scenariosTable).orderBy(scenariosTable.createdAt);
  res.json(rows.map(toApiScenario));
});

router.post("/scenarios", async (req, res) => {
  const body = req.body;
  const [row] = await db.insert(scenariosTable).values({
    name: body.name,
    problemType: body.problemType ?? "p_median",
    pValue: body.pValue ?? 3,
    distanceBands: body.distanceBands ?? [200, 400, 800, 1600],
    solver: body.solver ?? "cbc",
    gap: body.gap ?? 0,
    timeLimitSec: body.timeLimitSec ?? 120,
    capacityMode: body.capacityMode ?? "uniform",
    uniformCapacity: body.uniformCapacity ?? null,
    warehouseStatuses: body.warehouseStatuses ?? [],
    capacityFactor: body.capacityFactor ?? 1.0,
    singleSource: body.singleSource ?? false,
    capacityInactive: body.capacityInactive ?? false,
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
    const [r] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, id));
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
  const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toApiScenario(row));
});

router.patch("/scenarios/:scenarioId", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const body = req.body;

  const fields: Partial<Record<string, unknown>> = { updated_at: new Date() };
  if (body.name !== undefined) fields.name = body.name;
  if (body.problemType !== undefined) fields.problem_type = body.problemType;
  if (body.pValue !== undefined) fields.p_value = body.pValue;
  if (body.distanceBands !== undefined) fields.distance_bands = body.distanceBands;
  if (body.solver !== undefined) fields.solver = body.solver;
  if (body.gap !== undefined) fields.gap = body.gap;
  if (body.timeLimitSec !== undefined) fields.time_limit_sec = body.timeLimitSec;
  if (body.capacityMode !== undefined) fields.capacity_mode = body.capacityMode;
  if ("uniformCapacity" in body) fields.uniform_capacity = body.uniformCapacity;
  if (body.warehouseStatuses !== undefined) fields.warehouse_statuses = body.warehouseStatuses;
  if (body.result !== undefined) fields.result = body.result;

  const updateObj: Partial<typeof scenariosTable.$inferInsert> = {};
  if (body.name !== undefined) updateObj.name = body.name;
  if (body.problemType !== undefined) updateObj.problemType = body.problemType;
  if (body.pValue !== undefined) updateObj.pValue = body.pValue;
  if (body.distanceBands !== undefined) updateObj.distanceBands = body.distanceBands;
  if (body.solver !== undefined) updateObj.solver = body.solver;
  if (body.gap !== undefined) updateObj.gap = body.gap;
  if (body.timeLimitSec !== undefined) updateObj.timeLimitSec = body.timeLimitSec;
  if (body.capacityMode !== undefined) updateObj.capacityMode = body.capacityMode;
  if ("uniformCapacity" in body) updateObj.uniformCapacity = body.uniformCapacity;
  if (body.warehouseStatuses !== undefined) updateObj.warehouseStatuses = body.warehouseStatuses;
  if (body.capacityFactor !== undefined) updateObj.capacityFactor = body.capacityFactor;
  if (body.singleSource !== undefined) updateObj.singleSource = body.singleSource;
  if (body.capacityInactive !== undefined) updateObj.capacityInactive = body.capacityInactive;
  if (body.result !== undefined) updateObj.result = body.result;

  const [row] = await db.update(scenariosTable)
    .set({ ...updateObj, updatedAt: new Date() })
    .where(eq(scenariosTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(toApiScenario(row));
});

router.delete("/scenarios/:scenarioId", async (req, res) => {
  const id = Number(req.params.scenarioId);
  await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  res.status(204).send();
});

router.post("/scenarios/:scenarioId/solve", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const [scenario] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, id));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  const input: SolveInput = {
    pValue: scenario.pValue,
    distanceBands: scenario.distanceBands as number[],
    capacityMode: (scenario.capacityMode as "uniform" | "per_wh"),
    uniformCapacity: scenario.uniformCapacity ?? null,
    warehouseStatuses: scenario.warehouseStatuses as Array<{ warehouseId: string; status: string }>,
    gap: scenario.gap ?? 0,
    timeLimitSec: scenario.timeLimitSec ?? 120,
    solver: scenario.solver,
    modelType: scenario.problemType as "p_median" | "transport",
    capacityFactor: scenario.capacityFactor ?? 1.0,
    singleSource: scenario.singleSource ?? false,
    capacityInactive: scenario.capacityInactive ?? false,
  };

  const result = solve(input);

  const [updated] = await db.update(scenariosTable)
    .set({ result: result as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(scenariosTable.id, id))
    .returning();

  res.json(toApiScenario(updated));
});

router.post("/scenarios/:scenarioId/clone", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const [scenario] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, id));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  const [clone] = await db.insert(scenariosTable).values({
    name: `${scenario.name} (copy)`,
    problemType: scenario.problemType,
    pValue: scenario.pValue,
    distanceBands: scenario.distanceBands as number[],
    solver: scenario.solver,
    gap: scenario.gap,
    timeLimitSec: scenario.timeLimitSec,
    capacityMode: scenario.capacityMode,
    uniformCapacity: scenario.uniformCapacity,
    warehouseStatuses: scenario.warehouseStatuses as Array<{ warehouseId: string; status: string }>,
    capacityFactor: scenario.capacityFactor ?? 1.0,
    singleSource: scenario.singleSource ?? false,
    capacityInactive: scenario.capacityInactive ?? false,
    result: null,
  }).returning();

  res.status(201).json(toApiScenario(clone));
});

export default router;
