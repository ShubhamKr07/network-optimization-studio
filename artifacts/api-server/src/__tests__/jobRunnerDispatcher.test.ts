// A2 (SCND Correctness) — mocked (@workspace/db + child_process) coverage of
// the dispatcher/lease/drain behaviors that need precise control over
// timing and DB-error injection: reentrancy, exponential backoff continuing
// after a transient Postgres failure, boot-fails-closed, owner-heartbeat
// triggering process-group cancellation (zero-row AND DB-error paths), a
// crash between claim and a defined solver outcome ending in a one-time
// terminal failure (never a retry), the version-aware claim, and SIGTERM
// drain sequencing (grace-period completion vs. force-cancel, and heartbeat
// renewal continuing THROUGHOUT the grace wait). Real-DB-semantics-dependent
// behavior (actual CAS/predicate correctness under Postgres) lives instead
// in solver/__tests__/dispatcherRecovery.test.ts — this file is about
// process/timing logic with fully controlled fakes.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Module-load-time env overrides (see jobRunner.test.ts's identical pattern
// for why these must be set before the dynamic import in beforeAll below,
// not just before individual tests).
process.env.SOLVE_TERM_GRACE_MS = "10";
process.env.SOLVE_TIMEOUT_GRACE_MS = "50";
process.env.SOLVE_HEARTBEAT_INTERVAL_MS = "20";
process.env.SOLVE_DISPATCHER_INTERVAL_MS = "20";
process.env.SOLVE_DISPATCHER_MAX_BACKOFF_MS = "200";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  solveJobsTable: { id: "id", scenarioId: "scenario_id", userId: "user_id", status: "status", queuedAt: "queued_at", ownerHeartbeatAt: "owner_heartbeat_at", inputSnapshot: "input_snapshot", modelId: "model_id" },
  scenariosTable: { id: "id" },
  resultCacheTable: { inputsHash: "inputs_hash", modelId: "model_id", result: "result" },
}));

const mockLoggerInfo = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
vi.mock("../lib/logger.js", () => ({ logger: { info: mockLoggerInfo, error: mockLoggerError, warn: vi.fn(), debug: vi.fn() } }));

const mockSpawn = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() =>
  vi.fn(() => ({ status: 0, stdout: JSON.stringify({ pulpVersion: "3.3.2", cbcPath: "/bin/sh" }), stderr: "" })),
);
vi.mock("child_process", () => ({ spawn: mockSpawn, spawnSync: mockSpawnSync }));

function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "insert", "values", "returning", "update", "set", "onConflictDoNothing", "orderBy", "limit"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(returnValue).then(resolve, reject);
  return chain;
}

function makeRejectingChain(err: unknown) {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "insert", "values", "returning", "update", "set", "onConflictDoNothing", "orderBy", "limit"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (_resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.reject(err).catch((e) => { if (reject) reject(e); else throw e; });
  return chain;
}

let nextFakePid = 5000;
class FakeChild extends EventEmitter {
  pid = nextFakePid++;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  fd3 = new EventEmitter();
  stdio: unknown[];
  stdin = { write: vi.fn(), end: vi.fn() };
  kill = vi.fn();
  constructor() {
    super();
    this.stdio = [this.stdin, this.stdout, this.stderr, this.fd3];
  }
}

function emitFd3(child: FakeChild, obj: unknown) {
  child.fd3.emit("data", Buffer.from(JSON.stringify(obj) + "\n"));
}

const SUCCESS_ENVELOPE = {
  status: "optimal", solutionStatus: "optimal", terminationReason: "optimality_proven",
  objective: 1, runTimeSec: 0.1, quality: "Optimal",
  edges: [], metrics: {}, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
};

import type { SolveInput } from "../solver/pmedian.js";

type JobRunnerModule = typeof import("../solver/jobRunner.js");
let mod: JobRunnerModule;

beforeAll(async () => {
  mod = await import("../solver/jobRunner.js");
});

const baseInput: SolveInput = {
  modelId: "p-median-us",
  inputs: {
    p: 3, distanceBands: [200], capacityMode: "none", uniformCapacity: null,
    warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 1,
    addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
  },
};

let killSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  mockDb.select.mockReturnValue(makeChain([]));
  // Sane default so reapStaleLeases()/scanAndClaimQueuedJobs() (both run
  // every dispatcher tick) never crash on an un-stubbed db.update() call in
  // tests that don't care about update behavior — individual tests override
  // via mockReturnValueOnce/mockReturnValue as needed (Once values are
  // always consumed before this persistent default).
  mockDb.update.mockReturnValue(makeChain([{}]));
  mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb));
  killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  mod.setDraining(false);
  mod.stopDispatcherScheduler();
});

afterEach(() => {
  vi.useRealTimers();
  killSpy.mockRestore();
  mod.stopDispatcherScheduler();
  mod.cancelScheduledLegacyCleanup();
  mod.setDraining(false);
});

