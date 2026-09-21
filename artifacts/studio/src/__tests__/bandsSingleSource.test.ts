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
  it.each(["OVERFLOW_BAND", "assignBandOrOverflow", "computeCumulativeBandCoverage", "serviceEdgesFor"])(
    "%s is the SAME binding as @workspace/units",
    (name) => {
      expect(studioShared[name]).toBe(packageShared[name]);
    }
  );

  it("bandLabel is the shared classifier itself, merely renamed", () => {
    expect(studioBands.bandLabel).toBe(sharedUnits.bandLabelOrOverflow);
  });
});
