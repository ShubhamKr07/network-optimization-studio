import { pgTable, serial, integer, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./auth.js";
import { scenariosTable } from "./scenarios.js";

// Phase 3.5 (G3.1) — doubles as the async solve queue and (G3.2) the
// solve-history feature. status: queued|running|succeeded|failed.
export const solveJobsTable = pgTable("solve_jobs", {
  id: serial("id").primaryKey(),
  scenarioId: integer("scenario_id").notNull().references(() => scenariosTable.id),
  userId: varchar("user_id").notNull().references(() => usersTable.id),
  status: varchar("status").notNull().default("queued"),
  inputsHash: varchar("inputs_hash").notNull(),
  resultSummary: jsonb("result_summary").$type<Record<string, unknown> | null>(),
  error: text("error"),
  queuedAt: timestamp("queued_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
}, (table) => [index("IDX_solve_jobs_user_id").on(table.userId)]);

export type SolveJob = typeof solveJobsTable.$inferSelect;
export type InsertSolveJob = typeof solveJobsTable.$inferInsert;
