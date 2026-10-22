import { Input } from "@/components/ui/input";
import type { ColumnDef } from "@/components/data-table/types";
import { DeleteRowButton, DraftNumberInput, READ_ONLY_TITLE, StatusToggle } from "@/components/data-table/entityCells";
import type { SuperTable } from "@/lib/superNetwork";

export type Row = Record<string, unknown>;
/** DataTable row: the index is the React/row key, so editing an id cell never remounts its row. */
export type Item = { r: Row; i: number };
export interface SuperOptions {
  productIds?: string[]; plantIds?: string[]; customerIds?: string[];
  /** distanceOverrides only: plant + warehouse ids / warehouse + customer ids. */
  fromIds?: string[]; toIds?: string[];
}

type Spec =
  | { key: string; kind: "text" | "number" }
  | { key: string; kind: "select"; options: keyof SuperOptions }
  | { key: "status"; kind: "status"; values: readonly string[] };

const ENTITY = (extra: Spec[]): Spec[] => [
  { key: "id", kind: "text" }, { key: "name", kind: "text" }, ...extra,
];
const SITE: Spec[] = [
  { key: "city", kind: "text" }, { key: "state", kind: "text" },
  { key: "lat", kind: "number" }, { key: "lng", kind: "number" },
];
const SPECS: Record<SuperTable, Spec[]> = {
  products: ENTITY([]),
  plants: ENTITY(SITE),
  warehouses: ENTITY([...SITE, { key: "status", kind: "status", values: ["active", "forced_open", "inactive"] }]),
  customers: ENTITY([...SITE, { key: "status", kind: "status", values: ["active", "excluded"] }]),
  plantProducts: [
    { key: "plantId", kind: "select", options: "plantIds" },
    { key: "productId", kind: "select", options: "productIds" },
    { key: "capacity", kind: "number" }, { key: "costPerUnit", kind: "number" },
  ],
  demand: [
    { key: "customerId", kind: "select", options: "customerIds" },
    { key: "productId", kind: "select", options: "productIds" },
    { key: "demand", kind: "number" },
  ],
  distanceOverrides: [
    { key: "fromId", kind: "select", options: "fromIds" },
    { key: "toId", kind: "select", options: "toIds" },
    { key: "miles", kind: "number" },
  ],
};

const HEADERS: Record<string, string> = {
  id: "ID", name: "Name", city: "City", state: "State", lat: "Lat", lng: "Lng", status: "Status",
  plantId: "Plant", productId: "Product", capacity: "Capacity", costPerUnit: "Cost / unit",
  customerId: "Customer", demand: "Demand", fromId: "From", toId: "To", miles: "Miles",
};

export const ENTITY_TABLES = ["products", "plants", "warehouses", "customers"] as const;
export const isEntityTable = (t: SuperTable): t is (typeof ENTITY_TABLES)[number] => (ENTITY_TABLES as readonly string[]).includes(t);

export function superRowKey(table: SuperTable, r: Row): string {
  if (table === "plantProducts") return `${r.plantId}|${r.productId}`;
  if (table === "demand") return `${r.customerId}|${r.productId}`;
  if (table === "distanceOverrides") return `${r.fromId}|${r.toId}`;
  return String(r.id ?? "");
}

export function blankRow(table: SuperTable, o: SuperOptions): Row {
  switch (table) {
    case "products": return { id: "", name: "" };
    case "plants": return { id: "", name: "", city: "", state: "", lat: 0, lng: 0 };
    case "warehouses": return { id: "", name: "", city: "", state: "", lat: 0, lng: 0, status: "active" };
    case "customers": return { id: "", name: "", city: "", state: "", lat: 0, lng: 0, status: "active" };
    case "plantProducts": return { plantId: o.plantIds?.[0] ?? "", productId: o.productIds?.[0] ?? "", capacity: 0, costPerUnit: 0 };
    case "demand": return { customerId: o.customerIds?.[0] ?? "", productId: o.productIds?.[0] ?? "", demand: 0 };
    case "distanceOverrides": return { fromId: o.fromIds?.[0] ?? "", toId: o.toIds?.[0] ?? "", miles: 1 };
  }
}

const parseNum = (min: number | null) => (raw: string) => {
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return min == null ? n : Math.max(min, n);
};

export function superColumns(
  table: SuperTable,
  o: SuperOptions,
  readOnly: boolean,
  edit: (i: number, key: string, value: unknown) => void,
  remove: (item: Item) => void,
): ColumnDef<Item>[] {
  const tid = (it: Item, col: string) => `super-${table}-${superRowKey(table, it.r)}-${col}`;
  const cols: ColumnDef<Item>[] = SPECS[table].map((s): ColumnDef<Item> => {
    const base = { id: s.key, header: HEADERS[s.key], value: (it: Item) => (it.r[s.key] as string | number | null) ?? null, cellTestId: (it: Item) => `cell-${tid(it, s.key)}` };
    if (s.kind === "number") {
      // lat/lng may be negative; every other number is >= 0 (miles > 0 is enforced server-side).
      const min = s.key === "lat" || s.key === "lng" ? null : 0;
      return { ...base, kind: "number", filter: false, cell: it => (
        <DraftNumberInput value={it.r[s.key] as number} parse={parseNum(min)} disabled={readOnly}
          onCommit={v => v != null && edit(it.i, s.key, v)} testId={tid(it, s.key)} />
      ) };
    }
    if (s.kind === "select") {
      const ids = o[s.options] ?? [];
      return { ...base, kind: "enum", cell: it => (
        <select className="h-7 text-xs border rounded bg-white px-1" value={String(it.r[s.key] ?? "")} disabled={readOnly}
          title={readOnly ? READ_ONLY_TITLE : undefined} data-testid={tid(it, s.key)}
          onChange={e => edit(it.i, s.key, e.target.value)}>
          {ids.includes(String(it.r[s.key] ?? "")) ? null : <option value={String(it.r[s.key] ?? "")}>{String(it.r[s.key] ?? "")}</option>}
          {ids.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      ) };
    }
    if (s.kind === "status") {
      return { ...base, kind: "enum", cell: it => (
        <StatusToggle options={s.values} value={String(it.r.status ?? "active")} disabled={readOnly}
          labelOf={v => v.replace("_", " ")} activeClassOf={() => "bg-primary text-white"}
          onChange={v => edit(it.i, "status", v)} testIdOf={v => `${tid(it, "status")}-${v}`} />
      ) };
    }
    return { ...base, kind: "text", cell: it => (
      <Input className="h-7 text-xs min-w-24" value={String(it.r[s.key] ?? "")} disabled={readOnly}
        title={readOnly ? READ_ONLY_TITLE : undefined} data-testid={tid(it, s.key)}
        onChange={e => edit(it.i, s.key, e.target.value)} />
    ) };
  });
  cols.push({
    id: "delete", header: "", kind: "text", filter: false, value: () => "",
    cell: it => <DeleteRowButton label="Delete row" disabled={readOnly} onClick={() => remove(it)} testId={tid(it, "delete")} />,
  });
  return cols;
}
