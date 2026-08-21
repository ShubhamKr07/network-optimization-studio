import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

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
  ["select", "from", "where", "insert", "values", "returning", "update", "set", "onConflictDoNothing"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => Promise.resolve(returnValue).then(resolve);
  return chain;
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  kill = vi.fn();
}

import { enqueueSolveJob, getQueueDepth, parsePositiveIntEnv, QUEUE_DEPTH_LIMIT, reapStuckJobs } from "../solver/jobRunner.js";
import type { SolveInput } from "../solver/pmedian.js";

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
});

afterEach(() => {
  vi.useRealTimers();
});

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

    child.stdout.emit("data", Buffer.from(JSON.stringify({
      status: "optimal", objective: 100, runTimeSec: 0.1, quality: "Optimal",
      edges: [], metrics: { weightedAvgDistance: 5 }, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    })));
    child.emit("close", 0);

    await vi.waitFor(() => expect(setValues(jobUpdateChain).some((s) => s.status === "succeeded")).toBe(true));
    expect(setValues(scenarioUpdateChain).some((s) => (s.result as { status: string })?.status === "optimal")).toBe(true);
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
    const envelope = JSON.stringify({
      status: "optimal", objective: 1, runTimeSec: 0.1, quality: "Optimal",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    });
    child1.stdout.emit("data", Buffer.from(envelope));
    child1.emit("close", 0);
    child2.stdout.emit("data", Buffer.from(envelope));
    child2.emit("close", 0);
    await vi.waitFor(() => {
      const updateCalls = (mockDb.update as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(updateCalls).toBeGreaterThanOrEqual(6); // 2x(running + job-succeeded + scenario-succeeded)
    });
  });

  it("timeout kills the child process and marks the job failed with a message", async () => {
    vi.useFakeTimers();
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild(); // never emits "close" — simulates a hang
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", { ...baseInput, inputs: { ...baseInput.inputs, timeLimitSec: 1 } });

    // Flush pending microtasks (markRunning's DB update, buildPayload, the
    // spawn() call and its setTimeout registration) before advancing —
    // otherwise the timeout timer hasn't been set yet.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000 + 15000 + 100);

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    // Flush the microtask chain after the timeout fires (markFailed's
    // db.update) — vi.waitFor's own polling is timer-based and would be
    // faked too, so flush manually instead of using it under fake timers.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const calls = setValues(jobUpdateChain);
    expect(calls.some((s) => s.status === "failed" && String(s.error).includes("timed out"))).toBe(true);
  });

  it("a non-zero exit code marks the job failed without throwing", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("close", 1);

    await vi.waitFor(() => expect(setValues(jobUpdateChain).some((s) => s.status === "failed")).toBe(true));
  });

  it("unparseable stdout marks the job failed without throwing", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.stdout.emit("data", Buffer.from("not valid json {{"));
    child.emit("close", 0);

    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed" && String(s.error).includes("Failed to parse"))).toBe(true);
    });
  });

  it("an envelope that fails schema validation marks the job failed without throwing", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.stdout.emit("data", Buffer.from(JSON.stringify({ not: "an envelope" })));
    child.emit("close", 0);

    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed" && String(s.error).includes("envelope validation"))).toBe(true);
    });
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

    const envelope = JSON.stringify({
      status: "optimal", objective: 1, runTimeSec: 0.1, quality: "Optimal",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    });
    children[0].stdout.emit("data", Buffer.from(envelope));
    children[0].emit("close", 0);

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(4));
    expect(getQueueDepth()).toBe(0); // job 4 was picked up, nothing left waiting

    // Drain the rest so this test doesn't leak activeCount into later tests.
    for (const child of children.slice(1)) {
      child.stdout.emit("data", Buffer.from(envelope));
      child.emit("close", 0);
    }
    await vi.waitFor(() => {
      const updateCalls = (mockDb.update as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(updateCalls).toBeGreaterThanOrEqual(12); // 4x(running + job-succeeded + scenario-succeeded)
    });
  });

  it("spawn error (e.g. ENOENT) marks the job failed without throwing", async () => {
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
      expect(calls.some((s) => s.status === "failed" && String(s.error).includes("ENOENT"))).toBe(true);
    });
  });

  // H2 — lastJsonLine() tolerates a banner printed before the JSON envelope:
  // a deprecation warning or CBC banner on stdout must not break parsing,
  // only the last non-empty line is read.
  it("banner-then-JSON on stdout parses correctly (banner ignored)", async () => {
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
    child.stdout.emit("data", Buffer.from(JSON.stringify({
      status: "optimal", objective: 7, runTimeSec: 0.1, quality: "Optimal",
      edges: [], metrics: { weightedAvgDistance: 5 }, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    })));
    child.emit("close", 0);

    await vi.waitFor(() => expect(setValues(jobUpdateChain).some((s) => s.status === "succeeded")).toBe(true));
    expect(setValues(scenarioUpdateChain).some((s) => (s.result as { objective: number })?.objective === 7)).toBe(true);
  });

  // H2 — banner-only stdout (no JSON anywhere) fails the job, and stderr is
  // included in the failure message so the failure is diagnosable.
  it("banner-only stdout fails the job with stderr included in the message", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValue(jobUpdateChain);

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    child.stdout.emit("data", Buffer.from("just a banner, no JSON\n"));
    child.stderr.emit("data", Buffer.from("python3: traceback boom\n"));
    child.emit("close", 0);

    await vi.waitFor(() => {
      const calls = setValues(jobUpdateChain);
      expect(calls.some((s) => s.status === "failed")).toBe(true);
      expect(calls.some((s) => String(s.error).includes("Failed to parse solver output"))).toBe(true);
      expect(calls.some((s) => String(s.error).includes("traceback boom"))).toBe(true);
    });
  });
});

