import { describe, it, expect } from "vitest";
import { KM_PER_MI, effectiveUnit, toDisplay, fromDisplay, roundForFile } from "../convert.js";

describe("convert", () => {
  it("uses the exact factor", () => expect(KM_PER_MI).toBe(1.609344));

  it("effectiveUnit: auto falls through to canonical", () => {
    expect(effectiveUnit("auto", "km")).toBe("km");
    expect(effectiveUnit("auto", "mi")).toBe("mi");
    expect(effectiveUnit("mi", "km")).toBe("mi");
  });

  it("same unit is a no-op (never re-quantized)", () => {
    expect(toDisplay(804.672, "km", "km")).toBe(804.672);
    expect(fromDisplay(500, "mi", "mi")).toBe(500);
  });

  it("km canonical shown as mi", () => {
    expect(toDisplay(804.672, "km", "mi")).toBeCloseTo(500, 9);
  });

  it("typing 500 mi against a km-canonical model stores 804.672", () => {
    expect(fromDisplay(500, "mi", "km")).toBeCloseTo(804.672, 9);
  });

  it("round-trips without drift", () => {
    const canonical = 1234.5678;
    expect(fromDisplay(toDisplay(canonical, "km", "mi"), "mi", "km")).toBeCloseTo(canonical, 9);
  });

  it("roundForFile is 4 dp", () => expect(roundForFile(124.27423844746679)).toBe(124.2742));
});
