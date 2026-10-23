import { z } from "zod";
import { superParamSchemas, superTableSchemas, SUPER_DEFAULT_INPUTS, pairKey, type SuperInputs } from "../validation/inputs/superInputs.js";
import type { InputIssue } from "../validation/formatInputIssues.js";

// Every key optional; unknown keys are rejected so a typo'd table name is an error, not a silent no-op.
export const superNetworkDocSchema = z.object({
  ...Object.fromEntries(Object.entries(superParamSchemas).map(([k, s]) => [k, s.optional()])),
  ...Object.fromEntries(Object.entries(superTableSchemas).map(([k, s]) => [k, s.optional()])),
}).strict();
export type SuperNetworkDoc = z.infer<typeof superNetworkDocSchema>;

type Table = keyof typeof superTableSchemas;
const KEY: Record<Table, (r: Record<string, unknown>) => string> = {
  products: r => String(r.id), plants: r => String(r.id), warehouses: r => String(r.id), customers: r => String(r.id),
  plantProducts: r => pairKey(String(r.plantId), String(r.productId)), demand: r => pairKey(String(r.customerId), String(r.productId)),
  distanceOverrides: r => pairKey(String(r.fromId), String(r.toId)),
};
const LOCATION_TABLES = new Set<Table>(["plants", "warehouses", "customers"]);
const ID_TABLES = new Set<Table>([...LOCATION_TABLES, "products"]);   // tables whose key column is `id`

/** R4 (spec §7.3): a key repeated inside the imported document is an error in both modes, never last-wins.
 *  Location ids share one namespace (§3.3 global uniqueness); every later occurrence is reported. */
export function docDuplicateIssues(doc: SuperNetworkDoc): InputIssue[] {
  const issues: InputIssue[] = [];
  const seen = new Map<string, string>();                    // namespaced key -> "table row n" of first occurrence
  for (const t of Object.keys(KEY) as Table[]) {
    const rows = doc[t] as Record<string, unknown>[] | undefined;
    rows?.forEach((r, i) => {
      const ns = `${LOCATION_TABLES.has(t) ? "location" : t}:${KEY[t](r)}`;
      const first = seen.get(ns);
      if (first) issues.push({ path: ID_TABLES.has(t) ? [t, i, "id"] : [t, i], message: `Duplicate key in the imported file (first at ${first})` });
      else seen.set(ns, `${t} row ${i + 1}`);
    });
  }
  return issues;
}

export type MergeOrigin = Partial<Record<Table, (number | null)[]>>;

/** replace: absent keys reset to defaults (merged index == document index, so no origin). merge: upsert by key, never delete;
 *  origin[t][mergedIndex] = the document row that produced it, or null for a kept existing row. */
export function mergeNetwork(current: SuperInputs, doc: SuperNetworkDoc, mode: "replace" | "merge"): { next: Record<string, unknown>; origin: MergeOrigin } {
  if (mode === "replace") return { next: { ...SUPER_DEFAULT_INPUTS, ...doc }, origin: {} };
  const next: Record<string, unknown> = { ...current };
  const origin: MergeOrigin = {};
  for (const [k, v] of Object.entries(doc)) if (!(k in KEY)) next[k] = v;                 // parameters: overwrite
  for (const t of Object.keys(KEY) as Table[]) {                                          // EVERY table gets an origin, so an
    const key = KEY[t];                                                                   // issue on a table absent from the
    const rows = new Map((current[t] as Record<string, unknown>[]).map(r => [key(r), { r, src: null as number | null }]));
    ((doc[t] as Record<string, unknown>[] | undefined) ?? []).forEach((r, i) => rows.set(key(r), { r, src: i }));  // document maps to "Existing"
    next[t] = [...rows.values()].map(x => x.r);                                           // (Map.set keeps an existing key's position;
    origin[t] = [...rows.values()].map(x => x.src);                                       //  in-document duplicates were rejected before)
  }
  return { next, origin };
}

/** Rewrites whole-network issue paths from merged-table rows to imported-document rows (spec §7.1: path[1] is a file row). */
export function toDocIssues(issues: InputIssue[], origin: MergeOrigin): InputIssue[] {
  return issues.map(issue => {
    const [t, i, ...rest] = issue.path;
    const o = typeof t === "string" ? origin[t as Table] : undefined;
    if (!o || typeof i !== "number") return issue;
    const src = o[i];
    return src == null
      ? { path: [t as string], message: `Existing ${t} row ${i + 1}: ${issue.message}` }
      : { path: [t as string, src, ...rest], message: issue.message };
  });
}
