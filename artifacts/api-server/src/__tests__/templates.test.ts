import { describe, it, expect } from "vitest";
import {
  TEMPLATE_VERSION,
  applyWarehouseOverrides,
  applyCustomerOverrides,
  applyMineOverrides,
  applyStationOverrides,
  applyRefineryOverrides,
  applyGoldCustomerOverrides,
  applyBrazilWarehouseOverrides,
  applyBrazilCustomerOverrides,
  applyDistanceOverrides,
  applyLaneCostOverrides,
  applyJadeWarehouseOverrides,
  applyJadeCustomerOverrides,
  applyPlantOverrides,
  applyPlantCapabilityOverrides,
  plantRowsToCsv,
  plantCapabilityRowsToCsv,
  buildDistanceStubRows,
  buildLaneCostStubRows,
  buildLegDistanceStubRows,
  buildJadeLegDistanceStubRows,
  buildAssignmentRows,
  buildOpenWarehouseRows,
  buildCostSummaryRows,
  buildServiceStatsRows,
  buildFlowRows,
  flowRowsToCsv,
  warehouseRowsToCsv,
  customerRowsToCsv,
  mineRowsToCsv,
  stationRowsToCsv,
  refineryRowsToCsv,
  distanceRowsToCsv,
  laneCostRowsToCsv,
  assignmentRowsToCsv,
  openWarehouseRowsToCsv,
  costSummaryRowsToCsv,
  serviceStatsRowsToCsv,
} from "../services/templates.js";
import type { ResultEnvelope } from "../solver/resultEnvelope.js";

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

// T9 (Brazil CSV import/export) — the Brazil analogue of applyGoldCustomerOverrides'
// own-base-dataset test above: real Brazil ids (ANP a warehouse, SP a
// region/customer), neither of which exists in p-median-us's own 26/200
// datasets, proving the row set genuinely comes from Brazil's own dataset.
describe("applyBrazilWarehouseOverrides", () => {
  it("returns one row per Brazil warehouse (25, not p-median-us's 26), with real city/state", () => {
    const rows = applyBrazilWarehouseOverrides([]);
    expect(rows.length).toBe(25);
    const anp = rows.find(r => r.id === "ANP")!;
    expect(anp).toMatchObject({ templateVersion: TEMPLATE_VERSION, city: "Anápolis", state: "GO", capacity: null, status: "active" });
  });

  it("merges a status override onto its matching row, leaving others untouched", () => {
    const rows = applyBrazilWarehouseOverrides([{ id: "ANP", status: "forced_open" }]);
    expect(rows.find(r => r.id === "ANP")!.status).toBe("forced_open");
    expect(rows.find(r => r.id === "BEL")!.status).toBe("active");
  });

  it("an added Brazil warehouse appears with overridden: true", () => {
    const rows = applyBrazilWarehouseOverrides([], [
      { id: "aw-1", displayCode: "WH-BR-NEW-01", city: "Newtown", state: "SP", lat: -22.0, lng: -47.0, capacity: null, status: "active" },
    ]);
    expect(rows).toHaveLength(26);
    expect(rows.find(r => r.id === "aw-1")).toMatchObject({ city: "Newtown", state: "SP", overridden: true });
  });
});

describe("applyBrazilCustomerOverrides", () => {
  it("returns one row per Brazil region (25, not p-median-us's 200), with region name/id as city/state", () => {
    const rows = applyBrazilCustomerOverrides([]);
    expect(rows.length).toBe(25);
    const sp = rows.find(r => r.id === "SP")!;
    expect(sp).toMatchObject({ templateVersion: TEMPLATE_VERSION, city: "São Paulo Region", state: "SP", demand: 29029226, status: "active" });
  });

  it("merges a demand override, leaving other rows at base demand", () => {
    const rows = applyBrazilCustomerOverrides([{ id: "SP", status: "active", demand: 1 }]);
    expect(rows.find(r => r.id === "SP")!.demand).toBe(1);
    expect(rows.find(r => r.id === "RJ")!.demand).toBe(13370786);
  });
});

describe("warehouseRowsToCsv / customerRowsToCsv", () => {
  it("produces a header row plus one line per row, plain columns (no comment line), display_code + lat/lng included, no overridden column", () => {
    const rows = applyWarehouseOverrides([{ id: "ALN", status: "forced_open" }]).slice(0, 2);
    const csv = warehouseRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,display_code,city,state,lat,lng,capacity,status");
    // Base rows have no displayCode — blank cell.
    expect(lines[1]).toBe(`${TEMPLATE_VERSION},ALN,,Allentown,PA,40.602812,-75.470433,,forced_open`);
    expect(lines.length).toBe(3);
  });

  it("customer CSV includes demand as a numeric column, display_code + lat/lng included, no overridden column", () => {
    const rows = applyCustomerOverrides([]).slice(0, 1);
    const csv = customerRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,display_code,city,state,lat,lng,demand,status");
    expect(lines[1]).toBe(`${TEMPLATE_VERSION},C1,,Akron,OH,41.08,-81.52,205375,active`);
  });

  it("an added warehouse's displayCode is emitted in the display_code cell", () => {
    const rows = applyWarehouseOverrides([], [
      { id: "aw-1", displayCode: "WH-NC-NEWTOWN-01", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, capacity: 50000, status: "active" },
    ]);
    const csv = warehouseRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[lines.length - 1]).toBe(`${TEMPLATE_VERSION},aw-1,WH-NC-NEWTOWN-01,Newtown,NC,35.5,-80.2,50000,active`);
  });

  it("escapes a comma in a city name", () => {
    const rows = [{ templateVersion: TEMPLATE_VERSION, id: "X1", displayCode: null, city: "Springfield, Ohio", state: "OH", lat: 39.9, lng: -83.8, capacity: null, status: "active" as const, overridden: false }];
    const csv = warehouseRowsToCsv(rows);
    expect(csv).toContain('"Springfield, Ohio"');
  });
});

