import { describe, it, expect } from "vitest";
import {
  TEMPLATE_VERSION,
  applyWarehouseOverrides,
  applyCustomerOverrides,
  applyRefineryOverrides,
  applyGoldCustomerOverrides,
  warehouseRowsToCsv,
  customerRowsToCsv,
  refineryRowsToCsv,
} from "../services/templates.js";

describe("applyWarehouseOverrides", () => {
  it("returns one row per baseline warehouse with default status 'active' and null capacity when no override exists", () => {
    const rows = applyWarehouseOverrides([]);
    expect(rows.length).toBe(26);
    const aln = rows.find(r => r.id === "ALN")!;
    expect(aln).toMatchObject({ templateVersion: TEMPLATE_VERSION, city: "Allentown", state: "PA", capacity: null, status: "active" });
  });

  it("merges a status override onto its matching row, leaving others untouched", () => {
    const rows = applyWarehouseOverrides([{ id: "ALN", status: "forced_open" }]);
    expect(rows.find(r => r.id === "ALN")!.status).toBe("forced_open");
    expect(rows.find(r => r.id === "ATL")!.status).toBe("active");
  });

  it("merges a capacity override onto its matching row", () => {
    const rows = applyWarehouseOverrides([{ id: "ALN", status: "active", capacity: 500000 }]);
    expect(rows.find(r => r.id === "ALN")!.capacity).toBe(500000);
  });
});

describe("applyCustomerOverrides", () => {
  it("returns one row per baseline customer with base demand and status 'active' when no override exists", () => {
    const rows = applyCustomerOverrides([]);
    expect(rows.length).toBe(200);
    const c1 = rows.find(r => r.id === "C1")!;
    expect(c1).toMatchObject({ templateVersion: TEMPLATE_VERSION, city: "Akron", state: "OH", demand: 205375, status: "active" });
  });

  it("merges a demand override onto its matching row, leaving others at base demand", () => {
    const rows = applyCustomerOverrides([{ id: "C1", status: "active", demand: 999 }]);
    expect(rows.find(r => r.id === "C1")!.demand).toBe(999);
    expect(rows.find(r => r.id === "C2")!.demand).toBe(535923);
  });

  it("merges an excluded status override", () => {
    const rows = applyCustomerOverrides([{ id: "C1", status: "excluded" }]);
    expect(rows.find(r => r.id === "C1")!.status).toBe("excluded");
  });
});

describe("warehouseRowsToCsv / customerRowsToCsv", () => {
  it("produces a header row plus one line per row, plain columns (no comment line)", () => {
    const rows = applyWarehouseOverrides([{ id: "ALN", status: "forced_open" }]).slice(0, 2);
    const csv = warehouseRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,capacity,status");
    expect(lines[1]).toBe(`${TEMPLATE_VERSION},ALN,Allentown,PA,,forced_open`);
    expect(lines.length).toBe(3);
  });

  it("customer CSV includes demand as a numeric column", () => {
    const rows = applyCustomerOverrides([]).slice(0, 1);
    const csv = customerRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,demand,status");
    expect(lines[1]).toBe(`${TEMPLATE_VERSION},C1,Akron,OH,205375,active`);
  });

  it("escapes a comma in a city name", () => {
    const rows = [{ templateVersion: TEMPLATE_VERSION, id: "X1", city: "Springfield, Ohio", state: "OH", capacity: null, status: "active" as const }];
    const csv = warehouseRowsToCsv(rows);
    expect(csv).toContain('"Springfield, Ohio"');
  });
});

describe("applyRefineryOverrides", () => {
  it("returns one row per refinery, excluding the mine, with default status 'active'", () => {
    const rows = applyRefineryOverrides([]);
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.id).sort()).toEqual(["cunnamulla", "daggar-hills"]);
    expect(rows.find(r => r.id === "daggar-hills")).toMatchObject({ templateVersion: TEMPLATE_VERSION, city: "Daggar Hills", state: "WA", status: "active" });
    // no capacity field at all — refineries have none
    expect(rows.find(r => r.id === "daggar-hills")).not.toHaveProperty("capacity");
  });

  it("merges a status override onto its matching refinery, leaving the other untouched", () => {
    const rows = applyRefineryOverrides([{ id: "cunnamulla", status: "forced_open" }]);
    expect(rows.find(r => r.id === "cunnamulla")!.status).toBe("forced_open");
    expect(rows.find(r => r.id === "daggar-hills")!.status).toBe("active");
  });
});

describe("applyGoldCustomerOverrides", () => {
  it("returns one row per two-echelon-gold-au customer (10, not the p-median 200) with base demand", () => {
    const rows = applyGoldCustomerOverrides([]);
    expect(rows.length).toBe(10);
    expect(rows.find(r => r.id === "sydney")).toMatchObject({ templateVersion: TEMPLATE_VERSION, city: "Sydney", state: "NSW", demand: 500000, status: "active" });
  });

  it("merges a demand override, leaving other rows at base demand", () => {
    const rows = applyGoldCustomerOverrides([{ id: "sydney", status: "active", demand: 1 }]);
    expect(rows.find(r => r.id === "sydney")!.demand).toBe(1);
    expect(rows.find(r => r.id === "melbourne")!.demand).toBe(1000000);
  });
});

describe("refineryRowsToCsv", () => {
  it("produces a header row plus one line per row, status column, no value column", () => {
    const rows = applyRefineryOverrides([{ id: "cunnamulla", status: "forced_open" }]);
    const csv = refineryRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,status");
    expect(lines).toContain(`${TEMPLATE_VERSION},cunnamulla,Cunnamulla,QLD,forced_open`);
    expect(lines.length).toBe(3);
  });
});
