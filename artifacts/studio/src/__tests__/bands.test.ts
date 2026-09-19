import { describe, it, expect } from "vitest";
import {
  assignBand,
  computeBandCoverage,
  computeAutoBands,
  assignBandOrOverflow,
  computeCumulativeBandCoverage,
  bandLabel,
  bandRangeLabel,
  OVERFLOW_BAND,
} from "@/lib/bands";

describe("assignBand", () => {
  it("returns the first band whose boundary the distance is <= to", () => {
    expect(assignBand(150, [200, 400, 800])).toBe(0);
    expect(assignBand(250, [200, 400, 800])).toBe(1);
  });

  it("treats distance == boundary as within that band", () => {
    expect(assignBand(200, [200, 400, 800])).toBe(0);
  });

  it("returns the last band index when distance exceeds every boundary", () => {
    expect(assignBand(1000, [200, 400, 800])).toBe(2);
  });

  it("returns 0 for empty bands", () => {
    expect(assignBand(100, [])).toBe(0);
  });

  it("sorts unsorted band input before assigning", () => {
    expect(assignBand(250, [800, 200, 400])).toBe(1);
  });
});

describe("computeBandCoverage", () => {
  it("returns exclusive percent coverage per band — flow already counted in a lesser band is excluded from every greater band", () => {
    const edges = [
      { distance: 100, flow: 50 },
      { distance: 300, flow: 30 },
      { distance: 900, flow: 20 },
    ];
    expect(computeBandCoverage(edges, [200, 400, 800])).toEqual([
      { band: 200, percent: 50 }, // (0,200]: the 100mi edge
      { band: 400, percent: 30 }, // (200,400]: the 300mi edge only — NOT the 100mi one again
      { band: 800, percent: 0 },  // (400,800]: nothing (900mi is past 800)
    ]);
  });

  it("counts distance == boundary as within that band, and excludes it from the next band", () => {
    const edges = [{ distance: 200, flow: 100 }];
    expect(computeBandCoverage(edges, [200, 400])).toEqual([
      { band: 200, percent: 100 },
      { band: 400, percent: 0 },
    ]);
  });

  it("returns an empty array for empty bands", () => {
    expect(computeBandCoverage([{ distance: 100, flow: 50 }], [])).toEqual([]);
  });

  it("returns 0% for every band when there are no edges", () => {
    expect(computeBandCoverage([], [200, 400])).toEqual([
      { band: 200, percent: 0 },
      { band: 400, percent: 0 },
    ]);
  });

  it("sorts unsorted band input before computing", () => {
    const edges = [{ distance: 300, flow: 100 }];
    expect(computeBandCoverage(edges, [400, 200])).toEqual([
      { band: 200, percent: 0 },
      { band: 400, percent: 100 },
    ]);
  });
});

describe("computeAutoBands", () => {
  it("derives 5 equal-width bands spanning 0..max distance, rounded to a nice step", () => {
    const edges = [{ distance: 200, flow: 10 }, { distance: 1000, flow: 20 }, { distance: 600, flow: 5 }];
    expect(computeAutoBands(edges)).toEqual([200, 400, 600, 800, 1000]);
  });

  it("rounds a step up to the next nice number rather than truncating (never undercovers max distance)", () => {
    const edges = [{ distance: 483, flow: 1 }];
    const bands = computeAutoBands(edges, 1);
    expect(bands).toEqual([500]);
    expect(bands[bands.length - 1]).toBeGreaterThanOrEqual(483);
  });

  it("supports a custom band count", () => {
    const edges = [{ distance: 1000, flow: 1 }];
    expect(computeAutoBands(edges, 2)).toHaveLength(2);
  });

  it("returns [] when there are no edges (caller should leave existing bands untouched)", () => {
    expect(computeAutoBands([])).toEqual([]);
  });

  it("returns [] when every edge is at distance 0", () => {
    expect(computeAutoBands([{ distance: 0, flow: 100 }])).toEqual([]);
  });

  it("the last band always covers the actual max distance", () => {
    for (const max of [17, 483, 1234, 9999, 2544]) {
      const bands = computeAutoBands([{ distance: max, flow: 1 }]);
      expect(bands[bands.length - 1]).toBeGreaterThanOrEqual(max);
    }
  });
});