describe("B4.3 — lat/lng and overridden column", () => {
  it("a pristine base warehouse (no override) exports overridden: false, with real dataset coordinates", () => {
    const rows = applyWarehouseOverrides([]);
    const atl = rows.find(r => r.id === "ATL")!;
    expect(atl.overridden).toBe(false);
    expect(atl.lat).toBeCloseTo(33.753693);
    expect(atl.lng).toBeCloseTo(-84.389544);
  });

  it("a base warehouse with an active capacity override exports overridden: true", () => {
    const rows = applyWarehouseOverrides([{ id: "ALN", status: "active", capacity: 500000 }]);
    expect(rows.find(r => r.id === "ALN")!.overridden).toBe(true);
  });

  it("a base warehouse with a status-only override (forced_open) exports overridden: true", () => {
    const rows = applyWarehouseOverrides([{ id: "ALN", status: "forced_open" }]);
    expect(rows.find(r => r.id === "ALN")!.overridden).toBe(true);
  });

  it("a pristine base customer (no override) exports overridden: false", () => {
    const rows = applyCustomerOverrides([]);
    expect(rows.find(r => r.id === "C1")!.overridden).toBe(false);
  });

  it("a base customer with a demand override exports overridden: true", () => {
    const rows = applyCustomerOverrides([{ id: "C1", status: "active", demand: 999 }]);
    expect(rows.find(r => r.id === "C1")!.overridden).toBe(true);
  });

  it("includes one row per added warehouse, appended after the 26 base rows, always overridden: true", () => {
    const rows = applyWarehouseOverrides([], [
      { id: "WH-NEW1", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, capacity: 50000, status: "active" },
    ]);
    expect(rows.length).toBe(27);
    const added = rows.find(r => r.id === "WH-NEW1")!;
    expect(added).toMatchObject({ city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, capacity: 50000, status: "active", overridden: true });
  });

  it("includes one row per added customer, appended after the 200 base rows, always overridden: true", () => {
    const rows = applyCustomerOverrides([], [
      { id: "C-NEW1", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 1200 },
    ]);
    expect(rows.length).toBe(201);
    const added = rows.find(r => r.id === "C-NEW1")!;
    expect(added).toMatchObject({ city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 1200, status: "active", overridden: true });
  });

  // Task 26 — an added customer's export row now shows its real `state`
  // value (sourced from the addedCustomers record itself, same convention
  // as city/lat/lng), not the pre-fix placeholder "".
  it("an added customer's export row shows its real state, not a placeholder", () => {
    const rows = applyCustomerOverrides([], [
      { id: "C-NEW2", city: "Fresno", state: "CA", lat: 36.7, lng: -119.8, demand: 900 },
    ]);
    const added = rows.find(r => r.id === "C-NEW2")!;
    expect(added.state).toBe("CA");
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
  it("produces a header row plus one line per row, display_code + lat/lng + status columns, no value column", () => {
    const rows = applyRefineryOverrides([{ id: "cunnamulla", status: "forced_open" }]);
    const csv = refineryRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,display_code,city,state,lat,lng,status");
    expect(lines.some(l => l.startsWith("1,cunnamulla,,Cunnamulla,QLD,") && l.endsWith(",forced_open"))).toBe(true);
    expect(lines.length).toBe(3);
  });

  it("an added refinery's displayCode is emitted in the display_code cell", () => {
    const rows = applyRefineryOverrides([], [
      { id: "aw-1", displayCode: "REF-WA-NEWTOWN-01", city: "Newtown", state: "WA", lat: 35.5, lng: -80.2, status: "active" },
    ]);
    const csv = refineryRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[lines.length - 1]).toBe(`${TEMPLATE_VERSION},aw-1,REF-WA-NEWTOWN-01,Newtown,WA,35.5,-80.2,active`);
  });
});

describe("B4.3 — applyDistanceOverrides / distances export", () => {
  it("returns only the current distanceOverrides, each with overridden: true — not the full base matrix", () => {
    const rows = applyDistanceOverrides([
      { fromId: "ALN", toId: "C1", distance: 123.4 },
      { fromId: "ATL", toId: "C2", distance: 55.1 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.overridden === true)).toBe(true);
    expect(rows).toContainEqual({ templateVersion: TEMPLATE_VERSION, fromId: "ALN", toId: "C1", distance: 123.4, overridden: true });
  });

  it("returns an empty array when the scenario has no distanceOverrides", () => {
    expect(applyDistanceOverrides([])).toEqual([]);
  });
});

describe("distanceRowsToCsv", () => {
  it("produces a header row plus one line per row, 4 columns, no overridden column", () => {
    const rows = applyDistanceOverrides([{ fromId: "ALN", toId: "C1", distance: 123.4 }]);
    const csv = distanceRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,from_id,to_id,distance");
    expect(lines[1]).toBe(`${TEMPLATE_VERSION},ALN,C1,123.4`);
    expect(lines.length).toBe(2);
  });

  it("renders a null (stub) distance as an empty column", () => {
    const csv = distanceRowsToCsv([{ templateVersion: TEMPLATE_VERSION, fromId: "ALN", toId: "C1", distance: null }]);
    expect(csv.trim().split("\n")[1]).toBe(`${TEMPLATE_VERSION},ALN,C1,`);
  });
});

describe("B4.3 — buildDistanceStubRows (distances stub generator)", () => {
  // Small fake dataset, same testability pattern precheck.test.ts already
  // uses — service logic is exercised without depending on the real
  // 26/200-row p-median-us dataset. Real-dataset coverage (26/200-based
  // counts) is exercised at the route level (routes.test.ts).
  const DATASET = {
    warehouses: [{ id: "WH-A" }, { id: "WH-B" }],
    customers: [{ id: "C-1" }, { id: "C-2" }, { id: "C-3" }],
  };

  it("given a warehouse id, emits one blank row per active customer", () => {
    const rows = buildDistanceStubRows("WH-A", {}, DATASET);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        { templateVersion: TEMPLATE_VERSION, fromId: "WH-A", toId: "C-1", distance: null },
        { templateVersion: TEMPLATE_VERSION, fromId: "WH-A", toId: "C-2", distance: null },
        { templateVersion: TEMPLATE_VERSION, fromId: "WH-A", toId: "C-3", distance: null },
      ]),
    );
  });

  it("given a customer id, emits one blank row per active warehouse", () => {
    const rows = buildDistanceStubRows("C-1", {}, DATASET);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { templateVersion: TEMPLATE_VERSION, fromId: "WH-A", toId: "C-1", distance: null },
        { templateVersion: TEMPLATE_VERSION, fromId: "WH-B", toId: "C-1", distance: null },
      ]),
    );
  });

  it("excludes an inactive warehouse from a customer's stub rows", () => {
    const rows = buildDistanceStubRows("C-1", { warehouseOverrides: [{ id: "WH-B", status: "inactive" }] }, DATASET)!;
    expect(rows).toHaveLength(1);
    expect(rows[0].fromId).toBe("WH-A");
  });

  it("excludes an excluded customer from a warehouse's stub rows", () => {
    const rows = buildDistanceStubRows("WH-A", { customerOverrides: [{ id: "C-2", status: "excluded" }] }, DATASET)!;
    expect(rows.map(r => r.toId).sort()).toEqual(["C-1", "C-3"]);
  });

  it("resolves an added warehouse's stub rows against active base customers", () => {
    const rows = buildDistanceStubRows(
      "WH-NEW",
      { addedWarehouses: [{ id: "WH-NEW", city: "X", state: "Y", lat: 1, lng: 2, status: "active" }] },
      DATASET,
    )!;
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.fromId === "WH-NEW")).toBe(true);
  });

  it("resolves an added customer's stub rows against active base warehouses", () => {
    const rows = buildDistanceStubRows(
      "C-NEW",
      { addedCustomers: [{ id: "C-NEW", city: "X", lat: 1, lng: 2 }] },
      DATASET,
    )!;
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.toId === "C-NEW")).toBe(true);
  });

  it("returns null for an id that resolves as neither a known warehouse nor a known customer", () => {
    expect(buildDistanceStubRows("bogus-id", {}, DATASET)).toBeNull();
  });
});

