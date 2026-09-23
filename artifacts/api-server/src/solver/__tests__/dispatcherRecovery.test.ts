// A2 (SCND Correctness) — real, unmocked Postgres tests of the durable
// dispatcher's DB-semantics-dependent behavior: the CAS claim, the owner
// heartbeat/lease predicates, stale-lease takeover, the recurring scan's
// re-discovery of later-inserted rows, the version-aware claim, Phase 2's
// gated legacy cleanup, and the boot-time claim_generation sequence. Matches
// scenarioSolveAtomicity.test.ts's convention (real DB, not mocked) — these
// are fundamentally atomic-predicate/transactional-correctness proofs a
// mocked `db.update` can't demonstrate.
//
// Shared-DB caution (documented, not a defect): scanAndClaimQueuedJobs() and
// reapStaleLeases() query `solve_jobs` GLOBALLY (status='queued'/'running'
// with no owner scope — by design, matching the real production dispatcher,
// which must service every user). Other real-DB test files
// (jobRunnerRealIntegration.test.ts, scenarioSolveAtomicity.test.ts) claim
// their own rows via the fast enqueue path synchronously (no `await` between
// insert and registerQueuedJob's pump() call), so the exposure window is
// microtask-scale. reapStaleLeases() is inherently safe cross-file (it only
// ever touches a row whose heartbeat has been stale for 60+ REAL seconds —
// no other test in this repo runs that long). Tests below that use
// runDispatcherTickOnce()'s SCAN half backdate their own row's `queued_at`
// so it always sorts first (oldest-first ordering), minimizing collision
// with any other file's transient queued row. initDispatcherForBoot() /
// startDispatcherScheduler() are ALWAYS immediately paired with
// stopDispatcherScheduler() in the same test so no live recurring timer
// survives into the rest of the suite.
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import {
  claimJobRow,
  refreshOwnerHeartbeat,
  reapStaleLeases,
  runDispatcherTickOnce,
  runPhase2LegacyCleanup,
  initDispatcherForBoot,
  stopDispatcherScheduler,
  getBootClaimGeneration,
  setDraining,
  registerQueuedJob,
  getQueueDepth,
  RECOVERY_CONTRACT_IDENTITY,
  VERSION_MISMATCH_SAFE_MESSAGE,
} from "../jobRunner.js";
import type { SolveInput } from "../pmedian.js";

const TEST_USER_ID = `a2-dispatcher-${Date.now()}`;
const scenarioIds: number[] = [];

const validPmedianInputs = {
  p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
  warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
  addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};

async function createScenario(): Promise<number> {
  const [row] = await db.insert(scenariosTable).values({
    name: "A2 dispatcher fixture",
    userId: TEST_USER_ID,
    modelId: "p-median-us",
    inputs: validPmedianInputs,
  }).returning();
  scenarioIds.push(row!.id);
  return row!.id;
}

// Inserts a solve_jobs row directly (bypassing enqueueSolveJob/
// registerQueuedJob) to simulate "a row that exists in the DB with no
// in-process owner" — exactly what a recurring dispatcher scan (as opposed
// to the fast in-process enqueue path) must discover. `queuedAtOffsetMs`
// backdates queued_at so the row sorts first under oldest-first ordering
// (minimizes any cross-file scan collision — see file header).
async function insertQueuedRow(opts: {
  scenarioId: number;
  status?: string;
  recoveryContractIdentity?: string | null;
  inputSnapshot?: Record<string, unknown> | null;
  modelId?: string | null;
  queuedAtOffsetMs?: number;
  claimGeneration?: number | null;
  ownerHeartbeatAt?: Date | null;
}): Promise<number> {
  const queuedAt = new Date(Date.now() - (opts.queuedAtOffsetMs ?? 3_600_000));
  const [row] = await db.insert(solveJobsTable).values({
    scenarioId: opts.scenarioId,
    userId: TEST_USER_ID,
    status: opts.status ?? "queued",
    inputsHash: `a2-dispatcher-test-${Math.random()}`,
    modelId: opts.modelId === undefined ? "p-median-us" : opts.modelId,
    inputSnapshot: opts.inputSnapshot === undefined
      ? { modelId: "p-median-us", inputs: validPmedianInputs }
      : opts.inputSnapshot,
    recoveryContractIdentity: opts.recoveryContractIdentity === undefined
      ? RECOVERY_CONTRACT_IDENTITY
      : opts.recoveryContractIdentity,
    queuedAt,
    claimGeneration: opts.claimGeneration ?? null,
    ownerHeartbeatAt: opts.ownerHeartbeatAt ?? null,
  }).returning();
  return row!.id;
}

