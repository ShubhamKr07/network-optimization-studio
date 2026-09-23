// A6 (SCND Correctness) — proves the v2 cache path (SOLVER_CONTRACT_IDENTITY
// key) actually activates when isV2WriteEnabled() is true, and that it's a
// GENUINELY DIFFERENT key space from the v1 path (jobRunner.test.ts, which
// never sets SOLVER_V2_WRITE_ENABLED, is the "flag off => byte-for-byte
// unchanged" proof for the v1 path — deliberately NOT duplicated here).
//
// featureFlags.ts resolves isV2WriteEnabled() ONCE at module load, so this
// needs its own file with the env var set as a plain top-of-file statement
// BEFORE any dynamic import — the same "one concurrency/flag value per
// file, no resetModules juggling" pattern jobRunnerConcurrency.test.ts
// established for jobRunner.ts's own module-load-time env reads.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { EventEmitter } from "events";

process.env.SOLVER_V2_WRITE_ENABLED = "true";

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
// A1 — jobRunner.ts's module-load-time RECOVERY_CONTRACT_IDENTITY AND (A6)
// SOLVER_CONTRACT_IDENTITY computations both call the real `spawnSync` to
// probe PuLP/CBC. This mock replaces child_process's whole export surface,
// so spawnSync must be stubbed too, or both eager computes throw before any
// test in this file runs. `/bin/sh` is a real, always-present POSIX path.
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

const envelope = {
  status: "optimal", objective: 42, runTimeSec: 0.2, quality: "Optimal",
  solutionStatus: "optimal", terminationReason: "optimality_proven",
  edges: [], metrics: { weightedAvgDistance: 7 }, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
};

import type { SolveInput } from "../solver/pmedian.js";

type JobRunnerModule = typeof import("../solver/jobRunner.js");
let enqueueSolveJob: JobRunnerModule["enqueueSolveJob"];
let computeInputsHash: JobRunnerModule["computeInputsHash"];
let computeInputsHashV2: JobRunnerModule["computeInputsHashV2"];
let SOLVER_CONTRACT_IDENTITY: JobRunnerModule["SOLVER_CONTRACT_IDENTITY"];
let RECOVERY_CONTRACT_IDENTITY: JobRunnerModule["RECOVERY_CONTRACT_IDENTITY"];

beforeAll(async () => {
  const mod = await import("../solver/jobRunner.js");
  enqueueSolveJob = mod.enqueueSolveJob;
  computeInputsHash = mod.computeInputsHash;
  computeInputsHashV2 = mod.computeInputsHashV2;
  SOLVER_CONTRACT_IDENTITY = mod.SOLVER_CONTRACT_IDENTITY;
  RECOVERY_CONTRACT_IDENTITY = mod.RECOVERY_CONTRACT_IDENTITY;
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

beforeEach(() => {
  vi.resetAllMocks();
  mockDb.select.mockReturnValue(makeChain([]));
  mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<void>) => cb(mockDb));
});

describe("SOLVER_CONTRACT_IDENTITY (module load, flag ON)", () => {
  it("is a full 64-hex-character digest, and is genuinely different from RECOVERY_CONTRACT_IDENTITY", () => {
    expect(SOLVER_CONTRACT_IDENTITY).toMatch(/^[0-9a-f]{64}$/);
    expect(SOLVER_CONTRACT_IDENTITY).not.toBe(RECOVERY_CONTRACT_IDENTITY);
  });
});

describe("computeInputsHashV2 (pure function, no DB)", () => {
  it("is deterministic for the same input", () => {
    expect(computeInputsHashV2(baseInput)).toBe(computeInputsHashV2(baseInput));
  });

  it("differs from computeInputsHash (v1) for the SAME logical inputs — different key spaces", () => {
    expect(computeInputsHashV2(baseInput)).not.toBe(computeInputsHash(baseInput));
  });

  it("changes when the inputs change", () => {
    const changed: SolveInput = { ...baseInput, inputs: { ...baseInput.inputs, p: 4 } };
    expect(computeInputsHashV2(changed)).not.toBe(computeInputsHashV2(baseInput));
  });
});

