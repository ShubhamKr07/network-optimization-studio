import { describe, it, expect } from "vitest";
import { pPresets } from "@/lib/pPresets";

describe("pPresets", () => {
  it("P ± 2 clamped to 1..pMax", () => {
    expect(pPresets(3, 50)).toEqual([1, 2, 3, 4, 5]);
    expect(pPresets(1, 50)).toEqual([1, 2, 3]);
    expect(pPresets(26, 26)).toEqual([24, 25, 26]);
    expect(pPresets(2, 2)).toEqual([1, 2]);
  });
});
