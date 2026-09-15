// ch4-tab-city-labels — shared city/state display formatter. JADE
// (two-echelon-jade-us) carries non-empty US states ("City, ST"); Chen
// (chens-cosmetics-cn) carries `state: ""` for every row (China dataset, no
// province backfill per this task's scope) — rendering `${city}, ${state}`
// unconditionally there would show a trailing ", " with nothing after it.
// This is the single seam every `locationById`-consuming cell (JadeDistancesTab,
// DistancesTab, OpenWarehousesTab, AssignmentsTab, CapabilityMatrixTab) should
// route through, so the city-only fix applies once and stays consistent.
export function formatCityState(city: string, state: string): string {
  return state ? `${city}, ${state}` : city;
}