async function getJob(jobId: number) {
  const [row] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, jobId));
  return row!;
}

async function pollUntilTerminal(jobId: number, timeoutMs: number): Promise<{ status: string; error: string | null; elapsedMs: number }> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    const row = await getJob(jobId);
    if (row.status === "succeeded" || row.status === "failed") {
      return { status: row.status, error: row.error, elapsedMs: Date.now() - start };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`job ${jobId} did not terminate within ${timeoutMs}ms`);
}

afterEach(() => {
  // Belt-and-suspenders: never let a test leak draining=true or a live
  // recurring scheduler into the next test in this file.
  setDraining(false);
  stopDispatcherScheduler();
});

afterAll(async () => {
  if (scenarioIds.length > 0) {
    await db.delete(solveJobsTable).where(inArray(solveJobsTable.scenarioId, scenarioIds));
    await db.delete(scenariosTable).where(inArray(scenariosTable.id, scenarioIds));
  }
  await db.delete(usersTable).where(eq(usersTable.id, TEST_USER_ID));
});

describe("A2 setup", () => {
  it("registers the shared test user", async () => {
    await db.insert(usersTable).values({ id: TEST_USER_ID, email: `${TEST_USER_ID}@example.test` }).onConflictDoNothing();
  });
});

describe("A2 — claimJobRow (atomic CAS claim)", () => {
  it("claims a queued row: status->running, stamps claim_generation/claimed_at/owner_heartbeat_at from the DB clock", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });

    const claimed = await claimJobRow(jobId);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("running");
    expect(claimed!.claimGeneration).toBe(getBootClaimGeneration());
    expect(claimed!.claimedAt).not.toBeNull();
    expect(claimed!.ownerHeartbeatAt).not.toBeNull();
  });

  it("a second claim attempt on an already-running row loses the race (returns null) — no double-claim", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });

    const first = await claimJobRow(jobId);
    expect(first).not.toBeNull();
    const second = await claimJobRow(jobId);
    expect(second).toBeNull();
  });

  it("claiming a nonexistent id returns null", async () => {
    const claimed = await claimJobRow(999_999_999);
    expect(claimed).toBeNull();
  });
});

describe("A2 — refreshOwnerHeartbeat (ownership-checked, same predicate as completion)", () => {
  it("refreshing with the CORRECT generation on a running row succeeds and advances owner_heartbeat_at", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });
    const claimed = await claimJobRow(jobId);
    const generation = claimed!.claimGeneration!;

    const before = await getJob(jobId);
    await new Promise((r) => setTimeout(r, 20));
    const ok = await refreshOwnerHeartbeat(jobId, generation);
    expect(ok).toBe(true);

    const after = await getJob(jobId);
    expect(after.ownerHeartbeatAt!.getTime()).toBeGreaterThan(before.ownerHeartbeatAt!.getTime());
  });

  it("refreshing with the WRONG generation returns false (zero rows) — ownership already lost", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });
    const claimed = await claimJobRow(jobId);
    const realGeneration = claimed!.claimGeneration!;

    const ok = await refreshOwnerHeartbeat(jobId, realGeneration + 999);
    expect(ok).toBe(false);
  });

  it("refreshing a row that was never claimed (still queued) returns false", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });
    const ok = await refreshOwnerHeartbeat(jobId, getBootClaimGeneration());
    expect(ok).toBe(false);
  });

  it("an old owner's LATE completion attempt is dropped by the zero-row predicate (simulated: claim, then reclaim by a different generation, then the original generation's refresh fails)", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });
    const claimed = await claimJobRow(jobId);
    const oldGeneration = claimed!.claimGeneration!;

    // Simulate a NEWER generation reclaiming this row (as reapStaleLeases
    // would after a genuine stale timeout, or a direct takeover) —
    // reassign claim_generation out from under the old owner.
    await db.update(solveJobsTable)
      .set({ claimGeneration: oldGeneration + 1 })
      .where(eq(solveJobsTable.id, jobId));

    // The OLD owner's late heartbeat/completion attempt (still using its
    // own stale generation value) must be dropped — zero rows, no throw.
    const ok = await refreshOwnerHeartbeat(jobId, oldGeneration);
    expect(ok).toBe(false);
  });
});

