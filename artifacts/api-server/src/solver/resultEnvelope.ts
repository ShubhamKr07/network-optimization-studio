import { z } from "zod";
import type { SolverSuccessEnvelopeV2 } from "./solverProcessMessage.js";

// Phase 3.5 (G2.1) — the standardized shape solve.py's stdout is validated
// against before pmedian.ts's solve() trusts it. `details` is intentionally
// untyped (model-specific extras — e.g. p-median's openWarehouseIds/
// assignments, transport's per-shipment flowFraction) rather than typed per
// model here; Phase 4/5 render from `edges`/`metrics` generically.
export const EdgeSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  flow: z.number(),
  distance: z.number(),
  band: z.number().optional(),
  // Two-echelon models tag each edge with its leg so the map can style
  // mine->refinery and refinery->customer differently. Optional: single-echelon
  // models omit it. Without this field here, Zod strips it silently.
  // jade-T4: two-echelon-jade-us adds plant_to_warehouse/warehouse_to_customer
  // (its own two legs, distinct string values from Ch10's mine/refinery pair --
  // consumers must classify legs semantically, not assume only the Ch10 set).
  leg: z.enum([
    "mine_to_refinery",
    "refinery_to_customer",
    "plant_to_warehouse",
    "warehouse_to_customer",
  ]).optional(),
  // jade-T4: inbound (plant->warehouse) edges are per-product; outbound
  // (warehouse->customer) edges aggregate across a customer's products, so
  // productId is absent there. Optional globally -- other models omit it,
  // and without this field here Zod would strip it silently.
  productId: z.string().optional(),
});

export const MetricsSchema = z.object({
  utilizationByNode: z
    .array(z.object({ warehouseId: z.string(), city: z.string(), utilization: z.number() }))
    .optional(),
  bandCoverage: z.array(z.object({ band: z.number(), percent: z.number() })).optional(),
  weightedAvgDistance: z.number().optional(),
  // Two-echelon models emit per-leg average distance + total flow so the UI
  // can show how the mine->refinery vs refinery->customer legs trade off as
  // bomRatio changes. Optional: single-echelon models omit it. Without this
  // field here, Zod strips it silently.
  avgDistanceByLeg: z
    .array(z.object({ leg: z.string(), avgDistance: z.number(), totalFlow: z.number() }))
    .optional(),
  // jade-T4: two-echelon-jade-us's uncapacitated warehouses have no natural
  // utilization percentage denominator, so it needs a few extra generic
  // fields the earlier models didn't: the authoritative open-facility-id
  // list (including a zero-flow open warehouse, which utilizationByNode
  // alone can't distinguish from "not open"), total served demand, and the
  // inbound/outbound cost split. All optional -- other models omit them,
  // and without these fields here Zod would strip them silently.
  openFacilityIds: z.array(z.string()).optional(),
  totalDemand: z.number().optional(),
  inboundCost: z.number().optional(),
  outboundCost: z.number().optional(),
});

// B3 — truthful status (solve.py's B2). `solutionStatus` is the solver's
// real outcome classification, taken verbatim from cbc_termination.py's
// SOLUTION_STATUSES plus the pre-existing "error" sentinel solve.py already
// used for a load/dispatch failure that never reached a solve attempt at all
// (`_load_error_envelope` / the top-level except in solve.py's `main`) --
// the plan text names only the 5 CBC-classification values, but solve.py
// genuinely emits "error" too, so it's included here (hard rule #8
// deviation, noted in the B3 commit body rather than silently narrowed).
export const SolutionStatusSchema = z.enum([
  "optimal",
  "feasible",
  "infeasible",
  "unbounded",
  "no_solution",
  "error",
]);

// Mirrors cbc_termination.py's TERMINATION_REASONS verbatim, including the
// legacy-only "unknown" sentinel (never a parser output going forward --
// see B1's §34.3.4 fix -- kept here purely so a pre-B1 stored value, or a
// future legacy-read normalization, still validates).
export const TerminationReasonSchema = z.enum([
  "optimality_proven",
  "gap_limit",
  "time_limit",
  "node_limit",
  "infeasible",
  "unbounded",
  "unknown",
]);

