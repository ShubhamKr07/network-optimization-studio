// SCU-1.1 (spec B1.9) — studio-only band helpers: range labels, per-model
// precision, and which models store EXCLUSIVE frozen coverage (deviation 1:
// solve.py's JADE path buckets each lane once, solve.py:1320-1327/:1381-1385;
// every other model's frozen bandCoverage is cumulative).
import { describe, it, expect } from "vitest";
import { bandDecimals, exclusiveBandLabels, frozenBandShape } from "@/lib/bands";

describe("exclusiveBandLabels", () => {
  const same = (v: number) => v;

  it("labels each exclusive row with its range and the overflow row with '>' (en dash, unit-aware, grouped)", () => {
    expect(exclusiveBandLabels([200, 400, 800, 1600], same, "mi")).toEqual([
      "0–200 mi", "200–400 mi", "400–800 mi", "800–1,600 mi", "> 1,600 mi",
    ]);
  });

  it("sorts boundaries", () => {
    expect(exclusiveBandLabels([400, 200], same, "mi")).toEqual(["0–200 mi", "200–400 mi", "> 400 mi"]);
  });

  // SCU-2.P3.9 (user decision 2026-10-17) — converted boundaries print through
  // formatDistanceDisplay (≤ 2 dp): no "0–321.8688 km".
  it("rounds converted km boundaries to at most 2 dp (formatDistanceDisplay)", () => {
    expect(exclusiveBandLabels([200, 400], v => v * 1.609344, "km")).toEqual(["0–321.87 km", "321.87–643.74 km", "> 643.74 km"]);
  });

  it("rounds converted mi boundaries the same way", () => {
    expect(exclusiveBandLabels([600], v => v / 1.609344, "mi")).toEqual(["0–372.82 mi", "> 372.82 mi"]);
  });

  it("no boundaries -> no labels", () => {
    expect(exclusiveBandLabels([], same, "mi")).toEqual([]);
  });
});

describe("bandDecimals", () => {
  it("delivery-teaching-us keeps its 2-dp precision; every other model is integer", () => {
    expect(bandDecimals("delivery-teaching-us")).toBe(2);
    for (const id of ["p-median-us", "p-median-brazil", "transport-coal", "max-coverage-us", "two-echelon-gold-au", "two-echelon-jade-us", undefined]) {
      expect(bandDecimals(id)).toBe(0);
    }
  });
});

describe("frozenBandShape", () => {
  it("JADE alone stores exclusive frozen coverage", () => {
    expect(frozenBandShape("two-echelon-jade-us")).toBe("exclusive");
    for (const id of ["p-median-us", "p-median-brazil", "transport-coal", "max-coverage-us", "two-echelon-gold-au", "delivery-teaching-us", undefined]) {
      expect(frozenBandShape(id)).toBe("cumulative");
    }
  });
});
