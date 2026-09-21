// ch4-fixes item 4 — the ONE display formatter for a distance shown in a
// Distances-tab grid: thousands-grouped, at most 2 decimal places.
//
// Deliberately separate from `@workspace/units`' `roundForFile` (4 dp, no
// grouping), which is the SERIALIZATION contract for exports (spec Part E)
// and must not change: a file round-trips through a parser, a grid cell is
// read by a human. Mixing the two would either put commas in a CSV or drop
// two real digits from every exported override.
//
// Scope note: this is display-only and opt-in. It never touches a canonical
// stored value, and it is NOT applied to the distance inputs outside the
// Distances tabs (SolveDialog / OptimizationParametersTab / WarehouseTable /
// CustomerTable / BandChipEditor all keep raw text) — see
// `useDistanceDraft`'s `presentation` option.

/** A display-unit distance -> "12,004.8" / "1,234.57" / "892". */
export function formatDistanceDisplay(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Inverse-ish helper for the write path: strip the grouping separators a
 * formatted value carries so a typed/pasted "1,234.5" still satisfies the
 * `COMPLETE_NUMBER` grammar. Only commas are removed — a decimal POINT is
 * meaningful and never touched.
 */
export function stripGrouping(text: string): string {
  return text.replace(/,/g, "");
}
