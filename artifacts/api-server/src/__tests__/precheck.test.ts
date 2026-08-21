import { describe, it, expect } from "vitest";
import { precheckPMedianInputs, type PrecheckDataset } from "../services/precheck.js";
import type { PMedianInputs } from "../validation/inputs/pMedian.js";

// Small fake dataset (not the real 26/200-row p-median-us dataset) — the
// whole point of B2.1's "take the dataset as a parameter" design is that
// precheck logic is testable without the real dataset. WAREHOUSES/CUSTOMERS
// coverage against the real dataset is exercised at the route level
// (routes.test.ts), which uses the real default.
const DATASET: PrecheckDataset = {
  warehouses: [{ id: "WH-A" }, { id: "WH-B" }],
  customers: [{ id: "C-1" }, { id: "C-2" }, { id: "C-3" }],
};

const BASE: PMedianInputs = {
  p: 1,
  capacityMode: "none",
  distanceBands: [100, 300, 600],
  gap: 0.01,
  timeLimitSec: 60,
  warehouseOverrides: [],
  customerOverrides: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

describe("precheckPMedianInputs — B2.1 semantic precheck", () => {
  describe("(a) completeness", () => {
    it("passes when an added warehouse has overrides to every active customer", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
        distanceOverrides: [
          { fromId: "WH-09", toId: "C-1", distance: 10 },
          { fromId: "WH-09", toId: "C-2", distance: 20 },
          { fromId: "WH-09", toId: "C-3", distance: 30 },
        ],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("produces a structured error listing exactly which customers are missing distances", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
        distanceOverrides: [{ fromId: "WH-09", toId: "C-1", distance: 10 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "WH-09 missing distances to 2 customers: C-2, C-3",
      });
    });

    it("an excluded base customer's missing distance does NOT trigger a completeness error", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
        customerOverrides: [{ id: "C-3", status: "excluded" }],
        distanceOverrides: [
          { fromId: "WH-09", toId: "C-1", distance: 10 },
          { fromId: "WH-09", toId: "C-2", distance: 20 },
        ],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("an inactive added warehouse is not required to have distances (it's not active)", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "inactive" }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(true);
    });

    it("a base warehouse requires a distance to an added active customer (vice-versa direction)", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedCustomers: [{ id: "C-NEW", city: "Fresno", lat: 36.7, lng: -119.7, demand: 500 }],
        distanceOverrides: [{ fromId: "WH-A", toId: "C-NEW", distance: 15 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      // WH-B has no override to C-NEW — must be flagged.
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "completeness",
        message: "WH-B missing distances to 1 customer: C-NEW",
      });
      // WH-A is fully covered — must not be flagged.
      expect(result.errors.some((e) => e.message.startsWith("WH-A"))).toBe(false);
    });
  });

  describe("(b) ID collision", () => {
    it("rejects an added warehouse reusing a real base-dataset ID", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-A", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added warehouse id 'WH-A' collides with an existing base-dataset warehouse id",
      });
    });

    it("rejects two added warehouses sharing the same ID", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [
          { id: "WH-DUP", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" },
          { id: "WH-DUP", city: "Boise", state: "ID", lat: 43.6, lng: -116.2, status: "active" },
        ],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added warehouse id 'WH-DUP' is duplicated across addedWarehouses",
      });
    });

    it("rejects an added customer reusing a real base-dataset ID", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedCustomers: [{ id: "C-1", city: "Fresno", lat: 36.7, lng: -119.7, demand: 500 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added customer id 'C-1' collides with an existing base-dataset customer id",
      });
    });

    it("rejects two added customers sharing the same ID", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedCustomers: [
          { id: "C-DUP", city: "Fresno", lat: 36.7, lng: -119.7, demand: 500 },
          { id: "C-DUP", city: "Sacramento", lat: 38.6, lng: -121.5, demand: 300 },
        ],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "id_collision",
        message: "Added customer id 'C-DUP' is duplicated across addedCustomers",
      });
    });
  });

  describe("(c) reference integrity", () => {
    it("rejects a distanceOverrides pair whose fromId is unknown", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        distanceOverrides: [{ fromId: "WH-GHOST", toId: "C-1", distance: 50 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "reference_integrity",
        message:
          "distanceOverrides fromId 'WH-GHOST' does not reference a known warehouse (base dataset or this scenario's added warehouses)",
      });
    });

    it("rejects a distanceOverrides pair whose toId is unknown", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        distanceOverrides: [{ fromId: "WH-A", toId: "C-GHOST", distance: 50 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual({
        code: "reference_integrity",
        message:
          "distanceOverrides toId 'C-GHOST' does not reference a known customer (base dataset or this scenario's added customers)",
      });
    });

    it("rejects a pair using a city name instead of a stable ID (not silently misinterpreted)", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        distanceOverrides: [{ fromId: "Springfield", toId: "C-1", distance: 50 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(true);
    });

    it("rejects a backwards pair (fromId is a customer id, toId is a warehouse id)", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        distanceOverrides: [{ fromId: "C-1", toId: "WH-A", distance: 50 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(true);
    });

    it("accepts a distanceOverrides pair referencing this scenario's own added entities", () => {
      const inputs: PMedianInputs = {
        ...BASE,
        addedWarehouses: [{ id: "WH-09", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" }],
        addedCustomers: [{ id: "C-NEW", city: "Fresno", lat: 36.7, lng: -119.7, demand: 500 }],
        distanceOverrides: [{ fromId: "WH-09", toId: "C-NEW", distance: 5 }],
      };
      const result = precheckPMedianInputs(inputs, DATASET);
      expect(result.errors.some((e) => e.code === "reference_integrity")).toBe(false);
    });
  });

  it("returns ok:true with no errors for a scenario with no network edits at all", () => {
    const result = precheckPMedianInputs(BASE, DATASET);
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("defaults to the real p-median-us dataset when no dataset argument is given", () => {
    // Any real base-dataset warehouse id (ALN, Allentown PA) collides.
    const inputs: PMedianInputs = {
      ...BASE,
      addedWarehouses: [{ id: "ALN", city: "Allentown", state: "PA", lat: 40.6, lng: -75.5, status: "active" }],
    };
    const result = precheckPMedianInputs(inputs);
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      code: "id_collision",
      message: "Added warehouse id 'ALN' collides with an existing base-dataset warehouse id",
    });
  });
});
