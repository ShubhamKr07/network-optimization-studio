import { type CanonicalUnit, toDisplay } from "./convert.js";

export type ObjectiveDimension =
  | "demand-distance"
  | "flow-distance"
  | "truckload-distance"
  | "distance"
  | "monetary"
  | "percent"
  | "opaque";

/**
 * The ONLY place in the repo where `modelId` determines unit semantics.
 * Verified against solve.py: p-median demand*distance (270-271, 614-619);
 * transport lane value*flow where lane values are geographic miles (439,
 * transportLp.ts:18-25); gold distance*flow/truckload-kg (792-793); jade
 * $/ton-mile + minimum charges (991-1010) — genuinely monetary; Chen
 * coverage % vs min_distance demand*distance.
 */
export function objectiveDimension(modelId: string, objectiveMode: string | null): ObjectiveDimension {
  switch (modelId) {
    case "p-median-us":
    case "p-median-brazil":
      return "demand-distance";
    case "transport-coal":
      return "flow-distance";
    case "two-echelon-gold-au":
      return "truckload-distance";
    case "two-echelon-jade-us":
      return "monetary";
    case "chens-cosmetics-cn":
      return objectiveMode === "coverage" ? "percent" : "demand-distance";
    default:
      return "opaque";
  }
}

const CONVERTING: ReadonlySet<ObjectiveDimension> = new Set([
  "demand-distance", "flow-distance", "truckload-distance", "distance",
]);

export function objectiveConverts(dim: ObjectiveDimension): boolean {
  return CONVERTING.has(dim);
}

/** Every converting dimension is linear in distance, so one scale factor serves all. */
export function convertObjective(
  value: number, dim: ObjectiveDimension, canonical: CanonicalUnit, target: CanonicalUnit,
): number {
  return objectiveConverts(dim) ? toDisplay(value, canonical, target) : value;
}
