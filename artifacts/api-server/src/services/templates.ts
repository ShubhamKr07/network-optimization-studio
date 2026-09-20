import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import { BRAZIL_DATASET_WAREHOUSES, BRAZIL_DATASET_CUSTOMERS } from "../data/brazilDataset.js";
import { TRANSPORT_COAL_WAREHOUSES, TRANSPORT_COAL_CUSTOMERS } from "../data/transportCoalDataset.js";
import { GOLD_REFINERIES, GOLD_CUSTOMERS } from "../data/twoEchelonDataset.js";
import { CHENS_WAREHOUSES, CHENS_CUSTOMERS } from "../data/chensDataset.js";
import { JADE_PLANTS, JADE_PRODUCTS, JADE_WAREHOUSES, JADE_CUSTOMERS, JADE_PLANT_PRODUCT_CAPABILITIES } from "../data/jadeDataset.js";
import { buildPMedianIdSpaces, buildActivePMedianIds, buildTransportIdSpaces, buildTwoEchelonIdSpaces, buildActiveTwoEchelonIds, buildJadeIdSpaces, buildActiveJadeIds, TRANSPORT_DATASET, TWO_ECHELON_DATASET, JADE_DATASET } from "./precheck.js";
import type { PrecheckDataset, TwoEchelonPrecheckDataset, JadePrecheckDataset } from "./precheck.js";
import type { ResultEnvelope } from "../solver/resultEnvelope.js";
import {
  assignBandOrOverflow,
  bandLabelOrOverflow,
  computeCumulativeBandCoverage,
  serviceEdgesFor,
  toDisplay,
  roundForFile,
  objectiveDimension,
  convertObjective,
  OVERFLOW_BAND,
} from "@workspace/units";
import type { CanonicalUnit } from "@workspace/units";

// D4.1 export. CSV format choice: plain columns with template_version
// repeated on every row (not a leading comment line) — simpler for D5's
// importer to parse with a standard CSV reader, no special first-line
// handling needed.
export const TEMPLATE_VERSION = 1;

// Chen-bands-units bundle, Part E — the three importable, distance-bearing
// input entities (distances, legDistances, laneCosts) get their OWN
// entity-specific version, independent of the global input TEMPLATE_VERSION
// (which stays 1 — bumping it would reject every existing v1 input CSV,
// import.ts checks exact equality). v2 adds a `unit` column so an exported
// file is self-describing about which display unit its values are in.
// warehouses/customers/mines/stations/refineries/plants/plantCapabilities
// are non-distance entities and are NOT affected by this constant.
export const DISTANCE_TEMPLATE_VERSION = 2;

// Chen-bands-units bundle — OUTPUT_TEMPLATE_VERSION bumps 2 -> 3: every
// band-bearing output entity (assignments, flows, JADE assignments, JADE
// flows, serviceStats) now recomputes `band` server-side from the scenario's
// SAVED distanceBands lens (via the shared @workspace/units helpers) instead
// of trusting the solver's solve-time `edge.band`, and all five plus
// costSummary convert their distance-dimension values under the export
// route's `unit=` param. This is new semantics, not a v2 republish — v2 was
// already used for the pre-existing distance_unit/objective_mode columns
// (C4.9/D28). Generic `flows` moves OFF the global TEMPLATE_VERSION (it was
// v1, never had its own v2) straight onto OUTPUT_TEMPLATE_VERSION (v3) —
// skipping v2 for this one entity keeps a single output version across every
// changed entity rather than a per-entity patchwork. openWarehouses is a
// non-distance entity and stays v1, unaffected by `unit=`.
export const OUTPUT_TEMPLATE_VERSION = 3;

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
// established convention). Task 26 — addedCustomerSchema gained a `state`
// field (matching addedWarehouseSchema's), so an added customer's export row
// now sources its real `state` from its own record, same as city/lat/lng.
// addedCustomerSchema still has no `status` field at all (v1 has no
// add-and-exclude, see precheck.ts's header comment) — an added customer's
// export row still gets a hardcoded `status: "active"` (see
// applyCustomerOverrides below).
// T11 (Input Map v2) — `displayCode` mirrors pMedian.ts's own optional
// field: legitimately undefined on a row that's never had one assigned
// (gazetteer miss and the student never typed one) — see
// warehouseRowsToCsv/customerRowsToCsv below for the export fallback.
interface AddedWarehouse { id: string; displayCode?: string; city: string; state: string; lat: number; lng: number; capacity?: number | null; status: "active" | "forced_open" | "inactive"; }
interface AddedCustomer { id: string; displayCode?: string; city: string; state: string; lat: number; lng: number; demand: number; }

// Task 30 (B6.1 stage 4) — addedMineSchema/addedStationSchema shapes
// (validation/inputs/transportLp.ts). Mirrors AddedWarehouse/AddedCustomer
// above, minus the `status` field mines have none of (same reasoning
// MineOverride/StationOverride above already document).
// T11 (Step A) — `displayCode` mirrors pMedian.ts's own optional field on
// addedWarehouseSchema/addedCustomerSchema, now that MinesTab.tsx/
// StationsTab.tsx mint it client-side too (same identity model migration).
interface AddedMine { id: string; displayCode?: string; city: string; state: string; lat: number; lng: number; capacity?: number | null; }
interface AddedStation { id: string; displayCode?: string; city: string; state: string; lat: number; lng: number; demand: number; }

// T11 (multi-model expansion) — twoEchelon.ts's addedRefinerySchema shape.
// Mirrors AddedWarehouse minus the `capacity` field (refineries have no
// per-facility capacity concept at all, see RefineryOverride's own comment).
interface AddedRefinery { id: string; displayCode?: string; city: string; state: string; lat: number; lng: number; status: "active" | "forced_open" | "inactive"; }

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
// T11 — `displayCode` is null for every base row (base entities have no
// displayCode concept at all, `id` alone is their code) and for an added
// row that's never had one assigned (undefined `AddedWarehouse.displayCode`
// collapses to null here — one representation for "no readable label" on
// the wire, not two).
export interface WarehouseTemplateRow {
  templateVersion: number;
  id: string;
  displayCode: string | null;
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
  displayCode: string | null;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
  status: "active" | "excluded";
  overridden: boolean;
}

// Task 30 (B6.1 stage 4) — gained lat/lng (catching up to import.ts's new
// COLUMNS.mines/stations shape, positioned after state, before the value
// column — same B4.2 precedent) and `overridden` (B4.3's convention, see
// WarehouseTemplateRow's header comment above): true for any added mine/
// station (doesn't exist in the baseline at all) or a base one whose current
// capacity/demand differs from the pristine no-override default (null for
// mines — there is no base capacity in the dataset to compare against, only
// override-or-not; the base demand value for stations, same as customers).
// T11 (Step A) — gained displayCode, catching up to import.ts's new
// COLUMNS.mines/stations shape (mines/stations joined the uid+displayCode
// add-mode set — MinesTab.tsx/StationsTab.tsx now mint it client-side, same
// convention WarehouseTemplateRow's header comment already documents).
export interface MineTemplateRow {
  templateVersion: number;
  id: string;
  displayCode: string | null;
  city: string;
  state: string;
  lat: number;
  lng: number;
  capacity: number | null;
  overridden: boolean;
}

export interface StationTemplateRow {
  templateVersion: number;
  id: string;
  displayCode: string | null;
  city: string;
  state: string;
  lat: number;
  lng: number;
  demand: number;
  overridden: boolean;
}

// T11 (multi-model expansion) — gained displayCode/lat/lng, catching up to
// import.ts's new COLUMNS.refineries shape (refineries joined the
// uid+displayCode add-mode set — WarehousesTab.tsx, reused for
// entity="refineries" per B6.2, already mints both client-side). `overridden`
// was never added for refineries (unlike Warehouse/CustomerTemplateRow) —
// out of scope here too, no caller reads it for this entity.
export interface RefineryTemplateRow {
  templateVersion: number;
  id: string;
  displayCode: string | null;
  city: string;
  state: string;
  lat: number;
  lng: number;
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
      displayCode: null, // base entities have no displayCode concept
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
    displayCode: w.displayCode ?? null,
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
      displayCode: null, // base entities have no displayCode concept
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
    displayCode: c.displayCode ?? null,
    city: c.city,
    // Task 26 — addedCustomerSchema now carries a real `state` field; source
    // it from the added customer's own record (see this file's header
    // comment on AddedCustomer).
    state: c.state,
    lat: c.lat,
    lng: c.lng,
    demand: c.demand,
    status: "active",
    overridden: true,
  }));
  return [...baseRows, ...addedRows];
}

