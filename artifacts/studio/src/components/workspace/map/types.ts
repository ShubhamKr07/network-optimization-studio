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

// Fixed-domain demand scale, shared by EntityMarkers (marker bubbles) and
// MapLegend (reference bubbles) — DEMAND_REF/R_MAX/R_MIN are fixed
// constants, not scenario-relative, so a bubble's area means the same thing
// across every scenario and matches the legend exactly.
export const DEMAND_REF = 30000;
export const R_MAX = 15.5;
export const R_MIN = 3;

export const demandRadius = (d: number) =>
  Math.min(R_MAX, Math.max(R_MIN, R_MAX * Math.sqrt(Math.max(0, d) / DEMAND_REF)));