export const ResultEnvelopeSchema = z.object({
  // Deprecated: the truthful projection of solutionStatus (kept for backward
  // compatibility with pre-B3 consumers). Expanded to the full truthful
  // value set since a real gap-limited solve now emits "feasible" here (it
  // used to be hardcoded "optimal" for every non-infeasible/non-error solve
  // -- see B2) -- without this expansion a real gap-limited result would
  // fail this Zod validation outright.
  status: z.enum(["optimal", "infeasible", "error", "feasible", "no_solution", "unbounded"]),
  // B3: additive, optional (never `.default(...)`) -- a legacy stored
  // envelope from before B2 simply lacks this key entirely, and this schema
  // must keep validating it (the export route's `ResultEnvelopeSchema.safeParse`
  // on a scenario's/solve_jobs' persisted `result` must not start failing on
  // old rows). `.nullable()` too: solve.py's `_envelope` always emits the key
  // for a NEW envelope, but never as an explicit null -- kept defensively so
  // a future normalization (e.g. the read-path legacy guard) can write an
  // explicit `null` without breaking re-validation.
  solutionStatus: SolutionStatusSchema.nullable().optional(),
  terminationReason: TerminationReasonSchema.nullable().optional(),
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

export type ResultEnvelope = z.infer<typeof ResultEnvelopeSchema>;

// ---------------------------------------------------------------------------
// A4 (SCND Correctness) — the five-schema result contract, split by
// authority (design spec §2.6/§2.7, plan Task A4). Scope boundary: this
// file defines schemas + composePublishedResult() + the legacy normalizer
// and tests them directly — it does NOT activate the v2 write path.
// jobRunner.ts's real success path still runs toLegacyStoredResult() into
// the EXISTING (unchanged) ResultEnvelopeSchema above; routes/scenarios.ts's
// toApiScenario()/presentResultForRead() are unchanged. A6 adds the v2
// cache key, A7 the outcome/publish policy, A11 the flag — this task's job
// is to make those tasks' work mechanical, not to flip any switch itself.
//
// Schema authority (Q83): OpenAPI owns PUBLIC request/response shapes;
// server-owned Zod owns PRIVATE shapes (fd3 messages, cache values, raw
// stored rows) unless a documented one-way generator exists. Applied here:
//   #1 SolverSuccessEnvelopeV2 — OWNED by solverProcessMessage.ts (A3).
//      Adopted via a TYPE-ONLY import above (`import type`, erased at
//      compile time — zero runtime footprint). A VALUE import in this
//      direction would create a real ESM circular dependency:
//      solverProcessMessage.ts already imports EdgeSchema/MetricsSchema
//      (values) FROM this file; if this file also imported
//      SolverSuccessEnvelopeV2Schema (a value) FROM solverProcessMessage.ts,
//      whichever module a caller loads first would force the other to
//      start evaluating mid-cycle, and solverProcessMessage.ts's top-level
//      `z.object({ edges: z.array(EdgeSchema), ... })` would try to read
//      EdgeSchema before this file's own `export const EdgeSchema = ...`
//      line has run — a TDZ ReferenceError, order-dependent on which module
//      an importer happens to reach first. The type-only import sidesteps
//      this entirely (types are erased, so there is no runtime edge in the
//      module graph at all in that direction).
//   #2 ResultCacheEntryV2 — server Zod (private). "Normally an alias of #1"
//      (§2.6) — SolverSuccessEnvelopeV2 already carries zero
//      request-specific fields, so a type alias IS that equivalence. The
//      Zod OBJECT below is a structurally independent definition (built
//      from this file's own EdgeSchema/MetricsSchema, never a runtime
//      import of SolverSuccessEnvelopeV2Schema) — the same "hand-mirror,
//      don't value-import across a package/module boundary" pattern
//      lib/db/src/schema/solve_jobs.ts's CHECK constraints already use for
//      solverProcessMessage.ts's enums, for the identical reason (a value
//      import would invert/cycle the dependency graph). Equivalence is
//      enforced two ways: a compile-time structural check
//      (assertResultCacheEntryV2MatchesEnvelope below) and a runtime
//      fixture-based test (resultContractSchemas.test.ts) proving both
//      schemas accept/reject the same inputs.
//   #3 PublishedSolveResultV2 / #5 NormalizedSolveResult — OpenAPI-owned
//      (public), defined in lib/api-spec/openapi.yaml and regenerated into
//      lib/api-zod. This file independently mirrors them for server-side
//      runtime validation (no documented one-way generator emits a runtime
//      Zod schema for an operation-unreferenced OpenAPI component — Orval's
//      zod client only emits runtime consts for schemas reachable from a
//      live operation, and these two are deliberately NOT referenced by any
//      operation yet, per the "does not activate" scope boundary — so
//      "server-owned Zod" is the correct authority here per Q83's own
//      escape clause). Equivalence with the generated OpenAPI TypeScript
//      type is a compile-time assignability check
//      (resultContractSchemas.test.ts), which fails `pnpm run typecheck`
//      the moment the two shapes diverge.
//   #4 StoredScenarioResult — server Zod (private): published v2 OR the
//      EXISTING (unchanged) ResultEnvelopeSchema, which already covers both
//      historical-unversioned rows and B's truthful-but-unversioned rows
//      (its solutionStatus/terminationReason/etc. fields are already
//      optional — see A0's §2.14 representation inventory).
// ---------------------------------------------------------------------------

// Mirrors solverProcessMessage.ts's V2SolutionStatusSchema /
// V2TerminationReasonSchema verbatim (hand-mirrored — see the header note
// above for why this can't be a value import). Keep these two literal lists
// in sync by hand if either enum ever changes;
// resultContractSchemas.test.ts asserts the two stay identical.
const V2_SOLUTION_STATUSES = ["optimal", "feasible", "infeasible", "unbounded", "no_solution"] as const;
const V2_TERMINATION_REASONS = [
  "optimality_proven", "gap_limit", "time_limit", "node_limit", "infeasible", "unbounded", "unknown",
] as const;

const V2SolutionStatusMirrorSchema = z.enum(V2_SOLUTION_STATUSES);
const V2TerminationReasonMirrorSchema = z.enum(V2_TERMINATION_REASONS);

export interface ResultInvariantInput {
  solutionStatus?: string | null | undefined;
  terminationReason?: string | null | undefined;
  objective?: number | null | undefined;
  solverIncumbentObjective?: number | null | undefined;
  solverBestBound?: number | null | undefined;
  achievedGap?: number | null | undefined;
}

// §2.4's invariant matrix, evaluated once. Returns a violation message, or
// null when the combination is one of the matrix's allowed rows.
// `solutionStatus == null` is always allowed (a normalized-legacy read has
// no v2 outcome to check against this table at all) — callers that require
// a non-null v2 outcome enforce that separately, via their own schema's
// `.required` list (PublishedSolveResultV2Schema's `solutionStatus` is not
// itself made required-non-null here, matching the adopted
// SolverSuccessEnvelopeV2Schema's own nullable/optional stance — but every
// NON-null value is still checked against its row of the table).
export function checkResultInvariants(input: ResultInvariantInput): string | null {
  const { solutionStatus, terminationReason, objective, solverIncumbentObjective, solverBestBound, achievedGap } = input;
  if (solutionStatus == null) return null;

  const nonNull = (v: unknown) => v !== null && v !== undefined;
  const isNull = (v: unknown) => v === null || v === undefined;

  switch (solutionStatus) {
    case "optimal":
      if (terminationReason !== "optimality_proven") {
        return `optimal requires terminationReason=optimality_proven, got ${String(terminationReason)}`;
      }
      if (!nonNull(objective)) return "optimal requires a non-null objective";
      if (!nonNull(solverIncumbentObjective)) return "optimal requires a non-null solverIncumbentObjective";
      return null;
    case "feasible":
      if (terminationReason === "gap_limit") {
        if (!nonNull(objective) || !nonNull(solverIncumbentObjective)) {
          return "feasible/gap_limit requires a non-null objective + solverIncumbentObjective";
        }
        if (!nonNull(solverBestBound) || !nonNull(achievedGap)) {
          return "feasible/gap_limit requires solverBestBound + achievedGap (a gap-limit stop is not auditable without them)";
        }
        return null;
      }
      if (terminationReason === "time_limit" || terminationReason === "node_limit") {
        if (!nonNull(objective) || !nonNull(solverIncumbentObjective)) {
          return "feasible/time_limit|node_limit requires a non-null objective + solverIncumbentObjective";
        }
        return null; // solverBestBound/achievedGap nullable when CBC evidence exposes none
      }
      return `feasible requires terminationReason in {gap_limit,time_limit,node_limit}, got ${String(terminationReason)}`;
    case "infeasible":
      if (terminationReason !== "infeasible") return "infeasible requires terminationReason=infeasible";
      if (!isNull(objective) || !isNull(solverIncumbentObjective) || !isNull(solverBestBound) || !isNull(achievedGap)) {
        return "infeasible requires objective/solverIncumbentObjective/solverBestBound/achievedGap all null";
      }
      return null;
    case "unbounded":
      if (terminationReason !== "unbounded") return "unbounded requires terminationReason=unbounded";
      if (!isNull(objective) || !isNull(solverIncumbentObjective) || !isNull(solverBestBound) || !isNull(achievedGap)) {
        return "unbounded requires objective/solverIncumbentObjective/solverBestBound/achievedGap all null";
      }
      return null;
    case "no_solution":
      if (terminationReason !== "time_limit" && terminationReason !== "node_limit") {
        return "no_solution requires terminationReason in {time_limit,node_limit}";
      }
      if (!isNull(objective) || !isNull(solverIncumbentObjective) || !isNull(achievedGap)) {
        return "no_solution requires objective/solverIncumbentObjective/achievedGap null (solverBestBound may be a number)";
      }
      return null;
    default:
      return `unknown solutionStatus ${String(solutionStatus)}`;
  }
}

function addInvariantIssue(val: ResultInvariantInput, ctx: z.RefinementCtx): void {
  const violation = checkResultInvariants(val);
  if (violation) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `§2.4 invariant violated: ${violation}` });
  }
}

