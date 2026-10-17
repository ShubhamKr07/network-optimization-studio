// T1b (chen-bands-units) — guards that `@/lib/bands` genuinely re-exports the
// shared `@workspace/units` classifier rather than an independently-written
// function that merely behaves the same. Every assertion uses `toBe`
// (reference identity), never `toEqual` — behavioral equality is exactly
// what silently drifts between two implementations of the same rule.
import { describe, it, expect } from "vitest";
import * as studioBands from "@/lib/bands";
import * as sharedUnits from "@workspace/units";

const studioShared = studioBands as unknown as Record<string, unknown>;
const packageShared = sharedUnits as unknown as Record<string, unknown>;

describe("lib/bands is a thin re-export of @workspace/units", () => {
  it.each([
    "OVERFLOW_BAND", "assignBandOrOverflow", "computeCumulativeBandCoverage", "serviceEdgesFor",
    "computeExclusiveBandCoverage", "frozenBandCoverageToExclusive",
  ])(
    "%s is the SAME binding as @workspace/units",
    (name) => {
      expect(studioShared[name]).toBe(packageShared[name]);
    }
  );

  it("bandLabel is the shared classifier itself, merely renamed", () => {
    expect(studioBands.bandLabel).toBe(sharedUnits.bandLabelOrOverflow);
  });

  // SCU-1.1 (spec B1.9) — pins the exclusive helper to the shared classifier
  // BEHAVIOURALLY: a single edge's whole flow must land in exactly the row
  // assignBandOrOverflow names, at every boundary edge case.
  it("computeExclusiveBandCoverage buckets every distance exactly where assignBandOrOverflow does", () => {
    const bands = [200, 400, 800];
    for (const d of [0, 1, 199.9999, 200, 200.0001, 400, 799, 800, 800.0001, 5000]) {
      const rows = sharedUnits.computeExclusiveBandCoverage([{ distance: d, flow: 7 }], bands, 0);
      const idx = sharedUnits.assignBandOrOverflow(d, bands);
      const expectedRow = idx === sharedUnits.OVERFLOW_BAND ? rows.length - 1 : idx;
      rows.forEach((r, i) => expect(r.percent, `distance ${d}, row ${i}`).toBe(i === expectedRow ? 100 : 0));
    }
  });
});
