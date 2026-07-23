import { describe, it, expect } from "vitest";
import { qualityStatement } from "@/lib/quality";

describe("qualityStatement", () => {
  it("returns null for a non-optimal status", () => {
    expect(qualityStatement("infeasible", 0)).toBeNull();
    expect(qualityStatement("error", 0)).toBeNull();
  });

  it("returns 'Proven optimal' when gap is 0", () => {
    expect(qualityStatement("optimal", 0)).toBe("Proven optimal");
  });

  it("returns the configured-gap statement when gap > 0", () => {
    expect(qualityStatement("optimal", 0.05)).toBe("Within configured gap 5%, limit reached");
  });

  it("formats a fractional percentage with one decimal place", () => {
    expect(qualityStatement("optimal", 0.015)).toBe("Within configured gap 1.5%, limit reached");
  });
});
