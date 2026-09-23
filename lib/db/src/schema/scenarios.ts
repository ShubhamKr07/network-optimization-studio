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
  // A1 (SCND Correctness) — latest-request publication authority (A-R32).
  // Set to the new job's id ATOMICALLY with enqueue (same transaction as the
  // solve_jobs insert), and only when the new job id is greater than the
  // stored one — so two concurrent enqueues committing in inverted order
  // can't let the older job win. Deliberately separate from `resultRunId`
  // (which stays provenance of the CURRENTLY PUBLISHED result, written at
  // publish time — it cannot tell whether an older job is stale after a
  // newer one was requested). Nullable Class 1: a pre-A1 scenario that has
  // never been re-solved since has none.
  latestSolveJobId: integer("latest_solve_job_id").references((): AnyPgColumn => solveJobsTable.id, { onDelete: "set null" }),
  // A1 — Class 2 (live-row state), hard rule #3's THREE-step protocol:
  // (a) add nullable [this commit's first `drizzle-kit push`]
  // (b) explicit backfill `UPDATE scenarios SET solve_input_revision = 1
  //     WHERE solve_input_revision IS NULL` (scripts/src/
  //     migrate-solve-input-revision.ts)
  // (c) enforce NOT NULL (this field's final committed shape, `.notNull()`
  //     below) + a `.default(1)` for future inserts.
  // A null here would make A7's publication CAS `revision =
  // enqueued_revision` evaluate to UNKNOWN and silently block publication
  // for every pre-existing scenario — unlike solve_jobs' Class 1 columns, a
  // null here is NOT honest ignorance (every existing scenario has a real
  // current revision, conceptually 1). A plain `.default(1)` alone is NOT a
  // substitute for the three-step protocol (`drizzle-kit push` keeps no
  // migration history, the whole reason the rule exists) — the explicit
  // backfill step (b) must run before this column is declared NOT NULL.
  // Every solve-relevant input writer increments this via SQL
  // `solve_input_revision = solve_input_revision + 1` (never a
  // read-modify-write in app code) EXCEPT reporting-only `distanceBands`
  // edits (routes/distanceBands.ts), which are a reporting lens, not a
  // model-geometric change.
  solveInputRevision: integer("solve_input_revision").notNull().default(1),
}, (table) => [
  index("IDX_scenarios_user_id").on(table.userId),
  index("IDX_scenarios_latest_solve_job_id").on(table.latestSolveJobId),
]);

export type Scenario = typeof scenariosTable.$inferSelect;
export type InsertScenario = typeof scenariosTable.$inferInsert;
