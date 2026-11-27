// ADM-T4 — real HTTP app against real Postgres (no db mock). Requires DATABASE_URL.
// Seed lives on 2026-01-20 (before WatBot existed), so no real row shares the range.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, watbotConversationsTable, watbotMessagesTable, watbotFeedbackTable, watbotReportsTable } from "@workspace/db";
import app from "../app.js";
import { STOPPED_NOTICE } from "../watbot/engine.js";

const SECRET = "adm-flag-secret";
const userIds: string[] = [];
const seeded = { users: [] as string[], convs: [] as number[], msgs: [] as number[] };
let adminCookie = "";

async function user(role: string) {
  const [u] = await db.insert(usersTable).values({ email: `${SECRET}-${role}-${Math.random().toString(36).slice(2)}@test.com`, role }).returning();
  userIds.push(u!.id); seeded.users.push(u!.id);
  return u!.id;
}
async function conv(userId: string, modelId = "p-median-us") {
  const [c] = await db.insert(watbotConversationsTable).values({ userId, modelId, title: "adm-t4-marker" }).returning();
  seeded.convs.push(c!.id);
  return c!.id;
}
type Extra = Partial<typeof watbotMessagesTable.$inferInsert>;
async function msg(conversationId: number, userId: string, role: "student" | "tutor" | "notice", text: string, at: string, extra: Extra = {}) {
  const [m] = await db.insert(watbotMessagesTable).values({ conversationId, userId, role, blocks: [{ text, citations: [] }], createdAt: new Date(at), ...extra }).returning();
  seeded.msgs.push(m!.id);
  return m!.id;
}
const get = (qs = "from=2026-01-20&to=2026-01-20") => request(app).get(`/api/admin/watbot/flagged?${qs}`).set("Cookie", adminCookie);

beforeAll(async () => {
  const reg = await request(app).post("/api/auth/register").send({ email: `${SECRET}-caller-${Date.now()}@test.com`, password: "correct horse battery", acceptTerms: true });
  userIds.push(reg.body.user.id);
  await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, reg.body.user.id));
  adminCookie = (reg.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;

  const S1 = await user("student"), S2 = await user("instructor"), A1 = await user("admin");
  const c1 = await conv(S1), c2 = await conv(S2, "max-coverage-us"), c3 = await conv(S1), c4 = await conv(S2), cA = await conv(A1);
  const cited = [{ text: "Answer one.", citations: [{ passageId: 1, label: "Ch 3 · p.71", citedText: "BOOK TEXT" }] }];

  // interleaved ids across conversations 1 and 2
  await msg(c1, S1, "student", "Q1 text", "2026-01-20T15:00:00Z", { messageType: "concept_question" });
  await msg(c2, S2, "student", "Q2 text", "2026-01-20T15:00:01Z", { messageType: "incorrect_attempt" });
  const t1 = await msg(c1, S1, "tutor", "x", "2026-01-20T16:00:00Z", { blocks: cited });
  const t2 = await msg(c2, S2, "tutor", "Answer two.", "2026-01-20T17:00:00Z");
  const r1 = await msg(c1, S1, "student", "R1 repair", "2026-01-20T16:05:00Z");
  const r2 = await msg(c2, S2, "student", "R2 repair", "2026-01-20T17:05:00Z");
  await msg(c1, S1, "tutor", "Re-answer text.", "2026-01-20T16:06:00Z");
  // conversation 3: an orphan reply, no student row before it
  const t3 = await msg(c3, S1, "tutor", "Orphan answer.", "2026-01-20T18:00:00Z");
  // conversation 4: a re-answer that was stopped: claim, STOPPED notice, no tutor row
  await msg(c4, S2, "student", "Q4 text", "2026-01-20T13:00:00Z");
  const t4 = await msg(c4, S2, "tutor", "Answer four.", "2026-01-20T14:00:00Z");
  const r3 = await msg(c4, S2, "student", "R3 repair", "2026-01-20T14:05:00Z");
  await msg(c4, S2, "notice", STOPPED_NOTICE, "2026-01-20T14:05:01Z");
  // admin row: flagged, must be excluded
  await msg(cA, A1, "student", "admin q", "2026-01-20T19:00:00Z");
  const ta = await msg(cA, A1, "tutor", "Admin answer.", "2026-01-20T19:00:05Z");

  await db.insert(watbotFeedbackTable).values([
    { userId: S1, conversationId: c1, messageId: t1, helped: false, reason: "still_stuck", note: "still lost", repairMessageId: r1 },
    { userId: S2, conversationId: c2, messageId: t2, helped: false, reason: "hard_to_follow", repairMessageId: r2 },
    { userId: S2, conversationId: c4, messageId: t4, helped: false, reason: "hard_to_follow", repairMessageId: r3 },
    { userId: A1, conversationId: cA, messageId: ta, helped: false, reason: "other" },
  ]);
  await db.insert(watbotReportsTable).values([
    { userId: S1, messageId: t3, reason: "wrong_or_misleading", note: "wrong" },
    { userId: A1, messageId: ta, reason: "other" },
  ]);
});

afterAll(async () => { if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds)); });

