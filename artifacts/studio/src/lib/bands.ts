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

// A3.1 (DD-5) — default distance-band cut points for a scenario that hasn't
// configured its own yet (Optimization Parameters tab's distanceBands is
// empty). Wireframe default (250/500/750 mi), used ONLY as a display
// fallback for band-colored lane rendering — bands stay fully
// student-editable via distanceBandsFromInputs's normal round-trip; this
// constant is never written back onto a scenario's saved inputs.
export const DEFAULT_DISTANCE_BANDS = [250, 500, 750];

export interface BandEdge {
  distance: number;
  flow: number;
}

export interface BandCoverageEntry {
  band: number;
  percent: number;
}

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
