import { describe, it, expect } from "vitest";
import {
  TEMPLATE_VERSION,
  applyWarehouseOverrides,
  applyCustomerOverrides,
  applyMineOverrides,
  applyStationOverrides,
  applyRefineryOverrides,
  applyGoldCustomerOverrides,
  applyDistanceOverrides,
  applyLaneCostOverrides,
  buildDistanceStubRows,
  buildLaneCostStubRows,
  warehouseRowsToCsv,
  customerRowsToCsv,
  mineRowsToCsv,
  stationRowsToCsv,
  refineryRowsToCsv,
  distanceRowsToCsv,
  laneCostRowsToCsv,
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
  it("produces a header row plus one line per row, plain columns (no comment line), lat/lng included, no overridden column", () => {
    const rows = applyWarehouseOverrides([{ id: "ALN", status: "forced_open" }]).slice(0, 2);
    const csv = warehouseRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,lat,lng,capacity,status");
    expect(lines[1]).toBe(`${TEMPLATE_VERSION},ALN,Allentown,PA,40.602812,-75.470433,,forced_open`);
    expect(lines.length).toBe(3);
  });

  it("customer CSV includes demand as a numeric column, lat/lng included, no overridden column", () => {
    const rows = applyCustomerOverrides([]).slice(0, 1);
    const csv = customerRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,lat,lng,demand,status");
    expect(lines[1]).toBe(`${TEMPLATE_VERSION},C1,Akron,OH,41.08,-81.52,205375,active`);
  });

  it("escapes a comma in a city name", () => {
    const rows = [{ templateVersion: TEMPLATE_VERSION, id: "X1", city: "Springfield, Ohio", state: "OH", lat: 39.9, lng: -83.8, capacity: null, status: "active" as const, overridden: false }];
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
  it("produces a header row plus one line per row, status column, no value column", () => {
    const rows = applyRefineryOverrides([{ id: "cunnamulla", status: "forced_open" }]);
    const csv = refineryRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,status");
    expect(lines).toContain(`${TEMPLATE_VERSION},cunnamulla,Cunnamulla,QLD,forced_open`);
    expect(lines.length).toBe(3);
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
  it("mine CSV header includes lat/lng, no overridden column", () => {
    const rows = applyMineOverrides([{ id: "KY", capacity: 1000000 }]).slice(0, 1);
    const csv = mineRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,lat,lng,capacity");
    expect(lines[1]).toBe(`${TEMPLATE_VERSION},KY,Pikeville,KY,37.54,-82.75,1000000`);
  });

  it("station CSV header includes lat/lng, no overridden column", () => {
    const rows = applyStationOverrides([]).filter(r => r.id === "CHI");
    const csv = stationRowsToCsv(rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,lat,lng,demand");
    expect(lines[1].startsWith(`${TEMPLATE_VERSION},CHI,`)).toBe(true);
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
