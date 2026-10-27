import { describe, it, expect } from "vitest";
import {
  OVERFLOW_BAND, assignBandOrOverflow, bandRangeLabelForDistance,
  computeCumulativeBandCoverage, computeExclusiveBandCoverage,
  frozenBandCoverageToExclusive, serviceEdgesFor, bandRangeLabel,
  INBOUND_LEGS, OUTBOUND_LEGS, bandsForLeg,
} from "../bands.js";
import { formatDistanceNumber } from "../format.js";
import { toDisplay } from "../convert.js";

const BANDS = [200, 400, 800];

describe("assignBandOrOverflow", () => {
  it("a distance exactly on a boundary lands in THAT band, not the next", () => {
    expect(assignBandOrOverflow(200, BANDS)).toBe(0);
    expect(assignBandOrOverflow(400, BANDS)).toBe(1);
  });
  it("beyond the last boundary is the overflow sentinel, never the last band", () => {
    expect(assignBandOrOverflow(800.0001, BANDS)).toBe(OVERFLOW_BAND);
  });
});

describe("bandRangeLabelForDistance (DU-4.2)", () => {
  it("first band is ≤, middle is a–b, overflow is >, boundary belongs to the lower band", () => {
    expect(bandRangeLabelForDistance(150, BANDS, "mi", "mi")).toBe("≤ 200 mi");
    expect(bandRangeLabelForDistance(200, BANDS, "mi", "mi")).toBe("≤ 200 mi");
    expect(bandRangeLabelForDistance(300, BANDS, "mi", "mi")).toBe("200–400 mi");
    expect(bandRangeLabelForDistance(9999, BANDS, "mi", "mi")).toBe("> 800 mi");
  });
  it("classifies canonically, renders boundaries in the display unit", () => {
    const km = formatDistanceNumber(toDisplay(100, "mi", "km"));
    expect(bandRangeLabelForDistance(50, [100], "mi", "km")).toBe(`≤ ${km} km`);
    expect(bandRangeLabelForDistance(101, [100], "mi", "km")).toBe(`> ${km} km`);
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

  it("all-zero cumulative rows mean ALL flow lies beyond the last boundary -> overflow 100", () => {
    // p-median-us/brazil and transport-coal freeze cumulative rows with NO -1
    // row (solve.py:501,673,865), so [0, 0] is "everything beyond 400", not
    // zero flow; frozen rows alone cannot tell true zero flow apart.
    expect(pct(frozenBandCoverageToExclusive([{ band: 200, percent: 0 }, { band: 400, percent: 0 }], 0, "cumulative")))
      .toEqual([0, 0, 100]);
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

describe("bandRangeLabel (DU-2.2)", () => {
  const B = [200, 400, 800, 1600];
  it("first / middle / overflow text, upper-inclusive", () => {
    expect(bandRangeLabel(0, B, "mi")).toBe("≤ 200 mi");
    expect(bandRangeLabel(1, B, "mi")).toBe("200–400 mi");
    expect(bandRangeLabel(3, B, "mi")).toBe("800–1,600 mi");
    expect(bandRangeLabel(OVERFLOW_BAND, B, "mi")).toBe("> 1,600 mi");
    expect(bandRangeLabel(assignBandOrOverflow(200, B), B, "mi")).toBe("≤ 200 mi");
    expect(bandRangeLabel(assignBandOrOverflow(1600.0001, B), B, "mi")).toBe("> 1,600 mi");
  });
  it("sorts its input and uses the shared number format", () => {
    expect(bandRangeLabel(1, [400, 200], "km")).toBe("200–400 km");
    expect(bandRangeLabel(0, [321.8688], "km")).toBe("≤ 321.87 km");
  });
  it("no bands -> 'All distances'", () => {
    expect(bandRangeLabel(0, [], "mi")).toBe("All distances");
  });
  it("never emits 'Band N'", () => {
    for (const i of [0, 1, 2, 3, OVERFLOW_BAND]) expect(bandRangeLabel(i, B, "mi")).not.toMatch(/Band/);
  });
  // moved from studio exclusiveBands.test.ts (exclusiveBandLabels), re-expressed; first row is now "≤ 200"
  it("labels every exclusive row, grouped, with the overflow row last", () => {
    expect([0, 1, 2, 3, OVERFLOW_BAND].map(i => bandRangeLabel(i, B, "mi"))).toEqual([
      "≤ 200 mi", "200–400 mi", "400–800 mi", "800–1,600 mi", "> 1,600 mi",
    ]);
  });
  it("sorts boundaries", () => {
    expect([0, 1, OVERFLOW_BAND].map(i => bandRangeLabel(i, [400, 200], "mi"))).toEqual(["≤ 200 mi", "200–400 mi", "> 400 mi"]);
  });
  it("rounds converted km boundaries to at most 2 dp", () => {
    const km = [200, 400].map(v => v * 1.609344);
    expect([0, 1, OVERFLOW_BAND].map(i => bandRangeLabel(i, km, "km"))).toEqual(["≤ 321.87 km", "321.87–643.74 km", "> 643.74 km"]);
  });
  it("rounds converted mi boundaries the same way", () => {
    expect([0, OVERFLOW_BAND].map(i => bandRangeLabel(i, [600 / 1.609344], "mi"))).toEqual(["≤ 372.82 mi", "> 372.82 mi"]);
  });
});

describe("bandsForLeg (DU-4.1)", () => {
  const inputs = { distanceBands: [200, 400], inboundDistanceBands: [500, 1500] };
  it("inbound legs read inboundDistanceBands", () => {
    expect(bandsForLeg("plant_to_warehouse", inputs)).toEqual([500, 1500]);
    expect(bandsForLeg("mine_to_refinery", inputs)).toEqual([500, 1500]);
  });
  it("inbound legs fall back to distanceBands when the key is absent (Q7)", () => {
    expect(bandsForLeg("plant_to_warehouse", { distanceBands: [200, 400] })).toEqual([200, 400]);
  });
  it("outbound, unknown and absent legs read distanceBands", () => {
    for (const leg of ["warehouse_to_customer", "refinery_to_customer", "typo_leg", null, undefined]) {
      expect(bandsForLeg(leg, inputs)).toEqual([200, 400]);
    }
  });
  it("role sets are the one authority", () => {
    expect([...INBOUND_LEGS].sort()).toEqual(["mine_to_refinery", "plant_to_warehouse"]);
    expect([...OUTBOUND_LEGS].sort()).toEqual(["refinery_to_customer", "warehouse_to_customer"]);
  });
});
