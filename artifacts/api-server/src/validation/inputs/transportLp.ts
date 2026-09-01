import { z } from "zod";

// SCN v0.3 Phase B, task B6.1 (fast-follow of B1.1/DD-8) — scenario-local
// network edits for transport-coal. Mirrors addedWarehouseSchema/
// addedCustomerSchema/distanceOverrideSchema (validation/inputs/pMedian.ts)
// exactly in spirit (optional-with-empty-default, no `.strict()`, shape
// rules only — cross-field/semantic checks are B6.1's precheck.ts job, not
// this schema's), but named for this model's own vocabulary:
//
//   - "mines" are the warehouse-equivalent, "stations" are the customer-
//     equivalent (verified directly against solve.py's solve_transport).
//   - Unlike addedWarehouseSchema, addedMineSchema has NO `status` field.
//     solve_transport has no forced-open/inactive-equivalent concept for
//     mines at all — mines.json carries no status column, and a "closed"
//     mine is expressed as a capacity override of 0 (templates.ts's own
//     precedent, see its MineOverride comment). Copying p-median's status
//     field here would be a field with no consumer.
//   - The arc-cost entity is named "lane costs" (matching costs.json and
//     the plan's own wording), not "distances" — even though the values
//     are geographically real distances in miles (verified against
//     _transport_distances()'s docstring and solve_transport's objective,
//     which is literally distance*flow, same concept as p-median's
//     objective), the model's own vocabulary (costs.json, "lane cost")
//     is what students see in this chapter's exercise, so the override
//     field is named `cost`, not `distance`.
// T11 (Step A) — `displayCode` mirrors pMedian.ts's own optional field on
// addedWarehouseSchema/addedCustomerSchema: a short human-facing label
// distinct from the stable `id` join key (MinesTab.tsx/StationsTab.tsx now
// mint it via T3's nextDisplayCode, same identity model as warehouses/
// customers). Purely cosmetic, never resolved as a join key anywhere.
const addedMineSchema = z.object({
  id: z.string().min(1),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  capacity: z.number().positive().nullable().optional(),
  displayCode: z.string().optional(),
});

const addedStationSchema = z.object({
  id: z.string().min(1),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  demand: z.number().nonnegative(),
  displayCode: z.string().optional(),
});

const laneCostOverrideSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  cost: z.number().positive(),
  // Follow-up item 3 (auto-estimate normalizer) — true when this row was
  // auto-filled by services/autoDistance.ts's fillEstimatedLaneCosts rather
  // than entered/imported by a student. Purely informational, same
  // precedent as pMedian.ts's distanceOverrideSchema.estimated; never read
  // by the solver or by any validation rule.
  estimated: z.boolean().optional(),
});

function laneCostOverridePairKey(o: { fromId: string; toId: string }): string {
  return o.fromId + "|" + o.toId;
}

export const transportLpInputsSchema = z.object({
  capacityFactor: z.number().positive(),
  singleSource: z.boolean(),
  capacityInactive: z.boolean(),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),
  mineCapacities: z.record(z.string(), z.number().nonnegative()).optional().default({}),
  stationDemands: z.record(z.string(), z.number().nonnegative()).optional().default({}),
  addedMines: z.array(addedMineSchema).default([]),
  addedStations: z.array(addedStationSchema).default([]),
  laneCostOverrides: z.array(laneCostOverrideSchema)
    .default([])
    .refine(
      (overrides) => {
        const seen = new Set<string>();
        for (const o of overrides) {
          const key = laneCostOverridePairKey(o);
          if (seen.has(key)) return false;
          seen.add(key);
        }
        return true;
      },
      { message: "laneCostOverrides must not contain duplicate (fromId, toId) pairs" },
    ),
});

export type TransportLpInputs = z.infer<typeof transportLpInputsSchema>;
