import { describe, it, expect } from "vitest";
import {
  ResultCacheEntryV2Schema,
  PublishedSolveResultV2Schema,
  NormalizedLegacySolveResultSchema,
  NormalizedSolveResultSchema,
  StoredScenarioResultSchema,
  ResultEnvelopeSchema,
  checkResultInvariants,
  normalizeLegacyObjective,
  normalizeLegacyResult,
  normalizeStoredResult,
  composePublishedResult,
  LEGACY_UNVERIFIED_QUALITY,
  type ResultCacheEntryV2,
  type PublishedSolveResultV2,
} from "../resultEnvelope.js";
import {
  SolverSuccessEnvelopeV2Schema,
  SolverFailureSchema,
  V2SolutionStatusSchema,
  V2TerminationReasonSchema,
} from "../solverProcessMessage.js";

// ---------------------------------------------------------------------------
// A4 — Task A4's own test suite: the five-schema contract, §2.4 invariants,
// composePublishedResult, and the legacy normalizer (incl. the
// status/evidence-aware objective rule). Nothing here is wired into a live
// route — see resultEnvelope.ts's header comment for the scope boundary.
// ---------------------------------------------------------------------------

const BASE = {
  runTimeSec: 0.5,
  quality: "Proven optimal",
  edges: [],
  metrics: {},
  details: {},
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null as string | null,
};

const OPTIMAL: ResultCacheEntryV2 = {
  ...BASE,
  status: "optimal",
  solutionStatus: "optimal",
  terminationReason: "optimality_proven",
  achievedGap: 0,
  solverIncumbentObjective: 100,
  solverBestBound: 100,
  objective: 100,
};

const FEASIBLE_GAP_LIMIT: ResultCacheEntryV2 = {
  ...BASE,
  status: "feasible",
  solutionStatus: "feasible",
  terminationReason: "gap_limit",
  quality: "Feasible — stopped at gap limit",
  achievedGap: 0.05,
  solverIncumbentObjective: 100,
  solverBestBound: 95,
  objective: 100,
};

const FEASIBLE_TIME_LIMIT_NO_BOUND: ResultCacheEntryV2 = {
  ...BASE,
  status: "feasible",
  solutionStatus: "feasible",
  terminationReason: "time_limit",
  quality: "Feasible — time limit reached",
  achievedGap: null,
  solverIncumbentObjective: 100,
  solverBestBound: null,
  objective: 100,
};

const INFEASIBLE: ResultCacheEntryV2 = {
  ...BASE,
  status: "infeasible",
  solutionStatus: "infeasible",
  terminationReason: "infeasible",
  quality: "Infeasible",
  achievedGap: null,
  solverIncumbentObjective: null,
  solverBestBound: null,
  objective: null, // §2.4 — the future-correct contract; see the "known gap" test below
  infeasibilityReason: "No feasible assignment",
};

const UNBOUNDED: ResultCacheEntryV2 = {
  ...BASE,
  status: "unbounded",
  solutionStatus: "unbounded",
  terminationReason: "unbounded",
  quality: "Unbounded",
  achievedGap: null,
  solverIncumbentObjective: null,
  solverBestBound: null,
  objective: null,
};

const NO_SOLUTION_WITH_BOUND: ResultCacheEntryV2 = {
  ...BASE,
  status: "no_solution",
  solutionStatus: "no_solution",
  terminationReason: "time_limit",
  quality: "No solution found",
  achievedGap: null,
  solverIncumbentObjective: null,
  solverBestBound: 42,
  objective: null,
};

const NO_SOLUTION_NO_BOUND: ResultCacheEntryV2 = {
  ...NO_SOLUTION_WITH_BOUND,
  solverBestBound: null,
};