// Task 30 (B6.1 stage 4) — mines/stations gain lat/lng + overridden + an
// addedMines/addedStations second param, catching up to
// applyWarehouseOverrides/applyCustomerOverrides' own B4.3 shape.
describe("applyMineOverrides", () => {
  it("returns one row per baseline mine with overridden:false and null capacity when no override exists", () => {
    const rows = applyMineOverrides([]);
    expect(rows.length).toBe(4);
    const ky = rows.find(r => r.id === "KY")!;
    expect(ky).toMatchObject({ templateVersion: TEMPLATE_VERSION, city: "Pikeville", state: "KY", capacity: null, overridden: false });
    expect(ky.lat).toBeCloseTo(37.54);
    expect(ky.lng).toBeCloseTo(-82.75);
  });

  it("merges a capacity override onto its matching row, marking it overridden", () => {
    const rows = applyMineOverrides([{ id: "KY", capacity: 1000000 }]);
    const ky = rows.find(r => r.id === "KY")!;
    expect(ky.capacity).toBe(1000000);
    expect(ky.overridden).toBe(true);
    expect(rows.find(r => r.id === "WY")!.overridden).toBe(false);
  });

  it("includes one row per added mine, appended after the base rows, always overridden: true", () => {
    const rows = applyMineOverrides([], [{ id: "MN-NEW", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 5000000 }]);
    expect(rows.length).toBe(5);
    const added = rows.find(r => r.id === "MN-NEW")!;
    expect(added).toMatchObject({ city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 5000000, overridden: true });
  });

  it("an added mine with no capacity (blank/omitted) exports capacity: null, still overridden: true", () => {
    const rows = applyMineOverrides([], [{ id: "MN-NEW", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19 }]);
    const added = rows.find(r => r.id === "MN-NEW")!;
    expect(added.capacity).toBeNull();
    expect(added.overridden).toBe(true);
  });
});

