import type { WhStatus } from "./statusPresentation";

// Persisted input shapes — mirror the backend pMedian schema exactly (no
// `isAdded`, no derived/effective fields; `id` is the T3 stable uid). Kept
// deliberately SEPARATE from the view models below: what gets saved to
// `inputs` and what the map renders are different concerns, and collapsing
// them into one type invites a derived field (e.g. `isAdded`) accidentally
// round-tripping into a PATCH payload.
export interface AddedWarehouseInput {
  id: string;
  displayCode?: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity?: number | null;
  status: WhStatus;
}

export interface AddedCustomerInput {
  id: string;
  displayCode?: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
}

export interface PMedianMapInputs {
  addedWarehouses: AddedWarehouseInput[];
  addedCustomers: AddedCustomerInput[];
  warehouseOverrides: { id: string; capacity?: number | null; status: WhStatus }[];
  customerOverrides: { id: string; demand?: number | null; status: "active" | "excluded" }[];
  distanceOverrides: { fromId: string; toId: string; distance: number; estimated?: boolean }[];
  capacityMode: "none" | "uniform" | "per_wh";
  [k: string]: unknown; // p, gap, timeLimitSec, distanceBands, … passed through
}

// Derived view models — what EntityMarkers/MapLegend/MapDetailsCard actually
// render: base dataset row merged with its override (effective status/
// demand/excluded), plus `isAdded` (drives draggability and the base-vs-
// added action-menu split in T5/T6/T7).
export interface MapWarehouse {
  id: string;
  displayCode: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity?: number | null;
  status: WhStatus;
  isAdded: boolean;
}

export interface MapCustomer {
  id: string;
  displayCode: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
  excluded: boolean;
  isAdded: boolean;
}

export type MapEntity =
  | { kind: "wh"; entity: MapWarehouse }
  | { kind: "cs"; entity: MapCustomer };

// R1 (Workspace UX R1-R9): which color ramp a model's customer bubbles use.
// p-median-us is the only model wired to EntityMarkers/MapLegend today, but
// this stays a real modelId check (not a hardcoded assumption baked into
// the SVG builders) so a future non-pmedian caller keeps the blue --accent-*
// bubble by default rather than silently inheriting green.
export type DemandTone = "green" | "blue";

export function demandTone(modelId: string): DemandTone {
  return modelId === "p-median-us" ? "green" : "blue";
}

// R2 (Workspace UX R1-R9): discrete quintile demand-bubble sizing, replacing
// the old continuous sqrt-scale demandRadius. Population = ALL of the
// scenario's customers (base + added, INCLUDING excluded — an excluded
// customer's demand still counts toward the thresholds; it renders dimmed,
// not hidden or fixed-size, elsewhere).
//
// Algorithm: p20/p40/p60/p80 thresholds via linear interpolation between
// closest ranks (the `type=7`/`numpy.percentile` default: rank = (p/100) *
// (n-1), interpolate between the two bracketing sorted values). Buckets are
// lower-inclusive/upper-exclusive-of-the-NEXT-threshold: bucket 0 = d <=
// p20; bucket k (1-4) = p_{20k} < d <= p_{20(k+1)}; bucket 4 = d > p80 (no
// upper bound — there is no p100 threshold). Exactly-on-a-threshold value
// falls into the LOWER bucket.
export const QUINTILE_RADII: readonly [number, number, number, number, number] = [5, 8, 11, 14, 17];

export interface QuintileScale {
  /** p20/p40/p60/p80, ascending. */
  thresholds: [number, number, number, number];
  /** Which of the 5 buckets (0-4) a demand value falls into. */
  bucketOf: (demand: number) => number;
  /** The fixed QUINTILE_RADII[bucketOf(demand)] radius (px) for a demand value. */
  radiusOf: (demand: number) => number;
  /** Distinct buckets (0-4, ascending) actually populated by `demands` — drives MapLegend's row collapse (never render a bucket nothing occupies). */
  usedBuckets: number[];
}

function percentileLinear(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const rank = (p / 100) * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] + weight * (sorted[upper] - sorted[lower]);
}

export function makeQuintileRadius(demands: number[]): QuintileScale {
  const sorted = [...demands].sort((a, b) => a - b);
  const thresholds: [number, number, number, number] = [
    percentileLinear(sorted, 20),
    percentileLinear(sorted, 40),
    percentileLinear(sorted, 60),
    percentileLinear(sorted, 80),
  ];

  function bucketOf(demand: number): number {
    if (demand <= thresholds[0]) return 0;
    if (demand <= thresholds[1]) return 1;
    if (demand <= thresholds[2]) return 2;
    if (demand <= thresholds[3]) return 3;
    return 4;
  }

  function radiusOf(demand: number): number {
    return QUINTILE_RADII[bucketOf(demand)];
  }

  const usedBuckets = Array.from(new Set(demands.map(bucketOf))).sort((a, b) => a - b);

  return { thresholds, bucketOf, radiusOf, usedBuckets };
}
