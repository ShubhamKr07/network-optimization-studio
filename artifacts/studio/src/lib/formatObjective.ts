import {
  objectiveDimension,
  convertObjective,
  type CanonicalUnit,
  type ObjectiveDimension,
} from "@workspace/units";
import type { UnitApi } from "@/contexts/UnitContext";
import type { ScenarioSteps } from "@workspace/api-client-react";

// C4.14 (D14) — max-coverage-us reports its objective in
// two different UNITS depending on the solve mode, carried on the envelope's
// `details.objective` discriminator:
//   coverage      -> the objective IS a coverage percentage  (NN.NN %)
//   min_distance  -> the objective is total demand-weighted distance (demand-km)
// Every other model (and Chen before it's solved) has no `details.objective`,
// so this returns null and each caller applies its own pre-existing default
// number format unchanged — a single source of truth for the two Chen modes,
// shared by ObjectiveBar, CostSummaryTab and Landing so the three never drift.
export function formatChenObjective(
  objective: number,
  objectiveMode: string | null | undefined,
): string | null {
  if (objectiveMode === "coverage") return `${objective.toFixed(2)} %`;
  if (objectiveMode === "min_distance") return `${objective.toExponential(2)} demand-km`;
  return null;
}

// Reads the mode discriminator off an opaque envelope `details` record.
// `details.objective` is the Chen mode string ("coverage" | "min_distance");
// absent (every non-Chen model) -> null.
export function objectiveModeOfDetails(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const raw = (details as { objective?: unknown }).objective;
  return typeof raw === "string" ? raw : null;
}

// ch4-2s-8 (Task 8, review finding A1) — CH4-12 says Chapter 4's UI must
// never read `scenario.result` for objective-mode discrimination.
// `objectiveModeOfDetails(scenario.result?.details)` alone was the pre-Task-8
// path; this wrapper prefers the per-step summaries instead (`steps.step2`
// if solved, else `steps.step1`) when `steps` is present, and falls back to
// the `result.details` path otherwise — byte-identical to before for every
// non-Chapter-4 caller (whose `steps` is always undefined).
//
// KNOWN GAP (documented, not silently swallowed): `GET /scenarios` — the
// list route `CostSummaryTab`'s compare-toggle list is built from — does NOT
// merge `steps` onto each row (Task 5's own deliberate N+1-avoidance
// decision; only the single-scenario `GET /scenarios/:id` does). So for a
// scenario sourced from that list, `steps` is always undefined here today,
// and this function falls back to the `result.details` path for it too. In
// practice this fallback still correctly discriminates for max-coverage-us:
// a scenario that has solved only Step 1 always carries
// `result.details.objective === "coverage"`, and one that has solved Step 2
// always carries `"min_distance"` — the two-step workflow never produces any
// other combination on a real scenario row. Making the list route carry
// `steps` too (closing this gap for real) is a backend/contract change out
// of this (frontend-only) task's scope — see Task 8's own report.
export function scenarioObjectiveModeCh4Aware(
  input: { steps?: ScenarioSteps | null; result?: { details?: unknown } | null } | null | undefined,
): string | null {
  if (!input) return null;
  if (input.steps) {
    const summary = input.steps.step2.solved ? input.steps.step2.summary : input.steps.step1.summary;
    if (summary) return summary.objective;
  }
  return objectiveModeOfDetails(input.result?.details);
}

// SCN chen-bands-units, Part D, decision 6 — the six-model objective-units
// contract. `@workspace/units` is the SINGLE authority for the
// (modelId, objectiveMode) -> dimension mapping and for the numeric
// conversion (`objectiveDimension`/`convertObjective`); this function only
// adds locale formatting and the suffix string on top. It holds no mapping
// of its own — the suffix below is keyed on the already-resolved
// `ObjectiveDimension`, never re-derived from `modelId` directly.
function suffixFor(dim: ObjectiveDimension, unit: CanonicalUnit): string {
  switch (dim) {
    case "demand-distance":
      return `demand-${unit}`;
    case "flow-distance":
      return `${unit}·units`;
    case "truckload-distance":
      return `truckload-${unit}`;
    case "distance":
      return unit;
    case "monetary":
      return "$";
    case "percent":
      return "%";
    case "opaque":
      return "";
  }
}

/**
 * All-model objective formatter (decision 6). Unlike `formatChenObjective`
 * (Chen-only, inferred from the mode discriminator alone), this covers all
 * six models and requires `modelId` to resolve the dimension. Routes the
 * dimension lookup and the numeric conversion through `@workspace/units`;
 * `canonicalUnit` is the model's canonical distance unit (manifest
 * `distanceUnit`), and `unit` supplies the caller's display preference
 * (typically `useDisplayUnit()`).
 */
export function formatObjective(
  modelId: string,
  objectiveMode: string | null,
  objective: number,
  canonicalUnit: CanonicalUnit,
  unit: UnitApi,
): string {
  const dim = objectiveDimension(modelId, objectiveMode);
  const target = unit.effectiveUnit(canonicalUnit);
  const converted = convertObjective(objective, dim, canonicalUnit, target);
  const suffix = suffixFor(dim, target);

  if (dim === "monetary") {
    return `$${converted.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (dim === "percent") {
    return `${converted.toFixed(2)} %`;
  }
  if (dim === "opaque") {
    return converted.toLocaleString();
  }
  return `${converted.toLocaleString()} ${suffix}`;
}
