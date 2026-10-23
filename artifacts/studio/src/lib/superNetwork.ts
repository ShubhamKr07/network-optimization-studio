import type { MapCustomer, MapPlant, MapWarehouse } from "@/components/workspace/map/types";
import type { WhStatus } from "@/components/workspace/map/statusPresentation";
type Row = Record<string, unknown>;
export type SuperInputsLike = Record<string, unknown> & {
  products: Row[]; plants: Row[]; warehouses: Row[]; customers: Row[];
  plantProducts: Row[]; demand: Row[]; distanceOverrides: Row[];
};
export type SuperTable = "products" | "plants" | "warehouses" | "customers" | "plantProducts" | "demand" | "distanceOverrides";
type Entity = "products" | "plants" | "warehouses" | "customers";

const REFS: Record<Entity, Partial<Record<SuperTable, (r: Row, id: string) => boolean>>> = {
  products: { plantProducts: (r, id) => r.productId === id, demand: (r, id) => r.productId === id },
  plants: { plantProducts: (r, id) => r.plantId === id, distanceOverrides: (r, id) => r.fromId === id },
  warehouses: { distanceOverrides: (r, id) => r.fromId === id || r.toId === id },
  customers: { demand: (r, id) => r.customerId === id, distanceOverrides: (r, id) => r.toId === id },
};

export function referencingRows(inputs: SuperInputsLike, table: Entity, id: string): number {
  return Object.entries(REFS[table]).reduce((n, [t, hit]) => n + (inputs[t as SuperTable] as Row[]).filter(r => hit!(r, id)).length, 0);
}
export function cascadeDelete(inputs: SuperInputsLike, table: Entity, id: string): SuperInputsLike {
  const next = { ...inputs, [table]: inputs[table].filter(r => r.id !== id) } as SuperInputsLike;
  for (const [t, hit] of Object.entries(REFS[table]))
    (next as Record<string, Row[]>)[t] = (inputs[t as SuperTable] as Row[]).filter(r => !hit!(r, id));
  return next;
}
export const SUPER_SAMPLE_URL = "/samples/super-model-sample.json";
export const SUPER_TEMPLATE_URL = "/samples/super-model-template.json";

export const SUPER_TABLE_KEYS: readonly SuperTable[] = ["products", "plants", "warehouses", "customers", "plantProducts", "demand", "distanceOverrides"];
export function superTablesEmpty(inputs: Record<string, unknown> | null | undefined): boolean {
  return !!inputs && SUPER_TABLE_KEYS.every(k => !Array.isArray(inputs[k]) || (inputs[k] as unknown[]).length === 0);
}

export interface SuperMapRows { plants: MapPlant[]; warehouses: MapWarehouse[]; customers: MapCustomer[] }
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** Every Super row is scenario-owned (isAdded: true => full action set); the row id IS the marker code. */
export function superMapRows(inputs: SuperInputsLike): SuperMapRows {
  const demand = new Map<string, number>();
  for (const d of inputs.demand) demand.set(String(d.customerId), (demand.get(String(d.customerId)) ?? 0) + Number(d.demand ?? 0));
  const base = (r: Row) => ({ id: String(r.id), displayCode: String(r.id), city: str(r.city), state: str(r.state), lat: Number(r.lat), lng: Number(r.lng), isAdded: true });
  return {
    plants: inputs.plants.map(base),
    warehouses: inputs.warehouses.map(r => ({ ...base(r), status: (r.status ?? "active") as WhStatus })),
    customers: inputs.customers.map(r => ({ ...base(r), demand: demand.get(String(r.id)) ?? 0, excluded: r.status === "excluded" })),
  };
}
