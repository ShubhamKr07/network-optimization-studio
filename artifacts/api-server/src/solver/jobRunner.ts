import { spawn } from "child_process";
import os from "os";
import { existsSync, readFileSync } from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { and, asc, eq, inArray, isNull, isNotNull, lt, or, sql } from "drizzle-orm";
import { db, solveJobsTable, scenariosTable, resultCacheTable } from "@workspace/db";
import type { InsertSolveJob, SolveJob } from "@workspace/db";
import { readVersion } from "@workspace/dataset-schema";
import { logger } from "../lib/logger.js";
import { ResultEnvelopeSchema } from "./resultEnvelope.js";
import type { ResultEnvelope } from "./resultEnvelope.js";
import { buildPayload } from "./pmedian.js";
import type { SolveInput } from "./pmedian.js";
import { getManifest } from "../registry/modelRegistry.js";
import { posthog } from "../lib/posthog.js";
import { captureSolveFailure } from "../lib/sentry.js";
import { validateInputsForModel } from "../validation/inputs/index.js";
import { runNetworkEditsPrecheckForModel } from "../services/precheck.js";
import type { PrecheckResult } from "../services/precheck.js";
import { computeRecoveryContractIdentity } from "./recoveryContractIdentity.js";
import { computeSolverContractIdentity } from "./solverContractIdentity.js";
import { isV2WriteEnabled } from "../config/featureFlags.js";
import {
  classifyFd3Message,
  classifyTerminal,
  type SolverSuccessEnvelopeV2,
  type TerminalOutcome,
} from "./solverProcessMessage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// __dirname's depth relative to the repo root differs depending on how this
// module is loaded: unbundled (vitest, tsx) it's the true source location
// (artifacts/api-server/src/solver), but esbuild's bundle (build.mjs,
// bundle: true) collapses import.meta.url for every merged module to the
// single output file's location (artifacts/api-server/dist/index.mjs) —
// one level shallower. Walk up to the workspace root marker instead of
// hardcoding a parent count, so both contexts resolve correctly (same
// pattern as data/dataset.ts's findRepoRoot — confirmed against the real
// built server, not just vitest, per that gotcha).
function findRepoRoot(from: string): string {
  let dir = from;
  while (!existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not locate repo root (pnpm-workspace.yaml) from " + from);
    dir = parent;
  }
  return dir;
}

const SOLVER_PY = path.join(findRepoRoot(__dirname), "artifacts", "api-server", "src", "solver", "solve.py");

// Cache key must change when solver logic changes, not just when the dataset
// version bumps — otherwise a fixed solver returns the pre-fix cached result.
// Hashing solve.py's bytes means any edit to the solver invalidates every
// cached entry, so a deployed solver fix can never silently serve the stale,
// pre-fix result from the cache. [S2]
const SOLVER_CODE_HASH = crypto
  .createHash("sha256")
  .update(readFileSync(SOLVER_PY))
  .digest("hex")
  .slice(0, 12);

// A1 (SCND Correctness) — RECOVERY_CONTRACT_IDENTITY. See
// recoveryContractIdentity.ts's own header for the full rationale; this is
// a SEPARATE, FULLER identity than SOLVER_CODE_HASH above (recovery, not
// cache-key, scope — the cache key is unchanged until A6). Computed ONCE,
// eagerly, at module load — same fail-closed pattern as SOLVER_CODE_HASH:
// an underivable component throws here, crashing this module's import and
// therefore server boot (jobRunner.ts is imported synchronously via
// routes/scenarios.ts during app wiring).
const CBC_TERMINATION_PY = path.join(findRepoRoot(__dirname), "artifacts", "api-server", "src", "solver", "cbc_termination.py");
const RESULT_ENVELOPE_TS = path.join(findRepoRoot(__dirname), "artifacts", "api-server", "src", "solver", "resultEnvelope.ts");
const SOLVER_PROCESS_MESSAGE_TS = path.join(findRepoRoot(__dirname), "artifacts", "api-server", "src", "solver", "solverProcessMessage.ts");

export const RECOVERY_CONTRACT_IDENTITY = computeRecoveryContractIdentity({
  solvePyPath: SOLVER_PY,
  cbcTerminationPyPath: CBC_TERMINATION_PY,
  resultEnvelopeTsPath: RESULT_ENVELOPE_TS,
  solverProcessMessageTsPath: SOLVER_PROCESS_MESSAGE_TS,
});

// A6 (SCND Correctness) — SOLVER_CONTRACT_IDENTITY: the composite cache-key
// manifest, per the approved G-cache artifact (docs/superpowers/specs/
// 2026-09-23-scnd-gcache-artifact.md). Reuses A1's EXACT manifest above
// (same file paths, same PuLP/CBC runtime probe, same dataset components)
// plus solverContractIdentity.ts's SOLVER_CONTRACT_VERSION constant — "one
// manifest, two consumers, two different final hashes": RECOVERY_CONTRACT_IDENTITY
// above governs A2's claim-time recovery check only; this constant governs
// ONLY the v2 cache key (computeInputsHashV2 below), itself gated
// end-to-end behind isV2WriteEnabled() (A11). Computed once, eagerly, at
// module load — same fail-closed pattern as RECOVERY_CONTRACT_IDENTITY: an
// underivable component throws here too, crashing this module's import and
// therefore server boot, regardless of whether the v2 flag is even on (the
// identity must be derivable at boot so flipping the flag later never needs
// a restart-time surprise).
export const SOLVER_CONTRACT_IDENTITY = computeSolverContractIdentity({
  solvePyPath: SOLVER_PY,
  cbcTerminationPyPath: CBC_TERMINATION_PY,
  resultEnvelopeTsPath: RESULT_ENVELOPE_TS,
  solverProcessMessageTsPath: SOLVER_PROCESS_MESSAGE_TS,
});

// A2 — the fixed, safe, retryable public message for a recovery-contract
// version mismatch caught at claim time (A-R33/A-R40/A-R47). A5 will adopt
// this EXACT string as the permanent errorMessage for this case — kept
// identical here so the string never changes when A5 lands (per the plan's
// own instruction). Internal taxonomy: failureReason='data_error',
// failureStage='validate', public errorCode='SOLVE_FAILED'.
export const VERSION_MISMATCH_SAFE_MESSAGE = "Solve could not run — please try again";

// A2 — the same safe message reused for Phase 2's one-shot legacy-row
// cleanup (null-lease transitional rows + historical null-snapshot rows) —
// both are "this job can never be honestly re-run," the same public shape
// as a version mismatch.
const LEGACY_UNRECOVERABLE_SAFE_MESSAGE = VERSION_MISMATCH_SAFE_MESSAGE;

// Small in-process worker pool (Phase 3.5, G3.1) — replaces the old
// blocking spawnSync call. Pilot cohort is assumed <=10 concurrent users
// (§0.5 OQ2), so a simple array-based queue + fixed concurrency is enough;
// genuine throughput scaling (Phase 6, P1.1) tunes the two knobs below via
// env vars but keeps this same array-based design — no separate process/
// service split, that's explicitly out of scope until a real pilot proves
// a single Node process is the bottleneck.

// Parses a positive integer out of an env var, falling back to `fallback`
// when the var is unset, blank, non-numeric, non-integer, or <= 0. Exported
// as a pure function (rather than inlined at module load) so it's directly
// unit-testable without needing to reload the module per env-var value.
export function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// Default kept modest (matches the Phase 3.5 default) — the plan explicitly
// says to size this "based on measured host CPU/memory headroom," and this
// pilot has no such measurement yet. Operators should tune
// SOLVE_WORKER_CONCURRENCY based on their own host once they have one.
const DEFAULT_CONCURRENCY = 3;
const CONCURRENCY = parsePositiveIntEnv(process.env.SOLVE_WORKER_CONCURRENCY, DEFAULT_CONCURRENCY);

// Backpressure threshold: how many jobs may wait in `queue` (not yet
// running — `activeCount` jobs already have a worker slot and aren't a
// capacity problem) before the route layer starts shedding load with 429s.
// Default 30: the pilot is assumed <=10 concurrent users (§0.5 OQ2), so a
// healthy queue should rarely exceed single digits; 30 gives ~3x headroom
// above that assumed ceiling for a burst before rejecting new solves, while
// still bounding the memory `pendingJobs` can hold (each entry carries a
// full SolveInput payload). Tune via SOLVE_QUEUE_DEPTH_LIMIT.
const DEFAULT_QUEUE_DEPTH_LIMIT = 30;
export const QUEUE_DEPTH_LIMIT = parsePositiveIntEnv(process.env.SOLVE_QUEUE_DEPTH_LIMIT, DEFAULT_QUEUE_DEPTH_LIMIT);

let activeCount = 0;
const queue: number[] = [];
interface PendingJobHint {
  scenarioId: number;
  userId: string;
  input: SolveInput;
}
const pendingJobs = new Map<number, PendingJobHint>();
// A2 — tracked so SIGTERM drain can wait for genuinely in-flight jobs to
// settle (or force-cancel them) without touching never-claimed `queue`
// entries, which must stay `queued` in the DB untouched (shutdown category 1).
const activeJobPromises = new Map<number, Promise<void>>();

// A2 — drain gate for the in-process dispatch pump. Sim SIGTERM stops
// ADMITTING new claims (this flag) while an already-executing job keeps
// running/heartbeating to completion or forced cancellation — see
// drainForShutdown() below.
let draining = false;
export function setDraining(v: boolean): void {
  draining = v;
}
export function isDraining(): boolean {
  return draining;
}

// Jobs waiting for a free worker slot — the number the route layer's
// backpressure check cares about. Deliberately excludes `activeCount`
// (already-running jobs aren't a queuing/capacity problem).
export function getQueueDepth(): number {
  return queue.length;
}

export function getActiveJobIds(): number[] {
  return [...activeJobPromises.keys()];
}

// A2 — waits up to `graceMs` for every currently in-flight job promise to
// settle. Returns true if all settled within the grace period, false if the
// grace period elapsed first (caller decides what to do next — e.g.
// force-cancel). A zero-active-job case resolves immediately.
export async function waitForActiveJobsToDrain(graceMs: number): Promise<boolean> {
  const promises = [...activeJobPromises.values()];
  if (promises.length === 0) return true;
  let timer: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), graceMs);
  });
  const allSettled = Promise.allSettled(promises).then(() => true);
  const result = await Promise.race([allSettled, timedOut]);
  clearTimeout(timer!);
  return result;
}

