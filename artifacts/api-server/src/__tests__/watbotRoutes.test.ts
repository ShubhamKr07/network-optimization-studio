// artifacts/api-server/src/__tests__/watbotRoutes.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";
import request from "supertest";
import type { AddressInfo } from "node:net";
import { and, asc, desc, eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { db, usersTable, coursePassagesTable, scenariosTable, watbotConversationsTable, watbotMessagesTable, watbotReportsTable, watbotFeedbackTable } from "@workspace/db";
import app from "../app.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";
import { setWatBotClientForTests, type WatBotClient, type WatBotStream } from "../watbot/client.js";
import {
  resetWatBotLimitsForTests, markUnavailable, studentUsage, STUDENT_DAILY_LIMIT, reservedUsd, isUserLocked,
  inflight, isAvailable, monthlySpendUsd,
} from "../watbot/limits.js";
import { WATBOT_ERROR_CODES } from "../watbot/errors.js";
import { REPAIR_LABELS } from "../watbot/prompt.js";
import { FAILED_NOTICE, STOPPED_NOTICE, setTransientBackoffForTests } from "../watbot/engine.js";
import { SUPER_DEFAULT_INPUTS } from "../validation/inputs/superInputs.js";

const userIds: string[] = [];
afterAll(async () => {
  setWatBotClientForTests(null);
  setTransientBackoffForTests(null);
  for (const id of userIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});
// Zero transient-retry backoff (D24) so 5xx/529 tests don't sleep 2 s each.
beforeEach(() => { resetWatBotLimitsForTests(); resetLoginRateLimiterForTests(); setTransientBackoffForTests([0, 0]); });

async function registerAndGetCookie(): Promise<string> {
  const email = `watbot-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  userIds.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}

// Like the real API, rejects any empty text block in the request (a 400 there), so an
// empty replayed history turn can never pass silently here.
function useClient(c: WatBotClient | null) {
  if (!c) { setWatBotClientForTests(null); return; }
  setWatBotClientForTests({ messages: { stream(params, opts) {
    const blocks = params.messages.flatMap((m): Anthropic.ContentBlockParam[] => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content));
    if (blocks.some((b) => b.type === "text" && !b.text.trim())) throw new Error("400 messages: text content blocks must be non-empty");
    return c.messages.stream(params, opts);
  } } });
}

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

const failing = (err: unknown): WatBotStream => ({ async *[Symbol.asyncIterator]() { throw err; }, finalMessage: async () => { throw err; } });
const textEvents = (index: number, text: string) => [
  { type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } },
  { type: "content_block_delta", index, delta: { type: "text_delta", text } },
  { type: "content_block_stop", index },
] as Anthropic.RawMessageStreamEvent[];

// Plays the answer as one text block. With `type`, round 1 first calls
// record_message_type (as the system prompt requires), round 2 answers.
// `delayMs` holds each round open so concurrent requests overlap; `gate` holds it until the test resolves it.
function scriptedClient(text: string, opts: { type?: string; gap?: { topic: string; nearestCoveredTopic: string }; delayMs?: number; gate?: Promise<void> } = {}): WatBotClient {
  const tools = [
    ...(opts.type ? [{ type: "tool_use", id: "rt", name: "record_message_type", input: { type: opts.type } }] : []),
    ...(opts.gap ? [{ type: "tool_use", id: "lg", name: "log_gap", input: opts.gap }] : []),
  ];
  let round = 0;
  return {
    messages: {
      stream() {
        const toolRound = round++ === 0 && tools.length > 0;
        const events = (toolRound ? [] : [
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
          { type: "content_block_stop", index: 0 },
        ]) as Anthropic.RawMessageStreamEvent[];
        return {
          async *[Symbol.asyncIterator]() {
            if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
            if (opts.gate) await opts.gate; // the test releases the round after its mid-flight assertions
            yield* events;
          },
          finalMessage: async () => (toolRound
            ? { stop_reason: "tool_use", content: tools, usage: USAGE }
            : { stop_reason: "end_turn", content: [], usage: USAGE }) as unknown as Anthropic.Message,
        };
      },
    },
  };
}

const lastUserId = () => userIds[userIds.length - 1]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const messageStartEvent = { type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never as Anthropic.RawMessageStreamEvent;
const rows = (conversationId: number) =>
  db.select().from(watbotMessagesTable).where(eq(watbotMessagesTable.conversationId, conversationId)).orderBy(asc(watbotMessagesTable.id));
const abortError = () => Object.assign(new Error("Request was aborted."), { name: "AbortError" });
// Streams `events`, then fails with `error` (or, with no error, waits until aborted).
const scriptedStream = (events: Anthropic.RawMessageStreamEvent[], error?: unknown, signal?: AbortSignal): WatBotStream => ({
  async *[Symbol.asyncIterator]() {
    for (const e of events) yield e;
    if (error) throw error;
    await new Promise((_, reject) => {
      if (signal?.aborted) reject(abortError());
      signal?.addEventListener("abort", () => reject(abortError()));
    });
  },
  finalMessage: async () => { throw error ?? abortError(); },
});

// Asks over a real socket, aborts (the student's Stop) once `untilEvent` has arrived,
// then waits until the route has finalised: the lock is released only after the
// usage row and notices are written (D22).
async function askThenStop(cookie: string, userId: string, conversationId: number, untilEvent: string) {
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const ac = new AbortController();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/watbot/conversations/${conversationId}/messages`, {
      method: "POST", signal: ac.signal, headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ question: "Why?", context: null }),
    });
    const reader = res.body!.getReader();
    let seen = "";
    while (!seen.includes(`event: ${untilEvent}`)) seen += new TextDecoder().decode((await reader.read()).value);
    ac.abort();
    for (let i = 0; i < 100 && isUserLocked(userId); i++) await sleep(50);
    return { seen, rows: await rows(conversationId) };
  } finally {
    server.close();
  }
}

