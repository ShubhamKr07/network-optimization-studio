import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import { buildActivePMedianIds } from "./precheck.js";
import { pMedianInputsSchema, type PMedianInputs } from "../validation/inputs/pMedian.js";

// T1 (Input Map v2) — normalization step run on every p-median-us persist
// path (POST create, PATCH, import/apply — see routes/scenarios.ts's
// normalizePMedianInputs): a scenario-local added warehouse/customer has no
// row in the base distance matrix, and requiring a student to manually key
// in every missing pairwise distance before the scenario can solve is a
// real usability wall (B2.1's precheckPMedianInputs already flags exactly
// these gaps as "completeness" errors). This fills them in as estimated
// haversine distances so the scenario is immediately solvable, while
// flagging each filled row `estimated: true` so the UI can show it's a
// stand-in a student may want to replace with a real number.

interface Coord {
  lat: number;
  lng: number;
}

interface RoleDataset {
  warehouses: readonly { id: string; lat: number; lng: number }[];
  customers: readonly { id: string; lat: number; lng: number }[];
}

const DEFAULT: RoleDataset = { warehouses: WAREHOUSES, customers: CUSTOMERS };

const R_MI = 3959;
const MIN_DISTANCE_MI = 0.1;

const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMiles(a: Coord, b: Coord): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Canonical p-median normalization: fill missing ACTIVE added-involving
 * distances as estimated haversine (clamped to MIN_DISTANCE_MI, never 0),
 * then revalidate against pMedianInputsSchema. Pure — never mutates
 * `inputs`, always returns a fresh object. Idempotent: a pair that already
 * has an override (manual or previously estimated) is left untouched, so
 * running this twice on the same inputs is a no-op.
 */
export function fillEstimatedDistances(inputs: PMedianInputs, dataset: RoleDataset = DEFAULT): PMedianInputs {
  const added = inputs.addedWarehouses ?? [];
  const addedC = inputs.addedCustomers ?? [];

  // Separate per-role coordinate maps — a customer id that happens to
  // collide with a warehouse id (shouldn't happen once B2.1's precheck
  // runs, but this function has no such guarantee about its own input)
  // must never resolve against the wrong map.
  const whCoord = new Map<string, Coord>();
  for (const w of dataset.warehouses) whCoord.set(w.id, { lat: w.lat, lng: w.lng });
  for (const w of added) whCoord.set(w.id, { lat: w.lat, lng: w.lng });
  const custCoord = new Map<string, Coord>();
  for (const c of dataset.customers) custCoord.set(c.id, { lat: c.lat, lng: c.lng });
  for (const c of addedC) custCoord.set(c.id, { lat: c.lat, lng: c.lng });

  const addedWhIds = new Set(added.map((w) => w.id));
  const addedCustIds = new Set(addedC.map((c) => c.id));
  const { activeWarehouseIds, activeCustomerIds } = buildActivePMedianIds(inputs, {
    warehouses: dataset.warehouses,
    customers: dataset.customers,
  });
  const activeAddedCustIds = activeCustomerIds.filter((id) => addedCustIds.has(id));

  const overrides = [...(inputs.distanceOverrides ?? [])];
  const have = new Set(overrides.map((o) => o.fromId + "|" + o.toId));

  for (const whId of activeWarehouseIds) {
    // base<->base pairs are guaranteed covered by the base dataset's own
    // distance matrix (this function never touches those) - a warehouse
    // only needs filling for customers it has no existing route to: every
    // active customer if the warehouse itself is added, otherwise just the
    // active ADDED customers (the "vice versa" direction).
    const required = addedWhIds.has(whId) ? activeCustomerIds : activeAddedCustIds;
    for (const custId of required) {
      const key = whId + "|" + custId;
      if (have.has(key)) continue;
      const a = whCoord.get(whId);
      const b = custCoord.get(custId);
      if (!a || !b) continue;
      const d = Math.max(MIN_DISTANCE_MI, Math.round(haversineMiles(a, b) * 10) / 10);
      overrides.push({ fromId: whId, toId: custId, distance: d, estimated: true });
      have.add(key);
    }
  }

  return pMedianInputsSchema.parse({ ...inputs, distanceOverrides: overrides });
}