// T9 (Brazil CSV import/export) — p-median-brazil's own warehouse/region
// dataset, distinct from applyWarehouseOverrides/applyCustomerOverrides'
// 26-warehouse/200-customer p-median-us dataset — same shape/reasoning as
// applyGoldCustomerOverrides above (own base dataset, same WarehouseOverride/
// CustomerOverride/AddedWarehouse/AddedCustomer element shapes and
// WarehouseTemplateRow/CustomerTemplateRow row shapes, since p-median-brazil
// reuses p-median-us's schema verbatim — B6.3/B2-T1). BRAZIL_DATASET_
// WAREHOUSES/BRAZIL_DATASET_CUSTOMERS (data/brazilDataset.js) already adapt
// the raw warehouses.json/states.json rows to this file's WarehouseCandidate/
// Customer shape (city=name, state=id for regions), so no further adapting
// is needed here.
export function applyBrazilWarehouseOverrides(
  overrides: WarehouseOverride[],
  addedWarehouses: AddedWarehouse[] = [],
): WarehouseTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: WarehouseTemplateRow[] = BRAZIL_DATASET_WAREHOUSES.map(w => {
    const o = byId.get(w.id);
    const capacity = o?.capacity ?? null;
    const status = o?.status ?? "active";
    return {
      templateVersion: TEMPLATE_VERSION,
      id: w.id,
      displayCode: null, // base entities have no displayCode concept
      city: w.city,
      state: w.state,
      lat: w.lat,
      lng: w.lng,
      capacity,
      status,
      overridden: capacity !== null || status !== "active",
    };
  });
  const addedRows: WarehouseTemplateRow[] = addedWarehouses.map(w => ({
    templateVersion: TEMPLATE_VERSION,
    id: w.id,
    displayCode: w.displayCode ?? null,
    city: w.city,
    state: w.state,
    lat: w.lat,
    lng: w.lng,
    capacity: w.capacity ?? null,
    status: w.status,
    overridden: true,
  }));
  return [...baseRows, ...addedRows];
}

export function applyBrazilCustomerOverrides(
  overrides: CustomerOverride[],
  addedCustomers: AddedCustomer[] = [],
): CustomerTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: CustomerTemplateRow[] = BRAZIL_DATASET_CUSTOMERS.map(c => {
    const o = byId.get(c.id);
    const demand = o?.demand ?? c.demand;
    const status = o?.status ?? "active";
    return {
      templateVersion: TEMPLATE_VERSION,
      id: c.id,
      displayCode: null, // base entities have no displayCode concept
      city: c.city,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
      demand,
      status,
      overridden: demand !== c.demand || status !== "active",
    };
  });
  const addedRows: CustomerTemplateRow[] = addedCustomers.map(c => ({
    templateVersion: TEMPLATE_VERSION,
    id: c.id,
    displayCode: c.displayCode ?? null,
    city: c.city,
    state: c.state,
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
// Task 30 (B6.1 stage 4) — gained an `addedMines` second param, mirroring
// applyWarehouseOverrides' own second param exactly: appends one row per
// scenario-local added mine after the base rows, always overridden: true
// (it doesn't exist in the baseline at all). `overridden` for a base row is
// simply "does it have a capacity override" — mines have no status column to
// factor in, unlike applyWarehouseOverrides' `capacity !== null || status
// !== "active"`.
export function applyMineOverrides(overrides: MineOverride[], addedMines: AddedMine[] = []): MineTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: MineTemplateRow[] = TRANSPORT_COAL_WAREHOUSES.map(w => {
    const o = byId.get(w.id);
    const capacity = o?.capacity ?? null;
    return {
      templateVersion: TEMPLATE_VERSION,
      id: w.id,
      displayCode: null, // base entities have no displayCode concept
      city: w.city,
      state: w.state,
      lat: w.lat,
      lng: w.lng,
      capacity,
      overridden: capacity !== null,
    };
  });
  const addedRows: MineTemplateRow[] = addedMines.map(m => ({
    templateVersion: TEMPLATE_VERSION,
    id: m.id,
    displayCode: m.displayCode ?? null,
    city: m.city,
    state: m.state,
    lat: m.lat,
    lng: m.lng,
    capacity: m.capacity ?? null,
    overridden: true,
  }));
  return [...baseRows, ...addedRows];
}

// Stations mirror customers minus the status field: demand defaults to the
// station's base demand (TRANSPORT_COAL_CUSTOMERS preserves it), so the
// export shows the full effective demand a student would edit — same
// "merge base + override" semantics applyCustomerOverrides uses. Task 30
// (B6.1 stage 4) — gained an `addedStations` second param, mirroring
// applyCustomerOverrides' own second param.
export function applyStationOverrides(overrides: StationOverride[], addedStations: AddedStation[] = []): StationTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: StationTemplateRow[] = TRANSPORT_COAL_CUSTOMERS.map(c => {
    const o = byId.get(c.id);
    const demand = o?.demand ?? c.demand;
    return {
      templateVersion: TEMPLATE_VERSION,
      id: c.id,
      displayCode: null, // base entities have no displayCode concept
      city: c.city,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
      demand,
      overridden: demand !== c.demand,
    };
  });
  const addedRows: StationTemplateRow[] = addedStations.map(s => ({
    templateVersion: TEMPLATE_VERSION,
    id: s.id,
    displayCode: s.displayCode ?? null,
    city: s.city,
    state: s.state,
    lat: s.lat,
    lng: s.lng,
    demand: s.demand,
    overridden: true,
  }));
  return [...baseRows, ...addedRows];
}

// Two-echelon-gold-au's own 10-customer dataset — distinct from
// applyCustomerOverrides' 200-row p-median dataset, same CustomerTemplateRow
// shape (CSV/JSON serialization doesn't care which dataset a row came from).
// No addedCustomers concept for this model (twoEchelonInputsSchema has no
// such field) — no second parameter needed, unlike applyCustomerOverrides.
// T11 (multi-model expansion) — gained an `addedCustomers` second param,
// mirroring applyCustomerOverrides' own second param exactly: appends one
// row per scenario-local added customer after the 10 base rows, since
// twoEchelon.ts's addedCustomerSchema (B6.2+T11) now exists and add-mode is
// enabled for two-echelon-gold-au's customers entity too (import.ts's
// `canAdd`). Reuses the same `AddedCustomer` interface as
// applyCustomerOverrides — twoEchelon.ts's addedCustomerSchema shares its
// exact shape (id/displayCode/city/state/lat/lng/demand, no status).
export function applyGoldCustomerOverrides(overrides: CustomerOverride[], addedCustomers: AddedCustomer[] = []): CustomerTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: CustomerTemplateRow[] = GOLD_CUSTOMERS.map(c => {
    const o = byId.get(c.id);
    const demand = o?.demand ?? c.demand;
    const status = o?.status ?? "active";
    return {
      templateVersion: TEMPLATE_VERSION,
      id: c.id,
      displayCode: null, // base entities have no displayCode concept
      city: c.city,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
      demand,
      status,
      overridden: demand !== c.demand || status !== "active",
    };
  });
  const addedRows: CustomerTemplateRow[] = addedCustomers.map(c => ({
    templateVersion: TEMPLATE_VERSION,
    id: c.id,
    displayCode: c.displayCode ?? null,
    city: c.city,
    state: c.state,
    lat: c.lat,
    lng: c.lng,
    demand: c.demand,
    status: "active",
    overridden: true,
  }));
  return [...baseRows, ...addedRows];
}

// Chapter 4 (chens-cosmetics-cn) — Chen's own 25-warehouse / 197-customer
// China dataset (CHENS_WAREHOUSES/CHENS_CUSTOMERS), distinct from every other
// model's, same WarehouseTemplateRow/CustomerTemplateRow shapes (CSV/JSON
// serialization is dataset-agnostic). Chen warehouses carry STATUS but NO
// capacity concept at all (single-echelon coverage/min-distance model,
// capacityMode "none" only — exactly like JADE warehouses), so `capacity` is
// always null. Chen customers carry status (active/excluded) + demand, exactly
// like p-median-us's applyCustomerOverrides. Both gain the added-entity second
// param (Chen's addedWarehouses/addedCustomers), mirroring applyWarehouse/
// CustomerOverrides. Distances reuse applyDistanceOverrides directly (composite
// -keyed, dataset-agnostic — same reuse two-echelon/JADE legDistances rely on).
export function applyChensWarehouseOverrides(
  overrides: WarehouseOverride[],
  addedWarehouses: AddedWarehouse[] = [],
): WarehouseTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: WarehouseTemplateRow[] = CHENS_WAREHOUSES.map(w => {
    const status = byId.get(w.id)?.status ?? "active";
    return {
      templateVersion: TEMPLATE_VERSION,
      id: w.id,
      displayCode: null, // base entities have no displayCode concept
      city: w.city,
      state: w.state,
      lat: w.lat,
      lng: w.lng,
      capacity: null, // no per-warehouse capacity concept in this model
      status,
      overridden: status !== "active",
    };
  });
  const addedRows: WarehouseTemplateRow[] = addedWarehouses.map(w => ({
    templateVersion: TEMPLATE_VERSION,
    id: w.id,
    displayCode: w.displayCode ?? null,
    city: w.city,
    state: w.state,
    lat: w.lat,
    lng: w.lng,
    capacity: null,
    status: w.status,
    overridden: true,
  }));
  return [...baseRows, ...addedRows];
}

