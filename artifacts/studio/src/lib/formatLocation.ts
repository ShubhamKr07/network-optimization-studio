// ch4-tab-city-labels — shared city/state display formatter. JADE
// (two-echelon-jade-us) carries non-empty US states ("City, ST"); some
// models (formerly Chen's Cosmetics' China dataset; max-coverage-us has real
// US states) carry `state: ""` for every row — rendering `${city}, ${state}`
// unconditionally there would show a trailing ", " with nothing after it.
// This is the single seam every `locationById`-consuming cell (JadeDistancesTab,
// DistancesTab, OpenWarehousesTab, AssignmentsTab, CapabilityMatrixTab) should
// route through, so the city-only fix applies once and stays consistent.
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
