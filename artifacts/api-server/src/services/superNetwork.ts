import { z } from "zod";
import { superParamSchemas, superTableSchemas, SUPER_DEFAULT_INPUTS, type SuperInputs } from "../validation/inputs/superInputs.js";

// Every key optional; unknown keys are rejected so a typo'd table name is an error, not a silent no-op.
export const superNetworkDocSchema = z.object({
  ...Object.fromEntries(Object.entries(superParamSchemas).map(([k, s]) => [k, s.optional()])),
  ...Object.fromEntries(Object.entries(superTableSchemas).map(([k, s]) => [k, s.optional()])),
}).strict();
export type SuperNetworkDoc = z.infer<typeof superNetworkDocSchema>;

type Table = keyof typeof superTableSchemas;
const KEY: Record<Table, (r: Record<string, unknown>) => string> = {
  products: r => String(r.id), plants: r => String(r.id), warehouses: r => String(r.id), customers: r => String(r.id),
  plantProducts: r => `${r.plantId}|${r.productId}`, demand: r => `${r.customerId}|${r.productId}`,
  distanceOverrides: r => `${r.fromId}|${r.toId}`,
};

/** Unvalidated next-inputs; applyScenarioInputWrite validates. replace: absent keys reset to defaults. merge: upsert by key, never delete. */
export function mergeNetwork(current: SuperInputs, doc: SuperNetworkDoc, mode: "replace" | "merge"): unknown {
  if (mode === "replace") return { ...SUPER_DEFAULT_INPUTS, ...doc };
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(doc)) {
    if (!(k in KEY)) { next[k] = v; continue; }
    const key = KEY[k as Table];
    const rows = new Map((current[k as Table] as Record<string, unknown>[]).map(r => [key(r), r]));
    for (const r of v as Record<string, unknown>[]) rows.set(key(r), r);
    next[k] = [...rows.values()];
  }
  return next;
}
