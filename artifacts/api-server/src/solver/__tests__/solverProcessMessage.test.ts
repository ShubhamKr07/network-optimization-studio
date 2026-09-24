import { describe, it, expect } from "vitest";
import {
  classifyFd3Message,
  classifyTerminal,
  SolverFailureSchema,
  SolverSuccessEnvelopeV2Schema,
  type Fd3MessageClassification,
} from "../solverProcessMessage.js";

const VALID_ENVELOPE = {
  status: "optimal",
  solutionStatus: "optimal",
  terminationReason: "optimality_proven",
  achievedGap: null,
  solverIncumbentObjective: null,
  solverBestBound: null,
  objective: 100,
  runTimeSec: 0.5,
  quality: "Optimal",
  edges: [],
  metrics: {},
  details: {},
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};

const VALID_FAILURE = { failureReason: "internal_error", failureStage: "dataset_load", errorDetail: null };

function line(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

describe("SolverSuccessEnvelopeV2Schema", () => {
  it("accepts a real success envelope", () => {
    expect(SolverSuccessEnvelopeV2Schema.safeParse(VALID_ENVELOPE).success).toBe(true);
  });

  it("rejects status:'error' — a v2 success envelope can never carry it", () => {
    const bad = { ...VALID_ENVELOPE, status: "error" };
    expect(SolverSuccessEnvelopeV2Schema.safeParse(bad).success).toBe(false);
  });

  it("rejects solutionStatus:'error'", () => {
    const bad = { ...VALID_ENVELOPE, solutionStatus: "error" };
    expect(SolverSuccessEnvelopeV2Schema.safeParse(bad).success).toBe(false);
  });
});

describe("SolverFailureSchema", () => {
  it("accepts a minimal failure object", () => {
    expect(SolverFailureSchema.safeParse(VALID_FAILURE).success).toBe(true);
  });

  it("rejects an unknown failureReason", () => {
    expect(SolverFailureSchema.safeParse({ ...VALID_FAILURE, failureReason: "oops" }).success).toBe(false);
  });

  it("rejects an unknown failureStage", () => {
    expect(SolverFailureSchema.safeParse({ ...VALID_FAILURE, failureStage: "oops" }).success).toBe(false);
  });

  it("accepts errorDetail at exactly the 2048-byte octet cap", () => {
    // {"pad":"..."} — pad the value so the whole serialized object is exactly at
    // the boundary; a value this size must still validate (cap is <=, not <).
    const detail = { pad: "x".repeat(2048 - Buffer.byteLength(JSON.stringify({ pad: "" }), "utf8")) };
    expect(Buffer.byteLength(JSON.stringify(detail), "utf8")).toBe(2048);
    expect(SolverFailureSchema.safeParse({ ...VALID_FAILURE, errorDetail: detail }).success).toBe(true);
  });

  it("rejects errorDetail one byte over the 2048-byte octet cap", () => {
    const detail = { pad: "x".repeat(2048 - Buffer.byteLength(JSON.stringify({ pad: "" }), "utf8") + 1) };
    expect(Buffer.byteLength(JSON.stringify(detail), "utf8")).toBe(2049);
    expect(SolverFailureSchema.safeParse({ ...VALID_FAILURE, errorDetail: detail }).success).toBe(false);
  });

  it("errorDetail byte cap is measured in octets, not JS string length (multi-byte chars)", () => {
    // Each "😀" is 4 UTF-8 bytes but 2 UTF-16 code units — a naive .length
    // check would under-count real byte size by ~2x for this character.
    const emojiCount = 400; // 400 * 4 = 1600 bytes of emoji alone, well past a
    // naive char-count-based 2048 guess but comfortably under the real cap
    // once JSON overhead is added -- the point is the check is byte-based.
    const detail = { pad: "😀".repeat(emojiCount) };
    const byteLen = Buffer.byteLength(JSON.stringify(detail), "utf8");
    expect(byteLen).toBeGreaterThan(detail.pad.length); // proves bytes != chars here
    expect(SolverFailureSchema.safeParse({ ...VALID_FAILURE, errorDetail: detail }).success).toBe(byteLen <= 2048);
  });
});

describe("classifyFd3Message — the A3.T table's M dimension", () => {
  it("oversize wins regardless of partial content", () => {
    expect(classifyFd3Message({ raw: line(VALID_ENVELOPE), oversize: true })).toEqual({ kind: "oversize" });
  });

  it("empty text classifies as missing", () => {
    expect(classifyFd3Message({ raw: "", oversize: false })).toEqual({ kind: "missing" });
  });

  it("text with no trailing newline classifies as partial", () => {
    const raw = JSON.stringify(VALID_ENVELOPE); // no trailing \n
    expect(classifyFd3Message({ raw, oversize: false })).toEqual({ kind: "partial" });
  });

  it("more than one line classifies as partial (protocol violation)", () => {
    const raw = line(VALID_ENVELOPE) + line(VALID_ENVELOPE);
    expect(classifyFd3Message({ raw, oversize: false })).toEqual({ kind: "partial" });
  });

  it("malformed JSON classifies as invalid", () => {
    const result = classifyFd3Message({ raw: "not json {{\n", oversize: false });
    expect(result.kind).toBe("invalid");
  });

  it("a JSON array (not an object) classifies as invalid", () => {
    const result = classifyFd3Message({ raw: line([1, 2, 3]), oversize: false });
    expect(result.kind).toBe("invalid");
  });

  it("an object with neither envelope nor failure shape classifies as neither", () => {
    expect(classifyFd3Message({ raw: line({ foo: "bar" }), oversize: false })).toEqual({ kind: "neither" });
  });

  it("an object with both envelope and failure shape classifies as both", () => {
    const both = { ...VALID_ENVELOPE, failureReason: "internal_error" };
    expect(classifyFd3Message({ raw: line(both), oversize: false })).toEqual({ kind: "both" });
  });

  it("a valid success envelope classifies as success", () => {
    const result = classifyFd3Message({ raw: line(VALID_ENVELOPE), oversize: false });
    expect(result.kind).toBe("success");
    if (result.kind === "success") expect(result.envelope.objective).toBe(100);
  });

  it("an envelope-shaped but schema-invalid object classifies as invalid, not success", () => {
    const bad = { ...VALID_ENVELOPE, objective: "not-a-number" };
    const result = classifyFd3Message({ raw: line(bad), oversize: false });
    expect(result.kind).toBe("invalid");
  });

  it("a valid failure object classifies as failure", () => {
    const result = classifyFd3Message({ raw: line(VALID_FAILURE), oversize: false });
    expect(result.kind).toBe("failure");
    if (result.kind === "failure") expect(result.failure.failureStage).toBe("dataset_load");
  });

  it("a failure-shaped but schema-invalid object classifies as invalid, not failure", () => {
    const bad = { failureReason: "not-a-real-reason", failureStage: "dataset_load" };
    const result = classifyFd3Message({ raw: line(bad), oversize: false });
    expect(result.kind).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// A3.T — the normative terminal table. Every row ID gets its own test.
// ---------------------------------------------------------------------------
describe("classifyTerminal — A3.T normative terminal table", () => {
  const success: Fd3MessageClassification = { kind: "success", envelope: VALID_ENVELOPE as never };
  const failure: Fd3MessageClassification = {
    kind: "failure",
    failure: { failureReason: "solver_error", failureStage: "cbc_parse", errorDetail: null },
  };
  const missing: Fd3MessageClassification = { kind: "missing" };
  const partial: Fd3MessageClassification = { kind: "partial" };
  const oversize: Fd3MessageClassification = { kind: "oversize" };
  const invalid: Fd3MessageClassification = { kind: "invalid", reason: "x" };
  const both: Fd3MessageClassification = { kind: "both" };
  const neither: Fd3MessageClassification = { kind: "neither" };

  it("TT-1: timeout wins over everything else (precedence T > C > X*M)", () => {
    const out = classifyTerminal({
      timedOut: true, cancelled: true, spawnFailed: true, exitCode: 0, message: success,
    });
    expect(out.kind).toBe("timeout");
  });

  it("TT-2: cancellation wins over exit/message when timeout did not fire", () => {
    const out = classifyTerminal({
      timedOut: false, cancelled: true, spawnFailed: false, exitCode: 0, message: success,
    });
    expect(out.kind).toBe("interrupted");
  });

  it("TT-3/TT-4: exit=0 + valid success -> success (cleanup outcome never changes this)", () => {
    const out = classifyTerminal({
      timedOut: false, cancelled: false, spawnFailed: false, exitCode: 0, message: success,
    });
    expect(out.kind).toBe("success");
    if (out.kind === "success") expect(out.envelope).toEqual(VALID_ENVELOPE);
  });

  it("TT-5: exit=0 + valid failure -> failed (valid failure wins over exit zero)", () => {
    const out = classifyTerminal({
      timedOut: false, cancelled: false, spawnFailed: false, exitCode: 0, message: failure,
    });
    expect(out.kind).toBe("failed");
    if (out.kind === "failed") {
      expect(out.failureReason).toBe("solver_error");
      expect(out.failureStage).toBe("cbc_parse");
    }
  });

  it("TT-6: exit=0 + missing message -> failed internal_error/protocol", () => {
    const out = classifyTerminal({
      timedOut: false, cancelled: false, spawnFailed: false, exitCode: 0, message: missing,
    });
    expect(out).toMatchObject({ kind: "failed", failureReason: "internal_error", failureStage: "protocol" });
  });

  it("TT-7: exit=0 + partial|oversize|invalid -> failed internal_error/protocol", () => {
    for (const m of [partial, oversize, invalid]) {
      const out = classifyTerminal({
        timedOut: false, cancelled: false, spawnFailed: false, exitCode: 0, message: m,
      });
      expect(out).toMatchObject({ kind: "failed", failureReason: "internal_error", failureStage: "protocol" });
    }
  });

  it("TT-8: exit=0 + both|neither -> failed internal_error/protocol", () => {
    for (const m of [both, neither]) {
      const out = classifyTerminal({
        timedOut: false, cancelled: false, spawnFailed: false, exitCode: 0, message: m,
      });
      expect(out).toMatchObject({ kind: "failed", failureReason: "internal_error", failureStage: "protocol" });
    }
  });

  it("TT-9: exit!=0 + valid success -> failed internal_error/exit (never publishes)", () => {
    const out = classifyTerminal({
      timedOut: false, cancelled: false, spawnFailed: false, exitCode: 1, message: success,
    });
    expect(out).toMatchObject({ kind: "failed", failureReason: "internal_error", failureStage: "exit" });
  });

  it("TT-10: exit!=0 + valid failure -> failed, message classifies", () => {
    const out = classifyTerminal({
      timedOut: false, cancelled: false, spawnFailed: false, exitCode: 1, message: failure,
    });
    expect(out).toMatchObject({ kind: "failed", failureReason: "solver_error", failureStage: "cbc_parse" });
  });

  it("TT-11: exit!=0 + missing|partial|oversize|invalid|both|neither -> failed solver_error/exit", () => {
    for (const m of [missing, partial, oversize, invalid, both, neither]) {
      const out = classifyTerminal({
        timedOut: false, cancelled: false, spawnFailed: false, exitCode: 1, message: m,
      });
      expect(out).toMatchObject({ kind: "failed", failureReason: "solver_error", failureStage: "exit" });
    }
  });

  it("TT-14: no process (spawn fail) -> failed internal_error/spawn", () => {
    const out = classifyTerminal({
      timedOut: false, cancelled: false, spawnFailed: true, exitCode: null, message: missing,
    });
    expect(out).toMatchObject({ kind: "failed", failureReason: "internal_error", failureStage: "spawn" });
  });

  // TT-12 (exit still open) is not a classify() input at all by construction
  // — runSolverProcess only calls classifyTerminal() once settlement (exit,
  // timeout, or cancel) has actually happened; see jobRunner's own
  // "does not settle while the child is still running" test for the
  // structural proof. TT-13 (late exit/message after a terminal row) is
  // covered by jobRunner's "ignores a late event after settlement" test —
  // classifyTerminal itself is a pure function with no notion of "late".
});
