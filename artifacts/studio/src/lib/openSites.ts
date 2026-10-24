// QFX-8 — the ONE per-model authority for "which sites did this solve open",
// shared by the Output Map narrative (resultNarrative.ts) and its caption
// (OpenSitesCaption.tsx). Extracted unchanged from buildResultNarrative:
//   - super-model: metrics.openFacilityIds only (SM-8).
//   - every other model: details.openWarehouseIds, else metrics.openFacilityIds.
//     transport-coal's openWarehouseIds are MINES (solve.py:687); JADE emits
//     both fields with the same ids (solve.py:1367,1379).
// null = the field is absent or malformed (the narrative then renders
// nothing); [] = the solve genuinely opened nothing.

function stringIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(v => typeof v === "string") ? (value as string[]) : null;
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

export function openSiteIds(result: unknown, modelId: string): string[] | null {
  const facilities = stringIds(field(field(result, "metrics"), "openFacilityIds"));
  if (modelId === "super-model") return facilities;
  return stringIds(field(field(result, "details"), "openWarehouseIds")) ?? facilities;
}

// Decision L3 — the caption's noun, keyed by modelId.
export const OPEN_SITE_NOUN: Record<string, string> = {
  "p-median-us": "Open warehouses",
  "p-median-brazil": "Open warehouses",
  "max-coverage-us": "Open warehouses",
  "delivery-teaching-us": "Open warehouses",
  "transport-coal": "Open mines",
  "two-echelon-gold-au": "Open facilities",
  "two-echelon-jade-us": "Open facilities",
  "super-model": "Open facilities",
};
export const OPEN_SITE_NOUN_FALLBACK = "Open sites";