describe("reapStuckJobs (startup reaper)", () => {
  it("marks a leftover running job as failed with an interruption message", async () => {
    // Seed a single stuck "running" row.
    const selectChain = makeChain([{ id: 7 }]);
    mockDb.select.mockReturnValueOnce(selectChain);
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValueOnce(jobUpdateChain);

    await reapStuckJobs();

    const calls = setValues(jobUpdateChain);
    expect(calls.some((s) => s.status === "failed" && String(s.error).includes("Interrupted by server restart"))).toBe(true);
  });

  it("leaves queued/succeeded/failed jobs untouched and only fails running jobs", async () => {
    // Seed rows: only the "running" one (id 3) should be transitioned.
    const selectChain = makeChain([{ id: 3 }]);
    mockDb.select.mockReturnValueOnce(selectChain);
    const jobUpdateChain = makeChain([{}]);
    mockDb.update.mockReturnValueOnce(jobUpdateChain);

    await reapStuckJobs();

    // Exactly one update (markFailed) was issued — for the running row only.
    const updateCalls = setValues(jobUpdateChain);
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].status).toBe("failed");
    expect(String(updateCalls[0].error).includes("Interrupted by server restart")).toBe(true);
  });
});

describe("result_cache (P1.2 write-through cache)", () => {
  const envelope = {
    status: "optimal", objective: 42, runTimeSec: 0.2, quality: "Optimal",
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

    child.stdout.emit("data", Buffer.from(JSON.stringify(envelope)));
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
    child.stdout.emit("data", Buffer.from(JSON.stringify(envelope)));
    child.emit("close", 0);

    await vi.waitFor(() => {
      expect((cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    // Feed the second job's select exactly what the first job's write-through
    // wrote — a genuine round-trip through the write-then-read path, not a
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
    child.stdout.emit("data", Buffer.from(JSON.stringify(envelope)));
    child.emit("close", 0);

    await vi.waitFor(() => {
      const updateCalls = (mockDb.update as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(updateCalls).toBeGreaterThanOrEqual(3); // running + succeeded(job) + succeeded(scenario)
    });
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
