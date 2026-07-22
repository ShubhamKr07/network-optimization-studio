import { describe, it, expect } from "vitest";
import { validateInputsForModel } from "../validation/inputs/index.js";

const validPMedianInputs = {
  p: 3,
  capacityMode: "none",
  uniformCapacity: null,
  warehouseOverrides: [],
  customerOverrides: [],
  distanceBands: [200, 400, 800, 1600],
  gap: 0,
  timeLimitSec: 120,
};

const validTransportInputs = {
  capacityFactor: 1.0,
  singleSource: false,
  capacityInactive: false,
  distanceBands: [500, 1000, 1500, 2000],
  gap: 0,
  timeLimitSec: 120,
};

describe("validateInputsForModel", () => {
  it("accepts valid p-median-us inputs", () => {
    const result = validateInputsForModel("p-median-us", validPMedianInputs);
    expect(result.success).toBe(true);
  });

  it("accepts valid p-median-brazil inputs", () => {
    const result = validateInputsForModel("p-median-brazil", validPMedianInputs);
    expect(result.success).toBe(true);
  });

  it("accepts valid transport-coal inputs", () => {
    const result = validateInputsForModel("transport-coal", validTransportInputs);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid capacityMode", () => {
    const result = validateInputsForModel("p-median-us", { ...validPMedianInputs, capacityMode: "bogus" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown model_id", () => {
    const result = validateInputsForModel("not-a-real-model", validPMedianInputs);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/Unknown model_id/);
  });

  it("rejects a negative per-warehouse capacity override", () => {
    const result = validateInputsForModel("p-median-us", {
      ...validPMedianInputs,
      warehouseOverrides: [{ id: "SFO", capacity: -5, status: "active" }],
    });
    expect(result.success).toBe(false);
  });
});
