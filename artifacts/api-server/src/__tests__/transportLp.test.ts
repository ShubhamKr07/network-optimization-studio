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
