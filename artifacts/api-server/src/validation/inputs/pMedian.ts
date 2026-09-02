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
  // T1 (Input Map v2) — a short human-facing label distinct from the stable
  // `id` join key (e.g. an auto-generated code shown in the map/table UI
  // before a student renames it). Purely cosmetic, never resolved as a join
  // key anywhere — `id` remains the only stable reference.
  displayCode: z.string().optional(),
});

const addedCustomerSchema = z.object({
  id: z.string().min(1),
  city: z.string(),
  // Task 26 — matches addedWarehouseSchema's `state` field exactly (same
  // required-non-optional shape). Base customers.json already carries a real
  // `state` per row; this closes the asymmetry where an added customer had
  // nowhere to store one. Required rather than optional/defaulted: this
  // feature is brand new (no production scenarios have addedCustomers
  // populated yet — the frontend that lets students add customers doesn't
  // exist until B5.2), so there's no old-scenario-data backward-compat case
  // to protect, and required matches the warehouse precedent.
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  demand: z.number().nonnegative(),
  // T1 (Input Map v2) — see addedWarehouseSchema's `displayCode` comment.
  displayCode: z.string().optional(),
  // Bundle 2.2 (B2.2-T1, A3 backend) — Active/Excluded on a user-added
  // customer. This schema is shared by p-median-us AND p-median-brazil
  // (same PMedianInputs type), so accepting the field here is model-agnostic
  // by design; whether it actually *does* anything (solver payload +
  // precheck "active" set) is gated separately on the model manifest's
  // `capabilities.supportsAddedCustomerExclusion` (true for p-median-us,
  // false for p-median-brazil — see solver/pmedian.ts buildPayload and
  // services/precheck.ts) rather than on this schema. Optional-with-default
  // "active": every existing scenario's addedCustomers rows (written before
  // this field existed) still validate unchanged.
  status: z.enum(["active", "excluded"]).default("active"),
});

const distanceOverrideSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  distance: z.number().positive(),
  // T1 (Input Map v2) — true when this row was auto-filled by
  // services/autoDistance.ts's haversine normalizer rather than entered/
  // imported by a student. Purely informational (e.g. lets the UI show an
  // "estimated" badge); never read by the solver or by any validation rule.
  estimated: z.boolean().optional(),
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