export function applyChensCustomerOverrides(overrides: CustomerOverride[], addedCustomers: AddedCustomer[] = []): CustomerTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: CustomerTemplateRow[] = CHENS_CUSTOMERS.map(c => {
    const o = byId.get(c.id);
    const demand = o?.demand ?? c.demand;
    const status = o?.status ?? "active";
    return {
      templateVersion: TEMPLATE_VERSION,
      id: c.id,
      displayCode: null, // base entities have no displayCode concept
      city: c.city,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
      demand,
      status,
      overridden: demand !== c.demand || status !== "active",
    };
  });
  const addedRows: CustomerTemplateRow[] = addedCustomers.map(c => ({
    templateVersion: TEMPLATE_VERSION,
    id: c.id,
    displayCode: c.displayCode ?? null,
    city: c.city,
    state: c.state,
    lat: c.lat,
    lng: c.lng,
    demand: c.demand,
    status: "active",
    overridden: true,
  }));
  return [...baseRows, ...addedRows];
}

// GOLD_REFINERIES only — deliberately excludes the mine (GOLD_MINES),
// which has no status/capacity override concept in the two-echelon model.
// T11 (multi-model expansion) — gained an `addedRefineries` second param,
// mirroring applyWarehouseOverrides' own second param exactly: appends one
// row per scenario-local added refinery after the 2 base rows. `overridden`
// was never a field on RefineryTemplateRow (unlike Warehouse/
// CustomerTemplateRow) — kept that way, out of scope here too.
export function applyRefineryOverrides(overrides: RefineryOverride[], addedRefineries: AddedRefinery[] = []): RefineryTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: RefineryTemplateRow[] = GOLD_REFINERIES.map(r => ({
    templateVersion: TEMPLATE_VERSION,
    id: r.id,
    displayCode: null, // base entities have no displayCode concept
    city: r.city,
    state: r.state,
    lat: r.lat,
    lng: r.lng,
    status: byId.get(r.id)?.status ?? "active",
  }));
  const addedRows: RefineryTemplateRow[] = addedRefineries.map(r => ({
    templateVersion: TEMPLATE_VERSION,
    id: r.id,
    displayCode: r.displayCode ?? null,
    city: r.city,
    state: r.state,
    lat: r.lat,
    lng: r.lng,
    status: r.status,
  }));
  return [...baseRows, ...addedRows];
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// B4.3 — header catches up to B4.2's import COLUMNS exactly. T11 — gained
// `display_code` (right after `id`, matching COLUMNS.warehouses/customers'
// own T11 addition) — `overridden` is still deliberately NOT a CSV column
// (see WarehouseTemplateRow's header comment): keeping the CSV column set
// identical to what import.ts expects is what makes export→edit→reimport
// keep working unregressed. Blank cell when `displayCode` is null (base
// rows, or an added row that's never had one assigned) — no synthetic
// fallback needed here since `city`/`state` are always present as their own
// columns right alongside it.
export function warehouseRowsToCsv(rows: WarehouseTemplateRow[]): string {
  const header = "template_version,id,display_code,city,state,lat,lng,capacity,status";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.displayCode ?? ""), csvEscape(r.city), r.state, r.lat, r.lng, r.capacity ?? "", r.status].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

export function customerRowsToCsv(rows: CustomerTemplateRow[]): string {
  const header = "template_version,id,display_code,city,state,lat,lng,demand,status";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.displayCode ?? ""), csvEscape(r.city), r.state, r.lat, r.lng, r.demand, r.status].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// Task 30 (B6.1 stage 4) — header catches up to import.ts's own
// COLUMNS.mines shape. T11 (Step A) — gained `display_code` (right after
// `id`, mines/stations joined the uid+displayCode add-mode set — same
// blank-cell-when-null convention as warehouseRowsToCsv/customerRowsToCsv/
// refineryRowsToCsv above). `overridden` stays JSON-only, same as
// warehouses/customers.
export function mineRowsToCsv(rows: MineTemplateRow[]): string {
  const header = "template_version,id,display_code,city,state,lat,lng,capacity";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.displayCode ?? ""), csvEscape(r.city), r.state, r.lat, r.lng, r.capacity ?? ""].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

export function stationRowsToCsv(rows: StationTemplateRow[]): string {
  const header = "template_version,id,display_code,city,state,lat,lng,demand";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.displayCode ?? ""), csvEscape(r.city), r.state, r.lat, r.lng, r.demand].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// T11 (multi-model expansion) — header catches up to import.ts's new
// COLUMNS.refineries shape (gained display_code + lat/lng, refineries
// joined the uid+displayCode add-mode set) — same blank-cell-when-null
// convention as warehouseRowsToCsv/customerRowsToCsv above.
export function refineryRowsToCsv(rows: RefineryTemplateRow[]): string {
  const header = "template_version,id,display_code,city,state,lat,lng,status";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.displayCode ?? ""), csvEscape(r.city), r.state, r.lat, r.lng, r.status].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// jade-T7 — two-echelon-jade-us's own warehouse/customer/plant/
// plantCapability entities (Chapter 9, JADE). warehouses/customers reuse the
// SAME WarehouseTemplateRow/CustomerTemplateRow row shapes as every other
// model (CSV/JSON serialization doesn't care which dataset a row came from),
// but need their OWN apply* functions because JADE's own schema shapes
// diverge from p-median's:
//   - warehouseOverrideSchema has NO capacity field (capacityModes: [] —
//     this model has no per-warehouse capacity concept at all, only the
//     plant x product capability matrix), so `capacity` is always null.
//   - customerOverrideSchema has NO scalar `demand` field, only a sparse
//     per-product `demands` map — this task (T7) scopes CSV editing to
//     STATUS ONLY for JADE customers (per-product demand editing is a
//     dedicated matrix/table concern for a later frontend task, not a
//     single-value CSV column); `demand` in the exported row is therefore
//     the base customer's own read-only total (JADE_CUSTOMERS' precomputed
//     `demand` field, already the sum across products) — never derived from
//     an override, and an import route change to this column is never
//     persisted (see routes/scenarios.ts's mergeChangesIntoOverrides, which
//     drops the value for this (entity, modelId) pair before writing).
// ---------------------------------------------------------------------------

interface JadeAddedCustomer { id: string; displayCode?: string; city: string; state: string; lat: number; lng: number; demands: Record<string, number>; status?: "active" | "excluded"; }

export function applyJadeWarehouseOverrides(
  overrides: WarehouseOverride[],
  addedWarehouses: AddedWarehouse[] = [],
): WarehouseTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: WarehouseTemplateRow[] = JADE_WAREHOUSES.map(w => {
    const o = byId.get(w.id);
    const status = o?.status ?? "active";
    return {
      templateVersion: TEMPLATE_VERSION,
      id: w.id,
      displayCode: null, // base entities have no displayCode concept
      city: w.city,
      state: w.state,
      lat: w.lat,
      lng: w.lng,
      capacity: null, // no per-warehouse capacity concept in this model
      status,
      overridden: status !== "active",
    };
  });
  const addedRows: WarehouseTemplateRow[] = addedWarehouses.map(w => ({
    templateVersion: TEMPLATE_VERSION,
    id: w.id,
    displayCode: w.displayCode ?? null,
    city: w.city,
    state: w.state,
    lat: w.lat,
    lng: w.lng,
    capacity: null,
    status: w.status,
    overridden: true,
  }));
  return [...baseRows, ...addedRows];
}

export function applyJadeCustomerOverrides(
  overrides: CustomerOverride[],
  addedCustomers: JadeAddedCustomer[] = [],
): CustomerTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  const baseRows: CustomerTemplateRow[] = JADE_CUSTOMERS.map(c => {
    const o = byId.get(c.id);
    const status = o?.status ?? "active";
    return {
      templateVersion: TEMPLATE_VERSION,
      id: c.id,
      displayCode: null, // base entities have no displayCode concept
      city: c.city,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
      // Read-only aggregate total — this model's per-product `demands` map
      // is never edited via this single-value CSV column (see this
      // section's header comment).
      demand: c.demand,
      status,
      overridden: status !== "active",
    };
  });
  const addedRows: CustomerTemplateRow[] = addedCustomers.map(c => ({
    templateVersion: TEMPLATE_VERSION,
    id: c.id,
    displayCode: c.displayCode ?? null,
    city: c.city,
    state: c.state,
    lat: c.lat,
    lng: c.lng,
    demand: Object.values(c.demands).reduce((s, v) => s + v, 0),
    status: c.status ?? "active",
    overridden: true,
  }));
  return [...baseRows, ...addedRows];
}

// jade-T7 — plants have NO override-able fields at all (no status/capacity
// concept anywhere in this model, see jadeInputs.ts's file header comment) —
// the ONLY lever for a plant is `plantProductCapability` (a separate entity,
// below). So unlike every other apply* function above, there's no first
// "overrides" parameter at all — just the base dataset plus this scenario's
// addedPlants.
interface AddedPlant { id: string; displayCode?: string; city: string; state: string; lat: number; lng: number; }

export interface PlantTemplateRow {
  templateVersion: number;
  id: string;
  displayCode: string | null;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export function applyPlantOverrides(addedPlants: AddedPlant[] = []): PlantTemplateRow[] {
  const baseRows: PlantTemplateRow[] = JADE_PLANTS.map(p => ({
    templateVersion: TEMPLATE_VERSION,
    id: p.id,
    displayCode: null, // base entities have no displayCode concept
    city: p.city,
    state: p.state,
    lat: p.lat,
    lng: p.lng,
  }));
  const addedRows: PlantTemplateRow[] = addedPlants.map(p => ({
    templateVersion: TEMPLATE_VERSION,
    id: p.id,
    displayCode: p.displayCode ?? null,
    city: p.city,
    state: p.state,
    lat: p.lat,
    lng: p.lng,
  }));
  return [...baseRows, ...addedRows];
}

export function plantRowsToCsv(rows: PlantTemplateRow[]): string {
  const header = "template_version,id,display_code,city,state,lat,lng";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.displayCode ?? ""), csvEscape(r.city), r.state, r.lat, r.lng].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// jade-T7 — plantCapability is a genuinely new entity SHAPE: a full MATRIX