describe("applyStationOverrides", () => {
  it("returns one row per baseline station with overridden:false and base demand when no override exists", () => {
    const rows = applyStationOverrides([]);
    expect(rows.length).toBe(15);
    const chi = rows.find(r => r.id === "CHI")!;
    expect(chi.overridden).toBe(false);
    expect(typeof chi.lat).toBe("number");
    expect(typeof chi.lng).toBe("number");
  });

  it("merges a demand override onto its matching row, marking it overridden", () => {
    const rows = applyStationOverrides([{ id: "CHI", demand: 12000000 }]);
    const chi = rows.find(r => r.id === "CHI")!;
    expect(chi.demand).toBe(12000000);
    expect(chi.overridden).toBe(true);
  });

  it("includes one row per added station, appended after the base rows, always overridden: true", () => {
    const rows = applyStationOverrides([], [{ id: "ST-NEW", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 900000 }]);
    const added = rows.find(r => r.id === "ST-NEW")!;
    expect(added).toMatchObject({ city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 900000, overridden: true });
  });
});

describe("mineRowsToCsv / stationRowsToCsv", () => {
  it("mine CSV header includes display_code + lat/lng, no overridden column", () => {
    const rows = applyMineOverrides([{ id: "KY", capacity: 1000000 }]).slice(0, 1);
    const csv = mineRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,display_code,city,state,lat,lng,capacity");
    expect(lines[1]).toBe(`${TEMPLATE_VERSION},KY,,Pikeville,KY,37.54,-82.75,1000000`);
  });

  it("station CSV header includes display_code + lat/lng, no overridden column", () => {
    const rows = applyStationOverrides([]).filter(r => r.id === "CHI");
    const csv = stationRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,display_code,city,state,lat,lng,demand");
    expect(lines[1].startsWith(`${TEMPLATE_VERSION},CHI,,`)).toBe(true);
  });

  it("an added mine's displayCode is emitted in the display_code cell", () => {
    const rows = applyMineOverrides([], [
      { id: "am-1", displayCode: "MN-VA-BRISTOL-01", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 5000000 },
    ]);
    const csv = mineRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[lines.length - 1]).toBe(`${TEMPLATE_VERSION},am-1,MN-VA-BRISTOL-01,Bristol,VA,36.6,-82.19,5000000`);
  });
});

describe("Task 30 — applyLaneCostOverrides / laneCosts export", () => {
  it("returns only the current laneCostOverrides, each with overridden: true — not the full base matrix", () => {
    const rows = applyLaneCostOverrides([
      { fromId: "KY", toId: "CHI", cost: 123.4 },
      { fromId: "WY", toId: "STL", cost: 55.1 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.overridden === true)).toBe(true);
    expect(rows).toContainEqual({ templateVersion: TEMPLATE_VERSION, fromId: "KY", toId: "CHI", cost: 123.4, overridden: true });
  });

  it("returns an empty array when the scenario has no laneCostOverrides", () => {
    expect(applyLaneCostOverrides([])).toEqual([]);
  });
});

describe("Task 30 — laneCostRowsToCsv", () => {
  it("produces a header row plus one line per row, 4 columns, no overridden column", () => {
    const rows = applyLaneCostOverrides([{ fromId: "KY", toId: "CHI", cost: 123.4 }]);
    const csv = laneCostRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,from_id,to_id,cost");
    expect(lines[1]).toBe(`${TEMPLATE_VERSION},KY,CHI,123.4`);
    expect(lines.length).toBe(2);
  });

  it("renders a null (stub) cost as an empty column", () => {
    const csv = laneCostRowsToCsv([{ templateVersion: TEMPLATE_VERSION, fromId: "KY", toId: "CHI", cost: null }]);
    expect(csv.trim().split("\n")[1]).toBe(`${TEMPLATE_VERSION},KY,CHI,`);
  });
});

describe("Task 30 — buildLaneCostStubRows (laneCosts stub generator)", () => {
  // Small fake dataset, same testability pattern buildDistanceStubRows'
  // own tests use — real-dataset coverage is exercised at the route level.
  const DATASET = {
    warehouses: [{ id: "MN-A" }, { id: "MN-B" }],
    customers: [{ id: "ST-1" }, { id: "ST-2" }, { id: "ST-3" }],
  };

  it("given a mine id, emits one blank row per station (no active/inactive filtering)", () => {
    const rows = buildLaneCostStubRows("MN-A", {}, DATASET);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        { templateVersion: TEMPLATE_VERSION, fromId: "MN-A", toId: "ST-1", cost: null },
        { templateVersion: TEMPLATE_VERSION, fromId: "MN-A", toId: "ST-2", cost: null },
        { templateVersion: TEMPLATE_VERSION, fromId: "MN-A", toId: "ST-3", cost: null },
      ]),
    );
  });

  it("given a station id, emits one blank row per mine", () => {
    const rows = buildLaneCostStubRows("ST-1", {}, DATASET);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { templateVersion: TEMPLATE_VERSION, fromId: "MN-A", toId: "ST-1", cost: null },
        { templateVersion: TEMPLATE_VERSION, fromId: "MN-B", toId: "ST-1", cost: null },
      ]),
    );
  });

  it("resolves an added mine's stub rows against every station", () => {
    const rows = buildLaneCostStubRows(
      "MN-NEW",
      { addedMines: [{ id: "MN-NEW", city: "X", state: "Y", lat: 1, lng: 2 }] },
      DATASET,
    )!;
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.fromId === "MN-NEW")).toBe(true);
  });

  it("resolves an added station's stub rows against every mine", () => {
    const rows = buildLaneCostStubRows(
      "ST-NEW",
      { addedStations: [{ id: "ST-NEW", city: "X", state: "Y", lat: 1, lng: 2 }] },
      DATASET,
    )!;
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.toId === "ST-NEW")).toBe(true);
  });

  it("returns null for an id that resolves as neither a known mine nor a known station", () => {
    expect(buildLaneCostStubRows("bogus-id", {}, DATASET)).toBeNull();
  });

  it("defaults to the real transport-coal dataset when no dataset argument is given", () => {
    const rows = buildLaneCostStubRows("KY", {})!;
    expect(rows).not.toBeNull();
    expect(rows.length).toBe(15); // one row per real base station
  });
});