// Holds every in-flight slot, so the next question has to queue.
async function fillInflight(): Promise<() => void> {
  const releases: (() => void)[] = [];
  const ac = new AbortController();
  for (;;) {
    let queued = false;
    const p = inflight.acquire(() => { queued = true; }, ac.signal);
    if (queued) { ac.abort(); await p.catch(() => undefined); break; }
    releases.push(await p);
  }
  return () => releases.forEach((release) => release());
}

async function newConversation(cookie: string, modelId = "p-median-us") {
  const res = await request(app).post("/api/watbot/conversations").set("Cookie", cookie).send({ modelId });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("watbot routes", () => {
  it("requires auth", async () => {
    expect((await request(app).get("/api/watbot/status")).status).toBe(401);
  });

  it("streams an answer as SSE and persists student + tutor messages with type, status, latency and usage", async () => {
    useClient(scriptedClient("What would change with p = 1?", { type: "concept_question" }));
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie)
      .send({ question: "Why these sites?", context: null });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.text).toContain("event: block");
    expect(res.text).toContain("event: done");
    expect(res.text).not.toContain("concept_question"); // the type is never sent to the student
    const rows = await db.select().from(watbotMessagesTable).where(eq(watbotMessagesTable.conversationId, id));
    expect(rows.map((r) => r.role)).toEqual(["student", "tutor"]);
    expect(rows[0]!).toMatchObject({ status: "answered", messageType: "concept_question" });
    expect(rows[1]!.usage?.costUsd).toBeGreaterThan(0);
    expect(rows[1]!.usage?.inputTokens).toBe(20); // summed over both rounds
    expect(rows[1]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(rows[1]!.gapTopic).toBeNull();
    expect(reservedUsd()).toBe(0);                 // D21: released on completion
    expect(isUserLocked(lastUserId())).toBe(false);
  });

  it("leaves message_type null when the model skips record_message_type, and stores a logged gap on the tutor row", async () => {
    useClient(scriptedClient("The materials don't cover that; want to look at outbound costs?", { gap: { topic: "rail rates", nearestCoveredTopic: "outbound costs" } }));
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "Rail rates?", context: null });
    expect(res.text).toContain('"kind":"gap_logged"');
    const [student, tutor] = await db.select().from(watbotMessagesTable).where(eq(watbotMessagesTable.conversationId, id)).orderBy(watbotMessagesTable.id);
    expect(student!.messageType).toBeNull();
    expect(tutor!.gapTopic).toBe("rail rates (nearest covered: outbound costs)");
  });

  it("404s another user's conversation on every route (no enumeration)", async () => {
    const owner = await registerAndGetCookie();
    const other = await registerAndGetCookie();
    const id = await newConversation(owner);
    expect((await request(app).get(`/api/watbot/conversations/${id}`).set("Cookie", other)).status).toBe(404);
    expect((await request(app).delete(`/api/watbot/conversations/${id}`).set("Cookie", other)).status).toBe(404);
    expect((await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", other).send({ question: "q", context: null })).status).toBe(404);
  });

  it("404s a context scenario the student does not own", async () => {
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie)
      .send({ question: "q", context: { tab: "output-map", scenarioId: 2147483646 } });
    expect(res.status).toBe(404);
  });

  it("rejects questions over 2,000 characters", async () => {
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie)
      .send({ question: "x".repeat(2001), context: null });
    expect(res.status).toBe(400);
  });

  it("returns 503 watbot_unavailable while the service flag is set, logging the question as unavailable", async () => {
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    markUnavailable();
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("watbot_unavailable");
    const rows = await db.select().from(watbotMessagesTable).where(eq(watbotMessagesTable.conversationId, id));
    expect(rows.map((r) => [r.role, r.status])).toEqual([["student", "unavailable"]]);
    expect((await studentUsage(lastUserId())).used).toBe(0);
  });

  it("turns away a student at the limit with 429, logging the question as limit_reached without counting it", async () => {
    const cookie = await registerAndGetCookie();
    const userId = lastUserId();
    const id = await newConversation(cookie);
    const [conv] = await db.select().from(watbotConversationsTable).where(eq(watbotConversationsTable.id, id));
    await db.insert(watbotMessagesTable).values(Array.from({ length: STUDENT_DAILY_LIMIT }, () =>
      ({ conversationId: conv!.id, userId, role: "student", blocks: [], messageType: "off_topic" as const })));
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "one more", context: null });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("watbot_student_limit");
    const [last] = await db.select().from(watbotMessagesTable).where(eq(watbotMessagesTable.conversationId, id)).orderBy(desc(watbotMessagesTable.id)).limit(1);
    expect(last!.status).toBe("limit_reached");
    expect((await studentUsage(userId)).used).toBe(STUDENT_DAILY_LIMIT);
  });

  it("stores a report only against the reporter's own message", async () => {
    useClient(scriptedClient("Short."));
    const owner = await registerAndGetCookie();
    const id = await newConversation(owner);
    await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", owner).send({ question: "q", context: null });
    const [tutor] = await db.select().from(watbotMessagesTable)
      .where(and(eq(watbotMessagesTable.conversationId, id), eq(watbotMessagesTable.role, "tutor")));
    const other = await registerAndGetCookie();
    expect((await request(app).post("/api/watbot/reports").set("Cookie", other).send({ messageId: tutor!.id, reason: "other" })).status).toBe(404);
    expect((await request(app).post("/api/watbot/reports").set("Cookie", owner).send({ messageId: tutor!.id, reason: "other", note: "n" })).status).toBe(201);
    expect(await db.select().from(watbotReportsTable).where(eq(watbotReportsTable.messageId, tutor!.id))).toHaveLength(1);
  });

  it("status reports full remaining quota for a new student", async () => {
    const cookie = await registerAndGetCookie();
    const res = await request(app).get("/api/watbot/status").set("Cookie", cookie);
    expect(res.body).toMatchObject({ available: true, studentRemaining: 50, studentResetAt: null, projectCapReached: false });
  });

  // D21 — atomic admission.
  it("admits exactly one of two simultaneous questions at 49 counted messages; the other gets 409 watbot_busy", async () => {
    useClient(scriptedClient("What would change with p = 1?", { delayMs: 300 }));
    const cookie = await registerAndGetCookie();
    const userId = lastUserId();
    const id = await newConversation(cookie);
    await db.insert(watbotMessagesTable).values(Array.from({ length: STUDENT_DAILY_LIMIT - 1 }, () =>
      ({ conversationId: id, userId, role: "student", blocks: [] })));
    const ask = () => request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
    const [a, b] = await Promise.all([ask(), ask()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error).toBe("watbot_busy");
    expect((await studentUsage(userId)).used).toBe(STUDENT_DAILY_LIMIT); // never 51
    // The lock was released: a third question now meets the limit, not the lock.
    const c = await ask();
    expect(c.status).toBe(429);
    expect(c.body.error).toBe("watbot_student_limit");
    expect(reservedUsd()).toBe(0);
  });

  it("a failure before any usage leaves the question uncounted, with no tutor row, and releases the lock and reservation", async () => {
    useClient({ messages: { stream: () => failing(new Error("boom")) } });
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
    expect(res.text).toContain('"code":"watbot_failed"');
    expect((await rows(id)).map((r) => [r.role, r.status])).toEqual([["student", "unavailable"]]);
    expect((await studentUsage(lastUserId())).used).toBe(0);
    expect(reservedUsd()).toBe(0);
    expect(isUserLocked(lastUserId())).toBe(false);
  });

  // D24 — the route sets the unavailable flag only on the engine's FINAL failure.
  it("one 529 followed by success answers normally and does not set the unavailable flag", async () => {
    const answer = scriptedClient("What would change with p = 1?");
    let call = 0;
    useClient({ messages: { stream: (params, opts) => call++ === 0
      ? failing(Anthropic.APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "overloaded" } }, "overloaded", new Headers()))
      : answer.messages.stream(params, opts) } });
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
    expect(res.text).toContain("event: done");
    expect(res.text).not.toContain("event: queued"); // an in-round retry, not a re-queue
    expect(call).toBe(2);
    expect(isAvailable()).toBe(true);
    expect((await rows(id)).map((r) => [r.role, r.status])).toEqual([["student", "answered"], ["tutor", "answered"]]);
  });

  it("three consecutive 529s before any usage set the unavailable flag and leave the question uncounted", async () => {
    let calls = 0;
    useClient({ messages: { stream: () => { calls++; return failing(Anthropic.APIError.generate(529,
      { type: "error", error: { type: "overloaded_error", message: "overloaded" } }, "overloaded", new Headers())); } } });
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
    expect(calls).toBe(3);
    expect(res.text).toContain('"code":"watbot_unavailable"');
    expect(isAvailable()).toBe(false);
    expect((await rows(id)).map((r) => [r.role, r.status])).toEqual([["student", "unavailable"]]);
  });

  it("a missing-API-key error sets the unavailable flag", async () => {
    useClient({ messages: { stream: () => failing(new Error("Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set.")) } });
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
    expect(res.text).toContain('"code":"watbot_unavailable"');
    expect(isAvailable()).toBe(false);
  });

  // D22 — provider failure after the model was reached: usage and blocks are kept, and the question counts.
  it("a 529 after message_start (on every attempt) saves the usage, keeps the student row answered and adds the cost to the month", async () => {
    useClient({ messages: { stream: () => scriptedStream([messageStartEvent],
      Anthropic.APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "overloaded" } }, "overloaded", new Headers())) } });
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const before = await monthlySpendUsd();
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
    expect(res.text).toContain('"code":"watbot_unavailable"');
    const saved = await rows(id);
    expect(saved.map((r) => [r.role, r.status])).toEqual([["student", "answered"], ["tutor", "answered"], ["notice", "answered"]]);
    expect(saved[1]!.blocks).toEqual([]);
    expect(saved[1]!.usage).toMatchObject({ inputTokens: 300, estimated: true }); // 3 billed attempts (1 + 2 retries)
    expect(saved[2]!.blocks[0]!.text).toBe(FAILED_NOTICE);
    expect((await monthlySpendUsd()) - before).toBeCloseTo(saved[1]!.usage!.costUsd, 9);
    expect((await studentUsage(lastUserId())).used).toBe(1);
    expect(isAvailable()).toBe(false); // retries exhausted → the final failure sets the flag
    expect(reservedUsd()).toBe(0);
  });

  it("a dropped connection after a forwarded block saves that block and its usage", async () => {
    useClient({ messages: { stream: () => scriptedStream([messageStartEvent, ...textEvents(0, "What would change with p = 1?")],
      new Anthropic.APIConnectionError({ message: "socket hang up" })) } });
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
    expect(res.text).toContain("event: block");
    expect(res.text).toContain('"code":"watbot_unavailable"');
    const saved = await rows(id);
    expect(saved[0]!.status).toBe("answered");
    expect(saved[1]!.blocks.map((b) => b.text)).toEqual(["What would change with p = 1?"]);
    expect(saved[1]!.usage!.costUsd).toBeGreaterThan(0);
  });

  // D24 — a 429 after a forwarded block is not re-queued.
  it("a 429 after a forwarded block shows the block once and ends through the failure path", async () => {
    let calls = 0;
    useClient({ messages: { stream: () => { calls++; return scriptedStream([messageStartEvent, ...textEvents(0, "What would change with p = 1?")],
      Anthropic.APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers({ "retry-after": "1" }))); } } });
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
    expect(res.text.split("What would change with p = 1?")).toHaveLength(2); // exactly one occurrence
    expect(res.text).not.toContain("event: queued");
    expect(res.text).toContain('"code":"watbot_failed"');
    expect(calls).toBe(1);
    const saved = await rows(id);
    expect(saved.map((r) => r.role)).toEqual(["student", "tutor", "notice"]);
    expect(saved[0]!.status).toBe("answered");
  });

  // D24 — a 429 goes back to the queue instead of failing.
  it("re-queues a 429, tells the student they are queued, then answers", async () => {
    const answer = scriptedClient("What would change with p = 1?");
    let call = 0;
    useClient({ messages: { stream: (params, opts) => call++ === 0
      ? failing(Anthropic.APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers({ "retry-after": "1" })))
      : answer.messages.stream(params, opts) } });
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
    expect(res.text).toContain('event: queued\ndata: {"position":1}');
    expect(res.text).toContain("event: done");
    expect(call).toBe(2);
    expect(reservedUsd()).toBe(0);
  });

  // D22 — Stop saves the forwarded part; the buffered block is not saved.
  it("Stop mid-answer saves forwarded blocks, usage and an 'Answer stopped' notice; the student row stays answered", async () => {
    useClient({ messages: { stream: (_params, opts) => scriptedStream([
      messageStartEvent,
      ...textEvents(0, "What would change with p = 1?"),
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "", citations: null } } as never,
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Buffered and never sent" } } as never,
    ], undefined, opts?.signal) } });
    const cookie = await registerAndGetCookie();
    const userId = lastUserId();
    const id = await newConversation(cookie);
    const { rows: saved } = await askThenStop(cookie, userId, id, "block");
    expect(saved.map((r) => r.role)).toEqual(["student", "tutor", "notice"]);
    expect(saved[0]!.status).toBe("answered");
    expect(saved[1]!.blocks.map((b) => b.text)).toEqual(["What would change with p = 1?"]);
    expect(saved[1]!.usage).toMatchObject({ inputTokens: 100, estimated: true });
    expect(saved[1]!.usage!.costUsd).toBeGreaterThan(0);
    expect(saved[2]!.blocks[0]!.text).toBe(STOPPED_NOTICE);
    expect(JSON.stringify(saved)).not.toContain("Buffered and never sent");
    expect((await studentUsage(userId)).used).toBe(1);
    expect(reservedUsd()).toBe(0);
    expect(isUserLocked(userId)).toBe(false);
  });

  it("Stop while waiting for the first slot logs the question as cancelled, uncounted, with the notice", async () => {
    useClient(scriptedClient("never reached"));
    const releaseAll = await fillInflight();
    try {
      const cookie = await registerAndGetCookie();
      const userId = lastUserId();
      const id = await newConversation(cookie);
      const { rows: saved } = await askThenStop(cookie, userId, id, "queued");
      expect(saved.map((r) => [r.role, r.status])).toEqual([["student", "cancelled"], ["notice", "answered"]]);
      expect(saved[1]!.blocks[0]!.text).toBe(STOPPED_NOTICE);
      expect((await studentUsage(userId)).used).toBe(0);
      expect(reservedUsd()).toBe(0);
      expect(isUserLocked(userId)).toBe(false);
    } finally {
      releaseAll();
    }
  });

  it("Stop while re-queued after a 429 logs the question as cancelled, uncounted, with the notice", async () => {
    useClient({ messages: { stream: () => failing(Anthropic.APIError.generate(429,
      { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers({ "retry-after": "30" }))) } });
    const cookie = await registerAndGetCookie();
    const userId = lastUserId();
    const id = await newConversation(cookie);
    const { rows: saved } = await askThenStop(cookie, userId, id, "queued"); // the first "queued" is the 429 re-queue
    expect(saved.map((r) => [r.role, r.status])).toEqual([["student", "cancelled"], ["notice", "answered"]]);
    expect((await studentUsage(userId)).used).toBe(0);
    expect(reservedUsd()).toBe(0);
    expect(isUserLocked(userId)).toBe(false);
  });

  // D20 — facilities imported into the context scenario join the value check (super-model has no dataset).
  it("drops a short uncited block naming a facility imported in the context scenario but absent from the summary", async () => {
    useClient(scriptedClient("Should fresno stay open?"));
    const cookie = await registerAndGetCookie();
    const userId = lastUserId();
    const [scenario] = await db.insert(scenariosTable).values({
      name: "Imported network", userId, modelId: "super-model",
      inputs: { ...SUPER_DEFAULT_INPUTS, warehouses: [{ id: "W1", city: "Fresno", lat: 36.74, lng: -119.79, status: "active" }] },
    }).returning();
    try {
      const id = await newConversation(cookie, "super-model");
      const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie)
        .send({ question: "Which sites?", context: { tab: "cost-summary", scenarioId: scenario!.id } });
      expect(res.text).not.toContain("event: block");
      expect(res.text).toContain('"kind":"claim_removed"');
      expect((await rows(id)).find((r) => r.role === "tutor")!.blocks).toEqual([]);
    } finally {
      await db.delete(scenariosTable).where(eq(scenariosTable.id, scenario!.id));
    }
  });

  // D23 — no bulk download of the book by enumerating passage ids.
  it("serves a passage only when the requester's own tutor message cites it", async () => {
    // Chapter 851: outside watbotPassages.test.ts's >= 900 cleanup range, so parallel files cannot delete it.
    const [cited, uncited] = await db.insert(coursePassagesTable).values([
      { sourceKind: "book", chapter: 851, locator: "1", ordinal: 1, label: "Ch 851 · p.1", body: "cited page" },
      { sourceKind: "book", chapter: 851, locator: "2", ordinal: 2, label: "Ch 851 · p.2", body: "never cited" },
    ]).returning();
    try {
      const owner = await registerAndGetCookie();
      const ownerId = lastUserId();
      const other = await registerAndGetCookie();
      const id = await newConversation(owner);
      await db.insert(watbotMessagesTable).values({ conversationId: id, userId: ownerId, role: "tutor",
        blocks: [{ text: "See the page.", citations: [{ passageId: cited!.id, label: cited!.label, citedText: "cited page" }] }] });
      const ok = await request(app).get(`/api/watbot/passages/${cited!.id}`).set("Cookie", owner);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ id: cited!.id, label: "Ch 851 · p.1", body: "cited page" });
      expect((await request(app).get(`/api/watbot/passages/${uncited!.id}`).set("Cookie", owner)).status).toBe(404);
      expect((await request(app).get(`/api/watbot/passages/${cited!.id}`).set("Cookie", other)).status).toBe(404);
      expect((await request(app).get("/api/watbot/passages/not-a-number").set("Cookie", owner)).status).toBe(404);
    } finally {
      await db.delete(coursePassagesTable).where(eq(coursePassagesTable.chapter, 851));
    }
  });

  it("a stopped or fully filtered answer leaves no empty text block in the next question's request", async () => {
    const seen: Anthropic.MessageStreamParams[] = [];
    const longClaim = "The optimal solution always opens the three largest cities because they have the most demand overall.";
    const first = scriptedClient(longClaim);
    const second = scriptedClient("What would change with p = 1?");
    let call = 0;
    useClient({ messages: { stream: (params, opts) => { seen.push(params); return (call++ === 0 ? first : second).messages.stream(params, opts); } } });
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const ask = () => request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
    const a = await ask();
    expect(a.text).not.toContain("event: block"); // claim filtered → tutor row with no blocks
    expect((await rows(id)).find((r) => r.role === "tutor")!.blocks).toEqual([]);
    const b = await ask();
    expect(b.text).toContain("event: done");
    const texts = seen[1]!.messages.flatMap((m) => (m.content as Anthropic.ContentBlockParam[]).filter((x) => x.type === "text")) as Anthropic.TextBlockParam[];
    expect(texts.filter((t) => !t.text.trim())).toEqual([]);
  });

  it("D20: a scenario named like a hidden facility or value does not unlock it in an uncited block", async () => {
    const cookie = await registerAndGetCookie();
    const userId = lastUserId();
    const made: number[] = [];
    try {
      for (const [name, text] of [["Allentown", "Should Allentown be open?"], ["1234567", "Is the total 1,234,567?"]] as const) {
        const [sc] = await db.insert(scenariosTable).values({ name, userId, modelId: "p-median-us", inputs: {} }).returning();
        made.push(sc!.id);
        useClient(scriptedClient(text));
        const id = await newConversation(cookie);
        const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie)
          .send({ question: "Which?", context: { tab: "output-map", scenarioId: sc!.id } });
        expect(res.text, name).not.toContain("event: block");
        expect(res.text, name).toContain('"kind":"claim_removed"');
      }
    } finally {
      for (const sid of made) await db.delete(scenariosTable).where(eq(scenariosTable.id, sid));
    }
  });

  it("a report stores the context of the question that produced the reported answer, not the newest one", async () => {
    useClient(scriptedClient("Short."));
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const ask = (tab: string) => request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: { tab, scenarioId: null } });
    await ask("output-map");
    await ask("flows");
    const [first] = (await rows(id)).filter((r) => r.role === "tutor");
    expect((await request(app).post("/api/watbot/reports").set("Cookie", cookie).send({ messageId: first!.id, reason: "other" })).status).toBe(201);
    const [report] = await db.select().from(watbotReportsTable).where(eq(watbotReportsTable.messageId, first!.id));
    expect(report!.context?.tab).toBe("output-map");
  });

  it("rejects an unknown context tab and ids past int4 without a 500", async () => {
    const cookie = await registerAndGetCookie();
    const id = await newConversation(cookie);
    const post = (body: object) => request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send(body);
    expect((await post({ question: "q", context: { tab: "Allentown", scenarioId: null } })).status).toBe(400);
    expect((await post({ question: "q", context: { tab: null, scenarioId: 2147483648 } })).status).toBe(400);
    expect((await request(app).post("/api/watbot/reports").set("Cookie", cookie).send({ messageId: 2147483648, reason: "other" })).status).toBe(400);
    expect((await request(app).get("/api/watbot/conversations/2147483648").set("Cookie", cookie)).status).toBe(404);
    expect((await request(app).get("/api/watbot/passages/2147483648").set("Cookie", cookie)).status).toBe(404);
  });

  it("status reports the cap as reached when the next question would be refused (same expression as admission)", async () => {
    const cookie = await registerAndGetCookie();
    const prev = process.env.WATBOT_MONTHLY_USD;
    try {
      // Stored spend is under the cap, but stored + the worst-case reservation is not.
      process.env.WATBOT_MONTHLY_USD = String((await monthlySpendUsd()) + 0.001);
      expect((await request(app).get("/api/watbot/status").set("Cookie", cookie)).body.projectCapReached).toBe(true);
      useClient(scriptedClient("Short."));
      const id = await newConversation(cookie);
      const res = await request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ question: "q", context: null });
      expect(res.status).toBe(429);
      process.env.WATBOT_MONTHLY_USD = String((await monthlySpendUsd()) + 100);
      expect((await request(app).get("/api/watbot/status").set("Cookie", cookie)).body.projectCapReached).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.WATBOT_MONTHLY_USD; else process.env.WATBOT_MONTHLY_USD = prev;
    }
  });

  it("OpenAPI context.tab enum equals WORKSPACE_TAB_IDS", async () => {
    const { readFileSync } = await import("node:fs");
    const { WORKSPACE_TAB_IDS } = await import("@workspace/dataset-schema");
    const yaml = readFileSync(new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8");
    const block = yaml.slice(yaml.indexOf("    AskWatBotRequest:"));
    const list = block.match(/enum: \[([^\]]+)\]/)![1]!.split(",").map((x) => x.trim()).filter((x) => x !== "null");
    expect(list).toEqual([...WORKSPACE_TAB_IDS]);
  });

  it("OpenAPI WatBotError enum equals the TS union (pinned to the constant)", async () => {
    const { readFileSync } = await import("node:fs");
    const yaml = readFileSync(new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url), "utf8");
    const block = yaml.slice(yaml.indexOf("    WatBotError:"));
    const enumLine = block.match(/enum: \[([^\]]+)\]/)![1]!;
    expect(enumLine.split(",").map((s) => s.trim())).toEqual([...WATBOT_ERROR_CODES]);
  });

  const ask = (cookie: string, id: number, body: object) =>
    request(app).post(`/api/watbot/conversations/${id}/messages`).set("Cookie", cookie).send({ context: null, ...body });
  const feedback = (cookie: string, id: number, body: object) =>
    request(app).post(`/api/watbot/conversations/${id}/feedback`).set("Cookie", cookie).send(body);
  async function answered(cookie: string, type = "incorrect_attempt") {
    useClient(scriptedClient("Which constraint does that break?", { type }));
    const id = await newConversation(cookie);
    expect((await ask(cookie, id, { question: "Is p = 5 optimal?" })).status).toBe(200);
    const tutor = (await rows(id)).filter((r) => r.role === "tutor").at(-1)!;
    return { id, tutorId: tutor.id };
  }

  it("feedback: stores ✓ and ✗, upserts on the same answer, and returns the re-answer label only for reasons 1–3", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    const up = await feedback(cookie, id, { messageId: tutorId, helped: true });
    expect(up.status).toBe(201);
    expect(up.body.repairLabel).toBeNull();
    const down = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "hard_to_follow" });
    expect(down.body).toEqual({ id: up.body.id, repairLabel: REPAIR_LABELS.hard_to_follow });
    const other = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "other", note: "  the zones part  " });
    expect(other.body.repairLabel).toBeNull();
    const [fb] = await db.select().from(watbotFeedbackTable).where(eq(watbotFeedbackTable.messageId, tutorId));
    expect(fb).toMatchObject({ helped: false, reason: "other", note: "the zones part", repairMessageId: null });
  });

  it("feedback: 400 on a reason with ✓, a ✗ without a reason, or a note without 'other'; 404 on another user's or a non-tutor message", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    expect((await feedback(cookie, id, { messageId: tutorId, helped: true, reason: "other" })).status).toBe(400);
    expect((await feedback(cookie, id, { messageId: tutorId, helped: false })).status).toBe(400);
    expect((await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "still_stuck", note: "x" })).status).toBe(400);
    const studentId = (await rows(id)).find((r) => r.role === "student")!.id;
    expect((await feedback(cookie, id, { messageId: studentId, helped: true })).status).toBe(404);
    const other = await registerAndGetCookie();
    expect((await feedback(other, id, { messageId: tutorId, helped: true })).status).toBe(404);
  });

  it("repairOf: re-answers the original question under the repair rule, stores the label, counts toward the limit, then locks the rating", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    const fb = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "too_many_questions" });
    const before = await studentUsage(lastUserId());
    let sent = "";
    const inner = scriptedClient("The passage says…", { type: "incorrect_attempt" }); // one instance: it counts rounds
    useClient({ messages: { stream(params, opts) { sent ||= JSON.stringify(params.messages.at(-1)); return inner.messages.stream(params, opts); } } });
    const res = await ask(cookie, id, { question: "ignored", repairOf: fb.body.id });
    expect(res.status).toBe(200);
    expect(res.text).toContain("event: done");
    expect(sent).toContain("Is p = 5 optimal?");
    expect(sent).toContain('(Re-answer: the student asked \\"Explain with fewer questions\\"');
    const all = await rows(id);
    const repairRow = all.filter((r) => r.role === "student").at(-1)!;
    expect(repairRow).toMatchObject({ status: "answered", messageType: "incorrect_attempt" });
    expect(repairRow.blocks[0]!.text).toBe(REPAIR_LABELS.too_many_questions);
    expect((await studentUsage(lastUserId())).remaining).toBe(before.remaining - 1);
    const [stored] = await db.select().from(watbotFeedbackTable).where(eq(watbotFeedbackTable.id, fb.body.id));
    expect(stored!.repairMessageId).toBe(repairRow.id);
    expect((await feedback(cookie, id, { messageId: tutorId, helped: true })).status).toBe(409);
    expect((await feedback(cookie, id, { messageId: tutorId, helped: true })).body.error).toBe("watbot_feedback_locked");
    expect((await ask(cookie, id, { question: "x", repairOf: fb.body.id })).status).toBe(409);
  });

  it("feedback on a conversation whose model is now locked is 403", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    setLockedModelsForTests(["p-median-us"]);
    try {
      expect((await feedback(cookie, id, { messageId: tutorId, helped: true })).status).toBe(403);
    } finally { setLockedModelsForTests(null); }
  });

  it("repairOf: 404 for reasons 4/Other, a ✓, another user's rating, or a rating that is not on the latest answer", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    const stuck = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "still_stuck" });
    expect((await ask(cookie, id, { question: "x", repairOf: stuck.body.id })).status).toBe(404);
    const other = await registerAndGetCookie();
    const theirs = await answered(other);
    const theirFb = await feedback(other, theirs.id, { messageId: theirs.tutorId, helped: false, reason: "hard_to_follow" });
    expect((await ask(cookie, id, { question: "x", repairOf: theirFb.body.id })).status).toBe(404);
    const old = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "hard_to_follow" });
    expect((await ask(cookie, id, { question: "A new question" })).status).toBe(200); // a newer answer now exists
    expect((await ask(cookie, id, { question: "x", repairOf: old.body.id })).status).toBe(404);
  });

  it("R3 sends the original row's type as excluded, and a re-answer of a re-answer resends the root question", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie, "concept_question");
    const fb1 = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "not_what_i_asked" });
    const results: string[] = [];
    const capture = (inner: WatBotClient) => useClient({ messages: { stream(params, opts) { results.push(JSON.stringify(params.messages.at(-1))); return inner.messages.stream(params, opts); } } });
    capture(scriptedClient("Try this.", { type: "concept_question" })); // records the excluded type, so round 2 gets the error result
    expect((await ask(cookie, id, { question: "x", repairOf: fb1.body.id })).status).toBe(200);
    expect(results[1]).toContain("concept_question is ruled out");
    const tutor2 = (await rows(id)).filter((r) => r.role === "tutor").at(-1)!.id;
    const fb2 = await feedback(cookie, id, { messageId: tutor2, helped: false, reason: "hard_to_follow" });
    results.length = 0;
    capture(scriptedClient("Step one: …", { type: "concept_question" }));
    expect((await ask(cookie, id, { question: "x", repairOf: fb2.body.id })).status).toBe(200);
    expect(results[0]).toContain("Is p = 5 optimal?"); // the root question, not the ↻ label of the first re-answer
  });

  // F7: the claim is taken under the per-user lock, before the model call.
  it("claims the rating before the model call; a feedback write during the re-answer is busy", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    const fb = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "hard_to_follow" });
    let release!: () => void;
    useClient(scriptedClient("Step one.", { type: "incorrect_attempt", gate: new Promise<void>((r) => { release = r; }) }));
    const inFlight = ask(cookie, id, { question: "x", repairOf: fb.body.id }).then((r) => r); // .then starts the request
    // Poll for the claim: admission is several awaited queries, so a fixed sleep flakes under load.
    let mid: typeof watbotFeedbackTable.$inferSelect | undefined;
    for (let i = 0; i < 200 && !mid?.repairMessageId; i++) {
      await sleep(50);
      [mid] = await db.select().from(watbotFeedbackTable).where(eq(watbotFeedbackTable.id, fb.body.id));
    }
    expect(mid!.repairMessageId).not.toBeNull();
    const during = await feedback(cookie, id, { messageId: tutorId, helped: true });
    expect(during.status).toBe(409);
    expect(during.body.error).toBe("watbot_busy");
    release();
    expect((await inFlight).status).toBe(200);
  });

  // F8: a claim whose student row has no tutor row after it died (crash, failure, stop) and can be taken again.
  it("re-claims a stale claim, and accepts a feedback write over it", async () => {
    const cookie = await registerAndGetCookie();
    const { id, tutorId } = await answered(cookie);
    const fb = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "hard_to_follow" });
    const [orphan] = await db.insert(watbotMessagesTable).values({ conversationId: id, userId: lastUserId(), role: "student",
      blocks: [{ text: REPAIR_LABELS.hard_to_follow, citations: [] }] }).returning();
    await db.update(watbotFeedbackTable).set({ repairMessageId: orphan!.id }).where(eq(watbotFeedbackTable.id, fb.body.id));
    expect((await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "hard_to_follow" })).status).toBe(201);
    await db.update(watbotFeedbackTable).set({ repairMessageId: orphan!.id }).where(eq(watbotFeedbackTable.id, fb.body.id));
    useClient(scriptedClient("Step one.", { type: "incorrect_attempt" }));
    expect((await ask(cookie, id, { question: "x", repairOf: fb.body.id })).status).toBe(200);
    const [after] = await db.select().from(watbotFeedbackTable).where(eq(watbotFeedbackTable.id, fb.body.id));
    expect(after!.repairMessageId).not.toBe(orphan!.id);
  });

  // F10: the server rebuilds the re-answer's context from the source row; the client's is ignored.
  it("a re-answer sent with context null still carries the source question's scenario summary", async () => {
    const cookie = await registerAndGetCookie();
    const [sc] = await db.insert(scenariosTable).values({ name: "Coastal", userId: lastUserId(), modelId: "p-median-us", inputs: { p: 4 } }).returning();
    try {
      useClient(scriptedClient("Which constraint does that break?", { type: "incorrect_attempt" }));
      const id = await newConversation(cookie);
      expect((await ask(cookie, id, { question: "Is p = 5 optimal?", context: { tab: "output-map", scenarioId: sc!.id } })).status).toBe(200);
      const tutorId = (await rows(id)).filter((r) => r.role === "tutor").at(-1)!.id;
      const fb = await feedback(cookie, id, { messageId: tutorId, helped: false, reason: "too_many_questions" });
      let sent = "";
      const inner = scriptedClient("The passage says…", { type: "incorrect_attempt" });
      useClient({ messages: { stream(params, opts) { sent ||= JSON.stringify(params.messages.at(-1)); return inner.messages.stream(params, opts); } } });
      expect((await ask(cookie, id, { question: "x", context: null, repairOf: fb.body.id })).status).toBe(200);
      expect(sent).toContain("Scenario: Coastal");
      expect(sent).toContain("p = 4");
      const repairRow = (await rows(id)).filter((r) => r.role === "student").at(-1)!;
      expect(repairRow.context).toMatchObject({ tab: "output-map", scenarioId: sc!.id });
    } finally {
      await db.delete(scenariosTable).where(eq(scenariosTable.id, sc!.id));
    }
  });
});
