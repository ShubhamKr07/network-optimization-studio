import { describe, it, expect } from "vitest";
import { BAND_COLORS, getBandColor } from "@/lib/bandPalette";

// Bundle 3 (T10) — static token-representation contract: BAND_COLORS must be
// the CSS-var references into --band-0..4 (index.css), not literal hex, so
// the tokens stay the single source of truth. A literal-hex array with the
// same values would fail this on purpose.
describe("BAND_COLORS", () => {
  it("is the --band-0..4 CSS-var reference array, not literal hex", () => {
    expect(BAND_COLORS).toEqual([
      "var(--band-0)",
      "var(--band-1)",
      "var(--band-2)",
      "var(--band-3)",
      "var(--band-4)",
    ]);
  });

  it("has exactly 5 entries", () => {
    expect(BAND_COLORS).toHaveLength(5);
  });
});

describe("getBandColor", () => {
  it("returns the color at the given index", () => {
    expect(getBandColor(0)).toBe(BAND_COLORS[0]);
    expect(getBandColor(2)).toBe(BAND_COLORS[2]);
  });

  it("clamps to the last color when the index exceeds the palette", () => {
    expect(getBandColor(6)).toBe(BAND_COLORS[4]);
    expect(getBandColor(99)).toBe(BAND_COLORS[BAND_COLORS.length - 1]);
  });
});
