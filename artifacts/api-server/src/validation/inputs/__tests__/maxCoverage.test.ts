import { describe, it, expect } from "vitest";
import { maxCoverageInputsSchema } from "../maxCoverage.js";

// A minimal valid base. distanceBands is intentionally omitted from most
// tests — D19's transform derives it from the two thresholds. CH4O-5: both
// `avgServiceDistCapKm` and `coverageFloorDemand` are unconditionally
// required, and no `objective` is ever client-supplied (it is derived from the
// floor by services/scenarioInputWrite.ts).
const COVERAGE_BASE = {
  p: 3,
  highServiceDistKm: 600,
  maxDistKm: 5000,
  avgServiceDistCapKm: 1000,
  coverageFloorDemand: 0,
  gap: 0,
  timeLimitSec: 60,
};

// Min-distance is the SAME shape with a positive floor — not a different
// field set.
const MIN_DISTANCE_BASE = {
  ...COVERAGE_BASE,
  coverageFloorDemand: 131645389,
};

describe("maxCoverageInputsSchema — both mode fields unconditionally required", () => {
  it("rejects a payload missing avgServiceDistCapKm, even with a zero floor", () => {
    const r = maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, avgServiceDistCapKm: undefined, coverageFloorDemand: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects a payload missing coverageFloorDemand", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, coverageFloorDemand: undefined }).success).toBe(false);
  });

  it("accepts a zero floor with a cap (Model 1)", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, coverageFloorDemand: 0 }).success).toBe(true);
  });

  it("accepts a positive floor with a cap (Model 2)", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, coverageFloorDemand: 53385024 }).success).toBe(true);
  });

  it("keeps the high < max invariant", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, highServiceDistKm: 5500, maxDistKm: 700 }).success).toBe(false);
  });

  it("no longer carries stepEpoch or step2", () => {
    const r = maxCoverageInputsSchema.parse({ ...COVERAGE_BASE, stepEpoch: 7, step2: { gap: 1, timeLimitSec: 9 } });
    expect(r).not.toHaveProperty("stepEpoch");
    expect(r).not.toHaveProperty("step2");
  });

  it("round-trips a SERVER-DERIVED objective instead of stripping it", () => {
    // The write routes refuse a client-sent `objective`; this validator still
    // has to let the server's own derived value survive a re-read.
    expect(maxCoverageInputsSchema.parse({ ...COVERAGE_BASE, objective: "coverage" }).objective).toBe("coverage");
    expect(maxCoverageInputsSchema.parse({ ...MIN_DISTANCE_BASE, objective: "min_distance" }).objective).toBe("min_distance");
  });
});

describe("maxCoverageInputsSchema — scalar constraints", () => {
  it("accepts p at the boundaries 1 and 26", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, p: 1 }).success).toBe(true);
    expect(maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, p: 26 }).success).toBe(true);
  });

  it("rejects p below 1 and above 26", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, p: 0 }).success).toBe(false);
    expect(maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, p: 27 }).success).toBe(false);
  });

  it("rejects a non-integer p", () => {
    expect(maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, p: 3.5 }).success).toBe(false);
  });

  it("rejects highServiceDistKm >= maxDistKm", () => {
    expect(
      maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, highServiceDistKm: 5000, maxDistKm: 5000 }).success,
    ).toBe(false);
    expect(
      maxCoverageInputsSchema.safeParse({ ...COVERAGE_BASE, highServiceDistKm: 6000, maxDistKm: 5000 }).success,
    ).toBe(false);
  });

  it("requires gap and timeLimitSec", () => {
    const { gap, ...noGap } = COVERAGE_BASE;
    void gap;
    expect(maxCoverageInputsSchema.safeParse(noGap).success).toBe(false);
    const { timeLimitSec, ...noTime } = COVERAGE_BASE;
    void timeLimitSec;
    expect(maxCoverageInputsSchema.safeParse(noTime).success).toBe(false);
  });

  it("rejects a non-integer coverageFloorDemand (D30 integer domain)", () => {
    expect(
      maxCoverageInputsSchema.safeParse({ ...MIN_DISTANCE_BASE, coverageFloorDemand: 100.5 }).success,
    ).toBe(false);
  });
});

