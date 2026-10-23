import type { PrecheckError, PrecheckResult } from "./precheck.js";
import type { SuperInputs } from "../validation/inputs/superInputs.js";
import { missingRequiredRoadPairs } from "./superRoad.js";

export function precheckSuperInputs(v: SuperInputs): PrecheckResult {
  const errors: PrecheckError[] = [];
  const err = (code: PrecheckError["code"], message: string) => errors.push({ code, message });
  for (const t of ["products", "plants", "warehouses"] as const)
    if (v[t].length === 0) err("completeness", `Add at least one row to ${t}.`);
  const active = new Set(v.customers.filter(c => c.status !== "excluded").map(c => c.id));
  if (active.size === 0) err("completeness", "Add at least one active customer.");
  const demandBy = new Map<string, number>();
  for (const d of v.demand) if (active.has(d.customerId)) demandBy.set(d.productId, (demandBy.get(d.productId) ?? 0) + d.demand);
  if (![...demandBy.values()].some(x => x > 0)) err("zero_demand", "No active customer has positive demand.");
  const capBy = new Map<string, number>();
  for (const r of v.plantProducts) capBy.set(r.productId, (capBy.get(r.productId) ?? 0) + r.capacity);
  for (const [k, dem] of demandBy) if (dem > (capBy.get(k) ?? 0))
    err("capacity", `Product ${k}: total plant capacity ${capBy.get(k) ?? 0} is below total demand ${dem}.`);
  const eligible = v.warehouses.filter(w => w.status !== "inactive").length;
  const forced = v.warehouses.filter(w => w.status === "forced_open").length;
  if (v.p > eligible) err("p_range", `p = ${v.p} exceeds the ${eligible} warehouse(s) that can open.`);
  if (forced > v.p) err("p_range", `${forced} forced-open warehouses exceed p = ${v.p}.`);
  if (v.distanceMethod === "road") {
    const missing = missingRequiredRoadPairs(v);
    if (missing > 0) err("completeness", `${missing} required road distance pair(s) are missing or out of date. Fetch road distances, or add distance overrides.`);
  }
  const t = v.transportCosts;
  if (![t.icTransCost, t.icMinTrans, t.obTransCost, t.obMinTrans, ...v.plantProducts.map(r => r.costPerUnit)].every(Number.isFinite))
    err("coefficient_range", "A cost coefficient is not a finite number.");
  return { ok: errors.length === 0, errors };
}