// B6.2 stage 4 — buildLegDistanceStubRows (two-echelon-gold-au's own
// legDistances stub generator). Structurally different from
// buildDistanceStubRows/buildLaneCostStubRows above: THREE roles (mine/
// refinery/customer), and a refinery — the middle role — needs stubs for
// BOTH adjacent legs at once, not just one direction.
describe("B6.2 — buildLegDistanceStubRows (legDistances stub generator)", () => {
  // Small fake dataset, same testability pattern the sibling stub
  // generators' own tests use — real-dataset coverage is exercised at the
  // route level.
  const DATASET = {
    mines: [{ id: "MINE-A" }],
    refineries: [{ id: "REF-A" }, { id: "REF-B" }],
    customers: [{ id: "C-1" }, { id: "C-2" }, { id: "C-3" }],
  };

  it("given the mine id, emits one blank row per active refinery", () => {
    const rows = buildLegDistanceStubRows("MINE-A", {}, DATASET)!;
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { templateVersion: TEMPLATE_VERSION, fromId: "MINE-A", toId: "REF-A", distance: null },
        { templateVersion: TEMPLATE_VERSION, fromId: "MINE-A", toId: "REF-B", distance: null },
      ]),
    );
  });

  it("given a refinery id, emits stub rows for BOTH legs: from every mine AND to every active customer", () => {
    const rows = buildLegDistanceStubRows("REF-A", {}, DATASET)!;
    expect(rows).toHaveLength(1 + 3); // 1 mine + 3 customers
    expect(rows).toContainEqual({ templateVersion: TEMPLATE_VERSION, fromId: "MINE-A", toId: "REF-A", distance: null });
    expect(rows).toContainEqual({ templateVersion: TEMPLATE_VERSION, fromId: "REF-A", toId: "C-1", distance: null });
    expect(rows).toContainEqual({ templateVersion: TEMPLATE_VERSION, fromId: "REF-A", toId: "C-2", distance: null });
    expect(rows).toContainEqual({ templateVersion: TEMPLATE_VERSION, fromId: "REF-A", toId: "C-3", distance: null });
  });

  it("given a customer id, emits one blank row per active refinery", () => {
    const rows = buildLegDistanceStubRows("C-1", {}, DATASET)!;
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { templateVersion: TEMPLATE_VERSION, fromId: "REF-A", toId: "C-1", distance: null },
        { templateVersion: TEMPLATE_VERSION, fromId: "REF-B", toId: "C-1", distance: null },
      ]),
    );
  });

  it("resolves an added refinery's stub rows against the mine and every customer", () => {
    const rows = buildLegDistanceStubRows(
      "REF-NEW",
      { addedRefineries: [{ id: "REF-NEW", city: "X", state: "Y", lat: 1, lng: 2, status: "active" }] },
      DATASET,
    )!;
    expect(rows).toHaveLength(1 + 3);
    expect(rows.some(r => r.fromId === "MINE-A" && r.toId === "REF-NEW")).toBe(true);
    expect(rows.filter(r => r.fromId === "REF-NEW").length).toBe(3);
  });

  it("resolves an added customer's stub rows against every refinery", () => {
    const rows = buildLegDistanceStubRows(
      "C-NEW",
      { addedCustomers: [{ id: "C-NEW", city: "X", lat: 1, lng: 2 }] },
      DATASET,
    )!;
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.toId === "C-NEW")).toBe(true);
  });

  it("returns null for an id that resolves as neither a known mine, refinery, nor customer", () => {
    expect(buildLegDistanceStubRows("bogus-id", {}, DATASET)).toBeNull();
  });

  it("defaults to the real two-echelon-gold-au dataset when no dataset argument is given", () => {
    const rows = buildLegDistanceStubRows("kalgoorlie", {})!;
    expect(rows).not.toBeNull();
    expect(rows.length).toBe(2); // one row per real base refinery
  });
});

