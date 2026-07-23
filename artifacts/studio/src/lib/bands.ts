// E1.1 — distance bands are presentation state: recompute band assignment
// and coverage client-side from a solved result's `edges`, never by
// re-solving. Mirrors solve.py's band semantics exactly (cumulative
// coverage per boundary — a customer within 200mi also counts toward the
// 400mi/800mi/etc bands, since those distances have been Reached too).

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

// Cumulative: percent of total flow with distance <= each boundary.
export function computeBandCoverage(edges: BandEdge[], bands: number[]): BandCoverageEntry[] {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const totalFlow = edges.reduce((sum, e) => sum + e.flow, 0);
  return sorted.map((band) => {
    if (totalFlow === 0) return { band, percent: 0 };
    const flowWithin = edges.filter((e) => e.distance <= band).reduce((sum, e) => sum + e.flow, 0);
    return { band, percent: Math.round((flowWithin * 100) / totalFlow) };
  });
}
