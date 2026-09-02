import { describe, it, expect } from "vitest";
import { pMedianInputsSchema } from "../pMedian.js";

const BASE = {
  p: 5,
  capacityMode: "none" as const,
  distanceBands: [100, 300, 600],
  gap: 0.01,
  timeLimitSec: 60,
};

describe("pMedianInputsSchema — B1.1 network-edit fields", () => {
  it("defaults addedWarehouses/addedCustomers/distanceOverrides to [] when absent (old scenario data)", () => {
    const result = pMedianInputsSchema.parse(BASE);
    expect(result.addedWarehouses).toEqual([]);
    expect(result.addedCustomers).toEqual([]);
    expect(result.distanceOverrides).toEqual([]);
  });

  it("accepts a valid addedWarehouses entry", () => {
    const result = pMedianInputsSchema.parse({
      ...BASE,
      addedWarehouses: [
        { id: "WH-NEW-1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, capacity: 5000, status: "active" },
      ],
    });
    expect(result.addedWarehouses).toHaveLength(1);
    expect(result.addedWarehouses[0]).toMatchObject({ id: "WH-NEW-1", city: "Reno", state: "NV" });
  });

  it("accepts an addedWarehouses entry with capacity omitted/null", () => {
    const result = pMedianInputsSchema.parse({
      ...BASE,
      addedWarehouses: [
        { id: "WH-NEW-2", city: "Boise", state: "ID", lat: 43.61, lng: -116.2, status: "inactive" },
      ],
    });
    expect(result.addedWarehouses[0].capacity).toBeUndefined();
  });

  it("rejects addedWarehouses entry with empty id", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      addedWarehouses: [{ id: "", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects addedWarehouses entry with invalid status", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      addedWarehouses: [{ id: "WH-X", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "bogus" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects addedWarehouses entry with non-positive capacity", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      addedWarehouses: [
        { id: "WH-X", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, capacity: 0, status: "active" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid addedCustomers entry", () => {
    const result = pMedianInputsSchema.parse({
      ...BASE,
      addedCustomers: [{ id: "CUST-NEW-1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 1200 }],
    });
    expect(result.addedCustomers).toHaveLength(1);
    expect(result.addedCustomers[0]).toMatchObject({ id: "CUST-NEW-1", city: "Fresno", state: "CA" });
  });

  // Task 26 — addedCustomerSchema gains `state`, matching
  // addedWarehouseSchema's existing required-non-optional shape exactly.
  // Required (not optional/defaulted): this feature is brand new (no
  // production scenarios have addedCustomers populated yet — the frontend
  // that lets students add customers doesn't exist until B5.2), so there's
  // no backward-compatibility scenario data to protect.
  it("rejects addedCustomers entry missing state", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [{ id: "CUST-NEW-1", city: "Fresno", lat: 36.74, lng: -119.77, demand: 1200 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects addedCustomers entry with empty id", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [{ id: "", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 1200 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects addedCustomers entry with negative demand", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [{ id: "CUST-X", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid distanceOverrides entry", () => {
    const result = pMedianInputsSchema.parse({
      ...BASE,
      distanceOverrides: [{ fromId: "ALN", toId: "ATL", distance: 123.4 }],
    });
    expect(result.distanceOverrides).toHaveLength(1);
  });

  it("rejects distanceOverrides entry with empty fromId/toId", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ fromId: "", toId: "ATL", distance: 100 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects distanceOverrides entry with non-positive distance", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ fromId: "ALN", toId: "ATL", distance: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate (fromId,toId) pairs within distanceOverrides", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [
        { fromId: "ALN", toId: "ATL", distance: 100 },
        { fromId: "ALN", toId: "ATL", distance: 200 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("allows the same fromId with different toId (not a duplicate pair)", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [
        { fromId: "ALN", toId: "ATL", distance: 100 },
        { fromId: "ALN", toId: "BOS", distance: 200 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("does not reject an old scenario missing all three new keys entirely (rollback-safety shape)", () => {
    const result = pMedianInputsSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });

  // T1 (Input Map v2) — auto-distance normalizer's `estimated` flag and the
  // added-entity `displayCode` label. All three optional: rows/entities
  // without them still validate (old scenario data, manually-entered rows).
  it("accepts a distanceOverrides row with estimated:true", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ fromId: "ALN", toId: "ATL", distance: 123.4, estimated: true }],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.distanceOverrides[0].estimated).toBe(true);
  });

  it("accepts an added warehouse with a displayCode", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      addedWarehouses: [
        { id: "WH-NEW-1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active", displayCode: "WH-A1" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.addedWarehouses[0].displayCode).toBe("WH-A1");
  });

  it("accepts an added customer with a displayCode", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [
        { id: "CUST-NEW-1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 1200, displayCode: "C-A1" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.addedCustomers[0].displayCode).toBe("C-A1");
  });

  // Bundle 2.2 (B2.2-T1, A3 backend) — addedCustomerSchema gains `status`.
  // Shape-only here (schema doesn't know about the model capability gate —
  // that's buildPayload/precheck.ts's job); this schema is shared by both
  // p-median-us and p-median-brazil, so it must accept `status` regardless
  // of which model actually honors it.
  it("defaults an added customer's status to 'active' when omitted (back-compat)", () => {
    const result = pMedianInputsSchema.parse({
      ...BASE,
      addedCustomers: [{ id: "C-X", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 1200 }],
    });
    expect(result.addedCustomers[0].status).toBe("active");
  });

  it("accepts an added customer with status:'excluded'", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [
        { id: "C-X", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 1200, status: "excluded" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.addedCustomers[0].status).toBe("excluded");
  });

  it("rejects an added customer with an invalid status value", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [
        { id: "C-X", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 1200, status: "bogus" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts rows/entities without estimated/displayCode (all three fields optional)", () => {
    const result = pMedianInputsSchema.safeParse({
      ...BASE,
      addedWarehouses: [{ id: "WH-X", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" }],
      addedCustomers: [{ id: "C-X", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demand: 1200 }],
      distanceOverrides: [{ fromId: "WH-X", toId: "C-X", distance: 100 }],
    });
    expect(result.success).toBe(true);
  });
});
