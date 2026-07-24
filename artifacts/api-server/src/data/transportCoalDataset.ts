import { validatePackage, PACKAGE_SPECS } from "@workspace/dataset-schema";
import type { WarehouseCandidate, Customer } from "./dataset.js";

interface MineEntry { id: string; name: string; city: string; state: string; lat: number; lng: number; capacity: number; }
interface StationEntry { id: string; city: string; state: string; lat: number; lng: number; demand: number; }

const spec = PACKAGE_SPECS.find((s) => s.modelId === "transport-coal")!;
const pkg = validatePackage(spec);
const mines = pkg["mines.json"] as Record<string, MineEntry>;
const stations = pkg["stations.json"] as Record<string, StationEntry>;

// Mines play the "warehouse" role and stations play the "customer" role in
// the shared Dataset shape NetworkMap.tsx already renders — this lets the
// existing map component show transport-coal's real mine/station geometry
// with zero changes to NetworkMap.tsx's own field names.
export const TRANSPORT_COAL_WAREHOUSES: WarehouseCandidate[] = Object.values(mines).map((m) => ({
  id: m.id,
  city: m.city,
  state: m.state,
  lat: m.lat,
  lng: m.lng,
}));

export const TRANSPORT_COAL_CUSTOMERS: Customer[] = Object.values(stations).map((s) => ({
  id: s.id,
  city: s.city,
  state: s.state,
  lat: s.lat,
  lng: s.lng,
  demand: s.demand,
}));