// jade-T14 — model-integration-precheck.md Gate 4 [BLOCKER]: an explicit
// overflow bucket, additive-only. These are NEW functions; every test above
// this point is byte-for-byte unmodified from before this task and still
// exercises `assignBand`/`computeBandCoverage`/`computeAutoBands` exactly as
// p-median-us and Ch10 (two-echelon-gold-au) already rely on them — proof
// those two models' band rendering is unregressed by this change.
describe("no regression to existing models' band helpers (p-median-us / Ch10 scale)", () => {
  it("assignBand still folds an out-of-range distance into the LAST band (p-median-us-scale bands) — unchanged, pre-existing behavior", () => {
    // p-median-us's own default-scale bands; a distance past every boundary
    // still resolves to the last index exactly as before this task.
    expect(assignBand(5000, [250, 500, 750, 1000])).toBe(3);
  });

  it("assignBand still folds an out-of-range distance into the LAST band (Ch10/JADE-scale bands) — unchanged, pre-existing behavior", () => {
    // Bands sized like Ch10's/JADE's default [200,400,800,1600]; a distance
    // well past 1600 still resolves to index 3 via the untouched `assignBand`
    // — only the new `assignBandOrOverflow` sibling below changes this.
    expect(assignBand(3219.9609, [200, 400, 800, 1600])).toBe(3);
  });

  it("computeBandCoverage stays exclusive per-band with no overflow row, even when a distance exceeds every boundary", () => {
    // A p-median-us/Ch10-style result never gets a spurious `-1` overflow
    // entry from this function — it silently excludes out-of-range flow from
    // every band (pre-existing behavior, verified unchanged).
    const edges = [
      { distance: 100, flow: 50 },
      { distance: 3219.9609, flow: 50 },
    ];
    const coverage = computeBandCoverage(edges, [200, 400, 800, 1600]);
    expect(coverage.find((b) => b.band === OVERFLOW_BAND)).toBeUndefined();
    expect(coverage).toEqual([
      { band: 200, percent: 50 },
      { band: 400, percent: 0 },
      { band: 800, percent: 0 },
      { band: 1600, percent: 0 },
    ]);
  });
});

describe("assignBandOrOverflow (jade-T14)", () => {
  it("matches assignBand for every in-range distance", () => {
    expect(assignBandOrOverflow(150, [200, 400, 800])).toBe(assignBand(150, [200, 400, 800]));
    expect(assignBandOrOverflow(200, [200, 400, 800])).toBe(assignBand(200, [200, 400, 800]));
  });

  it("returns OVERFLOW_BAND instead of the last band index when distance exceeds every boundary", () => {
    expect(assignBandOrOverflow(2907.302, [200, 400, 800, 1600])).toBe(OVERFLOW_BAND);
    // Contrast with the unchanged assignBand, which folds it into the last band:
    expect(assignBand(2907.302, [200, 400, 800, 1600])).toBe(3);
  });

  it("returns 0 for empty bands", () => {
    expect(assignBandOrOverflow(100, [])).toBe(0);
  });

  it("sorts unsorted band input before assigning", () => {
    expect(assignBandOrOverflow(250, [800, 200, 400])).toBe(1);
  });
});

describe("computeCumulativeBandCoverage (jade-T14)", () => {
  it("returns cumulative percent per boundary — each boundary counts ALL flow at or under it, not just the flow strictly between boundaries", () => {
    const edges = [
      { distance: 100, flow: 50 },
      { distance: 300, flow: 30 },
      { distance: 900, flow: 20 },
    ];
    expect(computeCumulativeBandCoverage(edges, [200, 400, 800])).toEqual([
      { band: 200, percent: 50 }, // <=200: the 100mi edge only
      { band: 400, percent: 80 }, // <=400: 100mi + 300mi edges (cumulative, not just the 300mi one)
      { band: 800, percent: 80 }, // <=800: still just those two
      { band: OVERFLOW_BAND, percent: 20 }, // the 900mi edge is past the last boundary — a separate overflow row, never folded into 800
    ]);
  });

  it("appends a separately labelled overflow row for flow beyond the last boundary, never folded into it", () => {
    // JADE-shaped case: plant->warehouse/warehouse->customer distances up to
    // 2907.302/3219.9609 mi against the default last band of 1600 mi.
    const edges = [
      { distance: 100, flow: 10 },
      { distance: 1600, flow: 75 },
      { distance: 3219.9609, flow: 15 },
    ];
    const coverage = computeCumulativeBandCoverage(edges, [200, 400, 800, 1600]);
    expect(coverage).toEqual([
      { band: 200, percent: 10 },
      { band: 400, percent: 10 },
      { band: 800, percent: 10 },
      { band: 1600, percent: 85 }, // <=1600: 10+75, the overflow edge NOT folded in here
      { band: OVERFLOW_BAND, percent: 15 }, // separately labelled, sums to 100% with the 1600 row
    ]);
    const total = coverage.reduce((sum, b) => (b.band === 1600 || b.band === OVERFLOW_BAND ? sum + b.percent : sum), 0);
    expect(total).toBe(100);
  });

  it("omits the overflow row entirely when nothing exceeds the last boundary", () => {
    const edges = [{ distance: 100, flow: 10 }];
    const coverage = computeCumulativeBandCoverage(edges, [200, 400]);
    expect(coverage.find((b) => b.band === OVERFLOW_BAND)).toBeUndefined();
  });

  it("returns an empty array for empty bands", () => {
    expect(computeCumulativeBandCoverage([{ distance: 100, flow: 50 }], [])).toEqual([]);
  });

  it("returns 0% for every boundary when there are no edges (and no overflow row)", () => {
    expect(computeCumulativeBandCoverage([], [200, 400])).toEqual([
      { band: 200, percent: 0 },
      { band: 400, percent: 0 },
    ]);
  });

  it("sorts unsorted band input before computing", () => {
    const edges = [{ distance: 300, flow: 100 }];
    expect(computeCumulativeBandCoverage(edges, [400, 200])).toEqual([
      { band: 200, percent: 0 },
      { band: 400, percent: 100 },
    ]);
  });
});

