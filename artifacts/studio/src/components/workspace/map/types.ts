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
  // T4 (Bundle 2) — optional, not required: a "wh"-kind (triangle-marker)
  // row is warehouse-shaped for p-median-us/brazil, refinery-shaped for
  // two-echelon (both HAVE status), but MINE-shaped for transport-coal
  // (mines have no status concept anywhere in that LP — see MinesTab.tsx's
  // own AddedMine comment). Every consumer must treat `status == null` as
  // "this role has no status", not crash on it — see EntityRoleConfig's
  // `hasStatus` below, which is what actually decides whether a caller
  // populates this field at all.
  status?: WhStatus;
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

// R1 (Bundle 2, Task T4 Step 1): every model's demand bubbles are green now
// — the old p-median-us-only branch is gone. `modelId` stays as a parameter
// (rather than deleting it and every call site) purely so this doesn't
// force an unrelated signature-cleanup across EntityMarkers/MapLegend; it's
// unused. `DemandTone`/"blue" stay exported too — customerBubbleSvg's own
// default param and its existing tests still reference the blue tone as a
// selectable style, even though no live caller resolves to it anymore.
export type DemandTone = "green" | "blue";

export function demandTone(_modelId?: string): DemandTone {
  return "green";
}

// T4 (Bundle 2, Step 0) — role/editor configuration. `MapEntity.kind`
// ("wh"/"cs") only ever means "renders as a triangle marker" vs "renders as
// a demand bubble" — a RENDERING role, not a per-model entity name.
// transport-coal's mines are "wh"-shaped (draggable triangles, no status)
// and its stations are "cs"-shaped (green demand bubbles, required value);
// two-echelon's refineries are "wh"-shaped WITH status. EntityRoleConfig is
// the orthogonal axis that actually varies per entity (warehouse / mine /
// refinery, customer / station): whether it has a status field, whether it
// has an editable numeric value (and what that value means), and which DD-7
// uid kind mints its `id`/display code. CreateEntityDialog, EditWarehouseDialog,
// MoveConfirmDialog, and MapDetailsCard all default to WAREHOUSE_ROLE/
// CUSTOMER_ROLE when no `role` prop is passed — today's exact p-median-us
// behavior, unchanged (zero regression for every existing call site).
export type UidKind = "wh" | "cs" | "mn" | "st";

export interface EntityRoleConfig {
  /** DD-7 uid-minting kind, consumed by newUid()/nextDisplayCode() (lib/entityId.ts).
   * Refineries reuse "wh" (locked by DD-7 — no "ar-"/"RF-" prefix exists). */
  uidKind: UidKind;
  /** Singular label used in dialog titles/menus ("warehouse", "customer", "mine", "station", "refinery"). */
  label: string;
  /** Status (Potential / Fixed-Open / Inactive) field — warehouses/refineries only. */
  hasStatus: boolean;
  /** Editable numeric value field in Create/Edit dialogs. Absent = no value field at all. */
  valueField?: {
    key: "capacity" | "demand";
    label: string;
    /** Demand-like values are required (a station/customer needs a real
     * number); capacity-like values are optional — blank means
     * "unconstrained", matching solve.py's get_base_capacity convention. */
    required: boolean;
  };
}

export const WAREHOUSE_ROLE: EntityRoleConfig = {
  uidKind: "wh",
  label: "warehouse",
  hasStatus: true,
  valueField: { key: "capacity", label: "Capacity", required: false },
};

export const CUSTOMER_ROLE: EntityRoleConfig = {
  uidKind: "cs",
  label: "customer",
  hasStatus: false,
  valueField: { key: "demand", label: "Demand", required: true },
};

export const MINE_ROLE: EntityRoleConfig = {
  uidKind: "mn",
  label: "mine",
  hasStatus: false,
  valueField: { key: "capacity", label: "Capacity", required: false },
};

export const STATION_ROLE: EntityRoleConfig = {
  uidKind: "st",
  label: "station",
  hasStatus: false,
  valueField: { key: "demand", label: "Demand", required: true },
};

export const REFINERY_ROLE: EntityRoleConfig = {
  uidKind: "wh", // DD-7: refineries reuse "wh" (aw-), not a new "ar-" prefix.
  label: "refinery",
  hasStatus: true,
  valueField: { key: "capacity", label: "Capacity", required: false },
};

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
