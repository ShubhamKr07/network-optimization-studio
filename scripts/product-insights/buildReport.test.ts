import { describe, it, expect, vi } from "vitest";
import fixture from "./__fixtures__/posthog-response.json";
import { toAggregates, type HogQLResponse } from "./queryPosthog";
import { synthesizeReport } from "./buildReport";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => ({ content: [{ type: "text", text: "# Product Insights\n- rec 1" }] }),
    };
  },
}));

describe("buildReport", () => {
  it("turns a fixture PostHog response into typed aggregates", () => {
    const agg = toAggregates(fixture as HogQLResponse);
    expect(agg.funnelsByModel["p-median-us"].created).toBeGreaterThan(0);
    expect(agg.cacheHitRate).toBeGreaterThanOrEqual(0);
  });

  it("produces markdown with a heading and never leaks a forbidden key", async () => {
    const agg = toAggregates(fixture as HogQLResponse);
    const md = await synthesizeReport(agg, { anthropicApiKey: "sk-test", weekEnding: "2026-09-11" });
    expect(md).toMatch(/^# /m);
    expect(md).not.toMatch(/@|email|demand|capacity/i);
  });
});