describe("A2 — reapStaleLeases (owner lease takeover; false-stale prevention; genuine owner death)", () => {
  it("a running row with a FRESH heartbeat is NOT reaped (false-stale prevention under a slow-but-alive owner)", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });
    await claimJobRow(jobId); // heartbeat = now()

    await reapStaleLeases();

    const row = await getJob(jobId);
    expect(row.status).toBe("running");
  });

  it("a running row whose heartbeat is 30s old (well under the 60s threshold) is NOT reaped", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });
    await claimJobRow(jobId);
    await db.update(solveJobsTable)
      .set({ ownerHeartbeatAt: sql`now() - interval '30 seconds'` })
      .where(eq(solveJobsTable.id, jobId));

    await reapStaleLeases();

    const row = await getJob(jobId);
    expect(row.status).toBe("running");
  });

  it("a running row whose heartbeat is 61s old (over the 60s threshold) IS reaped to a terminal failed outcome — genuine owner death", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });
    await claimJobRow(jobId);
    await db.update(solveJobsTable)
      .set({ ownerHeartbeatAt: sql`now() - interval '61 seconds'` })
      .where(eq(solveJobsTable.id, jobId));

    const reaped = await reapStaleLeases();
    expect(reaped).toBeGreaterThanOrEqual(1);

    const row = await getJob(jobId);
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/lease expired/i);
    // A5 — the typed columns its public serializer (derivePublicFailure)
    // reads: errorCode='SOLVE_FAILED' + failureReason='interrupted' +
    // failureStage='reaper' (§2.11: "interrupted (cancel / deploy /
    // server-restart-reaper / external kill)").
    expect(row.errorCode).toBe("SOLVE_FAILED");
    expect(row.failureReason).toBe("interrupted");
    expect(row.failureStage).toBe("reaper");
  });

  it("reaping a genuinely dead owner is a ONE-TIME deterministic terminal outcome — reaping twice is a no-op the second time", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });
    await claimJobRow(jobId);
    await db.update(solveJobsTable)
      .set({ ownerHeartbeatAt: sql`now() - interval '90 seconds'` })
      .where(eq(solveJobsTable.id, jobId));

    await reapStaleLeases();
    const afterFirst = await getJob(jobId);
    expect(afterFirst.status).toBe("failed");

    // Second call: this row no longer matches status='running', so it's
    // untouched — no re-transition, no double-processing.
    await reapStaleLeases();
    const afterSecond = await getJob(jobId);
    expect(afterSecond.status).toBe("failed");
    expect(afterSecond.finishedAt?.getTime()).toBe(afterFirst.finishedAt?.getTime());
  });

  it("TWO OVERLAPPING GENERATIONS: a fresh-heartbeat row is untouched regardless of which generation nominally owns it — the new generation must not fail or steal the old generation's live job", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });
    // Simulate an "old" generation's live claim — an arbitrary generation
    // number distinct from this process's own current bootClaimGeneration —
    // with a heartbeat that is fresh RIGHT NOW (the old generation is still
    // alive and heartbeating).
    await db.update(solveJobsTable)
      .set({ status: "running", claimGeneration: 999_999, ownerHeartbeatAt: sql`now()`, claimedAt: sql`now()` })
      .where(eq(solveJobsTable.id, jobId));

    // A "new" generation's tick (this process's own reapStaleLeases —
    // generation-agnostic, heartbeat-only) must NOT touch it.
    await reapStaleLeases();

    const row = await getJob(jobId);
    expect(row.status).toBe("running");
    expect(row.claimGeneration).toBe(999_999);
  });
});

