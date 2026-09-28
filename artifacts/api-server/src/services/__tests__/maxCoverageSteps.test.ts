import { describe, it, expect } from "vitest";
import { isStep1Key, nextStepEpoch, initialInputsForInsert } from "../maxCoverageSteps.js";

describe("CH4-7 — Step 1 key classification", () => {
  it("treats step2, stepEpoch and distanceBands as NOT Step 1 fields", () => {
    expect(isStep1Key("step2")).toBe(false);
    expect(isStep1Key("stepEpoch")).toBe(false);
    expect(isStep1Key("distanceBands")).toBe(false);
  });

  it("treats every other inputs key as a Step 1 field", () => {
    for (const key of ["p", "highServiceDistKm", "maxDistKm", "avgServiceDistCapKm",
                       "objective", "gap", "timeLimitSec", "warehouseOverrides",
                       "customerOverrides", "addedWarehouses", "addedCustomers",
                       "distanceOverrides", "capacityMode"]) {
      expect(isStep1Key(key)).toBe(true);
    }
  });
});

describe("CH4-23 — epoch computation from persisted vs candidate", () => {
  const persisted = { p: 3, gap: 0, stepEpoch: 5, distanceBands: [700, 5500], step2: { gap: 0, timeLimitSec: 60 } };

  it("bumps when a Step 1 field changed", () => {
    expect(nextStepEpoch(persisted, { ...persisted, p: 4 })).toBe(6);
  });

  it("does not bump for a step2-only change", () => {
    expect(nextStepEpoch(persisted, { ...persisted, step2: { gap: 0.01, timeLimitSec: 60 } })).toBe(5);
  });

  it("does not bump for a distanceBands-only change", () => {
    expect(nextStepEpoch(persisted, { ...persisted, distanceBands: [700, 1400, 5500] })).toBe(5);
  });

  it("does not bump when step2 and distanceBands both change and nothing else", () => {
    expect(nextStepEpoch(persisted, {
      ...persisted,
      step2: { gap: 0.02, timeLimitSec: 90 },
      distanceBands: [700, 1400, 5500],
    })).toBe(5);
  });

  it("does not bump when nothing changed at all", () => {
    expect(nextStepEpoch(persisted, { ...persisted })).toBe(5);
  });

  // A client-supplied stepEpoch is never an input to the decision: the only
  // thing that moves the epoch is a Step 1 field diff against the PERSISTED
  // row.
  it("ignores a client-supplied stepEpoch entirely", () => {
    expect(nextStepEpoch(persisted, { ...persisted, stepEpoch: 1 })).toBe(5);
    expect(nextStepEpoch(persisted, { ...persisted, stepEpoch: 99 })).toBe(5);
    expect(nextStepEpoch(persisted, { ...persisted, stepEpoch: 1, p: 4 })).toBe(6);
  });

  it("reads an absent persisted epoch as 1", () => {
    expect(nextStepEpoch({ p: 3 }, { p: 4 })).toBe(2);
    expect(nextStepEpoch({ p: 3 }, { p: 3 })).toBe(1);
  });
});

describe("CH4-26 — insert-side epoch initialization", () => {
  it("forces stepEpoch to 1 for a max-coverage-us insert, discarding any supplied value", () => {
    expect(initialInputsForInsert("max-coverage-us", { p: 3, stepEpoch: 77 }).stepEpoch).toBe(1);
    expect(initialInputsForInsert("max-coverage-us", { p: 3 }).stepEpoch).toBe(1);
  });

  it("leaves another model's inputs untouched", () => {
    const inputs = { p: 3, capacityMode: "none" };
    expect(initialInputsForInsert("p-median-us", inputs)).toEqual(inputs);
    expect("stepEpoch" in initialInputsForInsert("p-median-us", inputs)).toBe(false);
  });
});