// jade-T7 — two-echelon-jade-us's own warehouse/customer entities. Real
// base ids from the actual dataset package (plant-1/wh-1/customer-1).
describe("applyJadeWarehouseOverrides", () => {
  it("emits a row per real base warehouse, capacity always null (no per-warehouse capacity concept)", () => {
    const rows = applyJadeWarehouseOverrides([]);
    expect(rows.length).toBe(25);
    const wh1 = rows.find(r => r.id === "wh-1")!;
    expect(wh1.capacity).toBeNull();
    expect(wh1.status).toBe("active");
    expect(wh1.overridden).toBe(false);
  });

  it("applies a status override", () => {
    const rows = applyJadeWarehouseOverrides([{ id: "wh-1", status: "forced_open" }]);
    const wh1 = rows.find(r => r.id === "wh-1")!;
    expect(wh1.status).toBe("forced_open");
    expect(wh1.capacity).toBeNull();
    expect(wh1.overridden).toBe(true);
  });

  it("appends added warehouses after the base rows, capacity always null", () => {
    const rows = applyJadeWarehouseOverrides([], [
      { id: "aw-x", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" },
    ]);
    expect(rows.length).toBe(26);
    const added = rows.find(r => r.id === "aw-x")!;
    expect(added.capacity).toBeNull();
    expect(added.overridden).toBe(true);
  });
});

describe("applyJadeCustomerOverrides", () => {
  it("emits a row per real base customer, demand sourced from the base aggregate total", () => {
    const rows = applyJadeCustomerOverrides([]);
    expect(rows.length).toBe(100);
    const c1 = rows.find(r => r.id === "customer-1")!;
    expect(c1.demand).toBeCloseTo(86877.5);
    expect(c1.status).toBe("active");
    expect(c1.overridden).toBe(false);
  });

  it("applies a status override — demand is never touched by an override (no scalar demand field in this model's schema)", () => {
    const rows = applyJadeCustomerOverrides([{ id: "customer-1", status: "excluded" }]);
    const c1 = rows.find(r => r.id === "customer-1")!;
    expect(c1.status).toBe("excluded");
    expect(c1.demand).toBeCloseTo(86877.5);
    expect(c1.overridden).toBe(true);
  });

  it("appends added customers, demand summed across their per-product demands map", () => {
    const rows = applyJadeCustomerOverrides([], [
      {
        id: "ac-x", city: "Reno", state: "NV", lat: 39.5, lng: -119.8,
        demands: { "product-1": 10, "product-2": 20, "product-3": 30, "product-4": 40 },
      },
    ]);
    expect(rows.length).toBe(101);
    const added = rows.find(r => r.id === "ac-x")!;
    expect(added.demand).toBe(100);
    expect(added.status).toBe("active");
    expect(added.overridden).toBe(true);
  });
});

describe("applyPlantOverrides / plantRowsToCsv", () => {
  it("emits a row per real base plant, no capacity/status fields at all", () => {
    const rows = applyPlantOverrides();
    expect(rows.length).toBe(4);
    const plant1 = rows.find(r => r.id === "plant-1")!;
    expect(plant1).not.toHaveProperty("capacity");
    expect(plant1).not.toHaveProperty("status");
    expect(plant1.displayCode).toBeNull();
  });

  it("appends added plants after the base rows", () => {
    const rows = applyPlantOverrides([{ id: "ap-x", displayCode: "PL-NEW", city: "Reno", state: "NV", lat: 39.5, lng: -119.8 }]);
    expect(rows.length).toBe(5);
    const added = rows.find(r => r.id === "ap-x")!;
    expect(added.displayCode).toBe("PL-NEW");
  });

  it("CSV header has no capacity/status column", () => {
    const csv = plantRowsToCsv(applyPlantOverrides());
    const header = csv.split("\n")[0].split(",");
    expect(header).toEqual(["template_version", "id", "display_code", "city", "state", "lat", "lng"]);
  });
});

describe("applyPlantCapabilityOverrides / plantCapabilityRowsToCsv", () => {
  it("emits a full matrix — every base plant x every product (4 plants x 4 products = 16 rows)", () => {
    const rows = applyPlantCapabilityOverrides([]);
    expect(rows.length).toBe(16);
  });

  it("a cell's enabled default comes from its base capacity (>0 -> enabled), unoverridden", () => {
    const rows = applyPlantCapabilityOverrides([]);
    // Real dataset: each plant can make exactly ONE product (a diagonal
    // capability matrix) — 4 enabled cells out of 16.
    const enabledCells = rows.filter(r => r.enabled);
    expect(enabledCells.length).toBe(4);
    expect(rows.every(r => r.overridden === false)).toBe(true);
    const plant1Product1 = rows.find(r => r.plantId === "plant-1" && r.productId === "product-1")!;
    expect(plant1Product1.enabled).toBe(true);
    const plant1Product2 = rows.find(r => r.plantId === "plant-1" && r.productId === "product-2")!;
    expect(plant1Product2.enabled).toBe(false);
  });

  it("an override flips a cell's enabled value and marks it overridden", () => {
    const rows = applyPlantCapabilityOverrides([{ plantId: "plant-1", productId: "product-1", enabled: false }]);
    const cell = rows.find(r => r.plantId === "plant-1" && r.productId === "product-1")!;
    expect(cell.enabled).toBe(false);
    expect(cell.overridden).toBe(true);
  });

  it("an added plant defaults every cell to disabled unless overridden", () => {
    const rows = applyPlantCapabilityOverrides([], [{ id: "ap-x", city: "Reno", state: "NV", lat: 39.5, lng: -119.8 }]);
    const addedCells = rows.filter(r => r.plantId === "ap-x");
    expect(addedCells.length).toBe(4); // one per product
    expect(addedCells.every(r => r.enabled === false)).toBe(true);
  });

  it("an override on an added plant's cell turns it on", () => {
    const rows = applyPlantCapabilityOverrides(
      [{ plantId: "ap-x", productId: "product-1", enabled: true }],
      [{ id: "ap-x", city: "Reno", state: "NV", lat: 39.5, lng: -119.8 }],
    );
    const cell = rows.find(r => r.plantId === "ap-x" && r.productId === "product-1")!;
    expect(cell.enabled).toBe(true);
    expect(cell.overridden).toBe(true);
  });

  it("CSV header + a boolean cell renders as the literal string 'true'/'false'", () => {
    const csv = plantCapabilityRowsToCsv(applyPlantCapabilityOverrides([{ plantId: "plant-1", productId: "product-1", enabled: false }]));
    const header = csv.split("\n")[0].split(",");
    expect(header).toEqual(["template_version", "plant_id", "product_id", "enabled"]);
    expect(csv).toContain("plant-1,product-1,false");
  });
});

describe("jade-T7 — buildJadeLegDistanceStubRows (legDistances stub generator, plant/warehouse/customer roles)", () => {
  // Small fake dataset, same testability pattern buildLegDistanceStubRows'
  // own tests use — real-dataset coverage exercised at the route level.
  const DATASET = {
    plants: [{ id: "PLANT-A" }],
    warehouses: [{ id: "WH-A" }, { id: "WH-B" }],
    customers: [{ id: "C-1" }, { id: "C-2" }, { id: "C-3" }],
    productIds: [],
    capabilityCells: [],
  };

  it("given the plant id, emits one blank row per active warehouse", () => {
    const rows = buildJadeLegDistanceStubRows("PLANT-A", {}, DATASET)!;
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { templateVersion: TEMPLATE_VERSION, fromId: "PLANT-A", toId: "WH-A", distance: null },
        { templateVersion: TEMPLATE_VERSION, fromId: "PLANT-A", toId: "WH-B", distance: null },
      ]),
    );
  });

  it("given a warehouse id, emits stub rows for BOTH legs: from every plant AND to every active customer", () => {
    const rows = buildJadeLegDistanceStubRows("WH-A", {}, DATASET)!;
    expect(rows).toHaveLength(1 + 3); // 1 plant + 3 customers
    expect(rows).toContainEqual({ templateVersion: TEMPLATE_VERSION, fromId: "PLANT-A", toId: "WH-A", distance: null });
    expect(rows).toContainEqual({ templateVersion: TEMPLATE_VERSION, fromId: "WH-A", toId: "C-1", distance: null });
  });

  it("given a customer id, emits one blank row per active warehouse", () => {
    const rows = buildJadeLegDistanceStubRows("C-1", {}, DATASET)!;
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { templateVersion: TEMPLATE_VERSION, fromId: "WH-A", toId: "C-1", distance: null },
        { templateVersion: TEMPLATE_VERSION, fromId: "WH-B", toId: "C-1", distance: null },
      ]),
    );
  });

  it("returns null for an id that resolves as neither a known plant, warehouse, nor customer", () => {
    expect(buildJadeLegDistanceStubRows("bogus-id", {}, DATASET)).toBeNull();
  });

  it("defaults to the real two-echelon-jade-us dataset when no dataset argument is given", () => {
    const rows = buildJadeLegDistanceStubRows("plant-1", {})!;
    expect(rows).not.toBeNull();
    expect(rows.length).toBe(25); // one row per real base warehouse
  });
});

