import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, scenariosTable, solveJobsTable } from "@workspace/db";
import { posthog } from "../lib/posthog.js";
import { enqueueSolveJob, getQueueDepth, QUEUE_DEPTH_LIMIT } from "../solver/jobRunner.js";
import type { SolveInput } from "../solver/pmedian.js";
import { requireAuth } from "../middlewares/auth.js";
import { ResultEnvelopeSchema } from "../solver/resultEnvelope.js";
import { validateInputsForModel } from "../validation/inputs/index.js";
import { getManifest } from "../registry/modelRegistry.js";
import {
  TEMPLATE_VERSION,
  applyWarehouseOverrides,
  applyCustomerOverrides,
  applyMineOverrides,
  applyStationOverrides,
  applyRefineryOverrides,
  applyGoldCustomerOverrides,
  applyDistanceOverrides,
  applyLaneCostOverrides,
  buildDistanceStubRows,
  buildLaneCostStubRows,
  buildLegDistanceStubRows,
  buildAssignmentRows,
  buildOpenWarehouseRows,
  buildCostSummaryRows,
  buildServiceStatsRows,
  buildFlowRows,
  flowRowsToCsv,
  warehouseRowsToCsv,
  customerRowsToCsv,
  mineRowsToCsv,
  stationRowsToCsv,
  refineryRowsToCsv,
  distanceRowsToCsv,
  laneCostRowsToCsv,
  assignmentRowsToCsv,
  openWarehouseRowsToCsv,
  costSummaryRowsToCsv,
  serviceStatsRowsToCsv,
} from "../services/templates.js";
import type { AssignmentTemplateRow, OpenWarehouseTemplateRow, CostSummaryTemplateRow, ServiceStatsTemplateRow, FlowTemplateRow } from "../services/templates.js";
import { parseAndValidateImport } from "../services/import.js";
import type { ImportEntity, ImportRowChange } from "../services/import.js";
import { precheckPMedianInputs, precheckTransportInputs, precheckTwoEchelonInputs, BRAZIL_DATASET } from "../services/precheck.js";
import type { PrecheckResult } from "../services/precheck.js";
import { fillEstimatedDistances, fillEstimatedLaneCosts, fillEstimatedTwoEchelonDistances } from "../services/autoDistance.js";
import type { PMedianInputs } from "../validation/inputs/pMedian.js";
import type { TransportLpInputs } from "../validation/inputs/transportLp.js";
import type { TwoEchelonInputs } from "../validation/inputs/twoEchelon.js";

const router = Router();

router.use(requireAuth);

export const VALID_MODEL_IDS = new Set([
  "p-median-us",
  "transport-coal",
  "p-median-brazil",
  "two-echelon-gold-au",
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
    inputs: normalizeAddedEntityDistances(body.modelId, validation.data),
    result: null,
  }).returning();

  posthog?.capture({
    distinctId: req.userId!,
    event: "scenario created",
    properties: {
      scenario_id: row.id,
      model_id: row.modelId,
      scenario_name: row.name,
    },
  });

  res.status(201).json(toApiScenario(row));
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
    updateObj.inputs = normalizeAddedEntityDistances(existing.modelId, validation.data);
    updateObj.inputsUpdatedAt = new Date();
  }
  if (body.result !== undefined) updateObj.result = body.result;

  const [row] = await db.update(scenariosTable)
    .set({ ...updateObj, updatedAt: new Date() })
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  posthog?.capture({
    distinctId: req.userId!,
    event: "scenario updated",
    properties: {
      scenario_id: row.id,
      model_id: row.modelId,
      updated_fields: Object.keys(updateObj),
    },
  });

  res.json(toApiScenario(row));
});

