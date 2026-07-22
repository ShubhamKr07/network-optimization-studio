import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";

// D4.1 export. CSV format choice: plain columns with template_version
// repeated on every row (not a leading comment line) — simpler for D5's
// importer to parse with a standard CSV reader, no special first-line
// handling needed.
export const TEMPLATE_VERSION = 1;

interface WarehouseOverride { id: string; capacity?: number | null; status: "active" | "forced_open" | "inactive"; }
interface CustomerOverride { id: string; demand?: number | null; status: "active" | "excluded"; }

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