// The raw ZodObject (pre-superRefine) — kept separate so
// PublishedSolveResultV2Schema below can `.extend()` it (ZodEffects, the
// type `.superRefine()` returns, has no `.extend()`/`.shape`).
const resultCacheEntryV2Object = z.object({
  status: z.enum(V2_SOLUTION_STATUSES),
  solutionStatus: V2SolutionStatusMirrorSchema.nullable().optional(),
  terminationReason: V2TerminationReasonMirrorSchema.nullable().optional(),
  achievedGap: z.number().nullable().optional(),
  solverIncumbentObjective: z.number().nullable().optional(),
  solverBestBound: z.number().nullable().optional(),
  // Nullable — deliberately MORE permissive than the adopted fd3
  // SolverSuccessEnvelopeV2 (A3), whose `objective` is still `z.number()`
  // (non-null). §2.2/§2.4 say `objective` is "nullable when no incumbent"
  // (infeasible/unbounded/no_solution); solve.py's infeasible/unbounded
  // branches still emit a placeholder 0 today (see solve.py's `_envelope`
  // call sites), not null — a known, tracked gap in solve.py itself,
  // OUTSIDE A4's scope (a solve.py change, and hard rule #6 forbids a new
  // solver branch anyway; A4 owns the TS/schema layer only). This field is
  // the one deliberate divergence from #1 — see the equivalence check below.
  objective: z.number().nullable(),
  runTimeSec: z.number(),
  quality: z.string(),
  edges: z.array(EdgeSchema),
  metrics: MetricsSchema,
  details: z.record(z.string(), z.unknown()),
  solverUsed: z.string(),
  infeasibilityReason: z.string().nullable(),
});

