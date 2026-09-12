import { describe, it, expect } from "vitest";
import fixture from "./__fixtures__/posthog-response.json";
import { toAggregates, type HogQLResponse } from "./queryPosthog";

describe("toAggregates", () => {
  it("turns a fixture PostHog response into typed aggregates", () => {
    const agg = toAggregates(fixture as HogQLResponse);
    expect(agg.funnelsByModel["p-median-us"].created).toBeGreaterThan(0);
    expect(agg.funnelsByModel["p-median-us"]).toEqual({
      created: 40,
      solveTriggered: 30,
      solveCompleted: 25,
      exported: 10,
    });
    expect(agg.funnelsByModel["transport-coal"]).toEqual({
      created: 12,
      solveTriggered: 9,
      solveCompleted: 7,
      exported: 2,
    });
    expect(agg.failuresByModel).toEqual({ "p-median-us": 3, "transport-coal": 1 });
    expect(agg.rejectionsByModel).toEqual({ "p-median-us": 2, "transport-coal": 0 });
    expect(agg.runtimeP50).toBe(1.8);
    expect(agg.runtimeP95).toBe(6.4);
    expect(agg.cacheHitRate).toBeGreaterThanOrEqual(0);
    expect(agg.cacheHitRate).toBeCloseTo(14 / 39);
    // 8 + 3 stale-resolved / 30 + 9 solve-triggered
    expect(agg.staleResolveRate).toBeCloseTo(11 / 39);
  });

  // Aggregates feed a GitHub Actions log + a committed markdown report — both
  // effectively public. toAggregates must never leak anything beyond the
  // counts/rates it's declared to produce: no emails, no free-text city/name
  // strings, nothing that could re-identify a student.
  it("produces PII-free output — counts and rates only, no emails or free text", () => {
    const agg = toAggregates(fixture as HogQLResponse);
    const serialized = JSON.stringify(agg);

    expect(serialized).not.toMatch(/@/); // no email addresses
    expect(serialized).not.toMatch(
      /San Francisco|St\. Louis|Kansas City|Springfield|Lubbock|Cunnamulla|Daggar Hills|Kalgoorlie/i,
    ); // no dataset city/place names
    expect(serialized).not.toMatch(/[A-Za-z]{4,}\s+[A-Za-z]{4,}\s+[A-Za-z]{4,}/); // no free-text prose

    // Every leaf value in the aggregate object is a finite number (a count
    // or a rate) — never a string, which is the structural guarantee behind
    // the assertions above.
    const walk = (value: unknown): void => {
      if (typeof value === "number") {
        expect(Number.isFinite(value)).toBe(true);
        return;
      }
      if (value && typeof value === "object") {
        for (const v of Object.values(value)) walk(v);
        return;
      }
      throw new Error(`unexpected non-numeric leaf value: ${JSON.stringify(value)}`);
    };
    walk(agg);
  });
});
