import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import { TRANSPORT_COAL_WAREHOUSES, TRANSPORT_COAL_CUSTOMERS } from "../data/transportCoalDataset.js";
import { GOLD_REFINERIES, GOLD_CUSTOMERS } from "../data/twoEchelonDataset.js";
import { buildPMedianIdSpaces, buildActivePMedianIds } from "./precheck.js";
import type { PrecheckDataset } from "./precheck.js";

// D4.1 export. CSV format choice: plain columns with template_version
// repeated on every row (not a leading comment line) — simpler for D5's
// importer to parse with a standard CSV reader, no special first-line
// handling needed.
export const TEMPLATE_VERSION = 1;

interface WarehouseOverride { id: string; capacity?: number | null; status: "active" | "forced_open" | "inactive"; }
interface CustomerOverride { id: string; demand?: number | null; status: "active" | "excluded"; }
// Mines/stations have no open/close binary in the LP (no status field) — a
// "closed" mine is expressed as a capacity override of 0. See this plan's
// Global Constraints in docs/superpowers/plans/2026-07-24-transport-coal-overrides.md.
interface MineOverride { id: string; capacity?: number | null; }
interface StationOverride { id: string; demand?: number | null; }
// Refineries mirror warehouses minus the capacity field: two-echelon-gold-au
// has no per-refinery capacity concept (single-refinery-open binary only,
// see solvers/two-echelon-gold-au) — status is the only override.
interface RefineryOverride { id: string; status: "active" | "forced_open" | "inactive"; }

// B1.1's addedWarehouseSchema/addedCustomerSchema shapes (validation/inputs/
// pMedian.ts) — a brand-new entity's own record is authoritative for every
// field on its export row, never the sparse override maps (B3.1/B4.2's
// established convention). addedCustomerSchema deliberately has no
// `state`/`status` field (v1 has no add-and-exclude, see precheck.ts's
// header comment) — an added customer's export row gets `state: ""` and
// `status: "active"` accordingly (see applyCustomerOverrides below).
interface AddedWarehouse { id: string; city: string; state: string; lat: number; lng: number; capacity?: number | null; status: "active" | "forced_open" | "inactive"; }
interface AddedCustomer { id: string; city: string; lat: number; lng: number; demand: number; }

// B4.3 — lat/lng catch up to B4.2's import COLUMNS (same position: after
// state, before the value/status columns) — sourced from the real dataset's
// own coordinates (WAREHOUSES/CUSTOMERS/GOLD_CUSTOMERS all already carry
// lat/lng). `overridden` (B4.3, per the plan: "export emits the merged view
// with an overridden boolean column") is true for every added entity
// (unconditionally — it doesn't exist in the baseline at all) or a base
// entity whose current value differs from the pristine base dataset;
// deliberately NOT a CSV column (see warehouseRowsToCsv/customerRowsToCsv
// below) so an exported CSV's header still matches import.ts's COLUMNS
// exactly and stays re-importable — it's JSON-export-only metadata.
export interface WarehouseTemplateRow {
  templateVersion: number;
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity: number | null;
  status: "active" | "forced_open" | "inactive";
  overridden: boolean;
}

export interface CustomerTemplateRow {
  templateVersion: number;
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
  status: "active" | "excluded";
  overridden: boolean;
}

export interface MineTemplateRow {
  templateVersion: number;
  id: string;
  city: string;
  state: string;
  capacity: number | null;
}

export interface StationTemplateRow {
  templateVersion: number;
  id: string;
  city: string;
  state: string;
  demand: number;
}

export interface RefineryTemplateRow {
  templateVersion: number;
  id: string;
  city: string;
  state: string;
  status: "active" | "forced_open" | "inactive";
}

// Merges the base dataset with a scenario's sparse overrides into the full
// effective view a student edits — same shape D1.1 resolves internally in
// solve.py's get_capacity/get_demand closures, but expressed here as
// complete per-row data instead of Python lookup functions, since export
// needs every row rendered, not just the ones that differ from baseline.
// B4.3 — also appends one row per added warehouse (B1.1's
// addedWarehouses, empty by default) after the 26 base rows: an added
// entity's own record is authoritative for every field, never the sparse
// override map (consistent with B3.1's solve.py merge and B4.2's import
// add-mode, which both treat added-entity data the same way).
export function applyWarehouseOverrides(
  overrides: WarehouseOverride[],
  addedWarehouses: AddedWarehouse[] = [],
): WarehouseTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: WarehouseTemplateRow[] = WAREHOUSES.map(w => {
    const o = byId.get(w.id);
    const capacity = o?.capacity ?? null;
    const status = o?.status ?? "active";
    return {
      templateVersion: TEMPLATE_VERSION,
      id: w.id,
      city: w.city,
      state: w.state,
      lat: w.lat,
      lng: w.lng,
      capacity,
      status,
      // Pristine default is {capacity: null, status: "active"} — differing
      // from either means an active sparse override exists.
      overridden: capacity !== null || status !== "active",
    };
  });
  const addedRows: WarehouseTemplateRow[] = addedWarehouses.map(w => ({
    templateVersion: TEMPLATE_VERSION,
    id: w.id,
    city: w.city,
    state: w.state,
    lat: w.lat,
    lng: w.lng,
    capacity: w.capacity ?? null,
    status: w.status,
    overridden: true, // added entities don't exist in the baseline at all
  }));
  return [...baseRows, ...addedRows];
}