// (every base-or-added plant x every one of the 4 products), not a sparse
// "only the overridden pairs" export like distances/laneCosts/legDistances.
// `enabled` merges plantProductCapability[] overrides onto the base
// capability matrix (a base pair is "enabled" iff its dataset capacity > 0 —
// same rule precheck.ts's capacity check uses); an added plant has no base
// cell at all, so every one of its pairs defaults to disabled unless
// overridden (mirrors merge_inputs.py's "added plant defaults every
// capability cell to 0/disabled" rule, per jadeInputs.ts's own header
// comment).
export interface PlantCapabilityTemplateRow {
  templateVersion: number;
  plantId: string;
  productId: string;
  enabled: boolean;
  overridden: boolean;
}

interface CapabilityOverride { plantId: string; productId: string; enabled: boolean; }

export function applyPlantCapabilityOverrides(
  overrides: CapabilityOverride[],
  addedPlants: AddedPlant[] = [],
): PlantCapabilityTemplateRow[] {
  const overrideByPair = new Map(overrides.map(o => [`${o.plantId}|${o.productId}`, o.enabled]));
  const baseCapacityByPair = new Map(JADE_PLANT_PRODUCT_CAPABILITIES.map(c => [`${c.plantId}|${c.productId}`, c.capacity]));
  const allPlantIds = [...JADE_PLANTS.map(p => p.id), ...addedPlants.map(p => p.id)];
  const rows: PlantCapabilityTemplateRow[] = [];
  for (const plantId of allPlantIds) {
    for (const product of JADE_PRODUCTS) {
      const key = `${plantId}|${product.id}`;
      const override = overrideByPair.get(key);
      const baseEnabled = (baseCapacityByPair.get(key) ?? 0) > 0;
      const enabled = override !== undefined ? override : baseEnabled;
      rows.push({
        templateVersion: TEMPLATE_VERSION,
        plantId,
        productId: product.id,
        enabled,
        overridden: override !== undefined,
      });
    }
  }
  return rows;
}

export function plantCapabilityRowsToCsv(rows: PlantCapabilityTemplateRow[]): string {
  const header = "template_version,plant_id,product_id,enabled";
  const lines = rows.map(r => [r.templateVersion, r.plantId, r.productId, r.enabled].join(","));
  return [header, ...lines].join("\n") + "\n";
}

// jade-T7 — the JADE analogue of buildLegDistanceStubRows (B6.2, above):
// this model has THREE roles across two legs too (plant/warehouse/
// customer), but the WAREHOUSE sits in the middle (adjacent to both legs),
// not the refinery — structurally identical shape to two-echelon-gold-au's
// mine/refinery/customer, just different role names, so this mirrors that
// function's own logic exactly (plant<->mine, warehouse<->refinery,
// customer<->customer).
export interface JadeStubGeneratorInputs {
  addedPlants?: Array<{ id: string; city: string; state: string; lat: number; lng: number }>;
  addedWarehouses?: Array<{ id: string; city: string; state: string; lat: number; lng: number; status?: string }>;
  addedCustomers?: Array<{ id: string; city: string; lat: number; lng: number }>;
  warehouseOverrides?: Array<{ id: string; status?: string }>;
  customerOverrides?: Array<{ id: string; status?: string }>;
}

// Returns null when `targetId` resolves as neither a known plant, warehouse,
// nor customer in this scenario (base dataset or added) — the caller
// (routes/scenarios.ts) turns that into a 422, same contract as
// buildDistanceStubRows/buildLaneCostStubRows/buildLegDistanceStubRows.
export function buildJadeLegDistanceStubRows(
  targetId: string,
  inputs: JadeStubGeneratorInputs,
  dataset: JadePrecheckDataset = JADE_DATASET,
  unit: CanonicalUnit = "mi",
): DistanceStubRow[] | null {
  const { plantIdSpace, warehouseIdSpace, customerIdSpace } = buildJadeIdSpaces(inputs, dataset);
  const { activePlantIds, activeWarehouseIds, activeCustomerIds } = buildActiveJadeIds(inputs, dataset);

  if (plantIdSpace.has(targetId)) {
    // Plant -> every active warehouse.
    return activeWarehouseIds.map(whId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: targetId,
      toId: whId,
      distance: null,
    }));
  }
  if (warehouseIdSpace.has(targetId)) {
    // A warehouse is adjacent to BOTH legs — every plant (plant->warehouse)
    // AND every active customer (warehouse->customer).
    const plantRows = activePlantIds.map(plantId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: plantId,
      toId: targetId,
      distance: null,
    }));
    const customerRows = activeCustomerIds.map(custId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: targetId,
      toId: custId,
      distance: null,
    }));
    return [...plantRows, ...customerRows];
  }
  if (customerIdSpace.has(targetId)) {
    // Every active warehouse -> this customer.
    return activeWarehouseIds.map(whId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: whId,
      toId: targetId,
      distance: null,
    }));
  }
  return null;
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

// Chen-bands-units bundle, Part E — v2: gained `unit`, entity-specific
// DISTANCE_TEMPLATE_VERSION (was the global TEMPLATE_VERSION). T9 threads
// each model's real manifest-declared `canonicalUnit` through from
// routes/scenarios.ts (was defaulting to "mi" for every caller, silently
// mislabeling Chen's "km" export — see applyDistanceOverrides below, whose
// own comment covers the value-conversion half of this fix).
export interface DistanceTemplateRow {
  templateVersion: number;
  unit: CanonicalUnit;
  fromId: string;
  toId: string;
  distance: number;
  overridden: true;
}

// T9 — gained `requestedUnit` (appended last, defaults to `canonicalUnit`:
// identity conversion, so every existing 1-/2-arg call site keeps compiling
// and behaving identically). `overrides[].distance` is always stored
// canonical; this is the ONLY place that numeric value is converted for
// export — mirrors buildAssignmentRows' "classify/convert/round" ordering,
// though there is no band classification here, just a straight convert.
export function applyDistanceOverrides(
  overrides: DistanceOverride[],
  canonicalUnit: CanonicalUnit = "mi",
  requestedUnit: CanonicalUnit = canonicalUnit,
): DistanceTemplateRow[] {
  return overrides.map(o => ({
    templateVersion: DISTANCE_TEMPLATE_VERSION,
    unit: requestedUnit,
    fromId: o.fromId,
    toId: o.toId,
    distance: roundForFile(toDisplay(o.distance, canonicalUnit, requestedUnit)),
    overridden: true,
  }));
}

export interface DistanceStubRow {
  templateVersion: number;
  unit: CanonicalUnit;
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
  unit: CanonicalUnit = "mi",
): DistanceStubRow[] | null {
  const { warehouseIdSpace, customerIdSpace } = buildPMedianIdSpaces(inputs, dataset);
  const { activeWarehouseIds, activeCustomerIds } = buildActivePMedianIds(inputs, dataset);

  if (warehouseIdSpace.has(targetId)) {
    return activeCustomerIds.map(custId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: targetId,
      toId: custId,
      distance: null,
    }));
  }
  if (customerIdSpace.has(targetId)) {
    return activeWarehouseIds.map(whId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: whId,
      toId: targetId,
      distance: null,
    }));
  }
  return null;
}

