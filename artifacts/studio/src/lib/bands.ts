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
import { formatDistanceDisplay } from "@/lib/formatDistanceDisplay";
import {
  OVERFLOW_BAND,
  assignBandOrOverflow,
  computeCumulativeBandCoverage,
  computeExclusiveBandCoverage,
  frozenBandCoverageToExclusive,
  serviceEdgesFor,
  bandLabelOrOverflow,
  type BandEdge,
  type BandCoverageEntry,
  type FrozenBandShape,
} from "@workspace/units";

export {
  OVERFLOW_BAND,
  assignBandOrOverflow,
  computeCumulativeBandCoverage,
  computeExclusiveBandCoverage,
  frozenBandCoverageToExclusive,
  serviceEdgesFor,
  type BandEdge,
  type BandCoverageEntry,
  type FrozenBandShape,
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
  // SCU-2.R4 (decision A) — boundaries print through the app's one distance
  // formatter (<= 2 dp, thousands-grouped) so a km conversion reads "321.87 km".
  const f = (n: number) => `${formatDistanceDisplay(n)} ${unit}`;
  const index = assignBandOrOverflow(distance, sorted);
  if (index === OVERFLOW_BAND) return `Band ${sorted.length + 1}: > ${f(sorted[sorted.length - 1])}`;
  if (index === 0) return `Band 1: 0 ${unit} - ${f(sorted[0])}`;
  return `Band ${index + 1}: ${f(sorted[index - 1])} - ${f(sorted[index])}`;
}

// SCU-1.1 (spec B1.9) — band precision per model: delivery-teaching-us
// reports 2 dp (spec §5.7 of its own design); every other model's tests are
// pinned to integers. The single place this rule lives (it used to be inline
// in ServiceStatsTab.tsx).
export function bandDecimals(modelId: string | undefined): number {
  return modelId === "delivery-teaching-us" ? 2 : 0;
}

// SCU-1.1 (deviation 1) — the shape of a solved result's FROZEN
// metrics.bandCoverage, a fact about solve.py's output: JADE buckets each
// outbound lane exactly once (solve.py:1320-1327, :1381-1385); every other
// model accumulates cumulatively (solve.py:497-501, :670-673, :863-868,
// :1052-1076, :1633, :1842-1845).
export function frozenBandShape(modelId: string | undefined): FrozenBandShape {
  return modelId === "two-echelon-jade-us" ? "exclusive" : "cumulative";
}

// SCU-1.1 (spec B1.9 "Display") — one label per exclusive row, aligned with
// computeExclusiveBandCoverage / frozenBandCoverageToExclusive output:
// "0–200 mi", "200–400 mi", …, "> 1,600 mi". `toDisplay` converts a CANONICAL
// boundary to the display unit (the caller's useDisplayUnit); `unit` is the
// display unit label.
// SCU-2.P3.9 (user decision 2026-10-17) — every boundary is printed with the
// app's one distance display formatter, `formatDistanceDisplay` (≤ 2 dp,
// thousands-grouped), so a converted km boundary reads "0–321.87 km", never
// "0–321.8688 km". Formatting lives HERE, once, for Service Stats and the Compare
// band rows. The Output Map narrative does NOT use it: per NAR-1 decision 5
// (specs/2026-10-17-output-narrative-rewrite-design.md) it prints whole,
// grouped distances in prose.
export function exclusiveBandLabels(boundaries: number[], toDisplay: (canonical: number) => number, unit: string): string[] {
  const sorted = [...boundaries].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const fmt = (canonical: number) => formatDistanceDisplay(toDisplay(canonical));
  const labels = sorted.map((b, i) => `${i === 0 ? "0" : fmt(sorted[i - 1])}–${fmt(b)} ${unit}`);
  labels.push(`> ${fmt(sorted[sorted.length - 1])} ${unit}`);
  return labels;
}