export function applyCustomerOverrides(
  overrides: CustomerOverride[],
  addedCustomers: AddedCustomer[] = [],
): CustomerTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: CustomerTemplateRow[] = CUSTOMERS.map(c => {
    const o = byId.get(c.id);
    const demand = o?.demand ?? c.demand;
    const status = o?.status ?? "active";
    return {
      templateVersion: TEMPLATE_VERSION,
      id: c.id,
      city: c.city,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
      demand,
      status,
      // Pristine default is {demand: <base demand>, status: "active"}.
      overridden: demand !== c.demand || status !== "active",
    };
  });
  const addedRows: CustomerTemplateRow[] = addedCustomers.map(c => ({
    templateVersion: TEMPLATE_VERSION,
    id: c.id,
    city: c.city,
    // addedCustomerSchema (B1.1) has no `state` field at all — nothing to
    // source here (see this file's header comment on AddedCustomer).
    state: "",
    lat: c.lat,
    lng: c.lng,
    demand: c.demand,
    status: "active",
    overridden: true,
  }));
  return [...baseRows, ...addedRows];
}

// Mines mirror warehouses minus the status field: capacity is override-only
// (null = no override) — there is no base capacity on the in-memory
// TRANSPORT_COAL_WAREHOUSES row (WarehouseCandidate carries geometry only),
// matching how the MineTable UI renders an empty input as "no override".
export function applyMineOverrides(overrides: MineOverride[]): MineTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  return TRANSPORT_COAL_WAREHOUSES.map(w => {
    const o = byId.get(w.id);
    return {
      templateVersion: TEMPLATE_VERSION,
      id: w.id,
      city: w.city,
      state: w.state,
      capacity: o?.capacity ?? null,
    };
  });
}

// Stations mirror customers minus the status field: demand defaults to the
// station's base demand (TRANSPORT_COAL_CUSTOMERS preserves it), so the
// export shows the full effective demand a student would edit — same
// "merge base + override" semantics applyCustomerOverrides uses.
export function applyStationOverrides(overrides: StationOverride[]): StationTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  return TRANSPORT_COAL_CUSTOMERS.map(c => {
    const o = byId.get(c.id);
    return {
      templateVersion: TEMPLATE_VERSION,
      id: c.id,
      city: c.city,
      state: c.state,
      demand: o?.demand ?? c.demand,
    };
  });
}

// Two-echelon-gold-au's own 10-customer dataset — distinct from
// applyCustomerOverrides' 200-row p-median dataset, same CustomerTemplateRow
// shape (CSV/JSON serialization doesn't care which dataset a row came from).
// No addedCustomers concept for this model (twoEchelonInputsSchema has no
// such field) — no second parameter needed, unlike applyCustomerOverrides.
export function applyGoldCustomerOverrides(overrides: CustomerOverride[]): CustomerTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  return GOLD_CUSTOMERS.map(c => {
    const o = byId.get(c.id);
    const demand = o?.demand ?? c.demand;
    const status = o?.status ?? "active";
    return {
      templateVersion: TEMPLATE_VERSION,
      id: c.id,
      city: c.city,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
      demand,
      status,
      overridden: demand !== c.demand || status !== "active",
    };
  });
}

// GOLD_REFINERIES only — deliberately excludes the mine (GOLD_MINES),
// which has no status/capacity override concept in the two-echelon model.
export function applyRefineryOverrides(overrides: RefineryOverride[]): RefineryTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  return GOLD_REFINERIES.map(r => {
    const o = byId.get(r.id);
    return {
      templateVersion: TEMPLATE_VERSION,
      id: r.id,
      city: r.city,
      state: r.state,
      status: o?.status ?? "active",
    };
  });
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// B4.3 — header catches up to B4.2's import COLUMNS exactly
// (template_version,id,city,state,lat,lng,capacity,status) — `overridden`
// is deliberately NOT a CSV column (see WarehouseTemplateRow's header
// comment): keeping the CSV column set identical to what import.ts expects
// is what makes export→edit→reimport keep working unregressed.
export function warehouseRowsToCsv(rows: WarehouseTemplateRow[]): string {
  const header = "template_version,id,city,state,lat,lng,capacity,status";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.city), r.state, r.lat, r.lng, r.capacity ?? "", r.status].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

export function customerRowsToCsv(rows: CustomerTemplateRow[]): string {
  const header = "template_version,id,city,state,lat,lng,demand,status";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.city), r.state, r.lat, r.lng, r.demand, r.status].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

