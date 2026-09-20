// E1.1 — distance bands are presentation state: recompute band assignment
// and coverage client-side from a solved result's `edges`, never by
// re-solving.
//
// computeBandCoverage is EXCLUSIVE, not cumulative: each band counts only
// the flow strictly beyond the previous boundary and up to its own (a
// half-open bucket (prevBand, thisBand]), so a route already counted in a
// lesser band is excluded from every greater band's count. This is a
// client-side-only reporting lens — solve.py's own bandCoverage (unused by
// the frontend, which always recomputes from `edges` here) is untouched.
//
// T1b (chen-bands-units) — `OVERFLOW_BAND`, `assignBandOrOverflow`,
// `computeCumulativeBandCoverage`, `serviceEdgesFor`, `BandEdge`,
// `BandCoverageEntry`, and `bandLabelOrOverflow` (re-exported here under this
// module's established name `bandLabel`) now live in `@workspace/units`,
// shared with the API server's export builders — this file thinly re-exports
// them below so every existing import path (`@/lib/bands`) keeps working
// with zero call-site edits, while genuinely frontend-only helpers
// (`DEFAULT_DISTANCE_BANDS`, `computeAutoBands`, the legacy non-overflow
// `assignBand`, the legacy exclusive `computeBandCoverage`, and
// `bandRangeLabel`) stay local. See `__tests__/bandsSingleSource.test.ts` for
// the reference-identity regression guard against a re-implementation
// silently drifting from the shared classifier.
import {
  OVERFLOW_BAND,
  assignBandOrOverflow,
  computeCumulativeBandCoverage,
  serviceEdgesFor,
  bandLabelOrOverflow,
  type BandEdge,
  type BandCoverageEntry,
} from "@workspace/units";

export {
  OVERFLOW_BAND,
  assignBandOrOverflow,
  computeCumulativeBandCoverage,
  serviceEdgesFor,
  type BandEdge,
  type BandCoverageEntry,
};

// This frontend's established name for the shared label helper.
export { bandLabelOrOverflow as bandLabel };

// A3.1 (DD-5) — default distance-band cut points for a scenario that hasn't
// configured its own yet (Optimization Parameters tab's distanceBands is
// empty). Wireframe default (250/500/750 mi), used ONLY as a display
// fallback for band-colored lane rendering — bands stay fully
// student-editable via distanceBandsFromInputs's normal round-trip; this
// constant is never written back onto a scenario's saved inputs.
export const DEFAULT_DISTANCE_BANDS = [250, 500, 750];

// Exclusive bucket: first band boundary the distance fits under, or the
// last band if it exceeds every boundary. Used for route/marker coloring.
export function assignBand(distance: number, bands: number[]): number {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = sorted.findIndex((b) => distance <= b);
  return idx === -1 ? sorted.length - 1 : idx;
}

// Rounds a raw step up to the nearest "nice" 1/2/5 * 10^k value, so
// auto-fit bands read like 500/1000/1500 rather than 483/966/1449.
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const fraction = raw / magnitude;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * magnitude;
}

// Derives `count` equal-width band boundaries spanning 0..max(edge distance)
// from a just-solved result, instead of relying on a manifest's static
// default (which has to be hand-sized per model's geography — see
// model-integration-precheck.md Gate 4 — and can mismatch the dataset's
// actual distance range). Returns [] when there's nothing to fit (no edges,
// or every edge at distance 0) so callers can leave the existing bands alone.
export function computeAutoBands(edges: BandEdge[], count = 5): number[] {
  const maxDistance = edges.reduce((max, e) => Math.max(max, e.distance), 0);
  if (maxDistance <= 0) return [];
  const step = niceStep(maxDistance / count);
  return Array.from({ length: count }, (_, i) => Math.round((i + 1) * step));
}

// Exclusive: percent of total flow with prevBoundary < distance <= band —
// flow already counted toward a lesser band is never counted again here.
export function computeBandCoverage(edges: BandEdge[], bands: number[]): BandCoverageEntry[] {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const totalFlow = edges.reduce((sum, e) => sum + e.flow, 0);
  return sorted.map((band, i) => {
    if (totalFlow === 0) return { band, percent: 0 };
    const lowerBound = i === 0 ? 0 : sorted[i - 1];
    const flowWithin = edges
      .filter((e) => e.distance > lowerBound && e.distance <= band)
      .reduce((sum, e) => sum + e.flow, 0);
    return { band, percent: Math.round((flowWithin * 100) / totalFlow) };
  });
}

// Workspace fixups bundle 2 (T1, item 6) — a unit-aware distance-band RANGE
// label ("Band 1: 0 mi - 250 mi", "Band 2: 250 mi - 500 mi",
// "Band 5: > 1000 mi"), for use as a filterable value in a table's band
// column instead of the opaque `bandLabel` "Band N"/"Overflow" index. Built
// on the same assignBandOrOverflow classification (sorted boundaries, <=
// semantics, OVERFLOW_BAND sentinel) so a distance's range label always
// matches its bandLabel/map-color bucket. Keeps the band NUMBER (present in
// `bandLabel`) alongside the range, unlike the prior bundle's plain
// "≤ 250 mi" / "250–500 mi" format. Only FilterMenu options use this — table
// CELLS stay on the unmodified `bandLabel` ("Band N" / "Overflow").
//
// T1b note: takes a raw `unit` string with no km/mi display-toggle awareness
// yet — that wiring is a later task's job, not this one's; signature and
// behavior are unchanged here.
export function bandRangeLabel(distance: number, bands: number[], unit: string): string {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return "All distances";
  const index = assignBandOrOverflow(distance, sorted);
  if (index === OVERFLOW_BAND) return `Band ${sorted.length + 1}: > ${sorted[sorted.length - 1]} ${unit}`;
  if (index === 0) return `Band 1: 0 ${unit} - ${sorted[0]} ${unit}`;
  return `Band ${index + 1}: ${sorted[index - 1]} ${unit} - ${sorted[index]} ${unit}`;
}