// Configures the kill spy so the process group reports dead immediately
// after the first real signal — keeps cancellation-path tests fast (no real
// waiting through TERM_GRACE_MS/GROUP_DEATH_TIMEOUT_MS).
function mockGroupDiesImmediately() {
  let signaled = false;
  killSpy.mockImplementation((_pid: unknown, signal?: unknown) => {
    if (signal === 0) {
      if (signaled) {
        const err = new Error("No such process") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
      return true;
    }
    signaled = true;
    return true;
  });
}

describe("A2 — dispatcher reentrancy (one mutex guards the tick)", () => {
  it("a tick already in flight is SKIPPED by a concurrent call, never queued up — the scan's own db.select runs only once", async () => {
    let releaseFirstSelect!: () => void;
    const hangingSelect = new Promise((resolve) => { releaseFirstSelect = () => resolve([]); });
    const hangingChain: Record<string, unknown> = {};
    ["select", "from", "where", "orderBy", "limit"].forEach((m) => { hangingChain[m] = vi.fn(() => hangingChain); });
    (hangingChain as { then: unknown }).then = (resolve: (v: unknown) => void) => hangingSelect.then(resolve as never);
    mockDb.select.mockReturnValueOnce(hangingChain);

    const firstTick = mod.runDispatcherTickOnce();
    // The second call overlaps the still-in-flight first tick — it must be
    // a pure no-op (return immediately, never touch db.select itself).
    const secondTick = mod.runDispatcherTickOnce();
    await secondTick;
    expect(mockDb.select).toHaveBeenCalledTimes(1);

    releaseFirstSelect();
    await firstTick;
  });
});

describe("A2 — dispatcher backoff continues after a transient Postgres failure", () => {
  it("a failed tick logs ONE backoff-entry line, keeps the schedule alive, and resumes (logs ONE recovery line) once the DB recovers", async () => {
    let callCount = 0;
    mockDb.select.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeRejectingChain(new Error("simulated transient Postgres outage"));
      return makeChain([]);
    });

    mod.startDispatcherScheduler();

    // Wait for at least 2 scheduler ticks to have run (the failing one, then
    // a recovered one) — SOLVE_DISPATCHER_INTERVAL_MS=20ms keeps this fast.
    await vi.waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    await vi.waitFor(() => expect(mockLoggerError).toHaveBeenCalledTimes(1), { timeout: 5000 });
    await vi.waitFor(() => expect(mockLoggerInfo.mock.calls.some((c) => String(c[0]).includes("recovered from backoff"))).toBe(true), { timeout: 5000 });

    // Exactly ONE error-transition log line, not one per tick.
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });
});

describe("A2 — boot fails closed (Postgres unreachable during Phase 1)", () => {
  it("initDispatcherForBoot() propagates a DB error instead of silently starting with no dispatcher", async () => {
    mockDb.execute.mockRejectedValueOnce(new Error("connection refused"));

    await expect(mod.initDispatcherForBoot()).rejects.toThrow(/connection refused/);
  });
});

describe("A2 — owner heartbeat triggers process-group cancellation", () => {
  it("a ZERO-ROW heartbeat refresh (ownership lost) cancels the process group at once", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    // Claim succeeds; every SUBSEQUENT update (the heartbeat refresh) is a
    // zero-row result — ownership already lost.
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // CAS claim
      .mockReturnValue(makeChain([])); // heartbeat refresh(es): 0 rows

    mockGroupDiesImmediately();
    const child = new FakeChild(); // never emits close — simulates a hang
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", { ...baseInput, inputs: { ...baseInput.inputs, timeLimitSec: 5 } });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    // A heartbeat tick (20ms interval) fires, sees 0 rows, and cancels —
    // the group receives SIGTERM without any outer timeout ever firing.
    await vi.waitFor(() => expect(killSpy).toHaveBeenCalledWith(-child.pid, "SIGTERM"), { timeout: 2000 });
  });

  it("a heartbeat refresh that THROWS (Postgres unavailable) ALSO cancels the process group at once — fail closed, never just suppress publication", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // CAS claim
      .mockImplementation(() => makeRejectingChain(new Error("connection lost")));

    mockGroupDiesImmediately();
    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", { ...baseInput, inputs: { ...baseInput.inputs, timeLimitSec: 5 } });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    await vi.waitFor(() => expect(killSpy).toHaveBeenCalledWith(-child.pid, "SIGTERM"), { timeout: 2000 });
  });
});

