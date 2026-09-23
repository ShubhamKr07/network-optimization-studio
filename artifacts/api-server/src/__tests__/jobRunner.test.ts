import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// A3 — real timers, small grace/kill windows. TERM_GRACE_MS/TIMEOUT_GRACE_MS
// are read from env vars once at jobRunner.js's module load time (mirrors
// jobRunnerConcurrency.test.ts's SOLVE_WORKER_CONCURRENCY pattern) — a plain
// top-of-file statement here runs before any *dynamic* import (unlike a
// static `import ... from "../solver/jobRunner.js"`, which ES modules hoist
// above ALL other top-level code in this file, env-var assignment included —
// see the dynamic import in beforeAll() below, the same fix
// jobRunnerConcurrency.test.ts already uses for this exact hazard). Real
// (not fake) timers are used throughout this file for the timeout tests: the
// process-group kill sequence's own internal sleeps are tiny real
// milliseconds (bounded by these env vars), simpler and less brittle than
// threading vi.useFakeTimers() through a multi-step async kill sequence that
// itself crosses a real fs.mkdtemp() await.
process.env.SOLVE_TERM_GRACE_MS = "10";
// Keeps the outer solver timeout itself real-but-fast (see jobRunner.ts's
// TIMEOUT_GRACE_MS) so timeout tests can use plain real timers + vi.waitFor
// instead of choreographing fake timers through an async mkdtemp() step.
process.env.SOLVE_TIMEOUT_GRACE_MS = "50";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  solveJobsTable: { id: "id", scenarioId: "scenario_id", userId: "user_id", status: "status" },
  scenariosTable: { id: "id" },
  resultCacheTable: { inputsHash: "inputs_hash", modelId: "model_id", result: "result" },
}));

const mockSpawn = vi.hoisted(() => vi.fn());
// A1 — jobRunner.ts's module-load-time RECOVERY_CONTRACT_IDENTITY computation
// (recoveryContractIdentity.ts) calls the REAL `spawnSync` to probe PuLP/CBC.
// This mock replaces child_process's whole export surface, so spawnSync must
// be stubbed too or that eager compute throws "spawnSync is not a function"
// before any test in this file even runs. `/bin/sh` is a real, always-present
// POSIX path (this app is POSIX-only already, see jobRunner.ts's own startup
// platform guard) so sha256File(cbcPath) inside recoveryContractIdentity.ts
// succeeds against a real file without needing a special fixture.
const mockSpawnSync = vi.hoisted(() =>
  vi.fn(() => ({ status: 0, stdout: JSON.stringify({ pulpVersion: "3.3.2", cbcPath: "/bin/sh" }), stderr: "" })),
);
vi.mock("child_process", () => ({ spawn: mockSpawn, spawnSync: mockSpawnSync }));

function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "insert", "values", "returning", "update", "set", "onConflictDoNothing"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => Promise.resolve(returnValue).then(resolve);
  return chain;
}

// A3 — solve.py's real IPC channel is fd 3 (child.stdio[3]), not stdout.
// FakeChild now carries a `.pid` (process-group kill needs a real number to
// call process.kill(-pid, ...) against) and a `.stdio` array whose index 3
// is what jobRunner.ts actually reads for the result message; `.stdout`/
// `.stderr` stay as before (diagnostics-only capture, never parsed as the
// result anymore).
let nextFakePid = 1000;
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
let enqueueSolveJob: JobRunnerModule["enqueueSolveJob"];
let getQueueDepth: JobRunnerModule["getQueueDepth"];
let parsePositiveIntEnv: JobRunnerModule["parsePositiveIntEnv"];
let QUEUE_DEPTH_LIMIT: JobRunnerModule["QUEUE_DEPTH_LIMIT"];
let toLegacyStoredResult: JobRunnerModule["toLegacyStoredResult"];
let buildSolveJobValues: JobRunnerModule["buildSolveJobValues"];
let RECOVERY_CONTRACT_IDENTITY: JobRunnerModule["RECOVERY_CONTRACT_IDENTITY"];
let derivePublicFailure: JobRunnerModule["derivePublicFailure"];
let VERSION_MISMATCH_SAFE_MESSAGE: JobRunnerModule["VERSION_MISMATCH_SAFE_MESSAGE"];
let cancelJob: JobRunnerModule["cancelJob"];
let isOutcomeCacheable: JobRunnerModule["isOutcomeCacheable"];

beforeAll(async () => {
  const mod = await import("../solver/jobRunner.js");
  enqueueSolveJob = mod.enqueueSolveJob;
  getQueueDepth = mod.getQueueDepth;
  parsePositiveIntEnv = mod.parsePositiveIntEnv;
  QUEUE_DEPTH_LIMIT = mod.QUEUE_DEPTH_LIMIT;
  toLegacyStoredResult = mod.toLegacyStoredResult;
  buildSolveJobValues = mod.buildSolveJobValues;
  RECOVERY_CONTRACT_IDENTITY = mod.RECOVERY_CONTRACT_IDENTITY;
  derivePublicFailure = mod.derivePublicFailure;
  VERSION_MISMATCH_SAFE_MESSAGE = mod.VERSION_MISMATCH_SAFE_MESSAGE;
  cancelJob = mod.cancelJob;
  isOutcomeCacheable = mod.isOutcomeCacheable;
});

const baseInput: SolveInput = {
  modelId: "p-median-us",
  inputs: {
    p: 3, distanceBands: [200], capacityMode: "none", uniformCapacity: null,
    warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 1,
    addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
  },
};

function setValues(chain: ReturnType<typeof makeChain>): Record<string, unknown>[] {
  return (chain.set as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as Record<string, unknown>);
}

// A3 — process.kill(-pid, signal) is the real mechanism the process-group
// kill sequence uses. Spying on the real `process.kill` (not mocking
// child_process's kill) lets tests both observe the group-kill calls AND
// control isProcessGroupAlive()'s probe (signal === 0) outcome, without
// needing real OS processes or fake timers.
let killSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) — also drops any queued
  // mockReturnValueOnce() values a failed/finished test left behind, so
  // one test's mock setup can't leak into the next.
  vi.resetAllMocks();
  // P1.2: runJob() now does a result_cache lookup (db.select) before
  // spawning the solver. Default every test to a cache miss (empty result
  // set) so pre-existing tests that never anticipated this extra query
  // keep exercising the real spawn path unchanged; cache-hit tests below
  // override this per-test with mockReturnValueOnce.
  mockDb.select.mockReturnValue(makeChain([]));
  // Part F (T6): markSucceeded now wraps its two updates in db.transaction().
  // The mock's transaction runs the callback against `mockDb` itself, so
  // `tx.update(...)` inside the callback is the SAME mock as `db.update(...)`
  // everywhere else — every pre-existing test's `mockDb.update.mockReturnValueOnce(...)`
  // sequencing keeps working unchanged, since the transaction body's two
  // `tx.update()` calls are indistinguishable from two `db.update()` calls to
  // the mock. Tests that need to observe the transaction boundary itself
  // (T6's new tests) override this per-test.
  mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<void>) => cb(mockDb));
  // Default: every process.kill call (both real signals and signal-0
  // liveness probes) succeeds without throwing — i.e. "alive" for probes.
  // Tests that need "the group died after TERM/KILL" override this.
  killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
});

