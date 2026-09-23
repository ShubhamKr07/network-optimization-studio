// A12 (SCND Correctness) — per-site PostHog/Sentry telemetry contract tests.
// Mocked (@workspace/db + child_process + ../lib/posthog.js + ../lib/sentry.js)
// coverage of EVERY actual jobRunner.ts telemetry emission site: the
// version-mismatch claim-time failure, the timeout/interrupted/failed solve
// outcomes, the two "success" sites (fresh solve + cache hit) gated on the
// A7 publication outcome, and the previously-uncovered catch-all
// unexpected-exception path. Two separate assertions at every "failed" site:
// (1) the PostHog "scenario solve failed" event carries ONLY a bounded
// `error_code` property — no `reason`/`failureReason`/`failureStage`/
// `errorDetail`/diagnostic text anywhere in its payload; (2) the Sentry
// `captureSolveFailure` call receives the closed internal taxonomy
// (failureReason/failureStage) plus — where a real fd3 SolverFailure message
// carried one — the structured errorDetail, proving jobRunner.ts's own
// wiring forwards it end-to-end (sentry.ts's OWN allowlist/leakage
// filtering is covered separately, in lib/sentry.test.ts). Every "completed"
// site is asserted to fire ONLY for the "published" A7 outcome — never for
// "superseded" or "not_owned" — mirroring jobRunner.test.ts/
// jobRunnerDispatcher.test.ts's established mocked-DB conventions.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// Module-load-time env overrides — must be set before the dynamic import in
// beforeAll (see jobRunner.test.ts's identical top-of-file note: a static
// import hoists above these, a dynamic one does not).
process.env.SOLVE_TERM_GRACE_MS = "10";
process.env.SOLVE_TIMEOUT_GRACE_MS = "50";
process.env.SOLVE_HEARTBEAT_INTERVAL_MS = "20000"; // long enough it never fires mid-test

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  solveJobsTable: { id: "id", scenarioId: "scenario_id", userId: "user_id", status: "status", claimGeneration: "claim_generation" },
  scenariosTable: { id: "id", userId: "user_id", latestSolveJobId: "latest_solve_job_id", solveInputRevision: "solve_input_revision" },
  resultCacheTable: { inputsHash: "inputs_hash", modelId: "model_id", result: "result" },
}));

const mockSpawn = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() =>
  vi.fn(() => ({ status: 0, stdout: JSON.stringify({ pulpVersion: "3.3.2", cbcPath: "/bin/sh" }), stderr: "" })),
);
vi.mock("child_process", () => ({ spawn: mockSpawn, spawnSync: mockSpawnSync }));

// A12 — the two telemetry sinks this whole file exists to verify. Mocked at
// the module boundary so every jobRunner.ts call site's EXACT arguments are
// observable, independent of either sink's own internal behavior (posthog.ts
// / sentry.ts are unit-tested separately).
const mockPosthogCapture = vi.hoisted(() => vi.fn());
vi.mock("../lib/posthog.js", () => ({ posthog: { capture: mockPosthogCapture } }));

const mockCaptureSolveFailure = vi.hoisted(() => vi.fn());
vi.mock("../lib/sentry.js", () => ({ captureSolveFailure: mockCaptureSolveFailure }));

function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "insert", "values", "returning", "update", "set", "onConflictDoNothing"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => Promise.resolve(returnValue).then(resolve);
  return chain;
}

function makeRejectingChain(err: unknown) {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "insert", "values", "returning", "update", "set", "onConflictDoNothing"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (_resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.reject(err).catch((e) => { if (reject) reject(e); else throw e; });
  return chain;
}

let nextFakePid = 9000;
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
  mockDb.select.mockReturnValue(makeChain([])); // default: cache miss
  mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb));
  killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
});

afterEach(() => {
  vi.useRealTimers();
  killSpy.mockRestore();
});

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

