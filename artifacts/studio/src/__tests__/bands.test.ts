import { describe, it, expect } from "vitest";
import { assignBand, computeBandCoverage } from "@/lib/bands";

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
