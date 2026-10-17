// SCU-2.P3.5 (spec B2.4, user decision 2026-10-17) — JADE Flows downloads are
// exactly the on-screen table: same headers, same rows, typed values.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadJadeFlows,
  jadeFlowsCsv,
  jadeFlowsJson,
  PLANT_WAREHOUSE_LEG,
  WAREHOUSE_CUSTOMER_LEG,
} from "@/lib/jadeFlowsExport";

const rows = [
  { fromLabel: "plant-1 — Bethlehem, PA", toLabel: "Chicago, IL", distance: 293.66, flow: 1400, band: "Band 2" },
  { fromLabel: "plant-2 — Houston, TX", toLabel: "Dallas, TX", distance: 1200, flow: 300, band: "Overflow" },
];
const toKm = (mi: number) => mi * 1.609344;

afterEach(() => vi.restoreAllMocks());

describe("jadeFlowsCsv", () => {
  it("P→W: on-screen headers (unit in the Distance header), one line per on-screen row, 1-dp display-unit distance", () => {
    expect(jadeFlowsCsv(PLANT_WAREHOUSE_LEG, rows, d => d, "mi").split("\n")).toEqual([
      "Plant,Warehouse,Distance (mi),Flow,Distance Band",
      '"plant-1 — Bethlehem, PA","Chicago, IL",293.7,1400,Band 2',
      '"plant-2 — Houston, TX","Dallas, TX",1200,300,Overflow',
    ]);
  });

  it("W→C keeps its on-screen 'Flows' header and converts distance to the display unit", () => {
    const csv = jadeFlowsCsv(WAREHOUSE_CUSTOMER_LEG, rows.slice(0, 1), toKm, "km");
    expect(csv.split("\n")).toEqual(["Warehouse,Customer,Distance (km),Flows,Distance Band", '"plant-1 — Bethlehem, PA","Chicago, IL",472.6,1400,Band 2']);
  });
});

describe("jadeFlowsJson", () => {
  it("{ entity, unit, rows } with one typed object per on-screen row", () => {
    expect(jadeFlowsJson(PLANT_WAREHOUSE_LEG, rows, d => d, "mi")).toEqual({
      entity: "jadeFlowsPlantWarehouse",
      unit: "mi",
      rows: [
        { plant: "plant-1 — Bethlehem, PA", warehouse: "Chicago, IL", distance: 293.7, flow: 1400, distanceBand: "Band 2" },
        { plant: "plant-2 — Houston, TX", warehouse: "Dallas, TX", distance: 1200, flow: 300, distanceBand: "Overflow" },
      ],
    });
    expect(Object.keys(jadeFlowsJson(WAREHOUSE_CUSTOMER_LEG, rows, d => d, "mi").rows[0])).toEqual(["warehouse", "customer", "distance", "flows", "distanceBand"]);
  });
});

describe("downloadJadeFlows", () => {
  it("writes {fileBase}.csv as text/csv and {fileBase}.json as application/json", () => {
    // downloadTextFile is called inside clientCsv's module boundary from here, so
    // spy at the DOM boundary: the Blob parts + the anchor's download name.
    const RealBlob = globalThis.Blob;
    const blobSpy = vi.spyOn(globalThis, "Blob").mockImplementation((parts, opts) => new RealBlob(parts, opts));
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    downloadJadeFlows(PLANT_WAREHOUSE_LEG, "csv", rows, d => d, "mi");
    downloadJadeFlows(PLANT_WAREHOUSE_LEG, "json", rows, d => d, "mi");
    expect(names).toEqual(["jade-flows-plant-warehouse.csv", "jade-flows-plant-warehouse.json"]);
    expect(blobSpy.mock.calls[0][0]?.[0]).toBe(jadeFlowsCsv(PLANT_WAREHOUSE_LEG, rows, d => d, "mi"));
    expect(blobSpy.mock.calls[0][1]).toEqual({ type: "text/csv" });
    expect(JSON.parse(blobSpy.mock.calls[1][0]?.[0] as string)).toEqual(jadeFlowsJson(PLANT_WAREHOUSE_LEG, rows, d => d, "mi"));
    expect(blobSpy.mock.calls[1][1]).toEqual({ type: "application/json" });
  });
});
