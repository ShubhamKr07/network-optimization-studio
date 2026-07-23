import { describe, it, expect } from "vitest";
import { getMapBoundsProps } from "@/lib/mapBounds";

describe("getMapBoundsProps", () => {
  it("derives maxBounds and center from a model's countryBounds", () => {
    const result = getMapBoundsProps({ sw: [25.78, -123.11], ne: [47.67, -71.02] });
    expect(result.maxBounds).toEqual([[25.78, -123.11], [47.67, -71.02]]);
    expect(result.center[0]).toBeCloseTo((25.78 + 47.67) / 2);
    expect(result.center[1]).toBeCloseTo((-123.11 + -71.02) / 2);
  });

  it("derives correct bounds for a southern-hemisphere model (Brazil)", () => {
    const result = getMapBoundsProps({ sw: [-30.04, -67.82], ne: [0.04, -34.86] });
    expect(result.maxBounds).toEqual([[-30.04, -67.82], [0.04, -34.86]]);
    expect(result.center[0]).toBeCloseTo((-30.04 + 0.04) / 2);
  });

  it("falls back to a continental-US default when countryBounds is undefined", () => {
    const result = getMapBoundsProps(undefined);
    expect(result.center).toEqual([39.5, -98.35]);
  });

  it("falls back when sw/ne arrays are malformed", () => {
    const result = getMapBoundsProps({ sw: [1], ne: [2, 3] });
    expect(result.center).toEqual([39.5, -98.35]);
  });

  it("always returns minZoom 3", () => {
    expect(getMapBoundsProps({ sw: [0, 0], ne: [10, 10] }).minZoom).toBe(3);
    expect(getMapBoundsProps(undefined).minZoom).toBe(3);
  });
});
