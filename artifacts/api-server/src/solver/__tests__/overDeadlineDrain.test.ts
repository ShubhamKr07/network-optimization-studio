// A14b (SCND Correctness) — real-process, real-Postgres integration proof
// that A2's SIGTERM drain (`drainForShutdown`) and A3's process-group
// supervisor (`cancelAllActiveJobs` -> `terminateProcessGroup`) actually
// compose: a solve deliberately longer than the drain deadline is
// interrupted cleanly on shutdown, with no orphan process, its temp dir
// reclaimed, and its row reaching exactly one deterministic terminal
// outcome (`failed`) — never "released", never requeued (A performs no
// automatic retry).
//
// Matches dispatcherRecovery.test.ts's / jobRunnerRealIntegration.test.ts's
// convention: real, unmocked `child_process.spawn` + real `solve.py` + real
// Postgres. `drainForShutdown` itself is called directly with shortened
// graceMs/forceGraceMs (its own real parameters — no env-var indirection,
// no need to boot index.ts's server/dispatcher-init machinery) so the test
// exercises the exact production code path at test speed.
//
// This repo's real datasets all solve sub-second (see CLAUDE.md's own
// `e2e_accuracy.py` timing gotcha), so there is no naturally slow,
// deterministic model available to drive "a solve outlives the drain
// deadline" without either a flaky multi-second real CBC run or fake
// timers (which can't drive a REAL child process). Per this task's explicit
// authorization, a minimal test-only seam was added to `solve.py`'s
// `__main__` guard (gated behind `NOS_SOLVE_TEST_HANG_SEC`, never set in
// production, never touching solve()/solve_* math) — see solve.py's own
// comment at that branch for the full rationale.
import { afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import { enqueueSolveJob, drainForShutdown, getActiveJobIds, setDraining } from "../jobRunner.js";
import type { SolveInput } from "../pmedian.js";

const TEST_USER_ID = `a14b-over-deadline-drain-${Date.now()}`;
let scenarioId: number | undefined;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Scans os.tmpdir() for a `nos-solve-*` directory (Node's own mkdtemp
// prefix, jobRunner.ts:1346) containing our seam's `hang.pids` marker file
// — that filename is written ONLY by the NOS_SOLVE_TEST_HANG_SEC branch, so
// finding it unambiguously identifies OUR job's temp dir even if other real
// solves happen to be running concurrently elsewhere in the same host.
async function pollForHangPidsFile(timeoutMs: number): Promise<{ file: string; workDir: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(os.tmpdir()).filter((e) => e.startsWith("nos-solve-"));
    } catch {
      /* transient — retry */
    }
    for (const e of entries) {
      const workDir = path.join(os.tmpdir(), e);
      const file = path.join(workDir, "hang.pids");
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, "utf8").trim();
        if (content.length > 0) return { file, workDir };
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("solve.py's NOS_SOLVE_TEST_HANG_SEC seam never wrote hang.pids in time");
}

async function pollJobStatus(jobId: number, statuses: string[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, jobId));
    if (row && statuses.includes(row.status)) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`job ${jobId} never reached one of [${statuses.join(",")}] within ${timeoutMs}ms`);
}

afterAll(async () => {
  delete process.env.NOS_SOLVE_TEST_HANG_SEC;
  // Belt-and-suspenders: drainForShutdown sets draining=true and never
  // resets it (correct for a real process shutting down for real) — reset
  // it here so this file doesn't silently block enqueues in any OTHER test
  // file sharing this vitest worker process.
  setDraining(false);
  if (scenarioId) {
    await db.delete(solveJobsTable).where(eq(solveJobsTable.scenarioId, scenarioId));
    await db.delete(scenariosTable).where(eq(scenariosTable.id, scenarioId));
  }
  await db.delete(usersTable).where(eq(usersTable.id, TEST_USER_ID));
});