router.delete("/scenarios/:scenarioId", async (req, res) => {
  const id = Number(req.params.scenarioId);
  // A solved scenario owns solve_jobs rows whose scenario_id FK points at it
  // (no ON DELETE CASCADE). Deleting the scenario first trips that FK
  // constraint and surfaces as a 500 to the caller. Fix: delete the child
  // solve_jobs rows FIRST — scoped by both scenarioId AND userId so a row
  // owned by a different user is never touched — then delete the scenario,
  // all inside one transaction so a mid-way failure leaves no orphans.
  //
  // .returning() yields the deleted scenario row (or none). The
  // userId-scoped WHERE on the scenario delete means a row owned by a
  // different user — or a nonexistent id — both return nothing, and both
  // must 404 (never 204 or 403, to avoid ID enumeration side-channels —
  // same ownership-filtering rule GET/PATCH use).
  const [row] = await db.transaction(async (tx) => {
    await tx.delete(solveJobsTable)
      .where(and(eq(solveJobsTable.scenarioId, id), eq(solveJobsTable.userId, req.userId!)));
    return tx.delete(scenariosTable)
      .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
      .returning();
  });
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  posthog?.capture({
    distinctId: req.userId!,
    event: "scenario deleted",
    properties: {
      scenario_id: row.id,
      model_id: row.modelId,
    },
  });

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

// SCN v0.3 Phase B, task B2.1 — semantic precheck of a scenario's
// network-edit fields (addedWarehouses/addedCustomers/distanceOverrides,
// B1.1), beyond what Zod's shape validation (validateInputsForModel) can
// express: completeness, ID collision, reference integrity.
//
// B6.3: p-median-brazil fast-follows p-median-us here — it shares the exact
// same PMedianInputs shape/schema (pMedianInputsSchema), so no new checking
// logic is needed, only a different base `dataset` argument
// (precheck.ts's BRAZIL_DATASET instead of the implicit p-median-us
// default). B6.1: transport-coal gets its OWN check function
// (precheckTransportInputs) — its TransportLpInputs shape has no
// warehouseOverrides/customerOverrides status arrays at all, so it isn't a
// drop-in call to precheckPMedianInputs. B6.2: two-echelon-gold-au gets its
// OWN check function too (precheckTwoEchelonInputs) — a THIRD entity type
// (mine/refinery/customer) and two legs sharing one distanceOverrides array,
// structurally different from both the above. `inputs` here is always
// already-validated (validateInputsForModel's `.data`), so the casts are
// safe exactly where they're used, same pattern as this file's existing
// `as SolveInput` cast below.
// T1 (Input Map v2) / follow-up item 3 — auto-estimate normalizer, run on
// every persist path (POST create, PATCH, import/apply, below) right before
// the already-validated inputs are written to the DB row. Covers
// p-median-us, transport-coal, and two-echelon-gold-au — NOT
// p-median-brazil, which shares p-median-us's schema but a different base
// dataset/geography this normalizer hasn't been threaded through yet (same
// boundary D1.1/D2/D3 drew: no warehouse/customer table UI, no map wiring,
// for that model). Every other modelId falls through unchanged.
function normalizeAddedEntityDistances(modelId: string, data: Record<string, unknown>): Record<string, unknown> {
  if (modelId === "p-median-us") {
    return fillEstimatedDistances(data as unknown as PMedianInputs) as unknown as Record<string, unknown>;
  }
  if (modelId === "transport-coal") {
    return fillEstimatedLaneCosts(data as unknown as TransportLpInputs) as unknown as Record<string, unknown>;
  }
  if (modelId === "two-echelon-gold-au") {
    return fillEstimatedTwoEchelonDistances(data as unknown as TwoEchelonInputs) as unknown as Record<string, unknown>;
  }
  return data;
}

function runNetworkEditsPrecheck(modelId: string, inputs: Record<string, unknown>): PrecheckResult {
  if (modelId === "p-median-us") {
    return precheckPMedianInputs(inputs as unknown as PMedianInputs);
  }
  if (modelId === "p-median-brazil") {
    return precheckPMedianInputs(inputs as unknown as PMedianInputs, BRAZIL_DATASET);
  }
  if (modelId === "transport-coal") {
    return precheckTransportInputs(inputs as unknown as TransportLpInputs);
  }
  if (modelId === "two-echelon-gold-au") {
    return precheckTwoEchelonInputs(inputs as unknown as TwoEchelonInputs);
  }
  return { ok: true, errors: [] };
}

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

  // B2.1 — semantic precheck runs after shape validation succeeds and
  // before the job is enqueued. Returns the same `errors` shape as
  // GET .../precheck for the same scenario state.
  const precheck = runNetworkEditsPrecheck(scenario.modelId, validation.data);
  if (!precheck.ok) {
    res.status(422).json({ error: "Network-edit precheck failed", errors: precheck.errors });
    return;
  }

  const jobId = await enqueueSolveJob(
    id,
    req.userId!,
    { modelId: scenario.modelId, inputs: validation.data } as SolveInput,
  );

  posthog?.capture({
    distinctId: req.userId!,
    event: "scenario solve enqueued",
    properties: {
      scenario_id: id,
      model_id: scenario.modelId,
      job_id: jobId,
    },
  });

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

// B2.1 — standalone precheck endpoint so the frontend (B5.2, a later task)
// can show inline network-edit warnings without triggering a solve
// attempt. Same underlying check as the solve route above; read-only, no
// DB writes. Ownership/404-not-403 idiom matches every other
// GET /scenarios/:scenarioId/... handler in this file.
router.get("/scenarios/:scenarioId/precheck", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  const validation = validateInputsForModel(scenario.modelId, scenario.inputs);
  if (!validation.success) {
    // Stored inputs that fail shape validation are a distinct, pre-existing
    // failure mode this endpoint's PrecheckResult contract has no room to
    // express (its error codes are semantic, not "your stored data is
    // malformed") — the solve route already surfaces that as its own 422
    // via this same validateInputsForModel call. Report no precheck
    // findings here rather than inventing a mismatched shape.
    res.json({ ok: true, errors: [] });
    return;
  }

  res.json(runNetworkEditsPrecheck(scenario.modelId, validation.data));
});

router.get("/scenarios/:scenarioId/export", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const entity = req.query.entity as string | undefined;
  const format = req.query.format as string | undefined;
  // B4.3 — entity=distances/laneCosts only. Id of a warehouse/mine or
  // customer/station (base or added) to generate a blank fill-in-the-blanks
  // distance/cost template for, instead of exporting the scenario's existing
  // distanceOverrides/laneCostOverrides. See services/templates.ts's header
  // comment on buildDistanceStubRows/buildLaneCostStubRows for why this
  // lives on the same endpoint rather than a new route.
  const stubFor = req.query.stubFor as string | undefined;

  // Phase C, Task 2 — output-entity export (assignments/openWarehouses/
  // costSummary/serviceStats/flows), derived from the scenario's stored
  // result rather than its inputs. Availability per model is driven by
  // each model's manifest.json capabilities.outputGrids (C6.1) — checked
  // below, not hardcoded to one model.
  const OUTPUT_ENTITIES = ["assignments", "openWarehouses", "costSummary", "serviceStats", "flows"] as const;
  type OutputEntity = typeof OUTPUT_ENTITIES[number];

  if (entity !== "warehouses" && entity !== "customers" && entity !== "mines" && entity !== "stations" && entity !== "refineries" && entity !== "distances" && entity !== "laneCosts" && entity !== "legDistances" && !OUTPUT_ENTITIES.includes(entity as OutputEntity)) {
    res.status(422).json({ error: "entity must be 'warehouses', 'customers', 'mines', 'stations', 'refineries', 'distances', 'laneCosts', 'legDistances', 'assignments', 'openWarehouses', 'costSummary', 'serviceStats', or 'flows'" });
    return;
  }
  if (format !== "csv" && format !== "json") {
    res.status(422).json({ error: "format must be 'csv' or 'json'" });
    return;
  }
  if (stubFor && entity !== "distances" && entity !== "laneCosts" && entity !== "legDistances") {
    res.status(422).json({ error: "stubFor is only supported for entity=distances, entity=laneCosts, or entity=legDistances" });
    return;
  }

  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  if (OUTPUT_ENTITIES.includes(entity as OutputEntity)) {
    // C6.1 — generalized from a hardcoded p-median-us-only check to reading
    // each model's own manifest-declared capabilities.outputGrids, so a new
    // model's grid availability is data (the manifest), not a code change
    // here.
    const manifest = getManifest(scenario.modelId);
    if (!manifest || !manifest.capabilities.outputGrids.includes(entity as OutputEntity)) {
      res.status(422).json({ error: `${entity} export is not supported for this model` });
      return;
    }
    if (stubFor) {
      res.status(422).json({ error: "stubFor is not supported for output entities" });
      return;
    }
    if (scenario.result == null || isStale(scenario)) {
      res.status(422).json({ error: "Scenario must be solved and not stale to export output data" });
      return;
    }
    const parsed = ResultEnvelopeSchema.safeParse(scenario.result);
    if (!parsed.success) {
      res.status(422).json({ error: "Stored result is not a valid result envelope" });
      return;
    }
    const result = parsed.data;

    posthog?.capture({
      distinctId: req.userId!,
      event: "scenario data exported",
      properties: { scenario_id: id, model_id: scenario.modelId, entity, format },
    });

    const rows: AssignmentTemplateRow[] | OpenWarehouseTemplateRow[] | CostSummaryTemplateRow[] | ServiceStatsTemplateRow[] | FlowTemplateRow[] =
      entity === "assignments" ? buildAssignmentRows(result)
      : entity === "openWarehouses" ? buildOpenWarehouseRows(result)
      : entity === "costSummary" ? buildCostSummaryRows(result)
      : entity === "serviceStats" ? buildServiceStatsRows(result)
      : buildFlowRows(result);

    if (format === "csv") {
      const csv = entity === "assignments" ? assignmentRowsToCsv(rows as AssignmentTemplateRow[])
        : entity === "openWarehouses" ? openWarehouseRowsToCsv(rows as OpenWarehouseTemplateRow[])
        : entity === "costSummary" ? costSummaryRowsToCsv(rows as CostSummaryTemplateRow[])
        : entity === "serviceStats" ? serviceStatsRowsToCsv(rows as ServiceStatsTemplateRow[])
        : flowRowsToCsv(rows as FlowTemplateRow[]);
      res.type("text/csv").send(csv);
      return;
    }
    res.json({ templateVersion: TEMPLATE_VERSION, entity, rows });
    return;
  }

  // Each model is scoped to its own entity pair: p-median-us exports
  // warehouses/customers/distances, transport-coal exports
  // mines/stations/laneCosts, two-echelon-gold-au exports
  // refineries/customers/legDistances (B6.2 stage 4). Any mismatch 422s —
  // same anti-cross-model-confusion boundary the original D4.1 gate had,
  // widened per new model (distances is p-median-us only, same boundary as
  // import — B4.1; laneCosts is transport-coal only, Task 30; legDistances
  // is two-echelon-gold-au only, B6.2).
  const entityIsPMedian = entity === "warehouses" || entity === "customers" || entity === "distances";
  const entityIsCoal = entity === "mines" || entity === "stations" || entity === "laneCosts";
  const entityIsTwoEchelon = entity === "refineries" || entity === "customers" || entity === "legDistances";
  if (scenario.modelId === "p-median-us" && !entityIsPMedian) {
    res.status(422).json({ error: "p-median-us scenarios only support warehouses/customers/distances export" });
    return;
  }
  if (scenario.modelId === "transport-coal" && !entityIsCoal) {
    res.status(422).json({ error: "transport-coal scenarios only support mines/stations/laneCosts export" });
    return;
  }
  if (scenario.modelId === "two-echelon-gold-au" && !entityIsTwoEchelon) {
    res.status(422).json({ error: "two-echelon-gold-au scenarios only support refineries/customers/legDistances export" });
    return;
  }
  if (scenario.modelId !== "p-median-us" && scenario.modelId !== "transport-coal" && scenario.modelId !== "two-echelon-gold-au") {
    res.status(422).json({ error: "Export is not supported for this model" });
    return;
  }

  if (scenario.modelId === "transport-coal") {
    // Mines/stations persist as sparse dicts (mineCapacities/stationDemands);
    // convert to the array shape the apply* functions expect, same direction
    // Studio's tables convert when loading. Task 30 — addedMines/
    // addedStations/laneCostOverrides join the shape read here.
    const inputs = scenario.inputs as {
      mineCapacities?: Record<string, number>;
      stationDemands?: Record<string, number>;
      addedMines?: Parameters<typeof applyMineOverrides>[1];
      addedStations?: Parameters<typeof applyStationOverrides>[1];
      laneCostOverrides?: Parameters<typeof applyLaneCostOverrides>[0];
    };

    // Task 30 — laneCosts is a wholly different shape (composite-keyed, no
    // fixed baseline to enumerate) from mines/stations below, mirroring
    // p-median-us's distances branch (below) exactly.
    if (entity === "laneCosts") {
      if (stubFor) {
        const stubRows = buildLaneCostStubRows(stubFor, inputs as Parameters<typeof buildLaneCostStubRows>[1]);
        if (stubRows === null) {
          res.status(422).json({ error: `stubFor "${stubFor}" does not reference a known mine or station (base dataset or this scenario's added entities)` });
          return;
        }
        posthog?.capture({
          distinctId: req.userId!,
          event: "scenario data exported",
          properties: { scenario_id: id, model_id: scenario.modelId, entity, format, stub_for: stubFor },
        });
        if (format === "csv") {
          res.type("text/csv").send(laneCostRowsToCsv(stubRows));
          return;
        }
        res.json({ templateVersion: TEMPLATE_VERSION, entity, rows: stubRows });
        return;
      }

      const laneCostRows = applyLaneCostOverrides(inputs.laneCostOverrides ?? []);
      posthog?.capture({
        distinctId: req.userId!,
        event: "scenario data exported",
        properties: { scenario_id: id, model_id: scenario.modelId, entity, format },
      });
      if (format === "csv") {
        res.type("text/csv").send(laneCostRowsToCsv(laneCostRows));
        return;
      }
      res.json({ templateVersion: TEMPLATE_VERSION, entity, rows: laneCostRows });
      return;
    }

    posthog?.capture({
      distinctId: req.userId!,
      event: "scenario data exported",
      properties: { scenario_id: id, model_id: scenario.modelId, entity, format },
    });
    if (format === "csv") {
      const csv = entity === "mines"
        ? mineRowsToCsv(applyMineOverrides(Object.entries(inputs.mineCapacities ?? {}).map(([mineId, capacity]) => ({ id: mineId, capacity })), inputs.addedMines ?? []))
        : stationRowsToCsv(applyStationOverrides(Object.entries(inputs.stationDemands ?? {}).map(([stationId, demand]) => ({ id: stationId, demand })), inputs.addedStations ?? []));
      res.type("text/csv").send(csv);
      return;
    }
    const rows = entity === "mines"
      ? applyMineOverrides(Object.entries(inputs.mineCapacities ?? {}).map(([mineId, capacity]) => ({ id: mineId, capacity })), inputs.addedMines ?? [])
      : applyStationOverrides(Object.entries(inputs.stationDemands ?? {}).map(([stationId, demand]) => ({ id: stationId, demand })), inputs.addedStations ?? []);
    res.json({ templateVersion: TEMPLATE_VERSION, entity, rows });
    return;
  }

  if (scenario.modelId === "two-echelon-gold-au") {
    const inputs = scenario.inputs as {
      refineryOverrides?: Parameters<typeof buildLegDistanceStubRows>[1]["refineryOverrides"];
      customerOverrides?: Parameters<typeof buildLegDistanceStubRows>[1]["customerOverrides"];
      distanceOverrides?: Parameters<typeof applyDistanceOverrides>[0];
      // T11 (multi-model expansion) — widened from
      // buildLegDistanceStubRows's own narrower stub-generator shape (which
      // only needs `id` for reference-integrity, not the full row) to
      // applyRefineryOverrides/applyGoldCustomerOverrides' own added-entity
      // param types, needed for the CSV/JSON export merge just below.
      addedRefineries?: Parameters<typeof applyRefineryOverrides>[1];
      addedCustomers?: Parameters<typeof applyGoldCustomerOverrides>[1];
    };

    // B6.2 stage 4 — legDistances is a wholly different shape (composite-
    // keyed, no fixed baseline to enumerate) from refineries/customers
    // below, mirroring p-median-us's distances branch / transport-coal's
    // laneCosts branch exactly. Reuses applyDistanceOverrides/
    // distanceRowsToCsv AS-IS (services/templates.ts's own header comment
    // on this reuse) — only the stub generator (buildLegDistanceStubRows)
    // is genuinely new for this model.
    if (entity === "legDistances") {
      if (stubFor) {
        const stubRows = buildLegDistanceStubRows(stubFor, inputs);
        if (stubRows === null) {
          res.status(422).json({ error: `stubFor "${stubFor}" does not reference a known mine, refinery, or customer (base dataset or this scenario's added entities)` });
          return;
        }
        posthog?.capture({
          distinctId: req.userId!,
          event: "scenario data exported",
          properties: { scenario_id: id, model_id: scenario.modelId, entity, format, stub_for: stubFor },
        });
        if (format === "csv") {
          res.type("text/csv").send(distanceRowsToCsv(stubRows));
          return;
        }
        res.json({ templateVersion: TEMPLATE_VERSION, entity, rows: stubRows });
        return;
      }

      const legDistanceRows = applyDistanceOverrides(inputs.distanceOverrides ?? []);
      posthog?.capture({
        distinctId: req.userId!,
        event: "scenario data exported",
        properties: { scenario_id: id, model_id: scenario.modelId, entity, format },
      });
      if (format === "csv") {
        res.type("text/csv").send(distanceRowsToCsv(legDistanceRows));
        return;
      }
      res.json({ templateVersion: TEMPLATE_VERSION, entity, rows: legDistanceRows });
      return;
    }

    posthog?.capture({
      distinctId: req.userId!,
      event: "scenario data exported",
      properties: { scenario_id: id, model_id: scenario.modelId, entity, format },
    });
    // T11 (multi-model expansion) — both now take a second addedX param
    // (mirroring applyWarehouseOverrides/applyCustomerOverrides), since
    // add-mode is enabled for both entities here now.
    if (format === "csv") {
      const csv = entity === "refineries"
        ? refineryRowsToCsv(applyRefineryOverrides((inputs.refineryOverrides ?? []) as Parameters<typeof applyRefineryOverrides>[0], inputs.addedRefineries ?? []))
        : customerRowsToCsv(applyGoldCustomerOverrides((inputs.customerOverrides ?? []) as Parameters<typeof applyGoldCustomerOverrides>[0], inputs.addedCustomers ?? []));
      res.type("text/csv").send(csv);
      return;
    }
    const rows = entity === "refineries"
      ? applyRefineryOverrides((inputs.refineryOverrides ?? []) as Parameters<typeof applyRefineryOverrides>[0], inputs.addedRefineries ?? [])
      : applyGoldCustomerOverrides((inputs.customerOverrides ?? []) as Parameters<typeof applyGoldCustomerOverrides>[0], inputs.addedCustomers ?? []);
    res.json({ templateVersion: TEMPLATE_VERSION, entity, rows });
    return;
  }

  // p-median-us: export reads solvers/p-median-us's own warehouse/customer
  // dataset directly (via services/templates.ts).
  const inputs = scenario.inputs as {
    warehouseOverrides?: unknown[];
    customerOverrides?: unknown[];
    addedWarehouses?: Parameters<typeof applyWarehouseOverrides>[1];
    addedCustomers?: Parameters<typeof applyCustomerOverrides>[1];
    distanceOverrides?: Parameters<typeof applyDistanceOverrides>[0];
  };

  // B4.3 — distances is a wholly different shape (composite-keyed, no fixed
  // baseline to enumerate) from warehouses/customers below, so it's handled
  // as its own branch before the shared warehouses/customers code.
  if (entity === "distances") {
    if (stubFor) {
      const stubRows = buildDistanceStubRows(stubFor, inputs as Parameters<typeof buildDistanceStubRows>[1]);
      if (stubRows === null) {
        res.status(422).json({ error: `stubFor "${stubFor}" does not reference a known warehouse or customer (base dataset or this scenario's added entities)` });
        return;
      }
      posthog?.capture({
        distinctId: req.userId!,
        event: "scenario data exported",
        properties: { scenario_id: id, model_id: scenario.modelId, entity, format, stub_for: stubFor },
      });
      if (format === "csv") {
        res.type("text/csv").send(distanceRowsToCsv(stubRows));
        return;
      }
      res.json({ templateVersion: TEMPLATE_VERSION, entity, rows: stubRows });
      return;
    }

    const distanceRows = applyDistanceOverrides(inputs.distanceOverrides ?? []);
    posthog?.capture({
      distinctId: req.userId!,
      event: "scenario data exported",
      properties: { scenario_id: id, model_id: scenario.modelId, entity, format },
    });
    if (format === "csv") {
      res.type("text/csv").send(distanceRowsToCsv(distanceRows));
      return;
    }
    res.json({ templateVersion: TEMPLATE_VERSION, entity, rows: distanceRows });
    return;
  }

  const rows = entity === "warehouses"
    ? applyWarehouseOverrides((inputs.warehouseOverrides ?? []) as Parameters<typeof applyWarehouseOverrides>[0], inputs.addedWarehouses ?? [])
    : applyCustomerOverrides((inputs.customerOverrides ?? []) as Parameters<typeof applyCustomerOverrides>[0], inputs.addedCustomers ?? []);

  posthog?.capture({
    distinctId: req.userId!,
    event: "scenario data exported",
    properties: { scenario_id: id, model_id: scenario.modelId, entity, format },
  });

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
  entity: "warehouses" | "customers" | "refineries",
  currentOverrides: Array<{ id: string; status: string; capacity?: number | null; demand?: number | null }>,
  changes: ImportRowChange[],
): Array<Record<string, unknown>> {
  // Refineries have no value column at all (no capacity/demand concept) —
  // their override entries are status-only.
  const valueField = entity === "warehouses" ? "capacity" : entity === "customers" ? "demand" : null;
  const rest = currentOverrides.filter(o => !changes.some(c => c.id === o.id));
  const applied = changes
    .map(c => (valueField ? { id: c.id, status: c.after.status, [valueField]: c.after.value } : { id: c.id, status: c.after.status }))
    .filter(o => !(o.status === "active" && (valueField ? (o as Record<string, unknown>)[valueField] == null : true)));
  return [...rest, ...applied];
}

// B4.2 — appends newly-added warehouses/customers (unrecognized id + valid
// coordinates; services/import.ts's changeType:"add" rows) onto the
// scenario's addedWarehouses/addedCustomers arrays. Unlike
// mergeChangesIntoOverrides, there's no existing entry to diff/replace by id
// — every add-change is a brand-new row, so this always appends.
// parseAndValidateImport's id_collision check (against both the base
// dataset and this scenario's existing addedWarehouses/addedCustomers)
// already rejects any CSV row whose id would collide, so a naive append
// here can't create a duplicate id. Builds exactly the fields B1.1's
// addedWarehouseSchema/addedCustomerSchema expect. Task 26 —
// addedCustomerSchema gained a `state` field (matching
// addedWarehouseSchema's), so a customer add-change's `state` is now
// carried through here too, same as warehouses; addedCustomerSchema still
// has no `status` field at all (v1 has no add-and-exclude, see precheck.ts's
// header comment) — its `status` was already validated "active"-only in
// services/import.ts before it could become a change, and is not persisted.
// Task 30 (B6.1 stage 4) — mines/stations join this function's entity set,
// writing into addedMines/addedStations. Builds exactly the fields
// transportLp.ts's addedMineSchema/addedStationSchema expect: addedMines has
// no status field either (mines have no status concept at all, matching
// templates.ts's own MineOverride) — c.after.status is simply never read for
// it, mirroring how addedCustomers never reads it today.
// T11 — warehouses/customers/refineries/mines/stations all carry
// `c.displayCode` now (services/import.ts's uid identity model — see its
// own header comment), matching pMedian.ts's addedWarehouseSchema/
// addedCustomerSchema, twoEchelon.ts's addedRefinerySchema/
// addedCustomerSchema, and transportLp.ts's addedMineSchema/
// addedStationSchema's optional `displayCode` field (Step A).
function mergeAddChangesIntoAdded(
  entity: "warehouses" | "customers" | "mines" | "stations" | "refineries",
  currentAdded: Array<Record<string, unknown>>,
  addChanges: ImportRowChange[],
): Array<Record<string, unknown>> {
  const newEntities = addChanges.map(c => (
    entity === "warehouses"
      ? { id: c.id, displayCode: c.displayCode, city: c.city, state: c.state, lat: c.lat, lng: c.lng, capacity: c.after.value, status: c.after.status }
      : entity === "customers"
      ? { id: c.id, displayCode: c.displayCode, city: c.city, state: c.state, lat: c.lat, lng: c.lng, demand: c.after.value }
      // Refineries — no capacity field at all (twoEchelon.ts's
      // addedRefinerySchema has none, see its own header comment).
      : entity === "refineries"
      ? { id: c.id, displayCode: c.displayCode, city: c.city, state: c.state, lat: c.lat, lng: c.lng, status: c.after.status }
      : entity === "mines"
      ? { id: c.id, displayCode: c.displayCode, city: c.city, state: c.state, lat: c.lat, lng: c.lng, capacity: c.after.value }
      // stations — same demand-only shape as mines, displayCode included.
      : { id: c.id, displayCode: c.displayCode, city: c.city, state: c.state, lat: c.lat, lng: c.lng, demand: c.after.value }
  ));
  return [...currentAdded, ...newEntities];
}

// T11 — merges CSV update_added changes (services/import.ts's
// `changeType: "update_added"`, an id matching an already-added entity's
// stable uid) directly into addedWarehouses/addedCustomers/addedRefineries/
// addedMines/addedStations, replacing that entity's capacity/status (or
// demand) in place. Deliberately never touches city/state/lat/lng/
// displayCode — see import.ts's own comment on isUpdateAdded for the full
// reasoning (moving/renaming an added entity stays the map's Move/Edit
// dialogs' job).
function mergeUpdateAddedChanges(
  entity: "warehouses" | "customers" | "refineries" | "mines" | "stations",
  currentAdded: Array<Record<string, unknown>>,
  updateAddedChanges: ImportRowChange[],
): Array<Record<string, unknown>> {
  const changeById = new Map(updateAddedChanges.map(c => [c.id, c]));
  return currentAdded.map(row => {
    const change = changeById.get(row.id as string);
    if (!change) return row;
    return entity === "warehouses"
      ? { ...row, capacity: change.after.value, status: change.after.status }
      : entity === "customers" || entity === "stations"
      ? { ...row, demand: change.after.value }
      // Mines — capacity only, no status field at all (matches
      // mergeAddChangesIntoAdded above).
      : entity === "mines"
      ? { ...row, capacity: change.after.value }
      // Refineries — status only, mirroring mergeAddChangesIntoAdded above.
      : { ...row, status: change.after.status };
  });
}

// Transport-coal's mines/stations persist overrides as sparse dicts
// (mineCapacities/stationDemands), not arrays. Same "null value = no
// override, omit the entry" semantics as the array merge above, just keyed
// by id into a dict — matching the wire shape transportLp.ts validates and
// solve.py reads (mine_caps.get(m, ...)).
function mergeChangesIntoDict(
  current: Record<string, number>,
  changes: ImportRowChange[],
): Record<string, number> {
  const changedIds = new Set(changes.map(c => c.id));
  const result: Record<string, number> = {};
  // Preserve current overrides this import didn't touch (the export is a
  // full dump, but a partial/short CSV must not silently drop untouched rows).
  for (const [id, val] of Object.entries(current)) {
    if (!changedIds.has(id) && val != null) {
      result[id] = val;
    }
  }
  // Apply imported changes — a null value clears the override (omit entry).
  for (const c of changes) {
    if (c.after.value != null) {
      result[c.id] = c.after.value;
    }
  }
  return result;
}

// B4.1 — distances persists overrides as an array keyed by the composite
// (fromId, toId) pair, not a single `id` like every other entity's override
// array. Reads `c.fromId`/`c.toId` (populated only for distances rows by
// services/import.ts's parseDistancesRows) rather than parsing `c.id`'s
// composite display string back apart. Unlike mergeChangesIntoOverrides,
// there is no "active/null is the no-op default" case to filter out here —
// every distances change already carries a validated positive distance
// (parseDistancesRows never emits a change with a null value), so every
// change is a real override to keep.
function mergeDistanceChangesIntoOverrides(
  currentOverrides: Array<{ fromId: string; toId: string; distance: number }>,
  changes: ImportRowChange[],
): Array<{ fromId: string; toId: string; distance: number }> {
  const changedKeys = new Set(changes.map(c => `${c.fromId}|${c.toId}`));
  const rest = currentOverrides.filter(o => !changedKeys.has(`${o.fromId}|${o.toId}`));
  const applied = changes.map(c => ({ fromId: c.fromId!, toId: c.toId!, distance: c.after.value! }));
  return [...rest, ...applied];
}

// Task 30 (B6.1 stage 4) — laneCostOverrides persists overrides as an array
// keyed by the composite (fromId, toId) pair, the exact transport-coal
// analogue of mergeDistanceChangesIntoOverrides above (field name aside —
// `cost` instead of `distance`).
function mergeLaneCostChangesIntoOverrides(
  currentOverrides: Array<{ fromId: string; toId: string; cost: number }>,
  changes: ImportRowChange[],
): Array<{ fromId: string; toId: string; cost: number }> {
  const changedKeys = new Set(changes.map(c => `${c.fromId}|${c.toId}`));
  const rest = currentOverrides.filter(o => !changedKeys.has(`${o.fromId}|${o.toId}`));
  const applied = changes.map(c => ({ fromId: c.fromId!, toId: c.toId!, cost: c.after.value! }));
  return [...rest, ...applied];
}

router.post("/scenarios/:scenarioId/import", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const { entity, csvText } = req.body as { entity?: string; csvText?: string };

  if (entity !== "warehouses" && entity !== "customers" && entity !== "mines" && entity !== "stations" && entity !== "refineries" && entity !== "distances" && entity !== "laneCosts" && entity !== "legDistances") {
    res.status(422).json({ error: "entity must be 'warehouses', 'customers', 'mines', 'stations', 'refineries', 'distances', 'laneCosts', or 'legDistances'" });
    return;
  }
  if (typeof csvText !== "string") {
    res.status(422).json({ error: "csvText is required" });
    return;
  }

  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  // Same model↔entity pairing the export route enforces: p-median-us imports
  // warehouses/customers/distances, transport-coal imports
  // mines/stations/laneCosts, two-echelon-gold-au imports
  // refineries/customers/legDistances (B6.2 stage 4). distances (B4.1) is
  // p-median-us only — it's the scenario-local network-edits pilot model
  // (B1.1-B3.1); laneCosts (Task 30) is transport-coal only, legDistances
  // (B6.2) is two-echelon-gold-au only, same reasoning.
  const entityIsPMedian = entity === "warehouses" || entity === "customers" || entity === "distances";
  const entityIsCoal = entity === "mines" || entity === "stations" || entity === "laneCosts";
  const entityIsTwoEchelon = entity === "refineries" || entity === "customers" || entity === "legDistances";
  if (scenario.modelId === "p-median-us" && !entityIsPMedian) {
    res.status(422).json({ error: "p-median-us scenarios only support warehouses/customers/distances import" });
    return;
  }
  if (scenario.modelId === "transport-coal" && !entityIsCoal) {
    res.status(422).json({ error: "transport-coal scenarios only support mines/stations/laneCosts import" });
    return;
  }
  if (scenario.modelId === "two-echelon-gold-au" && !entityIsTwoEchelon) {
    res.status(422).json({ error: "two-echelon-gold-au scenarios only support refineries/customers/legDistances import" });
    return;
  }
  if (scenario.modelId !== "p-median-us" && scenario.modelId !== "transport-coal" && scenario.modelId !== "two-echelon-gold-au") {
    res.status(422).json({ error: "Import is not supported for this model" });
    return;
  }

  // inputs carries warehouseOverrides/customerOverrides/distanceOverrides/
  // addedWarehouses/addedCustomers (p-median), mineCapacities/stationDemands/
  // addedMines/addedStations/laneCostOverrides (transport-coal), or
  // refineryOverrides/customerOverrides/distanceOverrides/addedRefineries/
  // addedCustomers (two-echelon-gold-au); parseAndValidateImport reads
  // whichever matches `entity`, disambiguating the shared "customers" entity
  // name by modelId. p is p-median-only — pass 0 otherwise (its p-driven
  // warning branch never fires for other entities).
  const inputs = scenario.inputs as { p?: number; warehouseOverrides?: unknown[]; customerOverrides?: unknown[]; mineCapacities?: Record<string, number>; stationDemands?: Record<string, number>; refineryOverrides?: unknown[]; distanceOverrides?: unknown[]; laneCostOverrides?: unknown[]; addedWarehouses?: unknown[]; addedCustomers?: unknown[]; addedMines?: unknown[]; addedStations?: unknown[]; addedRefineries?: unknown[] };
  const preview = parseAndValidateImport(entity as ImportEntity, csvText, inputs as Parameters<typeof parseAndValidateImport>[2], inputs.p ?? 0, scenario.modelId);
  res.json(preview);
});

