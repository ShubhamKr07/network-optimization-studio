import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, scenariosTable, solveJobsTable } from "@workspace/db";
import { posthog } from "../lib/posthog.js";
import { enqueueSolveJob, getQueueDepth, QUEUE_DEPTH_LIMIT } from "../solver/jobRunner.js";
import type { SolveInput } from "../solver/pmedian.js";
import { requireAuth } from "../middlewares/auth.js";
import { validateInputsForModel } from "../validation/inputs/index.js";
import {
  TEMPLATE_VERSION,
  applyWarehouseOverrides,
  applyCustomerOverrides,
  applyMineOverrides,
  applyStationOverrides,
  applyRefineryOverrides,
  applyGoldCustomerOverrides,
  applyDistanceOverrides,
  buildDistanceStubRows,
  warehouseRowsToCsv,
  customerRowsToCsv,
  mineRowsToCsv,
  stationRowsToCsv,
  refineryRowsToCsv,
  distanceRowsToCsv,
} from "../services/templates.js";
import { parseAndValidateImport } from "../services/import.js";
import type { ImportEntity, ImportRowChange } from "../services/import.js";
import { precheckPMedianInputs, precheckTransportInputs, BRAZIL_DATASET } from "../services/precheck.js";
import type { PrecheckResult } from "../services/precheck.js";
import type { PMedianInputs } from "../validation/inputs/pMedian.js";
import type { TransportLpInputs } from "../validation/inputs/transportLp.js";

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
    inputs: validation.data,
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

  posthog?.capture({
    distinctId: req.userId!,
    event: "scenario compared",
    properties: {
      scenario_ids: ids,
      scenario_count: ids.length,
      model_id: [...modelIds][0],
    },
  });

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
// drop-in call to precheckPMedianInputs. two-echelon-gold-au still has no
// network-edit fields on its own input schema at all, so it still trivially
// passes with ok:true/errors:[], matching this endpoint's own OpenAPI doc
// note. `inputs` here is always already-validated (validateInputsForModel's
// `.data`), so the casts are safe exactly where they're used, same pattern
// as this file's existing `as SolveInput` cast below.
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
  // B4.3 — entity=distances only. Id of a warehouse or customer (base or
  // added) to generate a blank fill-in-the-blanks distance template for,
  // instead of exporting the scenario's existing distanceOverrides. See
  // services/templates.ts's header comment on buildDistanceStubRows for why
  // this lives on the same endpoint rather than a new route.
  const stubFor = req.query.stubFor as string | undefined;

  if (entity !== "warehouses" && entity !== "customers" && entity !== "mines" && entity !== "stations" && entity !== "refineries" && entity !== "distances") {
    res.status(422).json({ error: "entity must be 'warehouses', 'customers', 'mines', 'stations', 'refineries', or 'distances'" });
    return;
  }
  if (format !== "csv" && format !== "json") {
    res.status(422).json({ error: "format must be 'csv' or 'json'" });
    return;
  }
  if (stubFor && entity !== "distances") {
    res.status(422).json({ error: "stubFor is only supported for entity=distances" });
    return;
  }

  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  // Each model is scoped to its own entity pair: p-median-us exports
  // warehouses/customers/distances, transport-coal exports mines/stations,
  // two-echelon-gold-au exports refineries/customers. Any mismatch 422s —
  // same anti-cross-model-confusion boundary the original D4.1 gate had,
  // widened to a third model (distances is p-median-us only, same boundary
  // as import — B4.1).
  const entityIsPMedian = entity === "warehouses" || entity === "customers" || entity === "distances";
  const entityIsCoal = entity === "mines" || entity === "stations";
  const entityIsTwoEchelon = entity === "refineries" || entity === "customers";
  if (scenario.modelId === "p-median-us" && !entityIsPMedian) {
    res.status(422).json({ error: "p-median-us scenarios only support warehouses/customers/distances export" });
    return;
  }
  if (scenario.modelId === "transport-coal" && !entityIsCoal) {
    res.status(422).json({ error: "transport-coal scenarios only support mines/stations export" });
    return;
  }
  if (scenario.modelId === "two-echelon-gold-au" && !entityIsTwoEchelon) {
    res.status(422).json({ error: "two-echelon-gold-au scenarios only support refineries/customers export" });
    return;
  }
  if (scenario.modelId !== "p-median-us" && scenario.modelId !== "transport-coal" && scenario.modelId !== "two-echelon-gold-au") {
    res.status(422).json({ error: "Export is not supported for this model" });
    return;
  }

  if (scenario.modelId === "transport-coal") {
    // Mines/stations persist as sparse dicts (mineCapacities/stationDemands);
    // convert to the array shape the apply* functions expect, same direction
    // Studio's tables convert when loading.
    const inputs = scenario.inputs as { mineCapacities?: Record<string, number>; stationDemands?: Record<string, number> };
    posthog?.capture({
      distinctId: req.userId!,
      event: "scenario data exported",
      properties: { scenario_id: id, model_id: scenario.modelId, entity, format },
    });
    if (format === "csv") {
      const csv = entity === "mines"
        ? mineRowsToCsv(applyMineOverrides(Object.entries(inputs.mineCapacities ?? {}).map(([mineId, capacity]) => ({ id: mineId, capacity }))))
        : stationRowsToCsv(applyStationOverrides(Object.entries(inputs.stationDemands ?? {}).map(([stationId, demand]) => ({ id: stationId, demand }))));
      res.type("text/csv").send(csv);
      return;
    }
    const rows = entity === "mines"
      ? applyMineOverrides(Object.entries(inputs.mineCapacities ?? {}).map(([mineId, capacity]) => ({ id: mineId, capacity })))
      : applyStationOverrides(Object.entries(inputs.stationDemands ?? {}).map(([stationId, demand]) => ({ id: stationId, demand })));
    res.json({ templateVersion: TEMPLATE_VERSION, entity, rows });
    return;
  }

  if (scenario.modelId === "two-echelon-gold-au") {
    const inputs = scenario.inputs as { refineryOverrides?: unknown[]; customerOverrides?: unknown[] };
    posthog?.capture({
      distinctId: req.userId!,
      event: "scenario data exported",
      properties: { scenario_id: id, model_id: scenario.modelId, entity, format },
    });
    if (format === "csv") {
      const csv = entity === "refineries"
        ? refineryRowsToCsv(applyRefineryOverrides((inputs.refineryOverrides ?? []) as Parameters<typeof applyRefineryOverrides>[0]))
        : customerRowsToCsv(applyGoldCustomerOverrides((inputs.customerOverrides ?? []) as Parameters<typeof applyGoldCustomerOverrides>[0]));
      res.type("text/csv").send(csv);
      return;
    }
    const rows = entity === "refineries"
      ? applyRefineryOverrides((inputs.refineryOverrides ?? []) as Parameters<typeof applyRefineryOverrides>[0])
      : applyGoldCustomerOverrides((inputs.customerOverrides ?? []) as Parameters<typeof applyGoldCustomerOverrides>[0]);
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
function mergeAddChangesIntoAdded(
  entity: "warehouses" | "customers",
  currentAdded: Array<Record<string, unknown>>,
  addChanges: ImportRowChange[],
): Array<Record<string, unknown>> {
  const newEntities = addChanges.map(c => (
    entity === "warehouses"
      ? { id: c.id, city: c.city, state: c.state, lat: c.lat, lng: c.lng, capacity: c.after.value, status: c.after.status }
      : { id: c.id, city: c.city, state: c.state, lat: c.lat, lng: c.lng, demand: c.after.value }
  ));
  return [...currentAdded, ...newEntities];
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

router.post("/scenarios/:scenarioId/import", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const { entity, csvText } = req.body as { entity?: string; csvText?: string };

  if (entity !== "warehouses" && entity !== "customers" && entity !== "mines" && entity !== "stations" && entity !== "refineries" && entity !== "distances") {
    res.status(422).json({ error: "entity must be 'warehouses', 'customers', 'mines', 'stations', 'refineries', or 'distances'" });
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
  // warehouses/customers/distances, transport-coal imports mines/stations,
  // two-echelon-gold-au imports refineries/customers. distances (B4.1) is
  // p-median-us only — it's the scenario-local network-edits pilot model
  // (B1.1-B3.1); no other model's inputs schema has distanceOverrides.
  const entityIsPMedian = entity === "warehouses" || entity === "customers" || entity === "distances";
  const entityIsCoal = entity === "mines" || entity === "stations";
  const entityIsTwoEchelon = entity === "refineries" || entity === "customers";
  if (scenario.modelId === "p-median-us" && !entityIsPMedian) {
    res.status(422).json({ error: "p-median-us scenarios only support warehouses/customers/distances import" });
    return;
  }
  if (scenario.modelId === "transport-coal" && !entityIsCoal) {
    res.status(422).json({ error: "transport-coal scenarios only support mines/stations import" });
    return;
  }
  if (scenario.modelId === "two-echelon-gold-au" && !entityIsTwoEchelon) {
    res.status(422).json({ error: "two-echelon-gold-au scenarios only support refineries/customers import" });
    return;
  }
  if (scenario.modelId !== "p-median-us" && scenario.modelId !== "transport-coal" && scenario.modelId !== "two-echelon-gold-au") {
    res.status(422).json({ error: "Import is not supported for this model" });
    return;
  }

  // inputs carries warehouseOverrides/customerOverrides/distanceOverrides/
  // addedWarehouses/addedCustomers (p-median), mineCapacities/stationDemands
  // (transport-coal), or refineryOverrides/customerOverrides
  // (two-echelon-gold-au); parseAndValidateImport reads whichever matches
  // `entity`, disambiguating the shared "customers" entity name by modelId.
  // p is p-median-only — pass 0 otherwise (its p-driven warning branch never
  // fires for other entities).
  const inputs = scenario.inputs as { p?: number; warehouseOverrides?: unknown[]; customerOverrides?: unknown[]; mineCapacities?: Record<string, number>; stationDemands?: Record<string, number>; refineryOverrides?: unknown[]; distanceOverrides?: unknown[]; addedWarehouses?: unknown[]; addedCustomers?: unknown[] };
  const preview = parseAndValidateImport(entity as ImportEntity, csvText, inputs as Parameters<typeof parseAndValidateImport>[2], inputs.p ?? 0, scenario.modelId);
  res.json(preview);
});

router.post("/scenarios/:scenarioId/import/apply", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const { entity, csvText, mode } = req.body as { entity?: string; csvText?: string; mode?: string };

  if (entity !== "warehouses" && entity !== "customers" && entity !== "mines" && entity !== "stations" && entity !== "refineries" && entity !== "distances") {
    res.status(422).json({ error: "entity must be 'warehouses', 'customers', 'mines', 'stations', 'refineries', or 'distances'" });
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

  // distances (B4.1) is p-median-us only — see the /import route's comment.
  const entityIsPMedian = entity === "warehouses" || entity === "customers" || entity === "distances";
  const entityIsCoal = entity === "mines" || entity === "stations";
  const entityIsTwoEchelon = entity === "refineries" || entity === "customers";
  if (scenario.modelId === "p-median-us" && !entityIsPMedian) {
    res.status(422).json({ error: "p-median-us scenarios only support warehouses/customers/distances import" });
    return;
  }
  if (scenario.modelId === "transport-coal" && !entityIsCoal) {
    res.status(422).json({ error: "transport-coal scenarios only support mines/stations import" });
    return;
  }
  if (scenario.modelId === "two-echelon-gold-au" && !entityIsTwoEchelon) {
    res.status(422).json({ error: "two-echelon-gold-au scenarios only support refineries/customers import" });
    return;
  }
  if (scenario.modelId !== "p-median-us" && scenario.modelId !== "transport-coal" && scenario.modelId !== "two-echelon-gold-au") {
    res.status(422).json({ error: "Import is not supported for this model" });
    return;
  }

  // Always re-validate against the live scenario state — never trust a
  // client-held preview, which may be stale by the time apply is called.
  const inputs = scenario.inputs as { p?: number; warehouseOverrides?: Array<{ id: string; status: string; capacity?: number | null; demand?: number | null }>; customerOverrides?: Array<{ id: string; status: string; capacity?: number | null; demand?: number | null }>; mineCapacities?: Record<string, number>; stationDemands?: Record<string, number>; refineryOverrides?: Array<{ id: string; status: string }>; distanceOverrides?: Array<{ fromId: string; toId: string; distance: number }>; addedWarehouses?: Array<{ id: string }>; addedCustomers?: Array<{ id: string }> };
  const preview = parseAndValidateImport(entity as ImportEntity, csvText, inputs as Parameters<typeof parseAndValidateImport>[2], inputs.p ?? 0, scenario.modelId);

  if (applyMode === "all_or_nothing" && preview.errors.length > 0) {
    res.status(422).json({ error: "Import has errors; nothing was applied (all-or-nothing mode)", preview });
    return;
  }

  let nextInputs: Record<string, unknown>;
  if (entity === "mines" || entity === "stations") {
    const overrideKey = entity === "mines" ? "mineCapacities" : "stationDemands";
    const currentDict = inputs[overrideKey] ?? {};
    const nextDict = mergeChangesIntoDict(currentDict, preview.changes);
    nextInputs = { ...inputs, [overrideKey]: nextDict };
  } else if (entity === "distances") {
    const currentDistanceOverrides = inputs.distanceOverrides ?? [];
    const nextDistanceOverrides = mergeDistanceChangesIntoOverrides(currentDistanceOverrides, preview.changes);
    nextInputs = { ...inputs, distanceOverrides: nextDistanceOverrides };
  } else if (entity === "warehouses" || entity === "customers") {
    // B4.2 — ADD-classified changes (services/import.ts's changeType:"add",
    // unrecognized id + valid new-entity data) write into
    // addedWarehouses/addedCustomers instead of warehouseOverrides/
    // customerOverrides; ordinary UPDATE changes keep going through the
    // pre-existing override merge. Two different write targets from one
    // `preview.changes` array, split by changeType.
    const updateChanges = preview.changes.filter(c => c.changeType !== "add");
    const addChanges = preview.changes.filter(c => c.changeType === "add");

    const overrideKey = entity === "warehouses" ? "warehouseOverrides" : "customerOverrides";
    const currentOverrides = (inputs[overrideKey] ?? []) as Array<{ id: string; status: string; capacity?: number | null; demand?: number | null }>;
    const nextOverrides = mergeChangesIntoOverrides(entity, currentOverrides, updateChanges);

    const addedKey = entity === "warehouses" ? "addedWarehouses" : "addedCustomers";
    const currentAdded = (inputs[addedKey] ?? []) as Array<Record<string, unknown>>;
    const nextAdded = mergeAddChangesIntoAdded(entity, currentAdded, addChanges);

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
  } else {
    const currentOverrides = (inputs.refineryOverrides ?? []) as Array<{ id: string; status: string; capacity?: number | null; demand?: number | null }>;
    const nextOverrides = mergeChangesIntoOverrides("refineries", currentOverrides, preview.changes);
    nextInputs = { ...inputs, refineryOverrides: nextOverrides };
  }

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

router.post("/scenarios/:scenarioId/reset-to-baseline", async (req, res) => {
  const id = Number(req.params.scenarioId);
  const [scenario] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!)));
  if (!scenario) { res.status(404).json({ error: "Not found" }); return; }

  // D6.1's original reset only knew p-median-us's
  // warehouseOverrides/customerOverrides. transport-coal's override pair
  // (mineCapacities/stationDemands) and two-echelon-gold-au's
  // (refineryOverrides/customerOverrides) were added later — reset must
  // clear whichever pair belongs to the scenario's modelId. p-median-brazil
  // (and the newer model variants) carry no resettable overrides on this
  // route, so they still 422 — same boundary export/import enforce.
  const inputs = scenario.inputs as Record<string, unknown>;
  let nextInputs: Record<string, unknown>;
  if (scenario.modelId === "transport-coal") {
    nextInputs = { ...inputs, mineCapacities: {}, stationDemands: {} };
  } else if (scenario.modelId === "p-median-us") {
    nextInputs = { ...inputs, warehouseOverrides: [], customerOverrides: [] };
  } else if (scenario.modelId === "two-echelon-gold-au") {
    nextInputs = { ...inputs, refineryOverrides: [], customerOverrides: [] };
  } else {
    res.status(422).json({ error: "Reset to baseline is only supported for p-median-us, transport-coal, and two-echelon-gold-au scenarios" });
    return;
  }

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
    event: "scenario reset to baseline",
    properties: {
      scenario_id: id,
      model_id: scenario.modelId,
    },
  });

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
