import { describe, it, expect } from "vitest";
import { twoEchelonInputsSchema } from "../validation/inputs/twoEchelon.js";

describe("twoEchelonInputsSchema", () => {
  it("accepts a valid two-echelon input", () => {
    const result = twoEchelonInputsSchema.safeParse({
      bomRatio: 1.1, distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120,
    });
    expect(result.success).toBe(true);
  });

  it("rejects bomRatio: 0.5 (<=1)", () => {
    const result = twoEchelonInputsSchema.safeParse({
      bomRatio: 0.5, distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing timeLimitSec", () => {
    const result = twoEchelonInputsSchema.safeParse({
      bomRatio: 1.1, distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0,
    });
    expect(result.success).toBe(false);
  });
});

// SCN v0.3 Phase B, task B6.2 — scenario-local network-edit fields for
// two-echelon-gold-au (fast-follow of B1.1/B6.1's addedWarehouses/
// addedMines-shaped fields, mirrors transportLp.test.ts's own coverage
// structure).
const BASE = {
  bomRatio: 1.1, distanceBands: [500, 1000, 1500, 2000, 2600], gap: 0, timeLimitSec: 120,
};

describe("twoEchelonInputsSchema — B6.2 network-edit fields", () => {
  it("defaults addedRefineries/addedCustomers/distanceOverrides to [] when absent (old scenario data)", () => {
    const result = twoEchelonInputsSchema.parse(BASE);
    expect(result.addedRefineries).toEqual([]);
    expect(result.addedCustomers).toEqual([]);
    expect(result.distanceOverrides).toEqual([]);
  });

  it("accepts a valid addedRefineries entry, status required", () => {
    const result = twoEchelonInputsSchema.parse({
      ...BASE,
      addedRefineries: [{ id: "ref-new-1", city: "Kalgoorlie West", state: "WA", lat: -30.8, lng: 121.3, status: "active" }],
    });
    expect(result.addedRefineries).toHaveLength(1);
    expect(result.addedRefineries[0]).toMatchObject({ id: "ref-new-1", city: "Kalgoorlie West", state: "WA", status: "active" });
    // No capacity field anywhere on this shape — this model's manifest
    // declares capacityModes: [].
    expect((result.addedRefineries[0] as Record<string, unknown>).capacity).toBeUndefined();
  });

  it("rejects addedRefineries entry missing status", () => {
    const result = twoEchelonInputsSchema.safeParse({
      ...BASE,
      addedRefineries: [{ id: "ref-new-1", city: "X", state: "WA", lat: -30.8, lng: 121.3 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects addedRefineries entry with empty id", () => {
    const result = twoEchelonInputsSchema.safeParse({
      ...BASE,
      addedRefineries: [{ id: "", city: "X", state: "WA", lat: -30.8, lng: 121.3, status: "active" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects addedRefineries entry with invalid status", () => {
    const result = twoEchelonInputsSchema.safeParse({
      ...BASE,
      addedRefineries: [{ id: "ref-new-1", city: "X", state: "WA", lat: -30.8, lng: 121.3, status: "bogus" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid addedCustomers entry", () => {
    const result = twoEchelonInputsSchema.parse({
      ...BASE,
      addedCustomers: [{ id: "perth", city: "Perth", state: "WA", lat: -31.95, lng: 115.86, demand: 250000 }],
    });
    expect(result.addedCustomers).toHaveLength(1);
    expect(result.addedCustomers[0]).toMatchObject({ id: "perth", city: "Perth", state: "WA", demand: 250000 });
  });

  it("rejects addedCustomers entry with negative demand", () => {
    const result = twoEchelonInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [{ id: "perth", city: "Perth", state: "WA", lat: -31.95, lng: 115.86, demand: -1 }],
    });
    expect(result.success).toBe(false);
  });

  // Bundle 2.2 (B2.2-T1, A3 backend) — addedCustomerSchema gains `status`,
  // mirroring pMedian.ts's own coverage exactly.
  it("defaults an added customer's status to 'active' when omitted (back-compat)", () => {
    const result = twoEchelonInputsSchema.parse({
      ...BASE,
      addedCustomers: [{ id: "perth", city: "Perth", state: "WA", lat: -31.95, lng: 115.86, demand: 250000 }],
    });
    expect(result.addedCustomers[0].status).toBe("active");
  });

  it("accepts an added customer with status:'excluded'", () => {
    const result = twoEchelonInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [
        { id: "perth", city: "Perth", state: "WA", lat: -31.95, lng: 115.86, demand: 250000, status: "excluded" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.addedCustomers[0].status).toBe("excluded");
  });

  it("rejects an added customer with an invalid status value", () => {
    const result = twoEchelonInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [
        { id: "perth", city: "Perth", state: "WA", lat: -31.95, lng: 115.86, demand: 250000, status: "bogus" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid distanceOverrides entry with field name `distance` (not `cost`)", () => {
    const result = twoEchelonInputsSchema.parse({
      ...BASE,
      distanceOverrides: [{ fromId: "kalgoorlie", toId: "cunnamulla", distance: 1234.5 }],
    });
    expect(result.distanceOverrides).toHaveLength(1);
    expect(result.distanceOverrides[0]).toEqual({ fromId: "kalgoorlie", toId: "cunnamulla", distance: 1234.5 });
  });

  it("rejects distanceOverrides entry with empty fromId/toId", () => {
    const result = twoEchelonInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ fromId: "", toId: "cunnamulla", distance: 100 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects distanceOverrides entry with non-positive distance", () => {
    const result = twoEchelonInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ fromId: "kalgoorlie", toId: "cunnamulla", distance: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate (fromId,toId) pairs within distanceOverrides", () => {
    const result = twoEchelonInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [
        { fromId: "kalgoorlie", toId: "cunnamulla", distance: 100 },
        { fromId: "kalgoorlie", toId: "cunnamulla", distance: 200 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("allows the same fromId with different toId (not a duplicate pair)", () => {
    const result = twoEchelonInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [
        { fromId: "kalgoorlie", toId: "cunnamulla", distance: 100 },
        { fromId: "kalgoorlie", toId: "daggar-hills", distance: 200 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("does not reject an old scenario missing all three new keys entirely (rollback-safety shape)", () => {
    const result = twoEchelonInputsSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });
});
