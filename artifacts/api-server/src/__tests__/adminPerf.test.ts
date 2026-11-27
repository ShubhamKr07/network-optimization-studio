// ADM-T4 — 10x-volume performance check (spec §4.4). Opt-in: ADMIN_PERF=1. Real Postgres, seeds ~400k rows
// under marker users and removes them in afterAll.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync } from "node:fs";
import { eq, like, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import app from "../app.js";
import { chicagoToday } from "../services/adminRange.js";
import { daysQuery } from "../services/adminMetrics.js";
import { flaggedQuery } from "../services/adminFlagged.js";

const MARKER = "adm-perf-";
const N = 200_000, USERS = 150, CONVS = 3000;
const today = chicagoToday();
const from = new Date(Date.parse(today) - 89 * 86_400_000).toISOString().slice(0, 10);
const range = { from, to: today };
let cookie = "";

const cleanup = () => db.delete(usersTable).where(like(usersTable.email, `${MARKER}%`));
const explain = async (q: ReturnType<typeof daysQuery>) =>
  (await db.execute(sql`EXPLAIN (ANALYZE, BUFFERS) ${q}`)).rows.map(r => (r as Record<string, string>)["QUERY PLAN"]).join("\n");

describe.skipIf(process.env.ADMIN_PERF !== "1")("admin endpoints at 10x volume", () => {
  beforeAll(async () => {
    await cleanup();
    await db.execute(sql`INSERT INTO users (id, email, role) SELECT gen_random_uuid()::text, ${MARKER} || i || '@test.com', 'student' FROM generate_series(1, ${USERS}) i`);
    await db.execute(sql`INSERT INTO watbot_conversations (user_id, model_id, title)
      SELECT u.id, 'p-median-us', ${MARKER + "marker"} FROM (SELECT id FROM users WHERE email LIKE ${MARKER + "%@test.com"} ORDER BY email) u, generate_series(1, ${CONVS / USERS}) k`);
    // Student and tutor rows are inserted pairwise (ORDER BY i, ord) so ids interleave as production writes them.
    // Time spread: i * 7919 mod N scatters rows across 179 days ending yesterday, so a 90-day range holds about half.
    await db.execute(sql`WITH cv AS (SELECT id, user_id, row_number() OVER (ORDER BY id) - 1 AS k FROM watbot_conversations WHERE title = ${MARKER + "marker"}),
      ts AS (SELECT i, now() - interval '1 day' - ((i * 7919) % ${N}) * (interval '179 days' / ${N}) AS at FROM generate_series(1, ${N}) i)
      INSERT INTO watbot_messages (conversation_id, user_id, role, blocks, message_type, usage, latency_ms, status, created_at)
      SELECT cv.id, cv.user_id, r.role,
        CASE WHEN r.ord = 0 THEN '[{"text":"perf question","citations":[]}]'::jsonb
             ELSE '[{"text":"perf answer","citations":[{"passageId":1,"label":"Ch 3 · p.71","citedText":"x"}]}]'::jsonb END,
        CASE WHEN r.ord = 0 THEN 'concept_question' END,
        CASE WHEN r.ord = 1 THEN '{"model":"m","inputTokens":10,"outputTokens":5,"cacheReadTokens":0,"cacheWriteTokens":0,"costUsd":0.01}'::jsonb END,
        CASE WHEN r.ord = 1 THEN 1000 + ts.i % 5000 END, 'answered', ts.at + r.ord * interval '5 seconds'
      FROM ts JOIN cv ON cv.k = ts.i % ${CONVS} CROSS JOIN (VALUES ('student', 0), ('tutor', 1)) AS r(role, ord)
      ORDER BY ts.i, r.ord`);
    // 20k ratings (a third "not helped") and about 2k reports, over tutor rows scattered by id
    await db.execute(sql`WITH t AS (SELECT m.id, m.user_id, m.conversation_id, row_number() OVER (ORDER BY m.id) AS rn
        FROM watbot_messages m JOIN watbot_conversations c ON c.id = m.conversation_id WHERE c.title = ${MARKER + "marker"} AND m.role = 'tutor')
      INSERT INTO watbot_feedback (user_id, conversation_id, message_id, helped, reason, created_at)
      SELECT user_id, conversation_id, id, rn % 3 <> 0, CASE WHEN rn % 3 = 0 THEN 'still_stuck' END, now() - interval '2 days' FROM t WHERE rn % 10 = 0`);
    // Re-answer claims on every "not helped" rating (~6.7k): a student row newer than everything else in its
    // conversation and no tutor row after it, i.e. a stopped/failed re-answer (status not_completed), the worst case for the lookup.
    await db.execute(sql`INSERT INTO watbot_messages (conversation_id, user_id, role, blocks, status, created_at)
      SELECT t.conversation_id, t.user_id, 'student', '[{"text":"repair","citations":[]}]'::jsonb, 'answered', t.created_at + interval '1 minute'
      FROM watbot_feedback f JOIN watbot_messages t ON t.id = f.message_id
      JOIN watbot_conversations c ON c.id = t.conversation_id WHERE c.title = ${MARKER + "marker"} AND NOT f.helped ORDER BY f.id`);
    await db.execute(sql`UPDATE watbot_feedback f SET repair_message_id = m.id FROM watbot_messages t, watbot_messages m
      WHERE NOT f.helped AND t.id = f.message_id AND m.conversation_id = t.conversation_id AND m.role = 'student' AND m.created_at = t.created_at + interval '1 minute'
        AND f.user_id IN (SELECT id FROM users WHERE email LIKE ${MARKER + "%@test.com"})`);
    await db.execute(sql`WITH t AS (SELECT m.id, m.user_id, row_number() OVER (ORDER BY m.id) AS rn
        FROM watbot_messages m JOIN watbot_conversations c ON c.id = m.conversation_id WHERE c.title = ${MARKER + "marker"} AND m.role = 'tutor')
      INSERT INTO watbot_reports (user_id, message_id, reason, created_at) SELECT user_id, id, 'wrong_or_misleading', now() - interval '2 days' FROM t WHERE rn % 100 = 7`);
    await db.execute(sql`ANALYZE watbot_messages`);
    await db.execute(sql`ANALYZE watbot_feedback`);
    await db.execute(sql`ANALYZE watbot_reports`);
    const reg = await request(app).post("/api/auth/register").send({ email: `${MARKER}admin-${Date.now()}@test.com`, password: "correct horse battery", acceptTerms: true });
    await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, reg.body.user.id));
    cookie = (reg.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
  }, 600_000);

  afterAll(cleanup, 600_000);

  it.each(["/api/admin/watbot/metrics", "/api/admin/watbot/flagged", "/api/admin/feedback"])("%s answers a 90-day range in under 1 s (median of 3)", async (p) => {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const res = await request(app).get(`${p}?from=${range.from}&to=${range.to}`).set("Cookie", cookie);
      times.push(performance.now() - t0);
      expect(res.status).toBe(200);
    }
    const median = times.sort((a, b) => a - b)[1]!;
    console.log(`ADMIN_PERF ${p}: ${times.map(t => Math.round(t)).join(" / ")} ms, median ${Math.round(median)} ms`);
    expect(median).toBeLessThan(1000);
  }, 60_000);

  it("records EXPLAIN (ANALYZE, BUFFERS) and the flagged plan uses IDX_watbot_reports_message", async () => {
    const days = await explain(daysQuery(range)), flagged = await explain(flaggedQuery(range));
    mkdirSync(new URL("../../../../.harness/", import.meta.url), { recursive: true });
    writeFileSync(new URL("../../../../.harness/adm-explain.txt", import.meta.url), `== metrics days query ==\n${days}\n\n== flagged query ==\n${flagged}\n`);
    expect(flagged).toContain("IDX_watbot_reports_message");
    // the nearest-student and re-answer lookups must stay inside the conversation, never walk the whole table by id
    expect(flagged).toContain("IDX_watbot_messages_conversation");
    expect(flagged).not.toMatch(/using watbot_messages_pkey[^\n]*\n\s*Index Cond: \(id [<>]/);
  }, 60_000);
});
