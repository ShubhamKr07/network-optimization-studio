import { describe, it, expect } from "vitest";
import { presentResultForRead, isLegacyUnverifiedResult } from "../routes/scenarios.js";
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

  it("a post-B2 stored row (already has a solutionStatus key) is representable as StoredScenarioResult and normalizes to v1 — but is NOT legacy-unverified (A-fix F1b)", () => {
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
    // NOT distinguishable from B-unversioned SHAPE-wise — normalizeStoredResult
    // still normalizes it to the v1 (envelopeVersion:1) discriminated shape.
    expect(normalized.envelopeVersion).toBe(1);
    // A-fix (F1b) — but it DOES carry a real solutionStatus/terminationReason
    // (Bundle B already made this row truthful), so it is legacyUnverified:
    // false — only a GENUINELY pre-B row (neither field ever set) is true.
    expect((normalized as { legacyUnverified: boolean }).legacyUnverified).toBe(false);
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

  // A8 (SCND Correctness) — isLegacyUnverifiedResult() is the exact
  // discriminator routes/scenarios.ts's output-entity export 409 gate and
  // routes/solveHistory.ts's legacyUnverified marker both key off (directly,
  // for the export gate; indirectly via the same underlying
  // normalizeStoredResult() call, for solve history). Unit-level coverage
  // here complements the HTTP-level tests in routes.test.ts.
  describe("isLegacyUnverifiedResult() (A8)", () => {
    it("a post-B2 row with a real solutionStatus key is NOT legacy-unverified (A-fix F1b) — a truthful B row is safe to export/un-badge even without a genuine envelopeVersion:2", () => {
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
      expect(isLegacyUnverifiedResult(postB2Row as unknown as Record<string, unknown>)).toBe(false);
    });

    it("a pre-B2 row with no solutionStatus key at all is legacy-unverified", () => {
      const preB2Row = {
        status: "optimal", objective: 250, runTimeSec: 0.3, quality: "Optimal",
        edges: [], metrics: {}, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
      };
      expect(isLegacyUnverifiedResult(preB2Row)).toBe(true);
    });

    it("a genuine v2 published result (envelopeVersion:2) is NOT legacy-unverified", () => {
      const v2Row = {
        envelopeVersion: 2, status: "optimal", solutionStatus: "optimal",
        terminationReason: "optimality_proven", achievedGap: 0,
        solverIncumbentObjective: 250, solverBestBound: 250, objective: 250,
        runTimeSec: 0.3, quality: "Proven optimal", edges: [], metrics: {}, details: {},
        solverUsed: "CBC (PuLP)", infeasibilityReason: null,
        requestedGap: null, requestedGapSource: null,
        requestedTimeLimitSec: null, requestedTimeLimitSource: null,
        legacyUnverified: false,
      };
      expect(isLegacyUnverifiedResult(v2Row)).toBe(false);
    });

    it("null / a structurally invalid value is conservatively legacy-unverified, never a throw", () => {
      expect(isLegacyUnverifiedResult(null)).toBe(true);
      expect(isLegacyUnverifiedResult({ not: "a valid envelope" })).toBe(true);
    });
  });
});
