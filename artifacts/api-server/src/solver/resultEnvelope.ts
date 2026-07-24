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
  leg: z.enum(["mine_to_refinery", "refinery_to_customer"]).optional(),
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
});

export const ResultEnvelopeSchema = z.object({
  status: z.enum(["optimal", "infeasible", "error"]),
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
