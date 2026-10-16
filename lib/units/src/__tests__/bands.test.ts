import { describe, it, expect } from "vitest";
import {
  OVERFLOW_BAND, assignBandOrOverflow, bandLabelOrOverflow,
  computeCumulativeBandCoverage, computeExclusiveBandCoverage,
  frozenBandCoverageToExclusive, serviceEdgesFor,
} from "../bands.js";

const BANDS = [200, 400, 800];

describe("assignBandOrOverflow", () => {
  it("a distance exactly on a boundary lands in THAT band, not the next", () => {
    expect(assignBandOrOverflow(200, BANDS)).toBe(0);
    expect(assignBandOrOverflow(400, BANDS)).toBe(1);
  });
  it("beyond the last boundary is the overflow sentinel, never the last band", () => {
    expect(assignBandOrOverflow(800.0001, BANDS)).toBe(OVERFLOW_BAND);
  });
  it("labels render the sentinel categorically", () => {
    expect(bandLabelOrOverflow(150, BANDS)).toBe("Band 1");
    expect(bandLabelOrOverflow(9999, BANDS)).toBe("Overflow");
  });
});

describe("computeCumulativeBandCoverage", () => {
  it("rows are keyed by the BOUNDARY value, cumulative, and omit a zero overflow", () => {
    const edges = [{ distance: 100, flow: 50 }, { distance: 300, flow: 50 }];
    expect(computeCumulativeBandCoverage(edges, BANDS)).toEqual([
      { band: 200, percent: 50 }, { band: 400, percent: 100 }, { band: 800, percent: 100 },
    ]);
  });
  it("appends the overflow row only when there IS overflow", () => {
    const edges = [{ distance: 100, flow: 50 }, { distance: 9999, flow: 50 }];
    const rows = computeCumulativeBandCoverage(edges, BANDS);
    expect(rows.at(-1)).toEqual({ band: OVERFLOW_BAND, percent: 50 });
  });
  it("zero total flow yields 0% rows, never NaN", () => {
    expect(computeCumulativeBandCoverage([{ distance: 100, flow: 0 }], BANDS))
      .toEqual([{ band: 200, percent: 0 }, { band: 400, percent: 0 }, { band: 800, percent: 0 }]);
  });
});

// Task 12 (Chapter 5, delivery-teaching-us) — opt-in precision. Five models
// have tests pinned to integer percentages (above); changing the default is
// out of scope. This is purely additive.
describe("computeCumulativeBandCoverage — opt-in precision", () => {
  const edges = [
    { distance: 100, flow: 1 },
    { distance: 900, flow: 2 },
  ];

  it("still returns integers by default", () => {
    const rows = computeCumulativeBandCoverage(edges, [400, 1600]);
    expect(rows[0]!.percent).toBe(33);
  });

  it("returns two decimals when asked", () => {
    const rows = computeCumulativeBandCoverage(edges, [400, 1600], { decimals: 2 });
    expect(rows[0]!.percent).toBeCloseTo(33.33, 2);
  });

  it("keeps the Overflow row under both precisions", () => {
    const rows = computeCumulativeBandCoverage(edges, [400], { decimals: 2 });
    expect(rows.some(r => r.band === OVERFLOW_BAND)).toBe(true);
  });
});

describe("serviceEdgesFor", () => {
  it("two-echelon data keeps only the outbound/customer-serving leg", () => {
    const edges = [
      { distance: 10, flow: 1, leg: "plant_to_warehouse" },
      { distance: 20, flow: 2, leg: "warehouse_to_customer" },
      { distance: 30, flow: 3, leg: "refinery_to_customer" },
    ];
    expect(serviceEdgesFor(edges).map(e => e.distance)).toEqual([20, 30]);
  });
  it("single-echelon data (no leg tags) passes through untouched", () => {
    const edges = [{ distance: 10, flow: 1 }, { distance: 20, flow: 2 }];
    expect(serviceEdgesFor(edges)).toHaveLength(2);
  });
});

