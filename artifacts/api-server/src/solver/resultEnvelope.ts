import { z } from "zod";

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
