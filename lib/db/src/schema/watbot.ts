// lib/db/src/schema/watbot.ts
import { sql } from "drizzle-orm";
import {
  customType, index, integer, interval, jsonb, pgTable, pgView, serial, text, timestamp, uniqueIndex, varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth.js";

// WATBOT — course corpus + tutor conversations. Every user FK cascades so a
// manual account deletion (there is no self-serve delete) removes the
// student's WatBot data with it, and purge-test-users keeps working unchanged.

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

// FR-37 — the five message types, recorded on student rows via the
// record_message_type tool (spec D18). Order is the spec's order.
export const WATBOT_MESSAGE_TYPES = [
  "concept_question", "incorrect_attempt", "correct_attempt", "stuck_or_wants_answer", "off_topic",
] as const;
export type WatBotMessageType = (typeof WATBOT_MESSAGE_TYPES)[number];

// FR-35 / D22 — only "answered" (the question reached the model) counts toward the
// 24 h student limit. "cancelled" = stopped before any round reached the model;
// "unavailable" / "limit_reached" = turned away. All are logged.
export const WATBOT_MESSAGE_STATUSES = ["answered", "cancelled", "unavailable", "limit_reached"] as const;
export type WatBotMessageStatus = (typeof WATBOT_MESSAGE_STATUSES)[number];

export type WatBotCitation = { passageId: number; label: string; citedText: string };
export type WatBotBlock = { text: string; citations: WatBotCitation[] };
export type WatBotUsage = {
  model: string; inputTokens: number; outputTokens: number;
  cacheReadTokens: number; cacheWriteTokens: number; costUsd: number;
  // D22: true when a stopped answer's output tokens were estimated (forwarded chars ÷ 4)
  // because no message_delta usage had arrived yet.
  estimated?: boolean;
};
export type WatBotContext = { tab: string | null; scenarioId: number | null; summary: string };

export const coursePassagesTable = pgTable("course_passages", {
  id: serial("id").primaryKey(),
  sourceKind: varchar("source_kind", { length: 16 }).notNull(), // 'book' | 'notebook'
  chapter: integer("chapter").notNull(),
  locator: varchar("locator", { length: 32 }).notNull(),       // printed page or notebook cell
  ordinal: integer("ordinal").notNull(),                        // reading order within the chapter
  label: text("label").notNull(),                               // "Ch 3 · p.78" / "NB 3 · cell 9"
  body: text("body").notNull(),
  tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', body)`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("UQ_course_passages_source").on(t.sourceKind, t.chapter, t.locator),
  index("IDX_course_passages_order").on(t.sourceKind, t.chapter, t.ordinal),
  index("IDX_course_passages_tsv").using("gin", t.tsv),
]);

export const watbotConversationsTable = pgTable("watbot_conversations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  modelId: varchar("model_id").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("IDX_watbot_conversations_user_model").on(t.userId, t.modelId, t.updatedAt)]);

export const watbotMessagesTable = pgTable("watbot_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull()
    .references(() => watbotConversationsTable.id, { onDelete: "cascade" }),
  // Denormalised so the rolling-24h student count is one indexed query.
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 16 }).notNull(), // 'student' | 'tutor' | 'notice'
  blocks: jsonb("blocks").$type<WatBotBlock[]>().notNull(),
  context: jsonb("context").$type<WatBotContext>(),
  // Student rows: the FR-37 type the model recorded; null on tutor/notice rows
  // or when the model skipped record_message_type.
  messageType: varchar("message_type", { length: 32 }).$type<WatBotMessageType>(),
  // Student rows: answered | cancelled | unavailable | limit_reached; only answered counts. Tutor/notice rows keep the default.
  status: varchar("status", { length: 16 }).$type<WatBotMessageStatus>().notNull().default("answered"),
  usage: jsonb("usage").$type<WatBotUsage>(),  // tutor rows: summed over rounds
  latencyMs: integer("latency_ms"),            // tutor rows: request start to done
  gapTopic: text("gap_topic"),                 // tutor rows: set by log_gap (FR-27)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("IDX_watbot_messages_conversation").on(t.conversationId, t.createdAt),
  index("IDX_watbot_messages_user_role").on(t.userId, t.role, t.createdAt),
]);

export const watbotReportsTable = pgTable("watbot_reports", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  messageId: integer("message_id").notNull().references(() => watbotMessagesTable.id, { onDelete: "cascade" }),
  reason: varchar("reason", { length: 32 }),        // wrong_or_misleading | citation_unsupported | not_what_i_asked | other
  note: text("note"),
  context: jsonb("context").$type<WatBotContext>(),
  sources: jsonb("sources").$type<WatBotCitation[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Spec §6 / D17 — the PRD draft's sessions view, partitioned by (user, model) so
// "sessions per exercise" needs no attribution step. Answered student messages
// only; a gap > 30 minutes starts a new session (lag + running sum).
// If Task 1 Step 5 finds drizzle-kit does not create this view, replace
// the .as(...) call with .existing() and create it from docs/ops/watbot-corpus.md.
export const watbotSessionsView = pgView("watbot_sessions", {
  userId: varchar("user_id").notNull(),
  modelId: varchar("model_id").notNull(),
  sessionNo: integer("session_no").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  messages: integer("messages").notNull(),
  duration: interval("duration").notNull(),
}).as(sql`
  with m as (
    select wm.user_id, wc.model_id, wm.created_at,
           case when lag(wm.created_at) over w is null
                  or wm.created_at - lag(wm.created_at) over w > interval '30 minutes'
                then 1 else 0 end as is_new
    from watbot_messages wm
    join watbot_conversations wc on wc.id = wm.conversation_id
    where wm.role = 'student' and wm.status = 'answered'
    window w as (partition by wm.user_id, wc.model_id order by wm.created_at)
  ), s as (
    select user_id, model_id, created_at,
           sum(is_new) over (partition by user_id, model_id order by created_at
                             rows between unbounded preceding and current row) as session_no
    from m
  )
  select user_id, model_id, session_no::int as session_no,
         min(created_at) as started_at, max(created_at) as ended_at,
         count(*)::int as messages, max(created_at) - min(created_at) as duration
  from s
  group by user_id, model_id, session_no
`);
export type CoursePassage = typeof coursePassagesTable.$inferSelect;
export type WatBotConversation = typeof watbotConversationsTable.$inferSelect;
export type WatBotMessage = typeof watbotMessagesTable.$inferSelect;
export type WatBotReport = typeof watbotReportsTable.$inferSelect;
