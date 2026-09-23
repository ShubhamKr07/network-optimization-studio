import { describe, it, expect } from "vitest";
import { qualityStatement } from "@/lib/quality";

describe("qualityStatement", () => {
  it("returns 'Proven optimal' for optimality_proven", () => {
    expect(qualityStatement("optimality_proven", 0)).toBe("Proven optimal");
    // achievedGap is irrelevant once optimality is proven.
    expect(qualityStatement("optimality_proven", null)).toBe("Proven optimal");
  });

  it("returns the within-gap statement (with %) for gap_limit", () => {
    expect(qualityStatement("gap_limit", 0.05)).toBe("Feasible — within gap (5%)");
  });

  it("formats a fractional achieved-gap percentage with one decimal place", () => {
    expect(qualityStatement("gap_limit", 0.015)).toBe("Feasible — within gap (1.5%)");
  });

  it("returns the bare within-gap statement when achievedGap is unknown", () => {
    expect(qualityStatement("gap_limit", null)).toBe("Feasible — within gap");
    expect(qualityStatement("gap_limit", undefined)).toBe("Feasible — within gap");
  });

  it("returns the limit-reached statements for time_limit / node_limit", () => {
    expect(qualityStatement("time_limit", 0.1)).toBe("Feasible — time limit reached");
    expect(qualityStatement("node_limit", 0.1)).toBe("Feasible — node limit reached");
  });

  it("returns plain strings for infeasible / unbounded termination reasons", () => {
    expect(qualityStatement("infeasible", null)).toBe("Infeasible");
    expect(qualityStatement("unbounded", null)).toBe("Unbounded");
  });

  it("returns null for a null/undefined terminationReason (legacy-unverified, or no incumbent attempted)", () => {
    expect(qualityStatement(null, null)).toBeNull();
    expect(qualityStatement(undefined, undefined)).toBeNull();
  });

  it("returns null for the legacy 'unknown' sentinel", () => {
    expect(qualityStatement("unknown", null)).toBeNull();
  });
});
