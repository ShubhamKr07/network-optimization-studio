import { validatePackage, PACKAGE_SPECS } from "@workspace/dataset-schema";
import type { WarehouseCandidate, Customer } from "./dataset.js";

interface MineEntry { id: string; city: string; state: string; lat: number; lng: number; }
interface RefineryEntry { id: string; city: string; state: string; lat: number; lng: number; }
interface GoldCustomerEntry { id: string; city: string; state: string; lat: number; lng: number; demand: number; }

const spec = PACKAGE_SPECS.find((s) => s.modelId === "two-echelon-gold-au")!;
const pkg = validatePackage(spec) as {
  "mines.json": Record<string, MineEntry>;
  "refineries.json": Record<string, RefineryEntry>;
  "customers.json": Record<string, GoldCustomerEntry>;
};

// The single mine plays the "warehouse" role in the shared Dataset shape
// NetworkMap.tsx renders, same as transport-coal's mines/stations reuse —
// but unlike transport-coal, only the 2 refineries are an overridable
// facility-location decision (the mine is fixed). `kind: "mine"` tags the
// one non-overridable row so callers (export/import entity pairing, the
// Refineries override table, map multi-select) can filter it out without
// a second dataset shape.
export const GOLD_MINES: WarehouseCandidate[] = Object.values(pkg["mines.json"]).map((m) => ({
  id: m.id, city: m.city, state: m.state, lat: m.lat, lng: m.lng, kind: "mine",
}));

export const GOLD_REFINERIES: WarehouseCandidate[] = Object.values(pkg["refineries.json"]).map((r) => ({
  id: r.id, city: r.city, state: r.state, lat: r.lat, lng: r.lng, kind: "facility",
}));

export const GOLD_WAREHOUSES: WarehouseCandidate[] = [...GOLD_MINES, ...GOLD_REFINERIES];

export const GOLD_CUSTOMERS: Customer[] = Object.values(pkg["customers.json"]).map((c) => ({
  id: c.id, city: c.city, state: c.state, lat: c.lat, lng: c.lng, demand: c.demand,
}));