function makeResult(overrides: Partial<ResultEnvelope> = {}): ResultEnvelope {
  return {
    status: "optimal",
    objective: 29873735731,
    runTimeSec: 0.45,
    quality: "Proven optimal",
    edges: [
      { fromId: "ALN", toId: "C1", flow: 205375, distance: 42.1, band: 0 },
      { fromId: "DAL", toId: "C2", flow: 150000, distance: 812.4, band: 3 },
    ],
    metrics: {
      utilizationByNode: [
        { warehouseId: "ALN", city: "Allentown", utilization: 0.41 },
        { warehouseId: "DAL", city: "Dallas", utilization: 0.6 },
      ],
      bandCoverage: [{ band: 200, percent: 30 }, { band: 400, percent: 45 }],
      weightedAvgDistance: 382.9,
    },
    details: {},
    solverUsed: "CBC",
    infeasibilityReason: null,
    ...overrides,
  };
}

describe("buildAssignmentRows", () => {
  it("returns one row per edge, mapping fromId/toId to warehouseId/customerId", () => {
    const rows = buildAssignmentRows(makeResult());
    expect(rows).toEqual([
      { templateVersion: TEMPLATE_VERSION, customerId: "C1", warehouseId: "ALN", distanceMi: 42.1, band: 0, flow: 205375 },
      { templateVersion: TEMPLATE_VERSION, customerId: "C2", warehouseId: "DAL", distanceMi: 812.4, band: 3, flow: 150000 },
    ]);
  });

  it("uses null for band when the edge has no band", () => {
    const result = makeResult({ edges: [{ fromId: "ALN", toId: "C1", flow: 1, distance: 5 }] });
    expect(buildAssignmentRows(result)[0].band).toBeNull();
  });
});

describe("assignmentRowsToCsv", () => {
  it("emits the template_version,customer_id,warehouse_id,distance_mi,band,flow header and one line per row", () => {
    const csv = assignmentRowsToCsv(buildAssignmentRows(makeResult()));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,customer_id,warehouse_id,distance_mi,band,flow");
    expect(lines[1]).toBe(`${TEMPLATE_VERSION},C1,ALN,42.1,0,205375`);
  });
});