afterEach(() => {
  vi.useRealTimers();
  killSpy.mockRestore();
});

// Configures the kill spy so a probe (signal 0) reports the group as dead
// immediately after the FIRST real signal (TERM or KILL) is sent — the
// common "graceful TERM worked" case, keeping tests fast (no real sleeping
// through TERM_GRACE_MS/GROUP_DEATH_TIMEOUT_MS).
function mockGroupDiesImmediately() {
  let signaled = false;
  killSpy.mockImplementation((_pid: unknown, signal?: unknown) => {
    if (signal === 0) {
      if (signaled) {
        const err = new Error("No such process") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      }
      return true; // alive until the first real signal below
    }
    signaled = true;
    return true;
  });
}

describe("jobRunner", () => {
  it("transitions queued -> running -> succeeded and writes scenarios.result on success", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    const scenarioUpdateChain = makeChain([{}]);
    // Call order: markRunning (job row), markSucceeded's job-row update,
    // markSucceeded's scenario-row update.
    mockDb.update
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(scenarioUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    const jobId = await enqueueSolveJob(42, "user-1", baseInput);
    expect(jobId).toBe(1);

    // Wait for the child to actually be spawned (not just for "running" to
    // be recorded — that mock call is recorded synchronously as soon as the
    // `.set(...)` expression is evaluated, before the surrounding `await`
    // resolves, so it can be observed before spawn() has actually run).
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    emitFd3(child, {
      status: "optimal", objective: 100, runTimeSec: 0.1, quality: "Optimal",
      edges: [], metrics: { weightedAvgDistance: 5 }, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    });
    child.emit("close", 0);

    await vi.waitFor(() => expect(setValues(jobUpdateChain).some((s) => s.status === "succeeded")).toBe(true));
    expect(setValues(scenarioUpdateChain).some((s) => (s.result as { status: string })?.status === "optimal")).toBe(true);
  });

  // A3 — spawn() is now called with a detached process group + a 4-entry
  // stdio array (index 3 is the fd3 IPC channel), and NOS_SOLVE_WORKDIR set
  // in the child's env.
  it("spawns solve.py detached with a 4-entry stdio array and NOS_SOLVE_WORKDIR set", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    const [, , opts] = mockSpawn.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(opts.detached).toBe(true);
    expect(opts.stdio).toEqual(["pipe", "pipe", "pipe", "pipe"]);
    expect(typeof (opts.env as Record<string, string>).NOS_SOLVE_WORKDIR).toBe("string");
    expect((opts.env as Record<string, string>).NOS_SOLVE_WORKDIR.length).toBeGreaterThan(0);

    emitFd3(child, SUCCESS_ENVELOPE);
    child.emit("close", 0);
    await vi.waitFor(() => expect(mockDb.transaction).toHaveBeenCalled());
  });

  // C4.10/D21 — the succeeded resultSummary now carries objectiveMode +
  // distanceUnit + a unit-agnostic weightedAvgDistance (no mile-locked
  // weightedAvgDistanceMi). A mile model has no details.objective, so
  // objectiveMode is null and the manifest unit is "mi". Driven through the
  // cache-hit path so markSucceeded runs with a known envelope and no spawn.
  it("writes the unit-carrying resultSummary shape for a mile model (objectiveMode null, distanceUnit mi)", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    const scenarioUpdateChain = makeChain([{}]);
    mockDb.update
      .mockReturnValueOnce(jobUpdateChain)      // markRunning
      .mockReturnValueOnce(jobUpdateChain)      // markSucceeded — job row
      .mockReturnValueOnce(scenarioUpdateChain); // markSucceeded — scenario row
    // B6 whole-branch review Finding #1 — needs `solutionStatus` to hit the
    // cache (a row missing it is now treated as a miss).
    const cachedEnvelope = {
      status: "optimal", objective: 94500000, runTimeSec: 0.4, quality: "Optimal",
      solutionStatus: "optimal", terminationReason: "optimality_proven",
      edges: [], metrics: { weightedAvgDistance: 412.6 }, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    };
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: "h", modelId: "p-median-us", result: cachedEnvelope },
    ]));

    await enqueueSolveJob(1, "user-1", baseInput);

    await vi.waitFor(() => expect(setValues(jobUpdateChain).some((s) => s.status === "succeeded")).toBe(true));
    expect(mockSpawn).not.toHaveBeenCalled();
    const summarySet = setValues(jobUpdateChain).find((s) => s.status === "succeeded")!;
    expect(summarySet.resultSummary).toEqual({
      status: "optimal", objective: 94500000, objectiveMode: null,
      weightedAvgDistance: 412.6, distanceUnit: "mi", runTimeSec: 0.4,
    });
  });

  // C4.10/D21 — a Chen solve emits details.objective ("coverage"/"min_distance")
  // and its manifest reports km, so the resultSummary carries objectiveMode +
  // distanceUnit:"km".
  it("carries objectiveMode from details.objective and the model's km distanceUnit (Chen)", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    const scenarioUpdateChain = makeChain([{}]);
    mockDb.update
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(scenarioUpdateChain);
    // B6 whole-branch review Finding #1 — needs `solutionStatus` to hit the
    // cache (a row missing it is now treated as a miss).
    const chenEnvelope = {
      status: "optimal", objective: 66.0, runTimeSec: 0.7, quality: "optimal",
      solutionStatus: "optimal", terminationReason: "optimality_proven",
      edges: [], metrics: { weightedAvgDistance: 250.5 }, details: { objective: "coverage" }, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    };
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: "h", modelId: "chens-cosmetics-cn", result: chenEnvelope },
    ]));

    // A1 — enqueueSolveJob now re-validates `inputs` (input_snapshot must be
    // SolveInput-valid, never a fabricated shortcut) before it ever reaches
    // the cache-hit branch below, so this needs a genuinely schema-valid
    // Chen "coverage" input, not just the two fields runJob's own
    // resultSummary derivation reads.
    const chenInput = {
      modelId: "chens-cosmetics-cn",
      inputs: {
        objective: "coverage", p: 3, highServiceDistKm: 600, maxDistKm: 1000,
        avgServiceDistCapKm: 800, gap: 0, timeLimitSec: 1,
      },
    } as unknown as SolveInput;
    await enqueueSolveJob(1, "user-1", chenInput);

    await vi.waitFor(() => expect(setValues(jobUpdateChain).some((s) => s.status === "succeeded")).toBe(true));
    const summarySet = setValues(jobUpdateChain).find((s) => s.status === "succeeded")!;
    expect(summarySet.resultSummary).toEqual({
      status: "optimal", objective: 66.0, objectiveMode: "coverage",
      weightedAvgDistance: 250.5, distanceUnit: "km", runTimeSec: 0.7,
    });
  });

  it("two concurrent solve jobs both start running without waiting for each other", async () => {
    mockDb.insert
      .mockReturnValueOnce(makeChain([{ id: 1 }]))
      .mockReturnValueOnce(makeChain([{ id: 2 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child1 = new FakeChild();
    const child2 = new FakeChild();
    mockSpawn.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

    await enqueueSolveJob(1, "user-1", baseInput);
    await enqueueSolveJob(2, "user-1", baseInput);

    // Both children are spawned before either one closes — proves the
    // second job wasn't blocked waiting on the first.
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(2));

    // Resolve both so this test doesn't leak pending jobs (and the worker
    // pool's activeCount) into later tests in this file.
    emitFd3(child1, SUCCESS_ENVELOPE);
    child1.emit("close", 0);
    emitFd3(child2, SUCCESS_ENVELOPE);
    child2.emit("close", 0);
    await vi.waitFor(() => {
      const updateCalls = (mockDb.update as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(updateCalls).toBeGreaterThanOrEqual(6); // 2x(running + job-succeeded + scenario-succeeded)
    });
  });

  // A3 — timeout now kills the whole process GROUP (process.kill(-pid,
  // "SIGTERM"), then SIGKILL only if the group is still alive after the
  // grace period), not just child.kill(). mockGroupDiesImmediately()
  // simulates the common "TERM alone was enough" case, so this test stays
  // fast (no real waiting through TERM_GRACE_MS).
  it("timeout sends SIGTERM to the whole process group and marks the job failed", async () => {
    mockGroupDiesImmediately();
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild(); // never emits "close" — simulates a hang
    mockSpawn.mockReturnValue(child);

    // timeLimitSec:0 + SOLVE_TIMEOUT_GRACE_MS=50 (module-load-time env var,
    // top of file) => a real ~50ms timeout, comfortably inside vi.waitFor's
    // default budget — no fake timers needed.
    await enqueueSolveJob(1, "user-1", { ...baseInput, inputs: { ...baseInput.inputs, timeLimitSec: 1 } });

    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed" && String(s.error).includes("timed out"))).toBe(true);
    }, { timeout: 5000 });

    // A5 (TT-1) — the typed errorCode column is what the public serializer
    // actually reads; must be TIMEOUT, never the SOLVE_FAILED default.
    const failedSet = setValues(jobUpdateChain).find((s) => s.status === "failed")!;
    expect(failedSet.errorCode).toBe("TIMEOUT");
    expect(failedSet.failureReason).toBe("timeout");

    expect(killSpy).toHaveBeenCalledWith(-child.pid, "SIGTERM");
    // TERM alone worked (mockGroupDiesImmediately) — SIGKILL should never
    // have been needed.
    expect(killSpy).not.toHaveBeenCalledWith(-child.pid, "SIGKILL");
  });

  // A3 — if the group is STILL alive after the TERM grace period, SIGKILL
  // is escalated to. SOLVE_TERM_GRACE_MS=10 (module-load-time env var, see
  // top of file) keeps this test's one real sleep short.
  it("escalates to SIGKILL when the group survives the TERM grace period", async () => {
    let sigtermSent = false;
    let sigkillSent = false;
    killSpy.mockImplementation((_pid: unknown, signal?: unknown) => {
      if (signal === 0) {
        if (sigkillSent) {
          const err = new Error("No such process") as NodeJS.ErrnoException;
          err.code = "ESRCH";
          throw err;
        }
        return true; // alive until SIGKILL — TERM alone does NOT kill it
      }
      if (signal === "SIGTERM") sigtermSent = true;
      if (signal === "SIGKILL") sigkillSent = true;
      return true;
    });

    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", { ...baseInput, inputs: { ...baseInput.inputs, timeLimitSec: 1 } });

    // Real time here: ~50ms (SOLVE_TIMEOUT_GRACE_MS) for the outer timeout,
    // plus KILL_PROBE_INTERVAL_MS (50ms, hardcoded) for the TERM-grace-period
    // loop's one sleep iteration (SOLVE_TERM_GRACE_MS=10 < 50, so a single
    // probe-interval sleep is enough to exceed the grace deadline and fall
    // through to SIGKILL) — comfortably inside vi.waitFor's default budget.
    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed" && String(s.error).includes("timed out"))).toBe(true);
    }, { timeout: 5000 });

    expect(sigtermSent).toBe(true);
    expect(sigkillSent).toBe(true);
  });

  // A5 (TT-2) — an internal cancelJob() call (the same mechanism SIGTERM
  // drain uses via cancelAllActiveJobs) must ALSO stamp the typed
  // errorCode/failureReason columns, not just the internal `error` text —
  // this is the "move A3's interim solve_jobs.error writes onto A1's typed
  // columns" deliverable, exercised here at the mocked-DB level (the real-DB
  // equivalent is overDeadlineDrain.test.ts's SIGTERM-drain integration
  // proof).
  it("an internal cancelJob() call marks the job failed with errorCode=SOLVE_FAILED and failureReason=interrupted (never TIMEOUT)", async () => {
    mockGroupDiesImmediately();
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild(); // never emits "close" on its own — cancelJob() must drive it
    mockSpawn.mockReturnValue(child);

    const jobId = await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    const cancelled = cancelJob(jobId, "test-cancel");
    expect(cancelled).toBe(true);

    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed")).toBe(true);
    }, { timeout: 5000 });

    const failedSet = setValues(jobUpdateChain).find((s) => s.status === "failed")!;
    expect(String(failedSet.error)).toMatch(/interrupted/i);
    expect(failedSet.errorCode).toBe("SOLVE_FAILED");
    expect(failedSet.failureReason).toBe("interrupted");
  });

  it("a non-zero exit code with a valid failure message marks the job failed with the classified reason", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    emitFd3(child, { failureReason: "solver_error", failureStage: "cbc_parse", errorDetail: null });
    child.emit("close", 1);

    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed" && String(s.error).includes("solver_error/cbc_parse"))).toBe(true);
    });
  });

  it("a non-zero exit with NO fd3 message marks the job failed as solver_error/exit", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("close", 1);

    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed" && String(s.error).includes("solver_error/exit"))).toBe(true);
    });
  });

  it("an unparseable fd3 message with exit 0 marks the job failed as internal_error/protocol", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.fd3.emit("data", Buffer.from("not valid json {{\n"));
    child.emit("close", 0);

    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed" && String(s.error).includes("internal_error/protocol"))).toBe(true);
    });
  });

  it("a missing fd3 message (no data at all) with exit 0 marks the job failed as internal_error/protocol", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("close", 0);

    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed" && String(s.error).includes("internal_error/protocol"))).toBe(true);
    });
  });

  // A3 — a success-shaped message riding a non-zero exit must NEVER
  // publish (TT-9) — this is the exact live-bug shape A3 closes: a
  // dataset/dispatch failure must not be cached/published as if it solved.
  it("a valid success message with a non-zero exit code never publishes (TT-9)", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    emitFd3(child, SUCCESS_ENVELOPE);
    child.emit("close", 1);

    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed" && String(s.error).includes("internal_error/exit"))).toBe(true);
    });
    expect(mockDb.transaction).not.toHaveBeenCalled(); // markSucceeded (the only db.transaction caller) never ran
    expect(mockDb.insert).toHaveBeenCalledTimes(1); // only enqueueSolveJob's own insert — no result_cache insert
  });

  // P1.1 — configurable concurrency / backpressure.
  it("getQueueDepth() reflects jobs waiting for a free worker slot, not in-flight jobs (default concurrency)", async () => {
    mockDb.insert
      .mockReturnValueOnce(makeChain([{ id: 1 }]))
      .mockReturnValueOnce(makeChain([{ id: 2 }]))
      .mockReturnValueOnce(makeChain([{ id: 3 }]))
      .mockReturnValueOnce(makeChain([{ id: 4 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    const children = [new FakeChild(), new FakeChild(), new FakeChild(), new FakeChild()];
    mockSpawn
      .mockReturnValueOnce(children[0])
      .mockReturnValueOnce(children[1])
      .mockReturnValueOnce(children[2])
      .mockReturnValueOnce(children[3]);

    expect(getQueueDepth()).toBe(0);

    // Default concurrency is 3 (no SOLVE_WORKER_CONCURRENCY set in this test
    // process) — the 4th job should sit in the queue until a slot frees up.
    await enqueueSolveJob(1, "user-1", baseInput);
    await enqueueSolveJob(2, "user-1", baseInput);
    await enqueueSolveJob(3, "user-1", baseInput);
    await enqueueSolveJob(4, "user-1", baseInput);

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(3));
    expect(getQueueDepth()).toBe(1); // job 4 waiting, jobs 1-3 running (not counted)

    emitFd3(children[0], SUCCESS_ENVELOPE);
    children[0].emit("close", 0);

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(4));
    expect(getQueueDepth()).toBe(0); // job 4 was picked up, nothing left waiting

    // Drain the rest so this test doesn't leak activeCount into later tests.
    for (const child of children.slice(1)) {
      emitFd3(child, SUCCESS_ENVELOPE);
      child.emit("close", 0);
    }
    await vi.waitFor(() => {
      const updateCalls = (mockDb.update as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(updateCalls).toBeGreaterThanOrEqual(12); // 4x(running + job-succeeded + scenario-succeeded)
    });
  });

  it("spawn error (e.g. ENOENT) marks the job failed as internal_error/spawn without throwing", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("error", new Error("spawn python3 ENOENT"));

    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed" && String(s.error).includes("internal_error/spawn"))).toBe(true);
    });
  });

  // A3 — stdout/stderr are diagnostics-only now (never parsed as the
  // result); a banner or noisy stderr must not affect a valid fd3 success.
  it("noisy stdout/stderr banner output does not affect a valid fd3 success", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    const scenarioUpdateChain = makeChain([{}]);
    mockDb.update
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(scenarioUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    child.stdout.emit("data", Buffer.from("CBC solver banner line\n"));
    child.stderr.emit("data", Buffer.from("some deprecation warning\n"));
    emitFd3(child, {
      status: "optimal", objective: 7, runTimeSec: 0.1, quality: "Optimal",
      edges: [], metrics: { weightedAvgDistance: 5 }, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    });
    child.emit("close", 0);

    await vi.waitFor(() => expect(setValues(jobUpdateChain).some((s) => s.status === "succeeded")).toBe(true));
    expect(setValues(scenarioUpdateChain).some((s) => (s.result as { objective: number })?.objective === 7)).toBe(true);
  });
});