// Canonical JSON: recursively sorts object keys so the same logical input
// always hashes the same way regardless of key insertion order.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeInputsHash(input: SolveInput): string {
  const datasetVersion = String(readVersion(input.modelId).version);
  return crypto
    .createHash("sha256")
    .update(input.modelId + datasetVersion + SOLVER_CODE_HASH + canonicalJson(input.inputs))
    .digest("hex");
}

// A6 — v2 cache key: identical SHAPE to computeInputsHash above (modelId +
// dataset version + canonical JSON of inputs) but keyed on
// SOLVER_CONTRACT_IDENTITY (A1's full composite manifest + SOLVER_CONTRACT_VERSION)
// instead of SOLVER_CODE_HASH (solve.py bytes only, truncated to 12 hex
// chars). A parser change (resultEnvelope.ts/solverProcessMessage.ts), a
// cbc_termination.py change, a PuLP/CBC runtime change (a different CBC
// build or architecture — P0R.1 found the real build differs by arch even
// under an identical PuLP version), or a SOLVER_CONTRACT_VERSION bump ALL
// change this hash even with solve.py byte-identical — closing exactly the
// cache-vs-truthful-status drift the G-cache artifact documents (B1's
// parser-only change demonstrated this drift was real, not hypothetical).
//
// Because the key material is entirely different from computeInputsHash's,
// a v1-only row's inputsHash can never equal a v2 lookup's inputsHash for
// the same logical inputs (two different sha256 digests over two different
// input strings) — an unversioned (v1) row is a v2 cache MISS by
// construction, never read, never trusted, left in place; no row is ever
// rewritten in-place from v1 to v2, and no separate "is this a v2 row"
// marker column is needed.
export function computeInputsHashV2(input: SolveInput): string {
  const datasetVersion = String(readVersion(input.modelId).version);
  return crypto
    .createHash("sha256")
    .update(input.modelId + datasetVersion + SOLVER_CONTRACT_IDENTITY + canonicalJson(input.inputs))
    .digest("hex");
}

// A1 (SCND Correctness) — validates `input.inputs` against the model's own
// Zod schema one more time (defense in depth — every caller has already
// validated once) before it's allowed into a durable `input_snapshot`. A
// queued row's snapshot must be independently executable after process loss
// (A2 consumes it) — persisting a schema-invalid payload would silently
// create an unrecoverable row. Throws, never silently narrows/coerces.
function buildValidatedInputSnapshot(input: SolveInput): Record<string, unknown> {
  const validation = validateInputsForModel(input.modelId, input.inputs);
  if (!validation.success) {
    throw new Error(`input_snapshot rejected: ${input.modelId} inputs fail validation (${validation.error})`);
  }
  return { modelId: input.modelId, inputs: validation.data };
}

// A2 — the inverse of buildValidatedInputSnapshot: reconstructs a
// SolveInput from a claimed row's durable input_snapshot + model_id, for a
// job the recurring dispatcher scan discovered that was NEVER registered
// in this process's own in-memory `pendingJobs` (e.g. enqueued by a prior
// process generation before a restart, or by this same generation via a
// path other than registerQueuedJob). Re-validates rather than trusting the
// stored JSON blob shape — defense in depth, matching buildValidatedInputSnapshot's
// own stance. Returns null (never throws) on anything invalid; the caller
// terminal-fails the job rather than executing an unrecoverable snapshot.
function reconstructInputFromSnapshot(row: SolveJob): SolveInput | null {
  if (!row.modelId || !row.inputSnapshot) return null;
  const snapshot = row.inputSnapshot as { modelId?: string; inputs?: unknown };
  const validation = validateInputsForModel(row.modelId, snapshot.inputs);
  if (!validation.success) return null;
  return { modelId: row.modelId, inputs: validation.data } as SolveInput;
}

export interface BuildSolveJobValuesParams {
  scenarioId: number;
  userId: string;
  input: SolveInput;
  /** Class 1 (nullable) — null for a caller with no locked-scenario context. */
  enqueuedSolveInputRevision: number | null;
}

// A1 — the single place a `solve_jobs` insert row is shaped, shared by both
// the simple `enqueueSolveJob` below and `enqueueScenarioSolve`'s atomic
// transaction. Q79: requested-limit `source` columns are pinned to the
// literal 'request' for this contract version — never 'default'.
export function buildSolveJobValues(params: BuildSolveJobValuesParams): InsertSolveJob {
  return {
    scenarioId: params.scenarioId,
    userId: params.userId,
    status: "queued",
    inputsHash: computeInputsHash(params.input),
    modelId: params.input.modelId,
    inputSnapshot: buildValidatedInputSnapshot(params.input),
    enqueuedSolveInputRevision: params.enqueuedSolveInputRevision,
    requestedGap: params.input.inputs.gap,
    requestedGapSource: "request",
    requestedTimeLimitSec: params.input.inputs.timeLimitSec,
    requestedTimeLimitSource: "request",
    recoveryContractIdentity: RECOVERY_CONTRACT_IDENTITY,
  };
}

// Registers an already-inserted (committed) job with the in-process worker
// pool and kicks the pump — split out from the DB insert so a caller that
// inserted the row inside its OWN transaction (enqueueScenarioSolve) only
// registers for dispatch AFTER that transaction has actually committed.
export function registerQueuedJob(jobId: number, scenarioId: number, userId: string, input: SolveInput): void {
  pendingJobs.set(jobId, { scenarioId, userId, input });
  queue.push(jobId);
  pump();
}

// Enqueues a solve job: inserts the solve_jobs row synchronously (so the
// route can return 202 {jobId} immediately) and kicks off the in-process
// worker pool without awaiting it — the job runs in the background. This is
// the SIMPLE, non-locking primitive — used directly by tests and any other
// programmatic caller that already holds a validated `input`. The
// PRODUCTION route path goes through `enqueueScenarioSolve` below instead,
// which additionally closes the TOCTOU race between reading a scenario's
// inputs and enqueueing a job for them.
export async function enqueueSolveJob(scenarioId: number, userId: string, input: SolveInput): Promise<number> {
  const values = buildSolveJobValues({ scenarioId, userId, input, enqueuedSolveInputRevision: null });
  const [job] = await db.insert(solveJobsTable).values(values).returning();
  registerQueuedJob(job.id, scenarioId, userId, input);
  return job.id;
}

// A1 — the enqueue AUTHORITY transaction (review A-R39/A-R55). The route
// used to read+validate the scenario BEFORE calling enqueueSolveJob, so an
// edit could land in the window between that read and the insert, and the
// persisted snapshot could silently diverge from the scenario's actual
// current state. This closes that race: in ONE transaction, lock the owned
// scenario row (SELECT ... FOR UPDATE), re-run shape validation AND the
// semantic precheck against the FRESHLY LOCKED row (never the caller's
// possibly-stale belief about what the inputs are), capture the locked
// inputs + solve_input_revision, insert the job (persisting the captured
// revision as `enqueuedSolveInputRevision`), and update
// `latestSolveJobId` ONLY IF the new job id is greater than the stored one
// (so two concurrent enqueues committing in inverted order can't let the
// older job become "latest" — A-R32).
//
// Error mapping is the caller's job (routes/scenarios.ts): a revalidation
// failure on the locked row must produce the SAME synchronous 422/no-job
// response the pre-lock path always gave — never a queued job that can
// never run.
export type EnqueueScenarioSolveOutcome =
  | { kind: "not_found" }
  | { kind: "invalid"; error: string }
  | { kind: "precheck_failed"; errors: PrecheckResult["errors"] }
  | { kind: "queued"; jobId: number; modelId: string };

export async function enqueueScenarioSolve(scenarioId: number, userId: string): Promise<EnqueueScenarioSolveOutcome> {
  const outcome = await db.transaction(async (tx) => {
    const [scenario] = await tx.select().from(scenariosTable)
      .where(and(eq(scenariosTable.id, scenarioId), eq(scenariosTable.userId, userId)))
      .for("update");
    if (!scenario) {
      return { kind: "not_found" } as const;
    }

    const validation = validateInputsForModel(scenario.modelId, scenario.inputs);
    if (!validation.success) {
      return { kind: "invalid", error: validation.error } as const;
    }

    const precheck = runNetworkEditsPrecheckForModel(scenario.modelId, validation.data);
    if (!precheck.ok) {
      return { kind: "precheck_failed", errors: precheck.errors } as const;
    }

    const input = { modelId: scenario.modelId, inputs: validation.data } as SolveInput;
    const values = buildSolveJobValues({
      scenarioId: scenario.id,
      userId,
      input,
      enqueuedSolveInputRevision: scenario.solveInputRevision,
    });
    const [job] = await tx.insert(solveJobsTable).values(values).returning();

    // Only advance latest_solve_job_id if this job id is greater than the
    // stored one (or the stored one is null) — two concurrent enqueues
    // committing in inverted order can't let the older job win.
    await tx.update(scenariosTable)
      .set({ latestSolveJobId: job.id })
      .where(and(
        eq(scenariosTable.id, scenario.id),
        eq(scenariosTable.userId, userId),
        or(isNull(scenariosTable.latestSolveJobId), lt(scenariosTable.latestSolveJobId, job.id)),
      ));

    return { kind: "queued", jobId: job.id, modelId: scenario.modelId, input } as const;
  });

  if (outcome.kind === "queued") {
    registerQueuedJob(outcome.jobId, scenarioId, userId, outcome.input);
    return { kind: "queued", jobId: outcome.jobId, modelId: outcome.modelId };
  }
  return outcome;
}

