export const OVERFLOW_BAND = -1;

export interface BandEdge { distance: number; flow: number; leg?: string | null }
export interface BandCoverageEntry { band: number; percent: number }

const OUTBOUND_LEGS = new Set(["warehouse_to_customer", "refinery_to_customer"]);

/**
 * Two-echelon models tag every edge with a `leg`; only the outbound/
 * customer-serving leg is a service distance (an inbound plant/mine leg would
 * double-count throughput). Single-echelon models tag nothing, so every edge
 * already IS the service leg.
 */
export function serviceEdgesFor<T extends BandEdge>(edges: T[]): T[] {
  const hasLegs = edges.some(e => e.leg != null);
  return hasLegs ? edges.filter(e => e.leg != null && OUTBOUND_LEGS.has(e.leg)) : edges;
}

/** First boundary the distance fits under, else the explicit overflow sentinel. */
export function assignBandOrOverflow(distance: number, bands: number[]): number {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = sorted.findIndex(b => distance <= b);
  return idx === -1 ? OVERFLOW_BAND : idx;
}

export function bandLabelOrOverflow(distance: number, bands: number[]): string {
  const i = assignBandOrOverflow(distance, bands);
  return i === OVERFLOW_BAND ? "Overflow" : `Band ${i + 1}`;
}

// Task 12 (Chapter 5, delivery-teaching-us) — rounds `x` to `d` decimal
// places. `d = 0` (the default below) is byte-identical to a bare
// `Math.round`, so every pre-existing caller (five models with tests pinned
// to integer percentages) is unaffected.
const roundTo = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;

/**
 * CUMULATIVE rollup keyed by the BOUNDARY VALUE (not an index) — each row is
 * the share of flow at or under that boundary — plus a separately labelled
 * overflow row, omitted entirely when there is none.
 *
 * `opts.decimals` is OPT-IN and defaults to 0 (today's integer-percentage
 * behaviour) — five models have tests pinned to integer output, so widening
 * the default would regress them. delivery-teaching-us (spec §5.7) is the
 * only caller that passes `{ decimals: 2 }` today.
 */
export function computeCumulativeBandCoverage(
  edges: BandEdge[],
  bands: number[],
  opts?: { decimals?: number },
): BandCoverageEntry[] {
  const decimals = opts?.decimals ?? 0;
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const totalFlow = edges.reduce((s, e) => s + e.flow, 0);
  const rows = sorted.map(band => {
    if (totalFlow === 0) return { band, percent: 0 };
    const within = edges.filter(e => e.distance <= band).reduce((s, e) => s + e.flow, 0);
    return { band, percent: roundTo((within * 100) / totalFlow, decimals) };
  });
  const maxBoundary = sorted[sorted.length - 1];
  const overflowFlow = edges.filter(e => e.distance > maxBoundary).reduce((s, e) => s + e.flow, 0);
  if (overflowFlow > 0) {
    rows.push({ band: OVERFLOW_BAND, percent: totalFlow === 0 ? 0 : roundTo((overflowFlow * 100) / totalFlow, decimals) });
  }
  return rows;
}