// A3.C — the transitional-compatibility proof: zero canonical v2 scenario
// rows and zero v2 cache rows exist anywhere. toLegacyStoredResult() is the
// ONLY conversion path from a v2 success envelope to what gets written —
// this test proves it round-trips through the EXISTING ResultEnvelopeSchema
// shape, dropping nothing the schema doesn't already know about and adding
// no v2-only key.
describe("A3.C — toLegacyStoredResult (zero v2 writes)", () => {
  it("down-converts a v2 success envelope to exactly the legacy field set", () => {
    const v2 = {
      status: "optimal" as const,
      solutionStatus: "optimal" as const,
      terminationReason: "optimality_proven" as const,
      achievedGap: null,
      solverIncumbentObjective: 100,
      solverBestBound: 100,
      objective: 100,
      runTimeSec: 0.5,
      quality: "Optimal",
      edges: [],
      metrics: {},
      details: {},
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: null,
    };
    const legacy = toLegacyStoredResult(v2);
    expect(Object.keys(legacy).sort()).toEqual([
      "achievedGap", "details", "edges", "infeasibilityReason", "metrics",
      "objective", "quality", "runTimeSec", "solutionStatus", "solverBestBound",
      "solverIncumbentObjective", "solverUsed", "status", "terminationReason",
    ].sort());
    expect(legacy.status).toBe("optimal");
    expect(legacy.objective).toBe(100);
  });

  it("a failed/timeout/interrupted outcome never calls db.transaction (markSucceeded) or writes result_cache", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    emitFd3(child, { failureReason: "internal_error", failureStage: "dataset_load", errorDetail: null });
    child.emit("close", 0);

    await vi.waitFor(() => expect(mockDb.update).toHaveBeenCalled());
    // Only markRunning + markFailed ever touched db.update; db.transaction
    // (markSucceeded's sole entry point) and a second db.insert (result_cache)
    // never happened.
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalledTimes(1); // enqueueSolveJob only
  });
});

