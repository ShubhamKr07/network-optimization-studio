import { describe, it, expect } from "vitest";
import { chensInputsSchema } from "../chens.js";

// A minimal valid coverage-mode base. distanceBands is intentionally omitted
// from most tests — D19's transform derives it from the two thresholds.
const COVERAGE_BASE = {
  objective: "coverage" as const,
  p: 3,
  highServiceDistKm: 600,
  maxDistKm: 5000,
  avgServiceDistCapKm: 1000,
  gap: 0,
  timeLimitSec: 60,
};

const MIN_DISTANCE_BASE = {
  objective: "min_distance" as const,
  p: 3,
  highServiceDistKm: 600,
  maxDistKm: 5000,
  coverageFloorDemand: 131645389,
  gap: 0,
  timeLimitSec: 60,
};

describe("chensInputsSchema — objective discrimination", () => {
  it("accepts coverage mode with avgServiceDistCapKm", () => {
    const r = chensInputsSchema.safeParse(COVERAGE_BASE);
    expect(r.success).toBe(true);
  });

  it("accepts min_distance mode with coverageFloorDemand", () => {
    const r = chensInputsSchema.safeParse(MIN_DISTANCE_BASE);
    expect(r.success).toBe(true);
  });

  it("rejects coverage mode without avgServiceDistCapKm", () => {
    const { avgServiceDistCapKm, ...rest } = COVERAGE_BASE;
    void avgServiceDistCapKm;
    const r = chensInputsSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it("rejects min_distance mode without coverageFloorDemand", () => {
    const { coverageFloorDemand, ...rest } = MIN_DISTANCE_BASE;
    void coverageFloorDemand;
    const r = chensInputsSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });
});

describe("chensInputsSchema — scalar constraints", () => {
  it("accepts p at the boundaries 1 and 25", () => {
    expect(chensInputsSchema.safeParse({ ...COVERAGE_BASE, p: 1 }).success).toBe(true);
    expect(chensInputsSchema.safeParse({ ...COVERAGE_BASE, p: 25 }).success).toBe(true);
  });

  it("rejects p below 1 and above 25", () => {
    expect(chensInputsSchema.safeParse({ ...COVERAGE_BASE, p: 0 }).success).toBe(false);
    expect(chensInputsSchema.safeParse({ ...COVERAGE_BASE, p: 26 }).success).toBe(false);
  });

  it("rejects a non-integer p", () => {
    expect(chensInputsSchema.safeParse({ ...COVERAGE_BASE, p: 3.5 }).success).toBe(false);
  });

  it("rejects highServiceDistKm >= maxDistKm", () => {
    expect(
      chensInputsSchema.safeParse({ ...COVERAGE_BASE, highServiceDistKm: 5000, maxDistKm: 5000 }).success,
    ).toBe(false);
    expect(
      chensInputsSchema.safeParse({ ...COVERAGE_BASE, highServiceDistKm: 6000, maxDistKm: 5000 }).success,
    ).toBe(false);
  });

  it("requires gap and timeLimitSec", () => {
    const { gap, ...noGap } = COVERAGE_BASE;
    void gap;
    expect(chensInputsSchema.safeParse(noGap).success).toBe(false);
    const { timeLimitSec, ...noTime } = COVERAGE_BASE;
    void timeLimitSec;
    expect(chensInputsSchema.safeParse(noTime).success).toBe(false);
  });

  it("rejects a non-integer coverageFloorDemand (D30 integer domain)", () => {
    expect(
      chensInputsSchema.safeParse({ ...MIN_DISTANCE_BASE, coverageFloorDemand: 100.5 }).success,
    ).toBe(false);
  });
});

describe("chensInputsSchema — D19 distanceBands derivation", () => {
  it("overwrites distanceBands to [highServiceDistKm, maxDistKm] when a stale third boundary is supplied", () => {
    const r = chensInputsSchema.parse({ ...COVERAGE_BASE, distanceBands: [600, 5000, 99999] });
    expect(r.distanceBands).toEqual([600, 5000]);
  });

  it("derives distanceBands even when the field is omitted entirely (never 422)", () => {
    const r = chensInputsSchema.parse(COVERAGE_BASE);
    expect(r.distanceBands).toEqual([600, 5000]);
  });

  it("persists capacityMode 'none' by default", () => {
    const r = chensInputsSchema.parse(COVERAGE_BASE);
    expect(r.capacityMode).toBe("none");
  });
});

describe("chensInputsSchema — sparse network-edit arrays", () => {
  it("defaults all five sparse arrays to [] when absent", () => {
    const r = chensInputsSchema.parse(COVERAGE_BASE);
    expect(r.warehouseOverrides).toEqual([]);
    expect(r.customerOverrides).toEqual([]);
    expect(r.addedWarehouses).toEqual([]);
    expect(r.addedCustomers).toEqual([]);
    expect(r.distanceOverrides).toEqual([]);
  });

  it("accepts a warehouseOverride (id + status, no capacity)", () => {
    const r = chensInputsSchema.parse({
      ...COVERAGE_BASE,
      warehouseOverrides: [{ id: "wh-40", status: "forced_open" }],
    });
    expect(r.warehouseOverrides[0]).toEqual({ id: "wh-40", status: "forced_open" });
  });

  it("accepts a customerOverride with an integer demand override", () => {
    const r = chensInputsSchema.parse({
      ...COVERAGE_BASE,
      customerOverrides: [{ id: "cs-1", status: "active", demand: 12345 }],
    });
    expect(r.customerOverrides[0].demand).toBe(12345);
  });

  it("rejects a non-integer customerOverride demand", () => {
    expect(
      chensInputsSchema.safeParse({
        ...COVERAGE_BASE,
        customerOverrides: [{ id: "cs-1", status: "active", demand: 1.5 }],
      }).success,
    ).toBe(false);
  });

  it("defaults an addedCustomer's status to 'active'", () => {
    const r = chensInputsSchema.parse({
      ...COVERAGE_BASE,
      addedCustomers: [{ id: "cs-new-1", city: "Xi'an", state: "", lat: 34.3, lng: 108.9, demand: 500 }],
    });
    expect(r.addedCustomers[0].status).toBe("active");
  });

  it("accepts an addedWarehouse (no capacity field)", () => {
    const r = chensInputsSchema.parse({
      ...COVERAGE_BASE,
      addedWarehouses: [{ id: "wh-new-1", city: "Chengdu", state: "", lat: 30.6, lng: 104.1, status: "active" }],
    });
    expect(r.addedWarehouses[0]).not.toHaveProperty("capacity");
  });

  it("rejects two distanceOverrides rows for the same (fromId, toId) pair", () => {
    const r = chensInputsSchema.safeParse({
      ...COVERAGE_BASE,
      distanceOverrides: [
        { fromId: "wh-15", toId: "cs-1", distance: 3660 },
        { fromId: "wh-15", toId: "cs-1", distance: 4000 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts distinct distanceOverrides pairs", () => {
    const r = chensInputsSchema.parse({
      ...COVERAGE_BASE,
      distanceOverrides: [
        { fromId: "wh-15", toId: "cs-1", distance: 3660 },
        { fromId: "wh-15", toId: "cs-2", distance: 4000, estimated: true },
      ],
    });
    expect(r.distanceOverrides).toHaveLength(2);
  });
});
