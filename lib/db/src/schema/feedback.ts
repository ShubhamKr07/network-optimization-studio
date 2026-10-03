import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// COSM-4 — anonymous-at-rest feedback. The ABSENCE of an account/session/IP
// column is the privacy guarantee, not an oversight: the route authenticates
// the caller (to rate-limit them) but deliberately never persists who they
// are, which is what lets the UI say "Stored without your account ID".
// Adding a user column here silently breaks that promise — don't.
export const feedbackTable = pgTable("feedback", {
  id: serial("id").primaryKey(),
  /** Trimmed by the route before insert; 1-4000 chars enforced server-side. */
  body: text("body").notNull(),
  // HND-B — timestamptz is load-bearing. Written only by defaultNow()
  // (DB-local wall-clock), so as a naked timestamp every row would be wrong
  // by the database's UTC offset. See docs/ops/timestamptz-migration.md.
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Feedback = typeof feedbackTable.$inferSelect;
export type InsertFeedback = typeof feedbackTable.$inferInsert;
