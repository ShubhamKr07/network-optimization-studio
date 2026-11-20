// artifacts/api-server/src/__tests__/watbotLimits.test.ts
import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable, watbotConversationsTable, watbotMessagesTable } from "@workspace/db";
import {
  studentUsage, monthlySpendUsd, isAvailable, markUnavailable, markAvailable,
  markProjectCapReached, projectCapFlagged, createInflightQueue, resetWatBotLimitsForTests, STUDENT_DAILY_LIMIT,
  tryLockUser, isUserLocked, admitSpend, reservedUsd,
} from "../watbot/limits.js";

const userIds: string[] = [];
afterAll(async () => { for (const id of userIds) await db.delete(usersTable).where(eq(usersTable.id, id)); });
beforeEach(() => resetWatBotLimitsForTests());

async function userWithMessages(times: Date[], role = "student") {
  const [u] = await db.insert(usersTable).values({ email: `watbot-lim-${Date.now()}-${Math.random()}@test.com` } as typeof usersTable.$inferInsert).returning();
  userIds.push(u!.id);
  const [c] = await db.insert(watbotConversationsTable).values({ userId: u!.id, modelId: "p-median-us", title: "t" }).returning();
  for (const t of times) await db.insert(watbotMessagesTable).values({ conversationId: c!.id, userId: u!.id, role, blocks: [], createdAt: t });
  return u!.id;
}

describe("studentUsage", () => {
  it("counts only student messages in the last 24h and reports when the earliest ages out", async () => {
    const now = new Date("2026-11-20T12:00:00Z");
    const id = await userWithMessages([new Date("2026-11-19T11:00:00Z"), new Date("2026-11-20T09:00:00Z"), new Date("2026-11-20T10:00:00Z")]);
    const u = await studentUsage(id, now);
    expect(u.used).toBe(2);
    expect(u.remaining).toBe(STUDENT_DAILY_LIMIT - 2);
    expect(u.resetAt?.toISOString()).toBe("2026-11-21T09:00:00.000Z");
  });

  // Spec §7: only answered rows count; off-topic included; cancelled, limit_reached and unavailable excluded.
  it("counts every answered student message, off-topic included, and skips cancelled and turned-away ones", async () => {
    const now = new Date("2026-11-20T12:00:00Z");
    const id = await userWithMessages([]);
    const [c] = await db.select().from(watbotConversationsTable).where(eq(watbotConversationsTable.userId, id));
    const row = (minutesAgo: number, extra: Partial<typeof watbotMessagesTable.$inferInsert>) =>
      ({ conversationId: c!.id, userId: id, role: "student", blocks: [], createdAt: new Date(now.getTime() - minutesAgo * 60_000), ...extra });
    await db.insert(watbotMessagesTable).values([
      row(50, { messageType: "concept_question" }),
      row(40, { messageType: "off_topic" }),               // counted (FR-35)
      row(30, {}),                                         // type skipped by the model: still counted
      row(20, { status: "limit_reached" }),                // turned away: logged, not counted
      row(10, { status: "unavailable" }),                  // turned away: logged, not counted
      row(5, { status: "cancelled" }),                     // stopped before reaching the model (D22): not counted
    ]);
    const u = await studentUsage(id, now);
    expect(u.used).toBe(3);
    expect(u.resetAt?.toISOString()).toBe(new Date(now.getTime() - 50 * 60_000 + 24 * 60 * 60 * 1000).toISOString());
  });
});

describe("monthlySpendUsd", () => {
  it("sums tutor usage cost in the current UTC month only", async () => {
    const before = await monthlySpendUsd(new Date());
    const id = await userWithMessages([], "tutor");
    const [c] = await db.select().from(watbotConversationsTable).where(eq(watbotConversationsTable.userId, id));
    await db.insert(watbotMessagesTable).values({ conversationId: c!.id, userId: id, role: "tutor", blocks: [], usage: { model: "m", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.25 } });
    expect((await monthlySpendUsd(new Date())) - before).toBeCloseTo(0.25, 6);
  });
});

describe("availability flag", () => {
  it("is unavailable for 60s after a failure, then available again", () => {
    const t0 = new Date("2026-11-20T00:00:00Z");
    markUnavailable(t0);
    expect(isAvailable(new Date(t0.getTime() + 59_000))).toBe(false);
    expect(isAvailable(new Date(t0.getTime() + 61_000))).toBe(true);
    markUnavailable(t0); markAvailable();
    expect(isAvailable(t0)).toBe(true);
  });
  it("API spend-limit flag holds until the UTC month changes", () => {
    markProjectCapReached(new Date("2026-11-20T00:00:00Z"));
    expect(projectCapFlagged(new Date("2026-11-30T23:59:00Z"))).toBe(true);
    expect(projectCapFlagged(new Date("2026-12-01T00:00:00Z"))).toBe(false);
  });
});

