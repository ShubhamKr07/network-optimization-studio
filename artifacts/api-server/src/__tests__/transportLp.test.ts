import { describe, it, expect } from "vitest";
import { transportLpInputsSchema } from "../validation/inputs/transportLp.js";

describe("transportLpInputsSchema", () => {
  it("accepts an optional mineCapacities sparse dict", () => {
    const result = transportLpInputsSchema.safeParse({
      capacityFactor: 1.0, singleSource: false, capacityInactive: false,
      distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
      mineCapacities: { KY: 1000000 },
    });
    expect(result.success).toBe(true);
  });

  it("defaults mineCapacities to {} when omitted (existing scenarios unaffected)", () => {
    const result = transportLpInputsSchema.safeParse({
      capacityFactor: 1.0, singleSource: false, capacityInactive: false,
      distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative mineCapacities value", () => {
    const result = transportLpInputsSchema.safeParse({
      capacityFactor: 1.0, singleSource: false, capacityInactive: false,
      distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
      mineCapacities: { KY: -5 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional stationDemands sparse dict", () => {
    const result = transportLpInputsSchema.safeParse({
      capacityFactor: 1.0, singleSource: false, capacityInactive: false,
      distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
      stationDemands: { CHI: 12000000 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative stationDemands value", () => {
    const result = transportLpInputsSchema.safeParse({
      capacityFactor: 1.0, singleSource: false, capacityInactive: false,
      distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
      stationDemands: { CHI: -1 },
    });
    expect(result.success).toBe(false);
  });
});

// SCN v0.3 Phase B, task B6.1 — scenario-local network-edit fields for
// transport-coal (fast-follow of B1.1's p-median-us fields).
const BASE = {
  capacityFactor: 1.0, singleSource: false, capacityInactive: false,
  distanceBands: [500, 1000, 1500, 2000], gap: 0, timeLimitSec: 120,
};

describe("transportLpInputsSchema — B6.1 network-edit fields", () => {
  it("defaults addedMines/addedStations/laneCostOverrides to [] when absent (old scenario data)", () => {
    const result = transportLpInputsSchema.parse(BASE);
    expect(result.addedMines).toEqual([]);
    expect(result.addedStations).toEqual([]);
    expect(result.laneCostOverrides).toEqual([]);
  });

  it("accepts a valid addedMines entry, with no status field required", () => {
    const result = transportLpInputsSchema.parse({
      ...BASE,
      addedMines: [{ id: "MN-NEW-1", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 5_000_000 }],
    });
    expect(result.addedMines).toHaveLength(1);
    expect(result.addedMines[0]).toMatchObject({ id: "MN-NEW-1", city: "Bristol", state: "VA" });
    expect((result.addedMines[0] as Record<string, unknown>).status).toBeUndefined();
  });

  it("accepts an addedMines entry with capacity omitted/null (unconstrained)", () => {
    const result = transportLpInputsSchema.parse({
      ...BASE,
      addedMines: [{ id: "MN-NEW-2", city: "Beckley", state: "WV", lat: 37.78, lng: -81.19 }],
    });
    expect(result.addedMines[0].capacity).toBeUndefined();
  });

  it("rejects addedMines entry with empty id", () => {
    const result = transportLpInputsSchema.safeParse({
      ...BASE,
      addedMines: [{ id: "", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects addedMines entry with non-positive capacity", () => {
    const result = transportLpInputsSchema.safeParse({
      ...BASE,
      addedMines: [{ id: "MN-X", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid addedStations entry", () => {
    const result = transportLpInputsSchema.parse({
      ...BASE,
      addedStations: [{ id: "ST-NEW-1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, demand: 1_500_000 }],
    });
    expect(result.addedStations).toHaveLength(1);
    expect(result.addedStations[0]).toMatchObject({ id: "ST-NEW-1", city: "Reno", state: "NV" });
  });

  it("rejects addedStations entry with negative demand", () => {
    const result = transportLpInputsSchema.safeParse({
      ...BASE,
      addedStations: [{ id: "ST-X", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, demand: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid laneCostOverrides entry", () => {
    const result = transportLpInputsSchema.parse({
      ...BASE,
      laneCostOverrides: [{ fromId: "KY", toId: "LAX", cost: 123.4 }],
    });
    expect(result.laneCostOverrides).toHaveLength(1);
  });

  it("rejects laneCostOverrides entry with empty fromId/toId", () => {
    const result = transportLpInputsSchema.safeParse({
      ...BASE,
      laneCostOverrides: [{ fromId: "", toId: "LAX", cost: 100 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects laneCostOverrides entry with non-positive cost", () => {
    const result = transportLpInputsSchema.safeParse({
      ...BASE,
      laneCostOverrides: [{ fromId: "KY", toId: "LAX", cost: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate (fromId,toId) pairs within laneCostOverrides", () => {
    const result = transportLpInputsSchema.safeParse({
      ...BASE,
      laneCostOverrides: [
        { fromId: "KY", toId: "LAX", cost: 100 },
        { fromId: "KY", toId: "LAX", cost: 200 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("allows the same fromId with different toId (not a duplicate pair)", () => {
    const result = transportLpInputsSchema.safeParse({
      ...BASE,
      laneCostOverrides: [
        { fromId: "KY", toId: "LAX", cost: 100 },
        { fromId: "KY", toId: "NYC", cost: 200 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("does not reject an old scenario missing all three new keys entirely (rollback-safety shape)", () => {
    const result = transportLpInputsSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });
});
