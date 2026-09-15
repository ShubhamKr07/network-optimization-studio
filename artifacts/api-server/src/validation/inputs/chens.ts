import { z } from "zod";

// C4.6 — Chen's Cosmetics (`chens-cosmetics-cn`, Chapter 4) scenario `inputs`
// validator. A China single-echelon warehouse->customer service-level model
// with TWO coupled objectives behind one `objective` mode toggle:
//   - "coverage"      maximize demand within highServiceDistKm, subject to a
//                     weighted-average service-distance cap (avgServiceDistCapKm).
//   - "min_distance"  minimize total demand-weighted distance, subject to a
//                     demand-coverage floor (coverageFloorDemand).
//
// Mirrors the scenario-local-edit shape every other model already speaks
// (warehouseOverrides / customerOverrides / addedWarehouses / addedCustomers /
// distanceOverrides), keyed by direct string ids (`wh-<n>` / `cs-<n>`, DD-2 —
// like p-median-brazil / transport-coal / two-echelon-gold-au, NOT the
// p-median-us id<->index bridge). Deviates from p-median ONLY by dropping
// warehouse `capacity`/`uniformCapacity` (Chen has no capacity concept — the
// manifest declares `capacityModes: ["none"]`).
//
// Demand is the integer domain (D30): notebook demands are integers (people/
// product), so `customerOverrides[].demand`, `addedCustomers[].demand`, and
// `coverageFloorDemand` are all `z.number().int().nonnegative()`.

// Warehouse override — id + status only. NO capacity (Chen has none), the one
// structural difference from p-median's warehouseOverrideSchema.
const warehouseOverrideSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "forced_open", "inactive"]),
});

const customerOverrideSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "excluded"]),
  // Integer per D30. Optional/sparse — only a customer whose demand is being
  // overridden carries a value; required shape stays [id, status].
  demand: z.number().int().nonnegative().optional(),
});

const addedWarehouseSchema = z.object({
  id: z.string().min(1),
  // Purely-cosmetic label distinct from the stable `id` join key — never
  // resolved as a join key anywhere (same precedent as pMedian.ts).
  displayCode: z.string().optional(),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  // No capacity field (Chen has none) — the one difference from an added
  // p-median warehouse.
  status: z.enum(["active", "forced_open", "inactive"]),
});

const addedCustomerSchema = z.object({
  id: z.string().min(1),
  displayCode: z.string().optional(),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  demand: z.number().int().nonnegative(),
  // Optional-with-default "active" — Chen advertises
  // `capabilities.supportsAddedCustomerExclusion: true`, so an added customer
  // can be Excluded; back-compat default is "active".
  status: z.enum(["active", "excluded"]).default("active"),
});

const distanceOverrideSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  // RAW km, strictly positive (solve_chens applies ×1.17 circuity, D8).
  distance: z.number().positive(),
  // Informational: true when auto-filled by the added-entity estimator
  // (services/autoDistance.ts, C4.7) rather than entered/imported. Never read
  // by the solver or by any validation rule.
  estimated: z.boolean().optional(),
});

function distanceOverridePairKey(o: { fromId: string; toId: string }): string {
  return o.fromId + "|" + o.toId;
}

export const chensInputsSchema = z
  .object({
    objective: z.enum(["coverage", "min_distance"]),
    p: z.number().int().min(1).max(25),
    // RAW km thresholds. `.transform` below overwrites `distanceBands` to
    // `[highServiceDistKm, maxDistKm]` (D19); the cross-field
    // `highServiceDistKm < maxDistKm` is enforced in `.superRefine`.
    highServiceDistKm: z.number().positive(),
    maxDistKm: z.number().positive(),
    // Objective-discriminated: required iff coverage (superRefine below).
    avgServiceDistCapKm: z.number().positive().optional(),
    // Objective-discriminated: required iff min_distance (superRefine below).
    // Integer demand domain (D30).
    coverageFloorDemand: z.number().int().nonnegative().optional(),
    gap: z.number().min(0),
    timeLimitSec: z.number().int().min(1),
    // Chen has no capacity concept — persisted as "none" (defaulted so an
    // omitting client still stores it explicitly).
    capacityMode: z.literal("none").default("none"),
    // Input is ignored: the `.transform` overwrites it to
    // `[highServiceDistKm, maxDistKm]` (D19). Lenient/optional so a stale
    // third boundary (or an absent field) is never a 422 — it is simply
    // recomputed from the two thresholds.
    distanceBands: z.array(z.number()).optional(),
    warehouseOverrides: z.array(warehouseOverrideSchema).default([]),
    customerOverrides: z.array(customerOverrideSchema).default([]),
    addedWarehouses: z.array(addedWarehouseSchema).default([]),
    addedCustomers: z.array(addedCustomerSchema).default([]),
    distanceOverrides: z
      .array(distanceOverrideSchema)
      .default([])
      // Same DD-8 pair-uniqueness shape rule as pMedian.ts (message copied
      // verbatim); cross-field/semantic checks (reference integrity,
      // completeness) stay precheck.ts's job (C4.8), not this schema's.
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
  })
  .superRefine((v, ctx) => {
    if (v.highServiceDistKm >= v.maxDistKm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "highServiceDistKm must be less than maxDistKm",
        path: ["highServiceDistKm"],
      });
    }
    if (v.objective === "coverage" && v.avgServiceDistCapKm == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "avgServiceDistCapKm is required when objective is coverage",
        path: ["avgServiceDistCapKm"],
      });
    }
    if (v.objective === "min_distance" && v.coverageFloorDemand == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "coverageFloorDemand is required when objective is min_distance",
        path: ["coverageFloorDemand"],
      });
    }
  })
  // D19: distanceBands is a pure derivation of the two thresholds — never a
  // separately-authored field. Overwriting here (after validation) guarantees
  // the STORED inputs.distanceBands is always exactly [high, max], so a stale
  // third boundary sent by any write path (POST/PATCH/import-apply) can never
  // persist.
  .transform((v) => ({
    ...v,
    distanceBands: [v.highServiceDistKm, v.maxDistKm],
  }));

export type ChensInputs = z.infer<typeof chensInputsSchema>;
