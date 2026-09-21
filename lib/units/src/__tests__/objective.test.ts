import { describe, it, expect } from "vitest";
import { objectiveDimension, objectiveConverts, convertObjective } from "../objective.js";

describe("objectiveDimension — the six-model contract", () => {
  const cases: Array<[string, string | null, string, boolean]> = [
    ["p-median-us",          null,           "demand-distance",   true],
    ["p-median-brazil",      null,           "demand-distance",   true],
    ["transport-coal",       null,           "flow-distance",     true],
    ["two-echelon-gold-au",  null,           "truckload-distance",true],
    ["two-echelon-jade-us",  null,           "monetary",          false],
    ["chens-cosmetics-cn",   "coverage",     "percent",           false],
    ["chens-cosmetics-cn",   "min_distance", "demand-distance",   true],
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