describe("maxCoverageInputsSchema — distanceBands are free, D19's overwrite is gone", () => {
  it("preserves a supplied band array verbatim (no [high,max] overwrite)", () => {
    const r = maxCoverageInputsSchema.parse({ ...COVERAGE_BASE, distanceBands: [600, 1200, 2400, 5000] });
    expect(r.distanceBands).toEqual([600, 1200, 2400, 5000]);
  });

  it("derives [high,max] ONLY when distanceBands is omitted (legacy payload)", () => {
    const r = maxCoverageInputsSchema.parse(COVERAGE_BASE);
    expect(r.distanceBands).toEqual([COVERAGE_BASE.highServiceDistKm, COVERAGE_BASE.maxDistKm]);
  });

  it("accepts a single band (minItems 1)", () => {
    expect(maxCoverageInputsSchema.parse({ ...COVERAGE_BASE, distanceBands: [600] }).distanceBands).toEqual([600]);
  });

  it.each([
    ["empty", []],
    ["non-ascending", [800, 400]],
    ["duplicate", [400, 400]],
    ["zero", [0, 400]],
    ["negative", [-1, 400]],
  ])("rejects %s band arrays at the API boundary", (_label, bands) => {
    expect(() => maxCoverageInputsSchema.parse({ ...COVERAGE_BASE, distanceBands: bands })).toThrow();
  });

  it("rejects maxDistKm <= highServiceDistKm", () => {
    expect(() =>
      maxCoverageInputsSchema.parse({ ...COVERAGE_BASE, highServiceDistKm: 600, maxDistKm: 600 }),
    ).toThrow();
  });

  it("persists capacityMode 'none' by default", () => {
    const r = maxCoverageInputsSchema.parse(COVERAGE_BASE);
    expect(r.capacityMode).toBe("none");
  });
});

describe("maxCoverageInputsSchema — sparse network-edit arrays", () => {
  it("defaults all five sparse arrays to [] when absent", () => {
    const r = maxCoverageInputsSchema.parse(COVERAGE_BASE);
    expect(r.warehouseOverrides).toEqual([]);
    expect(r.customerOverrides).toEqual([]);
    expect(r.addedWarehouses).toEqual([]);
    expect(r.addedCustomers).toEqual([]);
    expect(r.distanceOverrides).toEqual([]);
  });

  it("accepts a warehouseOverride (id + status, no capacity)", () => {
    const r = maxCoverageInputsSchema.parse({
      ...COVERAGE_BASE,
      warehouseOverrides: [{ id: "wh-40", status: "forced_open" }],
    });
    expect(r.warehouseOverrides[0]).toEqual({ id: "wh-40", status: "forced_open" });
  });

  it("accepts a customerOverride with an integer demand override", () => {
    const r = maxCoverageInputsSchema.parse({
      ...COVERAGE_BASE,
      customerOverrides: [{ id: "cs-1", status: "active", demand: 12345 }],
    });
    expect(r.customerOverrides[0].demand).toBe(12345);
  });

  it("rejects a non-integer customerOverride demand", () => {
    expect(
      maxCoverageInputsSchema.safeParse({
        ...COVERAGE_BASE,
        customerOverrides: [{ id: "cs-1", status: "active", demand: 1.5 }],
      }).success,
    ).toBe(false);
  });

  it("defaults an addedCustomer's status to 'active'", () => {
    const r = maxCoverageInputsSchema.parse({
      ...COVERAGE_BASE,
      addedCustomers: [{ id: "cs-new-1", city: "Xi'an", state: "", lat: 34.3, lng: 108.9, demand: 500 }],
    });
    expect(r.addedCustomers[0].status).toBe("active");
  });

  it("accepts an addedWarehouse (no capacity field)", () => {
    const r = maxCoverageInputsSchema.parse({
      ...COVERAGE_BASE,
      addedWarehouses: [{ id: "wh-new-1", city: "Chengdu", state: "", lat: 30.6, lng: 104.1, status: "active" }],
    });
    expect(r.addedWarehouses[0]).not.toHaveProperty("capacity");
  });

  it("rejects two distanceOverrides rows for the same (fromId, toId) pair", () => {
    const r = maxCoverageInputsSchema.safeParse({
      ...COVERAGE_BASE,
      distanceOverrides: [
        { fromId: "wh-15", toId: "cs-1", distance: 3660 },
        { fromId: "wh-15", toId: "cs-1", distance: 4000 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("accepts distinct distanceOverrides pairs", () => {
    const r = maxCoverageInputsSchema.parse({
      ...COVERAGE_BASE,
      distanceOverrides: [
        { fromId: "wh-15", toId: "cs-1", distance: 3660 },
        { fromId: "wh-15", toId: "cs-2", distance: 4000, estimated: true },
      ],
    });
    expect(r.distanceOverrides).toHaveLength(2);
  });
});

