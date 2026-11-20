// artifacts/api-server/src/routes/watbot.ts
import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db, scenariosTable, watbotConversationsTable, watbotMessagesTable, watbotReportsTable,
  type WatBotBlock, type WatBotContext, type WatBotMessageStatus,
} from "@workspace/db";
import { AskWatBotBody, CreateWatBotConversationBody, SubmitWatBotReportBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth.js";
import { isModelLocked, respondLocked } from "../middlewares/lockedModel.js";
import { getManifest } from "../registry/modelRegistry.js";
import { toApiScenario } from "./scenarios.js";
import { ResultEnvelopeSchema } from "../solver/resultEnvelope.js";
import { buildEffectiveFacilityCityLookup, buildOpenWarehouseRows } from "../services/templates.js";
import { getWatBotClient, watbotModel } from "../watbot/client.js";
import {
  answerQuestion, emptyAnswerResult, FAILED_NOTICE, REFUSED_NOTICE, STOPPED_NOTICE,
  type AnswerResult, type RoundGate,
} from "../watbot/engine.js";
import type { WatBotErrorCode } from "../watbot/errors.js";
import { bundleTokens, reservationUsd } from "../watbot/cost.js";
import { facilityNames } from "../watbot/facilities.js";
import { getPassage, loadBundle } from "../watbot/passages.js";
import {
  admitSpend, inflight, isAvailable, markAvailable, markProjectCapReached, markUnavailable,
  monthlyCapUsd, monthlySpendUsd, projectCapFlagged, reservedUsd, studentUsage, tryLockUser,
} from "../watbot/limits.js";

const router: IRouter = Router();
router.use(requireAuth);

const HISTORY_MESSAGES = 20;
const notFound = (res: Response) => res.status(404).json({ error: "Not found" });
const watbotError = (res: Response, status: number, error: WatBotErrorCode, extra: object = {}) => res.status(status).json({ error, ...extra });

async function ownedConversation(id: number, userId: string) {
  if (!Number.isInteger(id)) return undefined;
  const [row] = await db.select().from(watbotConversationsTable)
    .where(and(eq(watbotConversationsTable.id, id), eq(watbotConversationsTable.userId, userId)));
  return row;
}

// Status view of the cap: stored cost plus in-flight reservations (D21).
async function projectCapReached() {
  return projectCapFlagged() || (await monthlySpendUsd()) + reservedUsd() >= monthlyCapUsd();
}

const CLAIM_REMOVED_NOTICE = "One claim was removed — I couldn't support it with a course source.";
const noticeBlocks = (text: string): WatBotBlock[] => [{ text, citations: [] }];

router.get("/watbot/status", async (req, res) => {
  const usage = await studentUsage(req.userId!);
  res.json({ available: isAvailable(), studentRemaining: usage.remaining, studentResetAt: usage.resetAt?.toISOString() ?? null, projectCapReached: await projectCapReached() });
});

router.post("/watbot/conversations", async (req, res) => {
  const parsed = CreateWatBotConversationBody.safeParse(req.body);
  if (!parsed.success || !getManifest(parsed.data.modelId)) { res.status(400).json({ error: "Unknown model." }); return; }
  if (isModelLocked(parsed.data.modelId)) { respondLocked(res); return; }
  const [row] = await db.insert(watbotConversationsTable)
    .values({ userId: req.userId!, modelId: parsed.data.modelId, title: "New conversation" }).returning();
  res.status(201).json({ id: row!.id, modelId: row!.modelId, title: row!.title, updatedAt: row!.updatedAt.toISOString() });
});

router.get("/watbot/conversations", async (req, res) => {
  const modelId = typeof req.query.modelId === "string" ? req.query.modelId : undefined;
  const rows = await db.select().from(watbotConversationsTable)
    .where(and(eq(watbotConversationsTable.userId, req.userId!), modelId ? eq(watbotConversationsTable.modelId, modelId) : undefined))
    .orderBy(desc(watbotConversationsTable.updatedAt)).limit(50);
  res.json(rows.map((r) => ({ id: r.id, modelId: r.modelId, title: r.title, updatedAt: r.updatedAt.toISOString() })));
});

router.get("/watbot/conversations/:conversationId", async (req, res) => {
  const conv = await ownedConversation(Number(req.params.conversationId), req.userId!);
  if (!conv) { notFound(res); return; }
  const messages = await db.select().from(watbotMessagesTable)
    .where(eq(watbotMessagesTable.conversationId, conv.id)).orderBy(asc(watbotMessagesTable.createdAt), asc(watbotMessagesTable.id));
  res.json({ id: conv.id, modelId: conv.modelId, title: conv.title, updatedAt: conv.updatedAt.toISOString(),
    messages: messages.map((m) => ({ id: m.id, role: m.role, blocks: m.blocks, createdAt: m.createdAt.toISOString() })) });
});

router.delete("/watbot/conversations/:conversationId", async (req, res) => {
  const conv = await ownedConversation(Number(req.params.conversationId), req.userId!);
  if (!conv) { notFound(res); return; }
  await db.delete(watbotConversationsTable).where(eq(watbotConversationsTable.id, conv.id));
  res.status(204).end();
});

// D23 — a passage is served only to a student whose own tutor message cites it,
// so passage ids cannot be enumerated to download the licensed book.
router.get("/watbot/passages/:passageId", async (req, res) => {
  const id = Number(req.params.passageId);
  if (!Number.isInteger(id)) { notFound(res); return; }
  const citedBy = JSON.stringify([{ citations: [{ passageId: id }] }]);
  const [cited] = await db.select({ id: watbotMessagesTable.id }).from(watbotMessagesTable)
    .where(and(
      eq(watbotMessagesTable.userId, req.userId!), eq(watbotMessagesTable.role, "tutor"),
      sql`${watbotMessagesTable.blocks} @> ${citedBy}::jsonb`,
    )).limit(1);
  if (!cited) { notFound(res); return; }
  const p = await getPassage(id);
  if (!p) { notFound(res); return; }
  res.json(p);
});

router.post("/watbot/reports", async (req, res) => {
  const parsed = SubmitWatBotReportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid report." }); return; }
  const [msg] = await db.select().from(watbotMessagesTable)
    .where(and(eq(watbotMessagesTable.id, parsed.data.messageId), eq(watbotMessagesTable.userId, req.userId!)));
  if (!msg || msg.role !== "tutor") { notFound(res); return; }
  const [prev] = await db.select({ context: watbotMessagesTable.context }).from(watbotMessagesTable)
    .where(and(eq(watbotMessagesTable.conversationId, msg.conversationId), eq(watbotMessagesTable.role, "student")))
    .orderBy(desc(watbotMessagesTable.id)).limit(1);
  try {
    await db.insert(watbotReportsTable).values({
      userId: req.userId!, messageId: msg.id, reason: parsed.data.reason,
      note: parsed.data.note?.trim() || null, context: prev?.context ?? null,
      sources: msg.blocks.flatMap((b) => b.citations),
    });
  } catch { res.status(500).json({ error: "Could not store report." }); return; }
  res.status(201).end();
});

router.post("/watbot/conversations/:conversationId/messages", async (req, res) => {
  const parsed = AskWatBotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Questions must be 1 to 2000 characters." }); return; }
  const conv = await ownedConversation(Number(req.params.conversationId), req.userId!);
  if (!conv) { notFound(res); return; }
  if (isModelLocked(conv.modelId)) { respondLocked(res); return; }

  let context: WatBotContext | null = null;
  let contextScenarioInputs: unknown = undefined; // D20: the owned scenario's facilities join the value check
  if (parsed.data.context) {
    const { tab, scenarioId } = parsed.data.context;
    let summary = tab ? `Tab: ${tab}` : "";
    if (scenarioId != null) {
      const [row] = await db.select().from(scenariosTable)
        .where(and(eq(scenariosTable.id, scenarioId), eq(scenariosTable.userId, req.userId!)));
      if (!row || row.modelId !== conv.modelId) { notFound(res); return; }
      summary += ` · ${summarizeScenario(row)}`;
      contextScenarioInputs = row.inputs;
    }
    context = { tab: tab ?? null, scenarioId: scenarioId ?? null, summary };
  }

  // D21 — one question in flight per user. Everything below, the 24 h count,
  // the spend reservation and the student-row insert included, runs under this lock.
  const unlock = tryLockUser(req.userId!);
  if (!unlock) { watbotError(res, 409, "watbot_busy"); return; }
  let releaseSpend: (() => void) | null = null;
  try {
    const startedAt = Date.now();
    const question = parsed.data.question.trim();
    const history = await db.select().from(watbotMessagesTable)
      .where(eq(watbotMessagesTable.conversationId, conv.id)).orderBy(desc(watbotMessagesTable.id)).limit(HISTORY_MESSAGES);
    // Every question is logged (FR-42). Only "answered" rows count (FR-35, D22).
    const logStudent = async (status: WatBotMessageStatus) => {
      const [row] = await db.insert(watbotMessagesTable)
        .values({ conversationId: conv.id, userId: req.userId!, role: "student", blocks: [{ text: question, citations: [] }], context, status })
        .returning({ id: watbotMessagesTable.id });
      return row!.id;
    };
    const turnAway = async (status: WatBotMessageStatus, httpStatus: number, code: WatBotErrorCode, extra: object = {}) => {
      try { await logStudent(status); } catch { /* the log is best-effort; the student still gets the limit state */ }
      watbotError(res, httpStatus, code, extra);
    };

    if (!isAvailable()) { await turnAway("unavailable", 503, "watbot_unavailable"); return; }
    const usage = await studentUsage(req.userId!);
    if (usage.remaining === 0) { await turnAway("limit_reached", 429, "watbot_student_limit", { resetAt: usage.resetAt?.toISOString() ?? null }); return; }
    const manifest = getManifest(conv.modelId)!;
    const readingList = manifest.tutor?.readingList ?? [];
    const bundle = await loadBundle(readingList);
    const model = watbotModel();
    // D21 — stored cost is read first; the check against in-memory reservations and
    // the new reservation then happen synchronously inside admitSpend.
    const storedUsd = await monthlySpendUsd();
    releaseSpend = admitSpend(storedUsd, reservationUsd(model, bundleTokens(bundle)));
    if (!releaseSpend) { await turnAway("limit_reached", 429, "watbot_project_limit"); return; }

    // Inserted as "answered"; finalize() corrects it if the question never reached the model.
    let studentMessageId: number;
    try { studentMessageId = await logStudent("answered"); }
    catch { res.status(500).json({ error: "Could not save your question." }); return; }
    if (conv.title === "New conversation") {
      await db.update(watbotConversationsTable).set({ title: question.slice(0, 80) }).where(eq(watbotConversationsTable.id, conv.id));
    }

    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const send = (event: string, data: unknown) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const controller = new AbortController();
    res.on("close", () => controller.abort()); // Stop button or a dropped connection (D22)
    const onQueued = (position: number) => send("queued", { position });

    // D22 — the ONE place an answer ends, whatever the ending. Writes the usage row
    // before the outer finally releases the spend reservation.
    const finalize = async (r: AnswerResult) => {
      if (r.failure === "unavailable") markUnavailable();
      else if (r.failure === "project_limit") markProjectCapReached();
      else if (!r.stopped) markAvailable();

      let tutorMessageId: number | null = null;
      if (r.reachedModel) {
        // Counted: the model was used. The tutor row carries the observed usage, even with no blocks.
        if (r.messageType) {
          await db.update(watbotMessagesTable).set({ messageType: r.messageType }).where(eq(watbotMessagesTable.id, studentMessageId));
        }
        const [saved] = await db.insert(watbotMessagesTable).values({
          conversationId: conv.id, userId: req.userId!, role: "tutor", blocks: r.blocks, usage: r.usage,
          latencyMs: Date.now() - startedAt, gapTopic: r.gapTopic,
        }).returning({ id: watbotMessagesTable.id });
        tutorMessageId = saved!.id;
      } else {
        // Not counted: stopped before any round reached the model, or turned away by the provider.
        const status: WatBotMessageStatus = r.stopped ? "cancelled" : r.failure === "project_limit" ? "limit_reached" : "unavailable";
        await db.update(watbotMessagesTable).set({ status }).where(eq(watbotMessagesTable.id, studentMessageId));
      }

      const notices = [
        ...(r.claimsRemoved ? [CLAIM_REMOVED_NOTICE] : []),
        ...(r.refused ? [REFUSED_NOTICE] : []),
        ...(r.stopped ? [STOPPED_NOTICE] : []),
        ...(r.failed && !r.stopped && r.reachedModel ? [FAILED_NOTICE] : []),
      ];
      for (const text of notices) {
        await db.insert(watbotMessagesTable).values({ conversationId: conv.id, userId: req.userId!, role: "notice", blocks: noticeBlocks(text) });
      }
      await db.update(watbotConversationsTable).set({ updatedAt: new Date() }).where(eq(watbotConversationsTable.id, conv.id));

      if (r.stopped) return; // the client is gone
      if (r.refused) { send("error", { code: "watbot_refused" }); return; }
      if (r.failed) {
        const code: WatBotErrorCode = r.failure === "unavailable" ? "watbot_unavailable" : r.failure === "project_limit" ? "watbot_project_limit" : "watbot_failed";
        send("error", { code });
        return;
      }
      send("done", { messageId: tutorMessageId! });
    };

    let releaseSlot: (() => void) | undefined;
    try {
      let result: AnswerResult;
      try { releaseSlot = await inflight.acquire(onQueued, controller.signal); }
      catch { releaseSlot = undefined; } // the only rejection is an abort: stopped while queued
      if (!releaseSlot) {
        result = emptyAnswerResult(model, { stopped: true });
      } else {
        // D24 — a 429'd round gives its slot back and waits at the front of the queue.
        const gate: RoundGate = {
          requeue: async (retryAfterMs) => {
            releaseSlot?.();
            releaseSlot = undefined;
            releaseSlot = await inflight.requeue(retryAfterMs, onQueued, controller.signal);
          },
        };
        result = await answerQuestion({
          client: getWatBotClient(), model, bundle, readingList,
          fixedQuestions: manifest.tutor?.fixedQuestions.map((q) => q.text) ?? [],
          facilityNames: facilityNames(conv.modelId, contextScenarioInputs),
          // Questions that never reached the model stay out of its history.
          history: history.reverse().filter((m) => m.role !== "notice" && m.status === "answered")
            .map((m) => ({ role: m.role as "student" | "tutor", text: m.blocks.map((b) => b.text).join("\n\n") })),
          contextSummary: context?.summary ?? "", question, signal: controller.signal, gate,
          emit: (e) => send(e.type, e.type === "block" ? e.block : e.type === "searching" ? { query: e.query } : { kind: e.kind }),
        });
      }
      await finalize(result);
    } catch {
      // Only a failed DB write inside finalize() can land here (answerQuestion never
      // throws). No error binding: Drizzle errors carry user text (api-server CLAUDE.md).
      send("error", { code: "watbot_failed" });
    } finally {
      releaseSlot?.();
      res.end();
    }
  } finally {
    releaseSpend?.(); // D21/D22: runs after finalize() has written the usage row
    unlock();
  }
});

// Context summary is built server-side from the owned DB row — never client text.
// It carries what the student's own screen already shows (objective, open sites),
// which D14 lets WatBot discuss; anything not in it stays protected.
function summarizeScenario(row: typeof scenariosTable.$inferSelect): string {
  const s = toApiScenario(row);
  const parts = [`Scenario: ${s.name}`];
  const inputs = s.inputs as { p?: unknown } | null;
  if (typeof inputs?.p === "number") parts.push(`p = ${inputs.p}`);
  const result = s.result as { objective?: unknown; avgDistance?: unknown } | null;
  if (!result) parts.push("not solved yet");
  else {
    if (typeof result.objective === "number") parts.push(`objective ${result.objective}`);
    if (typeof result.avgDistance === "number") parts.push(`average distance ${result.avgDistance}`);
    // Same derivation as the openWarehouses export (routes/scenarios.ts), gated
    // on the manifest's outputGrids so a model with no open-site decision
    // (transport-coal) never lists its supply nodes as "open sites".
    const parsed = ResultEnvelopeSchema.safeParse(row.result);
    if (parsed.success && getManifest(row.modelId)?.capabilities.outputGrids.includes("openWarehouses")) {
      const cityById = buildEffectiveFacilityCityLookup(row.modelId, row.inputs as Parameters<typeof buildEffectiveFacilityCityLookup>[1]);
      const sites = buildOpenWarehouseRows(parsed.data, cityById).map((r) => r.city || r.warehouseId);
      if (sites.length) parts.push(`open sites: ${sites.join(", ")}`);
    }
    if (s.stale) parts.push("result is stale (inputs changed since solve)");
  }
  return parts.join(" · ");
}

export default router;
