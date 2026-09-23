import { describe, it, expect } from "vitest";
import { presentResultForRead } from "../routes/scenarios.js";
import {
  ResultEnvelopeSchema,
  StoredScenarioResultSchema,
  NormalizedSolveResultSchema,
  normalizeStoredResult,
} from "../solver/resultEnvelope.js";
import { SolverFailureSchema } from "../solver/solverProcessMessage.js";

// A4 (SCND Correctness) — equivalence/invariant tests at
// routes/scenarios.ts's private->public boundary. Production behavior is
// UNCHANGED by this task: toApiScenario()/presentResultForRead() (the
// functions actually wired into every live scenario response) are not
// touched here — see resultEnvelope.ts's header comment for the full scope
// boundary. These tests prove the NEW five-schema contract is a faithful
// superset of what that boundary already produces today, so A8/A9 can wire
// normalizeStoredResult() in later without a representation surprise, and
// that no shape reaching this boundary could ever be mistaken for a
// private failure message.

describe("routes/scenarios.ts's private->public boundary (A4)", () => {
  it("presentResultForRead(null) stays null", () => {
    expect(presentResultForRead(null)).toBeNull();
  });

  it("a post-B2 stored row (already has a solutionStatus key) is representable as StoredScenarioResult and normalizes to v1", () => {
    const postB2Row = ResultEnvelopeSchema.parse({
      status: "optimal",
      solutionStatus: "optimal",
      terminationReason: "optimality_proven",
      achievedGap: 0,
      solverIncumbentObjective: 250,
      solverBestBound: 250,
      objective: 250,
      runTimeSec: 0.3,
      quality: "Optimal",
      edges: [],
      metrics: {},
      details: {},
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: null,
    });
    const presented = presentResultForRead(postB2Row as unknown as Record<string, unknown>)!;
    // presentResultForRead is a no-op here (the key is already present).
    expect(presented).toEqual(postB2Row);

    expect(StoredScenarioResultSchema.safeParse(presented).success).toBe(true);
    const normalized = normalizeStoredResult(StoredScenarioResultSchema.parse(presented));
    expect(NormalizedSolveResultSchema.safeParse(normalized).success).toBe(true);
    // Today's toApiScenario() never writes envelopeVersion, so this row is
    // NOT distinguishable from B-unversioned — normalizeStoredResult
    // correctly treats it as legacy (never promoted to a proven v2 claim
    // it was never actually validated as).
    expect(normalized.envelopeVersion).toBe(1);
    expect((normalized as { legacyUnverified: boolean }).legacyUnverified).toBe(true);
  });

  it("a pre-B2 stored row (NO solutionStatus key at all) is stamped solutionStatus:null by presentResultForRead, and still normalizes cleanly", () => {
    const preB2Row = {
      status: "optimal",
      objective: 250,
      runTimeSec: 0.3,
      quality: "Optimal",
      edges: [],
      metrics: {},
      details: {},
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: null,
    };
    expect("solutionStatus" in preB2Row).toBe(false);

    const presented = presentResultForRead(preB2Row)!;
    expect(presented.solutionStatus).toBeNull();
    expect(presented.terminationReason).toBeNull();

    expect(StoredScenarioResultSchema.safeParse(presented).success).toBe(true);
    const normalized = normalizeStoredResult(StoredScenarioResultSchema.parse(presented));
    expect(NormalizedSolveResultSchema.safeParse(normalized).success).toBe(true);
    expect(normalized.envelopeVersion).toBe(1);
    expect((normalized as { legacyStatus: string }).legacyStatus).toBe("optimal");
    // Never promoted to a proven claim.
    expect((normalized as { quality: string }).quality).not.toMatch(/proven/i);
  });

  it("a scenario's stored/presented result can never structurally satisfy the private failure shape (§2.4 invariant rejection)", () => {
    const infeasibleRow = ResultEnvelopeSchema.parse({
      status: "infeasible",
      objective: 0,
      runTimeSec: 0.1,
      quality: "Infeasible",
      edges: [],
      metrics: {},
      details: {},
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: "no feasible assignment",
    });
    const presented = presentResultForRead(infeasibleRow as unknown as Record<string, unknown>)!;
    expect(SolverFailureSchema.safeParse(presented).success).toBe(false);
    // The route's own persisted-write contract: jobRunner.ts's markSucceeded
    // only ever writes a ResultEnvelope-shaped object derived from
    // toLegacyStoredResult(SUCCESS envelope) — a private FAILURE message is
    // never handed to it (see jobRunner.ts's runJob: the failed/timeout/
    // interrupted branches call markFailed, never markSucceeded). This test
    // asserts the shape-level half of that contract directly.
    const failureFixture = { failureReason: "internal_error", failureStage: "dataset_load", errorDetail: null };
    expect(StoredScenarioResultSchema.safeParse(failureFixture).success).toBe(false);
    expect(NormalizedSolveResultSchema.safeParse(failureFixture).success).toBe(false);
  });
});
