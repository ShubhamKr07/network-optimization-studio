import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db, solveJobsTable, scenariosTable } from "@workspace/db";
import { readVersion } from "@workspace/dataset-schema";
import { ResultEnvelopeSchema } from "./resultEnvelope.js";
import type { ResultEnvelope } from "./resultEnvelope.js";
import { buildPayload } from "./pmedian.js";
import type { SolveInput } from "./pmedian.js";

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
const pendingJobs = new Map<number, { scenarioId: number; input: SolveInput }>();

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
    .update(input.modelId + datasetVersion + canonicalJson(input.inputs))
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

  pendingJobs.set(job.id, { scenarioId, input });
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
    runJob(jobId, job.scenarioId, job.input)
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
  code: number | null;
  timedOut: boolean;
  spawnError: string | null;
}

function runSolverProcess(payload: string, timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn("python3", [SOLVER_PY]);
    let stdout = "";
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
      finish({ stdout, code: null, timedOut: true, spawnError: null });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.on("error", (err) => finish({ stdout, code: null, timedOut, spawnError: err.message }));
    child.on("close", (code) => finish({ stdout, code, timedOut, spawnError: null }));

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
async function runJob(jobId: number, scenarioId: number, input: SolveInput): Promise<void> {
  await markRunning(jobId);

  const payload = JSON.stringify(buildPayload(input));
  const timeoutMs = input.inputs.timeLimitSec * 1000 + 15000;

  const { stdout, code, timedOut, spawnError } = await runSolverProcess(payload, timeoutMs);

  if (timedOut) {
    await markFailed(jobId, "Solver timed out");
    return;
  }
  if (spawnError) {
    await markFailed(jobId, spawnError);
    return;
  }
  if (code !== 0) {
    await markFailed(jobId, "python3 process failed");
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    await markFailed(jobId, "Failed to parse solver output: " + stdout.slice(0, 200));
    return;
  }

  const parsed = ResultEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    await markFailed(jobId, "Solver output failed envelope validation: " + parsed.error.message.slice(0, 300));
    return;
  }

  await markSucceeded(jobId, scenarioId, parsed.data);
}
