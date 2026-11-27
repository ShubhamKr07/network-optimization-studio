import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

// TODO(remove after v2 stabilizes): unused by the email/password cookie session in A1.3.
export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  passwordHash: varchar("password_hash"),
  // Password reset (PWR). Both nullable: a row has a live token or it does
  // not, and nulling the pair is what makes a token single-use. Nullable also
  // means `drizzle-kit push` needs no two-step NOT NULL protocol.
  resetTokenHash: varchar("reset_token_hash"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
  // WQF-B (spec B3) — the terms acceptance record. Both nullable, no backfill:
  // a null version means "has not accepted the CURRENT terms", which signs the
  // user out (middlewares/auth.ts) until they log in with the box ticked.
  // NOT NULL would need hard rule #3's two-step protocol. timestamptz per
  // lib/db/CLAUDE.md; written DB-side (now()) by both writers (D3).
  termsVersion: text("terms_version"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  role: varchar("role").notNull().default("student"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [check("CK_users_role", sql`${t.role} IN ('student', 'instructor', 'admin')`)]);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
