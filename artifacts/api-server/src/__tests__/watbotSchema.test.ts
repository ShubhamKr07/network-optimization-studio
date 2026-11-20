// artifacts/api-server/src/__tests__/watbotSchema.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { asc, eq, sql } from "drizzle-orm";
import {
  db, usersTable, coursePassagesTable, watbotConversationsTable,
  watbotMessagesTable, watbotReportsTable, watbotSessionsView,
} from "@workspace/db";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

async function newUser() {
  const [user] = await db.insert(usersTable)
    .values({ email: `watbot-schema-${Date.now()}-${Math.random()}@test.com` } as typeof usersTable.$inferInsert)
    .returning();
  createdUserIds.push(user!.id);
  return user!.id;
}

describe("watbot schema", () => {
  it("declares every timestamp as timestamptz", () => {
    for (const t of [coursePassagesTable, watbotConversationsTable, watbotMessagesTable, watbotReportsTable]) {
      for (const c of getTableConfig(t).columns) {
        if (c.columnType === "PgTimestamp") expect((c as unknown as { withTimezone: boolean }).withTimezone).toBe(true);
      }
    }
  });

  it("cascades a user delete through conversations, messages and reports", async () => {
    const userId = await newUser();
    const [conv] = await db.insert(watbotConversationsTable)
      .values({ userId, modelId: "p-median-us", title: "t" }).returning();
    const [msg] = await db.insert(watbotMessagesTable)
      .values({ conversationId: conv!.id, userId, role: "tutor", blocks: [{ text: "x", citations: [] }], latencyMs: 1200, gapTopic: "rail freight (nearest covered: outbound transportation)" })
      .returning();
    await db.insert(watbotReportsTable)
      .values({ userId, messageId: msg!.id, reason: "other" });

    await db.delete(usersTable).where(eq(usersTable.id, userId));

    expect(await db.select().from(watbotConversationsTable).where(eq(watbotConversationsTable.id, conv!.id))).toHaveLength(0);
    expect(await db.select().from(watbotMessagesTable).where(eq(watbotMessagesTable.id, msg!.id))).toHaveLength(0);
    expect(await db.select().from(watbotReportsTable).where(eq(watbotReportsTable.userId, userId))).toHaveLength(0);
  });

  it("defaults a message's status to answered and its type to null", async () => {
    const userId = await newUser();
    const [conv] = await db.insert(watbotConversationsTable).values({ userId, modelId: "p-median-us", title: "t" }).returning();
    const [msg] = await db.insert(watbotMessagesTable)
      .values({ conversationId: conv!.id, userId, role: "student", blocks: [] }).returning();
    expect(msg!.status).toBe("answered");
    expect(msg!.messageType).toBeNull();
  });

  // Spec §6 sessions view: per (user, model), a gap > 30 min starts a new session;
  // only answered student messages count.
  it("watbot_sessions splits on a 31-minute gap, not a 29-minute one, and per model", async () => {
    const userId = await newUser();
    const [pm] = await db.insert(watbotConversationsTable).values({ userId, modelId: "p-median-us", title: "a" }).returning();
    const [jade] = await db.insert(watbotConversationsTable).values({ userId, modelId: "two-echelon-jade-us", title: "b" }).returning();
    const t = new Date("2026-11-20T10:00:00Z").getTime();
    const at = (min: number) => new Date(t + min * 60_000);
    const student = (conversationId: number, createdAt: Date, status: "answered" | "limit_reached" = "answered") =>
      ({ conversationId, userId, role: "student", blocks: [], createdAt, status });
    await db.insert(watbotMessagesTable).values([
      student(pm!.id, at(0)),
      student(pm!.id, at(29)),                    // 29 min after t → same session
      student(pm!.id, at(45), "limit_reached"),   // turned away → not in the view
      student(pm!.id, at(60)),                    // 31 min after t+29 → new session
      student(jade!.id, at(10)),                  // other model → its own session
      { conversationId: pm!.id, userId, role: "tutor", blocks: [], createdAt: at(1) }, // tutor rows never count
    ]);

    const rows = await db.select().from(watbotSessionsView)
      .where(eq(watbotSessionsView.userId, userId))
      .orderBy(asc(watbotSessionsView.modelId), asc(watbotSessionsView.sessionNo));

    expect(rows.map((r) => [r.modelId, r.sessionNo, r.messages])).toEqual([
      ["p-median-us", 1, 2],
      ["p-median-us", 2, 1],
      ["two-echelon-jade-us", 1, 1],
    ]);
    expect(rows[0]!.startedAt.toISOString()).toBe(at(0).toISOString());
    expect(rows[0]!.endedAt.toISOString()).toBe(at(29).toISOString());
  });

  it("generates a searchable tsvector for course passages", async () => {
    const [p] = await db.insert(coursePassagesTable).values({
      sourceKind: "book", chapter: 901, locator: "1", ordinal: 0,
      label: "Ch 901 · p.1", body: "Capacitated warehouses change assignments",
    }).returning();
    try {
      const rows = await db.execute(
        sql`select id from course_passages where id = ${p!.id} and tsv @@ websearch_to_tsquery('english', 'capacitated warehouse')`,
      );
      expect(rows.rows).toHaveLength(1);
    } finally {
      await db.delete(coursePassagesTable).where(eq(coursePassagesTable.id, p!.id));
    }
  });
});
