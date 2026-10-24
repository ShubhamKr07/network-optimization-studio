import {
  objectiveDimension,
  convertObjective,
  type CanonicalUnit,
  type ObjectiveDimension,
} from "@workspace/units";
import type { UnitApi } from "@/contexts/UnitContext";

// C4.14 (D14) — max-coverage-us reports its objective in
// two different UNITS depending on the solve mode, carried on the envelope's
// `details.objective` discriminator:
//   coverage      -> the objective IS a coverage percentage  (NN.NN %)
//   min_distance  -> the objective is total demand-weighted distance (demand-mi)
// Every other model (and Chen before it's solved) has no `details.objective`,
// so this returns null and each caller applies its own pre-existing default
// number format unchanged — a single source of truth for the two Chen modes,
// shared by ObjectiveBar, CostSummaryTab and Landing so the three never drift.
export function formatChenObjective(
  objective: number,
  objectiveMode: string | null | undefined,
): string | null {
  if (objectiveMode === "coverage") return `${objective.toFixed(2)} %`;
  if (objectiveMode === "min_distance") return `${objective.toExponential(2)} demand-mi`;
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

// The objective mode a solved scenario ran under, read off its own envelope.
// The `steps`-preferring version this replaces existed because Chapter 4 left
// `result` deliberately stale across a Step 1 edit, so `result.details` could
// report the mode of a solve that no longer counted. With no epoch there is no
// such state: a Chapter 4 result is current, or the scenario is `stale` by the
// ordinary staleness guard like every other model's.
export function scenarioObjectiveMode(
  input: { result?: { details?: unknown } | null } | null | undefined,
): string | null {
  return objectiveModeOfDetails(input?.result?.details);
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
    return formatMoney(converted);
  }
  if (dim === "percent") {
    return `${converted.toFixed(2)} %`;
  }
  if (dim === "opaque") {
    return converted.toLocaleString("en-US");
  }
  return `${converted.toLocaleString("en-US")} ${suffix}`;
}

const usd0 = (n: number) => Math.round(Math.abs(n)).toLocaleString("en-US");
/** DU-2.1 — full `$169,061,531` for tables; compact `$169.06M` for chips and the narrative. */
export function formatMoney(value: number, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const a = Math.abs(value);
  if (!opts?.compact) return `${sign}$${usd0(a)}`;
  // Tier on the ROUNDED value so $999,600 reads $1.00M, never $1,000K (NAR-1.R).
  if (a >= 999_995_000) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 999_500) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${usd0(a / 1e3)}K`;
  return `${sign}$${a.toFixed(2)}`;
}