// #2 — server Zod (private). See the header note for why this is a
// structurally independent definition rather than a value import.
export const ResultCacheEntryV2Schema = resultCacheEntryV2Object.superRefine(addInvariantIssue);
export type ResultCacheEntryV2 = z.infer<typeof ResultCacheEntryV2Schema>;

// Compile-time equivalence check (§2.6: "a type alias is fine where two are
// byte-identical"). ResultCacheEntryV2 is #1's alias EXCEPT for ONE
// deliberate divergence — `objective`'s nullability (see the field comment
// above) — so the check below excludes exactly that field and asserts
// byte-identical equivalence on everything else. If any OTHER field
// structurally diverges, `pnpm run typecheck` fails right here, at the
// boundary, rather than silently.
type AssertBothWays<A, B> = A extends B ? (B extends A ? true : never) : never;
type OmitObjective<T> = Omit<T, "objective">;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ResultCacheEntryV2MatchesEnvelope = AssertBothWays<OmitObjective<ResultCacheEntryV2>, OmitObjective<SolverSuccessEnvelopeV2>>;
const _resultCacheEntryV2MatchesEnvelope: _ResultCacheEntryV2MatchesEnvelope = true;
void _resultCacheEntryV2MatchesEnvelope;

// #3 — PublishedSolveResultV2. OpenAPI-owned (public); this is the
// server-side runtime mirror (see the header note). #2's fields plus the
// CURRENT job's requested gap/time-limit values + envelopeVersion +
// legacyUnverified:false. Only this shape (or normalized-legacy) may ever
// reach scenarios.result/public APIs once v2 writes are active.
export const PublishedSolveResultV2Schema = resultCacheEntryV2Object
  .extend({
    envelopeVersion: z.literal(2),
    requestedGap: z.number().nullable(),
    requestedGapSource: z.literal("request").nullable(),
    requestedTimeLimitSec: z.number().nullable(),
    requestedTimeLimitSource: z.literal("request").nullable(),
    legacyUnverified: z.literal(false),
  })
  .superRefine(addInvariantIssue);
