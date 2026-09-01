import { BRAZIL_WAREHOUSES, BRAZIL_REGIONS } from "./dataset.js";
import type { WarehouseCandidate, Customer } from "./dataset.js";

// GET /dataset (B2-T3) needs p-median-brazil in the same {warehouses, customers}
// `Dataset` shape every other model already returns. `BRAZIL_WAREHOUSES`
// (data/dataset.ts) already has {id, city, state, lat, lng} — no adapting
// needed. `BRAZIL_REGIONS` has no city/state (regions aren't cities): the
// region name is the display label and the region code is the stable id, so
// the adapter is city = name, state = id (matches Compare's own convention
// for this model — see CLAUDE.md's Brazil dataset notes).
export const BRAZIL_DATASET_WAREHOUSES: WarehouseCandidate[] = BRAZIL_WAREHOUSES;

export const BRAZIL_DATASET_CUSTOMERS: Customer[] = BRAZIL_REGIONS.map((r) => ({
  id: r.id,
  city: r.name,
  state: r.id,
  lat: r.lat,
  lng: r.lng,
  demand: r.demand,
}));

// T9 (Brazil CSV import/export) — the Brazil analogue of data/dataset.ts's
// TOTAL_DEMAND, needed by services/import.ts's capacity-vs-demand cross-field
// warning (warehouses entity only) so a Brazil scenario's warning compares
// against Brazil's own ~114M total region demand, not p-median-us's 200-
// customer total.
export const BRAZIL_TOTAL_DEMAND = BRAZIL_DATASET_CUSTOMERS.reduce((sum, c) => sum + c.demand, 0);