// Every posthog capture's `properties` object, across every "failed" site,
// must contain ONLY these keys — asserted with a literal key-set check
// (Object.keys) rather than toMatchObject, so an accidental future
// `reason`/`failureReason`/`errorDetail` addition fails loudly.
function assertBoundedFailedProperties(properties: Record<string, unknown>, expectedErrorCode: string) {
  expect(Object.keys(properties).sort()).toEqual(["error_code", "job_id", "model_id", "scenario_id"]);
  expect(properties.error_code).toBe(expectedErrorCode);
}

describe("A12 — 'scenario solve failed' PostHog + Sentry emission sites", () => {
  it("version-mismatch claim failure: bounded error_code only to PostHog, closed taxonomy (no errorDetail) to Sentry", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const claimChain = makeChain([{ id: 1, recoveryContractIdentity: "f".repeat(64) }]);
    mockDb.update
      .mockReturnValueOnce(claimChain) // claimJobRow — deliberately WRONG identity
      .mockReturnValue(makeChain([{}])); // the version-mismatch markFailed write

    await mod.enqueueSolveJob(1, "user-1", baseInput);

    await vi.waitFor(() => expect(mockPosthogCapture).toHaveBeenCalled());
    expect(mockSpawn).not.toHaveBeenCalled(); // fails BEFORE ever spawning

    expect(mockPosthogCapture).toHaveBeenCalledTimes(1);
    const [call] = mockPosthogCapture.mock.calls;
    expect(call[0].event).toBe("scenario solve failed");
    assertBoundedFailedProperties(call[0].properties, "SOLVE_FAILED");

    expect(mockCaptureSolveFailure).toHaveBeenCalledTimes(1);
    expect(mockCaptureSolveFailure).toHaveBeenCalledWith({
      failureReason: "data_error",
      failureStage: "validate",
      errorDetail: null,
    });
  });

  it("timeout: PostHog gets error_code TIMEOUT, Sentry gets failureReason/failureStage timeout with no errorDetail", async () => {
    mockGroupDiesImmediately();
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child = new FakeChild(); // never emits "close" — simulates a hang
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", { ...baseInput, inputs: { ...baseInput.inputs, timeLimitSec: 1 } });

    await vi.waitFor(() => expect(mockPosthogCapture).toHaveBeenCalled(), { timeout: 5000 });

    expect(mockPosthogCapture).toHaveBeenCalledTimes(1);
    const [call] = mockPosthogCapture.mock.calls;
    expect(call[0].event).toBe("scenario solve failed");
    assertBoundedFailedProperties(call[0].properties, "TIMEOUT");

    expect(mockCaptureSolveFailure).toHaveBeenCalledWith({
      failureReason: "timeout",
      failureStage: "timeout",
      errorDetail: null,
    });
  });

  it("interrupted (cancelJob): PostHog gets error_code SOLVE_FAILED, Sentry gets failureStage null", async () => {
    mockGroupDiesImmediately();
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    const jobId = await mod.enqueueSolveJob(1, "user-1", { ...baseInput, inputs: { ...baseInput.inputs, timeLimitSec: 30 } });
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    expect(mod.cancelJob(jobId, "internal")).toBe(true);

    await vi.waitFor(() => expect(mockPosthogCapture).toHaveBeenCalled());

    expect(mockPosthogCapture).toHaveBeenCalledTimes(1);
    const [call] = mockPosthogCapture.mock.calls;
    expect(call[0].event).toBe("scenario solve failed");
    assertBoundedFailedProperties(call[0].properties, "SOLVE_FAILED");

    expect(mockCaptureSolveFailure).toHaveBeenCalledWith({
      failureReason: "interrupted",
      failureStage: null,
      errorDetail: null,
    });
  });

  it("failed outcome with NO real fd3 failure message (protocol/invalid): errorDetail stays null end-to-end", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    // Malformed fd3 payload (not valid JSON) + exit 0 -> classifyFd3Message
    // "invalid" -> classifyTerminal TT-7 -> failureReason internal_error /
    // failureStage protocol, no real SolverFailure message to carry a detail.
    child.fd3.emit("data", Buffer.from("not json\n"));
    child.emit("close", 0);

    await vi.waitFor(() => expect(mockPosthogCapture).toHaveBeenCalled());

    const [call] = mockPosthogCapture.mock.calls;
    assertBoundedFailedProperties(call[0].properties, "SOLVE_FAILED");
    expect(mockCaptureSolveFailure).toHaveBeenCalledWith({
      failureReason: "internal_error",
      failureStage: "protocol",
      errorDetail: null,
    });
  });

  it("failed outcome carrying a REAL fd3 SolverFailure message: its errorDetail is forwarded verbatim to Sentry (allowlist filtering itself is sentry.ts's job)", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update.mockReturnValue(makeChain([{}]));

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    // TT-5 — a genuine, schema-valid failure message wins over exit 0.
    emitFd3(child, {
      failureReason: "solver_error",
      failureStage: "cbc_parse",
      errorDetail: { line: 12, code: "unparseable_incumbent" },
    });
    child.emit("close", 0);

    await vi.waitFor(() => expect(mockPosthogCapture).toHaveBeenCalled());

    const [call] = mockPosthogCapture.mock.calls;
    // PostHog stays bounded to error_code ONLY, even though a real
    // errorDetail exists — it never reaches the product sink.
    assertBoundedFailedProperties(call[0].properties, "SOLVE_FAILED");
    expect(JSON.stringify(call[0].properties)).not.toContain("unparseable_incumbent");

    expect(mockCaptureSolveFailure).toHaveBeenCalledWith({
      failureReason: "solver_error",
      failureStage: "cbc_parse",
      errorDetail: { line: 12, code: "unparseable_incumbent" },
    });
  });

  it("the catch-all unexpected-exception path (previously ZERO telemetry) now emits both, with the fixed internal_error/spawn taxonomy — never the raw caught exception", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    // claim succeeds; the NEXT db.transaction call (markSucceeded, reached
    // via a fresh-solve success outcome) throws — simulating an unexpected
    // exception between a defined solver outcome and its own terminal write.
    // The markFailed() write that follows in the outer catch is a THIRD,
    // separate db.update call (never touches db.transaction).
    mockDb.update.mockReturnValue(makeChain([{}]));
    mockDb.transaction.mockImplementationOnce(async () => {
      throw new Error("simulated unexpected failure with a /fake/local/path in its message");
    });

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    emitFd3(child, SUCCESS_ENVELOPE);
    child.emit("close", 0);

    await vi.waitFor(() => expect(mockPosthogCapture).toHaveBeenCalled());

    expect(mockPosthogCapture).toHaveBeenCalledTimes(1);
    const [call] = mockPosthogCapture.mock.calls;
    expect(call[0].event).toBe("scenario solve failed");
    assertBoundedFailedProperties(call[0].properties, "SOLVE_FAILED");
    // The caught exception's own message (which could carry a path) must
    // never appear anywhere in either sink's payload.
    expect(JSON.stringify(call[0].properties)).not.toContain("/fake/local/path");

    expect(mockCaptureSolveFailure).toHaveBeenCalledTimes(1);
    expect(mockCaptureSolveFailure).toHaveBeenCalledWith({
      failureReason: "internal_error",
      failureStage: "spawn",
      errorDetail: null,
    });
    expect(JSON.stringify(mockCaptureSolveFailure.mock.calls[0])).not.toContain("/fake/local/path");
  });
});