// jade-A1 — shared "Distance Band" column formatter (spec §11), built on
// assignBandOrOverflow so labels always match the map's band colors.
describe("bandLabel (jade-A1)", () => {
  it("labels a distance strictly inside a band as 1-indexed 'Band N'", () => {
    expect(bandLabel(150, [200, 400, 800])).toBe("Band 1");
    expect(bandLabel(250, [200, 400, 800])).toBe("Band 2");
    expect(bandLabel(700, [200, 400, 800])).toBe("Band 3");
  });

  it("treats a distance exactly on a boundary as within that (upper-inclusive) band", () => {
    expect(bandLabel(200, [200, 400, 800])).toBe("Band 1");
    expect(bandLabel(400, [200, 400, 800])).toBe("Band 2");
    expect(bandLabel(800, [200, 400, 800])).toBe("Band 3");
  });

  it("labels a distance above the highest boundary as 'Overflow', not the last band", () => {
    expect(bandLabel(2907.302, [200, 400, 800, 1600])).toBe("Overflow");
    expect(bandLabel(801, [200, 400, 800])).toBe("Overflow");
  });

  it("sorts unsorted band input before labeling", () => {
    expect(bandLabel(250, [800, 200, 400])).toBe("Band 2");
  });

  it("returns 'Band 1' for empty bands (matches assignBandOrOverflow's 0 fallback)", () => {
    expect(bandLabel(100, [])).toBe("Band 1");
  });
});

// Workspace fixups bundle (T1, item 5) — unit-aware distance-band range
// labels, built on the same assignBandOrOverflow classification as
// `bandLabel` above.
describe("bandRangeLabel (workspace fixups T1)", () => {
  it("labels each band and the overflow bucket in mi", () => {
    const bands = [200, 400, 800];
    expect(bandRangeLabel(150, bands, "mi")).toBe("≤ 200 mi");
    expect(bandRangeLabel(250, bands, "mi")).toBe("200–400 mi");
    expect(bandRangeLabel(700, bands, "mi")).toBe("400–800 mi");
    expect(bandRangeLabel(801, bands, "mi")).toBe("> 800 mi");
  });

  it("labels each band and the overflow bucket in km", () => {
    const bands = [200, 400, 800];
    expect(bandRangeLabel(150, bands, "km")).toBe("≤ 200 km");
    expect(bandRangeLabel(250, bands, "km")).toBe("200–400 km");
    expect(bandRangeLabel(700, bands, "km")).toBe("400–800 km");
    expect(bandRangeLabel(801, bands, "km")).toBe("> 800 km");
  });

  it("treats a distance exactly on a boundary as within that (upper-inclusive) band — matches assignBandOrOverflow's <= semantics", () => {
    const bands = [200, 400, 800];
    expect(bandRangeLabel(200, bands, "mi")).toBe("≤ 200 mi");
    expect(bandRangeLabel(400, bands, "mi")).toBe("200–400 mi");
    expect(bandRangeLabel(800, bands, "mi")).toBe("400–800 mi");
  });

  it("sorts unsorted band input before classifying and labeling", () => {
    const unsorted = [500, 250, 1000];
    const sorted = [250, 500, 1000];
    for (const distance of [100, 250, 400, 750, 1000, 1500]) {
      expect(bandRangeLabel(distance, unsorted, "mi")).toBe(bandRangeLabel(distance, sorted, "mi"));
    }
    expect(bandRangeLabel(400, unsorted, "mi")).toBe("250–500 mi");
  });

  it("returns 'All distances' for empty bands", () => {
    expect(bandRangeLabel(100, [], "mi")).toBe("All distances");
    expect(bandRangeLabel(100, [], "km")).toBe("All distances");
  });
});