// A2 — pump() is the SOLE place that starts executing a job (fast-path
// enqueue kick AND the recurring dispatcher scan both funnel new jobIds
// through the SAME `queue` array + this same synchronous while-loop), so
// the `activeCount < CONCURRENCY` reservation can never be over-claimed
// jointly between the two triggers — JS's single-threaded run-to-completion
// semantics make this loop's synchronous `activeCount++` an implicit mutex
// (A-R37's "same counter, guarded together" requirement).
function pump(): void {
  while (!draining && activeCount < CONCURRENCY && queue.length > 0) {
    const jobId = queue.shift()!;
    const hint = pendingJobs.get(jobId) ?? null;
    pendingJobs.delete(jobId);
    activeCount++;
    const promise = claimAndRun(jobId, hint)
      .catch(() => {
        /* claimAndRun/runJob never throw in practice — this is a
           last-resort guard so a bug here can't wedge the worker pool. */
      })
      .finally(() => {
        activeCount--;
        activeJobPromises.delete(jobId);
        pump();
      });
    activeJobPromises.set(jobId, promise);
  }
}

// ---------------------------------------------------------------------------
// A2 — durable dispatch: CAS claim, owner lease/heartbeat, ownership-checked
// completion, recurring scan, boot recovery, drain. See the plan
// (docs/superpowers/plans/2026-09-22-scnd-correctness-A-full-contract.md,
// Task A2) for the full normative contract this section implements.
// ---------------------------------------------------------------------------

// `claim_generation`'s authority (A1/A-R17/A-R21): a Postgres sequence,
// read ONCE at boot (initDispatcherForBoot), durable + monotonic across
// boot/crash by construction — never per-job. Defaults to 0 for any caller
// that never went through real boot (e.g. a unit test that calls
// enqueueSolveJob directly without initDispatcherForBoot) — a real
// production boot always overwrites this before accepting traffic.
let bootClaimGeneration = 0;
export function getBootClaimGeneration(): number {
  return bootClaimGeneration;
}

// A2 — atomic CAS claim: queued -> running, stamping this process
// generation's ownership + lease fields from the DATABASE's own clock
// (never the app clock — two generations can skew against each other).
// Returns the claimed row (RETURNING *) or null if the race was lost (the
// row was already claimed/handled by someone else — not an error). Exported
// for direct testing of the claim predicate without paying for a full
// runJob/spawn cycle.
export async function claimJobRow(jobId: number): Promise<SolveJob | null> {
  const [row] = await db.update(solveJobsTable)
    .set({
      status: "running",
      claimGeneration: bootClaimGeneration,
      claimedAt: sql`now()`,
      ownerHeartbeatAt: sql`now()`,
      startedAt: sql`now()`,
    })
    .where(and(eq(solveJobsTable.id, jobId), eq(solveJobsTable.status, "queued")))
    .returning();
  return (row as SolveJob | undefined) ?? null;
}

// A2 — owner heartbeat. Interval 10s (fixed default, env-overridable for
// test speed only — production always uses the default). Stale threshold
// is a FIXED 60s literal in reapStaleLeases' own SQL (6x safety factor over
// this interval), deliberately NOT overridable — it's a correctness
// constant, not a tuning knob.
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_INTERVAL_MS = parsePositiveIntEnv(process.env.SOLVE_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_INTERVAL_MS);

// A2 — heartbeat refresh uses the SAME ownership predicate as terminal
// completion (A-R37): WHERE id=? AND status='running' AND claim_generation=?.
// A zero-row result means ownership is ALREADY LOST (reclaimed by a newer
// generation's stale-lease takeover, or the row was otherwise terminalized
// out from under us) — exported so callers/tests can observe this directly.
export async function refreshOwnerHeartbeat(jobId: number, generation: number): Promise<boolean> {
  const rows = await db.update(solveJobsTable)
    .set({ ownerHeartbeatAt: sql`now()` })
    .where(and(
      eq(solveJobsTable.id, jobId),
      eq(solveJobsTable.status, "running"),
      eq(solveJobsTable.claimGeneration, generation),
    ))
    .returning({ id: solveJobsTable.id });
  return rows.length > 0;
}

// A2 — starts a per-job heartbeat loop for the duration of its execution.
// A zero-row refresh (ownership lost) OR a thrown error (Postgres
// unavailable) BOTH immediately cancel the process group via A3's
// cancelJob — never merely decline to publish, or an orphaned CBC run
// keeps burning this generation's solve-slot budget for nothing (A-R37).
// Returns a stop function the caller MUST call once the job is terminal.
function startOwnerHeartbeat(jobId: number, generation: number): () => void {
  const timer = setInterval(() => {
    void (async () => {
      try {
        const ok = await refreshOwnerHeartbeat(jobId, generation);
        if (!ok) {
          cancelJob(jobId, "lease-lost");
        }
      } catch {
        cancelJob(jobId, "heartbeat-db-error");
      }
    })();
  }, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}

// A2 — stale-lease takeover (A-R27): a `running` row whose heartbeat has
// gone quiet for >60s (6x the 10s heartbeat interval) is presumed to have a
// dead owner and is TERMINALLY FAILED, never requeued (bounded attempts/
// retry policy live in Scaling; an unbounded auto-retry is worse than an
// honest failure the student retries by hand). The UPDATE's own WHERE
// clause is the atomic takeover predicate — two scanners racing this same
// query can't both "win" a row (only one UPDATE actually matches it, since
// the first one to commit flips status away from 'running').
export async function reapStaleLeases(): Promise<number> {
  const rows = await db.update(solveJobsTable)
    .set({
      status: "failed",
      error: "Solve was interrupted (owner lease expired)".slice(0, 500),
      // A5 — typed columns (§2.11: "interrupted (cancel / deploy /
      // server-restart-reaper / external kill)"). `errorCode` is what the
      // public serializer (derivePublicFailure below) actually reads.
      failureReason: "interrupted",
      failureStage: "reaper",
      errorCode: "SOLVE_FAILED",
      finishedAt: sql`now()`,
    })
    .where(and(
      eq(solveJobsTable.status, "running"),
      isNotNull(solveJobsTable.ownerHeartbeatAt),
      lt(solveJobsTable.ownerHeartbeatAt, sql`now() - interval '60 seconds'`),
    ))
    .returning({ id: solveJobsTable.id });
  return rows.length;
}

// A2 — recurring dispatcher scan config (A-R37): interval 5s, batch bounded
// by free worker slots capped at 5/tick, exponential backoff w/ jitter on
// DB error capped at 60s.
const DEFAULT_DISPATCHER_INTERVAL_MS = 5_000;
export const DISPATCHER_INTERVAL_MS = parsePositiveIntEnv(process.env.SOLVE_DISPATCHER_INTERVAL_MS, DEFAULT_DISPATCHER_INTERVAL_MS);
const DEFAULT_DISPATCHER_MAX_BACKOFF_MS = 60_000;
export const DISPATCHER_MAX_BACKOFF_MS = parsePositiveIntEnv(process.env.SOLVE_DISPATCHER_MAX_BACKOFF_MS, DEFAULT_DISPATCHER_MAX_BACKOFF_MS);
export const DISPATCHER_BATCH_LIMIT = 5;

// A2 — the recurring scan's own claim query. Filters to NON-LEGACY queued
// rows only (input_snapshot + model_id both present) — a legacy queued row
// predating A1 is unrecoverable by construction and is left untouched here,
// handled once by Phase 2's gated historical cleanup instead. Strict
// (queued_at, id) oldest-first, matching A1's partial index — no priority
// classes. Claimed ids are pushed into the SAME `queue`/pump() machinery the
// fast enqueue path uses, so the CAS claim (not this SELECT) is what
// actually decides ownership — a job independently claimed by the fast path
// in the same instant just loses the race harmlessly (claimJobRow returns
// null, claimAndRun no-ops).
async function scanAndClaimQueuedJobs(): Promise<void> {
  if (draining) return; // never claim NEW work while draining (shutdown category 1)
  const freeSlots = Math.min(DISPATCHER_BATCH_LIMIT, CONCURRENCY - activeCount - queue.length);
  if (freeSlots <= 0) return;

  const rows = await db.select({ id: solveJobsTable.id }).from(solveJobsTable)
    .where(and(
      eq(solveJobsTable.status, "queued"),
      isNotNull(solveJobsTable.inputSnapshot),
      isNotNull(solveJobsTable.modelId),
    ))
    .orderBy(asc(solveJobsTable.queuedAt), asc(solveJobsTable.id))
    .limit(freeSlots);

  for (const row of rows as { id: number }[]) {
    if (!queue.includes(row.id)) queue.push(row.id);
  }
  pump();
}

// A2 — ONE in-process mutex guards the tick (A-R37): a tick already in
// flight is SKIPPED, never queued up. Guards ANY caller (the recurring
// scheduler, a direct test call, or initDispatcherForBoot's own first
// iteration) against overlapping with another already-running tick.
// Deliberately does NOT swallow errors — callers decide: initDispatcherForBoot
// lets a boot-time failure propagate (fail closed), the recurring
// scheduler's own wrapper below catches and backs off.
let tickInFlight = false;
export async function runDispatcherTickOnce(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    await scanAndClaimQueuedJobs();
    await reapStaleLeases();
  } finally {
    tickInFlight = false;
  }
}

let schedulerRunning = false;
let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let currentIntervalMs = DISPATCHER_INTERVAL_MS;
let consecutiveTickErrors = 0;
let wasInBackoff = false;

function scheduleNextTick(delayMs: number): void {
  if (!schedulerRunning) return;
  schedulerTimer = setTimeout(() => {
    void scheduledTick();
  }, delayMs);
}

// A2 — the recurring scheduler's own tick wrapper: catches a DB error from
// runDispatcherTickOnce(), computes exponential backoff w/ 20% jitter
// capped at DISPATCHER_MAX_BACKOFF_MS, and ALWAYS reschedules regardless of
// outcome — a failed tick never cancels the schedule (A-R37). Exactly ONE
// operator log line per transition to/from backoff, not per tick.
async function scheduledTick(): Promise<void> {
  try {
    await runDispatcherTickOnce();
    if (wasInBackoff) {
      logger.info("[A2] dispatcher scan recovered from backoff, resuming normal interval");
      wasInBackoff = false;
    }
    consecutiveTickErrors = 0;
    currentIntervalMs = DISPATCHER_INTERVAL_MS;
  } catch (err) {
    consecutiveTickErrors++;
    const backoff = Math.min(DISPATCHER_MAX_BACKOFF_MS, DISPATCHER_INTERVAL_MS * 2 ** consecutiveTickErrors);
    const jitter = backoff * 0.2 * Math.random();
    currentIntervalMs = Math.min(DISPATCHER_MAX_BACKOFF_MS, Math.round(backoff + jitter));
    if (!wasInBackoff) {
      logger.error({ err }, "[A2] dispatcher scan entering backoff after a DB error");
      wasInBackoff = true;
    }
  } finally {
    scheduleNextTick(currentIntervalMs);
  }
}

