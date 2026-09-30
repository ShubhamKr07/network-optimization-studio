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
});

export type DeliveryInputs = z.infer<typeof deliveryInputsSchema>;
