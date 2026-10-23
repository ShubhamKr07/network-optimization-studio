import type { SuperInputs } from "../validation/inputs/superInputs.js";

export interface RoadPair { fromId: string; toId: string; miles: number }
const key = (a: string, b: string) => `${a}|${b}`;

/** D8 — the only road-validity implementation (precheck and the solve payload both call it; Python and the Studio never
 *  recompute it). Exact equality is intended: both sides are the same stored JSON numbers, and a move writes new numbers. */
export function validRoadPairs(v: SuperInputs): RoadPair[] {
  const rd = v.roadDistances;
  if (!rd) return [];
  const at = new Map([...v.plants, ...v.warehouses, ...v.customers].map(l => [l.id, l]));
  const same = (id: string) => {
    const l = at.get(id), c = rd.coords[id];
    return !!l && !!c && l.lat === c[0] && l.lng === c[1];
  };
  return rd.pairs.filter(p => same(p.fromId) && same(p.toId));
}

/** §8 readiness: required = plant→eligible WH and eligible WH→active customer, minus overridden pairs. */
export function missingRequiredRoadPairs(v: SuperInputs): number {
  const valid = new Set(validRoadPairs(v).map(p => key(p.fromId, p.toId)));
  const overridden = new Set(v.distanceOverrides.map(o => key(o.fromId, o.toId)));
  const eligible = v.warehouses.filter(w => w.status !== "inactive");
  const active = v.customers.filter(c => c.status !== "excluded");
  let missing = 0;
  const need = (a: string, b: string) => { const k = key(a, b); if (!overridden.has(k) && !valid.has(k)) missing++; };
  for (const p of v.plants) for (const w of eligible) need(p.id, w.id);
  for (const w of eligible) for (const c of active) need(w.id, c.id);
  return missing;
}
