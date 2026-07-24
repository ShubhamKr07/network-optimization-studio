import { describe, it, expect } from "vitest";
import { twoEchelonInputsSchema } from "../validation/inputs/twoEchelon.js";

describe("twoEchelonInputsSchema", () => {
  it("accepts a valid two-echelon input", () => {
    const result = twoEchelonInputsSchema.safeParse({
      bomRatio: 1.1, distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120,
    });
    expect(result.success).toBe(true);
  });

  it("rejects bomRatio: 0.5 (<=1)", () => {
    const result = twoEchelonInputsSchema.safeParse({
      bomRatio: 0.5, distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing timeLimitSec", () => {
    const result = twoEchelonInputsSchema.safeParse({
      bomRatio: 1.1, distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0,
    });
    expect(result.success).toBe(false);
  });
});
