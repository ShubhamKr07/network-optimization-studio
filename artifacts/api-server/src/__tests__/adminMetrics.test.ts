// ADM-T3 — real Postgres, no db mock. Requires DATABASE_URL.
// Seed lives in January 2026 (CST, UTC-6), before WatBot existed, so no real row shares the range.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db, usersTable, watbotConversationsTable, watbotMessagesTable, watbotFeedbackTable, watbotReportsTable } from "@workspace/db";
import { getAdminMetrics, blankDay } from "../services/adminMetrics.js";
import { CLAIM_REMOVED_NOTICE, REFUSED_NOTICE, STOPPED_NOTICE, FAILED_NOTICE } from "../watbot/engine.js";

const OLD_DROP = "One claim was removed — I couldn't support it with a course source.";
const RANGE = { from: "2026-01-10", to: "2026-01-11" };
const userIds: string[] = [];

async function user(role: string) {
  const [u] = await db.insert(usersTable).values({ email: `adm-t3-${role}-${Math.random().toString(36).slice(2)}@test.com`, role }).returning();
  userIds.push(u!.id);
  return u!.id;
}
async function conv(userId: string, modelId: string) {
  const [c] = await db.insert(watbotConversationsTable).values({ userId, modelId, title: "adm-t3-marker" }).returning();
  return c!.id;
}
type Extra = Partial<typeof watbotMessagesTable.$inferInsert>;
async function msg(conversationId: number, userId: string, role: "student" | "tutor" | "notice", at: string, extra: Extra = {}) {
  const [m] = await db.insert(watbotMessagesTable).values({ conversationId, userId, role, blocks: [{ text: "x", citations: [] }], createdAt: new Date(at), ...extra }).returning();
  return m!.id;
}
const notice = (c: number, u: string, at: string, text: string) => msg(c, u, "notice", at, { blocks: [{ text, citations: [] }] });
const tutorUsage = (costUsd: number) => ({ model: "m", inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1, costUsd });

let s1Tutor1: number, s1Tutor2: number, s2Tutor: number, repairId: number;

beforeAll(async () => {
  const S1 = await user("student"), S2 = await user("instructor"), A1 = await user("admin");
  const cA = await conv(S1, "p-median-us"), cB = await conv(S2, "p-median-us"), cC = await conv(S2, "max-coverage-us"), cAdmin = await conv(A1, "p-median-us");

  await msg(cA, S1, "student", "2026-01-10T18:00:00Z", { messageType: "concept_question" });
  s1Tutor1 = await msg(cA, S1, "tutor", "2026-01-10T18:00:05Z", { latencyMs: 3000, usage: tutorUsage(0.03), gapTopic: "lagrangian relaxation (nearest covered: Duality)" });
  await notice(cA, S1, "2026-01-10T18:00:06Z", CLAIM_REMOVED_NOTICE);
  // interleave: S2's unavailable question and its failed notice (no tutor row) land between S1's turns
  await msg(cC, S2, "student", "2026-01-10T18:10:00Z", { status: "unavailable" });
  await notice(cC, S2, "2026-01-10T18:10:01Z", FAILED_NOTICE);
  repairId = await msg(cA, S1, "student", "2026-01-10T18:20:00Z");
  s1Tutor2 = await msg(cA, S1, "tutor", "2026-01-10T18:20:05Z", { latencyMs: 5000, usage: tutorUsage(0.02), gapTopic: "Stochastic demand" });
  await notice(cA, S1, "2026-01-10T18:20:06Z", REFUSED_NOTICE);
  await notice(cA, S1, "2026-01-10T18:20:07Z", OLD_DROP);
  // A stopped-before-the-model turn as production writes it: cancelled student row, STOPPED notice, no tutor row.
  // The notice must NOT attach to tutor2 (a student row sits between them).
  await msg(cA, S1, "student", "2026-01-10T18:30:00Z", { status: "cancelled" });
  await notice(cA, S1, "2026-01-10T18:30:01Z", STOPPED_NOTICE);

  await msg(cB, S2, "student", "2026-01-11T05:30:00Z"); // Chicago 2026-01-10 23:30
  s2Tutor = await msg(cB, S2, "tutor", "2026-01-11T05:30:05Z", { latencyMs: 7000, usage: tutorUsage(0.05), gapTopic: "Lagrangian relaxation (nearest covered: Facility location)" });
  await notice(cB, S2, "2026-01-11T05:30:06Z", STOPPED_NOTICE); // follows a tutor row: counts
  // Same S2, other model, within 30 min of the p-median question: still its own session (model partition).
  await msg(cC, S2, "student", "2026-01-11T05:40:00Z");
  // Second spelling of the Lagrangian topic with the same nearest label.
  await msg(cC, S2, "tutor", "2026-01-11T05:40:05Z", { latencyMs: 1000, usage: { ...tutorUsage(0.01), estimated: true }, gapTopic: "lagrangian relaxation (nearest covered: Facility location)" });
  await msg(cC, S2, "student", "2026-01-10T20:00:00Z", { status: "limit_reached" });
  // One minute outside each Chicago bound (06:00Z = Chicago midnight in January): excluded from the range.
  await msg(cA, S1, "student", "2026-01-10T05:59:00Z"); // Chicago Jan 9 23:59: lands in `prior`
  await msg(cA, S1, "student", "2026-01-12T06:01:00Z"); // Chicago Jan 12 00:01

  await msg(cAdmin, A1, "student", "2026-01-10T19:00:00Z");
  const adminTutor = await msg(cAdmin, A1, "tutor", "2026-01-10T19:00:05Z", { latencyMs: 99999, usage: tutorUsage(9.99), gapTopic: "Admin gap (nearest covered: X)" });
  await notice(cAdmin, A1, "2026-01-10T19:00:06Z", REFUSED_NOTICE);
  await db.insert(watbotFeedbackTable).values({ userId: A1, conversationId: cAdmin, messageId: adminTutor, helped: false, reason: "other", createdAt: new Date("2026-01-10T19:10:00Z") });
  await db.insert(watbotReportsTable).values({ userId: A1, messageId: adminTutor, reason: "other", createdAt: new Date("2026-01-10T19:30:00Z") });

  await db.insert(watbotFeedbackTable).values([
    { userId: S1, conversationId: cA, messageId: s1Tutor1, helped: false, reason: "still_stuck", repairMessageId: repairId, createdAt: new Date("2026-01-10T19:00:00Z") },
    { userId: S1, conversationId: cA, messageId: s1Tutor2, helped: true, createdAt: new Date("2026-01-10T19:05:00Z") },
  ]);
  await db.insert(watbotReportsTable).values({ userId: S2, messageId: s2Tutor, reason: "citation_unsupported", createdAt: new Date("2026-01-11T06:00:00Z") });
});