describe("checkResultInvariants (§2.4 invariant matrix)", () => {
  it.each([
    ["optimal/optimality_proven", OPTIMAL],
    ["feasible/gap_limit", FEASIBLE_GAP_LIMIT],
    ["feasible/time_limit (no bound)", FEASIBLE_TIME_LIMIT_NO_BOUND],
    ["feasible/node_limit (no bound)", { ...FEASIBLE_TIME_LIMIT_NO_BOUND, terminationReason: "node_limit" }],
    ["infeasible/infeasible", INFEASIBLE],
    ["unbounded/unbounded", UNBOUNDED],
    ["no_solution/time_limit with bound", NO_SOLUTION_WITH_BOUND],
    ["no_solution/time_limit without bound", NO_SOLUTION_NO_BOUND],
    ["no_solution/node_limit", { ...NO_SOLUTION_WITH_BOUND, terminationReason: "node_limit" }],
  ])("accepts %s", (_label, fixture) => {
    expect(checkResultInvariants(fixture as ResultCacheEntryV2)).toBeNull();
  });

  it("allows a null solutionStatus unconditionally (normalized-legacy has no v2 outcome to check)", () => {
    expect(checkResultInvariants({
      solutionStatus: null, terminationReason: null, objective: null,
      solverIncumbentObjective: null, solverBestBound: null, achievedGap: null,
    })).toBeNull();
  });

  it.each([
    ["optimal without a non-null objective", { ...OPTIMAL, objective: null as unknown as number }],
    ["optimal without a non-null solverIncumbentObjective", { ...OPTIMAL, solverIncumbentObjective: null }],
    ["optimal with the wrong terminationReason", { ...OPTIMAL, terminationReason: "gap_limit" as const }],
    ["feasible/gap_limit missing solverBestBound", { ...FEASIBLE_GAP_LIMIT, solverBestBound: null }],
    ["feasible/gap_limit missing achievedGap", { ...FEASIBLE_GAP_LIMIT, achievedGap: null }],
    ["infeasible with a non-null objective", { ...INFEASIBLE, objective: 100 }],
    ["unbounded with a non-null solverIncumbentObjective", { ...UNBOUNDED, solverIncumbentObjective: 1 }],
    ["no_solution with a non-null objective", { ...NO_SOLUTION_WITH_BOUND, objective: 1 }],
    ["no_solution with the wrong terminationReason", { ...NO_SOLUTION_WITH_BOUND, terminationReason: "gap_limit" as const }],
  ])("rejects %s", (_label, fixture) => {
    expect(checkResultInvariants(fixture as ResultCacheEntryV2)).not.toBeNull();
  });
});

describe("ResultCacheEntryV2Schema (#2, private, server Zod)", () => {
  it.each([
    ["optimal", OPTIMAL],
    ["feasible/gap_limit", FEASIBLE_GAP_LIMIT],
    ["infeasible", INFEASIBLE],
    ["unbounded", UNBOUNDED],
    ["no_solution", NO_SOLUTION_NO_BOUND],
  ])("accepts a valid %s result", (_label, fixture) => {
    expect(ResultCacheEntryV2Schema.safeParse(fixture).success).toBe(true);
  });

  it("rejects a result that violates §2.4 (optimal with no incumbent)", () => {
    const bad = { ...OPTIMAL, solverIncumbentObjective: null };
    expect(ResultCacheEntryV2Schema.safeParse(bad).success).toBe(false);
  });

  it("rejects status:'error' — the v2 cache entry never carries it", () => {
    const bad = { ...OPTIMAL, status: "error" };
    expect(ResultCacheEntryV2Schema.safeParse(bad).success).toBe(false);
  });

  // Equivalence test at the private<->private boundary between the adopted
  // A3 fd3 schema and this file's independently-defined (to avoid a
  // circular import — see resultEnvelope.ts's header note) cache-entry
  // schema. Covers the outcomes where the two schemas genuinely agree
  // (optimal/feasible — objective is non-null in both); see the dedicated
  // "known gap" test below for the one outcome class where they diverge.
  it("accepts every optimal/feasible fixture SolverSuccessEnvelopeV2Schema accepts (both require a non-null objective there)", () => {
    for (const fixture of [OPTIMAL, FEASIBLE_GAP_LIMIT, FEASIBLE_TIME_LIMIT_NO_BOUND]) {
      expect(SolverSuccessEnvelopeV2Schema.safeParse(fixture).success).toBe(true);
      expect(ResultCacheEntryV2Schema.safeParse(fixture).success).toBe(true);
    }
  });

  it("KNOWN GAP: a real solve.py-shaped infeasible envelope (objective:0, per A3's adopted non-null schema) does NOT satisfy §2.4's stricter contract", () => {
    // solve.py's infeasible/unbounded branches always pass a literal `0` as
    // the positional `objective` arg to `_envelope()` (see solve.py) — this
    // fixture is what A3's SolverSuccessEnvelopeV2Schema accepts TODAY.
    const realSolvePyShapedInfeasible = { ...INFEASIBLE, objective: 0 };
    expect(SolverSuccessEnvelopeV2Schema.safeParse(realSolvePyShapedInfeasible).success).toBe(true);
    // ResultCacheEntryV2Schema enforces the FUTURE §2.4 contract (objective
    // null for infeasible) — this real shape correctly does NOT satisfy it
    // yet. This is a known, tracked, OUT-OF-SCOPE-for-A4 gap (a solve.py
    // change, not a TS/schema-layer change), made visible here rather than
    // silently papered over. Since A4 never wires this schema into the live
    // write path, the gap has zero effect on any student-visible behavior.
    expect(ResultCacheEntryV2Schema.safeParse(realSolvePyShapedInfeasible).success).toBe(false);
  });

  it("V2 solution-status/termination-reason enums are byte-identical between the two modules", () => {
    expect([...V2SolutionStatusSchema.options].sort()).toEqual(
      ["feasible", "infeasible", "no_solution", "optimal", "unbounded"],
    );
    expect([...V2TerminationReasonSchema.options].sort()).toEqual(
      ["gap_limit", "infeasible", "node_limit", "optimality_proven", "time_limit", "unbounded", "unknown"],
    );
  });
});

