// P1.1 — verifies SOLVE_WORKER_CONCURRENCY actually changes worker-pool
// behavior at runtime, not just that a parsing helper returns the right
// number. jobRunner.ts reads process.env.SOLVE_WORKER_CONCURRENCY once, at
// module load time, so this needs a fresh module instance per env-var value
// under test. Vitest gives each test *file* its own isolated module registry
// by default, so setting process.env here (a plain top-of-file statement,
// which runs before any *dynamic* import — unlike static imports, dynamic
// import() calls are not hoisted) and then dynamically importing jobRunner.js
// inside a test is enough; no vi.resetModules() juggling needed since this
// file only ever needs one concurrency value.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { EventEmitter } from "events";

process.env.SOLVE_WORKER_CONCURRENCY = "1";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  solveJobsTable: { id: "id", scenarioId: "scenario_id", userId: "user_id", status: "status" },
  scenariosTable: { id: "id" },
  resultCacheTable: { inputsHash: "inputs_hash", modelId: "model_id", result: "result" },
}));

const mockSpawn = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ spawn: mockSpawn }));

function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "insert", "values", "returning", "update", "set"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => Promise.resolve(returnValue).then(resolve);
  return chain;
}

// jobRunner's runSolverProcess attaches listeners to child.stdout AND
// child.stderr (commit 8f325a5 added stderr capture so CBC banners/deprecation
// warnings don't get lost). A FakeChild without a stderr makes
// child.stderr.on("data", ...) throw synchronously inside the Promise
// executor, rejecting the spawn promise — which the worker pool treats as a
// job failure, prematurely freeing the slot and breaking the concurrency=1
// invariant under test. So FakeChild must mirror a real ChildProcess's
// stderr stream too.
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  kill = vi.fn();
}

type JobRunnerModule = typeof import("../solver/jobRunner.js");
let enqueueSolveJob: JobRunnerModule["enqueueSolveJob"];
let getQueueDepth: JobRunnerModule["getQueueDepth"];

beforeAll(async () => {
  const mod = await import("../solver/jobRunner.js");
  enqueueSolveJob = mod.enqueueSolveJob;
  getQueueDepth = mod.getQueueDepth;
});

const baseInput = {
  modelId: "p-median-us" as const,
  inputs: {
    p: 3, distanceBands: [200], capacityMode: "none" as const, uniformCapacity: null,
    warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 1,
    addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
  },
};

describe("jobRunner honors SOLVE_WORKER_CONCURRENCY=1", () => {
  it("only spawns one solver process at a time, queuing the second job until the first finishes", async () => {
    mockDb.insert
      .mockReturnValueOnce(makeChain([{ id: 1 }]))
      .mockReturnValueOnce(makeChain([{ id: 2 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    // P1.2: runJob() now does a result_cache lookup (db.select) before
    // spawning the solver — default to a cache miss (empty result set) so
    // this concurrency test still exercises the real spawn path.
    mockDb.select.mockReturnValue(makeChain([]));

    const child1 = new FakeChild();
    const child2 = new FakeChild();
    mockSpawn.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

    await enqueueSolveJob(1, "user-1", baseInput);
    await enqueueSolveJob(2, "user-1", baseInput);

    // Give the pump a tick to run synchronously-reachable work.
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1));
    // Concurrency of 1: the second job must NOT have started yet — it's
    // sitting in the queue, not merely slow to start.
    expect(getQueueDepth()).toBe(1);
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    const envelope = JSON.stringify({
      status: "optimal", objective: 1, runTimeSec: 0.1, quality: "Optimal",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    });
    child1.stdout.emit("data", Buffer.from(envelope));
    child1.emit("close", 0);

    // Only once the first job finishes does the second get its turn.
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(2));
    expect(getQueueDepth()).toBe(0);

    child2.stdout.emit("data", Buffer.from(envelope));
    child2.emit("close", 0);
    await vi.waitFor(() => {
      const updateCalls = (mockDb.update as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(updateCalls).toBeGreaterThanOrEqual(6);
    });
  });
});
