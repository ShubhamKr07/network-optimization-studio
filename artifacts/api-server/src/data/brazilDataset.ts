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
