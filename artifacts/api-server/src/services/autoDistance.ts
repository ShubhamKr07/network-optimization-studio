import { WAREHOUSES, CUSTOMERS, BRAZIL_WAREHOUSES, BRAZIL_REGIONS } from "../data/dataset.js";
import { TRANSPORT_COAL_WAREHOUSES, TRANSPORT_COAL_CUSTOMERS } from "../data/transportCoalDataset.js";
import { GOLD_MINES, GOLD_REFINERIES, GOLD_CUSTOMERS } from "../data/twoEchelonDataset.js";
import { buildActivePMedianIds, buildActiveTwoEchelonIds } from "./precheck.js";
import { pMedianInputsSchema, type PMedianInputs } from "../validation/inputs/pMedian.js";
import { transportLpInputsSchema, type TransportLpInputs } from "../validation/inputs/transportLp.js";
import { twoEchelonInputsSchema, type TwoEchelonInputs } from "../validation/inputs/twoEchelon.js";

// T1 (Input Map v2) / follow-up item 3 — normalization step run on every
// persist path (POST create, PATCH, import/apply — see routes/scenarios.ts's
// normalizeAddedEntityDistances) for p-median-us, p-median-brazil,
// transport-coal, and two-echelon-gold-au: a scenario-local added entity has
// no row in the base distance/cost matrix, and requiring a student to
// manually key in every missing pairwise distance before the scenario can
// solve is a real usability wall (each model's own precheck*.ts already
// flags exactly these gaps as "completeness" errors). This fills them in as
// estimated haversine distances so the scenario is immediately solvable,
// while flagging each filled row `estimated: true` so the UI can show it's a
// stand-in a student may want to replace with a real number.
//
// B2-T2 (Bundle 2) — p-median-brazil gained its own estimator
// (fillEstimatedBrazilDistances below), closing the boundary this comment
// used to describe; the map/table UI parity itself lands in T5.

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

// transport-coal's lane costs are haversine * a circuity factor, not plain
// great-circle miles — verified against scripts/extract-datasets.py's own
// docstring ("the source computation (haversine * 1.17) is preserved here")
// for _transport_distances()'s (and _brazil_distances()'s) precomputed
// values.
const TRANSPORT_CIRCUITY = 1.17;

// B2-T2 (Bundle 2) correction — the mine->refinery leg genuinely has no
// circuity (spot-checked kalgoorlie->daggar-hills, 293.664297837559 mi in
// the dataset, and kalgoorlie->cunnamulla, 1464.538208 mi, against plain
// haversineMiles: both land within ~0.08% of the raw haversine value,
// rounding-level noise, not a circuity multiplier), but the refinery-
// >customer leg does NOT share that property — a prior version of this
// comment wrongly generalized the mine-leg finding to "both legs". Reverse-
// derived across all 20 base refinery->customer pairs in
// solvers/two-echelon-gold-au/dataset/distances.json vs this file's own
// haversineMiles (R_MI=3959): ratio range 1.179101-1.179108, essentially
// constant, mean ~1.179105. Locked here rounded to 5 decimals; the Step-1
// test asserts reconstruction of a known base pair within <0.1% tolerance,
// not bit-exactness.
const TWO_ECHELON_RC_CIRCUITY = 1.1791;

// B2-T2 (Bundle 2) — Brazil's base warehouse->region distance matrix
// (solvers/p-median-brazil/dataset/distances.json) also carries a circuity
// factor, not plain great-circle miles. Reverse-derived across all 615
// non-zero base pairs vs this file's haversineMiles (R_MI=3959): ratio range
// 1.16601-1.17091, mean ~1.16992 — coincides with TRANSPORT_CIRCUITY (1.17)
// well within the <0.1% tolerance used elsewhere in this file (relative gap
// ~0.007%), so this reuses that constant under a Brazil-specific name rather
// than introducing a near-duplicate value that would only add noise.
const BRAZIL_CIRCUITY = TRANSPORT_CIRCUITY;

const rad = (d: number) => (d * Math.PI) / 180;

export function haversineMiles(a: Coord, b: Coord): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}

function clampMi(mi: number): number {
  return Math.max(MIN_DISTANCE_MI, Math.round(mi * 10) / 10);
}

/**
 * Canonical p-median normalization: fill missing ACTIVE added-involving
 * distances as estimated haversine (clamped to MIN_DISTANCE_MI, never 0),
 * then revalidate against pMedianInputsSchema. Pure — never mutates
 * `inputs`, always returns a fresh object. Idempotent: a pair that already
 * has an override (manual or previously estimated) is left untouched, so
 * running this twice on the same inputs is a no-op.
 *
 * B2-T2 (Bundle 2) — `circuity` is an optional multiplier applied on top of
 * plain haversineMiles, defaulting to 1 (p-median-us's own base matrix has
 * no circuity factor, so its callers never pass this). p-median-brazil
 * shares this exact function (and pMedianInputsSchema) via
 * fillEstimatedBrazilDistances below, which passes BRAZIL_CIRCUITY.
 */
