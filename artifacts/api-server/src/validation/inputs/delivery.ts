import { z } from "zod";

// Chapter 5 (modified) - Delivery Company Teaching Example.
//
// The cost domain is NONNEGATIVE, not positive: the source data contains 33
// zero-distance self-lanes (a DC serving its own city), seeded into costs.json
// as zero costs, so forbidding a zero override would forbid restoring a value
// the dataset itself ships. The RATES stay strictly positive - a zero rate
// makes every lane free and the objective degenerate.
const laneCostOverrideSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  cost: z.number().finite().nonnegative(),
});

// Section 14 — editable Warehouses and Customers. Shapes mirror pMedian.ts's
// equivalents so the shared tab components, the status enum and the solver's
// bound logic all transfer unchanged.
//
// `capacity` is DELIBERATELY absent from the warehouse override. p-median's
// shape carries it; this model has capacityModes: [] and the solver has no
// capacity constraint, so accepting the field would persist a value nothing
// reads — the persisted-but-ignored trap.
const warehouseOverrideSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "forced_open", "inactive"]),
});

// `demand` is NONNEGATIVE, not positive: zero is a legal demand. Measured
// (§14.3/§14.6, corrected 2026-09-29): zero demand and exclusion are
// IDENTICAL on every demand-weighted metric — a zero-demand customer
// contributes 0 to both the numerator and the denominator, exactly as an
// absent one does, so no metric can tell them apart. The real difference is
// MEMBERSHIP: a zero-demand customer is still in the model — still assigned,
// still emitted as a lane at zero flow — while an excluded one is gone.
const customerOverrideSchema = z.object({
  id: z.string().min(1),
  demand: z.number().finite().nonnegative().nullable().optional(),
  status: z.enum(["active", "excluded"]),
});

export const deliveryInputsSchema = z.object({
  // 33 candidate DCs. This bound is the API's only enforcement - both UI
  // mounts default pMax = 50 and must be passed pMax={33} explicitly, or a
  // student selects 40 from a control that offered it and gets a 422.
  p: z.number().int().min(1).max(33),
  distanceBands: z.array(z.number().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),

  // The three rate fields are ALWAYS present, with defaults, whether or not
  // the toggle is on: toggling on must never have to invent values, and a
  // scenario saved with the toggle off must retain the rates the student had
  // configured. costPerMileOver >= costPerMile is deliberately NOT enforced -
  // a student exploring a long-haul discount is doing legitimate what-if work.
  costAdjustEnabled: z.boolean().default(false),
  distanceThreshold: z.number().positive(),
  costPerMile: z.number().positive(),
  costPerMileOver: z.number().positive(),

  laneCostOverrides: z.array(laneCostOverrideSchema).default([])
    .refine(
      (rows) => new Set(rows.map((r) => `${r.fromId},${r.toId}`)).size === rows.length,
      { message: "laneCostOverrides must not contain duplicate (fromId, toId) pairs" },
    ),

  // §14 — editable Warehouses/Customers. Only deviations travel to the
  // solver (see buildPayload's delivery-teaching-us branch in pmedian.ts):
  // `active` warehouses and null/absent demand are the defaults and are not
  // sent on the wire.
  warehouseOverrides: z.array(warehouseOverrideSchema).default([]),
  customerOverrides: z.array(customerOverrideSchema).default([]),
});

export type DeliveryInputs = z.infer<typeof deliveryInputsSchema>;
