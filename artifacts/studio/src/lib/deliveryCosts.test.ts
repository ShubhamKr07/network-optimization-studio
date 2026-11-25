import { describe, it, expect } from "vitest";
import { formatCost2, round2 } from "./deliveryCosts";

describe("round2 / formatCost2 (WQF-C6)", () => {
  it("rounds half up to 2 dp, including binary edge cases", () => {
    expect(round2(1047.7157)).toBe(1047.72);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.125)).toBe(0.13);
    expect(round2(622.1149)).toBe(622.11);
    expect(round2(0)).toBe(0);
  });
  it("always displays two decimals", () => {
    expect(formatCost2(1047.7157)).toBe("1047.72");
    expect(formatCost2(8)).toBe("8.00");
    expect(formatCost2(0)).toBe("0.00");
  });
});
