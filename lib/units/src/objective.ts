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
 * $/ton-mile + minimum charges (991-1010) — genuinely monetary;
 * max-coverage-us coverage % vs min_distance demand*distance.
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
    case "max-coverage-us":
      return objectiveMode === "coverage" ? "percent" : "demand-distance";
    case "delivery-teaching-us":
      // A cost value is billable miles. With the adjustment OFF the objective
      // is billable-miles x demand; with it ON the rate turns it into dollars.
      // Missing this case renders the objective through `default: "opaque"` as
      // a bare unit-less number - no error, no failing test.
      return objectiveMode === "cost_adjusted" ? "monetary" : "demand-distance";
    default:
      return "opaque";
  }
}

/**
 * The ONE rule mapping max-coverage-us's coverage floor to its objective mode.
 * Lives in @workspace/units because both artifacts/api-server (which derives
 * and persists it) and artifacts/studio (which displays which model will run)
 * depend on this package. A UI copy of this rule is how a label and the solve
 * that actually ran came to be able to disagree under the old two-step flow.
 *
 * solve.py derives the same rule independently (it cannot import TypeScript);
 * test_max_coverage.py pins the two against each other.
 */
export function deriveMaxCoverageObjective(coverageFloorDemand: number): "coverage" | "min_distance" {
  return coverageFloorDemand === 0 ? "coverage" : "min_distance";
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
