// DU-2.1 — the display formatter for EVERY displayed distance (grids, chips,
// map popups, narrative): thousands-grouped, at most 2 decimal places, en-US
// pinned. It is a re-export of the `@workspace/units` authority so the server
// exports (DU-4.2) share the same number text.
//
// Deliberately separate from `roundForFile` (4 dp, no grouping), the
// SERIALIZATION contract for exports, which must not change.
//
// Scope note: display-only. It is NOT applied to editable distance inputs
// (SolveDialog / OptimizationParametersTab / WarehouseTable / CustomerTable /
// BandChipEditor keep raw text) — see `useDistanceDraft`'s `presentation`.
export { formatDistanceNumber as formatDistanceDisplay } from "@workspace/units";

/**
 * Inverse-ish helper for the write path: strip the grouping separators a
 * formatted value carries so a typed/pasted "1,234.5" still satisfies the
 * `COMPLETE_NUMBER` grammar. Only commas are removed — a decimal POINT is
 * meaningful and never touched.
 */
export function stripGrouping(text: string): string {
  return text.replace(/,/g, "");
}
