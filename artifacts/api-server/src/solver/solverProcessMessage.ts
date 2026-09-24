import { z } from "zod";
import { EdgeSchema, MetricsSchema } from "./resultEnvelope.js";

// ---------------------------------------------------------------------------
// A3 — the fd3 IPC contract between solve.py (producer) and jobRunner.ts
// (reader). PRIVATE (server-side only) — A4 adds the *public* shapes and
// reuses these; do not export this module from anything customer-facing.
//
// The message solve.py writes on fd 3 is exactly ONE newline-terminated JSON
// object, and it is a success-envelope XOR a failure object — never both,
// never neither. `status:"error"` is no longer a valid outcome that crosses
// the process boundary as a "success": every current `_load_error_envelope`/
// dispatch-error/top-level-exception path in solve.py now writes a FAILURE
// message instead (see solve.py's `__main__`), so `SolverSuccessEnvelopeV2`
// below deliberately excludes "error" from its status/solutionStatus enums —
// a real success envelope can only ever report a genuine solver outcome.
// ---------------------------------------------------------------------------

// Mirrors resultEnvelope.ts's SolutionStatusSchema minus the legacy "error"
// sentinel — a v2 success envelope can never carry it (that's the whole
// point of the fd3 split: "error" is now always a FAILURE message, never an
// envelope).
export const V2SolutionStatusSchema = z.enum([
  "optimal",
  "feasible",
  "infeasible",
  "unbounded",
  "no_solution",
]);

export const V2TerminationReasonSchema = z.enum([
  "optimality_proven",
  "gap_limit",
  "time_limit",
  "node_limit",
  "infeasible",
  "unbounded",
  "unknown",
]);

// Superset of today's (pre-A3) ResultEnvelopeSchema — same fields, B's
// truthful-status fields already included, "error" excluded from both status
// enums per the note above. A4 may add v2-only fields later; this schema is
// the single place that grows.
export const SolverSuccessEnvelopeV2Schema = z.object({
  status: z.enum(["optimal", "infeasible", "feasible", "no_solution", "unbounded"]),
  solutionStatus: V2SolutionStatusSchema.nullable().optional(),
  terminationReason: V2TerminationReasonSchema.nullable().optional(),
  achievedGap: z.number().nullable().optional(),
  solverIncumbentObjective: z.number().nullable().optional(),
  solverBestBound: z.number().nullable().optional(),
  objective: z.number(),
  runTimeSec: z.number(),
  quality: z.string(),
  edges: z.array(EdgeSchema),
  metrics: MetricsSchema,
  details: z.record(z.string(), z.unknown()),
  solverUsed: z.string(),
  infeasibilityReason: z.string().nullable(),
});

export type SolverSuccessEnvelopeV2 = z.infer<typeof SolverSuccessEnvelopeV2Schema>;

// ---------------------------------------------------------------------------
// Failure branch. `errorDetail` is STRUCTURED and ALLOWLISTED — solve.py
// never puts raw stdout/stderr, raw exception text, or a filesystem path
// into it (see solve.py's `_failure()` helper). Node's own synthetic
// failures (timeout/protocol/spawn/exit classifications — nothing on fd3 at
// all in those cases) construct the same shape locally, never surfacing raw
// diagnostics either.
// ---------------------------------------------------------------------------

export const SolverFailureReasonSchema = z.enum(["internal_error", "solver_error"]);

// A closed, reviewed set — not free text. Extend this enum deliberately, the
// same way solve.py's own dataset/error paths are enumerated, rather than
// letting an arbitrary string cross the process boundary.
export const SolverFailureStageSchema = z.enum([
  "timeout",
  "spawn",
  "protocol",
  "exit",
  "dataset_load",
  "dispatch",
  "input_parse",
  "solve_exception",
  "cbc_parse",
]);

const MAX_ERROR_DETAIL_BYTES = 2048;

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

export const SolverFailureSchema = z.object({
  failureReason: SolverFailureReasonSchema,
  failureStage: SolverFailureStageSchema,
  errorDetail: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .refine((v) => v == null || byteLength(v) <= MAX_ERROR_DETAIL_BYTES, {
      message: `errorDetail exceeds ${MAX_ERROR_DETAIL_BYTES} bytes`,
    }),
});

export type SolverFailure = z.infer<typeof SolverFailureSchema>;

// The full union — mostly useful for documentation/A4; the reader below does
// its own shape-detection first (so "both"/"neither" get a real diagnosis
// instead of a generic union-parse failure).
export const SolverProcessMessageSchema = z.union([SolverSuccessEnvelopeV2Schema, SolverFailureSchema]);
export type SolverProcessMessage = z.infer<typeof SolverProcessMessageSchema>;

// ---------------------------------------------------------------------------
// fd3 raw-text classification (the A3.T table's "M" dimension). Pure — takes
// already-read text plus whether the reader gave up early because of the
// size cap, never touches the filesystem/process itself.
// ---------------------------------------------------------------------------

export type Fd3MessageClassification =
  | { kind: "success"; envelope: SolverSuccessEnvelopeV2 }
  | { kind: "failure"; failure: SolverFailure }
  | { kind: "missing" }
  | { kind: "partial" }
  | { kind: "oversize" }
  | { kind: "invalid"; reason: string }
  | { kind: "both" }
  | { kind: "neither" };

