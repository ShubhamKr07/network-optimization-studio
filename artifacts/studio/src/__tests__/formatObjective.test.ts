import { describe, it, expect } from "vitest";
import { formatChenObjective, objectiveModeOfDetails } from "@/lib/formatObjective";

// C4.14 (D14) — the single source of truth for Chen's two mode-dependent
// objective units, shared by ObjectiveBar, CostSummaryTab and Landing.
describe("formatChenObjective", () => {
  it("formats a coverage-mode objective as a percentage (NN.NN %)", () => {
    expect(formatChenObjective(66.6667, "coverage")).toBe("66.67 %");
  });

  it("formats a min_distance-mode objective as demand-km (scientific)", () => {
    expect(formatChenObjective(131645389, "min_distance")).toBe("1.32e+8 demand-km");
  });

  it("returns null for a null/absent mode so callers apply their own default", () => {
    expect(formatChenObjective(29873735731, null)).toBeNull();
    expect(formatChenObjective(29873735731, undefined)).toBeNull();
  });

  it("returns null for an unrecognized mode string", () => {
    expect(formatChenObjective(5, "something-else")).toBeNull();
  });
});

describe("objectiveModeOfDetails", () => {
  it("reads the mode discriminator off an envelope details record", () => {
    expect(objectiveModeOfDetails({ objective: "coverage" })).toBe("coverage");
    expect(objectiveModeOfDetails({ objective: "min_distance" })).toBe("min_distance");
  });

  it("returns null when details is absent, empty, or non-string objective", () => {
    expect(objectiveModeOfDetails(undefined)).toBeNull();
    expect(objectiveModeOfDetails({})).toBeNull();
    expect(objectiveModeOfDetails({ objective: 5 })).toBeNull();
    expect(objectiveModeOfDetails(null)).toBeNull();
  });
});