export type PublishedSolveResultV2 = z.infer<typeof PublishedSolveResultV2Schema>;

// #4 — StoredScenarioResult. Server Zod (private): published v2, or the
// EXISTING (unchanged) ResultEnvelopeSchema shape covering both historical
// and B-unversioned stored rows.
export const StoredScenarioResultSchema = z.union([PublishedSolveResultV2Schema, ResultEnvelopeSchema]);
export type StoredScenarioResult = z.infer<typeof StoredScenarioResultSchema>;

// A non-proof legacy quality string (§2.7) — never "Proven optimal"/
// "Optimal", which would recreate the false-proof defect B fixed.
export const LEGACY_UNVERIFIED_QUALITY = "Legacy result (unverified)";

// Normalized-legacy v1 (§2.7's exact discriminated schema). `status` is the
// DEPRECATED field, made null here on purpose — the raw historical value
// survives only as `legacyStatus`, never copied into the truthful `status`.
export const NormalizedLegacySolveResultSchema = z.object({
  envelopeVersion: z.literal(1),
  status: z.null(),
  solutionStatus: z.null(),
  terminationReason: z.literal("unknown"),
  legacyUnverified: z.literal(true),
  // Permissive (plain string, not re-validated against the current status
  // enum) — a historical row's raw status is preserved verbatim even if a
  // future status enum ever narrows; this field is display/history-only,
  // never re-interpreted as a truthful claim.
  legacyStatus: z.string(),
  quality: z.string(),
  objective: z.number().nullable(),
  runTimeSec: z.number(),
  edges: z.array(EdgeSchema),
  metrics: MetricsSchema,
  details: z.record(z.string(), z.unknown()),
  solverUsed: z.string(),
  infeasibilityReason: z.string().nullable(),
  solverIncumbentObjective: z.null(),
  solverBestBound: z.null(),
  achievedGap: z.null(),
  requestedGap: z.null(),
  requestedGapSource: z.null(),
  requestedTimeLimitSec: z.null(),
  requestedTimeLimitSource: z.null(),
});
export type NormalizedLegacySolveResult = z.infer<typeof NormalizedLegacySolveResultSchema>;

// #5 — NormalizedSolveResult. OpenAPI-owned (public) read/API/UI union:
// published v2, or normalized-legacy v1. Server-side runtime mirror, same
// rationale as #3.
export const NormalizedSolveResultSchema = z.union([PublishedSolveResultV2Schema, NormalizedLegacySolveResultSchema]);
export type NormalizedSolveResult = z.infer<typeof NormalizedSolveResultSchema>;