export function classifyFd3Message(input: { raw: string; oversize: boolean }): Fd3MessageClassification {
  if (input.oversize) return { kind: "oversize" };
  if (input.raw.length === 0) return { kind: "missing" };
  if (!input.raw.endsWith("\n")) return { kind: "partial" };

  const lines = input.raw.split("\n").filter((l) => l.length > 0);
  if (lines.length !== 1) return { kind: "partial" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0]!);
  } catch (e) {
    return { kind: "invalid", reason: e instanceof Error ? e.message : "JSON parse error" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "invalid", reason: "message is not a JSON object" };
  }

  const rec = parsed as Record<string, unknown>;
  const hasEnvelopeShape = "edges" in rec && "status" in rec && "objective" in rec;
  const hasFailureShape = "failureReason" in rec;

  if (hasEnvelopeShape && hasFailureShape) return { kind: "both" };
  if (!hasEnvelopeShape && !hasFailureShape) return { kind: "neither" };

  if (hasEnvelopeShape) {
    const result = SolverSuccessEnvelopeV2Schema.safeParse(rec);
    if (!result.success) return { kind: "invalid", reason: result.error.message };
    return { kind: "success", envelope: result.data };
  }

  const result = SolverFailureSchema.safeParse(rec);
  if (!result.success) return { kind: "invalid", reason: result.error.message };
  return { kind: "failure", failure: result.data };
}

// ---------------------------------------------------------------------------
// A3.T — the normative terminal state machine. Precedence, evaluated once:
// T (timeout) > C (cancel) > (X x M) (exit code x message). Cleanup outcome
// (K) never changes classification — see runJob's separate cleanup step.
// ---------------------------------------------------------------------------

export type TerminalOutcome =
  | { kind: "timeout"; diagnostic: string }
  | { kind: "interrupted"; diagnostic: string }
  | { kind: "success"; envelope: SolverSuccessEnvelopeV2; diagnostic: string }
  | { kind: "failed"; failureReason: z.infer<typeof SolverFailureReasonSchema>; failureStage: z.infer<typeof SolverFailureStageSchema>; diagnostic: string };

export interface ClassifyTerminalInput {
  timedOut: boolean;
  cancelled: boolean;
  /** null only when the process never spawned at all (TT-14). */
  spawnFailed: boolean;
  /** exit code; null if the process was killed by a signal without our own timeout/cancel firing (treated as a nonzero-exit-equivalent). */
  exitCode: number | null;
  message: Fd3MessageClassification;
}

export function classifyTerminal(input: ClassifyTerminalInput): TerminalOutcome {
  // T > C > (X x M) — evaluated once, in this fixed order.
  if (input.timedOut) {
    return { kind: "timeout", diagnostic: "failureStage=timeout; late events dropped" }; // TT-1
  }
  if (input.cancelled) {
    return { kind: "interrupted", diagnostic: "cancellation source recorded" }; // TT-2
  }
  if (input.spawnFailed) {
    return {
      kind: "failed",
      failureReason: "internal_error",
      failureStage: "spawn",
      diagnostic: "internal_error/spawn", // TT-14
    };
  }

  const m = input.message;
  const exitedZero = input.exitCode === 0;

  if (exitedZero) {
    if (m.kind === "success") {
      return { kind: "success", envelope: m.envelope, diagnostic: "exit=0, valid success" }; // TT-3/TT-4
    }
    if (m.kind === "failure") {
      return {
        kind: "failed",
        failureReason: m.failure.failureReason,
        failureStage: m.failure.failureStage,
        diagnostic: "valid failure wins over exit zero", // TT-5
      };
    }
    if (m.kind === "missing") {
      return {
        kind: "failed",
        failureReason: "internal_error",
        failureStage: "protocol",
        diagnostic: "internal_error/protocol (missing message)", // TT-6
      };
    }
    if (m.kind === "partial" || m.kind === "oversize" || m.kind === "invalid") {
      return {
        kind: "failed",
        failureReason: "internal_error",
        failureStage: "protocol",
        diagnostic: `internal_error/protocol (${m.kind})`, // TT-7
      };
    }
    // m.kind === "both" | "neither"
    return {
      kind: "failed",
      failureReason: "internal_error",
      failureStage: "protocol",
      diagnostic: `internal_error/protocol (${m.kind})`, // TT-8
    };
  }

  // Nonzero exit (or null exit code without timeout/cancel/spawn-failure —
  // treated identically: the process ended abnormally without a decisive
  // signal from us).
  if (m.kind === "success") {
    return {
      kind: "failed",
      failureReason: "internal_error",
      failureStage: "exit",
      diagnostic: "success msg + nonzero exit never publishes; internal_error/exit", // TT-9
    };
  }
  if (m.kind === "failure") {
    return {
      kind: "failed",
      failureReason: m.failure.failureReason,
      failureStage: m.failure.failureStage,
      diagnostic: "message classifies", // TT-10
    };
  }
  return {
    kind: "failed",
    failureReason: "solver_error",
    failureStage: "exit",
    diagnostic: `solver_error/exit (${m.kind})`, // TT-11
  };
}
