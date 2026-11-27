import { describe, it, expect } from "vitest";
import { chicagoToday, presetRange, weekly, rateOrDash, heatBins, delta, cacheShare } from "@/lib/adminMetrics";

describe("adminMetrics", () => {
  it("chicagoToday uses Chicago, not UTC", () => expect(chicagoToday(new Date("2026-11-11T05:30:00Z"))).toBe("2026-11-10"));
  it("presetRange(30) ends today and spans 30 days", () =>
    expect(presetRange(30, new Date("2026-11-27T18:00:00Z"))).toEqual({ from: "2026-10-29", to: "2026-11-27" }));
  it("weekly sums counts Monday-first and keeps n", () => {
    const w = weekly([{ date: "2026-11-09", n: 3, k: 1 }, { date: "2026-11-15", n: 2, k: 2 }, { date: "2026-11-16", n: 4, k: 4 }], ["n", "k"]);
    expect(w).toEqual([{ weekStart: "2026-11-09", n: 5, k: 3 }, { weekStart: "2026-11-16", n: 4, k: 4 }]);
  });
  it("rateOrDash hides rates under n = 5", () => { expect(rateOrDash(2, 4)).toBeNull(); expect(rateOrDash(3, 5)).toBe(0.6); });
  it("heatBins: 0 → -1, others into 5 quantile steps", () => expect(heatBins([0, 1, 2, 3, 4, 5, 100])).toEqual([-1, 0, 1, 2, 3, 4, 4]));
  it("heatBins: all zero stays empty, ties share a bin", () => {
    expect(heatBins([0, 0])).toEqual([-1, -1]);
    expect(heatBins([7, 7, 7])).toEqual([0, 0, 0]);
  });
  it("cacheShare is a share of all input-side tokens (input excludes cache reads), never over 100%", () => {
    expect(cacheShare({ input: 1000, output: 0, cacheRead: 6000, cacheWrite: 0 })).toBeCloseTo(6000 / 7000);
    expect(cacheShare({ input: 0, output: 5, cacheRead: 0, cacheWrite: 0 })).toBe(0);
  });
  it("delta: percent and points, null without a base", () => { expect(delta(110, 100)).toBeCloseTo(10); expect(delta(5, 0)).toBeNull(); });
});
