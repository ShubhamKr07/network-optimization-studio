import { spawn } from "child_process";
import os from "os";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db, solveJobsTable, scenariosTable, resultCacheTable } from "@workspace/db";
import { readVersion } from "@workspace/dataset-schema";
import { ResultEnvelopeSchema } from "./resultEnvelope.js";
import type { ResultEnvelope } from "./resultEnvelope.js";
import { buildPayload } from "./pmedian.js";
import type { SolveInput } from "./pmedian.js";
import { posthog } from "../lib/posthog.js";

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

// Enqueues a solve job: inserts the solve_jobs row synchronously (so the
// route can return 202 {jobId} immediately) and kicks off the in-process
// worker pool without awaiting it — the job runs in the background.
export async function enqueueSolveJob(scenarioId: number, userId: string, input: SolveInput): Promise<number> {
  const inputsHash = computeInputsHash(input);
  const [job] = await db.insert(solveJobsTable).values({
    scenarioId,
    userId,
    status: "queued",
    inputsHash,
  }).returning();

  pendingJobs.set(job.id, { scenarioId, userId, input });
  queue.push(job.id);
  pump();
  return job.id;
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

interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  spawnError: string | null;
}

// Solver contract: stdout's last non-empty line is the JSON envelope.
// Tolerates stray banner output without silently accepting garbage — solve.py
// may emit a deprecation warning or CBC banner line, and a naive
// JSON.parse(stdout) would reject the whole thing. We take only the last
// non-empty line so a banner doesn't break parsing, and throw explicitly if
// there's nothing to parse (a real failure worth surfacing, not a silent
// empty-object fallthrough). [R1, R2]
function lastJsonLine(raw: string): string {
  const lines = raw.trim().split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new Error("empty solver stdout");
  return lines[lines.length - 1];
}

function runSolverProcess(payload: string, timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    // cwd guards [C6] — run from os.tmpdir() so a malicious/buggy solver
    // script that writes relative paths lands them in the OS temp dir, not
    // the repo root.
    const child = spawn("python3", [SOLVER_PY], { cwd: os.tmpdir() });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const finish = (result: SpawnResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      // Resolve directly rather than waiting on "close" — a killed process
      // isn't guaranteed to report it promptly, and this is the one signal
      // the job runner actually needs to move on and mark the job failed.
      finish({ stdout, stderr, code: null, timedOut: true, spawnError: null });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (err) => finish({ stdout, stderr, code: null, timedOut, spawnError: err.message }));
    child.on("close", (code) => finish({ stdout, stderr, code, timedOut, spawnError: null }));

    child.stdin.write(payload);
    child.stdin.end();
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

async function lookupCachedResult(inputsHash: string): Promise<ResultEnvelope | null> {
  try {
    const [row] = await db.select().from(resultCacheTable)
      .where(eq(resultCacheTable.inputsHash, inputsHash));
    if (!row) return null;

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

async function markSucceeded(jobId: number, scenarioId: number, envelope: ResultEnvelope): Promise<void> {
  await db.update(solveJobsTable)
    .set({
      status: "succeeded",
      resultSummary: {
        status: envelope.status,
        objective: envelope.objective,
        weightedAvgDistanceMi: envelope.metrics.weightedAvgDistance ?? 0,
        runTimeSec: envelope.runTimeSec,
      },
      finishedAt: new Date(),
    })
    .where(eq(solveJobsTable.id, jobId));

  await db.update(scenariosTable)
    .set({ result: envelope as unknown as Record<string, unknown>, solvedAt: new Date(), updatedAt: new Date() })
    .where(eq(scenariosTable.id, scenarioId));
}

// The solver wrapper never throws — crashes, timeouts, and unparseable
// stdout all degrade to a "failed" job with a message (a job status, not a
// synthesized error-shaped result).
async function runJob(jobId: number, scenarioId: number, userId: string, input: SolveInput): Promise<void> {
  await markRunning(jobId);

  const inputsHash = computeInputsHash(input);
  const cached = await lookupCachedResult(inputsHash);
  if (cached) {
    await markSucceeded(jobId, scenarioId, cached);
    posthog?.capture({ distinctId: userId, event: "scenario solved", properties: { scenario_id: scenarioId, model_id: input.modelId, job_id: jobId, objective: cached.objective, run_time_sec: cached.runTimeSec, from_cache: true } });
    return;
  }

  const payload = JSON.stringify(buildPayload(input));
  const timeoutMs = input.inputs.timeLimitSec * 1000 + 15000;

  const { stdout, stderr, code, timedOut, spawnError } = await runSolverProcess(payload, timeoutMs);

  if (timedOut) {
    await markFailed(jobId, "Solver timed out");
    posthog?.capture({ distinctId: userId, event: "scenario solve failed", properties: { scenario_id: scenarioId, model_id: input.modelId, job_id: jobId, reason: "timeout" } });
    return;
  }
  if (spawnError) {
    await markFailed(jobId, spawnError);
    posthog?.capture({ distinctId: userId, event: "scenario solve failed", properties: { scenario_id: scenarioId, model_id: input.modelId, job_id: jobId, reason: "spawn_error" } });
    return;
  }
  if (code !== 0) {
    await markFailed(jobId, `python3 process failed: ${stderr.slice(0, 500)}`);
    posthog?.capture({ distinctId: userId, event: "scenario solve failed", properties: { scenario_id: scenarioId, model_id: input.modelId, job_id: jobId, reason: "non_zero_exit" } });
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(lastJsonLine(stdout));
  } catch {
    await markFailed(
      jobId,
      `Failed to parse solver output. stdout=${stdout.slice(0, 200)} stderr=${stderr.slice(0, 500)}`,
    );
    posthog?.capture({ distinctId: userId, event: "scenario solve failed", properties: { scenario_id: scenarioId, model_id: input.modelId, job_id: jobId, reason: "parse_error" } });
    return;
  }

  const parsed = ResultEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    await markFailed(jobId, "Solver output failed envelope validation: " + parsed.error.message.slice(0, 300));
    posthog?.capture({ distinctId: userId, event: "scenario solve failed", properties: { scenario_id: scenarioId, model_id: input.modelId, job_id: jobId, reason: "invalid_envelope" } });
    return;
  }

  await writeThroughCache(inputsHash, input.modelId, parsed.data);
  await markSucceeded(jobId, scenarioId, parsed.data);
  posthog?.capture({ distinctId: userId, event: "scenario solved", properties: { scenario_id: scenarioId, model_id: input.modelId, job_id: jobId, objective: parsed.data.objective, run_time_sec: parsed.data.runTimeSec, from_cache: false } });
}