router.post("/scenarios/:scenarioId/import/apply", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const { entity, csvText, mode } = req.body as { entity?: string; csvText?: string; mode?: string };

  if (entity !== "warehouses" && entity !== "customers" && entity !== "mines" && entity !== "stations" && entity !== "refineries" && entity !== "distances" && entity !== "laneCosts" && entity !== "legDistances") {
    res.status(422).json({ error: "entity must be 'warehouses', 'customers', 'mines', 'stations', 'refineries', 'distances', 'laneCosts', or 'legDistances'" });
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

  // distances/laneCosts/legDistances (B4.1/Task 30/B6.2) are p-median-us-
  // only/transport-coal-only/two-echelon-gold-au-only respectively — see
  // the /import route's comment.
  const entityIsPMedian = entity === "warehouses" || entity === "customers" || entity === "distances";
  const entityIsCoal = entity === "mines" || entity === "stations" || entity === "laneCosts";
  const entityIsTwoEchelon = entity === "refineries" || entity === "customers" || entity === "legDistances";
  if (scenario.modelId === "p-median-us" && !entityIsPMedian) {
    res.status(422).json({ error: "p-median-us scenarios only support warehouses/customers/distances import" });
    return;
  }
  if (scenario.modelId === "transport-coal" && !entityIsCoal) {
    res.status(422).json({ error: "transport-coal scenarios only support mines/stations/laneCosts import" });
    return;
  }
  if (scenario.modelId === "two-echelon-gold-au" && !entityIsTwoEchelon) {
    res.status(422).json({ error: "two-echelon-gold-au scenarios only support refineries/customers/legDistances import" });
    return;
  }
  if (scenario.modelId !== "p-median-us" && scenario.modelId !== "transport-coal" && scenario.modelId !== "two-echelon-gold-au") {
    res.status(422).json({ error: "Import is not supported for this model" });
    return;
  }

  // Always re-validate against the live scenario state — never trust a
  // client-held preview, which may be stale by the time apply is called.
  const inputs = scenario.inputs as { p?: number; warehouseOverrides?: Array<{ id: string; status: string; capacity?: number | null; demand?: number | null }>; customerOverrides?: Array<{ id: string; status: string; capacity?: number | null; demand?: number | null }>; mineCapacities?: Record<string, number>; stationDemands?: Record<string, number>; refineryOverrides?: Array<{ id: string; status: string }>; distanceOverrides?: Array<{ fromId: string; toId: string; distance: number }>; laneCostOverrides?: Array<{ fromId: string; toId: string; cost: number }>; addedWarehouses?: Array<{ id: string }>; addedCustomers?: Array<{ id: string }>; addedMines?: Array<{ id: string }>; addedStations?: Array<{ id: string }>; addedRefineries?: Array<{ id: string }> };
  const preview = parseAndValidateImport(entity as ImportEntity, csvText, inputs as Parameters<typeof parseAndValidateImport>[2], inputs.p ?? 0, scenario.modelId);

  if (applyMode === "all_or_nothing" && preview.errors.length > 0) {
    res.status(422).json({ error: "Import has errors; nothing was applied (all-or-nothing mode)", preview });
    return;
  }

  let nextInputs: Record<string, unknown>;
  if (entity === "mines" || entity === "stations") {
    // Task 30 (B6.1 stage 4) — ADD-classified changes (services/import.ts's
    // changeType:"add") write into addedMines/addedStations instead of the
    // mineCapacities/stationDemands sparse dict; ordinary UPDATE changes keep
    // going through the pre-existing dict merge. Same split
    // warehouses/customers already do below, generalized to the dict-backed
    // pair. T11 (Step A) — a third group, update_added (an id matching an
    // already-added mine/station's uid), also writes into
    // addedMines/addedStations — by replacing that entity's own record in
    // place (mergeUpdateAddedChanges), never through the mineCapacities/
    // stationDemands dict (which is base-id-keyed only; an added entity's
    // own record is authoritative for its fields, matching templates.ts's
    // applyMineOverrides/applyStationOverrides).
    const updateChanges = preview.changes.filter(c => c.changeType !== "add" && c.changeType !== "update_added");
    const addChanges = preview.changes.filter(c => c.changeType === "add");
    const updateAddedChanges = preview.changes.filter(c => c.changeType === "update_added");

    const overrideKey = entity === "mines" ? "mineCapacities" : "stationDemands";
    const currentDict = inputs[overrideKey] ?? {};
    const nextDict = mergeChangesIntoDict(currentDict, updateChanges);

    const addedKey = entity === "mines" ? "addedMines" : "addedStations";
    const currentAdded = (inputs[addedKey] ?? []) as Array<Record<string, unknown>>;
    const addedAfterAppend = mergeAddChangesIntoAdded(entity, currentAdded, addChanges);
    const nextAdded = mergeUpdateAddedChanges(entity, addedAfterAppend, updateAddedChanges);

    nextInputs = { ...inputs, [overrideKey]: nextDict, [addedKey]: nextAdded };

    // Re-validate the merged shape against Task 30's Zod schema before
    // persisting — never trust a stale preview, same convention
    // warehouses/customers already follow below.
    const revalidated = validateInputsForModel(scenario.modelId, nextInputs);
    if (!revalidated.success) {
      res.status(422).json({ error: revalidated.error });
      return;
    }
    nextInputs = revalidated.data;
  } else if (entity === "distances") {
    const currentDistanceOverrides = inputs.distanceOverrides ?? [];
    const nextDistanceOverrides = mergeDistanceChangesIntoOverrides(currentDistanceOverrides, preview.changes);
    nextInputs = { ...inputs, distanceOverrides: nextDistanceOverrides };
  } else if (entity === "laneCosts") {
    const currentLaneCostOverrides = inputs.laneCostOverrides ?? [];
    const nextLaneCostOverrides = mergeLaneCostChangesIntoOverrides(currentLaneCostOverrides, preview.changes);
    nextInputs = { ...inputs, laneCostOverrides: nextLaneCostOverrides };
  } else if (entity === "warehouses" || entity === "customers") {
    // B4.2 — ADD-classified changes (services/import.ts's changeType:"add",
    // blank id + valid new-entity data — T11 changed the trigger from
    // "unrecognized non-blank id") write into addedWarehouses/
    // addedCustomers instead of warehouseOverrides/customerOverrides;
    // ordinary UPDATE changes keep going through the pre-existing override
    // merge. T11 adds a third group — update_added changes (an id matching
    // an already-added entity's stable uid) — which also write into
    // addedWarehouses/addedCustomers, but by replacing that entity's own
    // record in place (mergeUpdateAddedChanges), never through
    // warehouseOverrides/customerOverrides. Three different write targets
    // from one `preview.changes` array, split by changeType.
    const updateChanges = preview.changes.filter(c => c.changeType !== "add" && c.changeType !== "update_added");
    const addChanges = preview.changes.filter(c => c.changeType === "add");
    const updateAddedChanges = preview.changes.filter(c => c.changeType === "update_added");

    const overrideKey = entity === "warehouses" ? "warehouseOverrides" : "customerOverrides";
    const currentOverrides = (inputs[overrideKey] ?? []) as Array<{ id: string; status: string; capacity?: number | null; demand?: number | null }>;
    const nextOverrides = mergeChangesIntoOverrides(entity, currentOverrides, updateChanges);

    const addedKey = entity === "warehouses" ? "addedWarehouses" : "addedCustomers";
    const currentAdded = (inputs[addedKey] ?? []) as Array<Record<string, unknown>>;
    const addedAfterAppend = mergeAddChangesIntoAdded(entity, currentAdded, addChanges);
    const nextAdded = mergeUpdateAddedChanges(entity, addedAfterAppend, updateAddedChanges);

    nextInputs = { ...inputs, [overrideKey]: nextOverrides, [addedKey]: nextAdded };

    // Re-validate the merged shape against B1.1's Zod schema before
    // persisting — never trust a stale preview, same convention as every
    // other write path in this file (POST/PATCH /scenarios both call
    // validateInputsForModel before their own db.insert/update). ADD rows
    // are already shape-checked by parseAndValidateImport above, but this
    // is the final gate before the DB write.
    const revalidated = validateInputsForModel(scenario.modelId, nextInputs);
    if (!revalidated.success) {
      res.status(422).json({ error: revalidated.error });
      return;
    }
    nextInputs = revalidated.data;
  } else if (entity === "legDistances") {
    // B6.2 stage 4 — legDistances persists into the SAME `distanceOverrides`
    // field p-median-us's distances entity writes (a deliberate B6.2 stage 1
    // naming choice), so mergeDistanceChangesIntoOverrides is reused as-is —
    // no new merge function needed, only a different persistence key check
    // (this branch, not the earlier `entity === "distances"` one, since the
    // two entity STRINGS still route through different reference-integrity
    // rules in parseAndValidateImport above).
    const currentDistanceOverrides = inputs.distanceOverrides ?? [];
    const nextDistanceOverrides = mergeDistanceChangesIntoOverrides(currentDistanceOverrides, preview.changes);
    nextInputs = { ...inputs, distanceOverrides: nextDistanceOverrides };
  } else {
    // entity === "refineries" (the only entity that reaches this final
    // else). T11 — refineries joins warehouses/customers' 3-way changeType
    // split (see that branch's own comment): WarehousesTab.tsx already
    // mints a uid+displayCode for added refineries (reused per B6.2), so
    // ADD/update_added need the same addedRefineries write target.
    const updateChanges = preview.changes.filter(c => c.changeType !== "add" && c.changeType !== "update_added");
    const addChanges = preview.changes.filter(c => c.changeType === "add");
    const updateAddedChanges = preview.changes.filter(c => c.changeType === "update_added");

    const currentOverrides = (inputs.refineryOverrides ?? []) as Array<{ id: string; status: string; capacity?: number | null; demand?: number | null }>;
    const nextOverrides = mergeChangesIntoOverrides("refineries", currentOverrides, updateChanges);

    const currentAdded = (inputs.addedRefineries ?? []) as Array<Record<string, unknown>>;
    const addedAfterAppend = mergeAddChangesIntoAdded("refineries", currentAdded, addChanges);
    const nextAdded = mergeUpdateAddedChanges("refineries", addedAfterAppend, updateAddedChanges);

    nextInputs = { ...inputs, refineryOverrides: nextOverrides, addedRefineries: nextAdded };

    // Re-validate the merged shape against twoEchelon.ts's Zod schema before
    // persisting — same convention warehouses/customers/mines/stations
    // already follow above.
    const revalidated = validateInputsForModel(scenario.modelId, nextInputs);
    if (!revalidated.success) {
      res.status(422).json({ error: revalidated.error });
      return;
    }
    nextInputs = revalidated.data;
  }

  // T1 (Input Map v2) / follow-up item 3 — an imported "add" row (across any
  // of the three covered models' warehouses/mines/refineries/customers/
  // distances/lane-costs entities) can leave newly-added entities without a
  // complete distance set the same way a map-added entity can; run the same
  // normalizer here too so every persist path stays consistent.
  nextInputs = normalizeAddedEntityDistances(scenario.modelId, nextInputs);

  const [updated] = await db.update(scenariosTable)
    .set({
      inputs: nextInputs,
      inputsUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)))
    .returning();

  posthog?.capture({
    distinctId: req.userId!,
    event: "scenario data imported",
    properties: {
      scenario_id: id,
      model_id: scenario.modelId,
      entity,
      applied_count: preview.changes.length,
      error_count: preview.errors.length,
      mode: applyMode,
    },
  });

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

  posthog?.capture({
    distinctId: req.userId!,
    event: "scenario cloned",
    properties: {
      source_scenario_id: id,
      clone_scenario_id: clone.id,
      model_id: clone.modelId,
    },
  });

  res.status(201).json(toApiScenario(clone));
});

export default router;