export function startDispatcherScheduler(): void {
  if (schedulerRunning) return;
  schedulerRunning = true;
  currentIntervalMs = DISPATCHER_INTERVAL_MS;
  consecutiveTickErrors = 0;
  wasInBackoff = false;
  scheduleNextTick(currentIntervalMs);
}

export function stopDispatcherScheduler(): void {
  schedulerRunning = false;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

// A2 — Phase 1 boot recovery (pre-listen, NO gate; A-R58). Reads this
// process generation's claim_generation ONCE from the durable Postgres
// sequence, runs the first recurring-scan iteration over non-legacy queued
// rows, and starts the recurring scheduler. Postgres unreachable here
// PROPAGATES (never swallowed) — index.ts awaits this before app.listen, so
// an unreachable DB makes boot FAIL CLOSED, never silently starts with no
// dispatcher. Readiness depends on this phase only; Phase 2 (below) never
// gates it.
export async function initDispatcherForBoot(): Promise<void> {
  const seqResult = await db.execute(sql`SELECT nextval('solve_jobs_claim_generation_seq') AS v`);
  const rows = (seqResult as unknown as { rows: { v: string | number }[] }).rows;
  bootClaimGeneration = Number(rows[0]!.v);

  draining = false;
  await runDispatcherTickOnce(); // Phase 1's own first iteration — errors propagate
  startDispatcherScheduler();
}

// A2 — Phase 2 (asynchronous, one-shot, off the request path; A-R50/A-R58).
// Moves exactly two disjoint buckets to terminal `failed`, once each:
//   (1) a transitional pre-A2-owned `running` row with a VALID snapshot and
//       a null lease (owner_heartbeat_at IS NULL AND claim_generation IS
//       NULL) — the exact predicate the plan requires, so a genuinely still-
//       solving prior-revision process (unconditional completion logic, no
//       ownership predicate of its own) is never raced with.
//   (2) a historical row (any pre-terminal status) with NO valid snapshot
//       at all (input_snapshot or model_id null) — unrecoverable by
//       construction, never spun on, never fabricated an input for.
// Both predicates are mutually exclusive (one requires non-null snapshot,
// the other requires null) and each is itself a terminal transition, so
// re-running this function after it already moved a row is a safe no-op.
export async function runPhase2LegacyCleanup(): Promise<{ nullLeaseFailed: number; historicalFailed: number }> {
  const nullLeaseRows = await db.update(solveJobsTable)
    .set({
      status: "failed",
      error: LEGACY_UNRECOVERABLE_SAFE_MESSAGE,
      // A5 — same typed shape as the version-mismatch case these rows reuse
      // the message from (jobRunner.ts's own header comment above): "this
      // job can never be honestly re-run." failureReason='data_error' +
      // failureStage='validate' is what makes derivePublicFailure() below
      // select the identical VERSION_MISMATCH_SAFE_MESSAGE for these rows
      // too, rather than falling through to the generic "Solve failed".
      failureReason: "data_error",
      failureStage: "validate",
      errorCode: "SOLVE_FAILED",
      finishedAt: sql`now()`,
    })
    .where(and(
      eq(solveJobsTable.status, "running"),
      isNull(solveJobsTable.ownerHeartbeatAt),
      isNull(solveJobsTable.claimGeneration),
      isNotNull(solveJobsTable.inputSnapshot),
      isNotNull(solveJobsTable.modelId),
    ))
    .returning({ id: solveJobsTable.id });

  const historicalRows = await db.update(solveJobsTable)
    .set({
      status: "failed",
      error: LEGACY_UNRECOVERABLE_SAFE_MESSAGE,
      // A5 — same typed shape as the version-mismatch case these rows reuse
      // the message from (jobRunner.ts's own header comment above): "this
      // job can never be honestly re-run." failureReason='data_error' +
      // failureStage='validate' is what makes derivePublicFailure() below
      // select the identical VERSION_MISMATCH_SAFE_MESSAGE for these rows
      // too, rather than falling through to the generic "Solve failed".
      failureReason: "data_error",
      failureStage: "validate",
      errorCode: "SOLVE_FAILED",
      finishedAt: sql`now()`,
    })
    .where(and(
      inArray(solveJobsTable.status, ["queued", "running"]),
      or(isNull(solveJobsTable.inputSnapshot), isNull(solveJobsTable.modelId)),
    ))
    .returning({ id: solveJobsTable.id });

  return { nullLeaseFailed: nullLeaseRows.length, historicalFailed: historicalRows.length };
}

// A14a's shutdown-budget default (maxShutdownDelaySeconds=120 + a 60s
// margin = 180s) — the drain gate a new revision waits behind before
// touching any legacy/transitional row it can't yet prove the prior
// revision has released (A-R50). Env-overridable ONLY for test speed;
// production always uses the 180s default.
const DEFAULT_DRAIN_GATE_MS = 180_000;
export const DRAIN_GATE_MS = parsePositiveIntEnv(process.env.SOLVE_DRAIN_GATE_MS, DEFAULT_DRAIN_GATE_MS);

let phase2Timer: ReturnType<typeof setTimeout> | null = null;

// A2 — schedules Phase 2 to run exactly once, DRAIN_GATE_MS after THIS
// process's own boot (the only in-process proxy available for "the prior
// revision has had the platform's shutdown budget to drain" — this process
// starting is the earliest possible moment a rolling deploy could have told
// the old one to drain, so waiting this long past OUR OWN start is a safe,
// conservative lower bound). Idempotent — calling twice does not double-schedule.
export function scheduleLegacyCleanupAfterDrainGate(): void {
  if (phase2Timer) return;
  phase2Timer = setTimeout(() => {
    phase2Timer = null;
    runPhase2LegacyCleanup().catch((err) => {
      logger.error({ err }, "[A2] Phase 2 legacy-row cleanup failed (will not retry until next boot)");
    });
  }, DRAIN_GATE_MS);
}

// Test-only escape hatch — cancels a pending Phase 2 schedule so a test
// doesn't leak a live timer (and its DB call) into a later test file.
export function cancelScheduledLegacyCleanup(): void {
  if (phase2Timer) {
    clearTimeout(phase2Timer);
    phase2Timer = null;
  }
}

// A2 — SIGTERM/SIGINT drain (replaces the old immediate process.exit(0)).
// Stops admitting NEW claims (stops the recurring scan + gates pump()),
// waits up to `graceMs` for currently in-flight jobs to finish naturally
// (their own heartbeat loops keep renewing ownership throughout — nothing
// here touches them), and if any are still running after the grace period,
// force-cancels via A3's cancelAllActiveJobs (whole-process-group TERM then
// KILL) and waits up to `forceGraceMs` more for that cancellation to
// actually resolve (runSolverProcess's own internal TERM->KILL sequence is
// itself bounded — see terminateProcessGroup). index.ts's own SIGTERM
// handler calls this; server.close()/posthog/Sentry flush stay in index.ts
// since they aren't jobRunner's concern.
export async function drainForShutdown(source: string, opts: { graceMs: number; forceGraceMs: number }): Promise<void> {
  stopDispatcherScheduler();
  setDraining(true);
  const finishedInGrace = await waitForActiveJobsToDrain(opts.graceMs);
  if (!finishedInGrace) {
    cancelAllActiveJobs(source);
    await waitForActiveJobsToDrain(opts.forceGraceMs);
  }
}

// ---------------------------------------------------------------------------
// A3 — process-group containment. solve.py is spawned DETACHED (its own
// process-group leader, child.pid === its pgid on POSIX) so a timeout/
// cancel can reliably reach every descendant (in particular CBC, spawned by
// PuLP from *inside* the Python process) via `process.kill(-pgid, signal)`,
// not just the direct child. TERM first (graceful), then — only if the
// group is still alive after a bounded grace period — SIGKILL (which
// cannot be caught/blocked on POSIX). Linux/POSIX-only: `process.kill`
// with a negative pid is a POSIX process-group signal; this fails fast
// (throws, surfaced as a real startup error) on a non-POSIX platform, which
// this app has never targeted for the solver (production is Linux/Docker;
// local dev is macOS, also POSIX).
// ---------------------------------------------------------------------------

if (process.platform !== "linux" && process.platform !== "darwin") {
  throw new Error(
    `solver/jobRunner.ts's process-group containment (A3) requires a POSIX platform ` +
    `(process.kill(-pgid, ...) is POSIX-only); refusing to start on "${process.platform}".`,
  );
}

const DEFAULT_TERM_GRACE_MS = 2000;
export const TERM_GRACE_MS = parsePositiveIntEnv(process.env.SOLVE_TERM_GRACE_MS, DEFAULT_TERM_GRACE_MS);
export const KILL_PROBE_INTERVAL_MS = 50;
// Bounded wait after SIGKILL before giving up probing — SIGKILL cannot be
// caught/blocked on POSIX, so this should essentially always resolve almost
// immediately; it's a safety bound, not a real expected wait.
export const GROUP_DEATH_TIMEOUT_MS = 3000;

export const STDIO_CAP_BYTES = 64 * 1024;
export const FD3_CAP_BYTES = 1024 * 1024;

// Margin added on top of a scenario's own requested timeLimitSec before the
// outer solver-process timeout fires — gives CBC's own gap/time-limit
// machinery a chance to finish writing its result after its internal clock
// expires, rather than racing Node's outer kill against CBC's own graceful
// stop. Kept as the same 15s default this app has always used; configurable
// (like the other timing knobs above) so a test can shrink it instead of
// needing fake timers to exercise a real timeout.
const DEFAULT_TIMEOUT_GRACE_MS = 15000;
export const TIMEOUT_GRACE_MS = parsePositiveIntEnv(process.env.SOLVE_TIMEOUT_GRACE_MS, DEFAULT_TIMEOUT_GRACE_MS);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sends `signal` to the WHOLE process group led by `pid` (never just the
// direct child) — swallows ESRCH (already dead) / EPERM (no longer ours to
// signal) since both mean "nothing more for us to do here," not a real
// failure worth surfacing.
export function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    /* already dead, or genuinely not ours — either way, nothing to do */
  }
}

