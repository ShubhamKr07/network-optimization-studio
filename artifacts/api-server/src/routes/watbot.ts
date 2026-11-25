// artifacts/api-server/src/routes/watbot.ts
import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  db, scenariosTable, watbotConversationsTable, watbotFeedbackTable, watbotMessagesTable, watbotReportsTable,
  type WatBotContext, type WatBotMessageStatus, type WatBotMessageType,
} from "@workspace/db";
import { AskWatBotBody, CreateWatBotConversationBody, SubmitWatBotFeedbackBody, SubmitWatBotReportBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth.js";
import { isModelLocked, respondLocked } from "../middlewares/lockedModel.js";
import { getManifest, listModels } from "../registry/modelRegistry.js";
import { toApiScenario } from "./scenarios.js";
import { ResultEnvelopeSchema } from "../solver/resultEnvelope.js";
import { buildEffectiveFacilityCityLookup, buildOpenWarehouseRows } from "../services/templates.js";
import { getWatBotClient, watbotModel } from "../watbot/client.js";
import {
  answerQuestion, CLAIM_REMOVED_NOTICE, emptyAnswerResult, FAILED_NOTICE, REFUSED_NOTICE, STOPPED_NOTICE,
  type AnswerResult, type RoundGate,
} from "../watbot/engine.js";
import type { WatBotErrorCode } from "../watbot/errors.js";
import { isRepairReason, REPAIR_LABELS, REPAIR_RULES, repairQuestion, type WatBotRepairReason } from "../watbot/prompt.js";
import { bundleTokens, reservationUsd } from "../watbot/cost.js";
import { facilityNames } from "../watbot/facilities.js";
import { getPassage, loadBundle, maxBundleTokens } from "../watbot/passages.js";
import {
  admitSpend, inflight, isAvailable, markAvailable, markProjectCapReached, markUnavailable,
  monthlyCapUsd, monthlySpendUsd, projectCapFlagged, reservedUsd, studentUsage, tryLockUser,
} from "../watbot/limits.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
router.use(requireAuth);

const HISTORY_MESSAGES = 20;
const notFound = (res: Response) => res.status(404).json({ error: "Not found" });
const watbotError = (res: Response, status: number, error: WatBotErrorCode, extra: object = {}) => res.status(status).json({ error, ...extra });

const INT4_MAX = 2147483647; // ids past int4 make Postgres throw → 500; treat them as "not found"
const isId = (n: number) => Number.isInteger(n) && n > 0 && n <= INT4_MAX;

async function ownedConversation(id: number, userId: string) {
  if (!isId(id)) return undefined;
  const [row] = await db.select().from(watbotConversationsTable)
    .where(and(eq(watbotConversationsTable.id, id), eq(watbotConversationsTable.userId, userId)));
  return row;
}

// Status view of the cap: the same expression admitSpend uses, with the worst-case
// reservation (largest bundle across models), so "available" never precedes a 429 (D21).
async function projectCapReached() {
  const model = watbotModel();
  const worst = reservationUsd(model, await maxBundleTokens(listModels().map((m) => getManifest(m.id)?.tutor?.readingList ?? [])));
  return projectCapFlagged() || (await monthlySpendUsd()) + reservedUsd() + worst >= monthlyCapUsd();
}

type BuiltContext = { context: WatBotContext | null; shownFacts: string; contextScenarioInputs: unknown };

// Context summary is built server-side from the owned scenario row, never from client text (D20).
// dropMissingScenario: a re-answer whose source scenario is gone keeps the tab only (spec §4).
async function buildContext(tab: string | null, scenarioId: number | null, userId: string, modelId: string,
  { dropMissingScenario }: { dropMissingScenario: boolean }): Promise<BuiltContext | null> {
  let summary = tab ? `Tab: ${tab}` : "";
  let shownFacts = "";
  let contextScenarioInputs: unknown = undefined;
  let keptScenarioId: number | null = null;
  if (scenarioId != null) {
    const [row] = await db.select().from(scenariosTable)
      .where(and(eq(scenariosTable.id, scenarioId), eq(scenariosTable.userId, userId)));
    if (row && row.modelId === modelId) {
      const s = summarizeScenario(row);
      summary += ` · ${s.summary}`;
      shownFacts = s.facts;
      contextScenarioInputs = row.inputs;
      keptScenarioId = scenarioId;
    } else if (!dropMissingScenario) return null; // caller answers 404
  }
  return { context: { tab, scenarioId: keptScenarioId, summary }, shownFacts, contextScenarioInputs };
}
// F8 — under the per-user lock nothing else of this student's is in flight, so a claim is
// live only if its re-answer produced a tutor row. A claim with none after it died and may be retaken.
async function claimIsLive(repairMessageId: number | null): Promise<boolean> {
  if (repairMessageId == null) return false;
  const [claimed] = await db.select({ conversationId: watbotMessagesTable.conversationId }).from(watbotMessagesTable)
    .where(eq(watbotMessagesTable.id, repairMessageId));
  if (!claimed) return false;
  const [after] = await db.select({ id: watbotMessagesTable.id }).from(watbotMessagesTable)
    .where(and(eq(watbotMessagesTable.conversationId, claimed.conversationId), eq(watbotMessagesTable.role, "tutor"),
      gt(watbotMessagesTable.id, repairMessageId))).limit(1);
  return !!after;
}

// What a re-answer resends (spec §3). The question is the ROOT question, followed back through
// earlier re-answers. excludeType and context come from the NEAREST answered student row, the
// one whose answer is being repaired (a re-answer row copies its source's context).
async function repairSource(conversationId: number, tutorId: number) {
  let beforeId = tutorId;
  let nearest: { messageType: WatBotMessageType | null; context: WatBotContext | null } | null = null;
  for (let hop = 0; hop < HISTORY_MESSAGES; hop++) {
    const [row] = await db.select().from(watbotMessagesTable)
      .where(and(eq(watbotMessagesTable.conversationId, conversationId), eq(watbotMessagesTable.role, "student"),
        eq(watbotMessagesTable.status, "answered"), lt(watbotMessagesTable.id, beforeId)))
      .orderBy(desc(watbotMessagesTable.id)).limit(1);
    if (!row) return null;
    nearest ??= { messageType: row.messageType ?? null, context: row.context ?? null };
    const [prior] = await db.select({ messageId: watbotFeedbackTable.messageId }).from(watbotFeedbackTable)
      .where(eq(watbotFeedbackTable.repairMessageId, row.id));
    if (!prior) return { question: row.blocks.map((b) => b.text).join("\n\n"), ...nearest };
    beforeId = prior.messageId;
  }
  return null;
}

// WATBOT-FB — one rating per tutor answer, upserted until a live re-answer claims it (F7, F8).
router.post("/watbot/conversations/:conversationId/feedback", async (req, res) => {
  const parsed = SubmitWatBotFeedbackBody.safeParse(req.body);
  const d = parsed.success ? parsed.data : null;
  const note = d?.note?.trim() || null;
  if (!d || (d.helped ? d.reason !== undefined : d.reason === undefined) || (note !== null && d.reason !== "other")) {
    res.status(400).json({ error: "Invalid feedback." }); return;
  }
  const conv = await ownedConversation(Number(req.params.conversationId), req.userId!);
  if (!conv) { notFound(res); return; }
  if (isModelLocked(conv.modelId)) { respondLocked(res); return; }
  const [msg] = await db.select({ id: watbotMessagesTable.id }).from(watbotMessagesTable)
    .where(and(eq(watbotMessagesTable.id, d.messageId), eq(watbotMessagesTable.conversationId, conv.id), eq(watbotMessagesTable.role, "tutor")));
  if (!msg) { notFound(res); return; }
  // F7 — the same per-user lock as a question, so a rating can't change under an in-flight re-answer.
  const unlock = tryLockUser(req.userId!);
  if (!unlock) { watbotError(res, 409, "watbot_busy"); return; }
  try {
    const [existing] = await db.select({ repairMessageId: watbotFeedbackTable.repairMessageId }).from(watbotFeedbackTable)
      .where(eq(watbotFeedbackTable.messageId, msg.id));
    if (await claimIsLive(existing?.repairMessageId ?? null)) { watbotError(res, 409, "watbot_feedback_locked"); return; }
    const reason = d.reason ?? null;
    let id: number;
    // No error binding: the Drizzle error carries the note (api-server CLAUDE.md).
    try {
      const [row] = await db.insert(watbotFeedbackTable)
        .values({ userId: req.userId!, conversationId: conv.id, messageId: msg.id, helped: d.helped, reason, note })
        .onConflictDoUpdate({ target: watbotFeedbackTable.messageId, set: { helped: d.helped, reason, note, repairMessageId: null, updatedAt: new Date() } })
        .returning({ id: watbotFeedbackTable.id });
      id = row!.id;
    } catch { res.status(500).json({ error: "Could not store feedback." }); return; }
    res.status(201).json({ id, repairLabel: isRepairReason(reason) ? REPAIR_LABELS[reason] : null });
  } finally {
    unlock();
  }
});

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
  if (!isId(id)) { notFound(res); return; }
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
    .where(and(eq(watbotMessagesTable.conversationId, msg.conversationId), eq(watbotMessagesTable.role, "student"), lt(watbotMessagesTable.id, msg.id)))
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

  // D20: context summary and facts are server-derived only; the student-controlled tab and scenario name stay out of the value check.
  let built: BuiltContext = { context: null, shownFacts: "", contextScenarioInputs: undefined };
  if (parsed.data.context && parsed.data.repairOf == null) {
    const b = await buildContext(parsed.data.context.tab ?? null, parsed.data.context.scenarioId ?? null, req.userId!, conv.modelId, { dropMissingScenario: false });
    if (!b) { notFound(res); return; }
    built = b;
  }

  // D21 — one question in flight per user. Everything below, the 24 h count,
  // the spend reservation and the student-row insert included, runs under this lock.
  const unlock = tryLockUser(req.userId!);
  if (!unlock) { watbotError(res, 409, "watbot_busy"); return; }
  // Attached before the first await so a disconnect during admission aborts too.
  const controller = new AbortController();
  res.on("close", () => controller.abort()); // Stop button or a dropped connection (D22)
  let releaseSpend: (() => void) | null = null;
  try {
    // WATBOT-FB F7/F10 — resolved under the per-user lock; the client's context is ignored.
    let repair: { feedbackId: number; reason: WatBotRepairReason; claimedBy: number | null; question: string; excludeType: WatBotMessageType | null } | null = null;
    if (parsed.data.repairOf != null) {
      const [fb] = await db.select().from(watbotFeedbackTable).where(and(eq(watbotFeedbackTable.id, parsed.data.repairOf),
        eq(watbotFeedbackTable.userId, req.userId!), eq(watbotFeedbackTable.conversationId, conv.id)));
      if (!fb || fb.helped || !isRepairReason(fb.reason)) { notFound(res); return; }
      if (await claimIsLive(fb.repairMessageId)) { watbotError(res, 409, "watbot_feedback_locked"); return; }
      const [latest] = await db.select({ id: watbotMessagesTable.id }).from(watbotMessagesTable)
        .where(and(eq(watbotMessagesTable.conversationId, conv.id), eq(watbotMessagesTable.role, "tutor")))
        .orderBy(desc(watbotMessagesTable.id)).limit(1);
      const source = latest?.id === fb.messageId ? await repairSource(conv.id, fb.messageId) : null;
      if (!source) { notFound(res); return; }
      const b = await buildContext(source.context?.tab ?? null, source.context?.scenarioId ?? null, req.userId!, conv.modelId, { dropMissingScenario: true });
      built = b!; // never null with dropMissingScenario
      repair = { feedbackId: fb.id, reason: fb.reason, claimedBy: fb.repairMessageId, question: source.question,
        excludeType: fb.reason === "not_what_i_asked" ? source.messageType : null };
    }
    const startedAt = Date.now();
    // A re-answer stores its ↻ label, and sends the root question plus a note to the model.
    const question = repair ? repairQuestion(repair.question, repair.reason) : parsed.data.question.trim();
    const storedText = repair ? REPAIR_LABELS[repair.reason] : question;
    const history = await db.select().from(watbotMessagesTable)
      .where(eq(watbotMessagesTable.conversationId, conv.id)).orderBy(desc(watbotMessagesTable.id)).limit(HISTORY_MESSAGES);
    // Every question is logged (FR-42). Only "answered" rows count (FR-35, D22).
    const logStudent = async (status: WatBotMessageStatus) => {
      const [row] = await db.insert(watbotMessagesTable)
        .values({ conversationId: conv.id, userId: req.userId!, role: "student", blocks: [{ text: storedText, citations: [] }], context: built.context, status })
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
    if (repair) {
      // Compare-and-set against the value read above: a concurrent claim, or one taken since, makes this a no-op.
      const claimed = await db.update(watbotFeedbackTable).set({ repairMessageId: studentMessageId, updatedAt: new Date() })
        .where(and(eq(watbotFeedbackTable.id, repair.feedbackId),
          repair.claimedBy == null ? isNull(watbotFeedbackTable.repairMessageId) : eq(watbotFeedbackTable.repairMessageId, repair.claimedBy)))
        .returning({ id: watbotFeedbackTable.id });
      if (!claimed.length) {
        await db.update(watbotMessagesTable).set({ status: "cancelled" }).where(eq(watbotMessagesTable.id, studentMessageId));
        watbotError(res, 409, "watbot_feedback_locked"); return;
      }
    }
    if (conv.title === "New conversation") {
      // No error binding: the Drizzle error carries the question text (api-server CLAUDE.md).
      try { await db.update(watbotConversationsTable).set({ title: question.slice(0, 80) }).where(eq(watbotConversationsTable.id, conv.id)); }
      catch { /* cosmetic */ }
    }

    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const send = (event: string, data: unknown) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
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
        logger.info({ claimsRemoved: r.claimsRemoved, valuesBlocked: r.valuesBlocked }, "WatBot: answer saved"); // WQF-A1: counts only
      } else {
        // Not counted: stopped before any round reached the model, or turned away by the provider.
        const status: WatBotMessageStatus = r.stopped ? "cancelled" : r.failure === "project_limit" ? "limit_reached" : "unavailable";
        await db.update(watbotMessagesTable).set({ status }).where(eq(watbotMessagesTable.id, studentMessageId));
      }

      const notices = [
        ...(r.claimsRemoved || r.valuesBlocked ? [CLAIM_REMOVED_NOTICE] : []),
        ...(r.refused ? [REFUSED_NOTICE] : []),
        ...(r.stopped ? [STOPPED_NOTICE] : []),
        ...(r.failure && !r.stopped && r.reachedModel ? [FAILED_NOTICE] : []),
      ];
      for (const text of notices) {
        await db.insert(watbotMessagesTable).values({ conversationId: conv.id, userId: req.userId!, role: "notice", blocks: [{ text, citations: [] }] });
      }
      await db.update(watbotConversationsTable).set({ updatedAt: new Date() }).where(eq(watbotConversationsTable.id, conv.id));

      if (r.stopped) return; // the client is gone
      if (r.refused) { send("error", { code: "watbot_refused" }); return; }
      if (r.failure) {
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
          facilityNames: facilityNames(conv.modelId, built.contextScenarioInputs),
          // Questions that never reached the model stay out of its history.
          history: history.reverse().filter((m) => m.role !== "notice" && m.status === "answered")
            .map((m) => ({ role: m.role as "student" | "tutor", text: m.blocks.map((b) => b.text).join("\n\n") })),
          contextSummary: built.context?.summary ?? "", shownFacts: built.shownFacts, question, signal: controller.signal, gate,
          repair: repair ? { rule: REPAIR_RULES[repair.reason], excludeType: repair.excludeType } : undefined,
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
function summarizeScenario(row: typeof scenariosTable.$inferSelect): { summary: string; facts: string } {
  const s = toApiScenario(row);
  const inputs = s.inputs as { p?: unknown } | null;
  const head = [`Scenario: ${s.name}`, ...(typeof inputs?.p === "number" ? [`p = ${inputs.p}`] : [])];
  const parts: string[] = [];
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
  return { summary: [...head, ...parts].join(" · "), facts: parts.join(" · ") };
}

export default router;
