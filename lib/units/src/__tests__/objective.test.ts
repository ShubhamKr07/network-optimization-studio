import { describe, it, expect } from "vitest";
import { objectiveDimension, objectiveConverts, convertObjective, deriveMaxCoverageObjective } from "../objective.js";

describe("objectiveDimension — the seven-model contract", () => {
  const cases: Array<[string, string | null, string, boolean]> = [
    ["p-median-us",          null,           "demand-distance",   true],
    ["p-median-brazil",      null,           "demand-distance",   true],
    ["transport-coal",       null,           "flow-distance",     true],
    ["two-echelon-gold-au",  null,           "truckload-distance",true],
    ["two-echelon-jade-us",  null,           "monetary",          false],
    ["max-coverage-us",   "coverage",     "percent",           false],
    ["max-coverage-us",   "min_distance", "demand-distance",   true],
    ["delivery-teaching-us", "base",          "demand-distance",   true],
    ["delivery-teaching-us", "cost_adjusted", "monetary",          false],
  ];
  it.each(cases)("%s / %s -> %s (converts: %s)", (modelId, mode, dim, converts) => {
    expect(objectiveDimension(modelId, mode)).toBe(dim);
    expect(objectiveConverts(objectiveDimension(modelId, mode))).toBe(converts);
  });

  it("an unknown model is opaque and never converts", () => {
    expect(objectiveDimension("not-a-model", null)).toBe("opaque");
    expect(objectiveConverts("opaque")).toBe(false);
  });

  it("converting dimensions scale linearly with distance", () => {
    expect(convertObjective(1000, "demand-distance", "km", "mi")).toBeCloseTo(1000 / 1.609344, 9);
  });

  it("non-converting dimensions pass through untouched", () => {
    expect(convertObjective(66.0639, "percent", "km", "mi")).toBe(66.0639);
    expect(convertObjective(12345, "monetary", "mi", "km")).toBe(12345);
  });
});

describe("deriveMaxCoverageObjective", () => {
  it("returns coverage for a zero floor", () => {
    expect(deriveMaxCoverageObjective(0)).toBe("coverage");
  });

  it("returns min_distance for any positive floor", () => {
    expect(deriveMaxCoverageObjective(1)).toBe("min_distance");
    expect(deriveMaxCoverageObjective(53385024)).toBe("min_distance");
  });

  // The derived value must line up with objectiveDimension's own switch, which
  // keys Chapter 4's unit semantics off this same string. Drift here renders a
  // coverage percent as a demand-distance.
  it("produces modes objectiveDimension already understands", () => {
    expect(objectiveDimension("max-coverage-us", deriveMaxCoverageObjective(0))).toBe("percent");
    expect(objectiveDimension("max-coverage-us", deriveMaxCoverageObjective(100))).toBe("demand-distance");
  });
});