// SCU-1.1 (spec B1.9) — EXCLUSIVE rows: band 0 = 0 <= d <= b0, band i =
// b(i-1) < d <= b(i), overflow = d > b(max). Always one row per boundary
// plus an overflow row; rounded to `decimals`, residual to the largest
// positive share (ties -> lowest band). Every expected value below was
// computed by running the algorithm, not by eye.
describe("computeExclusiveBandCoverage", () => {
  const pct = (rows: { percent: number }[]) => rows.map(r => r.percent);

  it("a zero-distance edge lands in band 0", () => {
    expect(computeExclusiveBandCoverage([{ distance: 0, flow: 5 }], BANDS, 0)).toEqual([
      { band: 200, percent: 100 }, { band: 400, percent: 0 }, { band: 800, percent: 0 }, { band: OVERFLOW_BAND, percent: 0 },
    ]);
  });

  it("a distance exactly on a boundary lands in the LOWER band", () => {
    const rows = computeExclusiveBandCoverage([{ distance: 200, flow: 1 }, { distance: 400, flow: 1 }], BANDS, 0);
    expect(pct(rows)).toEqual([50, 50, 0, 0]);
  });

  it("always ends with an overflow row, even at 0%", () => {
    const rows = computeExclusiveBandCoverage([{ distance: 100, flow: 1 }], BANDS, 0);
    expect(rows).toHaveLength(BANDS.length + 1);
    expect(rows.at(-1)).toEqual({ band: OVERFLOW_BAND, percent: 0 });
  });

  it("counts flow beyond the last boundary in the overflow row only", () => {
    const rows = computeExclusiveBandCoverage([{ distance: 100, flow: 1 }, { distance: 900, flow: 3 }], BANDS, 0);
    expect(pct(rows)).toEqual([25, 0, 0, 75]);
  });

  it("integer rounding: the residual makes the rows sum to exactly 100, given to the largest share (ties -> lowest band)", () => {
    const edges = [{ distance: 100, flow: 1 }, { distance: 300, flow: 1 }, { distance: 700, flow: 1 }];
    expect(pct(computeExclusiveBandCoverage(edges, BANDS, 0))).toEqual([34, 33, 33, 0]);
  });

  it("2-dp rounding: the residual makes the rows sum to 100", () => {
    const edges = [{ distance: 100, flow: 1 }, { distance: 300, flow: 1 }, { distance: 700, flow: 1 }];
    const rows = computeExclusiveBandCoverage(edges, BANDS, 2);
    expect(pct(rows)).toEqual([33.34, 33.33, 33.33, 0]);
    expect(rows.reduce((s, r) => s + r.percent, 0)).toBeCloseTo(100, 9);
  });

  it("a 0% row never receives the residual", () => {
    const edges = [{ distance: 100, flow: 1 }, { distance: 300, flow: 1 }, { distance: 900, flow: 1 }];
    expect(pct(computeExclusiveBandCoverage(edges, BANDS, 0))).toEqual([34, 33, 0, 33]);
  });

  it("all-zero flow -> every row 0, no residual applied", () => {
    const rows = computeExclusiveBandCoverage([{ distance: 100, flow: 0 }, { distance: 900, flow: 0 }], BANDS, 0);
    expect(pct(rows)).toEqual([0, 0, 0, 0]);
  });

  it("no boundaries -> no rows (same as computeCumulativeBandCoverage)", () => {
    expect(computeExclusiveBandCoverage([{ distance: 10, flow: 1 }], [], 0)).toEqual([]);
  });

  it("sorts unsorted boundaries", () => {
    const rows = computeExclusiveBandCoverage([{ distance: 300, flow: 1 }], [800, 200, 400], 0);
    expect(rows.map(r => r.band)).toEqual([200, 400, 800, OVERFLOW_BAND]);
    expect(pct(rows)).toEqual([0, 100, 0, 0]);
  });
});

