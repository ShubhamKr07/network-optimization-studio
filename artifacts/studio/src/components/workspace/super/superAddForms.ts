// QFX-6 — the per-tab "Add …" forms. Fields come from the table's own SPECS/HEADERS (one source for table and form);
// the rules mirror the server validator, artifacts/api-server/src/validation/inputs/superInputs.ts.
import { nextFreeId, type LocKind, type SuperInputsLike, type SuperTable } from "@/lib/superNetwork";
import { HEADERS, SPECS, type Row, type Spec } from "./superTables";

/** Server SUPER_CAPS (superInputs.ts:4). Pair tables have no row cap. */
const CAP: Partial<Record<SuperTable, number>> = { products: 10, plants: 20, warehouses: 50, customers: 500 };
const WCP_CAP = 50_000;

export const SUPER_ADD_FORMS: Record<SuperTable, { label: string; needs?: { ok(n: SuperInputsLike): boolean; message: string } }> = {
  products: { label: "Add product" },
  plants: { label: "Add plant" },
  warehouses: { label: "Add warehouse" },
  customers: { label: "Add customer" },
  plantProducts: { label: "Add capability", needs: { ok: n => n.plants.length > 0 && n.products.length > 0, message: "Add a plant and a product first." } },
  demand: { label: "Add demand", needs: { ok: n => n.customers.length > 0 && n.products.length > 0, message: "Add a customer and a product first." } },
  distanceOverrides: {
    label: "Add distance override",
    needs: { ok: n => n.warehouses.length > 0 && (n.plants.length > 0 || n.customers.length > 0), message: "Add warehouses with plants or customers first." },
  },
};

const LOC_KIND: Partial<Record<SuperTable, LocKind>> = { plants: "pl", warehouses: "wh", customers: "cs" };
const OPTIONAL = new Set(["city", "state"]);
const RANGE: Record<string, [number, number]> = { lat: [-90, 90], lng: [-180, 180] };   // every other number is >= 0
const PAIR: Partial<Record<SuperTable, [string, string, (a: string, b: string) => string]>> = {
  plantProducts: ["plantId", "productId", (a, b) => `Plant ${a} already has a row for product ${b}.`],
  demand: ["customerId", "productId", (a, b) => `Customer ${a} already has demand for product ${b}.`],
  distanceOverrides: ["fromId", "toId", (a, b) => `An override for ${a} → ${b} already exists.`],
};

export interface AddField { key: string; label: string; spec: Spec; required: boolean }
export const superAddFields = (table: SuperTable): AddField[] =>
  SPECS[table].map(spec => ({ key: spec.key, label: HEADERS[spec.key], spec, required: !OPTIONAL.has(spec.key) }));

export function superAddDisabledReason(table: SuperTable, n: SuperInputsLike): string | null {
  const cap = CAP[table];
  if (cap != null && n[table].length >= cap) return `Limit reached: at most ${cap} ${table}.`;
  const needs = SUPER_ADD_FORMS[table].needs;
  return needs && !needs.ok(n) ? needs.message : null;
}

export function superAddDefaults(table: SuperTable, n: SuperInputsLike): Record<string, string> {
  const v: Record<string, string> = Object.fromEntries(SPECS[table].map(s => [s.key, ""]));
  const kind = LOC_KIND[table];
  if (kind) v.id = nextFreeId(n, kind);
  if ("status" in v) v.status = "active";
  return v;
}

const ids = (rows: Row[]) => rows.map(r => String(r.id));
/** Dropdown ids from the draft. Distances: only pairs the server accepts (superInputs.ts:81-83), so To depends on From. */
export function superAddOptions(key: string, values: Record<string, string>, n: SuperInputsLike): string[] {
  switch (key) {
    case "plantId": return ids(n.plants);
    case "productId": return ids(n.products);
    case "customerId": return ids(n.customers);
    case "fromId": return [...(n.warehouses.length ? ids(n.plants) : []), ...(n.customers.length ? ids(n.warehouses) : [])];
    case "toId":
      if (ids(n.plants).includes(values.fromId)) return ids(n.warehouses);
      if (ids(n.warehouses).includes(values.fromId)) return ids(n.customers);
      return [];
    default: return [];
  }
}

export interface SuperAddCheck { errors: Record<string, string>; formError: string | null; row: Row | null }

export function validateSuperAdd(table: SuperTable, values: Record<string, string>, n: SuperInputsLike): SuperAddCheck {
  const errors: Record<string, string> = {};
  const row: Row = {};
  for (const f of superAddFields(table)) {
    const raw = (values[f.key] ?? "").trim();
    if (raw === "") { if (f.required) errors[f.key] = "Required."; continue; }   // blank optional text is omitted, as the import does
    if (f.spec.kind === "number") {
      const x = Number(raw);
      const [lo, hi] = RANGE[f.key] ?? [0, Infinity];
      if (!Number.isFinite(x)) errors[f.key] = "Enter a number.";
      else if (x < lo || x > hi) errors[f.key] = hi === Infinity ? "Must be 0 or more." : `Must be between ${lo} and ${hi}.`;
      else row[f.key] = x;
    } else if (f.spec.kind === "select" && !superAddOptions(f.key, values, n).includes(raw)) errors[f.key] = "Choose from the list.";
    else row[f.key] = raw;
  }
  if (typeof row.id === "string") {
    const taken = table === "products" ? n.products : [...n.plants, ...n.warehouses, ...n.customers];
    if (taken.some(r => String(r.id).trim() === row.id))
      errors.id = table === "products" ? `ID "${row.id}" is already used by a product.` : `ID "${row.id}" is already used by a plant, warehouse or customer.`;
  }
  let formError: string | null = null;
  const pair = PAIR[table];
  if (pair) {
    const [a, b, message] = pair;
    if (row[a] != null && row[b] != null && n[table].some(r => String(r[a]) === row[a] && String(r[b]) === row[b])) formError = message(String(row[a]), String(row[b]));
  }
  if (table === "warehouses" || table === "customers" || table === "products") {
    const grow = (t: SuperTable) => n[t].length + (t === table ? 1 : 0);
    const product = grow("warehouses") * grow("customers") * grow("products");
    if (product > WCP_CAP)
      formError = `Limit reached: warehouses × customers × products would be ${product.toLocaleString("en-US")} (at most ${WCP_CAP.toLocaleString("en-US")}).`;
  }
  return { errors, formError, row: Object.keys(errors).length === 0 && formError === null ? row : null };
}