// Probes whether ANY process in the group led by `pid` is still alive
// (signal 0 sends nothing, just checks existence/permission) — this is
// what lets the timeout/no-orphan proof distinguish "direct child dead,
// CBC grandchild orphaned and still alive" from genuine full-group death.
export function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== "ESRCH";
  }
}

export async function waitForGroupDeath(pid: number, probeIntervalMs: number, maxWaitMs: number): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  // Check once immediately — a group that's already dead (or never had
  // anything to kill) shouldn't pay the first probe-interval delay.
  if (!isProcessGroupAlive(pid)) return true;
  while (Date.now() < deadline) {
    await sleep(probeIntervalMs);
    if (!isProcessGroupAlive(pid)) return true;
  }
  return !isProcessGroupAlive(pid);
}

// TERM -> (bounded grace) -> KILL -> (bounded wait) for the whole process
// group. Used by both the timeout path and cancellation — the two defined
// cancellation sources this app has (an outer solve timeout firing, or an
// explicit cancel via `cancelJob`/`cancelAllActiveJobs`, e.g. SIGTERM/
// deploy) both funnel through this one sequence.
export async function terminateProcessGroup(pid: number): Promise<void> {
  killProcessGroup(pid, "SIGTERM");
  const diedAfterTerm = await waitForGroupDeath(pid, KILL_PROBE_INTERVAL_MS, TERM_GRACE_MS);
  if (diedAfterTerm) return;
  killProcessGroup(pid, "SIGKILL");
  await waitForGroupDeath(pid, KILL_PROBE_INTERVAL_MS, GROUP_DEATH_TIMEOUT_MS);
  // Even if this second wait times out (should essentially never happen on
  // a healthy POSIX host), we proceed regardless — a stray survivor at that
  // point is a containment gap the no-orphan proof exists to catch, not
  // something worth blocking job completion over indefinitely.
}

// Active jobs' cancellation handles, keyed by jobId — the "internal cancel"
// source (cancelJob) and the "SIGTERM/deploy" source (cancelAllActiveJobs)
// both abort the same AbortSignal runSolverProcess watches. A2 wires
// cancelAllActiveJobs into index.ts's SIGTERM handler via drainForShutdown
// above.
const activeControllers = new Map<number, { controller: AbortController; source: string }>();

export function cancelJob(jobId: number, source: string = "internal"): boolean {
  const entry = activeControllers.get(jobId);
  if (!entry) return false;
  entry.controller.abort(source);
  return true;
}

export function cancelAllActiveJobs(source: string = "sigterm"): number {
  let n = 0;
  for (const [, entry] of activeControllers) {
    entry.controller.abort(source);
    n++;
  }
  return n;
}

// A capped byte-collector: past `capBytes`, further pushes are discarded
// (not appended) rather than growing without bound — this is the "≤64 KiB
// stdout/stderr, ≤1 MiB fd3, abort-at-cap" containment requirement. Decodes
// once, at the end, from the full accumulated Buffer (never per-chunk) so a
// multi-byte UTF-8 character split across two `data` events can't corrupt
// the text.
function makeCappedCollector(capBytes: number) {
  let buf = Buffer.alloc(0);
  let truncated = false;
  return {
    push(chunk: Buffer): void {
      if (truncated) return;
      const remaining = capBytes - buf.length;
      if (chunk.length <= remaining) {
        buf = Buffer.concat([buf, chunk]);
      } else {
        buf = Buffer.concat([buf, chunk.subarray(0, Math.max(remaining, 0))]);
        truncated = true;
      }
    },
    text(): string {
      return buf.toString("utf8");
    },
    isTruncated(): boolean {
      return truncated;
    },
  };
}

interface SupervisedRunResult {
  outcome: TerminalOutcome;
  pid: number | null;
  stderrText: string;
  // A12 — the fd3 failure message's own structured, allowlisted
  // `errorDetail` (SolverFailureSchema-validated, already byte-capped),
  // carried alongside `outcome` purely so runJob's Sentry operator-sink call
  // can forward it. Non-null ONLY when the message classification was a
  // genuine `failure` (TT-5/TT-10) — every other failed-outcome row
  // (protocol/exit/spawn/timeout/interrupted, TT-1/2/6/7/8/9/11/14) never
  // had a real fd3 failure message to begin with, so this stays null there.
  failureErrorDetail: Record<string, unknown> | null;
}

// A3 — supervises exactly one solve.py invocation end-to-end: detached
// process-group spawn, fd3 message capture (capped/incremental), stdout/
// stderr capture (capped, diagnostics-only — never parsed as the result
// anymore), the timeout/cancel TERM->KILL sequence, and classification via
// classifyTerminal(). Never throws — every branch resolves.
function runSolverProcess(
  payload: string,
  timeoutMs: number,
  opts: { workDir: string; signal?: AbortSignal },
): Promise<SupervisedRunResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let spawnFailed = false;
    let exitCode: number | null = null;

    const stdoutCollector = makeCappedCollector(STDIO_CAP_BYTES);
    const stderrCollector = makeCappedCollector(STDIO_CAP_BYTES);
    const fd3Collector = makeCappedCollector(FD3_CAP_BYTES);

    // cwd guards [C6] — run from os.tmpdir() so a malicious/buggy solver
    // script that writes relative paths lands them in the OS temp dir, not
    // the repo root. detached: true makes this child the leader of its own
    // process group (pid === pgid on POSIX) so terminateProcessGroup() can
    // reach every descendant, not just this direct child. stdio index 3 is
    // the fd3 IPC channel solve.py's `_write_process_message` writes to.
    const child = spawn("python3", [SOLVER_PY], {
      cwd: os.tmpdir(),
      detached: true,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      env: { ...process.env, NOS_SOLVE_WORKDIR: opts.workDir },
    });

    const fd3Stream = child.stdio[3] as NodeJS.ReadableStream | null;

    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimeoutTimer = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const onAbort = () => {
      if (settled) return;
      cancelled = true;
      const pid = child.pid;
      void (async () => {
        if (pid) await terminateProcessGroup(pid);
        finish();
      })();
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const finish = () => {
      if (settled) {
        // TT-13 — a late exit/message after this call already settled is
        // dropped, not re-processed; nothing else to record here beyond
        // not double-resolving (posthog/db writes only ever happen once,
        // downstream in runJob, off this single resolution).
        return;
      }
      settled = true;
      clearTimeoutTimer();
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);

      const message = classifyFd3Message({
        raw: fd3Collector.text(),
        oversize: fd3Collector.isTruncated(),
      });
      const outcome = classifyTerminal({
        timedOut,
        cancelled,
        spawnFailed,
        exitCode,
        message,
      });
      const failureErrorDetail = message.kind === "failure" ? (message.failure.errorDetail ?? null) : null;
      resolve({ outcome, pid: child.pid ?? null, stderrText: stderrCollector.text(), failureErrorDetail });
    };

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      const pid = child.pid;
      void (async () => {
        if (pid) await terminateProcessGroup(pid);
        finish();
      })();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => stdoutCollector.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrCollector.push(chunk));
    fd3Stream?.on("data", (chunk: Buffer) => fd3Collector.push(chunk));
    fd3Stream?.on("error", () => {
      /* degrades naturally via classifyFd3Message's missing/partial cases */
    });

    child.on("error", (err) => {
      spawnFailed = true;
      exitCode = null;
      void err; // never surfaced raw — classifyTerminal's spawn branch owns the diagnostic
      finish();
    });

    // 'close' fires once the direct child has exited AND its stdio streams
    // have closed — Node reaps the direct child as part of normal 'exit'
    // handling, no separate wait/reap call needed for that half. Confirming
    // whole-GROUP death (not just this direct child) only matters on the
    // timeout/cancel paths above, where terminateProcessGroup() already
    // does it before finish() is called.
    child.on("close", (code) => {
      if (timedOut || cancelled) return; // already resolving via the kill sequence
      exitCode = code;
      finish();
    });

    try {
      child.stdin?.write(payload);
      child.stdin?.end();
    } catch {
      /* a synchronous EPIPE here (child died before stdin was writable) is
         still observed via 'error'/'close' above — nothing extra to do. */
    }
  });
}

// A2 — ownership-checked terminal failure. WHERE id=? AND status='running'
// AND claim_generation=?. Returns whether the update actually affected a
// row — a zero-row result is a DROPPED STALE COMPLETION: recorded
// internal-only (the return value), never retried, never (re)published.
async function markFailed(
  jobId: number,
  generation: number,
  error: string,
  // A5 — `failureStage` is nullable: TT-1/TT-2 (timeout/interrupted) are
  // their own top-level Terminal kinds, not a `failed`-kind classification
  // carried on the fd3 message, so Node doesn't always have a real stage to
  // report for them (see the taxonomy passed at each call site below).
  taxonomy?: { failureReason: string; failureStage: string | null; errorCode: string },
): Promise<boolean> {
  const setValues: Record<string, unknown> = {
    status: "failed",
    error: error.slice(0, 500),
    finishedAt: new Date(),
  };
  if (taxonomy) {
    setValues.failureReason = taxonomy.failureReason;
    setValues.failureStage = taxonomy.failureStage;
    setValues.errorCode = taxonomy.errorCode;
  }
  const rows = await db.update(solveJobsTable)
    .set(setValues)
    .where(and(
      eq(solveJobsTable.id, jobId),
      eq(solveJobsTable.status, "running"),
      eq(solveJobsTable.claimGeneration, generation),
    ))
    .returning({ id: solveJobsTable.id });
  return rows.length > 0;
}

