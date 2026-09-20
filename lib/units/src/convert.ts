export type CanonicalUnit = "km" | "mi";
export type DisplayUnitPref = "auto" | CanonicalUnit;

/** Exact, by definition. The single source of this constant in the whole repo. */
export const KM_PER_MI = 1.609344;

export function effectiveUnit(pref: DisplayUnitPref, canonical: CanonicalUnit): CanonicalUnit {
  return pref === "auto" ? canonical : pref;
}

/** canonical value -> the unit we want to SHOW it in. Identity when they match. */
export function toDisplay(canonicalValue: number, canonical: CanonicalUnit, target: CanonicalUnit): number {
  if (canonical === target) return canonicalValue;
  return canonical === "km" ? canonicalValue / KM_PER_MI : canonicalValue * KM_PER_MI;
}

/** a number the user TYPED (in `display`) -> the model's canonical unit. Identity when they match. */
export function fromDisplay(displayValue: number, display: CanonicalUnit, canonical: CanonicalUnit): number {
  if (display === canonical) return displayValue;
  return display === "km" ? displayValue / KM_PER_MI : displayValue * KM_PER_MI;
}

/** Spec Part E: exported distances serialize at 4 decimal places. */
export function roundForFile(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
