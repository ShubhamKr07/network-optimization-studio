import { describe, it, expect } from "vitest";
import { makeQuintileRadius, QUINTILE_RADII, demandTone } from "@/components/workspace/map/types";

describe("makeQuintileRadius (R2 discrete quintile demand-bubble sizing)", () => {
  it("computes p20/p40/p60/p80 thresholds via linear interpolation between closest ranks (type-7)", () => {
    // n=5, sorted [10,20,30,40,50]: rank(p) = (p/100)*(n-1).
    // p20: rank=0.8 -> 10 + 0.8*(20-10) = 18
    // p40: rank=1.6 -> 20 + 0.6*(30-20) = 26
    // p60: rank=2.4 -> 30 + 0.4*(40-30) = 34
    // p80: rank=3.2 -> 40 + 0.2*(50-40) = 42
    const { thresholds } = makeQuintileRadius([50, 10, 30, 20, 40]); // unsorted input, sorted internally
    expect(thresholds).toEqual([18, 26, 34, 42]);
  });

  it("bucket 0 is lower-inclusive at the p20 boundary (exactly-on-threshold falls to the lower bucket)", () => {
    const { thresholds, bucketOf } = makeQuintileRadius([10, 20, 30, 40, 50]);
    expect(bucketOf(thresholds[0])).toBe(0);
    expect(bucketOf(thresholds[0] + 0.0001)).toBe(1);
  });

  it("buckets 1-4 are each lower-exclusive/upper-inclusive of their own threshold, bucket 4 has no upper bound", () => {
    const { thresholds, bucketOf } = makeQuintileRadius([10, 20, 30, 40, 50]);
    expect(bucketOf(thresholds[1])).toBe(1);
    expect(bucketOf(thresholds[2])).toBe(2);
    expect(bucketOf(thresholds[3])).toBe(3);
    expect(bucketOf(thresholds[3] + 1000)).toBe(4);
  });

  it("radiusOf maps each bucket to its fixed QUINTILE_RADII entry", () => {
    const { radiusOf, bucketOf } = makeQuintileRadius([10, 20, 30, 40, 50]);
    for (const d of [5, 15, 25, 35, 45, 1000]) {
      expect(radiusOf(d)).toBe(QUINTILE_RADII[bucketOf(d)]);
    }
  });

  it("excluded demands still count toward the thresholds — the population is every value passed in, no filtering happens inside this function", () => {
    // Simulates an "excluded" customer with a huge demand skewing the top
    // threshold — makeQuintileRadius has no concept of exclusion at all, so
    // callers are responsible for passing the full population (EntityMarkers
    // does, from its own required `customers` prop).
    const withExcludedIncluded = makeQuintileRadius([10, 20, 30, 40, 500000]);
    const withoutIt = makeQuintileRadius([10, 20, 30, 40]);
    expect(withExcludedIncluded.thresholds[3]).not.toBe(withoutIt.thresholds[3]);
  });

  it("degenerate: fewer than 5 distinct demands does not crash and collapses usedBuckets", () => {
    const scale = makeQuintileRadius([100, 100, 100]);
    expect(() => scale.bucketOf(100)).not.toThrow();
    expect(scale.usedBuckets.length).toBeGreaterThanOrEqual(1);
  });

  it("degenerate: a single customer yields one bucket, one size", () => {
    const scale = makeQuintileRadius([5000]);
    expect(scale.usedBuckets).toEqual([0]);
    expect(scale.radiusOf(5000)).toBe(QUINTILE_RADII[0]);
  });

  it("all-equal-demand population collapses to exactly one used bucket", () => {
    const scale = makeQuintileRadius([200, 200, 200, 200, 200, 200]);
    expect(scale.usedBuckets).toEqual([0]);
  });

  it("empty population does not crash", () => {
    expect(() => makeQuintileRadius([])).not.toThrow();
    const scale = makeQuintileRadius([]);
    expect(scale.usedBuckets).toEqual([]);
  });

  it("a spread population uses multiple distinct buckets with strictly increasing radii", () => {
    const demands = [100, 500, 1000, 2000, 3000, 5000, 8000, 12000, 20000, 50000];
    const scale = makeQuintileRadius(demands);
    expect(scale.usedBuckets.length).toBeGreaterThan(1);
    for (let i = 1; i < scale.usedBuckets.length; i++) {
      expect(QUINTILE_RADII[scale.usedBuckets[i]]).toBeGreaterThan(QUINTILE_RADII[scale.usedBuckets[i - 1]]);
    }
  });
});

describe("demandTone (R1 fast-follow — green demand for ALL models)", () => {
  it("is green for p-median-us", () => {
    expect(demandTone("p-median-us")).toBe("green");
  });

  it("is green for every other model too — the old p-median-us-only branch is gone", () => {
    expect(demandTone("transport-coal")).toBe("green");
    expect(demandTone("two-echelon-gold-au")).toBe("green");
    expect(demandTone("p-median-brazil")).toBe("green");
  });

  it("is green even with no modelId argument at all", () => {
    expect(demandTone()).toBe("green");
  });
});