describe("inflight queue", () => {
  it("admits up to max, queues the rest in order with positions, releases FIFO", async () => {
    const q = createInflightQueue(1);
    const ac = new AbortController();
    const r1 = await q.acquire(() => {}, ac.signal);
    const positions: number[] = [];
    const p2 = q.acquire((pos) => positions.push(pos), ac.signal);
    const p3 = q.acquire((pos) => positions.push(pos), ac.signal);
    expect(positions).toEqual([1, 2]);
    r1();
    const r2 = await p2; r2();
    const r3 = await p3; r3();
  });
  it("drops an aborted waiter without admitting it", async () => {
    const q = createInflightQueue(1);
    const r1 = await q.acquire(() => {}, new AbortController().signal);
    const ac = new AbortController();
    const p = q.acquire(() => {}, ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow(/aborted/);
    r1();
  });
});

// D24 — the 429 path at the queue level.
describe("inflight queue: 429 re-queue", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const live = new AbortController().signal;

  it("releases the slot, re-enters at the front, is not re-admitted before retry-after, and stays ahead of later arrivals", async () => {
    const q = createInflightQueue(1);
    const releaseB = await q.acquire(() => {}, live);   // B is answering
    const pC = q.acquire(() => {}, live);               // C waits
    releaseB();                                         // B gets a 429: its slot goes to C
    const releaseC = await pC;
    const positions: number[] = [];
    const admitted: string[] = [];
    const pB = q.requeue(2000, (pos) => positions.push(pos), live).then((r) => { admitted.push("B"); return r; });
    const pD = q.acquire((pos) => positions.push(pos), live).then((r) => { admitted.push("D"); return r; }); // a later arrival
    expect(positions).toEqual([1, 2]);                  // B at the front, D behind it

    releaseC();                                         // a slot frees before B's retry-after…
    await vi.advanceTimersByTimeAsync(1999);
    expect(admitted).toEqual([]);                       // …B is not re-admitted early, and D does not jump it
    await vi.advanceTimersByTimeAsync(1);
    expect(admitted).toEqual(["B"]);
    (await pB)();
    await vi.advanceTimersByTimeAsync(0);
    expect(admitted).toEqual(["B", "D"]);
    (await pD)();
  });

  it("Stop while re-queued removes the request from the queue", async () => {
    const q = createInflightQueue(1);
    const releaseA = await q.acquire(() => {}, live);
    const ac = new AbortController();
    const pB = q.requeue(5000, () => {}, ac.signal);
    const pD = q.acquire(() => {}, live);
    ac.abort();
    await expect(pB).rejects.toThrow(/aborted/);
    releaseA();
    const releaseD = await pD;                          // admitted at once: B no longer holds the head
    releaseD();
  });
});

// D21 — one question in flight per user.
describe("per-user lock", () => {
  it("lets one question in per user, and the release is idempotent", () => {
    const release = tryLockUser("u1")!;
    expect(release).toBeTypeOf("function");
    expect(tryLockUser("u1")).toBeNull();                // second concurrent question → watbot_busy
    expect(tryLockUser("u2")).not.toBeNull();            // other users are unaffected
    release(); release();
    expect(isUserLocked("u1")).toBe(false);
    expect(tryLockUser("u1")).not.toBeNull();
  });
});

// D21 — spend reservations against the monthly cap.
describe("spend reservations", () => {
  it("two admitted questions reserve two amounts; over-cap admission is refused; release is idempotent", () => {
    const a = admitSpend(0.2, 0.3, 1)!;
    const b = admitSpend(0.2, 0.3, 1)!;
    expect(reservedUsd()).toBeCloseTo(0.6, 9);
    expect(admitSpend(0.2, 0.5, 1)).toBeNull();          // 0.2 stored + 0.6 reserved + 0.5 ≥ 1
    a(); a();
    expect(reservedUsd()).toBeCloseTo(0.3, 9);
    b();
    expect(reservedUsd()).toBe(0);
  });
  it("refuses while the API spend-limit flag is set", () => {
    markProjectCapReached();
    expect(admitSpend(0, 0.01, 10)).toBeNull();
  });
});
