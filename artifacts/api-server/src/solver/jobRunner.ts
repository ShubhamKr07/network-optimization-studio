import { spawn } from "child_process";
import os from "os";
import { existsSync, readFileSync } from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db, solveJobsTable, scenariosTable, resultCacheTable } from "@workspace/db";
import type { InsertSolveJob } from "@workspace/db";
import { readVersion } from "@workspace/dataset-schema";
import { ResultEnvelopeSchema } from "./resultEnvelope.js";
import type { ResultEnvelope } from "./resultEnvelope.js";
import { buildPayload } from "./pmedian.js";
import type { SolveInput } from "./pmedian.js";
import { getManifest } from "../registry/modelRegistry.js";
import { posthog } from "../lib/posthog.js";
import { validateInputsForModel } from "../validation/inputs/index.js";
import { runNetworkEditsPrecheckForModel } from "../services/precheck.js";
import type { PrecheckResult } from "../services/precheck.js";
import { computeRecoveryContractIdentity } from "./recoveryContractIdentity.js";
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
const pendingJobs = new Map<number, { scenarioId: number; userId: string; input: SolveInput }>();

// Jobs waiting for a free worker slot — the number the route layer's
// backpressure check cares about. Deliberately excludes `activeCount`
// (already-running jobs aren't a queuing/capacity problem).
export function getQueueDepth(): number {
  return queue.length;
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

function pump(): void {
  while (activeCount < CONCURRENCY && queue.length > 0) {
    const jobId = queue.shift()!;
    const job = pendingJobs.get(jobId);
    pendingJobs.delete(jobId);
    if (!job) continue;
    activeCount++;
    runJob(jobId, job.scenarioId, job.userId, job.input)
      .catch(() => {
        /* runJob itself never throws — this is a last-resort guard so a
           bug here can't wedge the worker pool. */
      })
      .finally(() => {
        activeCount--;
        pump();
      });
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
// both abort the same AbortSignal runSolverProcess watches. Deliberately
// NOT wired into index.ts's own SIGTERM handler by this task (index.ts is
// outside solver/'s ownership) — exported so that wiring is a one-line
// addition for whoever owns index.ts.
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
      resolve({ outcome, pid: child.pid ?? null, stderrText: stderrCollector.text() });
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

async function markRunning(jobId: number): Promise<void> {
  await db.update(solveJobsTable)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(solveJobsTable.id, jobId));
}

async function markFailed(jobId: number, error: string): Promise<void> {
  await db.update(solveJobsTable)
    .set({ status: "failed", error: error.slice(0, 500), finishedAt: new Date() })
    .where(eq(solveJobsTable.id, jobId));
}

// Startup reaper: any solve_jobs row left in "running" status from a prior
// process is, by definition, no longer running (the in-process worker pool
// died with that process and nothing is feeding solve.py for it). On boot
// we sweep them all to "failed" so they don't appear forever-stuck to the
// client. This must never block or fail startup — any error is swallowed.
export async function reapStuckJobs(): Promise<void> {
  try {
    const stuck = await db.select().from(solveJobsTable)
      .where(eq(solveJobsTable.status, "running"));
    for (const job of stuck) {
      await markFailed(job.id, "Interrupted by server restart");
    }
  } catch {
    // The reaper is a best-effort cleanup — a transient DB error or a
    // botched markFailed must not prevent the server from coming up.
    return;
  }
}

// Phase 6 (P1.2) — write-through result cache, keyed on computeInputsHash().
// Byte-identical repeated solves (common in a classroom where many students
// start from the textbook baseline) skip spawning solve.py entirely.
//
// A3.C — this cache stays on the EXISTING (pre-A3) ResultEnvelopeSchema/
// SOLVER_CODE_HASH key. No canonical v2 cache row is ever written by this
// task; toLegacyStoredResult() below is what makes a v2 fd3 success
// envelope compatible with this unchanged cache shape before it's ever
// written.

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

async function markSucceeded(jobId: number, scenarioId: number, modelId: string, envelope: ResultEnvelope): Promise<void> {
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

  // Part F (T6) — these two writes must be ATOMIC. Split across two
  // independent statements (the pre-T6 shape), a partial failure could leave
  // an addressable succeeded run whose scenario still points at an older
  // result, or a scenario result with no run pointer. Both statements are
  // id-scoped, so a scenario (and its jobs) deleted mid-solve simply matches
  // 0 rows on one or both sides and the transaction commits as a harmless
  // no-op — not an error.
  await db.transaction(async (tx) => {
    await tx.update(solveJobsTable)
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
      .where(eq(solveJobsTable.id, jobId));

    await tx.update(scenariosTable)
      .set({
        result: resultJson,
        resultRunId: jobId,
        solvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scenariosTable.id, scenarioId));
  });
}

// A3 — a fixed, safe message for solve_jobs.error. Built ONLY from the
// terminal table's own closed enums (failureReason/failureStage), never
// from raw stdout/stderr/exception text — this is the "temporary fixed
// safe message" the task calls for; A5 later replaces this with the real
// public errorCode/errorMessage serializer.
function safeFailureMessage(reason: string, stage: string): string {
  return `Solver failed (${reason}/${stage})`;
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

// The solver wrapper never throws — crashes, timeouts, and unparseable
// stdout/fd3 all degrade to a "failed" job with a message (a job status,
// not a synthesized error-shaped result).
async function runJob(jobId: number, scenarioId: number, userId: string, input: SolveInput): Promise<void> {
  await markRunning(jobId);

  const inputsHash = computeInputsHash(input);
  const cached = await lookupCachedResult(inputsHash);
  if (cached) {
    await markSucceeded(jobId, scenarioId, input.modelId, cached);
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
      },
    });
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
    await markFailed(jobId, "Solver timed out");
    posthog?.capture({
      distinctId: userId,
      event: "scenario solve failed",
      properties: { scenario_id: scenarioId, job_id: jobId, model_id: input.modelId, reason: "timeout" },
    });
    return;
  }

  if (outcome.kind === "interrupted") {
    await markFailed(jobId, "Solver was interrupted");
    posthog?.capture({
      distinctId: userId,
      event: "scenario solve failed",
      properties: { scenario_id: scenarioId, job_id: jobId, model_id: input.modelId, reason: "interrupted" },
    });
    return;
  }

  if (outcome.kind === "failed") {
    await markFailed(jobId, safeFailureMessage(outcome.failureReason, outcome.failureStage));
    posthog?.capture({
      distinctId: userId,
      event: "scenario solve failed",
      properties: {
        scenario_id: scenarioId,
        job_id: jobId,
        model_id: input.modelId,
        reason: `${outcome.failureReason}:${outcome.failureStage}`,
      },
    });
    return;
  }

  // outcome.kind === "success" — A3.C: down-convert to the existing legacy
  // envelope shape and route through the EXISTING (unchanged) cache/publish
  // path. No v2 write anywhere.
  const legacy = toLegacyStoredResult(outcome.envelope);
  await writeThroughCache(inputsHash, input.modelId, legacy);
  await markSucceeded(jobId, scenarioId, input.modelId, legacy);
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
    },
  });
}
