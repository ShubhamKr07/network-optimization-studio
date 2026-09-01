import { describe, it, expect } from "vitest";
import {
  haversineMiles,
  fillEstimatedDistances,
  fillEstimatedBrazilDistances,
  fillEstimatedLaneCosts,
  fillEstimatedTwoEchelonDistances,
} from "../services/autoDistance.js";
import { pMedianInputsSchema, type PMedianInputs } from "../validation/inputs/pMedian.js";
import { transportLpInputsSchema, type TransportLpInputs } from "../validation/inputs/transportLp.js";
import { twoEchelonInputsSchema, type TwoEchelonInputs } from "../validation/inputs/twoEchelon.js";

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

// ── B2-T2 (Bundle 2) — p-median-brazil (shares pMedianInputsSchema and
// fillEstimatedDistances' own structure, injected with BRAZIL_CIRCUITY) ────
// BRAZIL_CIRCUITY reuses the same 1.17 value as TRANSPORT_CIRCUITY below
// (see autoDistance.ts's BRAZIL_CIRCUITY comment for the derivation/
// coincidence rationale) — same fixture shape as DATASET/BASE_INPUTS above,
// since fillEstimatedBrazilDistances is a thin wrapper, not a reimplementation.
const BRAZIL_CIRCUITY = 1.17;

