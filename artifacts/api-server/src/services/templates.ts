import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import { TRANSPORT_COAL_WAREHOUSES, TRANSPORT_COAL_CUSTOMERS } from "../data/transportCoalDataset.js";
import { GOLD_REFINERIES, GOLD_CUSTOMERS } from "../data/twoEchelonDataset.js";

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

export interface WarehouseTemplateRow {
  templateVersion: number;
  id: string;
  city: string;
  state: string;
  capacity: number | null;
  status: "active" | "forced_open" | "inactive";
}

export interface CustomerTemplateRow {
  templateVersion: number;
  id: string;
  city: string;
  state: string;
  demand: number;
  status: "active" | "excluded";
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
export function applyWarehouseOverrides(overrides: WarehouseOverride[]): WarehouseTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  return WAREHOUSES.map(w => {
    const o = byId.get(w.id);
    return {
      templateVersion: TEMPLATE_VERSION,
      id: w.id,
      city: w.city,
      state: w.state,
      capacity: o?.capacity ?? null,
      status: o?.status ?? "active",
    };
  });
}

export function applyCustomerOverrides(overrides: CustomerOverride[]): CustomerTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  return CUSTOMERS.map(c => {
    const o = byId.get(c.id);
    return {
      templateVersion: TEMPLATE_VERSION,
      id: c.id,
      city: c.city,
      state: c.state,
      demand: o?.demand ?? c.demand,
      status: o?.status ?? "active",
    };
  });
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
export function applyGoldCustomerOverrides(overrides: CustomerOverride[]): CustomerTemplateRow[] {
  const byId = new Map(overrides.map(o => [o.id, o]));
  return GOLD_CUSTOMERS.map(c => {
    const o = byId.get(c.id);
    return {
      templateVersion: TEMPLATE_VERSION,
      id: c.id,
      city: c.city,
      state: c.state,
      demand: o?.demand ?? c.demand,
      status: o?.status ?? "active",
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

export function warehouseRowsToCsv(rows: WarehouseTemplateRow[]): string {
  const header = "template_version,id,city,state,capacity,status";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.city), r.state, r.capacity ?? "", r.status].join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

export function customerRowsToCsv(rows: CustomerTemplateRow[]): string {
  const header = "template_version,id,city,state,demand,status";
  const lines = rows.map(r =>
    [r.templateVersion, r.id, csvEscape(r.city), r.state, r.demand, r.status].join(","),
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