describe("A2 — runDispatcherTickOnce (recurring scan, not a one-time boot scan)", () => {
  it("a row inserted directly (no in-process owner) is discovered, claimed, and actually executed by the recurring scan", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });

    await runDispatcherTickOnce();

    const result = await pollUntilTerminal(jobId, 60_000);
    expect(result.status).toBe("succeeded");
  }, 65_000);

  it("a row enqueued AFTER an earlier tick found nothing is still picked up by a LATER tick (recurring, not one-shot)", async () => {
    // First tick: nothing queued yet for this scenario (any prior test's
    // rows are already terminal) — establishes "the scan already ran once
    // and there was nothing new for THIS row."
    await runDispatcherTickOnce();

    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });

    // The row didn't exist during the first tick — only a SECOND,
    // independent tick (the recurring behavior, not a boot-only scan) can
    // discover it.
    await runDispatcherTickOnce();

    const result = await pollUntilTerminal(jobId, 60_000);
    expect(result.status).toBe("succeeded");
  }, 65_000);

  it("REENTRANCY: a tick already in flight is skipped, not queued — calling runDispatcherTickOnce() concurrently with itself never double-processes", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });

    // Fire two ticks back-to-back with no await between them — the second
    // call's tickInFlight guard must make it a no-op, not a second
    // concurrent scan.
    const [, ] = await Promise.all([runDispatcherTickOnce(), runDispatcherTickOnce()]);

    const result = await pollUntilTerminal(jobId, 60_000);
    expect(result.status).toBe("succeeded"); // claimed and ran exactly once, not raced into failure
  }, 65_000);
});

describe("A2 — version-aware claim (RECOVERY_CONTRACT_IDENTITY mismatch)", () => {
  it("a claim whose PERSISTED identity differs from the CURRENT runtime identity fails ONCE, terminal, with the safe retryable message — never executes", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({
      scenarioId,
      recoveryContractIdentity: "f".repeat(64), // deliberately wrong, well-formed 64-hex value
    });

    await runDispatcherTickOnce();

    // A version mismatch fails BEFORE spawning anything — resolves near-
    // instantly, unlike a real solve (seconds). A generous 5s poll bound
    // still proves "no real solve occurred" by elapsed time.
    const result = await pollUntilTerminal(jobId, 5_000);
    expect(result.status).toBe("failed");
    expect(result.error).toBe(VERSION_MISMATCH_SAFE_MESSAGE);
    expect(result.elapsedMs).toBeLessThan(3_000);

    const row = await getJob(jobId);
    expect(row.failureReason).toBe("data_error");
    expect(row.failureStage).toBe("validate");
    expect(row.errorCode).toBe("SOLVE_FAILED");
  });

  it("a claim whose persisted identity MATCHES the current runtime identity (a compatible deploy) executes normally", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId, recoveryContractIdentity: RECOVERY_CONTRACT_IDENTITY });

    await runDispatcherTickOnce();

    const result = await pollUntilTerminal(jobId, 60_000);
    expect(result.status).toBe("succeeded");
  }, 65_000);

  it("a rollback presents identically to any other mismatch (an OLDER identity value than the one currently running) — same fail-once-retryable path", async () => {
    const scenarioId = await createScenario();
    // An arbitrary "prior" identity value, standing in for a real rollback's
    // older-but-well-formed manifest hash.
    const jobId = await insertQueuedRow({ scenarioId, recoveryContractIdentity: "a".repeat(64) });

    await runDispatcherTickOnce();

    const result = await pollUntilTerminal(jobId, 5_000);
    expect(result.status).toBe("failed");
    expect(result.error).toBe(VERSION_MISMATCH_SAFE_MESSAGE);
  });

  it("a NULL persisted identity (defensive/test-inserted row with no identity recorded) is NOT treated as a mismatch — no positive evidence of drift", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId, recoveryContractIdentity: null });

    await runDispatcherTickOnce();

    const result = await pollUntilTerminal(jobId, 60_000);
    expect(result.status).toBe("succeeded");
  }, 65_000);
});

