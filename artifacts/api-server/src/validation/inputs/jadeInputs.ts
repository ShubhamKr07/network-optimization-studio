import { z } from "zod";

// jade-T5 — scenario-local inputs for two-echelon-jade-us (Chapter 9, JADE
// Investment Decision: plant -> warehouse -> customer, multi-product,
// single-source). Mirrors twoEchelon.ts/pMedian.ts's established shape
// (optional-with-empty-default array families, no `.strict()` — unknown
// keys strip rather than reject, DD-8) but has a genuinely different shape
// on top of that shared skeleton:
//   - warehouses are the ONLY overridable facility-location echelon
//     (`warehouseOverrides`/`addedWarehouses`, mirroring pMedian's own
//     vocabulary) — plants are never force-open/inactive (solve_jade has no
//     facility_vars for plants at all, confirmed directly against solve.py:
//     only `warehouses` gets an `Open` binary).
//   - `addedPlants` carries no `status` field for the same reason — an
//     added plant's only lever is `plantProductCapability`/
//     `capabilityOverrides` (which product(s) it can make), matching
//     merge_inputs.py's build_merged_jade_dataset (an added plant defaults
//     every capability cell to 0/disabled; a capability override is the
//     only way to turn one on).
//   - `plantProductCapability[]` (wire name `capabilityOverrides` — see
//     solver/pmedian.ts's buildPayload) is a whole new entity family this
//     model introduces: a plant x product "can-make" toggle, unrelated to
//     any prior model's override vocabulary.
//   - demand is multi-product: `customerOverrides[].demands` is a SPARSE
//     per-product override (omitted product keys inherit the base
//     customer's own per-product demand — mirrors get_demands()'s "layer a
//     sparse per-product override onto base demands" merge in solve.py),
//     but `addedCustomers[].demands` is REQUIRED-COMPLETE (all 4 canonical
//     product ids) because an added customer has no base record to inherit
//     from at all — build_merged_jade_dataset uses the added customer's
//     `demands` dict as-is with no base to layer onto, so a missing product
//     key there would silently mean "zero demand for that product" with no
//     signal to the student that they forgot it.
//   - `distanceOverrides[]` carries an explicit `leg` field (unlike
//     two-echelon-gold-au's purely id-space-inferred leg resolution) —
//     confirmed against merge_inputs.py's build_merged_jade_dataset, which
//     validates the declared `leg` against the ACTUAL id-space membership of
//     `fromId`/`toId` (defense in depth), because JADE's plant/warehouse/
//     customer id spaces are not guaranteed to stay mutually exclusive the
//     way mine/refinery/customer are today once entities can be added freely
//     across three roles.

// The 4 canonical, fixed product ids (JADE_PRODUCTS in solve.py / products.json)
// — there is no `addedProducts` concept anywhere in the spec, so this is a
// closed, hardcoded set, not derived from any request-time data.
const JADE_PRODUCT_IDS = ["product-1", "product-2", "product-3", "product-4"] as const;

const warehouseOverrideSchema = z.object({
  id: z.string(),
  // No capacity field: this model's manifest declares capacityModes: []
  // (warehouse capacity isn't a concept here — plant-product capability is
  // the only supply-side capacity constraint).
  status: z.enum(["active", "forced_open", "inactive"]),
});

// Sparse per-product override on a BASE customer: omitted product keys
// inherit that customer's own base demand for that product (get_demands()'s
// merge in solve.py). Not restricted to the 4 known product ids at the
// shape layer — an unknown product key is harmless (solve.py's `.get(k, 0)`
// lookups are keyed by the real product_ids list, so a stray key is simply
// never read); reference-integrity checks belong to T6's semantic precheck,
// not this schema.
const customerOverrideSchema = z.object({
  id: z.string(),
  demands: z.record(z.string(), z.number().nonnegative()).optional(),
  status: z.enum(["active", "excluded"]),
});

// {plantId, productId, enabled} — the plant x product "can-make" toggle.
// Pair-unique on (plantId, productId), same cheap shape-level Set-based
// dedupe convention as every prior *OverrideSchema pair-uniqueness refine in
// this codebase (see distanceOverridePairKey below).
const plantProductCapabilitySchema = z.object({
  plantId: z.string().min(1),
  productId: z.string().min(1),
  enabled: z.boolean(),
});