describe("A14b — over-deadline SIGTERM drain integration proof", () => {
  it("a solve deliberately longer than the drain deadline is interrupted cleanly: no orphan process, temp reclaimed, one terminal `failed` outcome, inside budget", async () => {
    await db.insert(usersTable).values({ id: TEST_USER_ID, email: `${TEST_USER_ID}@example.test` });

    const input: SolveInput = {
      modelId: "p-median-us",
      inputs: {
        p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
        warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 300,
        addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
      },
    };

    const [scenario] = await db.insert(scenariosTable).values({
      name: "A14b over-deadline drain fixture",
      userId: TEST_USER_ID,
      modelId: input.modelId,
      inputs: input.inputs as unknown as Record<string, unknown>,
    }).returning();
    scenarioId = scenario!.id;

    // 120s — far longer than any grace value used below (or than any
    // realistic production drain budget, A14a's 90s/120s). The test forcibly
    // kills the whole process group long before this would ever elapse
    // naturally; it only needs to be "long enough to still be alive when we
    // drain," not tuned to any specific deadline.
    process.env.NOS_SOLVE_TEST_HANG_SEC = "120";

    let jobId: number;
    let hangInfo: { file: string; workDir: string };
    try {
      jobId = await enqueueSolveJob(scenarioId, TEST_USER_ID, input);
      hangInfo = await pollForHangPidsFile(10_000);
    } finally {
      // Narrow the env-var window as much as practical — the child that
      // matters has already read process.env by the time spawn() was
      // called (synchronous read at call time), so it's safe to clear once
      // the seam has confirmably started (hang.pids exists).
      delete process.env.NOS_SOLVE_TEST_HANG_SEC;
    }

    const [pythonPidStr, sleepPidStr] = fs.readFileSync(hangInfo.file, "utf8").trim().split(",");
    const pythonPid = Number(pythonPidStr);
    const sleepPid = Number(sleepPidStr);
    expect(Number.isInteger(pythonPid)).toBe(true);
    expect(Number.isInteger(sleepPid)).toBe(true);

    // Sanity: both really are alive, and the job is genuinely active/running,
    // BEFORE we drain — otherwise every assertion below would be vacuous.
    expect(isAlive(pythonPid)).toBe(true);
    expect(isAlive(sleepPid)).toBe(true);
    expect(getActiveJobIds()).toContain(jobId);
    expect(fs.existsSync(hangInfo.workDir)).toBe(true);
    await pollJobStatus(jobId, ["running"], 10_000);

    // Deliberately shortened grace values — production defaults
    // (index.ts:64-67) are 60s/15s; passing drainForShutdown's own real
    // parameters directly exercises the EXACT production code path (no
    // env-var/module-reload indirection needed) at test speed, genuinely
    // driving the "solve outlives grace -> force-cancelled" branch rather
    // than the "finishes naturally within grace" branch.
    const graceMs = 300;
    const forceGraceMs = 1000;
    const start = Date.now();
    await drainForShutdown("a14b-test-shutdown", { graceMs, forceGraceMs });
    const elapsedMs = Date.now() - start;

    // Drain completes inside its own stated budget (small margin for the
    // group-death probe / DB round trips) — never hangs indefinitely
    // waiting on an over-deadline solve.
    expect(elapsedMs).toBeLessThan(graceMs + forceGraceMs + 5_000);

    // No orphan process: neither the python3 child nor its (CBC-standing-in)
    // sleep grandchild survives the drain — probed by real PID/PGID
    // signal-0, matching A3's own no-orphan proof mechanism.
    expect(isAlive(pythonPid)).toBe(false);
    expect(isAlive(sleepPid)).toBe(false);

    // Temp reclaimed: the Node-owned per-solve mkdtemp dir is removed.
    expect(fs.existsSync(hangInfo.workDir)).toBe(false);

    // Exactly one deterministic terminal outcome: `failed` — never
    // "released"/requeued (A-R36/A-R37: A performs no automatic retry).
    // TT-2's taxonomy for a cancellation-classified outcome: the internal
    // `error` diagnostic text stays as before, and A5 now also stamps the
    // typed columns its public serializer (derivePublicFailure) reads —
    // errorCode='SOLVE_FAILED' (never TIMEOUT for a cancellation, even
    // though a deploy drain and an outer timeout can look superficially
    // similar) and failureReason='interrupted'.
    const row = await pollJobStatus(jobId, ["failed", "succeeded"], 5_000);
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/interrupted/i);
    expect(row.errorCode).toBe("SOLVE_FAILED");
    expect(row.failureReason).toBe("interrupted");

    // Never published/cached as a scenario result — a cancelled solve must
    // not surface as a success.
    const [updatedScenario] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenarioId));
    expect(updatedScenario!.resultRunId).not.toBe(jobId);
  }, 60_000);
});