describe("A12 — 'scenario solve completed' fires ONLY for the published A7 outcome", () => {
  it("fresh solve, published: PostHog fires with the existing property shape; Sentry is never called", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const jobRowChain = makeChain([{ id: 1 }]);
    const scenarioRowChain = makeChain([{ id: 1 }]); // non-empty -> published
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // claimJobRow
      .mockReturnValueOnce(jobRowChain) // markSucceeded job-row update
      .mockReturnValueOnce(scenarioRowChain); // markSucceeded scenario-row update

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    emitFd3(child, SUCCESS_ENVELOPE);
    child.emit("close", 0);

    await vi.waitFor(() => expect(mockPosthogCapture).toHaveBeenCalled());

    expect(mockPosthogCapture).toHaveBeenCalledTimes(1);
    const [call] = mockPosthogCapture.mock.calls;
    expect(call[0].event).toBe("scenario solve completed");
    expect(Object.keys(call[0].properties).sort()).toEqual(
      ["cache_hit", "job_id", "model_id", "objective", "published", "run_time_sec", "scenario_id", "status"].sort(),
    );
    expect(call[0].properties.published).toBe(true);
    expect(call[0].properties.cache_hit).toBe(false);
    expect(mockCaptureSolveFailure).not.toHaveBeenCalled();
  });

  it("fresh solve, SUPERSEDED (scenario CAS lost): NO 'scenario solve completed' event at all", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // claimJobRow
      .mockReturnValueOnce(makeChain([{ id: 1 }])) // markSucceeded job-row update succeeds
      .mockReturnValueOnce(makeChain([])); // markSucceeded scenario-row update: ZERO rows -> superseded

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    emitFd3(child, SUCCESS_ENVELOPE);
    child.emit("close", 0);

    // Give the async publication path time to run to completion before
    // asserting a negative.
    await vi.waitFor(() => expect(mockDb.transaction).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));

    expect(mockPosthogCapture).not.toHaveBeenCalled();
  });

  it("fresh solve, NOT_OWNED (lease already lost): NO 'scenario solve completed' event at all", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // claimJobRow
      .mockReturnValueOnce(makeChain([])); // markSucceeded job-row update: ZERO rows -> not_owned (scenario update never even attempted)

    const child = new FakeChild();
    mockSpawn.mockReturnValue(child);

    await mod.enqueueSolveJob(1, "user-1", baseInput);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

    emitFd3(child, SUCCESS_ENVELOPE);
    child.emit("close", 0);

    await vi.waitFor(() => expect(mockDb.transaction).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));

    expect(mockPosthogCapture).not.toHaveBeenCalled();
  });

  it("cache hit, published: 'scenario solve completed' fires with cache_hit:true, never spawns the solver", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const cachedEnvelope = {
      status: "optimal", solutionStatus: "optimal", terminationReason: "optimality_proven",
      objective: 42, runTimeSec: 0.2, quality: "Optimal",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    };
    mockDb.select.mockReturnValueOnce(makeChain([{ inputsHash: "h", modelId: "p-median-us", result: cachedEnvelope }]));
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // claimJobRow
      .mockReturnValueOnce(makeChain([{ id: 1 }])) // markSucceeded job-row update
      .mockReturnValueOnce(makeChain([{ id: 1 }])); // markSucceeded scenario-row update -> published

    await mod.enqueueSolveJob(1, "user-1", baseInput);

    await vi.waitFor(() => expect(mockPosthogCapture).toHaveBeenCalled());
    expect(mockSpawn).not.toHaveBeenCalled();

    const [call] = mockPosthogCapture.mock.calls;
    expect(call[0].event).toBe("scenario solve completed");
    expect(call[0].properties.cache_hit).toBe(true);
    expect(call[0].properties.published).toBe(true);
    expect(call[0].properties.objective).toBe(42);
  });

  it("cache hit, SUPERSEDED: NO 'scenario solve completed' event", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ id: 1 }]));
    const cachedEnvelope = {
      status: "optimal", solutionStatus: "optimal", terminationReason: "optimality_proven",
      objective: 42, runTimeSec: 0.2, quality: "Optimal",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    };
    mockDb.select.mockReturnValueOnce(makeChain([{ inputsHash: "h", modelId: "p-median-us", result: cachedEnvelope }]));
    mockDb.update
      .mockReturnValueOnce(makeChain([{}])) // claimJobRow
      .mockReturnValueOnce(makeChain([{ id: 1 }])) // markSucceeded job-row update
      .mockReturnValueOnce(makeChain([])); // markSucceeded scenario-row update: superseded

    await mod.enqueueSolveJob(1, "user-1", baseInput);

    await vi.waitFor(() => expect(mockDb.transaction).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));

    expect(mockPosthogCapture).not.toHaveBeenCalled();
  });
});
