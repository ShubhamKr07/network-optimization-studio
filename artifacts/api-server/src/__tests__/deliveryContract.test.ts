import { describe, it, expect } from "vitest";
import { deliveryInputsSchema } from "../validation/inputs/delivery.js";
import { buildPayload } from "../solver/pmedian.js";

function baseInputs() {
  return {
    p: 3,
    distanceBands: [400, 800, 1200, 1600],
    gap: 0,
    timeLimitSec: 120,
    costAdjustEnabled: false,
    distanceThreshold: 800,
    costPerMile: 1,
    costPerMileOver: 10,
    laneCostOverrides: [],
  };
}

describe("deliveryInputsSchema", () => {
  it("accepts the default payload and defaults laneCostOverrides", () => {
    const parsed = deliveryInputsSchema.parse({ ...baseInputs(), laneCostOverrides: undefined });
    expect(parsed.laneCostOverrides).toEqual([]);
    expect(parsed.costAdjustEnabled).toBe(false);
  });

  it("accepts p at the 33 bound and rejects 34", () => {
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 33 }).success).toBe(true);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 34 }).success).toBe(false);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 0 }).success).toBe(false);
  });

  // The source ships 33 zero-distance self-lanes, seeded into costs.json as
  // zero costs. A schema forbidding a zero OVERRIDE would forbid restoring a
  // value the dataset itself contains.
  it("accepts a zero lane-cost override but rejects a negative or non-finite one", () => {
    const zero = [{ fromId: "W1", toId: "C1", cost: 0 }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: zero }).success).toBe(true);
    const neg = [{ fromId: "W1", toId: "C1", cost: -1 }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: neg }).success).toBe(false);
    const inf = [{ fromId: "W1", toId: "C1", cost: Number.POSITIVE_INFINITY }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: inf }).success).toBe(false);
  });

  it("rejects a zero or negative rate", () => {
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), costPerMile: 0 }).success).toBe(false);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), costPerMileOver: -1 }).success).toBe(false);
  });

  it("rejects duplicate (fromId, toId) override pairs", () => {
    const dup = [
      { fromId: "W1", toId: "C1", cost: 5 },
      { fromId: "W1", toId: "C1", cost: 6 },
    ];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: dup }).success).toBe(false);
  });
});

describe("buildPayload — delivery-teaching-us", () => {
  it("emits modelType 'delivery' and passes every rate field through", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse({ ...baseInputs(), costAdjustEnabled: true }),
    }) as Record<string, unknown>;

    expect(payload.modelType).toBe("delivery");
    expect(payload.pValue).toBe(3);
    expect(payload.costAdjustEnabled).toBe(true);
    expect(payload.distanceThreshold).toBe(800);
    expect(payload.costPerMile).toBe(1);
    expect(payload.costPerMileOver).toBe(10);
    expect(payload.distanceBands).toEqual([400, 800, 1200, 1600]);
  });

  // The dispatcher's old failure mode was a missing branch landing in
  // solve_pmedian and returning a plausible WRONG answer.
  it("never emits p_median for this model", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse(baseInputs()),
    }) as Record<string, unknown>;
    expect(payload.modelType).not.toBe("p_median");
  });
});