describe("A2 — version-aware claim (mocked)", () => {
  it("a claimed row whose recoveryContractIdentity does not match RECOVERY_CONTRACT_IDENTITY fails ONCE, terminal, WITHOUT ever spawning", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{ id: 1, recoveryContractIdentity: "f".repeat(64) }]);
    mockDb.update.mockReturnValueOnce(jobUpdateChain) // CAS claim — WRONG identity
      .mockReturnValue(makeChain([{}])); // the version-mismatch markFailed write

    await mod.enqueueSolveJob(1, "user-1", baseInput);

    await vi.waitFor(() => {
      const calls = (jobUpdateChain.set as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });
    // The SECOND db.update call (the failure write) carries the exact
    // version-mismatch taxonomy + safe message.
    await vi.waitFor(() => {
      const secondChainCalls = (mockDb.update as ReturnType<typeof vi.fn>).mock.results;
      expect(secondChainCalls.length).toBeGreaterThanOrEqual(2);
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe("A2 — crash immediately after claim, immediately before a defined solver outcome", () => {
  it("an unhandled exception between claim and spawn ends in ONE deterministic terminal failure — never a silent stall, never a retry", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update
      .mockReturnValueOnce(jobUpdateChain) // CAS claim succeeds
      .mockReturnValueOnce(jobUpdateChain); // A2's catch-all markFailed

    // Simulate a crash between claim and a defined outcome: spawn() itself
    // throws synchronously (inside runSolverProcess's Promise executor,
    // which rejects the promise per JS semantics) rather than returning a
    // usable child handle.
    mockSpawn.mockImplementation(() => {
      throw new Error("simulated crash before any solver outcome");
    });

    await mod.enqueueSolveJob(1, "user-1", baseInput);

    await vi.waitFor(() => {
      const calls = (jobUpdateChain.set as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((c) => (c[0] as Record<string, unknown>).status === "failed")).toBe(true);
    });
    const failedCall = (jobUpdateChain.set as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).status === "failed",
    )![0] as Record<string, unknown>;
    expect(failedCall.errorCode).toBe("SOLVE_FAILED");
    // Never retried — exactly 2 db.update calls total (claim + the one
    // terminal failure write), no re-claim, no re-spawn attempt.
    expect((mockDb.update as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});

describe("A2 — SIGTERM drain (drainForShutdown)", () => {
  it("an in-flight job that finishes WITHIN the grace period is never force-cancelled", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    const drainPromise = mod.drainForShutdown("sigterm", { graceMs: 5000, forceGraceMs: 1000 });

    // Resolve the job naturally, well inside the grace window.
    emitFd3(child, SUCCESS_ENVELOPE);
    child.emit("close", 0);

    await drainPromise;
    expect(killSpy).not.toHaveBeenCalledWith(-child.pid, "SIGTERM");
  });

  it("an in-flight job that EXCEEDS the grace period is force-cancelled via cancelAllActiveJobs, and drain still resolves", async () => {
    mockGroupDiesImmediately();
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child = new FakeChild(); // never closes on its own
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", { ...baseInput, inputs: { ...baseInput.inputs, timeLimitSec: 5 } });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    // A short grace period so the job is guaranteed to still be running
    // when it elapses — drain must force-cancel and still resolve.
    await mod.drainForShutdown("sigterm", { graceMs: 30, forceGraceMs: 2000 });

    expect(killSpy).toHaveBeenCalledWith(-child.pid, "SIGTERM");
  });

  it("the owner heartbeat KEEPS RENEWING throughout the drain grace wait — draining never stops heartbeating an owned, still-running job", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const heartbeatUpdateChain = makeChain([{}]);
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // CAS claim
      .mockReturnValue(heartbeatUpdateChain); // every heartbeat refresh thereafter

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", { ...baseInput, inputs: { ...baseInput.inputs, timeLimitSec: 5 } });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    const drainPromise = mod.drainForShutdown("sigterm", { graceMs: 200, forceGraceMs: 50 });

    // At least one heartbeat renewal must have happened DURING the grace
    // wait (interval 20ms, grace 200ms) — proving drain doesn't silently
    // stop renewing the lease for a job it still owns.
    await vi.waitFor(() => {
      const calls = (heartbeatUpdateChain.set as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });

    // Let the grace period elapse and force-cancel resolve the drain.
    mockGroupDiesImmediately();
    await drainPromise;
  });
});

describe("A2 — an old owner's late completion is dropped (mocked, ownership predicate)", () => {
  it("markSucceeded resolves false (never publishes) when the ownership-checked job update matches zero rows", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    // CAS claim + every heartbeat renewal succeed normally (non-empty) —
    // only markSucceeded's OWN job-row update (set up as a single
    // mockReturnValueOnce immediately before triggering "close" below, so
    // it's guaranteed — by Node's microtask-before-macrotask ordering — to
    // be consumed by THAT call and not by an interleaved heartbeat tick)
    // simulates the "ownership already lost" 0-row case.
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    // Consumed by the very next db.update() call — synchronously followed
    // by the events that trigger it, so no interleaved heartbeat macrotask
    // can consume it first.
    mockDb.update.mockReturnValueOnce(makeChain([]));
    emitFd3(child, SUCCESS_ENVELOPE);
    child.emit("close", 0);

    await vi.waitFor(() => expect(mockDb.transaction).toHaveBeenCalledTimes(1));
    await expect(mockDb.transaction.mock.results[0].value).resolves.toBe(false);
  });
});