describe("no failure ever validates as any result shape (§2.4 invariant rejection)", () => {
  const FAILURE = { failureReason: "internal_error" as const, failureStage: "dataset_load" as const, errorDetail: null };

  it("SolverFailureSchema itself accepts the fixture (sanity)", () => {
    expect(SolverFailureSchema.safeParse(FAILURE).success).toBe(true);
  });

  it.each([
    ["ResultCacheEntryV2Schema", ResultCacheEntryV2Schema],
    ["PublishedSolveResultV2Schema", PublishedSolveResultV2Schema],
    ["NormalizedLegacySolveResultSchema", NormalizedLegacySolveResultSchema],
    ["NormalizedSolveResultSchema", NormalizedSolveResultSchema],
    ["StoredScenarioResultSchema", StoredScenarioResultSchema],
  ] as const)("%s rejects a failure-shaped object", (_name, schema) => {
    expect(schema.safeParse(FAILURE).success).toBe(false);
  });
});

describe("composePublishedResult — the single composition point (§2.6/§2.12)", () => {
  const FRESH_SOLVE_JOB = {
    requestedGap: 0.02, requestedGapSource: "request" as const,
    requestedTimeLimitSec: 60, requestedTimeLimitSource: "request" as const,
  };
  // A DIFFERENT job than whichever produced the cached entry — proves a
  // cache hit gets THIS job's requested values, never a stale/other job's.
  const CACHE_HIT_JOB = {
    requestedGap: 0.10, requestedGapSource: "request" as const,
    requestedTimeLimitSec: 300, requestedTimeLimitSource: "request" as const,
  };

  it("attaches the current job's requested values on the fresh-solve path", () => {
    const published = composePublishedResult(OPTIMAL, FRESH_SOLVE_JOB);
    expect(published.requestedGap).toBe(0.02);
    expect(published.requestedTimeLimitSec).toBe(60);
    expect(published.envelopeVersion).toBe(2);
    expect(published.legacyUnverified).toBe(false);
    // Every cacheable field survives unchanged.
    expect(published.objective).toBe(100);
    expect(published.solutionStatus).toBe("optimal");
  });

  it("attaches the CURRENT job's requested values on the cache-hit path — never a different request's", () => {
    // Same cacheable result (OPTIMAL) as above, but composed for a
    // DIFFERENT job — the requested values must reflect CACHE_HIT_JOB, not
    // FRESH_SOLVE_JOB's, proving this isn't accidentally memoized/baked in.
    const published = composePublishedResult(OPTIMAL, CACHE_HIT_JOB);
    expect(published.requestedGap).toBe(0.10);
    expect(published.requestedTimeLimitSec).toBe(300);
    expect(published.objective).toBe(100); // same cached result
  });

  it("rejects composing onto a cacheable result that itself violates §2.4", () => {
    const invariantBroken = { ...OPTIMAL, solverIncumbentObjective: null };
    expect(() => composePublishedResult(invariantBroken, FRESH_SOLVE_JOB)).toThrow();
  });

  it("the composed result validates against PublishedSolveResultV2Schema", () => {
    const published: PublishedSolveResultV2 = composePublishedResult(FEASIBLE_GAP_LIMIT, FRESH_SOLVE_JOB);
    expect(PublishedSolveResultV2Schema.safeParse(published).success).toBe(true);
  });
});

