import { describe, it, expect } from "vitest";
import fixture from "./__fixtures__/issues-response.json";
import { toIssuesSummary } from "./querySentry";

describe("toIssuesSummary", () => {
  it("keeps only recurring (count>=5) issues, only allowlisted fields, ranked", () => {
    const r = toIssuesSummary(fixture as unknown[]);

    expect(r.issues.every((i) => i.count >= 5)).toBe(true);

    // ranked by count*userCount desc
    expect(r.issues[0].count * r.issues[0].userCount).toBeGreaterThanOrEqual(
      r.issues[1].count * r.issues[1].userCount,
    );

    // never leaks a raw payload / body / email
    expect(JSON.stringify(r)).not.toMatch(/@|password|inputs|cookie/i);

    // exact field set
    expect(Object.keys(r.issues[0]).sort()).toEqual([
      "count",
      "culprit",
      "firstSeen",
      "id",
      "lastSeen",
      "permalink",
      "title",
      "userCount",
    ]);
  });

  it("filters out issues below the MIN_EVENTS threshold entirely", () => {
    const r = toIssuesSummary(fixture as unknown[]);
    // fixture has 6 issues; 2 have count<5 (4 and 2) and must be dropped
    expect(r.issues).toHaveLength(4);
    expect(r.issues.some((i) => i.id === "4501234571")).toBe(false); // count 4
    expect(r.issues.some((i) => i.id === "4501234572")).toBe(false); // count 2
  });

  it("threads generatedFor through untouched", () => {
    const r = toIssuesSummary(fixture as unknown[], "2026-09-13");
    expect(r.generatedFor).toBe("2026-09-13");
  });
});
