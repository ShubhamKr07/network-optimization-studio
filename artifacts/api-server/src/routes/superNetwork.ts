import { Router, json, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, scenariosTable } from "@workspace/db";
import { SUPER_NETWORK_MAX_BYTES } from "@workspace/import-schema";
import { requireAuth } from "../middlewares/auth.js";
import { isModelLocked, respondLocked } from "../middlewares/lockedModel.js";
import { applyScenarioInputWrite } from "../services/scenarioInputWrite.js";
import { superNetworkDocSchema, mergeNetwork, docDuplicateIssues, toDocIssues } from "../services/superNetwork.js";
import { superInputsSchema } from "../validation/inputs/superInputs.js";
import { formatInputIssues, toInputIssues } from "../validation/formatInputIssues.js";
import { toApiScenario } from "./scenarios.js";

const router: IRouter = Router();
router.use(requireAuth);

// Owned AND super-model, else null: a non-owned or non-super scenario is indistinguishable from absent (404, hard rule #5).
async function loadOwnedSuper(id: number, userId: string) {
  const [row] = await db.select().from(scenariosTable)
    .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, userId)));
  return row && row.modelId === "super-model" ? row : null;
}

function bodyErrors(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === "entity.too.large") { res.status(413).json({ error: "payload_too_large" }); return; }
  if (type === "entity.parse.failed") { res.status(400).json({ error: "Request body is not valid JSON." }); return; }
  next(err);
}

router.post("/scenarios/:scenarioId/network/import", async (req: Request, res: Response, next: NextFunction) => {
  const id = Number(req.params.scenarioId);
  const row = Number.isInteger(id) ? await loadOwnedSuper(id, req.userId!) : null;
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (isModelLocked(row.modelId)) { respondLocked(res); return; }
  next();
}, json({ limit: SUPER_NETWORK_MAX_BYTES }), bodyErrors, async (req: Request, res: Response) => {
  const id = Number(req.params.scenarioId);
  const mode = req.query.mode; // spec §7.1: mode is a query parameter; the body IS the network document
  if (mode !== "replace" && mode !== "merge") { res.status(400).json({ error: "mode must be replace or merge" }); return; }
  const doc = superNetworkDocSchema.safeParse(req.body);
  if (!doc.success) { res.status(422).json({ error: formatInputIssues(doc.error.issues), issues: toInputIssues(doc.error.issues) }); return; }
  const dupIssues = docDuplicateIssues(doc.data);
  if (dupIssues.length > 0) {
    res.status(422).json({ error: dupIssues.map(i => `${i.path[0]} row ${Number(i.path[1]) + 1}: ${i.message}.`).join(" "), issues: dupIssues });
    return;
  }
  const outcome = await db.transaction(async tx => {
    const [cur] = await tx.select().from(scenariosTable)
      .where(and(eq(scenariosTable.id, id), eq(scenariosTable.userId, req.userId!))).for("update");
    if (!cur) return { kind: "not_found" as const };
    const { next, origin } = mergeNetwork(superInputsSchema.parse(cur.inputs), doc.data, mode);
    const written = await applyScenarioInputWrite(tx, { scenarioId: id, userId: req.userId!, nextInputs: next, roadDistances: mode === "replace" ? "clear" : "keep" });
    return written.kind === "invalid" ? { ...written, issues: toDocIssues(written.issues, origin) } : written;
  });
  if (outcome.kind === "not_found") { res.status(404).json({ error: "Not found" }); return; }
  if (outcome.kind === "invalid") {
    // error is built from the document-relative issues so it names the same rows `issues` does
    const error = outcome.issues.map(i => (i.path.length > 1 ? `${i.path[0]} row ${Number(i.path[1]) + 1}: ` : "") + i.message + ".").join(" ");
    res.status(422).json({ error, issues: outcome.issues });
    return;
  }
  res.json({ scenario: toApiScenario(outcome.row) });
});

router.get("/scenarios/:scenarioId/network/export", async (req: Request, res: Response) => {
  const id = Number(req.params.scenarioId);
  const row = Number.isInteger(id) ? await loadOwnedSuper(id, req.userId!) : null;
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (isModelLocked(row.modelId)) { respondLocked(res); return; }
  if (req.query.format !== "json") { res.status(400).json({ error: "format must be json" }); return; }
  const { roadDistances: _server, ...doc } = superInputsSchema.parse(row.inputs);
  res.json(doc);
});

export default router;
