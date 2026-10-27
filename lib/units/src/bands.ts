import { formatDistanceNumber } from "./format.js";
import type { CanonicalUnit } from "./convert.js";

export const OVERFLOW_BAND = -1;

export interface BandEdge { distance: number; flow: number; leg?: string | null }
export interface BandCoverageEntry { band: number; percent: number }

/** DU-4.1 — the ONE leg-role authority (moved from studio lib/legPalette.ts). */
export const INBOUND_LEGS: ReadonlySet<string> = new Set(["mine_to_refinery", "plant_to_warehouse"]);
export const OUTBOUND_LEGS: ReadonlySet<string> = new Set(["refinery_to_customer", "warehouse_to_customer"]);

/** DU-4.1 — the ONE band-set choice per leg. Inbound legs use the scenario's
 *  inboundDistanceBands when saved, else distanceBands (spec Q7); every other
 *  leg, including none at all, uses distanceBands. */
export function bandsForLeg(
  leg: string | null | undefined,
  inputs: { distanceBands: number[]; inboundDistanceBands?: number[] },
): number[] {
  return leg != null && INBOUND_LEGS.has(leg) ? inputs.inboundDistanceBands ?? inputs.distanceBands : inputs.distanceBands;
}

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

/** DU-2.2 — the ONE band range label (UI now; exports from DU-4.2). `bands` are boundaries in the DISPLAY unit.
 *  Upper-inclusive (a boundary value belongs to the lower band, as assignBandOrOverflow): first `≤ a u`,
 *  middle `a–b u`, overflow `> z u`. Never "Band N". */
export function bandRangeLabel(index: number, bands: number[], unit: CanonicalUnit): string {
  const s = [...bands].sort((a, b) => a - b);
  if (s.length === 0) return "All distances";
  const f = formatDistanceNumber;
  if (index === OVERFLOW_BAND || index >= s.length) return `> ${f(s[s.length - 1])} ${unit}`;
  if (index <= 0) return `≤ ${f(s[0])} ${unit}`;
  return `${f(s[index - 1])}–${f(s[index])} ${unit}`;
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

// SCU-1.1 (spec B1.9) — the two EXCLUSIVE helpers. `computeCumulativeBandCoverage`
// above is unchanged: the server's exports still use it.
export type FrozenBandShape = "cumulative" | "exclusive";

/** Round each share to `decimals`, then give `100 - sum` to the row with the
 *  largest positive RAW share (ties -> lowest index). A 0 row never receives
 *  it, and an all-zero input gets no residual at all. */
function withResidual(keys: number[], raw: number[], decimals: number): BandCoverageEntry[] {
  const rounded = raw.map(p => roundTo(p, decimals));
  let target = -1;
  raw.forEach((p, i) => {
    if (p > 0 && (target === -1 || p > raw[target])) target = i;
  });
  if (target !== -1) {
    const residual = 100 - rounded.reduce((s, p) => s + p, 0);
    rounded[target] = roundTo(rounded[target] + residual, decimals);
  }
  return keys.map((band, i) => ({ band, percent: rounded[i] }));
}

/**
 * EXCLUSIVE rollup from live edges: one row per sorted boundary (keyed by the
 * boundary value) plus an OVERFLOW_BAND row, always. Every edge is classified
 * by `assignBandOrOverflow`, so these rows always agree with map colours and
 * table cells. `[]` when there are no boundaries.
 */
export function computeExclusiveBandCoverage(edges: BandEdge[], bands: number[], decimals = 0): BandCoverageEntry[] {
  const sorted = [...bands].sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const flows = new Array<number>(sorted.length + 1).fill(0);
  for (const e of edges) {
    const i = assignBandOrOverflow(e.distance, sorted);
    flows[i === OVERFLOW_BAND ? sorted.length : i] += e.flow;
  }
  const keys = [...sorted, OVERFLOW_BAND];
  const total = flows.reduce((s, f) => s + f, 0);
  if (total === 0) return keys.map(band => ({ band, percent: 0 }));
  return withResidual(keys, flows.map(f => (f * 100) / total), decimals);
}

/**
 * A solved result's frozen `metrics.bandCoverage` -> the same exclusive rows.
 * `-1` rows are never boundaries. "cumulative" (every model except JADE):
 * exclusive[i] = cum[i] - cum[i-1], clamped at 0; overflow = max(0, 100 -
 * cum[last]). "exclusive" (JADE, solve.py:1320-1327): rows are kept; the
 * explicit -1 row, if any, is the overflow (else 0). Then the same round +
 * residual rule. `null` when there is no real boundary row.
 */
export function frozenBandCoverageToExclusive(
  bandCoverage: BandCoverageEntry[] | null | undefined,
  decimals: number,
  shape: FrozenBandShape,
): BandCoverageEntry[] | null {
  const all = bandCoverage ?? [];
  const rows = all.filter(r => r.band !== OVERFLOW_BAND).sort((a, b) => a.band - b.band);
  if (rows.length === 0) return null;
  const keys = [...rows.map(r => r.band), OVERFLOW_BAND];
  let raw: number[];
  if (shape === "cumulative") {
    raw = rows.map((r, i) => Math.max(0, r.percent - (i === 0 ? 0 : rows[i - 1].percent)));
    // ponytail: all-zero cumulative rows read as 100% overflow. p-median and
    // transport never freeze a -1 row, so frozen rows cannot tell "all flow
    // beyond the last boundary" from true zero flow (only uncapacitated
    // p-median can freeze the latter); pass a flow signal in if that matters.
    raw.push(Math.max(0, 100 - rows[rows.length - 1].percent));
  } else {
    raw = rows.map(r => Math.max(0, r.percent));
    const overflow = all.find(r => r.band === OVERFLOW_BAND);
    raw.push(overflow ? Math.max(0, overflow.percent) : 0);
  }
  return withResidual(keys, raw, decimals);
}
