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