// Part F (T6) — markSucceeded's job-row and scenario-row writes must be
// ATOMIC: a single db.transaction(), not two independent db.update() calls.
// Both the normal solver path and the cache-hit path funnel through the
// SAME markSucceeded, so both must be covered here.
describe("markSucceeded transaction (Part F / T6)", () => {
  // B6 whole-branch review Finding #1 — carries `solutionStatus` so this
  // envelope is a v2/post-B2 shape, since several tests below feed it
  // through the cache-hit path (lookupCachedResult now treats a row missing
  // `solutionStatus` as a miss — see result_cache describe block above).
  const envelope = {
    status: "optimal", objective: 12345, runTimeSec: 0.3, quality: "Optimal",
    solutionStatus: "optimal", terminationReason: "optimality_proven",
    edges: [], metrics: { weightedAvgDistance: 88 }, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
  };

  it("writes job + scenario in ONE transaction on the normal solver path", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(5, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    emitFd3(child, envelope);
    child.emit("close", 0);

    await vi.waitFor(() => expect(mockDb.transaction).toHaveBeenCalledTimes(1));
    // Both writes happened INSIDE the single transaction call, not as two
    // independent top-level db.update() calls outside of it.
    expect(mockDb.update.mock.calls.length).toBeGreaterThanOrEqual(2); // markRunning + the two tx.update()s route through the same mock
  });

  it("cache-hit path commits both sides identically (one transaction call)", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: "h", modelId: "p-median-us", result: envelope },
    ]));

    await enqueueSolveJob(6, "user-1", baseInput);

    await vi.waitFor(() => expect(mockDb.transaction).toHaveBeenCalledTimes(1));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("persists the full envelope on solve_jobs.result and the job id on scenarios.resultRunId", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    const scenarioUpdateChain = makeChain([{}]);
    mockDb.update
      .mockReturnValueOnce(jobUpdateChain)      // markRunning
      .mockReturnValueOnce(jobUpdateChain)      // markSucceeded — job row (inside tx)
      .mockReturnValueOnce(scenarioUpdateChain); // markSucceeded — scenario row (inside tx)
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: "h", modelId: "p-median-us", result: envelope },
    ]));

    // enqueueSolveJob's own insert mock always returns job id 1 regardless
    // of the scenarioId argument (see makeChain([{ id: 1 }]) above) — the job
    // id and the scenario id are deliberately different numbers here so this
    // assertion can't pass by their accidentally coinciding.
    const jobId = await enqueueSolveJob(77, "user-1", baseInput);
    expect(jobId).toBe(1);

    await vi.waitFor(() => expect(setValues(jobUpdateChain).some((s) => s.status === "succeeded")).toBe(true));

    const jobSet = setValues(jobUpdateChain).find((s) => s.status === "succeeded")!;
    expect(jobSet.result).toEqual(envelope);

    const scenarioSet = setValues(scenarioUpdateChain).find((s) => s.resultRunId === jobId)!;
    expect(scenarioSet).toBeDefined();
    expect(scenarioSet.result).toEqual(envelope);
    expect(scenarioSet.resultRunId).toBe(jobId);
  });

  it("a forced mid-transaction failure writes NEITHER side", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    // CAS claim succeeds (outside markSucceeded's transaction); the
    // runJob-level catch-all's OWN markFailed call (below) is the second
    // db.update call — give it a real chain too so it resolves instead of
    // throwing on an undefined return value.
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // CAS claim
      .mockReturnValueOnce(makeChain([{}])); // A2's catch-all markFailed (published)
    // The transaction itself throws before either update's result is
    // observable to the outside world — simulates a mid-transaction DB error.
    mockDb.transaction.mockImplementationOnce(async () => {
      throw new Error("simulated mid-transaction failure");
    });
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: "h", modelId: "p-median-us", result: envelope },
    ]));

    // runJob (called via the worker pool's pump()) never throws outward —
    // confirm the job doesn't crash the process and the failure is swallowed
    // at the pool boundary, not surfaced as an unhandled rejection.
    await expect(enqueueSolveJob(8, "user-1", baseInput)).resolves.toBeTypeOf("number");
    await vi.waitFor(() => expect(mockDb.transaction).toHaveBeenCalledTimes(1));

    // Neither the job row nor the scenario row's "succeeded" write ever
    // landed via markSucceeded — the transaction itself threw before either
    // write became observable. A2's own catch-all around runJob's body then
    // marks the job terminally failed (its own separate db.update call, the
    // "crash immediately after claim" no-retry contract) rather than
    // stranding the row "running" forever.
    await vi.waitFor(() => expect(mockDb.update).toHaveBeenCalledTimes(2));
  });

  // A2 — the CAS claim (jobRunner.ts's first db.update call) must still
  // succeed (non-empty .returning()) for the job to ever spawn at all; the
  // scenario+job deletion happens LATER, mid-solve, so it's markSucceeded's
  // OWN job-row update (inside its transaction) that now matches 0 rows —
  // the exact "dropped stale completion" case the ownership predicate
  // exists to catch. Per A2's contract this SKIPS the scenario update
  // entirely (never touches a since-deleted row) rather than blindly
  // running both updates as 0-row no-ops the old code did.
  it("a solve completing after its scenario was deleted is a 0-row no-op, not an error (ownership-gated: the scenario update never runs)", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // CAS claim succeeds
      .mockReturnValue(makeChain([])); // every subsequent update (markSucceeded's job-row update) matches 0 rows

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(9, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    emitFd3(child, envelope);
    child.emit("close", 0);

    // The transaction still commits (no throw) even though the job-row
    // update affected 0 rows — markSucceeded resolves {kind:"not_owned"}
    // (A7) rather than throwing, and the scenario update inside the
    // transaction never runs at all.
    await vi.waitFor(() => expect(mockDb.transaction).toHaveBeenCalledTimes(1));
    await expect(mockDb.transaction.mock.results[0].value).resolves.toEqual({ kind: "not_owned" });
    // Exactly 2 db.update calls total: the CAS claim + markSucceeded's
    // (0-row) job-row update — the scenario update is gated out entirely.
    expect((mockDb.update as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // A7 — a genuine throw on the SECOND internal statement (the scenario-row
  // update), NOT the transaction wrapper itself — refines the "forced
  // mid-transaction failure" test above (which throws before either
  // tx.update() is even attempted) by proving the job-row update's own
  // success inside the transaction does NOT get reported as a real commit
  // when the very next statement in the SAME transaction genuinely fails.
  // A real Postgres driver rolls back both statements together; this proves
  // our own code doesn't swallow that error or claim a partial success.
  it("a genuine throw between the two internal statements propagates (rollback), not a partial 'succeeded'", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // CAS claim (outside markSucceeded's transaction)
      .mockReturnValueOnce(makeChain([{}])); // runJob's outer catch-all's own markFailed call
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: "h", modelId: "p-median-us", result: envelope },
    ]));

    let txUpdateCallCount = 0;
    mockDb.transaction.mockImplementationOnce(async (cb: (tx: typeof mockDb) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => {
          txUpdateCallCount++;
          if (txUpdateCallCount === 1) return makeChain([{ id: 1 }]); // the job-row update "succeeds"
          throw new Error("simulated failure on the scenario-row statement"); // the very next statement genuinely throws
        }),
      };
      return cb(tx as unknown as typeof mockDb);
    });

    await expect(enqueueSolveJob(20, "user-1", baseInput)).resolves.toBeTypeOf("number");
    await vi.waitFor(() => expect(mockDb.transaction).toHaveBeenCalledTimes(1));
    // markSucceeded's own promise REJECTED — never resolved to any
    // ScenarioPublicationOutcome at all, published or otherwise.
    await expect(mockDb.transaction.mock.results[0].value).rejects.toThrow(/scenario-row statement/);
    // runJob's top-level catch-all still terminal-fails the job rather than
    // stranding it "running" (the same no-retry contract as any other
    // "crash between claim and a defined outcome" case).
    await vi.waitFor(() => expect((mockDb.update as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2));
  });

  // A7 — a cache hit publishes under the CURRENT job's OWN identity, never
  // a stale one from whichever job originally wrote the cache entry (the
  // §2.12 "composition" concern, at the layer this task actually owns:
  // markSucceeded's resultRunId always comes from the argument it was
  // called with, not from anything baked into the cached envelope). Two
  // DIFFERENT job ids share the exact same cache entry; each publish must
  // point at its OWN job id, never the other's.
  it("cache-hit publication attributes resultRunId to the CURRENT job, never a different job that shares the cache entry", async () => {
    const cachedEnvelope = { ...envelope, objective: 909 };

    // First cache hit — job id 101.
    mockDb.insert.mockReturnValueOnce(makeChain([{ id: 101 }]));
    const scenarioUpdateChainA = makeChain([{}]);
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // CAS claim
      .mockReturnValueOnce(makeChain([{}])) // markSucceeded job-row update
      .mockReturnValueOnce(scenarioUpdateChainA); // markSucceeded scenario-row update
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: "shared-hash", modelId: "p-median-us", result: cachedEnvelope },
    ]));
    await enqueueSolveJob(31, "user-1", baseInput);
    await vi.waitFor(() => expect(setValues(scenarioUpdateChainA).some((s) => s.resultRunId === 101)).toBe(true));

    // Second cache hit against the SAME cache entry — job id 202, a
    // DIFFERENT scenario. Must publish under ITS OWN job id.
    mockDb.insert.mockReturnValueOnce(makeChain([{ id: 202 }]));
    const scenarioUpdateChainB = makeChain([{}]);
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // CAS claim
      .mockReturnValueOnce(makeChain([{}])) // markSucceeded job-row update
      .mockReturnValueOnce(scenarioUpdateChainB); // markSucceeded scenario-row update
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: "shared-hash", modelId: "p-median-us", result: cachedEnvelope },
    ]));
    await enqueueSolveJob(32, "user-1", baseInput);
    await vi.waitFor(() => expect(setValues(scenarioUpdateChainB).some((s) => s.resultRunId === 202)).toBe(true));

    // Neither chain's resultRunId is ever the OTHER job's id.
    expect(setValues(scenarioUpdateChainA).some((s) => s.resultRunId === 202)).toBe(false);
    expect(setValues(scenarioUpdateChainB).some((s) => s.resultRunId === 101)).toBe(false);
  });
});