describe("v2 cache path (isV2WriteEnabled()=true)", () => {
  it("a v1-keyed cache row is a MISS under the v2 lookup — the solver still spawns", async () => {
    const enqueueChain = makeChain([{ id: 1 }]);
    const cacheInsertChain = makeChain([{}]);
    mockDb.insert.mockReturnValueOnce(enqueueChain).mockReturnValueOnce(cacheInsertChain);
    mockDb.update.mockReturnValue(makeChain([{}]));
    // A row keyed under the v1 hash — the v2 lookup computes a DIFFERENT
    // hash internally and queries by that value, so this mocked select
    // (which just returns whatever it's told regardless of the queried key,
    // since the mock doesn't actually filter by inputsHash) stands in for
    // "no row exists under the v2 key": returning empty here proves the
    // path still falls through to a real solve rather than trusting
    // whatever the v1 row would have been.
    mockDb.select.mockReturnValueOnce(makeChain([]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    emitFd3(child, envelope);
    child.emit("close", 0);

    await vi.waitFor(() => {
      expect((cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    const written = (cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    // Written under the v2 key, not the v1 key.
    expect(written.inputsHash).toBe(computeInputsHashV2(baseInput));
    expect(written.inputsHash).not.toBe(computeInputsHash(baseInput));
  });

  it("a cache hit under the v2 key skips spawning the solver entirely", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobUpdateChain = makeChain([{}]);
    const scenarioUpdateChain = makeChain([{}]);
    mockDb.update
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(scenarioUpdateChain);
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: computeInputsHashV2(baseInput), modelId: "p-median-us", result: envelope },
    ]));

    await enqueueSolveJob(2, "user-1", baseInput);

    await vi.waitFor(() => expect(setValues(jobUpdateChain).some((s) => s.status === "succeeded")).toBe(true));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("writes a fresh solve through to the cache keyed by computeInputsHashV2, not computeInputsHash", async () => {
    const enqueueChain = makeChain([{ id: 1 }]);
    const cacheInsertChain = makeChain([{}]);
    mockDb.insert.mockReturnValueOnce(enqueueChain).mockReturnValueOnce(cacheInsertChain);
    mockDb.update.mockReturnValue(makeChain([{}]));
    // beforeEach's default (empty select) applies — cache miss.

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await enqueueSolveJob(3, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    emitFd3(child, envelope);
    child.emit("close", 0);

    await vi.waitFor(() => {
      expect((cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    const written = (cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(written.inputsHash).toBe(computeInputsHashV2(baseInput));
  });
});

// A7 (§2.8) — outcome-specific cache/publish lifecycle, flag ON. This file
// sets SOLVER_V2_WRITE_ENABLED="true" at the top (before jobRunner.js's
// dynamic import), so isV2WriteEnabled() reads true throughout — the real
// §2.8 outcome table applies here: optimal/infeasible/unbounded/feasible are
// ALL cache-eligible under the v2 (complete effective-limit/version) key;
// no_solution is NEVER cached, though it is still always PUBLISHED (a
// no-incumbent result is still the truthful answer, it's just not reused).
// The flag-OFF half of this table (cache everything, pre-A7 behavior
// unchanged) is covered in jobRunner.test.ts.
describe("A7 — outcome-specific cache/publish lifecycle (flag ON)", () => {
  const cacheableCases: { status: string; objective: number }[] = [
    { status: "optimal", objective: 100 },
    { status: "feasible", objective: 150 }, // "cache only under the complete effective-limit/version key" — satisfied here BY the v2 key itself
    { status: "infeasible", objective: 0 },
    { status: "unbounded", objective: -1 },
  ];

  it.each(cacheableCases)("flag ON: a fresh '$status' solve IS cached under the v2 key, and published", async ({ status, objective }) => {
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

    await enqueueSolveJob(10, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    emitFd3(child, outcomeEnvelope);
    child.emit("close", 0);

    await vi.waitFor(() => {
      expect((cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    const written = (cacheInsertChain.values as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(written.inputsHash).toBe(computeInputsHashV2(baseInput)); // the "complete" key
    await vi.waitFor(() => expect(setValues(scenarioUpdateChain).some((s) => (s.result as { status: string })?.status === status)).toBe(true));
  });

  it("flag ON: a fresh 'no_solution' solve is PUBLISHED but NEVER cached (no incumbent is not a stable answer to memoize)", async () => {
    mockDb.insert.mockReturnValueOnce(makeChain([{ id: 1 }])); // enqueue's own insert only — NO second insert for result_cache
    const jobUpdateChain = makeChain([{}]);
    const scenarioUpdateChain = makeChain([{}]);
    mockDb.update
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(scenarioUpdateChain);
    mockDb.select.mockReturnValueOnce(makeChain([])); // cache miss

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    const noSolutionEnvelope = {
      status: "no_solution", objective: 0, runTimeSec: 0.2, quality: "No incumbent",
      solutionStatus: "no_solution", terminationReason: "time_limit",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    };

    await enqueueSolveJob(11, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    emitFd3(child, noSolutionEnvelope);
    child.emit("close", 0);

    // Published: the truthful no-incumbent result still reaches the scenario.
    await vi.waitFor(() => expect(setValues(scenarioUpdateChain).some((s) => (s.result as { status: string })?.status === "no_solution")).toBe(true));
    // Never cached: db.insert was called exactly ONCE (enqueueSolveJob's own
    // job-row insert) — no second insert for result_cache ever happened.
    expect((mockDb.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("flag ON: a cache HIT for a no_solution entry (written before this task, or under the flag-off path) still republishes it faithfully — reading is unaffected by the write-side policy", async () => {
    const jobUpdateChain = makeChain([{}]);
    const scenarioUpdateChain = makeChain([{}]);
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(jobUpdateChain)
      .mockReturnValueOnce(scenarioUpdateChain);
    mockDb.select.mockReturnValueOnce(makeChain([
      { inputsHash: computeInputsHashV2(baseInput), modelId: "p-median-us", result: { ...envelope, status: "no_solution", solutionStatus: "no_solution" } },
    ]));

    await enqueueSolveJob(12, "user-1", baseInput);

    await vi.waitFor(() => expect(setValues(scenarioUpdateChain).some((s) => (s.result as { status: string })?.status === "no_solution")).toBe(true));
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
