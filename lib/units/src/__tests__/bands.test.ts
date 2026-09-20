import { describe, it, expect } from "vitest";
import {
  OVERFLOW_BAND, assignBandOrOverflow, bandLabelOrOverflow,
  computeCumulativeBandCoverage, serviceEdgesFor,
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
