import { describe, it, expect } from "vitest";
import { assignBand, computeBandCoverage, computeAutoBands } from "@/lib/bands";

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
  it("returns cumulative percent coverage per band boundary", () => {
    const edges = [
      { distance: 100, flow: 50 },
      { distance: 300, flow: 30 },
      { distance: 900, flow: 20 },
    ];
    expect(computeBandCoverage(edges, [200, 400, 800])).toEqual([
      { band: 200, percent: 50 },
      { band: 400, percent: 80 },
      { band: 800, percent: 80 },
    ]);
  });

  it("counts distance == boundary as within that band", () => {
    const edges = [{ distance: 200, flow: 100 }];
    expect(computeBandCoverage(edges, [200, 400])).toEqual([
      { band: 200, percent: 100 },
      { band: 400, percent: 100 },
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