describe("buildOpenWarehouseRows", () => {
  it("returns one row per distinct fromId with total flow and utilization joined by warehouseId", () => {
    const rows = buildOpenWarehouseRows(makeResult());
    expect(rows).toEqual([
      { templateVersion: TEMPLATE_VERSION, warehouseId: "ALN", city: "Allentown", totalFlow: 205375, utilization: 0.41 },
      { templateVersion: TEMPLATE_VERSION, warehouseId: "DAL", city: "Dallas", totalFlow: 150000, utilization: 0.6 },
    ]);
  });

  it("sums flow across multiple edges from the same warehouse", () => {
    const result = makeResult({
      edges: [
        { fromId: "ALN", toId: "C1", flow: 100, distance: 1 },
        { fromId: "ALN", toId: "C2", flow: 50, distance: 2 },
      ],
      metrics: { utilizationByNode: [{ warehouseId: "ALN", city: "Allentown", utilization: 0.3 }] },
    });
    expect(buildOpenWarehouseRows(result)).toEqual([
      { templateVersion: TEMPLATE_VERSION, warehouseId: "ALN", city: "Allentown", totalFlow: 150, utilization: 0.3 },
    ]);
  });

  it("skips mine_to_refinery edges (not a facility-open edge for this model shape)", () => {
    const result = makeResult({
      edges: [{ fromId: "kalgoorlie", toId: "daggar-hills", flow: 100, distance: 293.66, leg: "mine_to_refinery" }],
      metrics: {},
    });
    expect(buildOpenWarehouseRows(result)).toEqual([]);
  });

  it("defaults city to empty string and utilization to null when no matching utilizationByNode entry exists", () => {
    const result = makeResult({
      edges: [{ fromId: "BAL", toId: "C1", flow: 10, distance: 5 }],
      metrics: {},
    });
    expect(buildOpenWarehouseRows(result)).toEqual([
      { templateVersion: TEMPLATE_VERSION, warehouseId: "BAL", city: "", totalFlow: 10, utilization: null },
    ]);
  });
});

describe("openWarehouseRowsToCsv", () => {
  it("emits the template_version,warehouse_id,city,total_flow,utilization header", () => {
    const csv = openWarehouseRowsToCsv(buildOpenWarehouseRows(makeResult()));
    expect(csv.trim().split("\n")[0]).toBe("template_version,warehouse_id,city,total_flow,utilization");
  });
});

describe("buildCostSummaryRows", () => {
  it("returns exactly one row with the result's objective/weightedAvgDistance/runTimeSec/quality/solverUsed", () => {
    expect(buildCostSummaryRows(makeResult())).toEqual([{
      templateVersion: TEMPLATE_VERSION,
      objective: 29873735731,
      weightedAvgDistance: 382.9,
      runTimeSec: 0.45,
      quality: "Proven optimal",
      solverUsed: "CBC",
    }]);
  });

  it("uses null for weightedAvgDistance when metrics doesn't have it", () => {
    const result = makeResult({ metrics: {} });
    expect(buildCostSummaryRows(result)[0].weightedAvgDistance).toBeNull();
  });
});

describe("costSummaryRowsToCsv", () => {
  it("emits exactly one data line (plus header)", () => {
    const lines = costSummaryRowsToCsv(buildCostSummaryRows(makeResult())).trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe("template_version,objective,weighted_avg_distance,run_time_sec,quality,solver_used");
  });
});

describe("buildServiceStatsRows", () => {
  it("returns one row per bandCoverage entry", () => {
    expect(buildServiceStatsRows(makeResult())).toEqual([
      { templateVersion: TEMPLATE_VERSION, band: 200, percent: 30 },
      { templateVersion: TEMPLATE_VERSION, band: 400, percent: 45 },
    ]);
  });

  it("returns an empty array when metrics has no bandCoverage", () => {
    expect(buildServiceStatsRows(makeResult({ metrics: {} }))).toEqual([]);
  });
});

describe("serviceStatsRowsToCsv", () => {
  it("emits the template_version,band,percent header", () => {
    const csv = serviceStatsRowsToCsv(buildServiceStatsRows(makeResult()));
    expect(csv.trim().split("\n")[0]).toBe("template_version,band,percent");
  });
});

describe("buildFlowRows", () => {
  it("includes edges with no leg (transport-coal shape)", () => {
    const result = makeResult({ edges: [{ fromId: "KY", toId: "CHI", flow: 500, distance: 300 }] });
    expect(buildFlowRows(result)).toEqual([
      { templateVersion: TEMPLATE_VERSION, fromId: "KY", toId: "CHI", distanceMi: 300, band: null, flow: 500 },
    ]);
  });

  it("includes mine_to_refinery edges but excludes refinery_to_customer edges (two-echelon shape)", () => {
    const result = makeResult({
      edges: [
        { fromId: "kalgoorlie", toId: "daggar-hills", flow: 100, distance: 293.66, leg: "mine_to_refinery" },
        { fromId: "daggar-hills", toId: "sydney", flow: 80, distance: 2381.79, leg: "refinery_to_customer" },
      ],
    });
    const rows = buildFlowRows(result);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromId: "kalgoorlie", toId: "daggar-hills" });
  });
});

describe("flowRowsToCsv", () => {
  it("emits the template_version,from_id,to_id,distance_mi,band,flow header", () => {
    const csv = flowRowsToCsv(buildFlowRows(makeResult()));
    expect(csv.trim().split("\n")[0]).toBe("template_version,from_id,to_id,distance_mi,band,flow");
  });
});