export function fillEstimatedDistances(
  inputs: PMedianInputs,
  dataset: RoleDataset = DEFAULT,
  circuity: number = 1,
): PMedianInputs {
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
      const d = clampMi(haversineMiles(a, b) * circuity);
      overrides.push({ fromId: whId, toId: custId, distance: d, estimated: true });
      have.add(key);
    }
  }

  return pMedianInputsSchema.parse({ ...inputs, distanceOverrides: overrides });
}

const BRAZIL_DEFAULT: RoleDataset = { warehouses: BRAZIL_WAREHOUSES, customers: BRAZIL_REGIONS };

/**
 * p-median-brazil analogue of fillEstimatedDistances: identical role
 * shape/schema (Brazil shares pMedianInputsSchema, `warehouses`/`customers`
 * — regions are adapted to the `customers` role elsewhere, e.g.
 * precheck.ts's BRAZIL_DATASET), so this is a thin wrapper rather than a
 * reimplementation — it just supplies the Brazil base dataset and
 * BRAZIL_CIRCUITY. See BRAZIL_CIRCUITY's comment above for the derivation.
 */
export function fillEstimatedBrazilDistances(inputs: PMedianInputs, dataset: RoleDataset = BRAZIL_DEFAULT): PMedianInputs {
  return fillEstimatedDistances(inputs, dataset, BRAZIL_CIRCUITY);
}

interface TransportRoleDataset {
  mines: readonly { id: string; lat: number; lng: number }[];
  stations: readonly { id: string; lat: number; lng: number }[];
}

const TRANSPORT_DEFAULT: TransportRoleDataset = { mines: TRANSPORT_COAL_WAREHOUSES, stations: TRANSPORT_COAL_CUSTOMERS };

/**
 * transport-coal analogue of fillEstimatedDistances: fills missing added-
 * entity-involving lane costs (`laneCostOverrides`) as estimated haversine *
 * TRANSPORT_CIRCUITY, clamped/rounded the same way, then revalidates against
 * transportLpInputsSchema. Pure, idempotent — same contract as
 * fillEstimatedDistances. Unlike p-median, mines/stations have no active/
 * inactive concept in this LP at all (mirrors precheckTransportInputs'
 * own "no status filtering" finding), so every base + added mine/station
 * counts, with no status lookup needed.
 */
export function fillEstimatedLaneCosts(inputs: TransportLpInputs, dataset: TransportRoleDataset = TRANSPORT_DEFAULT): TransportLpInputs {
  const added = inputs.addedMines ?? [];
  const addedS = inputs.addedStations ?? [];

  // Role-scoped coordinate maps — mirrors fillEstimatedDistances' own
  // separation, so a station id that happens to collide with a mine id never
  // resolves against the wrong map.
  const mineCoord = new Map<string, Coord>();
  for (const m of dataset.mines) mineCoord.set(m.id, { lat: m.lat, lng: m.lng });
  for (const m of added) mineCoord.set(m.id, { lat: m.lat, lng: m.lng });
  const stationCoord = new Map<string, Coord>();
  for (const s of dataset.stations) stationCoord.set(s.id, { lat: s.lat, lng: s.lng });
  for (const s of addedS) stationCoord.set(s.id, { lat: s.lat, lng: s.lng });

  const addedMineIds = new Set(added.map((m) => m.id));
  const addedStationIds = new Set(addedS.map((s) => s.id));
  const allMineIds = [...dataset.mines.map((m) => m.id), ...addedMineIds];
  const allStationIds = [...dataset.stations.map((s) => s.id), ...addedStationIds];
  const activeAddedStationIds = [...addedStationIds];

  const overrides = [...(inputs.laneCostOverrides ?? [])];
  const have = new Set(overrides.map((o) => o.fromId + "|" + o.toId));

  for (const mineId of allMineIds) {
    // base<->base pairs are guaranteed covered by the base dataset's own
    // cost matrix - a mine only needs filling for stations it has no
    // existing lane to: every station if the mine itself is added,
    // otherwise just the added stations (the "vice versa" direction).
    // Mirrors precheckTransportInputs' own completeness rule exactly.
    const required = addedMineIds.has(mineId) ? allStationIds : activeAddedStationIds;
    for (const stationId of required) {
      const key = mineId + "|" + stationId;
      if (have.has(key)) continue;
      const a = mineCoord.get(mineId);
      const b = stationCoord.get(stationId);
      if (!a || !b) continue;
      const d = clampMi(haversineMiles(a, b) * TRANSPORT_CIRCUITY);
      overrides.push({ fromId: mineId, toId: stationId, cost: d, estimated: true });
      have.add(key);
    }
  }

  return transportLpInputsSchema.parse({ ...inputs, laneCostOverrides: overrides });
}

