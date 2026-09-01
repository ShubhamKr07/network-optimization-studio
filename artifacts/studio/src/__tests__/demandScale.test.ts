import { describe, it, expect } from "vitest";
import { demandRadius, DEMAND_REF, R_MAX, R_MIN } from "@/components/workspace/map/types";

describe("demandRadius (fixed-domain demand scale, shared by EntityMarkers + MapLegend)", () => {
  it("is strictly increasing on (0, DEMAND_REF] above the R_MIN floor", () => {
    // Below ~1124 demand, sqrt scaling clamps to the R_MIN=3 visibility
    // floor for every value equally (that's the floor's whole point) — so
    // "strictly increasing" only holds once the curve has risen past it.
    const samples = [1200, 2000, 5000, 10000, 15000, 20000, 25000, DEMAND_REF];
    for (let i = 1; i < samples.length; i++) {
      expect(demandRadius(samples[i])).toBeGreaterThan(demandRadius(samples[i - 1]));
    }
  });

  it("clamps to the R_MIN floor for small demand values (below the floor threshold)", () => {
    expect(demandRadius(1)).toBe(R_MIN);
    expect(demandRadius(500)).toBe(R_MIN);
  });

  it("equals R_MAX exactly at DEMAND_REF, and stays clamped there beyond it", () => {
    expect(demandRadius(DEMAND_REF)).toBe(R_MAX);
    expect(demandRadius(DEMAND_REF * 3)).toBe(R_MAX);
  });

  it("clamps at R_MIN for zero or negative demand (visibility floor)", () => {
    expect(demandRadius(0)).toBe(R_MIN);
    expect(demandRadius(-1000)).toBe(R_MIN);
  });

  it("the three legend reference bubbles (5k/15k/30k) map to distinct, increasing radii", () => {
    const r5k = demandRadius(5000);
    const r15k = demandRadius(15000);
    const r30k = demandRadius(30000);
    expect(r5k).toBeLessThan(r15k);
    expect(r15k).toBeLessThan(r30k);
    expect(r30k).toBe(R_MAX);
  });
});
