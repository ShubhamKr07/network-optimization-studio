import { describe, expect, it } from "vitest";
import { buildEntityIdentityById } from "@/lib/entityIdentity";
import type { Dataset } from "@workspace/api-client-react";

// A dataset exercising every base entity family this helper unions:
// - a plain warehouse
// - a mine (a `kind:"mine"` warehouse row, two-echelon-gold-au)
// - a refinery (a `kind:"facility"` warehouse row, two-echelon-gold-au)
// - a plain customer
// - a station (a customer-role row, transport-coal) — same array as
//   customers at the Dataset level, included for documentation.
// - a plant (Chapter 9 JADE, its own top-level array)
const dataset: Dataset = {
  warehouses: [
    { id: "wh-1", city: "Dallas", state: "TX", lat: 32.7, lng: -96.8 },
    { id: "mine-1", city: "Kalgoorlie", state: "", lat: -30.7, lng: 121.4, kind: "mine" },
    { id: "ref-1", city: "Cunnamulla", state: "QLD", lat: -28.1, lng: 145.7, kind: "facility" },
  ],
  customers: [
    { id: "cs-1", city: "Houston", state: "TX", lat: 29.7, lng: -95.4, demand: 10 },
    { id: "st-1", city: "Erie", state: "PA", lat: 42.1, lng: -80.1, demand: 5 },
  ],
  plants: [{ id: "pl-1", city: "Cleveland", state: "OH", lat: 41.5, lng: -81.7 }],
};

const inputs: Record<string, unknown> = {
  addedWarehouses: [{ id: "aw-1", city: "Reno", state: "NV", displayCode: "WH-27" }],
  addedCustomers: [{ id: "ac-1", city: "Boise", state: "ID", displayCode: "CS-99" }],
  addedMines: [{ id: "am-1", city: "Broken Hill", state: "", displayCode: "M-2" }],
  addedStations: [{ id: "as-1", city: "Toledo", state: "OH", displayCode: "ST-1" }],
  addedRefineries: [{ id: "ar-1", city: "Mount Isa", state: "QLD", displayCode: "R-2" }],
  addedPlants: [{ id: "ap-1", city: "Akron", state: "OH", displayCode: "P-2" }],
};

describe("buildEntityIdentityById", () => {
  it("includes every base entity family with displayId === canonical id", () => {
    const map = buildEntityIdentityById("p-median-us", dataset, {});
    expect(map["wh-1"]).toEqual({ city: "Dallas", state: "TX", displayId: "wh-1" });
    expect(map["mine-1"]).toEqual({ city: "Kalgoorlie", state: "", displayId: "mine-1" });
    expect(map["ref-1"]).toEqual({ city: "Cunnamulla", state: "QLD", displayId: "ref-1" });
    expect(map["cs-1"]).toEqual({ city: "Houston", state: "TX", displayId: "cs-1" });
    expect(map["st-1"]).toEqual({ city: "Erie", state: "PA", displayId: "st-1" });
    expect(map["pl-1"]).toEqual({ city: "Cleveland", state: "OH", displayId: "pl-1" });
  });

  it("includes every added entity family with displayId === displayCode", () => {
    const map = buildEntityIdentityById("p-median-us", dataset, inputs);
    expect(map["aw-1"]).toEqual({ city: "Reno", state: "NV", displayId: "WH-27" });
    expect(map["ac-1"]).toEqual({ city: "Boise", state: "ID", displayId: "CS-99" });
    expect(map["am-1"]).toEqual({ city: "Broken Hill", state: "", displayId: "M-2" });
    expect(map["as-1"]).toEqual({ city: "Toledo", state: "OH", displayId: "ST-1" });
    expect(map["ar-1"]).toEqual({ city: "Mount Isa", state: "QLD", displayId: "R-2" });
    expect(map["ap-1"]).toEqual({ city: "Akron", state: "OH", displayId: "P-2" });
  });

  it("falls back to canonical id as displayId when an added row has no displayCode", () => {
    const map = buildEntityIdentityById("p-median-us", dataset, {
      addedWarehouses: [{ id: "aw-legacy", city: "Toledo", state: "OH" }],
    });
    expect(map["aw-legacy"]).toEqual({ city: "Toledo", state: "OH", displayId: "aw-legacy" });
  });

  it("preserves a missing/empty state (no crash, empty string carried through)", () => {
    const map = buildEntityIdentityById("two-echelon-gold-au", dataset, {});
    expect(map["mine-1"].state).toBe("");
  });

  it("base wins on canonical-id collision with an added row", () => {
    // An added-warehouse array that (incorrectly, or via a stale import)
    // carries the SAME canonical id as a real base warehouse, with a
    // different location/display code.
    const collidingInputs: Record<string, unknown> = {
      addedWarehouses: [{ id: "wh-1", city: "Nowhere", state: "ZZ", displayCode: "FAKE-1" }],
    };
    const map = buildEntityIdentityById("p-median-us", dataset, collidingInputs);
    expect(map["wh-1"]).toEqual({ city: "Dallas", state: "TX", displayId: "wh-1" });
  });

  it("returns an empty map for empty/undefined dataset and inputs without throwing", () => {
    expect(buildEntityIdentityById("p-median-us", undefined, undefined)).toEqual({});
    expect(buildEntityIdentityById("p-median-us", { warehouses: [], customers: [] }, null)).toEqual({});
  });

  it("ignores non-array/malformed added-entity fields defensively", () => {
    const map = buildEntityIdentityById("p-median-us", dataset, { addedWarehouses: "not-an-array" });
    expect(map["wh-1"]).toBeDefined();
    expect(Object.keys(map)).not.toContain("not-an-array");
  });
});
