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

// Chapter 9 JADE (jade-T14) — explicit overflow bucket, additive-only.
//
// model-integration-precheck.md Gate 4 [BLOCKER]: the shared band helper
// (`assignBand` above) assigns any out-of-range distance to the *last* band
// rather than a distinct overflow, so coverage reads ~100% when the truth is
// far lower. JADE's own dataset has plant->warehouse distances up to
// 2907.302 mi and warehouse->customer distances up to 3219.9609 mi against a
// default last band of 1600 mi (34 inbound / 825 outbound base pairs
// exceed it), so silently folding those into the 1600 bucket would be a
// materially wrong chart, not a cosmetic rounding difference.
//
// These are NEW, additive siblings of `assignBand`/`computeBandCoverage`
// above — neither existing function's signature or behavior changes, so
// every existing caller (route/marker coloring, `computeBandCoverage`'s own
// exclusive per-band consumers) is byte-for-byte unaffected. See
// `__tests__/bands.test.ts` for regression coverage proving this.
export const OVERFLOW_BAND = -1;

// Same boundary-matching semantics as `assignBand`, but returns the explicit
// `OVERFLOW_BAND` sentinel instead of `sorted.length - 1` when the distance
// exceeds every boundary.
export function assignBandOrOverflow(distance: number, bands: number[]): number {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = sorted.findIndex((b) => distance <= b);
  return idx === -1 ? OVERFLOW_BAND : idx;
}

// jade-A1 (SCN JADE Ch.9 bundle, spec §11) — one shared "Distance Band"
// column/label formatter, built on assignBandOrOverflow so it always
// matches the map's colors (getBandColor, bandPalette.ts) exactly: 1-indexed
// "Band N" for a real band, "Overflow" for the OVERFLOW_BAND sentinel.
export function bandLabel(distance: number, bands: number[]): string {
  const index = assignBandOrOverflow(distance, bands);
  return index === OVERFLOW_BAND ? "Overflow" : `Band ${index + 1}`;
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
export function bandRangeLabel(distance: number, bands: number[], unit: string): string {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return "All distances";
  const index = assignBandOrOverflow(distance, sorted);
  if (index === OVERFLOW_BAND) return `Band ${sorted.length + 1}: > ${sorted[sorted.length - 1]} ${unit}`;
  if (index === 0) return `Band 1: 0 ${unit} - ${sorted[0]} ${unit}`;
  return `Band ${index + 1}: ${sorted[index - 1]} ${unit} - ${sorted[index]} ${unit}`;
}

// Cumulative rollup (each boundary counts all flow at or under it, not just
// the flow strictly between the previous and this boundary — the opposite of
// `computeBandCoverage`'s exclusive semantics) plus a separately labelled
// overflow row (`band: OVERFLOW_BAND`) for flow beyond the last boundary.
// Mirrors Ch10's own `solve.py` bandCoverage shape (cumulative accumulation
// per boundary + an appended `band: -1` overflow entry) and the spec §2.7
// requirement that JADE's Service Stats never fold overflow into the last
// boundary. Omits the overflow row entirely when there is none (mirrors
// Ch10's `if band_overflow > 0` guard) rather than emitting a spurious 0%
// row for every model.
export function computeCumulativeBandCoverage(edges: BandEdge[], bands: number[]): BandCoverageEntry[] {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const totalFlow = edges.reduce((sum, e) => sum + e.flow, 0);
  const boundaryRows = sorted.map((band) => {
    if (totalFlow === 0) return { band, percent: 0 };
    const flowWithin = edges.filter((e) => e.distance <= band).reduce((sum, e) => sum + e.flow, 0);
    return { band, percent: Math.round((flowWithin * 100) / totalFlow) };
  });
  const maxBoundary = sorted[sorted.length - 1];
  const overflowFlow = edges.filter((e) => e.distance > maxBoundary).reduce((sum, e) => sum + e.flow, 0);
  if (overflowFlow > 0) {
    boundaryRows.push({
      band: OVERFLOW_BAND,
      percent: totalFlow === 0 ? 0 : Math.round((overflowFlow * 100) / totalFlow),
    });
  }
  return boundaryRows;
}