function capabilityPairKey(o: { plantId: string; productId: string }): string {
  return o.plantId + "|" + o.productId;
}

// No `status`/`capacity` field — see the file-level comment above: plants
// have no facility-open concept in this model, only a capability toggle
// (plantProductCapability), which an added plant participates in the same
// way a base plant does (merge_inputs.py's added_plants_by_id/
// merged_capability cross product covers both uniformly).
const addedPlantSchema = z.object({
  id: z.string().min(1),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  displayCode: z.string().optional(),
});

// No `capacity` field: same "capacityModes: []" reasoning as
// warehouseOverrideSchema above.
const addedWarehouseSchema = z.object({
  id: z.string().min(1),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  status: z.enum(["active", "forced_open", "inactive"]),
  displayCode: z.string().optional(),
});

// `demands` is REQUIRED and must carry all 4 canonical product ids — an
// added customer has no base record to inherit a missing product's demand
// from (unlike customerOverrideSchema's sparse override above), so an
// incomplete demands object would silently mean "zero demand," with no
// signal that a product key was forgotten. Built from JADE_PRODUCT_IDS
// rather than hand-listing four object keys, so the one place this list
// changes is the constant above.
const jadeDemandsSchema = z.object(
  Object.fromEntries(
    JADE_PRODUCT_IDS.map((productId) => [productId, z.number().nonnegative()]),
  ) as Record<(typeof JADE_PRODUCT_IDS)[number], z.ZodNumber>,
);

const addedCustomerSchema = z.object({
  id: z.string().min(1),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
  demands: jadeDemandsSchema,
  displayCode: z.string().optional(),
  status: z.enum(["active", "excluded"]).default("active"),
});

// Explicit `leg` (unlike two-echelon-gold-au's inferred-from-id-space
// resolution) — see the file-level comment above for why. Pair-unique per
// (leg, fromId, toId): the SAME (fromId, toId) pair could theoretically
// collide across a future added-entity edge case, so the key includes leg
// defensively even though today's disjoint id spaces make that redundant.
const distanceOverrideSchema = z.object({
  leg: z.enum(["plant_to_warehouse", "warehouse_to_customer"]),
  fromId: z.string().min(1),
  toId: z.string().min(1),
  distance: z.number().nonnegative(),
  // True when this row was auto-filled by the auto-estimate normalizer
  // rather than entered/imported by a student. Purely informational, same
  // precedent as pMedian.ts/twoEchelon.ts's own `estimated` field.
  estimated: z.boolean().optional(),
});

function distanceOverridePairKey(o: { leg: string; fromId: string; toId: string }): string {
  return o.leg + "|" + o.fromId + "|" + o.toId;
}

export const jadeInputsSchema = z.object({
  // No static max (unlike pMedian's p.max(50)) — the semantic max (effective
  // active warehouse count incl. added) is a T6 precheck concern, not a
  // shape rule.
  p: z.number().int().min(1),
  distanceBands: z
    .array(z.number().int().positive())
    .min(1)
    .refine(
      (bands) => bands.every((b, i) => i === 0 || b > bands[i - 1]),
      { message: "distanceBands must be one or more strictly-ascending positive integers" },
    ),
  gap: z.number().min(0),
  timeLimitSec: z.number().int().min(1), // required -- NaN here kills every solve
  warehouseOverrides: z.array(warehouseOverrideSchema).default([]),
  customerOverrides: z.array(customerOverrideSchema).default([]),
  plantProductCapability: z.array(plantProductCapabilitySchema)
    .default([])
    .refine(
      (rows) => {
        const seen = new Set<string>();
        for (const r of rows) {
          const key = capabilityPairKey(r);
          if (seen.has(key)) return false;
          seen.add(key);
        }
        return true;
      },
      { message: "plantProductCapability must not contain duplicate (plantId, productId) pairs" },
    ),
  addedPlants: z.array(addedPlantSchema).default([]),
  addedWarehouses: z.array(addedWarehouseSchema).default([]),
  addedCustomers: z.array(addedCustomerSchema).default([]),
  distanceOverrides: z.array(distanceOverrideSchema)
    .default([])
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
      { message: "distanceOverrides must not contain duplicate (leg, fromId, toId) pairs" },
    ),
});

export type JadeInputs = z.infer<typeof jadeInputsSchema>;