// Shared by both applyDistanceOverrides' rows (extra `overridden` field,
// ignored here) and buildDistanceStubRows' rows (distance: null). Chen-
// bands-units bundle, Part E — v2 header gains `unit` right after
// `template_version` (locked column order); every row (including blank
// stubs) carries the same valid unit+version. Import.ts's DISTANCES_COLUMNS
// (T8) is the counterpart parser.
export function distanceRowsToCsv(
  rows: Array<{ templateVersion: number; unit: CanonicalUnit; fromId: string; toId: string; distance: number | null }>,
): string {
  const header = "template_version,unit,from_id,to_id,distance";
  const lines = rows.map(r =>
    [r.templateVersion, r.unit, r.fromId, r.toId, r.distance ?? ""].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// Chen-bands-units bundle, Part E — JSON row projector for the distances/
// legDistances input entities: `unit` lives on the JSON envelope only
// (`{templateVersion, entity, unit, rows}`), never duplicated per row, so
// the wire JSON row is NOT the same object as the CSV/internal row. Not yet
// wired into routes/scenarios.ts's `res.json(...)` call sites (a routing
// concern, out of this task's scope) — provided here, tested directly, and
// ready for that wiring.
export function toDistanceJsonRow<T extends { unit: CanonicalUnit }>(row: T): Omit<T, "unit"> {
  const { unit: _unit, ...rest } = row;
  return rest;
}

// ---------------------------------------------------------------------------
// Task 30 (B6.1 stage 4) — laneCosts export + stub generator, the
// transport-coal analogue of the distances block above (see stage 1-3's
// report follow-up #4: "no TRANSPORT_DATASET-shaped stub-generator yet").
// Same two-capability split: applyLaneCostOverrides is the merged view of
// this scenario's CURRENT laneCostOverrides only (composite-keyed, no fixed
// baseline to enumerate — mirrors DistanceTemplateRow's reasoning exactly);
// buildLaneCostStubRows emits one blank row per counterpart for a given
// mine/station id, using buildTransportIdSpaces (precheck.ts) instead of
// buildPMedianIdSpaces/buildActivePMedianIds — precheckTransportInputs has no
// status-filtering "active" concept at all (mines/stations have no
// forced-open/inactive/excluded), so the id-space set itself already IS the
// "who to generate a stub row for" set, with no separate active/inactive
// distinction to layer on top.
// ---------------------------------------------------------------------------

interface LaneCostOverride { fromId: string; toId: string; cost: number; }

// Chen-bands-units bundle, Part E — v2: gained `unit`, DISTANCE_TEMPLATE_
// VERSION. `laneCosts` keeps its `cost` column name (chapter vocabulary
// preserved, per spec) rather than renaming to `distance` — it IS a distance
// value (transportLp.ts's lane "cost" is literally geographic miles, the
// objective is distance x flow), it just keeps its domain-specific column
// name. `unit` defaults to "mi" (transport-coal's own canonical unit, the
// only model with this entity) so the existing call sites keep compiling
// unchanged — see DistanceTemplateRow's header comment for the same pattern.
export interface LaneCostTemplateRow {
  templateVersion: number;
  unit: CanonicalUnit;
  fromId: string;
  toId: string;
  cost: number;
  overridden: true;
}

// T9 — gained `requestedUnit`, same pattern as applyDistanceOverrides above:
// `cost` IS a geographic distance value (this file's own header comment on
// LaneCostTemplateRow), so it converts under `unit=` exactly like `distance`
// does; only the column name stays chapter-vocabulary `cost`.
export function applyLaneCostOverrides(
  overrides: LaneCostOverride[],
  canonicalUnit: CanonicalUnit = "mi",
  requestedUnit: CanonicalUnit = canonicalUnit,
): LaneCostTemplateRow[] {
  return overrides.map(o => ({
    templateVersion: DISTANCE_TEMPLATE_VERSION,
    unit: requestedUnit,
    fromId: o.fromId,
    toId: o.toId,
    cost: roundForFile(toDisplay(o.cost, canonicalUnit, requestedUnit)),
    overridden: true,
  }));
}

export interface LaneCostStubRow {
  templateVersion: number;
  unit: CanonicalUnit;
  fromId: string;
  toId: string;
  cost: null;
}

// Minimal shape buildLaneCostStubRows needs from a scenario's inputs — the
// same fields buildTransportIdSpaces (precheck.ts) already takes.
export interface TransportStubGeneratorInputs {
  addedMines?: Array<{ id: string; city: string; state: string; lat: number; lng: number }>;
  addedStations?: Array<{ id: string; city: string; state: string; lat: number; lng: number }>;
}

// Returns null when `targetId` resolves as neither a known mine nor a known
// station in this scenario (base dataset or added) — the caller
// (routes/scenarios.ts) turns that into a 422, same contract as
// buildDistanceStubRows. `dataset` defaults to the real transport-coal base
// dataset (precheck.ts's own TRANSPORT_DATASET default).
export function buildLaneCostStubRows(
  targetId: string,
  inputs: TransportStubGeneratorInputs,
  dataset: PrecheckDataset = TRANSPORT_DATASET,
  unit: CanonicalUnit = "mi",
): LaneCostStubRow[] | null {
  const { mineIdSpace, stationIdSpace } = buildTransportIdSpaces(inputs, dataset);

  if (mineIdSpace.has(targetId)) {
    return [...stationIdSpace].map(stationId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: targetId,
      toId: stationId,
      cost: null,
    }));
  }
  if (stationIdSpace.has(targetId)) {
    return [...mineIdSpace].map(mineId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: mineId,
      toId: targetId,
      cost: null,
    }));
  }
  return null;
}

