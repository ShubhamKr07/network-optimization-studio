import { spawn } from "child_process";
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
const SOLVER_PY = path.resolve(__dirname, "solve.py");

// Small in-process worker pool (Phase 3.5, G3.1) — replaces the old
// blocking spawnSync call. Pilot cohort is assumed <=10 concurrent users
// (§0.5 OQ2), so a simple array-based queue + fixed concurrency is enough;
// genuine throughput scaling is deferred to Phase 6.
const CONCURRENCY = 3;
let activeCount = 0;
const queue: number[] = [];
const pendingJobs = new Map<number, { scenarioId: number; input: SolveInput }>();

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