interface TwoEchelonRoleDataset {
  mines: readonly { id: string; lat: number; lng: number }[];
  refineries: readonly { id: string; lat: number; lng: number }[];
  customers: readonly { id: string; lat: number; lng: number }[];
}

const TWO_ECHELON_DEFAULT: TwoEchelonRoleDataset = { mines: GOLD_MINES, refineries: GOLD_REFINERIES, customers: GOLD_CUSTOMERS };

/**
 * two-echelon-gold-au analogue of fillEstimatedDistances: fills missing
 * added-entity-involving legs on BOTH the mine->refinery and refinery->
 * customer legs (`distanceOverrides`, one flat array shared by both legs —
 * mirrors merge_inputs.py's build_merged_two_echelon_dataset's own leg
 * resolution by id-space adjacency, never a string-prefix convention), then
 * revalidates against twoEchelonInputsSchema. Pure, idempotent — same
 * contract as fillEstimatedDistances. There is no addedMines concept (the
 * mine is fixed, never overridable), so the mine role is always just
 * `dataset.mines` (base only).
 *
 * B2-T2 (Bundle 2) — the two legs are estimated differently, per
 * TWO_ECHELON_RC_CIRCUITY's comment above: mine->refinery is plain
 * haversineMiles (no circuity), refinery->customer is haversineMiles *
 * TWO_ECHELON_RC_CIRCUITY.
 */
export function fillEstimatedTwoEchelonDistances(inputs: TwoEchelonInputs, dataset: TwoEchelonRoleDataset = TWO_ECHELON_DEFAULT): TwoEchelonInputs {
  const addedR = inputs.addedRefineries ?? [];
  const addedC = inputs.addedCustomers ?? [];

  // Role-scoped coordinate maps, one per entity type (mine/refinery/
  // customer are three disjoint id sets) — same discipline as
  // fillEstimatedDistances/fillEstimatedLaneCosts.
  const mineCoord = new Map<string, Coord>();
  for (const m of dataset.mines) mineCoord.set(m.id, { lat: m.lat, lng: m.lng });
  const refCoord = new Map<string, Coord>();
  for (const r of dataset.refineries) refCoord.set(r.id, { lat: r.lat, lng: r.lng });
  for (const r of addedR) refCoord.set(r.id, { lat: r.lat, lng: r.lng });
  const custCoord = new Map<string, Coord>();
  for (const c of dataset.customers) custCoord.set(c.id, { lat: c.lat, lng: c.lng });
  for (const c of addedC) custCoord.set(c.id, { lat: c.lat, lng: c.lng });

  const mineIds = dataset.mines.map((m) => m.id);
  const addedRefineryIds = new Set(addedR.map((r) => r.id));
  // Every added customer counts as active (addedCustomerSchema has no status
  // field) — same precedent buildActiveTwoEchelonIds' own caller
  // (precheckTwoEchelonInputs) already establishes.
  const addedCustomerIds = addedC.map((c) => c.id);

  const { activeRefineryIds, activeCustomerIds } = buildActiveTwoEchelonIds(inputs, dataset);

  const overrides = [...(inputs.distanceOverrides ?? [])];
  const have = new Set(overrides.map((o) => o.fromId + "|" + o.toId));

  for (const refId of activeRefineryIds) {
    const isAddedRefinery = addedRefineryIds.has(refId);

    // refinery -> customer leg: base<->base pairs are guaranteed covered by
    // the base dataset's own distance matrix - a pair needs an explicit
    // override iff at least one side is "added". Mirrors
    // precheckTwoEchelonInputs' own completeness rule exactly.
    const requiredCustomers = isAddedRefinery ? activeCustomerIds : addedCustomerIds;
    for (const custId of requiredCustomers) {
      const key = refId + "|" + custId;
      if (have.has(key)) continue;
      const a = refCoord.get(refId);
      const b = custCoord.get(custId);
      if (!a || !b) continue;
      const d = clampMi(haversineMiles(a, b) * TWO_ECHELON_RC_CIRCUITY);
      overrides.push({ fromId: refId, toId: custId, distance: d, estimated: true });
      have.add(key);
    }

    // mine -> refinery leg: only an ADDED refinery needs this at all - a
    // base refinery already has a base-dataset distance to the (single)
    // fixed mine.
    if (isAddedRefinery) {
      for (const mineId of mineIds) {
        const key = mineId + "|" + refId;
        if (have.has(key)) continue;
        const a = mineCoord.get(mineId);
        const b = refCoord.get(refId);
        if (!a || !b) continue;
        const d = clampMi(haversineMiles(a, b));
        overrides.push({ fromId: mineId, toId: refId, distance: d, estimated: true });
        have.add(key);
      }
    }
  }

  return twoEchelonInputsSchema.parse({ ...inputs, distanceOverrides: overrides });
}