export function mineRowsToCsv(rows: MineTemplateRow[]): string {
  const header = "template_version,id,city,state,capacity";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.city), r.state, r.capacity ?? ""].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

export function stationRowsToCsv(rows: StationTemplateRow[]): string {
  const header = "template_version,id,city,state,demand";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.city), r.state, r.demand].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

export function refineryRowsToCsv(rows: RefineryTemplateRow[]): string {
  const header = "template_version,id,city,state,status";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.city), r.state, r.status].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// B4.3 — distances export + stub generator.
//
// Unlike warehouses/customers/mines/stations/refineries, `distances` has no
// fixed baseline to enumerate wholesale — the base dataset's distance
// matrix is ~5,200 (26x200) pairs, and exporting all of them isn't what a
// student wants. Two distinct capabilities live here instead:
//
//  1. applyDistanceOverrides — the "merged view" of a scenario's CURRENT
//     distanceOverrides only (each is by definition an override, so
//     `overridden` is always true — see this file's header comment on that
//     column). This is what GET .../export?entity=distances returns by
//     default.
//  2. buildDistanceStubRows — a wholly different capability: given one
//     entity's id (a warehouse or customer — just added, or an existing one
//     a student wants to (re-)supply distances for), emit one BLANK row
//     (distance: null) per active counterpart, so a student can download,
//     fill in, and reimport. Wired as the `stubFor` query param on the same
//     GET .../export?entity=distances endpoint (see routes/scenarios.ts) —
//     not a new endpoint, since it's the same resource (a distances CSV/
//     JSON payload) under an alternate, still-additive query param, reusing
//     the same auth/ownership/model-boundary checks entity=distances
//     already has. "Active" is defined identically to B2.1's precheck
//     completeness logic via precheck.ts's buildActivePMedianIds — not
//     reimplemented here.
// ---------------------------------------------------------------------------

interface DistanceOverride { fromId: string; toId: string; distance: number; }

export interface DistanceTemplateRow {
  templateVersion: number;
  fromId: string;
  toId: string;
  distance: number;
  overridden: true;
}

export function applyDistanceOverrides(overrides: DistanceOverride[]): DistanceTemplateRow[] {
  return overrides.map(o => ({
    templateVersion: TEMPLATE_VERSION,
    fromId: o.fromId,
    toId: o.toId,
    distance: o.distance,
    overridden: true,
  }));
}

export interface DistanceStubRow {
  templateVersion: number;
  fromId: string;
  toId: string;
  distance: null;
}

// Minimal shape buildDistanceStubRows needs from a scenario's inputs — the
// same fields buildPMedianIdSpaces/buildActivePMedianIds (precheck.ts)
// already take.
export interface StubGeneratorInputs {
  addedWarehouses?: Array<{ id: string; city: string; state: string; lat: number; lng: number; status?: string }>;
  addedCustomers?: Array<{ id: string; city: string; lat: number; lng: number }>;
  warehouseOverrides?: Array<{ id: string; status?: string }>;
  customerOverrides?: Array<{ id: string; status?: string }>;
}

// Returns null when `targetId` resolves as neither a known warehouse nor a
// known customer in this scenario (base dataset or added) — the caller
// (routes/scenarios.ts) turns that into a 422. `dataset` defaults to the
// real p-median-us base dataset (precheck.ts's own default) — overridable
// for tests, same testability pattern precheck.test.ts already uses.
export function buildDistanceStubRows(
  targetId: string,
  inputs: StubGeneratorInputs,
  dataset?: PrecheckDataset,
): DistanceStubRow[] | null {
  const { warehouseIdSpace, customerIdSpace } = buildPMedianIdSpaces(inputs, dataset);
  const { activeWarehouseIds, activeCustomerIds } = buildActivePMedianIds(inputs, dataset);

  if (warehouseIdSpace.has(targetId)) {
    return activeCustomerIds.map(custId => ({
      templateVersion: TEMPLATE_VERSION,
      fromId: targetId,
      toId: custId,
      distance: null,
    }));
  }
  if (customerIdSpace.has(targetId)) {
    return activeWarehouseIds.map(whId => ({
      templateVersion: TEMPLATE_VERSION,
      fromId: whId,
      toId: targetId,
      distance: null,
    }));
  }
  return null;
}

// Shared by both applyDistanceOverrides' rows (extra `overridden` field,
// ignored here) and buildDistanceStubRows' rows (distance: null) — same
// 4-column shape as import.ts's DISTANCES_COLUMNS, so an exported CSV stays
// re-importable either way.
export function distanceRowsToCsv(
  rows: Array<{ templateVersion: number; fromId: string; toId: string; distance: number | null }>,
): string {
  const header = "template_version,from_id,to_id,distance";
  const lines = rows.map(r =>
    [r.templateVersion, r.fromId, r.toId, r.distance ?? ""].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}