// A7 — outcome-specific cache eligibility (§2.8), flag OFF. This file never
// sets SOLVER_V2_WRITE_ENABLED, so isV2WriteEnabled() reads false throughout
// (see featureFlags.ts's own fail-closed default) — the plan's flag-scoping
// rule requires that with the flag OFF, cache-write behavior for a
// successful solve stays BYTE-FOR-BYTE unchanged from pre-A7: every
// solutionStatus is cached unconditionally under the v1 key, exactly as it
// was before this task. The flag-ON half of this table (no_solution never
// cached; others cached under the v2 key) is covered in
// jobRunnerV2Cache.test.ts, which sets the flag before its own dynamic
// import (module-load-once, can't be toggled mid-file).
describe("A7 — isOutcomeCacheable (pure function)", () => {
  it("flag OFF: every solutionStatus is cacheable, INCLUDING no_solution (preserves pre-A7 behavior)", () => {
    for (const status of ["optimal", "feasible", "infeasible", "unbounded", "no_solution"]) {
      expect(isOutcomeCacheable(status, false)).toBe(true);
    }
  });

  it("flag ON: every solutionStatus is cacheable EXCEPT no_solution", () => {
    for (const status of ["optimal", "feasible", "infeasible", "unbounded"]) {
      expect(isOutcomeCacheable(status, true)).toBe(true);
    }
    expect(isOutcomeCacheable("no_solution", true)).toBe(false);
  });
});