// SCU-1.1 (spec B1.9 "Compare helper", deviation 1) — frozen
// `metrics.bandCoverage` -> exclusive rows. Fixture shapes follow solve.py:
// p-median :497-501 (cumulative, integer, no -1 row); delivery :1842-1845
// (cumulative, 2 dp, explicit -1 row); JADE :1320-1327/:1381-1385/:1401-1406
// (EXCLUSIVE, integer, explicit -1 row — values from a real local run of
// test_jade.GROUND_TRUTH_INPUTS with bands [200,400,800,1200]); max-coverage
// :1633 (two-row [highService, 100%]).
describe("frozenBandCoverageToExclusive", () => {
  const pct = (rows: { percent: number }[] | null) => rows?.map(r => r.percent);

  it("absent, empty, or overflow-only coverage -> null", () => {
    expect(frozenBandCoverageToExclusive(undefined, 0, "cumulative")).toBeNull();
    expect(frozenBandCoverageToExclusive(null, 0, "cumulative")).toBeNull();
    expect(frozenBandCoverageToExclusive([], 0, "cumulative")).toBeNull();
    expect(frozenBandCoverageToExclusive([{ band: OVERFLOW_BAND, percent: 100 }], 0, "cumulative")).toBeNull();
  });

  it("p-median integer cumulative -> exclusive, overflow = 100 - last", () => {
    const rows = frozenBandCoverageToExclusive(
      [{ band: 200, percent: 40 }, { band: 400, percent: 80 }, { band: 800, percent: 95 }, { band: 1600, percent: 100 }], 0, "cumulative");
    expect(rows).toEqual([
      { band: 200, percent: 40 }, { band: 400, percent: 40 }, { band: 800, percent: 15 },
      { band: 1600, percent: 5 }, { band: OVERFLOW_BAND, percent: 0 },
    ]);
  });

  it("delivery 2-dp cumulative with an explicit -1 row: the -1 row is dropped before differencing, never a boundary", () => {
    const rows = frozenBandCoverageToExclusive([
      { band: 400, percent: 59.38 }, { band: 800, percent: 81.45 }, { band: 1200, percent: 99.44 },
      { band: 1600, percent: 99.8 }, { band: OVERFLOW_BAND, percent: 0.2 },
    ], 2, "cumulative");
    expect(rows).toEqual([
      { band: 400, percent: 59.38 }, { band: 800, percent: 22.07 }, { band: 1200, percent: 17.99 },
      { band: 1600, percent: 0.36 }, { band: OVERFLOW_BAND, percent: 0.2 },
    ]);
  });

  it("zero total flow (every cumulative row 0, no positive overflow row) -> every row 0, not overflow 100", () => {
    const rows = frozenBandCoverageToExclusive([{ band: 200, percent: 0 }, { band: 400, percent: 0 }], 0, "cumulative");
    expect(pct(rows)).toEqual([0, 0, 0]);
    // all flow beyond the last boundary is NOT zero flow: the explicit -1 row says so.
    expect(pct(frozenBandCoverageToExclusive(
      [{ band: 200, percent: 0 }, { band: 400, percent: 0 }, { band: OVERFLOW_BAND, percent: 100 }], 0, "cumulative"))).toEqual([0, 0, 100]);
  });

  it("JADE frozen coverage is ALREADY exclusive: kept as-is, explicit -1 is the overflow, residual fixes the 101", () => {
    const rows = frozenBandCoverageToExclusive([
      { band: 200, percent: 21 }, { band: 400, percent: 12 }, { band: 800, percent: 31 },
      { band: 1200, percent: 25 }, { band: OVERFLOW_BAND, percent: 12 },
    ], 0, "exclusive");
    expect(pct(rows)).toEqual([21, 12, 30, 25, 12]);
  });

  it("exclusive shape without a -1 row has a 0% overflow row", () => {
    expect(pct(frozenBandCoverageToExclusive([{ band: 200, percent: 60 }, { band: 400, percent: 40 }], 0, "exclusive")))
      .toEqual([60, 40, 0]);
  });

  it("max-coverage's two-row [highService, 100%] shape works through the cumulative path", () => {
    expect(frozenBandCoverageToExclusive([{ band: 450, percent: 66.6667 }, { band: 3400, percent: 100 }], 0, "cumulative"))
      .toEqual([{ band: 450, percent: 67 }, { band: 3400, percent: 33 }, { band: OVERFLOW_BAND, percent: 0 }]);
  });

  it("non-monotonic rounded cumulative data clamps negative differences to 0", () => {
    expect(pct(frozenBandCoverageToExclusive([{ band: 200, percent: 50 }, { band: 400, percent: 49 }], 0, "cumulative")))
      .toEqual([50, 0, 50]);
  });

  it("sorts rows by boundary before differencing", () => {
    expect(frozenBandCoverageToExclusive([{ band: 400, percent: 80 }, { band: 200, percent: 40 }], 0, "cumulative"))
      .toEqual([{ band: 200, percent: 40 }, { band: 400, percent: 40 }, { band: OVERFLOW_BAND, percent: 20 }]);
  });
});
