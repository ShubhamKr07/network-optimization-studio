import { pgTable, serial, integer, varchar, text, jsonb, timestamp, index, uniqueIndex, doublePrecision, check, pgSequence } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./auth.js";
import { scenariosTable } from "./scenarios.js";

// A1 (SCND Correctness) — claim_generation's authority. A Postgres sequence
// is durable + monotonic across boot/crash by construction (unlike a
// random UUID, which is an ownership TOKEN, not an ordering value). A2's
// boot reads `nextval('solve_jobs_claim_generation_seq')` once and stamps
// it on every job it claims in that process lifetime; A1 only creates the
// sequence + the column that will hold it.
export const solveJobsClaimGenerationSeq = pgSequence("solve_jobs_claim_generation_seq", {
  startWith: 1,
  minValue: 1,
  increment: 1,
});

// Phase 3.5 (G3.1) — doubles as the async solve queue and (G3.2) the
// solve-history feature. status: queued|running|succeeded|failed.
//
// A1 (SCND Correctness, 2026-09) adds the durable-payload / ownership-
// liveness / failure / requested-limit columns below. Two column classes,
// opposite treatments (plan A-R57):
//   - Class 1 (unknowable history): failure_*, error_*, requested_*,
//     model_id, input_snapshot, claim_generation/claimed_at/
//     owner_heartbeat_at, enqueued_solve_input_revision,
//     recovery_contract_identity. Added NULLABLE; historical (pre-A1) rows
//     stay null FOREVER — never backfilled, never fabricated. A null here
//     truthfully means "this job predates the field."
//   - Class 2 lives on `scenarios` (solve_input_revision), not here — see
//     that schema file's own header for the three-step NOT NULL protocol.
export const solveJobsTable = pgTable("solve_jobs", {
  id: serial("id").primaryKey(),
  scenarioId: integer("scenario_id").notNull().references(() => scenariosTable.id),
  userId: varchar("user_id").notNull().references(() => usersTable.id),
  status: varchar("status").notNull().default("queued"),
  inputsHash: varchar("inputs_hash").notNull(),
  resultSummary: jsonb("result_summary").$type<Record<string, unknown> | null>(),
  error: text("error"),
  // HND-B — `withTimezone: true` is LOAD-BEARING, not cosmetic. As a naked
  // `timestamp`, drizzle writes and reads these as UTC wall-clock, but
  // `defaultNow()`/`sql`now()`` store the DB session's LOCAL wall-clock — so
  // every value written DB-side read back wrong by the database's UTC offset,
  // which is how the solve overlay came to display "Solving 25200s" (exactly
  // 7h, the America/Los_Angeles offset the server reports). Measured, not
  // inferred: 131 of 160 local rows had `finished_at - started_at` = exactly
  // 25200. As `timestamptz` the stored value is an instant, so the DB clock
  // and a JS `new Date()` agree and no zone setting can reintroduce the skew.
  // See docs/ops/timestamptz-migration.md. Do NOT drop `withTimezone`.
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  // Part F — the run's FULL result envelope, so a historical export can be
  // addressed by run id. Deliberately NOT a join to result_cache: that table's
  // contract is a cache, and adding eviction later would silently break
  // historical export. Nullable: pre-migration rows have none.
  result: jsonb("result").$type<Record<string, unknown> | null>(),

  // ---------------------------------------------------------------------
  // A1 — durable payload. `model_id` + a validated `input_snapshot` is what
  // makes a queued row executable after process loss — without it, a row
  // surviving a restart has nothing to re-run. Written atomically at
  // enqueue (jobRunner.ts's enqueueScenarioSolve); historical rows null.
  // ---------------------------------------------------------------------
  modelId: text("model_id"),
  inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown> | null>(),

  // ---------------------------------------------------------------------
  // A1 — failure taxonomy (Class 1, nullable). `failureReason`/`failureStage`
  // mirror solverProcessMessage.ts's SolverFailureReasonSchema /
  // SolverFailureStageSchema verbatim; `errorCode` mirrors the future public
  // enum (§2.11, A5 activates the serializer) `{SOLVE_FAILED, TIMEOUT}`.
  // TypeScript enums are the authority — these CHECK constraints hand-mirror
  // them (lib/db cannot import artifacts/api-server; that dependency would
  // invert the package graph), so keep the literal lists below in sync by
  // hand with solverProcessMessage.ts if either enum ever changes.
  // `errorDetail`'s 2048-BYTE bound is enforced in application code before
  // persistence AND mirrored here via `octet_length` (not `length()` —
  // Postgres `length()` counts characters, admitting ~4x budget on
  // multibyte diagnostics).
  // ---------------------------------------------------------------------
  failureReason: varchar("failure_reason"),
  failureStage: varchar("failure_stage"),
  errorCode: varchar("error_code"),
  errorDetail: text("error_detail"),

  // ---------------------------------------------------------------------
  // A1 — requested-limit columns (Q79, Class 1 nullable). `source` is
  // pinned to the literal 'request' for this contract version (§2.12: "source
  // is always request") — do NOT add a `default` value here; that needs
  // separately authorized product work.
  // ---------------------------------------------------------------------
  requestedGap: doublePrecision("requested_gap"),
  requestedTimeLimitSec: integer("requested_time_limit_sec"),
  requestedGapSource: varchar("requested_gap_source"),
  requestedTimeLimitSource: varchar("requested_time_limit_source"),

  // ---------------------------------------------------------------------
  // A1 — ownership/liveness (nullable). A2 owns the claim/lease/heartbeat
  // loop that writes these; A1 only creates the columns (+ the sequence
  // above for claim_generation's authority).
  // ---------------------------------------------------------------------
  claimGeneration: integer("claim_generation"),
  // HND-B — timestamptz, same reason as queued/started/finished above. These
  // two matter for a second reason: the stale-lease takeover compares
  // `owner_heartbeat_at < now() - interval '60 seconds'` (jobRunner.ts:617).
  // That comparison was never WRONG, because both sides were DB-side — but it
  // is only safe by coincidence while the column is naked, and it would break
  // outright if a writer ever switched to a JS `new Date()`. As timestamptz it
  // is correct for either writer.
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  ownerHeartbeatAt: timestamp("owner_heartbeat_at", { withTimezone: true }),

  // ---------------------------------------------------------------------
  // A1 — publication authority inputs. `enqueuedSolveInputRevision` captures
  // the scenario's `solve_input_revision` at the moment this job was
  // enqueued (inside the same locked transaction) — A7's publication CAS
  // tests a completed job's stored value against the scenario's CURRENT
  // `solve_input_revision`. `recoveryContractIdentity` is the full,
  // untruncated sorted/length-framed manifest hash (see
  // solver/recoveryContractIdentity.ts) computed and persisted at enqueue;
  // A2 recomputes + compares it at claim time. Scope: recovery only — the
  // solve result CACHE key is unchanged (stays on SOLVER_CODE_HASH until A6).
  // ---------------------------------------------------------------------
  enqueuedSolveInputRevision: integer("enqueued_solve_input_revision"),
  recoveryContractIdentity: text("recovery_contract_identity"),
}, (table) => [
  index("IDX_solve_jobs_user_id").on(table.userId),
  // A2's recurring dispatcher scan claims oldest-first — ordered so a bare
  // (status) partial index can't serve that ordering.
  index("IDX_solve_jobs_queued_status").on(table.queuedAt, table.id).where(sql`${table.status} = 'queued'`),
  // Stale-lease recovery (A2): find running rows whose heartbeat has gone
  // quiet.
  index("IDX_solve_jobs_owner_heartbeat_running").on(table.ownerHeartbeatAt).where(sql`${table.status} = 'running'`),
  // CH4-11 — at most ONE active job per scenario, enforced by the DATABASE.
  // enqueueScenarioSolve locks the scenario row and then inserts WITHOUT
  // checking for an existing job; the row lock serialises the two
  // transactions but does not make the second one refuse. This index does.
  // It matters more for max-coverage-us than for a single-objective model
  // because the target step is DERIVED FROM STATE (CH4-9): two Step 1
  // enqueues at `0 of 2` race, and whichever publishes second decides what
  // `1 of 2` means. Belt-and-braces with the in-transaction guard, the same
  // posture lockedModelGuards.test.ts applies to route guards.
  // R1 — SCOPED TO CHAPTER 4. The predicate carries `model_id` as well as
  // status. An unscoped index would silently impose one-active-job on all seven
  // models, contradicting this plan's own "no change to the other six" scope
  // line, and would break scenarioSolveAtomicity.test.ts, which deliberately
  // enqueues a second p-median-us job while the first is still queued (9 call
  // sites). A repo-wide policy is a separate decision with its own migration
  // and compatibility review — not something to smuggle in here.
  uniqueIndex("UQ_solve_jobs_active_per_scenario")
    .on(table.scenarioId)
    .where(sql`${table.modelId} = 'max-coverage-us' AND ${table.status} IN ('queued', 'running')`),
  check(
    // A2 adds 'data_error' — the internal failureReason for a recovery-
    // contract-identity mismatch caught at claim time (A-R33/A-R40/A-R47:
    // "internal failureReason='data_error', failureStage='validate'").
    // A5 adds 'timeout'/'interrupted' — the two A3.T Terminal kinds
    // (TT-1/TT-2) that are their own top-level outcomes, not a `failed`-kind
    // classification carried on the fd3 message, but are still real
    // failureReason values per §2.11's canonical internal enum
    // (`solver_error | data_error | model_error | internal_error | timeout |
    // interrupted`) — needed so the public errorCode/errorMessage
    // serializer (A5) can distinguish "Solve interrupted" from the generic
    // "Solve failed" purely from typed columns, never from free-text `error`.
    // A1 shipped this CHECK before either case existed; extending an IN-list
    // CHECK on an already-nullable column is additive (no NOT NULL migration,
    // hard rule #3's protocol doesn't apply) — deviation noted per hard rule
    // #8, smallest correct fix (same precedent A2 already established here).
    "CK_solve_jobs_failure_reason",
    sql`${table.failureReason} IS NULL OR ${table.failureReason} IN ('internal_error', 'solver_error', 'data_error', 'timeout', 'interrupted')`,
  ),
  check(
    // A2 adds 'validate' — the failureStage half of the data_error case
    // above. A5 adds 'reaper' — reapStaleLeases' own interrupted-by-lease-
    // expiry case (§2.11: "interrupted (cancel / deploy / server-restart-
    // reaper / external kill)"), same additive-CHECK precedent as above.
    "CK_solve_jobs_failure_stage",
    sql`${table.failureStage} IS NULL OR ${table.failureStage} IN (
      'timeout', 'spawn', 'protocol', 'exit', 'dataset_load', 'dispatch',
      'input_parse', 'solve_exception', 'cbc_parse', 'validate', 'reaper'
    )`,
  ),
  check(
    "CK_solve_jobs_error_code",
    sql`${table.errorCode} IS NULL OR ${table.errorCode} IN ('SOLVE_FAILED', 'TIMEOUT')`,
  ),
  check(
    "CK_solve_jobs_error_detail_bytes",
    sql`${table.errorDetail} IS NULL OR octet_length(${table.errorDetail}) <= 2048`,
  ),
  check(
    "CK_solve_jobs_requested_gap_source",
    sql`${table.requestedGapSource} IS NULL OR ${table.requestedGapSource} = 'request'`,
  ),
  check(
    "CK_solve_jobs_requested_time_limit_source",
    sql`${table.requestedTimeLimitSource} IS NULL OR ${table.requestedTimeLimitSource} = 'request'`,
  ),
]);

export type SolveJob = typeof solveJobsTable.$inferSelect;
export type InsertSolveJob = typeof solveJobsTable.$inferInsert;
