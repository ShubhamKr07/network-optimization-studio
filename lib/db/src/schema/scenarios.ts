import { pgTable, serial, text, integer, jsonb, timestamp, varchar, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { usersTable } from "./auth.js";
import { solveJobsTable } from "./solve_jobs.js";

export const scenariosTable = pgTable("scenarios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  userId: varchar("user_id").notNull().references(() => usersTable.id),
  modelId: text("model_id").notNull(),
  inputs: jsonb("inputs").notNull().default({}).$type<Record<string, unknown>>(),
  inputsVersion: integer("inputs_version").notNull().default(1),
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  solvedAt: timestamp("solved_at"),
  inputsUpdatedAt: timestamp("inputs_updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  // Decision 1g — which solve_jobs row produced this row's current `result`.
  // Written in the SAME transaction as `result` (jobRunner), so the two can
  // never disagree. ON DELETE SET NULL, because scenario deletion removes the
  // child solve_jobs FIRST (routes/scenarios.ts) — a restrictive FK would
  // deadlock that order — and a null pointer is exactly the already-specified
  // "legacy, non-exportable" state.
  // The explicit `: AnyPgColumn` return annotation is REQUIRED — without it
  // TypeScript cannot resolve the scenarios <-> solve_jobs import cycle and
  // fails with an implicit-any / circular-inference error.
  resultRunId: integer("result_run_id").references((): AnyPgColumn => solveJobsTable.id, { onDelete: "set null" }),
}, (table) => [index("IDX_scenarios_user_id").on(table.userId)]);

export type Scenario = typeof scenariosTable.$inferSelect;
export type InsertScenario = typeof scenariosTable.$inferInsert;