// Phase 6 (P1.2) — write-through result cache. Byte-identical repeated
// solves (common in a classroom where many students start from the
// textbook baseline) skip spawning solve.py entirely.
//
// A6 — the cache KEY is now FLAG-SELECTED (isV2WriteEnabled(), A11), not a
// single fixed key:
//   - flag OFF (default, current production behavior): runJob() below
//     computes inputsHash via the EXISTING computeInputsHash()
//     (SOLVER_CODE_HASH — solve.py bytes only, truncated) — byte-for-byte
//     unchanged from pre-A6 behavior. Zero student-visible change; the
//     current gate stays green under this path exactly as before.
//   - flag ON: runJob() instead computes inputsHash via
//     computeInputsHashV2() (SOLVER_CONTRACT_IDENTITY — the full composite
//     manifest + SOLVER_CONTRACT_VERSION), so a parser/contract-version/
//     CBC-build/PuLP-version change invalidates the cache even with
//     solve.py unchanged.
// Both paths share the SAME lookupCachedResult/writeThroughCache primitives
// below (both are generic over whatever inputsHash string they're handed)
// and the SAME result_cache table — there is no separate v2 table and no
// schema migration. The flag selects ONE WHOLE PATH end-to-end (read AND
// write together) per solve — a single job can never read under the v1 key
// and write under the v2 key, or vice versa. toLegacyStoredResult() still
// down-converts a v2 fd3 success envelope to the existing
// ResultEnvelopeSchema shape before either path ever writes it — that part
// is genuinely unchanged by this task. A7 (not this task) owns the
// outcome/publish policy on top of this (no_solution never cached, etc.).

