import { describe, it, expect } from "vitest";
import { migrateInputs } from "../ch4ToMiles.js";

// Narrows for TypeScript as well as asserting — a plain expect() does not.
function expectOk(r: ReturnType<typeof migrateInputs>): Record<string, unknown> {
  if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
  return r.inputs;
}

const kmRow = {
  objective: "coverage", p: 3,
  highServiceDistKm: 700, maxDistKm: 5500, avgServiceDistCapKm: 1000,
  gap: 0, timeLimitSec: 120, capacityMode: "none",
  distanceBands: [700, 1400, 2800, 5500],
  stepEpoch: 4, step2: { gap: 1, timeLimitSec: 90 },
  warehouseOverrides: [], customerOverrides: [],
  addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};

describe("migrateInputs", () => {
  it("converts the three scalars to 2 dp miles", () => {
    const i = expectOk(migrateInputs(kmRow));
    expect(i.highServiceDistMi).toBeCloseTo(434.96, 2);
    expect(i.maxDistMi).toBeCloseTo(3417.54, 2);
    expect(i.avgServiceDistCapMi).toBeCloseTo(621.37, 2);
    expect(i).not.toHaveProperty("highServiceDistKm");
  });

  it("converts distanceBands and keeps them strictly ascending", () => {
    const bands = expectOk(migrateInputs(kmRow)).distanceBands as number[];
    expect(bands).toHaveLength(4);
    expect(bands.every((v, n) => n === 0 || v > bands[n - 1])).toBe(true);
  });

  // THE one that corrupts data if missed. distanceOverrides[].distance is raw km
  // that precheck overlays DIRECTLY onto the base matrix, and for an added
  // entity it is the ONLY record of that distance. Assert the VALUE -- a test
  // that only checks the array length passes against the exact bug.
  it("converts EVERY distanceOverrides[].distance", () => {
    const i = expectOk(migrateInputs({
      ...kmRow,
      distanceOverrides: [
        { fromId: "ALN", toId: "C1", distance: 601.894656 },
        { fromId: "aw-x", toId: "C2", distance: 100, estimated: true },
      ],
    }));
    const o = i.distanceOverrides as Array<{ distance: number; estimated?: boolean }>;
    expect(o[0].distance).toBeCloseTo(374, 2);
    expect(o[1].distance).toBeCloseTo(62.14, 2);
    expect(o[1].estimated).toBe(true);   // a boolean flag does not convert
  });

  it("defaults a missing avgServiceDistCapKm (old min-distance row)", () => {
    const { avgServiceDistCapKm, ...noCap } = kmRow;
    const i = expectOk(migrateInputs({ ...noCap, objective: "min_distance", coverageFloorDemand: 53385024 }));
    expect(i.avgServiceDistCapMi).toBe(650);
  });

  it("derives the objective from the floor and drops the step fields", () => {
    expect(expectOk(migrateInputs(kmRow)).objective).toBe("coverage");
    expect(expectOk(migrateInputs({ ...kmRow, coverageFloorDemand: 500 })).objective).toBe("min_distance");
    const i = expectOk(migrateInputs(kmRow));
    expect(i).not.toHaveProperty("stepEpoch");
    expect(i).not.toHaveProperty("step2");
  });

  it("defaults an absent coverageFloorDemand to 0", () => {
    expect(expectOk(migrateInputs(kmRow)).coverageFloorDemand).toBe(0);
  });

  it("dedupes bands that collide after rounding", () => {
    const bands = expectOk(migrateInputs({ ...kmRow, distanceBands: [1, 1.001, 700] })).distanceBands as number[];
    expect(new Set(bands).size).toBe(bands.length);
  });

  it("falls back to [high, max] when every band rounds away", () => {
    const i = expectOk(migrateInputs({ ...kmRow, distanceBands: [0.0001] }));
    expect(i.distanceBands).toEqual([i.highServiceDistMi, i.maxDistMi]);
  });

  it("SKIPS a row it cannot make valid, rather than writing it", () => {
    const r = migrateInputs({ ...kmRow, highServiceDistKm: 5500, maxDistKm: 700 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/validation/i);
  });

  it("is idempotent — an already-migrated row is returned unchanged", () => {
    const once = expectOk(migrateInputs(kmRow));
    expect(expectOk(migrateInputs(once))).toEqual(once);
  });
});
