import { z } from "zod";

const warehouseOverrideSchema = z.object({
  id: z.string(),
  capacity: z.number().positive().nullable().optional(),
  status: z.enum(["active", "forced_open", "inactive"]),
});

const customerOverrideSchema = z.object({
  id: z.string(),
  demand: z.number().nonnegative().nullable().optional(),
  status: z.enum(["active", "excluded"]),
});

// SCN v0.3 Phase B (B1.1, DD-1/DD-8) - scenario-local network edits. These
// three families live entirely inside the opaque `inputs` blob (no dataset
// file is ever written, no DB schema change). Optional-with-empty-default
// and NOT `.strict()`: an old scenario missing these keys still validates
// (default `[]`), and unknown keys elsewhere in `inputs` are stripped, not
// rejected - this is what makes B7.1's rollback strip script a safe,
// non-crashing downgrade rather than a hard break. Shape rules only here
// (non-empty IDs, positive distance); cross-field/semantic checks (e.g. does
// this ID already exist in the dataset) are B2.1's job, not this schema's.
const addedWarehouseSchema = z.object({
  id: z.string().min(1),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  capacity: z.number().positive().nullable().optional(),
  status: z.enum(["active", "forced_open", "inactive"]),
});

const addedCustomerSchema = z.object({
  id: z.string().min(1),
  city: z.string(),
  lat: z.number(),
  lng: z.number(),
  demand: z.number().nonnegative(),
});

const distanceOverrideSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  distance: z.number().positive(),
});

function distanceOverridePairKey(o: { fromId: string; toId: string }): string {
  return o.fromId + "|" + o.toId;
}

export const pMedianInputsSchema = z.object({
  p: z.number().int().min(1).max(50),
  capacityMode: z.enum(["none", "uniform", "per_wh"]),
  uniformCapacity: z.number().positive().nullable().optional(),
  warehouseOverrides: z.array(warehouseOverrideSchema).default([]),
  customerOverrides: z.array(customerOverrideSchema).default([]),
  distanceBands: z.array(z.number().int().positive()).min(1),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1),
  // p-median-brazil only (solve_capacitated_pmedian reads this; plain
  // p-median's dispatch ignores it). Kept on the shared schema per D0.3
  // rather than forking a second validator for one extra field.
  singleSource: z.boolean().optional(),
  addedWarehouses: z.array(addedWarehouseSchema).default([]),
  addedCustomers: z.array(addedCustomerSchema).default([]),
  distanceOverrides: z.array(distanceOverrideSchema)
    .default([])
    // Plan's task table says "pairs unique" - cheap to express here with a
    // Set, so it stays a schema-level shape rule rather than deferring to
    // B2.1's semantic precheck.
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

export type PMedianInputs = z.infer<typeof pMedianInputsSchema>;
