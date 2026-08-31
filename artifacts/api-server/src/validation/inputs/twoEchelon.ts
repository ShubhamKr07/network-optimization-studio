import { z } from "zod";

// SCN v0.3 Phase B, task B6.2 (fast-follow of B1.1/B6.1's established
// pattern) — scenario-local network edits for two-echelon-gold-au. Own
// vocabulary this model already speaks (bomRatio, refineryOverrides,
// avgDistanceByLeg, `dist[p,r]`/`dist[r,c]`, distances.json) is unambiguously
// "distance", not transport-coal's "cost" — verified directly, not assumed
// to transfer from transport-coal's decision. So the arc-value field here is
// `distance`, matching addedWarehouseSchema/distanceOverrideSchema's naming
// (pMedian.ts), not laneCostOverrideSchema's.
//
// No addedMines concept at all: `GOLD_MINES` is a single, fixed entity — the
// mine is never overridable (not a facility-location choice, confirmed
// against solve_two_echelon's own C2 constraint, which only ever iterates
// `refineries`, never `mines`).
const addedRefinerySchema = z.object({
  id: z.string().min(1),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  // No capacity field — this model's manifest already declares
  // capacityModes: [] (no per-refinery capacity concept anywhere in
  // solve_two_echelon; the only capacity-like constraint is "exactly one
  // refinery open", unrelated to this task).
  status: z.enum(["active", "forced_open", "inactive"]),
  // T11 — WarehousesTab.tsx (reused for entity="refineries" per B6.2) has
  // been minting displayCode on every added refinery since T9 landed; this
  // schema had nowhere to put it, so it was silently stripped on every
  // save (not `.strict()`, unknown keys drop rather than reject) until now.
  // See addedWarehouseSchema's own comment (pMedian.ts) for the full
  // rationale — same purely-cosmetic, never-a-join-key field.
  displayCode: z.string().optional(),
});

const addedCustomerSchema = z.object({
  id: z.string().min(1),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  demand: z.number().nonnegative(),
  // T11 — see addedRefinerySchema's own comment above.
  displayCode: z.string().optional(),
});

// {fromId, toId, distance} — ONE flat array covering BOTH legs (mine ->
// refinery and refinery -> customer), matching solve_two_echelon's own
// `dist` dict, which both legs already index into (`dist[p, r]`,
// `dist[r, c]`, both drawn from the SAME flat distances.json). Leg is
// resolved purely by which id-space fromId/toId each belong to (mine/
// refinery/customer are three disjoint id sets) — NOT a string-prefix
// convention, verified directly against solve_two_echelon rather than
// assumed from the plan text's "disambiguated by ID prefix" wording. This
// schema deliberately carries no separate `leg` field: merge_inputs.py's
// build_merged_two_echelon_dataset (B6.2 stage 2) does the resolution and
// rejects a pair that doesn't cleanly match either leg shape (e.g.
// mine->customer, skipping a leg entirely, or a backwards refinery->mine
// pair).
const distanceOverrideSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  distance: z.number().positive(),
});

function distanceOverridePairKey(o: { fromId: string; toId: string }): string {
  return o.fromId + "|" + o.toId;
}

export const twoEchelonInputsSchema = z.object({
  // .gt(1), not .positive(): a ratio at or below 1 means refining creates mass.
  // Rejecting at the edge beats debugging a nonsensical optimum later.
  bomRatio: z.number().gt(1).max(10),
  refineryOverrides: z.array(z.object({
    id: z.string(),
    status: z.enum(["active", "forced_open", "inactive"]),
  })).default([]),
  customerOverrides: z.array(z.object({
    id: z.string(),
    demand: z.number().min(0).nullable().optional(),
    status: z.enum(["active", "excluded"]),
  })).default([]),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),   // required -- NaN here kills every solve
  addedRefineries: z.array(addedRefinerySchema).default([]),
  addedCustomers: z.array(addedCustomerSchema).default([]),
  distanceOverrides: z.array(distanceOverrideSchema)
    .default([])
    // Same DD-8 shape rule as pMedian.ts/transportLp.ts's own pair-
    // uniqueness refine — cheap to express here, cross-field/semantic
    // (reference integrity, completeness) checks stay B6.2 stage 3's
    // precheck.ts job, not this schema's.
    .refine(
      (overrides) => {
        const seen = new Set<string>();
        for (const o of overrides) {
          const key = distanceOverridePairKey(o);
          if (seen.has(key)) return false;
          seen.add(key);
        }
        return true;
      },
      { message: "distanceOverrides must not contain duplicate (fromId, toId) pairs" },
    ),
});

export type TwoEchelonInputs = z.infer<typeof twoEchelonInputsSchema>;
