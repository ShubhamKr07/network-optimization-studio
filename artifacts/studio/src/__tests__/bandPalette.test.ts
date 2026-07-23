import { describe, it, expect } from "vitest";
import { BAND_COLORS, getBandColor } from "@/lib/bandPalette";

describe("getBandColor", () => {
  it("returns the color at the given index", () => {
    expect(getBandColor(0)).toBe(BAND_COLORS[0]);
    expect(getBandColor(2)).toBe(BAND_COLORS[2]);
  });

  it("clamps to the last color when the index exceeds the palette", () => {
    expect(getBandColor(99)).toBe(BAND_COLORS[BAND_COLORS.length - 1]);
  });
});
