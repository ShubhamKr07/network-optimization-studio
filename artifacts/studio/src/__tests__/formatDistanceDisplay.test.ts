import { describe, it, expect } from "vitest";
import { formatDistanceDisplay, stripGrouping } from "@/lib/formatDistanceDisplay";

// ch4-fixes item 4 — the Distances-tab display contract: thousands-grouped,
// at most 2 decimal places. Deliberately separate from `roundForFile` (4 dp,
// ungrouped), which remains the EXPORT serialization contract.
describe("formatDistanceDisplay", () => {
  it("groups thousands", () => {
    expect(formatDistanceDisplay(12004.8)).toBe("12,004.8");
    expect(formatDistanceDisplay(1234567)).toBe("1,234,567");
  });

  it("rounds to at most 2 decimal places", () => {
    expect(formatDistanceDisplay(11998.2461)).toBe("11,998.25");
    expect(formatDistanceDisplay(1234.5678)).toBe("1,234.57");
  });

  it("does not pad to a fixed 2 dp — a whole number stays whole", () => {
    expect(formatDistanceDisplay(892)).toBe("892");
    expect(formatDistanceDisplay(1000)).toBe("1,000");
  });

  it("renders a placeholder for a non-finite value rather than 'NaN'", () => {
    expect(formatDistanceDisplay(Number.NaN)).toBe("—");
    expect(formatDistanceDisplay(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("stripGrouping", () => {
  it("removes grouping separators but never the decimal point", () => {
    expect(stripGrouping("11,998.25")).toBe("11998.25");
    expect(stripGrouping("1,234,567.8")).toBe("1234567.8");
    expect(stripGrouping("892.31")).toBe("892.31");
  });

  it("is a no-op on text that carries no separator", () => {
    expect(stripGrouping("11998.2461")).toBe("11998.2461");
    expect(stripGrouping("")).toBe("");
  });
});