// Shared by both applyLaneCostOverrides' rows (extra `overridden` field,
// ignored here) and buildLaneCostStubRows' rows (cost: null). Chen-bands-
// units bundle, Part E — v2 header gains `unit` right after
// `template_version`, mirroring distanceRowsToCsv exactly, field name aside.
// Import.ts's LANE_COST_COLUMNS is the counterpart parser.
export function laneCostRowsToCsv(
  rows: Array<{ templateVersion: number; unit: CanonicalUnit; fromId: string; toId: string; cost: number | null }>,
): string {
  const header = "template_version,unit,from_id,to_id,cost";
  const lines = rows.map(r =>
    [r.templateVersion, r.unit, r.fromId, r.toId, r.cost ?? ""].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// B6.2 stage 4 — two-echelon-gold-au's "legDistances" entity. The merged-view
// export (`entity=legDistances` with no `stubFor`) reuses applyDistanceOverrides/
// distanceRowsToCsv/DistanceTemplateRow AS-IS (routes/scenarios.ts calls
// them directly, no new wrapper needed here) — this model's
// distanceOverrides shares p-median-us's exact {fromId, toId, distance}
// element shape (a deliberate B6.2 stage 1 naming choice), so those
// functions are already 100% reusable, not p-median-specific despite living
// in the "distances" section of this file. Only the STUB generator needs a
// dedicated function: unlike p-median-us's two-role (warehouse/customer)
// buildDistanceStubRows or transport-coal's two-role buildLaneCostStubRows,
// a two-echelon refinery sits in the MIDDLE of two adjacent legs — stubs
// for it must cover BOTH the mine->refinery leg (from the fixed mine) AND
// the refinery->customer leg (to every active customer), not just one
// direction.
// ---------------------------------------------------------------------------

// Minimal shape buildLegDistanceStubRows needs from a scenario's inputs —
// the same fields buildTwoEchelonIdSpaces/buildActiveTwoEchelonIds
// (precheck.ts) already take.
export interface TwoEchelonStubGeneratorInputs {
  addedRefineries?: Array<{ id: string; city: string; state: string; lat: number; lng: number; status?: string }>;
  addedCustomers?: Array<{ id: string; city: string; lat: number; lng: number }>;
  refineryOverrides?: Array<{ id: string; status?: string }>;
  customerOverrides?: Array<{ id: string; status?: string }>;
}

// Returns null when `targetId` resolves as neither a known mine, refinery,
// nor customer in this scenario (base dataset or added) — the caller
// (routes/scenarios.ts) turns that into a 422, same contract as
// buildDistanceStubRows/buildLaneCostStubRows. `dataset` defaults to the
// real two-echelon-gold-au base dataset (precheck.ts's own
// TWO_ECHELON_DATASET default).
export function buildLegDistanceStubRows(
  targetId: string,
  inputs: TwoEchelonStubGeneratorInputs,
  dataset: TwoEchelonPrecheckDataset = TWO_ECHELON_DATASET,
  unit: CanonicalUnit = "mi",
): DistanceStubRow[] | null {
  const { mineIdSpace, refineryIdSpace, customerIdSpace } = buildTwoEchelonIdSpaces(inputs, dataset);
  const { activeRefineryIds, activeCustomerIds } = buildActiveTwoEchelonIds(inputs, dataset);

  if (mineIdSpace.has(targetId)) {
    // Mine -> every active refinery.
    return activeRefineryIds.map(refId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: targetId,
      toId: refId,
      distance: null,
    }));
  }
  if (refineryIdSpace.has(targetId)) {
    // A refinery is adjacent to BOTH legs — every mine (mine->refinery) AND
    // every active customer (refinery->customer), not just one direction.
    const mineRows = [...mineIdSpace].map(mineId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: mineId,
      toId: targetId,
      distance: null,
    }));
    const customerRows = activeCustomerIds.map(custId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: targetId,
      toId: custId,
      distance: null,
    }));
    return [...mineRows, ...customerRows];
  }
  if (customerIdSpace.has(targetId)) {
    // Every active refinery -> this customer.
    return activeRefineryIds.map(refId => ({
      templateVersion: DISTANCE_TEMPLATE_VERSION,
      unit,
      fromId: refId,
      toId: targetId,
      distance: null,
    }));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase C, Task 1 — output-entity export. Unlike every entity above (which
// derive rows from scenario.inputs — base dataset + sparse overrides), these
// four derive rows from scenario.result (a solved ResultEnvelope). No base
// dataset to enumerate, no overrides to merge — just a read of the already-
// solved edges/metrics. p-median-us only for this pilot; other models
// fast-follow in a later plan once this pattern is proven (see this file's
// own Phase C plan doc for the full rationale).
// ---------------------------------------------------------------------------

// C4.9 / D24 — `distanceMi` renamed to `distance` + a self-describing
// `distanceUnit` (from the model's manifest — every model passes its own unit;
// Chen "km", the mile models "mi"). Bumped to OUTPUT_TEMPLATE_VERSION (D28).
// Chen-bands-units bundle — v3: `band` is now ALWAYS computed (never null),
// recomputed server-side from the scenario's SAVED distanceBands lens via the
// shared @workspace/units `assignBandOrOverflow` (a numeric index, `-1` =
// OVERFLOW_BAND) instead of trusting the solver's solve-time `edge.band`.
// `distance`/`distanceUnit` now follow the export route's `unit=` param.
export interface AssignmentTemplateRow {
  templateVersion: number;
  customerId: string;
  warehouseId: string;
  distance: number;
  distanceUnit: string;
  band: number;
  flow: number;
}

// `canonicalUnit` is the model's manifest-declared unit (already passed by
// every existing call site, unchanged position); `requestedUnit` and
// `savedBands` are NEW — both default so this function's existing 2-arg call
// sites keep compiling: `requestedUnit` defaults to `canonicalUnit` (no
// conversion — identity), `savedBands` defaults to `[]` (every row lands in
// band 0, since `assignBandOrOverflow` returns 0 for an empty bands array —
// this only matters until routes/scenarios.ts is updated to thread the
// scenario's real `inputs.distanceBands` through, a routing concern out of
// this task's scope; no currently-passing test asserts a nonzero band here).
export function buildAssignmentRows(
  result: ResultEnvelope,
  canonicalUnit: CanonicalUnit,
  requestedUnit: CanonicalUnit = canonicalUnit,
  savedBands: number[] = [],
): AssignmentTemplateRow[] {
  return result.edges.map(e => ({
    templateVersion: OUTPUT_TEMPLATE_VERSION,
    customerId: e.toId,
    warehouseId: e.fromId,
    // Classify on the CANONICAL distance, then convert, then round — never
    // classify after rounding/converting (a near-boundary row must not
    // change bucket because of display rounding).
    distance: roundForFile(toDisplay(e.distance, canonicalUnit, requestedUnit)),
    distanceUnit: requestedUnit,
    band: assignBandOrOverflow(e.distance, savedBands),
    flow: e.flow,
  }));
}

export function assignmentRowsToCsv(rows: AssignmentTemplateRow[]): string {
  const header = "template_version,customer_id,warehouse_id,distance,distance_unit,band,flow";
  const lines = rows.map(r =>
    [r.templateVersion, r.customerId, r.warehouseId, r.distance, r.distanceUnit, r.band, r.flow].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// Chen-bands-units bundle, Part E — v3 JSON row projector: `templateVersion`
// and `distanceUnit` are envelope-only in JSON (never duplicated per row) —
// the exact locked shape is `{customerId, warehouseId, distance, band,
// flow}`. Not yet wired into routes/scenarios.ts's `res.json(...)` (a
// routing concern out of this task's scope) — provided here, tested
// directly, ready for that wiring.
export interface AssignmentJsonRow {
  customerId: string;
  warehouseId: string;
  distance: number;
  band: number;
  flow: number;
}

export function toAssignmentJsonRow(r: AssignmentTemplateRow): AssignmentJsonRow {
  return { customerId: r.customerId, warehouseId: r.warehouseId, distance: r.distance, band: r.band, flow: r.flow };
}

export interface OpenWarehouseTemplateRow {
  templateVersion: number;
  warehouseId: string;
  city: string;
  totalFlow: number;
  utilization: number | null;
}

// C4.9 / D29 — build the effective facility id→city lookup (base warehouses/
// refineries ∪ the scenario's added facilities) buildOpenWarehouseRows needs
// to label a zero-flow forced-open facility. Chen emits
// metrics.utilizationByNode EMPTY, so the old city-from-utilizationByNode path
// blanks every Chen city; a forced-open facility with no assigned customer has
// no edge either, so its id lives only in metrics.openFacilityIds — the base
// (or added) dataset is the only place its real city can come from. Lives here
// (not the route) because this module already imports every model's base
// dataset. Two-echelon's "open warehouse" node is its refinery, so that model's
// base set is GOLD_REFINERIES + addedRefineries.
export function buildEffectiveFacilityCityLookup(
  modelId: string,
  inputs: {
    addedWarehouses?: Array<{ id: string; city: string }>;
    addedRefineries?: Array<{ id: string; city: string }>;
  },
): Map<string, string> {
  const lookup = new Map<string, string>();
  const base: Array<{ id: string; city: string }> =
    modelId === "p-median-us" ? WAREHOUSES
    : modelId === "p-median-brazil" ? BRAZIL_DATASET_WAREHOUSES
    : modelId === "chens-cosmetics-cn" ? CHENS_WAREHOUSES
    : modelId === "two-echelon-jade-us" ? JADE_WAREHOUSES
    : modelId === "two-echelon-gold-au" ? GOLD_REFINERIES
    : [];
  for (const w of base) lookup.set(w.id, w.city);
  for (const w of inputs.addedWarehouses ?? []) lookup.set(w.id, w.city);
  for (const r of inputs.addedRefineries ?? []) lookup.set(r.id, r.city);
  return lookup;
}

// Sums flow per distinct fromId across edges. Skips mine_to_refinery edges
// (two-echelon's own leg type, not a facility-open edge for the "which
// warehouse-equivalent node is open" question this entity answers) — a
// no-op for p-median-us today (its edges never carry `leg`), kept so this
// function is already correct if C6.1 later reuses it for two-echelon's
// refinery_to_customer leg.
//
// C4.9 / D29 — unions the edge-derived open ids with metrics.openFacilityIds so
// a forced-open ZERO-FLOW facility (base or added — it carries no edge) still
// exports, and sources its city from the effective lookup (utilizationByNode is
// empty for Chen). Stays v1 (OUTPUT_TEMPLATE_VERSION bump is only for the three
// unit-aware exports; openWarehouses gained no column).
export function buildOpenWarehouseRows(result: ResultEnvelope, cityById: Map<string, string>): OpenWarehouseTemplateRow[] {
  const flowByWarehouse = new Map<string, number>();
  for (const e of result.edges) {
    if (e.leg === "mine_to_refinery") continue;
    flowByWarehouse.set(e.fromId, (flowByWarehouse.get(e.fromId) ?? 0) + e.flow);
  }
  const utilByWarehouse = new Map((result.metrics.utilizationByNode ?? []).map(u => [u.warehouseId, u]));
  // Edge-derived open ids first (preserving edge order), then any forced-open
  // zero-flow facility present only in openFacilityIds.
  const ids = new Set<string>([...flowByWarehouse.keys(), ...(result.metrics.openFacilityIds ?? [])]);
  return [...ids].map(warehouseId => {
    const u = utilByWarehouse.get(warehouseId);
    return {
      templateVersion: TEMPLATE_VERSION,
      warehouseId,
      city: cityById.get(warehouseId) ?? "",
      totalFlow: flowByWarehouse.get(warehouseId) ?? 0,
      utilization: u?.utilization ?? null,
    };
  });
}

export function openWarehouseRowsToCsv(rows: OpenWarehouseTemplateRow[]): string {
  const header = "template_version,warehouse_id,city,total_flow,utilization";
  const lines = rows.map(r =>
    [r.templateVersion, r.warehouseId, csvEscape(r.city), r.totalFlow, r.utilization ?? ""].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// C4.9 / D25 — gained `objectiveMode` (Chen's coverage vs min_distance sense,
// from result.details.objective; null for every model that doesn't emit it) +
// a self-describing `distanceUnit`. Numeric fields that can be unavailable are
// typed `number | null` and serialize as EXPLICIT null (never omitted).
// Bumped to OUTPUT_TEMPLATE_VERSION (D28).
export interface CostSummaryTemplateRow {
  templateVersion: number;
  objective: number | null;
  objectiveMode: string | null;
  weightedAvgDistance: number | null;
  distanceUnit: string;
  runTimeSec: number | null;
  quality: string;
  solverUsed: string;
}

// Always exactly one row — a scenario has one current result, not a
// baseline/current pair (the Reports tab, Task 7, is where baseline
// comparison happens; this entity is a plain export of the current solve).
//
// Chen-bands-units bundle — the objective now converts via the SHARED
// `@workspace/units` `objectiveDimension`/`convertObjective` mapping (the
// ONLY place `modelId` drives unit semantics — no second mapping lives
// here). `modelId` is a NEW optional param defaulting to `null`: with no
// modelId, `objectiveDimension` falls through to its `"opaque"` default,
// which never converts — so this function's existing 2-arg call sites keep
// compiling AND keep behaving identically (requestedUnit also defaults to
// canonicalUnit, so no numeric conversion happens either way until
// routes/scenarios.ts is updated to pass the scenario's real modelId/
// requested unit through — a routing concern out of this task's scope).
// `weightedAvgDistance` is always a plain distance (not routed through the
// objective-dimension mapping) so it always converts under `unit=`.
export function buildCostSummaryRows(
  result: ResultEnvelope,
  canonicalUnit: CanonicalUnit,
  requestedUnit: CanonicalUnit = canonicalUnit,
  modelId: string | null = null,
): CostSummaryTemplateRow[] {
  // details.objective is Chen's mode string ("coverage" / "min_distance");
  // absent (undefined) or non-string for every other model → explicit null.
  const objectiveMode = typeof result.details.objective === "string" ? result.details.objective : null;
  const dim = objectiveDimension(modelId ?? "", objectiveMode);
  return [{
    templateVersion: OUTPUT_TEMPLATE_VERSION,
    objective: result.objective == null ? null : roundForFile(convertObjective(result.objective, dim, canonicalUnit, requestedUnit)),
    objectiveMode,
    weightedAvgDistance:
      result.metrics.weightedAvgDistance == null ? null : roundForFile(toDisplay(result.metrics.weightedAvgDistance, canonicalUnit, requestedUnit)),
    distanceUnit: requestedUnit,
    runTimeSec: result.runTimeSec,
    quality: result.quality,
    solverUsed: result.solverUsed,
  }];
}

export function costSummaryRowsToCsv(rows: CostSummaryTemplateRow[]): string {
  const header = "template_version,objective,objective_mode,weighted_avg_distance,distance_unit,run_time_sec,quality,solver_used";
  const lines = rows.map(r =>
    [r.templateVersion, r.objective ?? "", csvEscape(r.objectiveMode ?? ""), r.weightedAvgDistance ?? "", r.distanceUnit, r.runTimeSec ?? "", csvEscape(r.quality), csvEscape(r.solverUsed)].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// Chen-bands-units bundle, Part E — v3 JSON row projector: `templateVersion`
// and `distanceUnit` are envelope-only in JSON — the exact locked shape is
// `{objective, objectiveMode, weightedAvgDistance, runTimeSec, quality,
// solverUsed}`. Not yet wired into routes/scenarios.ts (out of scope here).
export interface CostSummaryJsonRow {
  objective: number | null;
  objectiveMode: string | null;
  weightedAvgDistance: number | null;
  runTimeSec: number | null;
  quality: string;
  solverUsed: string;
}

export function toCostSummaryJsonRow(r: CostSummaryTemplateRow): CostSummaryJsonRow {
  return {
    objective: r.objective,
    objectiveMode: r.objectiveMode,
    weightedAvgDistance: r.weightedAvgDistance,
    runTimeSec: r.runTimeSec,
    quality: r.quality,
    solverUsed: r.solverUsed,
  };
}

// C4.9 / D25 — gained a self-describing `distanceUnit` (band thresholds are in
// the model's distance unit). Bumped to OUTPUT_TEMPLATE_VERSION (D28).
//
// Chen-bands-units bundle — `band` is now the DISTANCE BOUNDARY VALUE itself
// (converted to the requested unit), not a numeric index — the third and
// final of the three distinct band representations in this bundle (see
// buildAssignmentRows' numeric-index comment and buildJadeAssignmentRows'
// display-label comment). `OVERFLOW_BAND` (-1) is a categorical sentinel and
// is NEVER unit-converted, in this schema or any other.
export interface ServiceStatsTemplateRow {
  templateVersion: number;
  band: number;
  distanceUnit: string;
  percent: number;
}

// Chen-bands-units bundle — switched from reading the solver's solve-time
// `metrics.bandCoverage` snapshot to recomputing LIVE from the scenario's
// SAVED distanceBands lens via the shared `@workspace/units` cumulative+
// overflow helper (`computeCumulativeBandCoverage`), the same helper and the
// same rows the Reports tab's live band-coverage display already uses —
// server and frontend now call the identical pure function, so parity is
// structural rather than maintained by convention. `serviceEdgesFor` applies
// the two-echelon/JADE outbound-leg filter (a no-op for single-echelon
// models, whose edges never carry `leg`). `savedBands` is a NEW param
// defaulting to `[]` so this function's existing 2-arg call sites keep
// compiling (an empty bands array yields zero coverage rows — this only
// matters until routes/scenarios.ts is updated to thread the scenario's real
// `inputs.distanceBands` through, a routing concern out of this task's
// scope; no currently-passing test asserts specific serviceStats row values).
export function buildServiceStatsRows(
  result: ResultEnvelope,
  canonicalUnit: CanonicalUnit,
  requestedUnit: CanonicalUnit = canonicalUnit,
  savedBands: number[] = [],
): ServiceStatsTemplateRow[] {
  const edges = serviceEdgesFor(result.edges);
  const coverage = computeCumulativeBandCoverage(edges, savedBands);
  return coverage.map(c => ({
    templateVersion: OUTPUT_TEMPLATE_VERSION,
    // Classify (computeCumulativeBandCoverage already worked in canonical
    // values) then convert the boundary — never the reverse. The overflow
    // sentinel is categorical and is never converted.
    band: c.band === OVERFLOW_BAND ? OVERFLOW_BAND : roundForFile(toDisplay(c.band, canonicalUnit, requestedUnit)),
    distanceUnit: requestedUnit,
    percent: c.percent,
  }));
}

export function serviceStatsRowsToCsv(rows: ServiceStatsTemplateRow[]): string {
  const header = "template_version,band,distance_unit,percent";
  const lines = rows.map(r => [r.templateVersion, r.band, r.distanceUnit, r.percent].join(","));
  return [header, ...lines].join("\n") + "\n";
}

// Chen-bands-units bundle, Part E — v3 JSON row projector: `templateVersion`
// and `distanceUnit` are envelope-only in JSON — locked shape `{band,
// percent}`. Not yet wired into routes/scenarios.ts (out of scope here).
export interface ServiceStatsJsonRow {
  band: number;
  percent: number;
}

export function toServiceStatsJsonRow(r: ServiceStatsTemplateRow): ServiceStatsJsonRow {
  return { band: r.band, percent: r.percent };
}

// Chen-bands-units bundle — v3: `distanceMi` renamed to neutral `distance` +
// a self-describing `distanceUnit` (this entity gains unit-awareness for the
// first time — it previously had none at all, hardcoded to miles). `band` is
// now ALWAYS computed (never null), recomputed from the scenario's SAVED
// distanceBands lens via the shared `assignBandOrOverflow` (numeric index,
// `-1` = OVERFLOW_BAND), replacing the solver's solve-time `edge.band ?? null`
// — the same numeric-index representation generic `assignments` uses (NOT
// JADE's display-label string — see buildJadeFlowRows).
export interface FlowTemplateRow {
  templateVersion: number;
  fromId: string;
  toId: string;
  distance: number;
  distanceUnit: string;
  band: number;
  flow: number;
}

// C6.1 — the transport-coal/two-echelon equivalent of Customer Assignments
// (genuinely N/A for p-median-us/brazil, which have no multi-leg or
// facility-less-LP shape). Filters out refinery_to_customer edges (those
// belong to Customer Assignments) — transport-coal's edges never carry
// `leg` at all, so they all pass this filter unfiltered; two-echelon's
// mine_to_refinery edges pass too. Mirrors buildOpenWarehouseRows'
// existing inverse leg-filter exactly (templates.ts, Phase C).
//
// Chen-bands-units bundle — this entity moves OFF the global TEMPLATE_
// VERSION straight onto OUTPUT_TEMPLATE_VERSION (v3; it never had a v2 — see
// this file's OUTPUT_TEMPLATE_VERSION header comment). `canonicalUnit`
// defaults to "mi": every current caller of the generic (non-JADE) flows
// path is transport-coal or two-echelon-gold-au, both "mi"-canonical, so
// this function's existing 1-arg call site keeps compiling and behaves
// correctly without a route change. `requestedUnit`/`savedBands` default the
// same way buildAssignmentRows' do (identity conversion, band 0 for every
// row) until routes/scenarios.ts threads the scenario's real requested unit
// and `inputs.distanceBands` through — a routing concern out of this task's
// scope; no currently-passing test asserts a nonzero band or a converted
// distance here.
export function buildFlowRows(
  result: ResultEnvelope,
  canonicalUnit: CanonicalUnit = "mi",
  requestedUnit: CanonicalUnit = canonicalUnit,
  savedBands: number[] = [],
): FlowTemplateRow[] {
  return result.edges
    .filter(e => e.leg !== "refinery_to_customer")
    .map(e => ({
      templateVersion: OUTPUT_TEMPLATE_VERSION,
      fromId: e.fromId,
      toId: e.toId,
      distance: roundForFile(toDisplay(e.distance, canonicalUnit, requestedUnit)),
      distanceUnit: requestedUnit,
      band: assignBandOrOverflow(e.distance, savedBands),
      flow: e.flow,
    }));
}

export function flowRowsToCsv(rows: FlowTemplateRow[]): string {
  const header = "template_version,from_id,to_id,distance,distance_unit,band,flow";
  const lines = rows.map(r =>
    [r.templateVersion, r.fromId, r.toId, r.distance, r.distanceUnit, r.band, r.flow].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// Chen-bands-units bundle, Part E — v3 JSON row projector: locked shape
// `{fromId, toId, distance, band, flow}` (envelope-only templateVersion/
// distanceUnit). Not yet wired into routes/scenarios.ts (out of scope here).
export interface FlowJsonRow {
  fromId: string;
  toId: string;
  distance: number;
  band: number;
  flow: number;
}

export function toFlowJsonRow(r: FlowTemplateRow): FlowJsonRow {
  return { fromId: r.fromId, toId: r.toId, distance: r.distance, band: r.band, flow: r.flow };
}

// ---------------------------------------------------------------------------
// JADE Ch.9 workspace bundle, task A4 — two-echelon-jade-us's own
// `assignments`/`flows` export builders (spec §5c). The generic
// buildAssignmentRows/buildFlowRows above derive rows from `result.edges`,
// which is correct for every other model but wrong for JADE:
//   - JADE's outbound (warehouse_to_customer) edges are already aggregated
//     ACROSS a customer's products (single-source), so an edges-derived
//     "assignments" export can never be product-level — the on-screen
//     JadeAssignmentsTab (B2, product-level) instead reads
//     `details.assignments`, which IS per-(product,customer). This export
//     must match that, not `buildAssignmentRows`.
//   - JADE's inbound (plant_to_warehouse) edges are already per-product, one
//     row per positive (plant,warehouse,product) flow — the on-screen
//     JadeFlowsTab's Plant->Warehouse inner table (B3) aggregates them per
//     (plant,warehouse) pair, summing flow across products. `buildFlowRows`
//     has no such aggregation, so it would export one row per product
//     instead of one row per plant-warehouse pair.
// Every other model keeps using buildAssignmentRows/buildFlowRows unchanged
// (scenarios.ts branches on modelId before choosing which builder to call).
// ---------------------------------------------------------------------------

// Chen-bands-units bundle — the local `jadeBandLabel` mirror is gone;
// `bandLabelOrOverflow` from `@workspace/units` is the shared helper now
// (identical semantics: upper-inclusive boundary assignment, 1-indexed
// "Band N" labels, "Overflow" above the highest boundary — no second copy of
// this logic anywhere in the repo, frontend or backend).

// Matches 5a's on-screen contract exactly: Product / Customer / Assigned
// Warehouse / Distance / Distance Band -- no Demand, no Flow. One row per
// (product, customer) from `details.assignments`
// (`{customerId, warehouseId, productId, flow, distanceMi}` --
// solve.py:1145-1148), not `result.edges`.
//
// Chen-bands-units bundle — v3: `band` is now recomputed from the scenario's
// SAVED distanceBands lens via the shared `bandLabelOrOverflow` (a
// DISPLAY-LABEL string, "Band N" / "Overflow" — JADE's existing on-screen
// contract, deliberately NOT the numeric index generic assignments use — see
// buildAssignmentRows), replacing the ad hoc local `jadeBandLabel`.
export interface JadeAssignmentTemplateRow {
  templateVersion: number;
  productId: string;
  customerId: string;
  warehouseId: string;
  distance: number;
  distanceUnit: string;
  band: string;
}

interface JadeRawDetailAssignment {
  customerId: string;
  warehouseId: string;
  productId: string;
  distanceMi: number;
}

function isJadeRawDetailAssignment(value: unknown): value is JadeRawDetailAssignment {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.customerId === "string"
    && typeof v.warehouseId === "string"
    && typeof v.productId === "string"
    && typeof v.distanceMi === "number";
}

// `canonicalUnit` (existing 2nd param, unchanged position) and `bands`
// (existing 3rd param, unchanged position) keep every current call site
// compiling; `requestedUnit` is NEW, appended last, defaulting to
// `canonicalUnit` (identity conversion) until routes/scenarios.ts threads
// the export route's real requested unit through (out of this task's scope).
export function buildJadeAssignmentRows(
  result: ResultEnvelope,
  canonicalUnit: CanonicalUnit,
  bands: number[],
  requestedUnit: CanonicalUnit = canonicalUnit,
): JadeAssignmentTemplateRow[] {
  const raw = result.details.assignments;
  const list = Array.isArray(raw) ? raw : [];
  return list.filter(isJadeRawDetailAssignment).map(a => ({
    templateVersion: OUTPUT_TEMPLATE_VERSION,
    productId: a.productId,
    customerId: a.customerId,
    warehouseId: a.warehouseId,
    // Classify on the CANONICAL distanceMi, then convert, then round.
    distance: roundForFile(toDisplay(a.distanceMi, canonicalUnit, requestedUnit)),
    distanceUnit: requestedUnit,
    band: bandLabelOrOverflow(a.distanceMi, bands),
  }));
}

// Chen-bands-units bundle — v3: self-describing header gains `template_
// version` + `distance_unit` (previously silently dropped the version/unit
// its own row object already carried).
export function jadeAssignmentRowsToCsv(rows: JadeAssignmentTemplateRow[]): string {
  const header = "template_version,product,customer,assigned_warehouse,distance,distance_unit,distance_band";
  const lines = rows.map(r =>
    [r.templateVersion, r.productId, r.customerId, r.warehouseId, r.distance, r.distanceUnit, csvEscape(r.band)].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// Chen-bands-units bundle, Part E — v3 JSON row projector: locked shape
// `{productId, customerId, warehouseId, distance, band}` (envelope-only
// templateVersion/distanceUnit). Not yet wired into routes/scenarios.ts.
export interface JadeAssignmentJsonRow {
  productId: string;
  customerId: string;
  warehouseId: string;
  distance: number;
  band: string;
}

export function toJadeAssignmentJsonRow(r: JadeAssignmentTemplateRow): JadeAssignmentJsonRow {
  return { productId: r.productId, customerId: r.customerId, warehouseId: r.warehouseId, distance: r.distance, band: r.band };
}

// Matches 5b/5c's combined on-screen contract: ONE file spanning both legs,
// neutral union schema `leg,from_id,to_id,distance,distance_band,flows`.
// Inbound (plant_to_warehouse) rows are aggregated per (plant,warehouse)
// pair, `flows` summed across products (mirrors the Plant->Warehouse inner
// tab); outbound (warehouse_to_customer) rows are already one per customer
// in `result.edges` (single-source), so no aggregation is needed there.
// Chen-bands-units bundle — gained `distanceUnit` (it had none at all before
// — see this file's header comment on this section). `leg` stays the closed
// union (already locked, matches the spec's exact table + the OpenAPI enum).
export interface JadeFlowTemplateRow {
  templateVersion: number;
  leg: "plant_to_warehouse" | "warehouse_to_customer";
  fromId: string;
  toId: string;
  distance: number;
  distanceUnit: string;
  band: string;
  flows: number;
}

// `bands` (existing 2nd param, unchanged position) keeps every current call
// site compiling; `canonicalUnit`/`requestedUnit` are NEW, appended after.
// `canonicalUnit` defaults to "mi" (JADE's own canonical unit — the only
// caller of this function) so the existing 2-arg call site keeps compiling
// and behaves correctly without a route change.
export function buildJadeFlowRows(
  result: ResultEnvelope,
  bands: number[],
  canonicalUnit: CanonicalUnit = "mi",
  requestedUnit: CanonicalUnit = canonicalUnit,
): JadeFlowTemplateRow[] {
  const inboundByPair = new Map<string, { fromId: string; toId: string; distance: number; flows: number }>();
  for (const e of result.edges) {
    if (e.leg !== "plant_to_warehouse") continue;
    const key = `${e.fromId}|${e.toId}`;
    const existing = inboundByPair.get(key);
    if (existing) {
      existing.flows += e.flow;
    } else {
      inboundByPair.set(key, { fromId: e.fromId, toId: e.toId, distance: e.distance, flows: e.flow });
    }
  }
  // Classify on the CANONICAL (aggregated) distance, then convert, then
  // round — never the reverse.
  const inboundRows: JadeFlowTemplateRow[] = [...inboundByPair.values()].map(p => ({
    templateVersion: OUTPUT_TEMPLATE_VERSION,
    leg: "plant_to_warehouse",
    fromId: p.fromId,
    toId: p.toId,
    distance: roundForFile(toDisplay(p.distance, canonicalUnit, requestedUnit)),
    distanceUnit: requestedUnit,
    band: bandLabelOrOverflow(p.distance, bands),
    flows: p.flows,
  }));
  const outboundRows: JadeFlowTemplateRow[] = result.edges
    .filter(e => e.leg === "warehouse_to_customer")
    .map(e => ({
      templateVersion: OUTPUT_TEMPLATE_VERSION,
      leg: "warehouse_to_customer" as const,
      fromId: e.fromId,
      toId: e.toId,
      distance: roundForFile(toDisplay(e.distance, canonicalUnit, requestedUnit)),
      distanceUnit: requestedUnit,
      band: bandLabelOrOverflow(e.distance, bands),
      flows: e.flow,
    }));
  return [...inboundRows, ...outboundRows];
}

// Chen-bands-units bundle — v3: self-describing header gains `template_
// version` + `distance_unit` (previously silently dropped both, despite
// `JadeFlowTemplateRow` now carrying them).
export function jadeFlowRowsToCsv(rows: JadeFlowTemplateRow[]): string {
  const header = "template_version,leg,from_id,to_id,distance,distance_unit,distance_band,flows";
  const lines = rows.map(r =>
    [r.templateVersion, r.leg, r.fromId, r.toId, r.distance, r.distanceUnit, csvEscape(r.band), r.flows].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

// Chen-bands-units bundle, Part E — v3 JSON row projector: locked shape
// `{leg, fromId, toId, distance, band, flows}` (envelope-only templateVersion/
// distanceUnit). Not yet wired into routes/scenarios.ts.
export interface JadeFlowJsonRow {
  leg: "plant_to_warehouse" | "warehouse_to_customer";
  fromId: string;
  toId: string;
  distance: number;
  band: string;
  flows: number;
}

export function toJadeFlowJsonRow(r: JadeFlowTemplateRow): JadeFlowJsonRow {
  return { leg: r.leg, fromId: r.fromId, toId: r.toId, distance: r.distance, band: r.band, flows: r.flows };
}
