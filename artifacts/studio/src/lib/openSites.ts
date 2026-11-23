// QFX-8 — the ONE per-model authority for "which sites did this solve open",
// used by the Output Map narrative (resultNarrative.ts). Extracted unchanged from buildResultNarrative:
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