describe("fillEstimatedBrazilDistances (p-median-brazil)", () => {
  it("an added warehouse with no overrides gets estimated rows to every active base+added customer, at haversine * BRAZIL_CIRCUITY", () => {
    const inputs = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
      addedCustomers: [{ id: "AC1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 500 }],
    };
    const result = fillEstimatedBrazilDistances(inputs as PMedianInputs, DATASET);
    const fromAW1 = result.distanceOverrides.filter((o) => o.fromId === "AW1");
    expect(fromAW1.map((o) => o.toId).sort()).toEqual(["AC1", "BC1", "BC2"]);
    expect(fromAW1.every((o) => o.estimated === true)).toBe(true);
    // Circuity applied — NOT plain haversine, unlike p-median-us's own
    // fillEstimatedDistances (which passes no circuity multiplier).
    const toBC1 = fromAW1.find((o) => o.toId === "BC1")!;
    const rawMi = haversineMiles({ lat: 39.53, lng: -119.81 }, { lat: 36.154, lng: -95.9928 });
    expect(toBC1.distance).toBeCloseTo(Math.round(rawMi * BRAZIL_CIRCUITY * 10) / 10, 1);
    expect(toBC1.distance).not.toBeCloseTo(Math.round(rawMi * 10) / 10, 1);
  });

  it("a base warehouse gets estimated rows to every ADDED customer only, never base<->base", () => {
    const inputs = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
      addedCustomers: [{ id: "AC1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 500 }],
    };
    const result = fillEstimatedBrazilDistances(inputs as PMedianInputs, DATASET);
    const fromBW1 = result.distanceOverrides.filter((o) => o.fromId === "BW1");
    const fromBW2 = result.distanceOverrides.filter((o) => o.fromId === "BW2");
    expect(fromBW1.map((o) => o.toId)).toEqual(["AC1"]);
    expect(fromBW2.map((o) => o.toId)).toEqual(["AC1"]);
  });

  it("a manual row with estimated:false is left untouched", () => {
    const inputs = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
      distanceOverrides: [{ fromId: "AW1", toId: "BC1", distance: 999, estimated: false as const }],
    };
    const result = fillEstimatedBrazilDistances(inputs as PMedianInputs, DATASET);
    const row = result.distanceOverrides.find((o) => o.fromId === "AW1" && o.toId === "BC1");
    expect(row).toEqual({ fromId: "AW1", toId: "BC1", distance: 999, estimated: false });
  });

  it("running fillEstimatedBrazilDistances twice is a no-op (idempotent)", () => {
    const inputs = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
      addedCustomers: [{ id: "AC1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 500 }],
    };
    const once = fillEstimatedBrazilDistances(inputs as PMedianInputs, DATASET);
    const twice = fillEstimatedBrazilDistances(once, DATASET);
    expect(twice.distanceOverrides).toEqual(once.distanceOverrides);
    const keys = twice.distanceOverrides.map(overrideKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ── follow-up item 3 — transport-coal (haversine * circuity) ───────────────
const TRANSPORT_CIRCUITY = 1.17;

const TRANSPORT_DATASET = {
  mines: [
    { id: "BM1", lat: 32.7813, lng: -96.797 }, // Dallas, TX
    { id: "BM2", lat: 39.7392, lng: -104.9903 }, // Denver, CO
  ],
  stations: [
    { id: "BS1", lat: 36.154, lng: -95.9928 }, // Tulsa, OK
    { id: "BS2", lat: 41.8781, lng: -87.6298 }, // Chicago, IL
  ],
};

const TRANSPORT_BASE_INPUTS = {
  distanceBands: [500, 1000, 1500, 2000],
  gap: 0,
  timeLimitSec: 120,
  capacityFactor: 1.0,
  singleSource: false,
  capacityInactive: false,
  mineCapacities: {} as Record<string, number>,
  stationDemands: {} as Record<string, number>,
  addedMines: [] as TransportLpInputs["addedMines"],
  addedStations: [] as TransportLpInputs["addedStations"],
  laneCostOverrides: [] as TransportLpInputs["laneCostOverrides"],
};

function laneKey(o: { fromId: string; toId: string }): string {
  return o.fromId + "|" + o.toId;
}

describe("fillEstimatedLaneCosts (transport-coal)", () => {
  it("an added mine with no overrides gets estimated lane costs to every base+added station, at haversine * circuity", () => {
    const inputs = {
      ...TRANSPORT_BASE_INPUTS,
      addedMines: [{ id: "AM1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81 }],
    };
    const result = fillEstimatedLaneCosts(inputs as TransportLpInputs, TRANSPORT_DATASET);
    const fromAM1 = result.laneCostOverrides.filter((o) => o.fromId === "AM1");
    expect(fromAM1.map((o) => o.toId).sort()).toEqual(["BS1", "BS2"]);
    expect(fromAM1.every((o) => o.estimated === true)).toBe(true);
    // Hand-checked: AM1 (Reno, NV) -> BS1 (Tulsa, OK) haversine ~ 1231 mi;
    // the stored value must be that raw distance times the 1.17 circuity
    // factor, not the plain haversine value.
    const toBS1 = fromAM1.find((o) => o.toId === "BS1")!;
    const rawMi = haversineMiles({ lat: 39.53, lng: -119.81 }, { lat: 36.154, lng: -95.9928 });
    expect(toBS1.cost).toBeCloseTo(Math.round(rawMi * TRANSPORT_CIRCUITY * 10) / 10, 1);
    expect(toBS1.cost).not.toBeCloseTo(Math.round(rawMi * 10) / 10, 1);
  });

  it("a base mine gets estimated lane costs to every ADDED station only, never base<->base", () => {
    const inputs = {
      ...TRANSPORT_BASE_INPUTS,
      addedMines: [{ id: "AM1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81 }],
      addedStations: [{ id: "AS1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 500 }],
    };
    const result = fillEstimatedLaneCosts(inputs as TransportLpInputs, TRANSPORT_DATASET);
    const fromBM1 = result.laneCostOverrides.filter((o) => o.fromId === "BM1");
    const fromBM2 = result.laneCostOverrides.filter((o) => o.fromId === "BM2");
    expect(fromBM1.map((o) => o.toId)).toEqual(["AS1"]);
    expect(fromBM2.map((o) => o.toId)).toEqual(["AS1"]);
    expect(fromBM1[0].estimated).toBe(true);
  });

  it("a mine id colliding with a station id resolves against its own role's map (no cross-role coord bleed)", () => {
    const inputs = {
      ...TRANSPORT_BASE_INPUTS,
      addedMines: [{ id: "AM1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81 }],
      addedStations: [{ id: "BM1", city: "Elsewhere", state: "ZZ", lat: 10, lng: 10, demand: 100 }],
    };
    const result = fillEstimatedLaneCosts(inputs as TransportLpInputs, TRANSPORT_DATASET);
    const row = result.laneCostOverrides.find((o) => o.fromId === "AM1" && o.toId === "BM1");
    expect(row).toBeDefined();
    const expectedCost = Math.max(0.1, Math.round(haversineMiles({ lat: 39.53, lng: -119.81 }, { lat: 10, lng: 10 }) * TRANSPORT_CIRCUITY * 10) / 10);
    expect(row!.cost).toBeCloseTo(expectedCost, 1);
  });

  it("two coincident points clamp to MIN_DISTANCE (0.1), never 0, and the result still validates", () => {
    const inputs = {
      ...TRANSPORT_BASE_INPUTS,
      addedMines: [{ id: "AM1", city: "Same", state: "ZZ", lat: 36.154, lng: -95.9928 }],
    };
    const result = fillEstimatedLaneCosts(inputs as TransportLpInputs, TRANSPORT_DATASET);
    const row = result.laneCostOverrides.find((o) => o.fromId === "AM1" && o.toId === "BS1");
    expect(row!.cost).toBe(0.1);
    expect(() => transportLpInputsSchema.parse(result)).not.toThrow();
  });

  it("a manual row (no estimated flag) is left untouched", () => {
    const inputs = {
      ...TRANSPORT_BASE_INPUTS,
      addedMines: [{ id: "AM1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81 }],
      laneCostOverrides: [{ fromId: "AM1", toId: "BS1", cost: 999 }],
    };
    const result = fillEstimatedLaneCosts(inputs as TransportLpInputs, TRANSPORT_DATASET);
    const row = result.laneCostOverrides.find((o) => o.fromId === "AM1" && o.toId === "BS1");
    expect(row).toEqual({ fromId: "AM1", toId: "BS1", cost: 999 });
  });

  it("running fillEstimatedLaneCosts twice is a no-op (idempotent)", () => {
    const inputs = {
      ...TRANSPORT_BASE_INPUTS,
      addedMines: [{ id: "AM1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81 }],
      addedStations: [{ id: "AS1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 500 }],
    };
    const once = fillEstimatedLaneCosts(inputs as TransportLpInputs, TRANSPORT_DATASET);
    const twice = fillEstimatedLaneCosts(once, TRANSPORT_DATASET);
    expect(twice.laneCostOverrides).toEqual(once.laneCostOverrides);
    const keys = twice.laneCostOverrides.map(laneKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ── follow-up item 3 — two-echelon-gold-au (plain haversine, both legs) ────
const GOLD_TEST_DATASET = {
  mines: [{ id: "GM1", lat: -30.7495, lng: 121.4667 }], // Kalgoorlie, WA (fixed, single mine)
  refineries: [
    { id: "BR1", lat: -28.15, lng: 117.6 }, // Daggar Hills, WA
    { id: "BR2", lat: -28.0716, lng: 145.6695 }, // Cunnamulla, QLD
  ],
  customers: [
    { id: "BC1", lat: -33.8688, lng: 151.2093 }, // Sydney, NSW
    { id: "BC2", lat: -37.8136, lng: 144.9631 }, // Melbourne, VIC
  ],
};

const GOLD_BASE_INPUTS = {
  bomRatio: 1.1,
  refineryOverrides: [] as { id: string; status: "active" | "forced_open" | "inactive" }[],
  customerOverrides: [] as { id: string; status: "active" | "excluded"; demand?: number | null }[],
  distanceBands: [500, 1000, 1500, 2000, 2600],
  gap: 0,
  timeLimitSec: 120,
  addedRefineries: [] as TwoEchelonInputs["addedRefineries"],
  addedCustomers: [] as TwoEchelonInputs["addedCustomers"],
  distanceOverrides: [] as TwoEchelonInputs["distanceOverrides"],
};

function distKey(o: { fromId: string; toId: string }): string {
  return o.fromId + "|" + o.toId;
}

// B2-T2 (Bundle 2) — reverse-derived circuity for the refinery->customer
// leg only (see autoDistance.ts's TWO_ECHELON_RC_CIRCUITY comment for the
// derivation); the mine->refinery leg has no such factor.
const TWO_ECHELON_RC_CIRCUITY = 1.1791;

describe("fillEstimatedTwoEchelonDistances (two-echelon-gold-au)", () => {
  it("an added refinery with no overrides gets BOTH legs estimated: mine->refinery at plain haversine, refinery->every base+added customer at haversine * circuity", () => {
    const inputs = {
      ...GOLD_BASE_INPUTS,
      addedRefineries: [{ id: "AR1", city: "Perth", state: "WA", lat: -31.9505, lng: 115.8605, status: "active" as const }],
    };
    const result = fillEstimatedTwoEchelonDistances(inputs as TwoEchelonInputs, GOLD_TEST_DATASET);
    const fromMine = result.distanceOverrides.filter((o) => o.fromId === "GM1" && o.toId === "AR1");
    expect(fromMine.length).toBe(1);
    expect(fromMine[0].estimated).toBe(true);
    // mine->refinery leg: plain haversine, no circuity.
    const rawMineMi = haversineMiles({ lat: -30.7495, lng: 121.4667 }, { lat: -31.9505, lng: 115.8605 });
    expect(fromMine[0].distance).toBeCloseTo(Math.round(rawMineMi * 10) / 10, 1);

    const fromAR1 = result.distanceOverrides.filter((o) => o.fromId === "AR1");
    expect(fromAR1.map((o) => o.toId).sort()).toEqual(["BC1", "BC2"]);
    expect(fromAR1.every((o) => o.estimated === true)).toBe(true);
    // refinery->customer leg: haversine * TWO_ECHELON_RC_CIRCUITY, NOT plain
    // haversine — this is the B2-T2 fix (the prior estimator wrote plain
    // haversine for both legs, understating this leg by ~15-18%).
    const toBC1 = fromAR1.find((o) => o.toId === "BC1")!;
    const rawMi = haversineMiles({ lat: -31.9505, lng: 115.8605 }, { lat: -33.8688, lng: 151.2093 });
    const expectedMi = Math.round(rawMi * TWO_ECHELON_RC_CIRCUITY * 10) / 10;
    expect(toBC1.distance).toBeCloseTo(expectedMi, 1);
    // Reconstructs a KNOWN base refinery->customer pair (BR1 Daggar Hills ->
    // BC1 Sydney, 2381.786038127133 mi in the real dataset) within <0.1%
    // tolerance — proves the locked circuity constant, not just internal
    // self-consistency against haversineMiles.
    const knownRawMi = haversineMiles({ lat: -28.15, lng: 117.6 }, { lat: -33.8688, lng: 151.2093 });
    const reconstructed = knownRawMi * TWO_ECHELON_RC_CIRCUITY;
    const knownStoredMi = 2381.786038127133;
    expect(Math.abs(reconstructed - knownStoredMi) / knownStoredMi).toBeLessThan(0.001);
  });

  it("a base refinery gets a refinery->customer leg to every ADDED customer only, never base<->base, and no mine leg (already covered)", () => {
    const inputs = {
      ...GOLD_BASE_INPUTS,
      addedCustomers: [{ id: "AC1", city: "Perth", state: "WA", lat: -31.9505, lng: 115.8605, demand: 500 }],
    };
    const result = fillEstimatedTwoEchelonDistances(inputs as TwoEchelonInputs, GOLD_TEST_DATASET);
    const fromBR1 = result.distanceOverrides.filter((o) => o.fromId === "BR1");
    const fromBR2 = result.distanceOverrides.filter((o) => o.fromId === "BR2");
    expect(fromBR1.map((o) => o.toId)).toEqual(["AC1"]);
    expect(fromBR2.map((o) => o.toId)).toEqual(["AC1"]);
    expect(result.distanceOverrides.some((o) => o.toId === "BR1" || o.toId === "BR2")).toBe(false);
  });

  it("a refinery id colliding with a customer id resolves against its own role's map (no cross-role coord bleed)", () => {
    const inputs = {
      ...GOLD_BASE_INPUTS,
      addedRefineries: [{ id: "AR1", city: "Perth", state: "WA", lat: -31.9505, lng: 115.8605, status: "active" as const }],
      addedCustomers: [{ id: "BR1", city: "Elsewhere", state: "ZZ", lat: 10, lng: 10, demand: 100 }],
    };
    const result = fillEstimatedTwoEchelonDistances(inputs as TwoEchelonInputs, GOLD_TEST_DATASET);
    const row = result.distanceOverrides.find((o) => o.fromId === "AR1" && o.toId === "BR1");
    expect(row).toBeDefined();
    // AR1->BR1 is a refinery->customer leg (BR1 here is the colliding
    // ADDED customer id, not the base refinery), so it carries circuity.
    const expectedDistance = Math.max(
      0.1,
      Math.round(haversineMiles({ lat: -31.9505, lng: 115.8605 }, { lat: 10, lng: 10 }) * TWO_ECHELON_RC_CIRCUITY * 10) / 10,
    );
    expect(row!.distance).toBeCloseTo(expectedDistance, 1);
  });

  it("an inactive added refinery contributes no rows", () => {
    const inputs = {
      ...GOLD_BASE_INPUTS,
      addedRefineries: [{ id: "AR1", city: "Perth", state: "WA", lat: -31.9505, lng: 115.8605, status: "inactive" as const }],
    };
    const result = fillEstimatedTwoEchelonDistances(inputs as TwoEchelonInputs, GOLD_TEST_DATASET);
    expect(result.distanceOverrides.some((o) => o.fromId === "AR1" || o.toId === "AR1")).toBe(false);
  });

  it("an excluded base customer is not a fill target", () => {
    const inputs = {
      ...GOLD_BASE_INPUTS,
      customerOverrides: [{ id: "BC1", status: "excluded" as const }],
      addedRefineries: [{ id: "AR1", city: "Perth", state: "WA", lat: -31.9505, lng: 115.8605, status: "active" as const }],
    };
    const result = fillEstimatedTwoEchelonDistances(inputs as TwoEchelonInputs, GOLD_TEST_DATASET);
    const fromAR1 = result.distanceOverrides.filter((o) => o.fromId === "AR1");
    expect(fromAR1.map((o) => o.toId)).toEqual(["BC2"]);
  });

  it("two coincident points clamp to MIN_DISTANCE (0.1), never 0, and the result still validates", () => {
    const inputs = {
      ...GOLD_BASE_INPUTS,
      addedRefineries: [{ id: "AR1", city: "Same", state: "ZZ", lat: -33.8688, lng: 151.2093, status: "active" as const }],
    };
    const result = fillEstimatedTwoEchelonDistances(inputs as TwoEchelonInputs, GOLD_TEST_DATASET);
    const row = result.distanceOverrides.find((o) => o.fromId === "AR1" && o.toId === "BC1");
    expect(row!.distance).toBe(0.1);
    expect(() => twoEchelonInputsSchema.parse(result)).not.toThrow();
  });

  it("a manual row (no estimated flag) is left untouched", () => {
    const inputs = {
      ...GOLD_BASE_INPUTS,
      addedRefineries: [{ id: "AR1", city: "Perth", state: "WA", lat: -31.9505, lng: 115.8605, status: "active" as const }],
      distanceOverrides: [{ fromId: "GM1", toId: "AR1", distance: 999 }],
    };
    const result = fillEstimatedTwoEchelonDistances(inputs as TwoEchelonInputs, GOLD_TEST_DATASET);
    const row = result.distanceOverrides.find((o) => o.fromId === "GM1" && o.toId === "AR1");
    expect(row).toEqual({ fromId: "GM1", toId: "AR1", distance: 999 });
  });

  it("running fillEstimatedTwoEchelonDistances twice is a no-op (idempotent)", () => {
    const inputs = {
      ...GOLD_BASE_INPUTS,
      addedRefineries: [{ id: "AR1", city: "Perth", state: "WA", lat: -31.9505, lng: 115.8605, status: "active" as const }],
      addedCustomers: [{ id: "AC1", city: "Adelaide", state: "SA", lat: -34.9285, lng: 138.6007, demand: 300 }],
    };
    const once = fillEstimatedTwoEchelonDistances(inputs as TwoEchelonInputs, GOLD_TEST_DATASET);
    const twice = fillEstimatedTwoEchelonDistances(once, GOLD_TEST_DATASET);
    expect(twice.distanceOverrides).toEqual(once.distanceOverrides);
    const keys = twice.distanceOverrides.map(distKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ── B2-T2 Step 5 (P1) — move/re-estimation across persist passes, all 3
// estimators. Proves the real end-to-end contract T4-T7's frontend move-
// mutator relies on: when a student drags an added entity to a new spot,
// the frontend purges that entity's OWN estimated overrides (never touching
// manual ones — that's a frontend-side responsibility, not this file's), the
// entity's own coords are updated in place, and the next
// normalizeAddedEntityDistances pass (a PATCH save) regenerates fresh
// estimates from the new coordinates — the normalizer only ever fills
// genuinely-missing rows, so a naive "just re-run the normalizer" is
// sufficient for the move case as long as the stale rows were purged first.
describe("B2-T2 Step 5 — move/re-estimation + idempotency (Brazil, transport-coal, two-echelon)", () => {
  it("Brazil: purging an added warehouse's overrides and moving it, then re-normalizing, regenerates estimates from the NEW coords", () => {
    const original = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
    };
    const solved = fillEstimatedBrazilDistances(original as PMedianInputs, DATASET);
    const oldRow = solved.distanceOverrides.find((o) => o.fromId === "AW1" && o.toId === "BC1")!;
    expect(oldRow.estimated).toBe(true);

    // Simulate the frontend move-mutator: purge AW1's own overrides, move
    // AW1 to a different location.
    const moved = {
      ...solved,
      addedWarehouses: [{ ...original.addedWarehouses[0], lat: 41.8781, lng: -87.6298 }], // now at BC2's coords
      distanceOverrides: solved.distanceOverrides.filter((o) => o.fromId !== "AW1" && o.toId !== "AW1"),
    };
    const reNormalized = fillEstimatedBrazilDistances(moved as PMedianInputs, DATASET);
    const newRow = reNormalized.distanceOverrides.find((o) => o.fromId === "AW1" && o.toId === "BC1")!;
    expect(newRow).toBeDefined();
    expect(newRow.distance).not.toBeCloseTo(oldRow.distance, 1);
    const expectedNewMi = Math.round(haversineMiles({ lat: 41.8781, lng: -87.6298 }, { lat: 36.154, lng: -95.9928 }) * BRAZIL_CIRCUITY * 10) / 10;
    expect(newRow.distance).toBeCloseTo(expectedNewMi, 1);
  });

  it("Brazil: a second normalization pass after a move is itself idempotent", () => {
    const original = {
      ...BASE_INPUTS,
      addedWarehouses: [{ id: "AW1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const }],
    };
    const solved = fillEstimatedBrazilDistances(original as PMedianInputs, DATASET);
    const moved = {
      ...solved,
      addedWarehouses: [{ ...original.addedWarehouses[0], lat: 41.8781, lng: -87.6298 }],
      distanceOverrides: solved.distanceOverrides.filter((o) => o.fromId !== "AW1" && o.toId !== "AW1"),
    };
    const once = fillEstimatedBrazilDistances(moved as PMedianInputs, DATASET);
    const twice = fillEstimatedBrazilDistances(once, DATASET);
    expect(twice.distanceOverrides).toEqual(once.distanceOverrides);
  });

  it("transport-coal: purging an added mine's lane costs and moving it, then re-normalizing, regenerates costs from the NEW coords", () => {
    const original = {
      ...TRANSPORT_BASE_INPUTS,
      addedMines: [{ id: "AM1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81 }],
    };
    const solved = fillEstimatedLaneCosts(original as TransportLpInputs, TRANSPORT_DATASET);
    const oldRow = solved.laneCostOverrides.find((o) => o.fromId === "AM1" && o.toId === "BS1")!;
    expect(oldRow.estimated).toBe(true);

    const moved = {
      ...solved,
      addedMines: [{ ...original.addedMines[0], lat: 41.8781, lng: -87.6298 }], // now at BS2's coords
      laneCostOverrides: solved.laneCostOverrides.filter((o) => o.fromId !== "AM1" && o.toId !== "AM1"),
    };
    const reNormalized = fillEstimatedLaneCosts(moved as TransportLpInputs, TRANSPORT_DATASET);
    const newRow = reNormalized.laneCostOverrides.find((o) => o.fromId === "AM1" && o.toId === "BS1")!;
    expect(newRow).toBeDefined();
    expect(newRow.cost).not.toBeCloseTo(oldRow.cost, 1);
    const expectedNewMi = Math.round(haversineMiles({ lat: 41.8781, lng: -87.6298 }, { lat: 36.154, lng: -95.9928 }) * TRANSPORT_CIRCUITY * 10) / 10;
    expect(newRow.cost).toBeCloseTo(expectedNewMi, 1);
  });

  it("transport-coal: a second normalization pass after a move is itself idempotent", () => {
    const original = {
      ...TRANSPORT_BASE_INPUTS,
      addedMines: [{ id: "AM1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81 }],
    };
    const solved = fillEstimatedLaneCosts(original as TransportLpInputs, TRANSPORT_DATASET);
    const moved = {
      ...solved,
      addedMines: [{ ...original.addedMines[0], lat: 41.8781, lng: -87.6298 }],
      laneCostOverrides: solved.laneCostOverrides.filter((o) => o.fromId !== "AM1" && o.toId !== "AM1"),
    };
    const once = fillEstimatedLaneCosts(moved as TransportLpInputs, TRANSPORT_DATASET);
    const twice = fillEstimatedLaneCosts(once, TRANSPORT_DATASET);
    expect(twice.laneCostOverrides).toEqual(once.laneCostOverrides);
  });

  it("two-echelon: purging a moved added refinery's BOTH-leg overrides and re-normalizing regenerates both legs from the NEW coords", () => {
    const original = {
      ...GOLD_BASE_INPUTS,
      addedRefineries: [{ id: "AR1", city: "Perth", state: "WA", lat: -31.9505, lng: 115.8605, status: "active" as const }],
    };
    const solved = fillEstimatedTwoEchelonDistances(original as TwoEchelonInputs, GOLD_TEST_DATASET);
    const oldMineLeg = solved.distanceOverrides.find((o) => o.fromId === "GM1" && o.toId === "AR1")!;
    const oldCustLeg = solved.distanceOverrides.find((o) => o.fromId === "AR1" && o.toId === "BC1")!;
    expect(oldMineLeg.estimated).toBe(true);
    expect(oldCustLeg.estimated).toBe(true);

    const moved = {
      ...solved,
      addedRefineries: [{ ...original.addedRefineries[0], lat: -37.8136, lng: 144.9631 }], // now at BC2's (Melbourne) coords
      // Purge BOTH legs — a real move-mutator must clear every row
      // referencing the moved entity's uid on either side.
      distanceOverrides: solved.distanceOverrides.filter((o) => o.fromId !== "AR1" && o.toId !== "AR1"),
    };
    const reNormalized = fillEstimatedTwoEchelonDistances(moved as TwoEchelonInputs, GOLD_TEST_DATASET);
    const newMineLeg = reNormalized.distanceOverrides.find((o) => o.fromId === "GM1" && o.toId === "AR1")!;
    const newCustLeg = reNormalized.distanceOverrides.find((o) => o.fromId === "AR1" && o.toId === "BC1")!;
    expect(newMineLeg).toBeDefined();
    expect(newCustLeg).toBeDefined();
    expect(newMineLeg.distance).not.toBeCloseTo(oldMineLeg.distance, 1);
    expect(newCustLeg.distance).not.toBeCloseTo(oldCustLeg.distance, 1);

    const expectedMineMi = Math.round(haversineMiles({ lat: -30.7495, lng: 121.4667 }, { lat: -37.8136, lng: 144.9631 }) * 10) / 10;
    expect(newMineLeg.distance).toBeCloseTo(expectedMineMi, 1);
    const expectedCustMi = Math.round(haversineMiles({ lat: -37.8136, lng: 144.9631 }, { lat: -33.8688, lng: 151.2093 }) * TWO_ECHELON_RC_CIRCUITY * 10) / 10;
    expect(newCustLeg.distance).toBeCloseTo(expectedCustMi, 1);
  });

  it("two-echelon: a second normalization pass after a move is itself idempotent", () => {
    const original = {
      ...GOLD_BASE_INPUTS,
      addedRefineries: [{ id: "AR1", city: "Perth", state: "WA", lat: -31.9505, lng: 115.8605, status: "active" as const }],
    };
    const solved = fillEstimatedTwoEchelonDistances(original as TwoEchelonInputs, GOLD_TEST_DATASET);
    const moved = {
      ...solved,
      addedRefineries: [{ ...original.addedRefineries[0], lat: -37.8136, lng: 144.9631 }],
      distanceOverrides: solved.distanceOverrides.filter((o) => o.fromId !== "AR1" && o.toId !== "AR1"),
    };
    const once = fillEstimatedTwoEchelonDistances(moved as TwoEchelonInputs, GOLD_TEST_DATASET);
    const twice = fillEstimatedTwoEchelonDistances(once, GOLD_TEST_DATASET);
    expect(twice.distanceOverrides).toEqual(once.distanceOverrides);
  });

  it("a user-supplied estimated:false override on an added entity is NOT overwritten by re-normalization even after other rows are purged", () => {
    const original = {
      ...GOLD_BASE_INPUTS,
      addedRefineries: [{ id: "AR1", city: "Perth", state: "WA", lat: -31.9505, lng: 115.8605, status: "active" as const }],
      // A student manually entered a real refinery->customer distance for
      // BC1 before ever saving — the normalizer must never touch this row,
      // even though every OTHER AR1 row (mine leg, BC2 leg) is still
      // genuinely missing and gets filled.
      distanceOverrides: [{ fromId: "AR1", toId: "BC1", distance: 555, estimated: false as const }],
    };
    const result = fillEstimatedTwoEchelonDistances(original as TwoEchelonInputs, GOLD_TEST_DATASET);
    const manualRow = result.distanceOverrides.find((o) => o.fromId === "AR1" && o.toId === "BC1")!;
    expect(manualRow).toEqual({ fromId: "AR1", toId: "BC1", distance: 555, estimated: false });
    // Every other row for AR1 (mine leg, BC2 leg) still got filled.
    const mineLeg = result.distanceOverrides.find((o) => o.fromId === "GM1" && o.toId === "AR1");
    const bc2Leg = result.distanceOverrides.find((o) => o.fromId === "AR1" && o.toId === "BC2");
    expect(mineLeg?.estimated).toBe(true);
    expect(bc2Leg?.estimated).toBe(true);
  });
});
