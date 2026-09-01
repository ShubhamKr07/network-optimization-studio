import { describe, it, expect } from "vitest";
import { haversineMiles, fillEstimatedDistances } from "../services/autoDistance.js";
import { pMedianInputsSchema, type PMedianInputs } from "../validation/inputs/pMedian.js";

// T1 (Input Map v2) — a tiny, self-contained coord dataset (2 base
// warehouses, 2 base customers) passed explicitly as the second arg, so
// these tests never depend on the real p-median-us base dataset's shape or
// size (200 customers would make "every row got an estimate" assertions
// unwieldy).
const DATASET = {
  warehouses: [
    { id: "BW1", lat: 32.7813, lng: -96.797 }, // Dallas, TX
    { id: "BW2", lat: 39.7392, lng: -104.9903 }, // Denver, CO
  ],
  customers: [
    { id: "BC1", lat: 36.154, lng: -95.9928 }, // Tulsa, OK
    { id: "BC2", lat: 41.8781, lng: -87.6298 }, // Chicago, IL
  ],
};

const BASE_INPUTS = {
  p: 2,
  capacityMode: "none" as const,
  distanceBands: [100, 300, 600],
  gap: 0.01,
  timeLimitSec: 60,
  warehouseOverrides: [] as { id: string; status: string; capacity?: number | null }[],
  customerOverrides: [] as { id: string; status: string; demand?: number | null }[],
  addedWarehouses: [] as PMedianInputs["addedWarehouses"],
  addedCustomers: [] as PMedianInputs["addedCustomers"],
  distanceOverrides: [] as PMedianInputs["distanceOverrides"],
};

function overrideKey(o: { fromId: string; toId: string }): string {
  return o.fromId + "|" + o.toId;
}

describe("haversineMiles", () => {
  it("Dallas -> Tulsa is approximately 237.5 mi", () => {
    const d = haversineMiles({ lat: 32.7813, lng: -96.797 }, { lat: 36.154, lng: -95.9928 });
    expect(d).toBeGreaterThan(237.5 - 3);
    expect(d).toBeLessThan(237.5 + 3);
  });
});

describe("fillEstimatedDistances", () => {
  it("an added warehouse with no overrides gets estimated rows to every active base+added customer", () => {
    const inputs = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
      addedCustomers: [{ id: "AC1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 500 }],
    };
    const result = fillEstimatedDistances(inputs as PMedianInputs, DATASET);
    const fromAW1 = result.distanceOverrides.filter((o) => o.fromId === "AW1");
    expect(fromAW1.map((o) => o.toId).sort()).toEqual(["AC1", "BC1", "BC2"]);
    expect(fromAW1.every((o) => o.estimated === true)).toBe(true);
    expect(fromAW1.every((o) => o.distance > 0)).toBe(true);
  });

  it("a base warehouse gets estimated rows to every ADDED customer only, never base<->base", () => {
    const inputs = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
      addedCustomers: [{ id: "AC1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 500 }],
    };
    const result = fillEstimatedDistances(inputs as PMedianInputs, DATASET);
    const fromBW1 = result.distanceOverrides.filter((o) => o.fromId === "BW1");
    const fromBW2 = result.distanceOverrides.filter((o) => o.fromId === "BW2");
    expect(fromBW1.map((o) => o.toId)).toEqual(["AC1"]);
    expect(fromBW2.map((o) => o.toId)).toEqual(["AC1"]);
    expect(fromBW1[0].estimated).toBe(true);
    expect(fromBW2[0].estimated).toBe(true);
  });

  it("a manual row (no estimated flag) is left untouched", () => {
    const inputs = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
      distanceOverrides: [{ fromId: "AW1", toId: "BC1", distance: 999 }],
    };
    const result = fillEstimatedDistances(inputs as PMedianInputs, DATASET);
    const row = result.distanceOverrides.find((o) => o.fromId === "AW1" && o.toId === "BC1");
    expect(row).toEqual({ fromId: "AW1", toId: "BC1", distance: 999 });
  });

  it("running fillEstimatedDistances twice is a no-op (idempotent)", () => {
    const inputs = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
      addedCustomers: [{ id: "AC1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 500 }],
    };
    const once = fillEstimatedDistances(inputs as PMedianInputs, DATASET);
    const twice = fillEstimatedDistances(once, DATASET);
    expect(twice.distanceOverrides).toEqual(once.distanceOverrides);
    // No duplicate (fromId,toId) pairs were introduced by the second pass.
    const keys = twice.distanceOverrides.map(overrideKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a customer whose id equals a warehouse id does not pull the warehouse's coordinate (separate maps)", () => {
    const inputs = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
      // Deliberately colliding id with base warehouse BW1, at a different
      // location — proves the customer-role lookup never falls through to
      // the warehouse-role map for the same id string.
      addedCustomers: [{ id: "BW1", city: "Elsewhere", state: "ZZ", lat: 10, lng: 10, demand: 100 }],
    };
    const result = fillEstimatedDistances(inputs as PMedianInputs, DATASET);
    const row = result.distanceOverrides.find((o) => o.fromId === "AW1" && o.toId === "BW1");
    expect(row).toBeDefined();
    const expectedDistance = Math.max(0.1, Math.round(haversineMiles({ lat: 39.53, lng: -119.81 }, { lat: 10, lng: 10 }) * 10) / 10);
    expect(row!.distance).toBeCloseTo(expectedDistance, 1);
    // Sanity: this must NOT equal the distance to the base warehouse BW1's
    // own coordinate (32.7813, -96.797) — a wrong (warehouse-role) lookup
    // would have produced that value instead.
    const wrongDistance = Math.round(haversineMiles({ lat: 39.53, lng: -119.81 }, { lat: 32.7813, lng: -96.797 }) * 10) / 10;
    expect(row!.distance).not.toBeCloseTo(wrongDistance, 1);
  });

  it("two coincident points clamp to MIN_DISTANCE_MI (0.1), never 0, and the result still validates", () => {
    const inputs = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Same", state: "ZZ", lat: 36.154, lng: -95.9928, status: "active" as const }],
    };
    const result = fillEstimatedDistances(inputs as PMedianInputs, DATASET);
    const row = result.distanceOverrides.find((o) => o.fromId === "AW1" && o.toId === "BC1");
    expect(row!.distance).toBe(0.1);
    expect(() => pMedianInputsSchema.parse(result)).not.toThrow();
  });

  it("an inactive added warehouse contributes no rows", () => {
    const inputs = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "inactive" as const }],
      addedCustomers: [{ id: "AC1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 500 }],
    };
    const result = fillEstimatedDistances(inputs as PMedianInputs, DATASET);
    expect(result.distanceOverrides.some((o) => o.fromId === "AW1" || o.toId === "AW1")).toBe(false);
  });

  it("an excluded base customer is not a fill target", () => {
    const inputs = {
      ...BASE_INPUTS,
      customerOverrides: [{ id: "BC1", status: "excluded" }],
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
    };
    const result = fillEstimatedDistances(inputs as PMedianInputs, DATASET);
    const fromAW1 = result.distanceOverrides.filter((o) => o.fromId === "AW1");
    expect(fromAW1.map((o) => o.toId)).toEqual(["BC2"]);
  });
});