describe("GET /api/admin/watbot/flagged", () => {
  it("returns flagged tutor replies newest first, with question, citations labels, rating, report and re-answer status", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    const items = res.body.items;
    expect(items.map((i: { answer: { text: string } }) => i.answer.text)).toEqual(["Orphan answer.", "Answer two.", "Answer one.", "Answer four."]);
    const [t3, t2, t1, t4] = items;
    expect(t1.question).toBe("Q1 text");
    expect(t1.messageType).toBe("concept_question");
    expect(t1.answer.citations).toEqual(["Ch 3 · p.71"]);
    expect(t1.rating).toEqual({ reason: "still_stuck", note: "still lost" });
    expect(t1.report).toBeNull();
    expect(t1.reanswer).toEqual({ status: "answered", text: "Re-answer text." });
    expect(t2.question).toBe("Q2 text");
    expect(t2.modelId).toBe("max-coverage-us");
    expect(t2.reanswer).toEqual({ status: "not_completed", text: null });
    expect(t3.question).toBeNull();
    expect(t3.rating).toBeNull();
    expect(t3.report).toEqual({ reason: "wrong_or_misleading", note: "wrong" });
    expect(t3.reanswer).toEqual({ status: "none", text: null });
    expect(t4.reanswer).toEqual({ status: "not_completed", text: null });
  });

  it("every item has exactly the contract keys, and no identity or source text leaks", async () => {
    const res = await get();
    for (const i of res.body.items) expect(Object.keys(i).sort()).toEqual(["answer", "at", "messageType", "modelId", "question", "rating", "reanswer", "report"]);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("BOOK TEXT");
    for (const u of seeded.users) expect(json).not.toContain(u);
    // ids are numeric, so check them as JSON values and as quoted strings
    for (const n of [...seeded.convs, ...seeded.msgs]) {
      expect(json).not.toMatch(new RegExp(`:${n}[,}\\]]`));
      expect(json).not.toContain(`"${n}"`);
    }
  });

  it("filters by modelId", async () => {
    const res = await get("from=2026-01-20&to=2026-01-20&modelId=max-coverage-us");
    expect(res.body.items.map((i: { answer: { text: string } }) => i.answer.text)).toEqual(["Answer two."]);
  });

  it("caps at 100 items and reports truncated", async () => {
    const S = await user("student"), c = await conv(S);
    for (let i = 0; i < 101; i++) {
      const t = await msg(c, S, "tutor", `cap ${i}`, "2026-01-22T12:00:00Z");
      await db.insert(watbotReportsTable).values({ userId: S, messageId: t, reason: "other" });
    }
    const res = await get("from=2026-01-22&to=2026-01-22");
    expect(res.body.items).toHaveLength(100);
    expect(res.body.truncated).toBe(true);
  }, 60_000);

  it("returns an empty list for a range with no flagged replies", async () => {
    const res = await get("from=2026-01-21&to=2026-01-21");
    expect(res.body).toEqual({ truncated: false, items: [] });
  });
});

// QFA-1: the "Include admin accounts" switch, over real HTTP. Only the literal "true" turns it on.
describe("includeAdmins switch (D9)", () => {
  const RANGE = "from=2026-01-20&to=2026-01-20";
  const texts = (r: { body: { items: { answer: { text: string } }[] } }) => r.body.items.map(i => i.answer.text);
  const metrics = (qs: string) => request(app).get(`/api/admin/watbot/metrics?${RANGE}${qs}`).set("Cookie", adminCookie);

  it.each(["", "&includeAdmins=false", "&includeAdmins=yes", "&includeAdmins=1"])("flagged excludes the admin's reply with %j", async (qs) => {
    expect(texts(await get(RANGE + qs))).not.toContain("Admin answer.");
  });
  it("flagged includes the admin's reply (once, though rated and reported) with includeAdmins=true; student rows count either way", async () => {
    const off = texts(await get(RANGE)), on = texts(await get(`${RANGE}&includeAdmins=true`));
    expect(on.filter(t => t === "Admin answer.")).toHaveLength(1);
    expect(on).toHaveLength(off.length + 1);
    for (const t of ["Orphan answer.", "Answer two.", "Answer one.", "Answer four."]) { expect(off).toContain(t); expect(on).toContain(t); }
  });
  it.each(["", "&includeAdmins=false", "&includeAdmins=yes"])("metrics ignore the admin with %j", async (qs) => {
    const base = (await metrics("")).body.period;
    const p = (await metrics(qs)).body.period;
    expect([p.answered, p.activeStudents]).toEqual([base.answered, base.activeStudents]);
  });
  it.each(["&includeAdmins=1", "&includeAdmins=true&includeAdmins=true"])("metrics treat %j as off", async (qs) => {
    const base = (await metrics("")).body.period, p = (await metrics(qs)).body.period;
    expect([p.answered, p.activeStudents]).toEqual([base.answered, base.activeStudents]);
  });
  it("metrics add the admin's answered question and active user with includeAdmins=true", async () => {
    const off = (await metrics("")).body.period, on = (await metrics("&includeAdmins=true")).body.period;
    expect(on.answered).toBe(off.answered + 1);
    expect(on.activeStudents).toBe(off.activeStudents + 1);
    expect(off.answered).toBeGreaterThan(0);
  });
});