afterAll(async () => {
  // conversations/messages/feedback/reports cascade from the user rows
  if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
});

describe("getAdminMetrics", () => {
  it("counts allowlisted users only and attributes notices to their tutor row", async () => {
    const m = await getAdminMetrics(RANGE, new Date("2026-01-20T12:00:00Z"));
    expect(m.days.map(d => d.date)).toEqual(["2026-01-10", "2026-01-11"]);
    const d = m.days[0]!;
    expect(d).toMatchObject({ asked: 7, answered: 4, cancelled: 1, unavailable: 1, limitReached: 1, notices: 2, refused: 1, stopped: 1, failedNotices: 1, ratings: 2, helped: 1, estimated: 1 });
    expect(d.costUsd).toBeCloseTo(0.11, 4);
    expect(d.latencyMedianMs).toBe(4000);
    expect(d.latencyP95Ms).toBeCloseTo(6700, 3);
    expect(m.days[1]).toEqual(blankDay("2026-01-11"));
  });

  it("period figures, gap topics and sessions", async () => {
    const { period, prior, matrix, sessionsByWeek, monthToDate } = await getAdminMetrics(RANGE, new Date("2026-01-20T12:00:00Z"));
    expect(period).toMatchObject({ answered: 4, activeStudents: 2, ratings: 2, helped: 1, reanswered: 1, sessions: 3 });
    expect(period.costUsd).toBeCloseTo(0.11, 4);
    expect(period.tokens).toEqual({ input: 40, output: 20, cacheRead: 8, cacheWrite: 4 });
    // prior = Jan 8-9: only S1's question one minute before the lower bound
    expect(prior).toMatchObject({ answered: 1, activeStudents: 1, ratings: 0, sessions: 1 });
    expect(period.notHelpedByReason).toEqual([{ reason: "still_stuck", count: 1 }]);
    expect(period.reportsByReason).toEqual([{ reason: "citation_unsupported", count: 1 }]);
    expect(period.studentsByModel).toEqual([{ modelId: "p-median-us", students: 2 }, { modelId: "max-coverage-us", students: 1 }]);
    expect(period.gapTopics).toEqual([
      { topic: "Lagrangian relaxation", count: 3, nearestCovered: "Facility location" },
      { topic: "Stochastic demand", count: 1, nearestCovered: null },
    ]);
    expect(matrix).toContainEqual({ modelId: "p-median-us", messageType: "concept_question", answered: 1 });
    expect(matrix).toContainEqual({ modelId: "p-median-us", messageType: null, answered: 2 });
    expect(matrix).toContainEqual({ modelId: "max-coverage-us", messageType: null, answered: 1 });
    expect(sessionsByWeek).toHaveLength(1);
    expect(sessionsByWeek[0]).toMatchObject({ weekStart: "2026-01-05", sessions: 3 });
    expect(monthToDate.month).toBe("2026-01");
  });

  it("a model filter drops other models' rows", async () => {
    const m = await getAdminMetrics({ ...RANGE, modelId: "max-coverage-us" }, new Date("2026-01-20T12:00:00Z"));
    expect(m.days[0]).toMatchObject({ asked: 3, answered: 1, unavailable: 1, limitReached: 1, notices: 0, ratings: 0, failedNotices: 1, estimated: 1 });
    expect(m.period.answered).toBe(1);
  });
});