describe("A2 — Phase 2 legacy cleanup (drain-gated; null-lease + historical rows)", () => {
  it("a transitional NULL-LEASE running row with a VALID snapshot is moved once to terminal failed under the safe public contract", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({
      scenarioId,
      status: "running",
      claimGeneration: null,
      ownerHeartbeatAt: null,
    });

    const result = await runPhase2LegacyCleanup();
    expect(result.nullLeaseFailed).toBeGreaterThanOrEqual(1);

    const row = await getJob(jobId);
    expect(row.status).toBe("failed");
    expect(row.errorCode).toBe("SOLVE_FAILED");
    expect(row.error).toBe(VERSION_MISMATCH_SAFE_MESSAGE);
    // A5 — failureReason/failureStage now also stamped so the public
    // serializer (derivePublicFailure) selects the SAME message for this
    // row as it would for a live version mismatch, not the generic
    // "Solve failed" fallback.
    expect(row.failureReason).toBe("data_error");
    expect(row.failureStage).toBe("validate");
  });

  it("a HISTORICAL row with a null input_snapshot/model_id (unrecoverable by construction) terminates once, in EITHER queued or running status", async () => {
    const scenarioId = await createScenario();
    const queuedHistorical = await insertQueuedRow({
      scenarioId, status: "queued", inputSnapshot: null, modelId: null, recoveryContractIdentity: null,
    });
    const runningHistorical = await insertQueuedRow({
      scenarioId, status: "running", inputSnapshot: null, modelId: null, recoveryContractIdentity: null,
      claimGeneration: null, ownerHeartbeatAt: null,
    });

    const result = await runPhase2LegacyCleanup();
    expect(result.historicalFailed).toBeGreaterThanOrEqual(2);

    const q = await getJob(queuedHistorical);
    const r = await getJob(runningHistorical);
    expect(q.status).toBe("failed");
    expect(r.status).toBe("failed");
  });

  it("a LIVE (valid heartbeat + generation) running row is left completely untouched by Phase 2 — only null-lease/historical rows are in scope", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });
    const claimed = await claimJobRow(jobId); // real heartbeat + generation

    await runPhase2LegacyCleanup();

    const row = await getJob(jobId);
    expect(row.status).toBe("running");
    expect(row.claimGeneration).toBe(claimed!.claimGeneration);
  });

  it("running Phase 2 cleanup TWICE is idempotent — a row already moved to failed is never re-processed", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId, status: "running", claimGeneration: null, ownerHeartbeatAt: null });

    await runPhase2LegacyCleanup();
    const afterFirst = await getJob(jobId);
    expect(afterFirst.status).toBe("failed");

    await runPhase2LegacyCleanup();
    const afterSecond = await getJob(jobId);
    expect(afterSecond.finishedAt?.getTime()).toBe(afterFirst.finishedAt?.getTime());
  });
});

describe("A2 — initDispatcherForBoot (claim_generation sequence; scheduler start/stop)", () => {
  it("assigns a real, strictly-increasing claim_generation across two boots, and starting/stopping the scheduler leaks no live timer", async () => {
    await initDispatcherForBoot();
    const first = getBootClaimGeneration();
    stopDispatcherScheduler();

    await initDispatcherForBoot();
    const second = getBootClaimGeneration();
    stopDispatcherScheduler();

    expect(second).toBeGreaterThan(first);
  }, 15_000);
});

describe("A2 — never-claimed queued work stays queued during drain (shutdown category 1)", () => {
  it("setting draining BEFORE a job is registered leaves it queued in the DB and in the in-process queue — untouched, for the next generation's scan", async () => {
    const scenarioId = await createScenario();
    const jobId = await insertQueuedRow({ scenarioId });

    setDraining(true);
    try {
      const input = { modelId: "p-median-us", inputs: validPmedianInputs } as unknown as SolveInput;
      const depthBefore = getQueueDepth();
      registerQueuedJob(jobId, scenarioId, TEST_USER_ID, input);
      // pump() sees draining=true and does nothing — the job stays parked
      // in the in-process queue array (never claimed by THIS process), and
      // its DB row is never touched.
      expect(getQueueDepth()).toBe(depthBefore + 1);

      const row = await getJob(jobId);
      expect(row.status).toBe("queued");
      expect(row.claimGeneration).toBeNull();
    } finally {
      setDraining(false);
      // Drain the leftover in-process queue entry (still parked, never
      // claimed, from the draining-gated registerQueuedJob above) so it
      // doesn't interfere with a later test in this file — a dispatcher
      // tick's scan re-discovers the still-`queued` DB row (queue.includes
      // dedups against the stale in-process entry) and pump()s it for real.
      await runDispatcherTickOnce();
      await pollUntilTerminal(jobId, 60_000).catch(() => { /* best-effort cleanup poll */ });
    }
  }, 65_000);
});
