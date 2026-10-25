import { describe, expect, it } from "vitest";
import { formatDistanceNumber } from "../index.js";

describe("formatDistanceNumber", () => {
  it("groups en-US with at most 2 dp", () => {
    expect(formatDistanceNumber(12004.8)).toBe("12,004.8");
    expect(formatDistanceNumber(11998.2461)).toBe("11,998.25");
    expect(formatDistanceNumber(892)).toBe("892");
  });
  it("renders — for non-finite", () => {
    expect(formatDistanceNumber(Number.NaN)).toBe("—");
    expect(formatDistanceNumber(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