async function lookupCachedResult(inputsHash: string): Promise<ResultEnvelope | null> {
  try {
    const [row] = await db.select().from(resultCacheTable)
      .where(eq(resultCacheTable.inputsHash, inputsHash));
    if (!row) return null;

    // B6 whole-branch review Finding #1 — a pre-B2 cached row has no
    // `solutionStatus` key at all (genuinely absent, not merely null — same
    // "in" check routes/scenarios.ts's presentResultForRead uses on read)
    // but still passes ResultEnvelopeSchema below (the field is optional).
    // Serving it would render "Unverified" forever on every future re-solve
    // of that same baseline, since a cache hit never reaches runJob()'s
    // write-through and the stale pre-B2 entry is never replaced. Treat it
    // as a cache miss instead, so the caller re-solves and writes through a
    // truthful (post-B2) envelope, self-healing the cache.
    if (!("solutionStatus" in row.result)) return null;

    // Don't trust a cached blob blindly — the envelope schema can drift
    // between when an entry was cached and now. A malformed/stale entry is
    // treated as a cache miss (solve normally), never a failure — same
    // reasoning as writeThroughCache below: caching is a pure optimization,
    // so any problem with it must degrade to "solve normally," never fail
    // or hang the job.
    const parsed = ResultEnvelopeSchema.safeParse(row.result);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

async function writeThroughCache(inputsHash: string, modelId: string, envelope: ResultEnvelope): Promise<void> {
  // Two near-simultaneous identical solves can race to insert the same key;
  // onConflictDoNothing means the loser of that race just doesn't overwrite
  // the winner's (equivalent, by definition of the hash) row. This must
  // never throw and take down an otherwise-successful job.
  try {
    await db.insert(resultCacheTable)
      .values({ inputsHash, modelId, result: envelope as unknown as Record<string, unknown> })
      .onConflictDoNothing({ target: resultCacheTable.inputsHash });
  } catch {
    /* caching is a pure optimization — a write-through failure must not
       fail a job that otherwise solved successfully. */
  }
}

// A3.C — success down-conversion. Converts the fd3 SolverSuccessEnvelopeV2
// payload to the EXISTING post-B stored/cache/public representation
// (ResultEnvelopeSchema) before any write — retains every field that schema
// already knows about (status/solutionStatus/terminationReason/achievedGap/
// solverIncumbentObjective/solverBestBound/objective/runTimeSec/quality/
// edges/metrics/details/solverUsed/infeasibilityReason) and drops anything
// v2-only a future A4 might add. Validated by ResultEnvelopeSchema itself
// (NOT a v2 schema) — this is the one place a v2 envelope is allowed to
// become "the" stored result; there is no v2 cache row or v2 scenario row
// anywhere in this task.
export function toLegacyStoredResult(envelope: SolverSuccessEnvelopeV2): ResultEnvelope {
  const picked = {
    status: envelope.status,
    solutionStatus: envelope.solutionStatus,
    terminationReason: envelope.terminationReason,
    achievedGap: envelope.achievedGap,
    solverIncumbentObjective: envelope.solverIncumbentObjective,
    solverBestBound: envelope.solverBestBound,
    objective: envelope.objective,
    runTimeSec: envelope.runTimeSec,
    quality: envelope.quality,
    edges: envelope.edges,
    metrics: envelope.metrics,
    details: envelope.details,
    solverUsed: envelope.solverUsed,
    infeasibilityReason: envelope.infeasibilityReason,
  };
  return ResultEnvelopeSchema.parse(picked);
}

// A7 — the three DISTINCT terminal outcomes of a publication attempt
// (A-R48). Each is a different real-world situation and must never be
// conflated:
//   - "not_owned"  — the job's OWN terminal update affected ZERO rows: this
//     process's lease was already lost (reclaimed by a newer generation's
//     stale-lease takeover, or the row was otherwise terminalized out from
//     under us) BEFORE this call ever ran. Publish nothing, change nothing,
//     leave the row exactly as the reaper/newer owner left it — it is not
//     this job's to touch anymore. Never retried.
//   - "superseded"  — the job's OWN terminal update SUCCEEDED (this process
//     genuinely still owned the lease and the compute genuinely finished),
//     but the scenario-level publication CAS did not match — either a
//     newer job now owns `latest_solve_job_id`, or the scenario's inputs
//     have moved on to a new `solve_input_revision` since this job was
//     enqueued (an edit landed with no second solve having completed yet).
//     The job is STILL recorded terminally as `succeeded` with its full
//     result addressable in solve history (A-R32) — it simply never
//     becomes the scenario's CURRENT result. This is never a failure.
//   - "published"   — both matched: the scenario's `result`/`resultRunId`
//     now reflect this job's outcome.
// Exported so tests can assert on it directly without string-matching.
export type ScenarioPublicationOutcome =
  | { kind: "not_owned" }
  | { kind: "superseded" }
  | { kind: "published" };

// A7 (§2.8) — outcome-specific cache eligibility. GATED on isV2WriteEnabled()
// per the plan's flag-scoping rule: this is "item 1's caching," and with the
// flag OFF, cache-write behavior for a successful solve must stay BYTE-FOR-
// BYTE unchanged from pre-A7 (every solutionStatus cached unconditionally
// under the v1 key) — the outcome table below only actually applies once
// the flag is ON (i.e. once the cache key is A6's full composite identity,
// the "complete effective-limit/version key" §2.8's `feasible` row requires).
//   - flag OFF: cache everything (pre-A7 behavior, verbatim).
//   - flag ON:  optimal / infeasible / unbounded / feasible -> cache (a
//               `feasible` entry is only ever written here under the v2 key,
//               which callers already select end-to-end — see runJob).
//               no_solution -> NEVER cache: "no incumbent within the
//               requested gap/time limit" is not a stable answer to memoize
//               — a later identical-inputs solve under a longer limit could
//               easily find one, and caching the absence would wrongly deny
//               it forever.
export function isOutcomeCacheable(status: string, v2Enabled: boolean): boolean {
  if (!v2Enabled) return true;
  return status !== "no_solution";
}

// A2/A7 — ownership-checked SUCCESS completion + the ALWAYS-ON publication
// CAS (A-R32/A-R39/A-R48; not flag-gated — this fixes a real superseded-
// overwrite race regardless of v2). Two INDEPENDENT gates, evaluated in
// order, each producing its own distinct terminal meaning (see
// ScenarioPublicationOutcome above):
//   1. The job's OWN ownership-checked terminal update (`RETURNING id`) —
//      unchanged from A2. Zero rows -> "not_owned", and the scenario update
//      NEVER RUNS AT ALL (a checked branch on the returned row count, not a
//      second independent statement that could run regardless — A-R48's
//      exact "dependency, not mere co-transaction-membership" requirement).
//   2. Only once (1) has matched exactly one row: the scenario CAS itself —
//      `latest_solve_job_id = <this job>` AND `solve_input_revision =
//      <this job's own enqueued_solve_input_revision>`. A null captured
//      revision (only possible via the non-authority `enqueueSolveJob`
//      simple primitive, never the real HTTP path — see that function's own
//      header) can never satisfy this CAS by construction: an unproven
//      revision is never treated as a match (fail-closed, the same stance
//      this file already takes on every other "identity underivable"
//      case) — such a job is legitimately "superseded" since it was never
//      granted publication authority at enqueue.
// Both writes still happen inside ONE transaction (Part F/T6, unchanged);
// completion telemetry is gated by the CALLER on `kind !== "not_owned"`,
// firing only after this function's transaction has committed. Exported —
// same rationale as claimJobRow above: direct testing of the publication
// CAS predicate against a REAL database without paying for a full
// runJob/spawn cycle.
export async function markSucceeded(
  jobId: number,
  generation: number,
  scenarioId: number,
  userId: string,
  modelId: string,
  envelope: ResultEnvelope,
  enqueuedSolveInputRevision: number | null,
): Promise<ScenarioPublicationOutcome> {
  // D21/C4.10 — resultSummary now carries the objective mode + a unit-tagged
  // weighted-average distance so the solve-history read (and Landing) can label
  // each solve without re-deriving the model. objectiveMode is the solver's
  // details.objective when present (Chen emits "coverage"/"min_distance"; mile
  // models don't set it) else null; distanceUnit is the model manifest's unit
  // (mile models "mi", Chen "km"). Replaces the removed mile-locked
  // weightedAvgDistanceMi.
  const objectiveMode = typeof envelope.details.objective === "string" ? envelope.details.objective : null;
  const distanceUnit = getManifest(modelId)?.distanceUnit ?? "mi";
  const resultJson = envelope as unknown as Record<string, unknown>;

  // Part F (T6): the job+scenario writes must be ATOMIC. Split across two
  // independent statements, a partial failure could leave an addressable
  // succeeded run whose scenario still points at an older result, or a
  // scenario result with no run pointer.
  return await db.transaction(async (tx) => {
    const updatedJobRows = await tx.update(solveJobsTable)
      .set({
        status: "succeeded",
        result: resultJson,
        resultSummary: {
          status: envelope.status,
          objective: envelope.objective,
          objectiveMode,
          weightedAvgDistance: envelope.metrics.weightedAvgDistance ?? null,
          distanceUnit,
          runTimeSec: envelope.runTimeSec,
        },
        finishedAt: new Date(),
      })
      .where(and(
        eq(solveJobsTable.id, jobId),
        eq(solveJobsTable.status, "running"),
        eq(solveJobsTable.claimGeneration, generation),
      ))
      .returning({ id: solveJobsTable.id });

    if (updatedJobRows.length === 0) {
      // A2 — dropped stale completion: ownership already lost (reclaimed by
      // a newer generation's stale-lease takeover, or otherwise
      // terminalized out from under us). Never publish, never retry. The
      // scenario CAS below is NEVER EVEN ATTEMPTED — this is the checked
      // branch A-R48 requires, not a second independent statement.
      return { kind: "not_owned" } as const;
    }

    // A7 — the publication CAS (A-R32/A-R39/A-R48), reached ONLY because
    // exactly one job row was just terminally updated above. A null
    // enqueuedSolveInputRevision can never satisfy `eq(...)` in SQL (it
    // compares false/UNKNOWN against every real integer), so it falls
    // through to "superseded" exactly as intended — no separate branch
    // needed.
    const scenarioRows = await tx.update(scenariosTable)
      .set({
        result: resultJson,
        resultRunId: jobId,
        solvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(scenariosTable.id, scenarioId),
        eq(scenariosTable.userId, userId),
        eq(scenariosTable.latestSolveJobId, jobId),
        enqueuedSolveInputRevision == null
          ? sql`false`
          : eq(scenariosTable.solveInputRevision, enqueuedSolveInputRevision),
      ))
      .returning({ id: scenariosTable.id });

    if (scenarioRows.length === 0) {
      // A-R32 — succeeded-but-superseded: the job row above already
      // committed status='succeeded' with its full result — this branch
      // only decides whether the SCENARIO also gets updated. Never a
      // failure; never shown as one.
      return { kind: "superseded" } as const;
    }

    return { kind: "published" } as const;
  });
}

// A3 — a fixed, safe message for solve_jobs.error. Built ONLY from the
// terminal table's own closed enums (failureReason/failureStage), never
// from raw stdout/stderr/exception text. This remains an INTERNAL
// diagnostic string only — A5's derivePublicFailure() below is the real
// public errorCode/errorMessage serializer, and it deliberately never reads
// this column (or this function's output) at all; routes/scenarios.ts and
// routes/solveHistory.ts must not read `job.error` either.
function safeFailureMessage(reason: string, stage: string): string {
  return `Solver failed (${reason}/${stage})`;
}

// ---------------------------------------------------------------------------
// A5 — the permanent public failure shape (§2.11; A0/Q80's decision).
// `errorCode` + a server-owned, fixed `errorMessage` is the ONLY public
// surface for a failed job: the raw stored `solve_jobs.error` diagnostic,
// `failureReason`, `failureStage`, and `errorDetail` are NEVER surfaced —
// this function is the single place that reads those typed internal columns
// and turns them into the closed public shape. routes/scenarios.ts's
// solve-job poll handler and routes/solveHistory.ts both call this and nail
// nothing else in from the row.
//
// Exhaustive failureReason/Node-class -> errorCode table (§2.11's mapping +
// the A3.T terminal table), implemented as this fixed selection order:
//   1. errorCode === "TIMEOUT" (TT-1, the outer deadline)        -> TIMEOUT / "Solve timed out"
//   2. failureReason === "interrupted" (TT-2, reapStaleLeases)   -> SOLVE_FAILED / "Solve interrupted"
//   3. failureReason === "data_error" && failureStage==="validate"
//      (A2's recovery-contract-identity/version mismatch, and Phase 2's
//      legacy-row cleanup, which intentionally reuses the same shape)
//                                                                 -> SOLVE_FAILED / VERSION_MISMATCH_SAFE_MESSAGE
//   4. everything else that reached status="failed" — solver_error,
//      internal_error, model_error, any TT-5..TT-11/TT-14 protocol/exit/
//      spawn classification, AND any historical pre-A1 row with null typed
//      columns (read as a CONSERVATIVE SOLVE_FAILED, never fabricated as
//      TIMEOUT)                                                  -> SOLVE_FAILED / "Solve failed"
// A non-"failed" job (queued/running/succeeded) has no failure to report:
// null. The public retry rule (A5 deliverable 3, A-R47) is ONE sentence,
// not a field: every terminal async failure here — SOLVE_FAILED or TIMEOUT
// alike — is retryable; no `retryable` boolean is added to the contract,
// A9's frontend derives the retry action from `errorCode` alone.
// ---------------------------------------------------------------------------

export type PublicErrorCode = "SOLVE_FAILED" | "TIMEOUT";

export interface PublicSolveFailure {
  errorCode: PublicErrorCode;
  errorMessage: string;
}

const SAFE_MESSAGE_SOLVE_FAILED = "Solve failed";
const SAFE_MESSAGE_TIMEOUT = "Solve timed out";
const SAFE_MESSAGE_INTERRUPTED = "Solve interrupted";

export function derivePublicFailure(
  job: { status: string; errorCode?: string | null; failureReason?: string | null; failureStage?: string | null },
): PublicSolveFailure | null {
  if (job.status !== "failed") return null;

  if (job.errorCode === "TIMEOUT") {
    return { errorCode: "TIMEOUT", errorMessage: SAFE_MESSAGE_TIMEOUT };
  }

  // Every other case — including a null/absent errorCode on a historical
  // pre-A1 row — reads as the conservative SOLVE_FAILED default (never
  // TIMEOUT unless positively known).
  if (job.failureReason === "interrupted") {
    return { errorCode: "SOLVE_FAILED", errorMessage: SAFE_MESSAGE_INTERRUPTED };
  }
  if (job.failureReason === "data_error" && job.failureStage === "validate") {
    return { errorCode: "SOLVE_FAILED", errorMessage: VERSION_MISMATCH_SAFE_MESSAGE };
  }
  return { errorCode: "SOLVE_FAILED", errorMessage: SAFE_MESSAGE_SOLVE_FAILED };
}

async function removeWorkDirIdempotent(workDir: string): Promise<void> {
  try {
    // force: true already makes this a no-op (not an error) if the
    // directory is already gone — this IS the "verified idempotent
    // removal" requirement, not an extra guard on top of it.
    await fsp.rm(workDir, { recursive: true, force: true });
  } catch {
    // A3.T's K (cleanup outcome) column: "cleanup failure recorded
    // internal-only; never double-publishes" — classification has already
    // happened by the time this runs (it's in runJob's `finally`), so a
    // cleanup failure here can only ever be an internal-only diagnostic,
    // never something that changes what was already cached/published.
  }
}

// A2 — claims jobId (CAS queued->running), reconstructs a SolveInput if
// this job wasn't registered via the fast in-process path (i.e. it was
// discovered by the recurring dispatcher scan — enqueued by this or a
// prior process generation), performs the version-aware claim check
// (RECOVERY_CONTRACT_IDENTITY comparison), and hands off to runJob().
// Losing the CAS race (claimJobRow returns null) is NOT an error — it means
// another claimer already handled this row.
async function claimAndRun(jobId: number, hint: PendingJobHint | null): Promise<void> {
  const claimedRow = await claimJobRow(jobId);
  if (!claimedRow) return;
  const generation = bootClaimGeneration;

  let scenarioId: number;
  let userId: string;
  let input: SolveInput;
  if (hint) {
    scenarioId = hint.scenarioId;
    userId = hint.userId;
    input = hint.input;
  } else {
    scenarioId = claimedRow.scenarioId;
    userId = claimedRow.userId;
    const reconstructed = reconstructInputFromSnapshot(claimedRow);
    if (!reconstructed) {
      // Should never happen — scanAndClaimQueuedJobs already filters to
      // non-null snapshot/model_id rows — but defensive: terminal-fail
      // rather than spin on an unrecoverable claim.
      await markFailed(jobId, generation, "Recovered row has no valid input snapshot", {
        failureReason: "internal_error",
        failureStage: "protocol",
        errorCode: "SOLVE_FAILED",
      });
      return;
    }
    input = reconstructed;
  }

  // A7 — the job row's OWN captured publication-authority input (A-R32/
  // A-R39): the scenario's solve_input_revision AT THE MOMENT this job was
  // enqueued (inside enqueueScenarioSolve's locked transaction), threaded
  // through to markSucceeded's CAS. Null for a job enqueued via the simple
  // enqueueSolveJob primitive (never the real HTTP path — see its own
  // header) or a historical pre-A1 row; either way, markSucceeded treats
  // null as "never satisfies the CAS" (fail-closed).
  const enqueuedSolveInputRevision = claimedRow.enqueuedSolveInputRevision;

  // A2 — version-aware claim (A-R33/A-R40/A-R47). A null persisted identity
  // is never itself treated as a mismatch — every real production enqueue
  // path (buildSolveJobValues) sets it unconditionally, so a null here only
  // occurs for a defensively/test-inserted row with no identity recorded at
  // all, which carries no positive evidence of drift. A NON-NULL value that
  // differs from the CURRENT runtime's RECOVERY_CONTRACT_IDENTITY is the
  // real, decided mismatch: fail once, terminal, safe + retryable — never
  // silently execute an accepted snapshot under changed semantics.
  if (claimedRow.recoveryContractIdentity != null && claimedRow.recoveryContractIdentity !== RECOVERY_CONTRACT_IDENTITY) {
    const versionMismatchTaxonomy = {
      failureReason: "data_error" as const,
      failureStage: "validate" as const,
      errorCode: "SOLVE_FAILED" as const,
    };
    const published = await markFailed(jobId, generation, VERSION_MISMATCH_SAFE_MESSAGE, versionMismatchTaxonomy);
    if (published) {
      // A12 — PostHog product event: bounded `error_code` tag only, no
      // diagnostic contents (the internal failureReason/failureStage stay
      // off this surface entirely).
      posthog?.capture({
        distinctId: userId,
        event: "scenario solve failed",
        properties: {
          scenario_id: scenarioId,
          job_id: jobId,
          model_id: input.modelId,
          error_code: versionMismatchTaxonomy.errorCode,
        },
      });
      // A12 — Sentry operator sink: the closed internal taxonomy, no
      // structured errorDetail here (this is a static version-mismatch
      // check, not a parsed fd3 failure message).
      captureSolveFailure({
        failureReason: versionMismatchTaxonomy.failureReason,
        failureStage: versionMismatchTaxonomy.failureStage,
        errorDetail: null,
      });
    }
    return;
  }

  await runJob(jobId, scenarioId, userId, input, generation, enqueuedSolveInputRevision);
}

// The solver wrapper never throws — crashes, timeouts, and unparseable
// stdout/fd3 all degrade to a "failed" job with a message (a job status,
// not a synthesized error-shaped result). `generation` is this claim's
// ownership token (A2) — every terminal write below is ownership-checked
// against it, and a heartbeat loop renews the lease for as long as this
// function is executing.
async function runJob(
  jobId: number,
  scenarioId: number,
  userId: string,
  input: SolveInput,
  generation: number,
  enqueuedSolveInputRevision: number | null,
): Promise<void> {
  const stopHeartbeat = startOwnerHeartbeat(jobId, generation);
  try {
    // A6 — flag selects the WHOLE cache path (both this read and the
    // write-through below share this single computed value). Flag off
    // (default) => byte-for-byte the pre-A6 v1 key; see the block comment
    // above lookupCachedResult for the full rationale.
    const inputsHash = isV2WriteEnabled() ? computeInputsHashV2(input) : computeInputsHash(input);
    const cached = await lookupCachedResult(inputsHash);
    if (cached) {
      // A7 — a cache hit republishes whatever a PRIOR job already cached; no
      // outcome-cacheability branch needed here (that only gates NEW writes
      // below) — but the ALWAYS-ON publication CAS still applies, gated on
      // THIS job's own identity, never the cache-writing job's.
      const publishOutcome = await markSucceeded(jobId, generation, scenarioId, userId, input.modelId, cached, enqueuedSolveInputRevision);
      // A12 — "scenario solve completed" fires ONLY for the "published"
      // outcome: strictly after markSucceeded's transaction has committed
      // (markSucceeded is `await`ed above, so its transaction is already
      // committed by the time this line runs) AND only when this job's
      // result actually became the scenario's current result. A
      // "superseded" job (compute succeeded, but a newer job/input edit won
      // the scenario CAS) and a "not_owned" job (this process's lease was
      // already lost) both correctly emit NOTHING here — from a product
      // telemetry perspective, "completed" means the student's scenario now
      // shows this result, which is false for either of those two kinds.
      if (publishOutcome.kind === "published") {
        posthog?.capture({
          distinctId: userId,
          event: "scenario solve completed",
          properties: {
            scenario_id: scenarioId,
            job_id: jobId,
            model_id: input.modelId,
            status: cached.status,
            objective: cached.objective,
            run_time_sec: cached.runTimeSec,
            cache_hit: true,
            published: true,
          },
        });
      }
      return;
    }

    const payload = JSON.stringify(buildPayload(input));
    const timeoutMs = input.inputs.timeLimitSec * 1000 + TIMEOUT_GRACE_MS;

    const controller = new AbortController();
    activeControllers.set(jobId, { controller, source: "internal" });

    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "nos-solve-"));
    let result: SupervisedRunResult;
    try {
      result = await runSolverProcess(payload, timeoutMs, { workDir, signal: controller.signal });
    } finally {
      activeControllers.delete(jobId);
      // Node owns this temp dir end-to-end: created here, removed here, only
      // AFTER runSolverProcess has resolved (which — for the timeout/cancel
      // paths — only happens once terminateProcessGroup() has already
      // confirmed, or bounded-best-effort-waited for, whole-group death).
      await removeWorkDirIdempotent(workDir);
    }

    const outcome = result.outcome;

    if (outcome.kind === "timeout") {
      // A5 (TT-1) — the typed columns are the source of truth for the
      // public serializer (derivePublicFailure below); this internal
      // `error` string is diagnostic-only and never read by it.
      const timeoutTaxonomy = { failureReason: "timeout" as const, failureStage: "timeout" as const, errorCode: "TIMEOUT" as const };
      const published = await markFailed(jobId, generation, "Solver timed out", timeoutTaxonomy);
      if (published) {
        posthog?.capture({
          distinctId: userId,
          event: "scenario solve failed",
          properties: { scenario_id: scenarioId, job_id: jobId, model_id: input.modelId, error_code: timeoutTaxonomy.errorCode },
        });
        captureSolveFailure({
          failureReason: timeoutTaxonomy.failureReason,
          failureStage: timeoutTaxonomy.failureStage,
          errorDetail: result.failureErrorDetail,
        });
      }
      return;
    }

    if (outcome.kind === "interrupted") {
      // A5 (TT-2) — `failureStage` stays null here: at cancel/SIGTERM time
      // Node has no reliable "what stage was CBC in" signal (unlike the
      // reaper's own stale-lease case in reapStaleLeases below, which knows
      // exactly why it's failing this row).
      const interruptedTaxonomy = { failureReason: "interrupted" as const, failureStage: null, errorCode: "SOLVE_FAILED" as const };
      const published = await markFailed(jobId, generation, "Solver was interrupted", interruptedTaxonomy);
      if (published) {
        posthog?.capture({
          distinctId: userId,
          event: "scenario solve failed",
          properties: { scenario_id: scenarioId, job_id: jobId, model_id: input.modelId, error_code: interruptedTaxonomy.errorCode },
        });
        captureSolveFailure({
          failureReason: interruptedTaxonomy.failureReason,
          failureStage: interruptedTaxonomy.failureStage,
          errorDetail: result.failureErrorDetail,
        });
      }
      return;
    }

    if (outcome.kind === "failed") {
      const failedTaxonomy = { failureReason: outcome.failureReason, failureStage: outcome.failureStage, errorCode: "SOLVE_FAILED" as const };
      const published = await markFailed(jobId, generation, safeFailureMessage(outcome.failureReason, outcome.failureStage), failedTaxonomy);
      if (published) {
        posthog?.capture({
          distinctId: userId,
          event: "scenario solve failed",
          properties: {
            scenario_id: scenarioId,
            job_id: jobId,
            model_id: input.modelId,
            error_code: failedTaxonomy.errorCode,
          },
        });
        captureSolveFailure({
          failureReason: failedTaxonomy.failureReason,
          failureStage: failedTaxonomy.failureStage,
          errorDetail: result.failureErrorDetail,
        });
      }
      return;
    }

    // outcome.kind === "success" — A3.C: down-convert to the existing legacy
    // envelope shape. A7 (§2.8): branch on the TRUTHFUL outcome BEFORE the
    // cache write — permission to cache is granted only by A3.T rows
    // TT-3/TT-4 (this whole branch), but WHICH solutionStatus values are
    // actually cache-eligible depends on the outcome table (see
    // isOutcomeCacheable's own header for the full flag-scoped rationale).
    // Publication (markSucceeded) always runs for every solved outcome,
    // regardless of cache eligibility — a `no_solution`/uncached `feasible`
    // result is still the truthful, published answer, it just isn't reused
    // as a cache entry.
    const legacy = toLegacyStoredResult(outcome.envelope);
    const v2Enabled = isV2WriteEnabled();
    if (isOutcomeCacheable(legacy.status, v2Enabled)) {
      await writeThroughCache(inputsHash, input.modelId, legacy);
    }
    const publishOutcome = await markSucceeded(jobId, generation, scenarioId, userId, input.modelId, legacy, enqueuedSolveInputRevision);
    // A12/A7 — same "published only" gate as the cache-hit branch above:
    // "superseded" (this job's own terminal write succeeded, but the
    // scenario CAS lost to a newer job or a later input edit) and
    // "not_owned" (this process's lease was already gone) both emit
    // nothing. `markSucceeded` is awaited above, so its one publication
    // transaction has already committed by the time this fires — "completed"
    // is never emitted before that commit.
    if (publishOutcome.kind === "published") {
      posthog?.capture({
        distinctId: userId,
        event: "scenario solve completed",
        properties: {
          scenario_id: scenarioId,
          job_id: jobId,
          model_id: input.modelId,
          status: legacy.status,
          objective: legacy.objective,
          run_time_sec: legacy.runTimeSec,
          cache_hit: false,
          published: true,
        },
      });
    }
  } catch {
    // A2 — an unexpected exception ANYWHERE between claim and a defined
    // terminal outcome (e.g. a mkdtemp failure, a bug) must not strand this
    // job "running" forever waiting for the 60s stale-lease sweep. This is
    // exactly the "crash immediately after claim, immediately before
    // spawn" case: an honest, IMMEDIATE terminal failure — never a silent
    // stall, and never a retry (A performs no automatic retry).
    //
    // A12 — this is the one failure branch that previously emitted NO
    // telemetry at all (neither PostHog nor Sentry) despite being a real,
    // user-visible "scenario solve failed" outcome. The taxonomy is fixed
    // (internal_error/spawn, matching the DB write below) — the actual
    // caught exception is NEVER read into either sink: an arbitrary JS
    // exception's message/stack can carry a filesystem path or other
    // incidental detail, which both contracts (PostHog's bounded errorCode
    // and Sentry's own allowlist) explicitly prohibit.
    const unexpectedTaxonomy = { failureReason: "internal_error" as const, failureStage: "spawn" as const, errorCode: "SOLVE_FAILED" as const };
    const published = await markFailed(jobId, generation, "Unexpected error before a solver outcome was reached", unexpectedTaxonomy);
    if (published) {
      posthog?.capture({
        distinctId: userId,
        event: "scenario solve failed",
        properties: {
          scenario_id: scenarioId,
          job_id: jobId,
          model_id: input.modelId,
          error_code: unexpectedTaxonomy.errorCode,
        },
      });
      captureSolveFailure({
        failureReason: unexpectedTaxonomy.failureReason,
        failureStage: unexpectedTaxonomy.failureStage,
        errorDetail: null,
      });
    }
  } finally {
    stopHeartbeat();
  }
}