describe("A7 — outcome-specific cache/publish lifecycle (flag OFF — this file's default)", () => {
  const outcomeCases: { status: string; objective: number }[] = [
    { status: "optimal", objective: 100 },
    { status: "feasible", objective: 150 },
    { status: "infeasible", objective: 0 },
    { status: "unbounded", objective: -1 },
    { status: "no_solution", objective: 0 },
  ];

  it.each(outcomeCases)("flag OFF: a fresh '$status' solve is BOTH cached and published (pre-A7 behavior, unchanged)", async ({ status, objective }) => {
    const enqueueChain = makeChain([{ id: 1 }]);
    const cacheInsertChain = makeChain([{}]);
    mockDb.insert.mockReturnValueOnce(enqueueChain).mockReturnValueOnce(cacheInsertChain);
    const jobUpdateChain = makeChain([{}]);
    const scenarioUpdateChain = makeChain([{}]);
    mockDb.update
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(scenarioUpdateChain);
    mockDb.select.mockReturnValueOnce(makeChain([])); // cache miss

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    const outcomeEnvelope = {
      status, objective, runTimeSec: 0.2, quality: status,
      solutionStatus: status, terminationReason: status === "optimal" ? "optimality_proven" : "unknown",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: status === "infeasible" ? "no feasible assignment" : null,
    };

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    emitFd3(child, outcomeEnvelope);
    child.emit("close", 0);

    // Cached — flag off means every status is still cache-eligible.
    await vi.waitFor(() => {
      expect((cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    // Published — publication always happens for every solved outcome,
    // regardless of cache eligibility.
    await vi.waitFor(() => expect(setValues(scenarioUpdateChain).some((s) => (s.result as { status: string })?.status === status)).toBe(true));
  });
});

// A2 — reapStuckJobs (the old "mark EVERY running row failed unconditionally
// at boot" reaper) is REMOVED — it's the live defect A2 fixes (it broke a
// still-live prior revision's in-flight solves on every zero-downtime
// rolling deploy). Replaced by initDispatcherForBoot's CAS-based recurring
// dispatcher + reapStaleLeases' heartbeat-staleness takeover (60s threshold,
// ownership-checked) + Phase 2's gated null-lease/historical cleanup — all
// covered in jobRunnerDispatcher.test.ts and solver/__tests__/
// dispatcherRecovery.test.ts.

describe("result_cache (P1.2 write-through cache)", () => {
  // B6 whole-branch review Finding #1 — carries `solutionStatus` (a v2/post-B2
  // envelope shape) so the "cache hit" test below doubles as proof a v2 row
  // still hits; see the dedicated legacy-row test further down for the
  // missing-solutionStatus (pre-B2) case.
  const envelope = {
    status: "optimal", objective: 42, runTimeSec: 0.2, quality: "Optimal",
    solutionStatus: "optimal", terminationReason: "optimality_proven",
    edges: [], metrics: { weightedAvgDistance: 7 }, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
  };

  it("a cache hit skips spawning the solver entirely and still transitions the job to succeeded", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    const scenarioUpdateChain = makeChain([{}]);
    // Call order on a cache hit: markRunning, then markSucceeded's job-row
    // update, then markSucceeded's scenario-row update — no solver-process
    // updates in between, because there's no solver process.
    mockDb.update
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(scenarioUpdateChain);
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: "does-not-matter-to-the-mock", modelId: "p-median-us", result: envelope },
    ]));

    await enqueueSolveJob(99, "user-1", baseInput);

    await vi.waitFor(() => expect(setValues(jobUpdateChain).some((s) => s.status === "succeeded")).toBe(true));
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(setValues(scenarioUpdateChain).some((s) => (s.result as { objective: number })?.objective === 42)).toBe(true);
  });

  it("a cache miss spawns the solver normally and writes the result through to result_cache", async () => {
    const enqueueChain = makeChain([{ id: 1 }]);
    const cacheInsertChain = makeChain([{}]);
    mockDb.insert.mockReturnValueOnce(enqueueChain).mockReturnValueOnce(cacheInsertChain);
    mockDb.update.mockReturnValue(makeChain([{}]));
    // mockDb.select's beforeEach default ([]) applies here — cache miss.

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(7, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    emitFd3(child, envelope);
    child.emit("close", 0);

    await vi.waitFor(() => {
      expect((cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    const written = (cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(written.modelId).toBe("p-median-us");
    expect((written.result as typeof envelope).objective).toBe(42);
    expect(typeof written.inputsHash).toBe("string");
    expect((written.inputsHash as string).length).toBeGreaterThan(0);
  });

  it("two jobs with the same inputsHash: the second serves from the cache the first wrote, without spawning a second solver process", async () => {
    const enqueueChain1 = makeChain([{ id: 1 }]);
    const cacheInsertChain = makeChain([{}]);
    const enqueueChain2 = makeChain([{ id: 2 }]);
    mockDb.insert
      .mockReturnValueOnce(enqueueChain1)
      .mockReturnValueOnce(cacheInsertChain)
      .mockReturnValueOnce(enqueueChain2);
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1));
    emitFd3(child, envelope);
    child.emit("close", 0);

    await vi.waitFor(() => {
      expect((cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    // Feed the second job's select exactly what the first job's write-through
    // wrote — a genuine round trip through the write-then-read path, not a
    // blindly scripted "assume it's cached" stub.
    const written = (cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0];
    mockDb.select.mockReturnValueOnce(makeChain([written]));

    await enqueueSolveJob(2, "user-1", baseInput);
    await vi.waitFor(() => {
      const updateCalls = (mockDb.update as ReturnType<typeof vi.fn>).mock.calls.length;
      // job1 (miss): running + succeeded(job) + succeeded(scenario) = 3
      // job2 (hit):  running + succeeded(job) + succeeded(scenario) = 3
      expect(updateCalls).toBeGreaterThanOrEqual(6);
    });
    expect(mockSpawn).toHaveBeenCalledTimes(1); // job2 never spawned a second process
  });

  it("a malformed cached entry (schema drift) is treated as a cache miss instead of crashing the job", async () => {
    const enqueueChain = makeChain([{ id: 1 }]);
    const cacheInsertChain = makeChain([{}]);
    mockDb.insert.mockReturnValueOnce(enqueueChain).mockReturnValueOnce(cacheInsertChain);
    mockDb.update.mockReturnValue(makeChain([{}]));
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: "x", modelId: "p-median-us", result: { not: "a valid envelope" } },
    ]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    // Falls through to a real solve rather than crashing on the bad cache row.
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    emitFd3(child, envelope);
    child.emit("close", 0);

    await vi.waitFor(() => {
      const updateCalls = (mockDb.update as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(updateCalls).toBeGreaterThanOrEqual(3); // running + succeeded(job) + succeeded(scenario)
    });
  });

  // B6 whole-branch review Finding #1 — a pre-B2 cached row has no
  // `solutionStatus` key at all but still passes ResultEnvelopeSchema (the
  // field is optional), so without the fix it would be served as a hit
  // forever, rendering "Unverified" on every future re-solve of that same
  // baseline instead of self-healing. Confirms it's treated as a MISS: the
  // solver is actually spawned, and the truthful (solutionStatus-bearing)
  // result of that re-solve is what gets written through to the cache.
  it("a cached row missing solutionStatus (pre-B2) is treated as a miss and self-heals the cache on re-solve", async () => {
    const enqueueChain = makeChain([{ id: 1 }]);
    const cacheInsertChain = makeChain([{}]);
    mockDb.insert.mockReturnValueOnce(enqueueChain).mockReturnValueOnce(cacheInsertChain);
    mockDb.update.mockReturnValue(makeChain([{}]));
    const legacyEnvelope = {
      status: "optimal", objective: 1, runTimeSec: 0.1, quality: "Optimal",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
      // Deliberately no `solutionStatus` key — a genuine pre-B2 cache row.
    };
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: "x", modelId: "p-median-us", result: legacyEnvelope },
    ]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    // Falls through to a real solve instead of serving the stale legacy row.
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    emitFd3(child, envelope);
    child.emit("close", 0);

    await vi.waitFor(() => {
      expect((cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    const written = (cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect((written.result as Record<string, unknown>).solutionStatus).toBe("optimal");
  });
});

// A1 (SCND Correctness) — buildSolveJobValues is the single place a
// solve_jobs insert row is shaped, shared by both enqueueSolveJob and
// enqueueScenarioSolve. Real (unmocked) validateInputsForModel/
// computeInputsHash/RECOVERY_CONTRACT_IDENTITY calls — no DB involved, so
// no db mocking needed for these.
describe("buildSolveJobValues (A1 — durable payload + requested-limit shaping)", () => {
  it("rejects a payload whose inputs fail SolveInput/model validation (input_snapshot must never be built from invalid data)", () => {
    const invalidInput = {
      modelId: "p-median-us",
      inputs: { ...baseInput.inputs, capacityMode: "not-a-real-mode" },
    } as unknown as SolveInput;

    expect(() =>
      buildSolveJobValues({ scenarioId: 1, userId: "user-1", input: invalidInput, enqueuedSolveInputRevision: null }),
    ).toThrow(/input_snapshot rejected/);
  });

  it("builds a valid insert row: durable payload, requested-limit values/sources pinned to 'request', and the recovery identity", () => {
    const values = buildSolveJobValues({ scenarioId: 42, userId: "user-1", input: baseInput, enqueuedSolveInputRevision: 3 });

    expect(values.scenarioId).toBe(42);
    expect(values.userId).toBe("user-1");
    expect(values.status).toBe("queued");
    expect(values.modelId).toBe("p-median-us");
    expect(values.inputSnapshot).toEqual({ modelId: "p-median-us", inputs: baseInput.inputs });
    expect(values.enqueuedSolveInputRevision).toBe(3);
    expect(values.requestedGap).toBe(baseInput.inputs.gap);
    expect(values.requestedGapSource).toBe("request");
    expect(values.requestedTimeLimitSec).toBe(baseInput.inputs.timeLimitSec);
    expect(values.requestedTimeLimitSource).toBe("request");
    expect(values.recoveryContractIdentity).toBe(RECOVERY_CONTRACT_IDENTITY);
    expect(typeof values.inputsHash).toBe("string");
  });

  it("preserves a null enqueuedSolveInputRevision for a caller with no locked-scenario context (Class 1 — never fabricated)", () => {
    const values = buildSolveJobValues({ scenarioId: 1, userId: "user-1", input: baseInput, enqueuedSolveInputRevision: null });
    expect(values.enqueuedSolveInputRevision).toBeNull();
  });
});

describe("parsePositiveIntEnv (P1.1 env-var config parsing)", () => {
  it("returns the fallback when the env var is unset", () => {
    expect(parsePositiveIntEnv(undefined, 3)).toBe(3);
  });

  it("returns the fallback when the env var is blank/whitespace", () => {
    expect(parsePositiveIntEnv("", 3)).toBe(3);
    expect(parsePositiveIntEnv("   ", 3)).toBe(3);
  });

  it("returns the fallback when the env var is non-numeric", () => {
    expect(parsePositiveIntEnv("not-a-number", 3)).toBe(3);
  });

  it("returns the fallback when the env var is a non-integer", () => {
    expect(parsePositiveIntEnv("2.5", 3)).toBe(3);
  });

  it("returns the fallback when the env var is zero or negative", () => {
    expect(parsePositiveIntEnv("0", 3)).toBe(3);
    expect(parsePositiveIntEnv("-5", 3)).toBe(3);
  });

  it("returns the parsed value when the env var is a valid positive integer", () => {
    expect(parsePositiveIntEnv("8", 3)).toBe(8);
    expect(parsePositiveIntEnv("1", 3)).toBe(1);
  });
});

describe("QUEUE_DEPTH_LIMIT (P1.1)", () => {
  it("resolves to the documented default (30) when SOLVE_QUEUE_DEPTH_LIMIT is unset in this test process", () => {
    expect(QUEUE_DEPTH_LIMIT).toBe(30);
  });
});

// A5 — the exhaustive failureReason/Node-class -> errorCode mapping (§2.11 +
// the A3.T terminal table), plus the negative-leakage guarantee: this
// function NEVER reads/returns failureReason, failureStage, errorDetail, or
// the raw `error` column — its output is exactly {errorCode, errorMessage}
// or null, nothing else.
describe("derivePublicFailure (A5 — permanent public errorCode + errorMessage)", () => {
  it("returns null for every non-failed status", () => {
    for (const status of ["queued", "running", "succeeded"]) {
      expect(derivePublicFailure({ status, errorCode: "TIMEOUT", failureReason: "timeout", failureStage: "timeout" })).toBeNull();
    }
  });

  it("TT-1 timeout: errorCode column TIMEOUT -> TIMEOUT / \"Solve timed out\"", () => {
    expect(derivePublicFailure({ status: "failed", errorCode: "TIMEOUT", failureReason: "timeout", failureStage: "timeout" }))
      .toEqual({ errorCode: "TIMEOUT", errorMessage: "Solve timed out" });
  });

  it("TT-2 interrupted (cancel/deploy): failureReason=interrupted -> SOLVE_FAILED / \"Solve interrupted\", never TIMEOUT", () => {
    expect(derivePublicFailure({ status: "failed", errorCode: "SOLVE_FAILED", failureReason: "interrupted", failureStage: null }))
      .toEqual({ errorCode: "SOLVE_FAILED", errorMessage: "Solve interrupted" });
  });

  it("reapStaleLeases' server-restart-reaper interruption classifies identically to a live cancellation", () => {
    expect(derivePublicFailure({ status: "failed", errorCode: "SOLVE_FAILED", failureReason: "interrupted", failureStage: "reaper" }))
      .toEqual({ errorCode: "SOLVE_FAILED", errorMessage: "Solve interrupted" });
  });

  it("recovery-contract-identity / version-mismatch (data_error + validate) -> SOLVE_FAILED / the exact A2 string", () => {
    expect(derivePublicFailure({ status: "failed", errorCode: "SOLVE_FAILED", failureReason: "data_error", failureStage: "validate" }))
      .toEqual({ errorCode: "SOLVE_FAILED", errorMessage: VERSION_MISMATCH_SAFE_MESSAGE });
    // Byte-identical to A2's temporary pre-A5 string, per the plan's own
    // instruction — nothing changes for this case when A5 lands.
    expect(VERSION_MISMATCH_SAFE_MESSAGE).toBe("Solve could not run — please try again");
  });

  it("Phase 2's legacy-row cleanup (same failureReason/failureStage pair, different origin) reads identically to a live version mismatch", () => {
    expect(derivePublicFailure({ status: "failed", errorCode: "SOLVE_FAILED", failureReason: "data_error", failureStage: "validate" }))
      .toEqual({ errorCode: "SOLVE_FAILED", errorMessage: VERSION_MISMATCH_SAFE_MESSAGE });
  });

  it("every other TT-5..TT-11/TT-14 classification (solver_error/internal_error, any stage) -> the generic SOLVE_FAILED / \"Solve failed\"", () => {
    const cases: Array<{ failureReason: string; failureStage: string }> = [
      { failureReason: "solver_error", failureStage: "cbc_parse" },
      { failureReason: "solver_error", failureStage: "exit" },
      { failureReason: "internal_error", failureStage: "protocol" },
      { failureReason: "internal_error", failureStage: "spawn" },
      { failureReason: "internal_error", failureStage: "exit" },
    ];
    for (const c of cases) {
      expect(derivePublicFailure({ status: "failed", errorCode: "SOLVE_FAILED", ...c }))
        .toEqual({ errorCode: "SOLVE_FAILED", errorMessage: "Solve failed" });
    }
  });

  it("a historical pre-A1 row with EVERY typed column null reads as the conservative SOLVE_FAILED default, never TIMEOUT", () => {
    expect(derivePublicFailure({ status: "failed", errorCode: null, failureReason: null, failureStage: null }))
      .toEqual({ errorCode: "SOLVE_FAILED", errorMessage: "Solve failed" });
  });

  it("a historical row with typed columns entirely ABSENT (undefined, not just null) degrades identically", () => {
    expect(derivePublicFailure({ status: "failed" }))
      .toEqual({ errorCode: "SOLVE_FAILED", errorMessage: "Solve failed" });
  });

  it("never returns failureReason/failureStage/errorDetail/error on its output shape", () => {
    const result = derivePublicFailure({ status: "failed", errorCode: "SOLVE_FAILED", failureReason: "interrupted", failureStage: "reaper" });
    expect(result).not.toBeNull();
    expect(Object.keys(result!).sort()).toEqual(["errorCode", "errorMessage"]);
  });
});
