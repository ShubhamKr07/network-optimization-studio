// SCU-2.P3.5/P3.6 (spec B2.4, user decision 2026-10-17) — JADE Flows'
// client-built downloads are EXACTLY the on-screen table: the same columns
// (header text verbatim; the unit goes into the Distance header) and the same
// rows (one per plant→warehouse pair / per customer, flow summed over
// products), ALL rows — never just the filtered or paged ones. Values are
// typed, not rendered text: the single-line entity label the cell falls back
// to, distance in the active display unit at the on-screen 1-dp precision,
// flow as a plain number, the band label the cell shows.
import { csvCell, downloadTextFile } from "@/lib/clientCsv";

/** One on-screen JADE Flows row, as the tab's own row model holds it. */
export interface JadeFlowScreenRow {
  fromLabel: string;
  toLabel: string;
  /** Canonical distance (the result's unit). */
  distance: number;
  flow: number;
  band: string;
}

export interface JadeFlowLeg {
  entity: "jadeFlowsPlantWarehouse" | "jadeFlowsWarehouseCustomer";
  fileBase: string;
  /** On-screen header text, in column order. */
  headers: readonly [string, string, string, string, string];
  /** JSON keys, in the same order. */
  keys: readonly [string, string, string, string, string];
}

export const PLANT_WAREHOUSE_LEG: JadeFlowLeg = {
  entity: "jadeFlowsPlantWarehouse",
  fileBase: "jade-flows-plant-warehouse",
  headers: ["Plant", "Warehouse", "Distance", "Flow", "Distance Band"],
  keys: ["plant", "warehouse", "distance", "flow", "distanceBand"],
};

export const WAREHOUSE_CUSTOMER_LEG: JadeFlowLeg = {
  entity: "jadeFlowsWarehouseCustomer",
  fileBase: "jade-flows-warehouse-customer",
  headers: ["Warehouse", "Customer", "Distance", "Flows", "Distance Band"],
  keys: ["warehouse", "customer", "distance", "flows", "distanceBand"],
};

type Cells = [string, string, number, number, string];

function cells(row: JadeFlowScreenRow, toDisplay: (canonical: number) => number): Cells {
  return [row.fromLabel, row.toLabel, Number(toDisplay(row.distance).toFixed(1)), row.flow, row.band];
}

export function jadeFlowsCsv(leg: JadeFlowLeg, rows: JadeFlowScreenRow[], toDisplay: (canonical: number) => number, unit: string): string {
  const header = leg.headers.map(h => (h === "Distance" ? `Distance (${unit})` : h));
  return [header, ...rows.map(r => cells(r, toDisplay))].map(line => line.map(csvCell).join(",")).join("\n");
}

export interface JadeFlowsJson {
  entity: JadeFlowLeg["entity"];
  unit: string;
  rows: Array<Record<string, string | number>>;
}

export function jadeFlowsJson(leg: JadeFlowLeg, rows: JadeFlowScreenRow[], toDisplay: (canonical: number) => number, unit: string): JadeFlowsJson {
  return {
    entity: leg.entity,
    unit,
    rows: rows.map(r => Object.fromEntries(cells(r, toDisplay).map((v, i) => [leg.keys[i], v]))),
  };
}

export function downloadJadeFlows(
  leg: JadeFlowLeg,
  format: "csv" | "json",
  rows: JadeFlowScreenRow[],
  toDisplay: (canonical: number) => number,
  unit: string,
): void {
  if (format === "csv") downloadTextFile(`${leg.fileBase}.csv`, jadeFlowsCsv(leg, rows, toDisplay, unit), "text/csv");
  else downloadTextFile(`${leg.fileBase}.json`, JSON.stringify(jadeFlowsJson(leg, rows, toDisplay, unit), null, 2), "application/json");
}