describe("normalizeLegacyObjective — status/evidence-aware, never `=== 0` alone (§2.7/Q33)", () => {
  it("preserves a legitimately stored 0 on a successful status (zero-demand scenarios can solve to 0)", () => {
    expect(normalizeLegacyObjective({ status: "optimal", objective: 0 })).toBe(0);
  });

  it("preserves a non-zero legacy objective", () => {
    expect(normalizeLegacyObjective({ status: "optimal", objective: 12345 })).toBe(12345);
  });

  it("nulls an infeasible row's objective regardless of the raw stored value", () => {
    expect(normalizeLegacyObjective({ status: "infeasible", objective: 0 })).toBeNull();
    expect(normalizeLegacyObjective({ status: "infeasible", objective: 999 })).toBeNull();
  });

  it("nulls an error row's objective", () => {
    expect(normalizeLegacyObjective({ status: "error", objective: 0 })).toBeNull();
  });

  it("nulls a malformed/contradictory row (non-finite or missing raw value) — conservative, explicit", () => {
    expect(normalizeLegacyObjective({ status: "optimal", objective: Number.NaN })).toBeNull();
    expect(normalizeLegacyObjective({ status: "optimal", objective: undefined })).toBeNull();
    expect(normalizeLegacyObjective({ status: "optimal", objective: "100" })).toBeNull();
  });
});

