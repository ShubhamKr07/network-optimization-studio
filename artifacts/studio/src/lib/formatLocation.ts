// ch4-tab-city-labels — shared city/state display formatter. Every shipped
// dataset carries a non-blank state for every row (measured 2026-09-28,
// across all six models, including max-coverage-us since its US dataset
// swap) — this blank-state fallback is defensive, not a live case: a future
// dataset or a scenario-added entity that omits state would otherwise
// render `${city}, ${state}` with a trailing ", " and nothing after it.
// This is the single seam every `locationById`-consuming cell (JadeDistancesTab,
// DistancesTab, OpenWarehousesTab, AssignmentsTab, CapabilityMatrixTab) should
// route through, so the city-only fallback applies once and stays consistent.
export function formatCityState(city: string, state: string): string {
  return state ? `${city}, ${state}` : city;
}

// Shared "<id> — City, State" formatter for the 3 named output/matrix surfaces
// (JadeFlowsTab P->W Plant column, ServiceStatsTab Plant Production, CapabilityMatrixTab
// per-plant row) per SCN v0.3 workspace-fixups item 2. `name` is intentionally never shown —
// `name?` is kept in the param type only so a caller passing a full Plant object (which may
// carry `name`) doesn't hit a TS excess-property error, and so the "name is ignored" contract
// is documented at the type level.
export function plantIdCityState(plant: {
  id: string;
  city: string;
  state: string;
  name?: string;
}): string {
  return `${plant.id} — ${formatCityState(plant.city, plant.state)}`;
}