// Emptiness for the legacy `objective` field is decided by STATUS
// (infeasible/error) or EVIDENCE (a non-finite/missing raw value on a
// malformed/contradictory row) — `=== 0` alone is NEVER the test (§2.7/§22.2.4
// Q33): a legitimately stored 0 (a zero-demand scenario can genuinely solve
// to 0) must be preserved, not nulled out.
const LEGACY_NULL_OBJECTIVE_STATUSES = new Set(["infeasible", "error"]);

export function normalizeLegacyObjective(legacy: { status: string; objective: unknown }): number | null {
  if (LEGACY_NULL_OBJECTIVE_STATUSES.has(legacy.status)) return null;
  if (typeof legacy.objective !== "number" || !Number.isFinite(legacy.objective)) return null;
  return legacy.objective;
}

// Read-time-only normalization (§2.7) — never backfilled, never re-solved.
export function normalizeLegacyResult(legacy: ResultEnvelope): NormalizedLegacySolveResult {
  return NormalizedLegacySolveResultSchema.parse({
    envelopeVersion: 1,
    status: null,
    solutionStatus: null,
    terminationReason: "unknown",
    legacyUnverified: true,
    legacyStatus: legacy.status,
    quality: LEGACY_UNVERIFIED_QUALITY,
    objective: normalizeLegacyObjective(legacy),
    runTimeSec: legacy.runTimeSec,
    edges: legacy.edges,
    metrics: legacy.metrics,
    details: legacy.details,
    solverUsed: legacy.solverUsed,
    infeasibilityReason: legacy.infeasibilityReason,
    solverIncumbentObjective: null,
    solverBestBound: null,
    achievedGap: null,
    requestedGap: null,
    requestedGapSource: null,
    requestedTimeLimitSec: null,
    requestedTimeLimitSource: null,
  });
}

// The three-way discriminator underlying R1's stored-result reader (A0's
// §2.14 release-state matrix): a v2 published row (envelopeVersion===2)
// passes through unchanged; anything else (historical-unversioned OR B's
// truthful-but-unversioned — both share the same raw ResultEnvelopeSchema
// shape, §2.14 representations #1/#2) goes through the legacy normalizer.
// NOT wired into any live route in A4 — routes/scenarios.ts's toApiScenario()
// keeps its existing presentResultForRead() output unchanged (normalizing
// `status` to null would be a real, currently-unhandled frontend-visible
// change; wiring this in is A8/A9's job). Exported so A8/A9 adopt this
// exact logic rather than re-deriving it.
export function normalizeStoredResult(stored: StoredScenarioResult): NormalizedSolveResult {
  if (typeof stored === "object" && stored !== null && "envelopeVersion" in stored && (stored as { envelopeVersion?: unknown }).envelopeVersion === 2) {
    return stored as PublishedSolveResultV2;
  }
  return normalizeLegacyResult(stored as ResultEnvelope);
}

export interface JobRequestedLimits {
  requestedGap: number | null;
  requestedGapSource: "request" | null;
  requestedTimeLimitSec: number | null;
  requestedTimeLimitSource: "request" | null;
}

// §2.6/§2.12's SINGLE composition point. Attaches the CURRENT job's
// requested gap/time-limit values onto a cacheable v2 result — the same
// function on both the fresh-solve path (the job that just produced this
// result) and the cache-hit path (a job that did NOT produce this cached
// entry), so a cache hit can never leak a different request's requested
// values. NOT wired into jobRunner.ts's real write path in A4 (scope
// boundary — A4 defines and directly tests this function; A6/A7 activate
// the v2 cache/publish path that calls it in production).
export function composePublishedResult(
  cacheableResult: ResultCacheEntryV2,
  job: JobRequestedLimits,
): PublishedSolveResultV2 {
  return PublishedSolveResultV2Schema.parse({
    ...cacheableResult,
    envelopeVersion: 2,
    requestedGap: job.requestedGap,
    requestedGapSource: job.requestedGapSource,
    requestedTimeLimitSec: job.requestedTimeLimitSec,
    requestedTimeLimitSource: job.requestedTimeLimitSource,
    legacyUnverified: false,
  });
}