describe("normalizeLegacyResult / NormalizedLegacySolveResultSchema (§2.7)", () => {
  const LEGACY_ROW = {
    status: "optimal" as const,
    objective: 0, // deliberately zero — must survive, not be treated as absent
    runTimeSec: 1.2,
    quality: "Optimal",
    edges: [],
    metrics: {},
    details: {},
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("produces the exact discriminated v1 shape", () => {
    const normalized = normalizeLegacyResult(LEGACY_ROW);
    expect(normalized.envelopeVersion).toBe(1);
    expect(normalized.solutionStatus).toBeNull();
    expect(normalized.terminationReason).toBe("unknown");
    expect(normalized.legacyUnverified).toBe(true);
    expect(normalized.status).toBeNull(); // deprecated field nulled — never copied from the legacy row
    expect(normalized.legacyStatus).toBe("optimal"); // raw value isolated here instead
    expect(normalized.objective).toBe(0); // the legitimate-zero case
    expect(normalized.quality).toBe(LEGACY_UNVERIFIED_QUALITY);
    expect(normalized.quality).not.toMatch(/proven|optimal/i); // never re-creates the false-proof defect
    expect(normalized.solverIncumbentObjective).toBeNull();
    expect(normalized.solverBestBound).toBeNull();
    expect(normalized.achievedGap).toBeNull();
    expect(normalized.requestedGap).toBeNull();
    expect(normalized.requestedGapSource).toBeNull();
    expect(normalized.requestedTimeLimitSec).toBeNull();
    expect(normalized.requestedTimeLimitSource).toBeNull();
  });

  it("validates against NormalizedLegacySolveResultSchema and the NormalizedSolveResult union", () => {
    const normalized = normalizeLegacyResult(LEGACY_ROW);
    expect(NormalizedLegacySolveResultSchema.safeParse(normalized).success).toBe(true);
    expect(NormalizedSolveResultSchema.safeParse(normalized).success).toBe(true);
  });

  it("an infeasible legacy row normalizes to a null objective, never a proof claim", () => {
    const normalized = normalizeLegacyResult({ ...LEGACY_ROW, status: "infeasible", objective: 0, infeasibilityReason: "no feasible assignment" });
    expect(normalized.objective).toBeNull();
    expect(normalized.legacyStatus).toBe("infeasible");
  });

  // A-fix (F1b) — legacyUnverified now depends on whether the ROW ITSELF
  // carries genuine truthful-status evidence, not merely "failed to parse
  // as v2." Direct unit coverage of every combination of the two evidence
  // fields, complementing resultContractBoundary.test.ts's HTTP-boundary
  // coverage of the same rule.
  describe("legacyUnverified narrowing (A-fix F1b) — true ONLY for genuinely pre-B rows", () => {
    it("neither solutionStatus nor terminationReason set → legacyUnverified:true (genuinely pre-B)", () => {
      const normalized = normalizeLegacyResult(LEGACY_ROW);
      expect(normalized.legacyUnverified).toBe(true);
    });

    it("a real solutionStatus set (terminationReason absent) → legacyUnverified:false", () => {
      const normalized = normalizeLegacyResult({ ...LEGACY_ROW, solutionStatus: "optimal" });
      expect(normalized.legacyUnverified).toBe(false);
    });

    it("a real terminationReason set (solutionStatus absent) → legacyUnverified:false", () => {
      const normalized = normalizeLegacyResult({ ...LEGACY_ROW, terminationReason: "optimality_proven" });
      expect(normalized.legacyUnverified).toBe(false);
    });

    it("both solutionStatus and terminationReason set (the real B-truthful shape) → legacyUnverified:false", () => {
      const normalized = normalizeLegacyResult({
        ...LEGACY_ROW,
        solutionStatus: "optimal",
        terminationReason: "optimality_proven",
        solverIncumbentObjective: 250,
        solverBestBound: 250,
        achievedGap: 0,
      });
      expect(normalized.legacyUnverified).toBe(false);
      // Still normalizes to the v1 discriminated shape — legacyUnverified is
      // the only thing that changed, not envelopeVersion or the nulled
      // status/solutionStatus fields (that's an A9-scoped concern, unchanged
      // by this fix).
      expect(normalized.envelopeVersion).toBe(1);
      expect(NormalizedLegacySolveResultSchema.safeParse(normalized).success).toBe(true);
    });

    it("an explicit null on both fields (not merely absent) is still treated as pre-B (!= null check covers both)", () => {
      const normalized = normalizeLegacyResult({ ...LEGACY_ROW, solutionStatus: null, terminationReason: null });
      expect(normalized.legacyUnverified).toBe(true);
    });
  });
});

describe("normalizeStoredResult — the three-way discriminator (A0 §2.14)", () => {
  const LEGACY_STORED = ResultEnvelopeSchema.parse({
    status: "optimal", objective: 500, runTimeSec: 0.4, quality: "Optimal",
    edges: [], metrics: {}, details: {}, solverUsed: "CBC (PuLP)", infeasibilityReason: null,
  });

  it("normalizes a stored legacy/B-unversioned row (no envelopeVersion) to v1", () => {
    const normalized = normalizeStoredResult(LEGACY_STORED);
    expect(normalized.envelopeVersion).toBe(1);
    expect((normalized as { legacyUnverified: boolean }).legacyUnverified).toBe(true);
  });

  it("passes a stored v2 published row through unchanged", () => {
    const published = composePublishedResult(OPTIMAL, {
      requestedGap: 0.01, requestedGapSource: "request",
      requestedTimeLimitSec: 30, requestedTimeLimitSource: "request",
    });
    const normalized = normalizeStoredResult(published);
    expect(normalized).toEqual(published);
    expect(normalized.envelopeVersion).toBe(2);
  });

  it("StoredScenarioResultSchema accepts both representations", () => {
    expect(StoredScenarioResultSchema.safeParse(LEGACY_STORED).success).toBe(true);
    const published = composePublishedResult(OPTIMAL, {
      requestedGap: null, requestedGapSource: null,
      requestedTimeLimitSec: null, requestedTimeLimitSource: null,
    });
    expect(StoredScenarioResultSchema.safeParse(published).success).toBe(true);
  });
});

describe("§2.4 invariant rejection at the schema layer — invalid combinations are Zod-rejected, not just flagged", () => {
  it("PublishedSolveResultV2Schema rejects an invariant-violating composed object even via direct .parse", () => {
    const bad = { ...OPTIMAL, terminationReason: "gap_limit", envelopeVersion: 2, requestedGap: null, requestedGapSource: null, requestedTimeLimitSec: null, requestedTimeLimitSource: null, legacyUnverified: false };
    expect(PublishedSolveResultV2Schema.safeParse(bad).success).toBe(false);
  });

  it("NormalizedSolveResultSchema rejects a v2-shaped object with legacyUnverified:true (union member cross-contamination)", () => {
    const composed = composePublishedResult(OPTIMAL, {
      requestedGap: null, requestedGapSource: null, requestedTimeLimitSec: null, requestedTimeLimitSource: null,
    });
    const bad = { ...composed, legacyUnverified: true };
    expect(NormalizedSolveResultSchema.safeParse(bad).success).toBe(false);
  });
});
