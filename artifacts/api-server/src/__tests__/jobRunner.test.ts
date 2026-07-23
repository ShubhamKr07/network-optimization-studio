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

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stdin = { write: vi.fn(), end: vi.fn() };
  kill = vi.fn();
}

import { enqueueSolveJob } from "../solver/jobRunner.js";
import type { SolveInput } from "../solver/pmedian.js";

const baseInput: SolveInput = {
  modelId: "p-median-us",
  inputs: {
    p: 3, distanceBands: [200], capacityMode: "none", uniformCapacity: null,
    warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 1,
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
});
