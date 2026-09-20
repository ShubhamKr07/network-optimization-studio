import { describe, it, expect } from "vitest";
import { jadeInputsSchema } from "../jadeInputs.js";

const BASE = {
  p: 2,
  distanceBands: [200, 400, 800, 1600],
  gap: 0,
  timeLimitSec: 120,
};

const FULL_DEMANDS = {
  "product-1": 10,
  "product-2": 20,
  "product-3": 30,
  "product-4": 40,
};

describe("jadeInputsSchema — required fields", () => {
  it("accepts a minimal valid input", () => {
    const result = jadeInputsSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });

  it("rejects missing timeLimitSec (required — NaN here kills every solve)", () => {
    const { timeLimitSec: _drop, ...rest } = BASE;
    const result = jadeInputsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing p", () => {
    const { p: _drop, ...rest } = BASE;
    const result = jadeInputsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing distanceBands", () => {
    const { distanceBands: _drop, ...rest } = BASE;
    const result = jadeInputsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing gap", () => {
    const { gap: _drop, ...rest } = BASE;
    const result = jadeInputsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects p < 1", () => {
    const result = jadeInputsSchema.safeParse({ ...BASE, p: 0 });
    expect(result.success).toBe(false);
  });

  it("defaults every override/added-entity array family to [] when absent", () => {
    const result = jadeInputsSchema.parse(BASE);
    expect(result.warehouseOverrides).toEqual([]);
    expect(result.customerOverrides).toEqual([]);
    expect(result.plantProductCapability).toEqual([]);
    expect(result.addedPlants).toEqual([]);
    expect(result.addedWarehouses).toEqual([]);
    expect(result.addedCustomers).toEqual([]);
    expect(result.distanceOverrides).toEqual([]);
  });
});

describe("jadeInputsSchema — distanceBands (one or more strictly-ascending positive ints)", () => {
  it("rejects an empty band list", () => {
    const result = jadeInputsSchema.safeParse({ ...BASE, distanceBands: [] });
    expect(result.success).toBe(false);
  });

  it("accepts a single band", () => {
    const result = jadeInputsSchema.safeParse({ ...BASE, distanceBands: [200] });
    expect(result.success).toBe(true);
  });

  it("accepts 3 strictly-ascending positive ints", () => {
    const result = jadeInputsSchema.safeParse({ ...BASE, distanceBands: [200, 400, 800] });
    expect(result.success).toBe(true);
  });

  it("accepts 5 strictly-ascending positive ints", () => {
    const result = jadeInputsSchema.safeParse({ ...BASE, distanceBands: [200, 400, 800, 1600, 2000] });
    expect(result.success).toBe(true);
  });

  it("rejects non-ascending bands, with the new free-band message", () => {
    const result = jadeInputsSchema.safeParse({ ...BASE, distanceBands: [200, 800, 400, 1600] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "distanceBands must be one or more strictly-ascending positive integers",
      );
    }
  });

  it("rejects non-strictly-ascending bands (a repeated value)", () => {
    const result = jadeInputsSchema.safeParse({ ...BASE, distanceBands: [200, 400, 400, 1600] });
    expect(result.success).toBe(false);
  });

  it("rejects a non-positive band", () => {
    const result = jadeInputsSchema.safeParse({ ...BASE, distanceBands: [0, 400, 800, 1600] });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 4 strictly-ascending positive ints", () => {
    const result = jadeInputsSchema.safeParse({ ...BASE, distanceBands: [200, 400, 800, 1600] });
    expect(result.success).toBe(true);
  });
});

describe("jadeInputsSchema — warehouseOverrides (no capacity concept)", () => {
  it("accepts a valid warehouseOverrides entry", () => {
    const result = jadeInputsSchema.parse({
      ...BASE,
      warehouseOverrides: [{ id: "wh-11", status: "forced_open" }],
    });
    expect(result.warehouseOverrides).toEqual([{ id: "wh-11", status: "forced_open" }]);
  });

  it("rejects an invalid status", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      warehouseOverrides: [{ id: "wh-11", status: "bogus" }],
    });
    expect(result.success).toBe(false);
  });

  it("silently strips an unexpected capacity field (no capacity concept in this model)", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      warehouseOverrides: [{ id: "wh-11", status: "active", capacity: 5000 }],
    });
    expect(result.success).toBe(true);
    expect(
      result.success && (result.data.warehouseOverrides[0] as Record<string, unknown>).capacity,
    ).toBeUndefined();
  });
});

describe("jadeInputsSchema — customerOverrides (sparse per-product demand override)", () => {
  it("accepts a sparse demands override (a subset of product ids)", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      customerOverrides: [{ id: "customer-1", demands: { "product-1": 500 }, status: "active" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an override with no demands at all (status-only)", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      customerOverrides: [{ id: "customer-1", status: "excluded" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative demand value", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      customerOverrides: [{ id: "customer-1", demands: { "product-1": -1 }, status: "active" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid status", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      customerOverrides: [{ id: "customer-1", status: "bogus" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("jadeInputsSchema — plantProductCapability (pair-unique)", () => {
  it("accepts a valid capability toggle", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      plantProductCapability: [{ plantId: "plant-1", productId: "product-2", enabled: false }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a duplicate (plantId, productId) pair", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      plantProductCapability: [
        { plantId: "plant-1", productId: "product-2", enabled: false },
        { plantId: "plant-1", productId: "product-2", enabled: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("allows the same plantId with a different productId (not a duplicate pair)", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      plantProductCapability: [
        { plantId: "plant-1", productId: "product-2", enabled: false },
        { plantId: "plant-1", productId: "product-3", enabled: true },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("jadeInputsSchema — addedPlants (no status/capacity concept)", () => {
  it("accepts a valid addedPlants entry", () => {
    const result = jadeInputsSchema.parse({
      ...BASE,
      addedPlants: [{ id: "plant-new-1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81 }],
    });
    expect(result.addedPlants).toHaveLength(1);
    expect((result.addedPlants[0] as Record<string, unknown>).status).toBeUndefined();
  });

  it("rejects an addedPlants entry with an empty id", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      addedPlants: [{ id: "", city: "Reno", state: "NV", lat: 39.53, lng: -119.81 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts an addedPlants entry with a displayCode", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      addedPlants: [{ id: "plant-new-1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, displayCode: "PL-A1" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("jadeInputsSchema — addedWarehouses (status required, no capacity concept)", () => {
  it("accepts a valid addedWarehouses entry", () => {
    const result = jadeInputsSchema.parse({
      ...BASE,
      addedWarehouses: [{ id: "wh-new-1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" }],
    });
    expect(result.addedWarehouses).toHaveLength(1);
    expect((result.addedWarehouses[0] as Record<string, unknown>).capacity).toBeUndefined();
  });

  it("rejects an addedWarehouses entry missing status", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      addedWarehouses: [{ id: "wh-new-1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an addedWarehouses entry with an invalid status", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      addedWarehouses: [{ id: "wh-new-1", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "bogus" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("jadeInputsSchema — addedCustomers (demands must carry all 4 product ids)", () => {
  it("accepts a valid addedCustomers entry with all 4 product keys", () => {
    const result = jadeInputsSchema.parse({
      ...BASE,
      addedCustomers: [
        { id: "customer-new-1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demands: FULL_DEMANDS },
      ],
    });
    expect(result.addedCustomers).toHaveLength(1);
    expect(result.addedCustomers[0].demands).toEqual(FULL_DEMANDS);
  });

  it("rejects an addedCustomers entry missing a product key (product-4 absent)", () => {
    const { "product-4": _drop, ...incomplete } = FULL_DEMANDS;
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [
        { id: "customer-new-1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demands: incomplete },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an addedCustomers entry with a negative demand value", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [
        {
          id: "customer-new-1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77,
          demands: { ...FULL_DEMANDS, "product-1": -1 },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("defaults status to 'active' when omitted", () => {
    const result = jadeInputsSchema.parse({
      ...BASE,
      addedCustomers: [
        { id: "customer-new-1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, demands: FULL_DEMANDS },
      ],
    });
    expect(result.addedCustomers[0].status).toBe("active");
  });

  it("accepts status:'excluded'", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      addedCustomers: [
        {
          id: "customer-new-1", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77,
          demands: FULL_DEMANDS, status: "excluded",
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("jadeInputsSchema — distanceOverrides (explicit leg, pair-unique per (leg,fromId,toId))", () => {
  it("accepts a valid plant_to_warehouse override", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 123.4 }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid warehouse_to_customer override", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ leg: "warehouse_to_customer", fromId: "wh-11", toId: "customer-1", distance: 50 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an entry missing leg", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ fromId: "plant-1", toId: "wh-11", distance: 123.4 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an entry with an invalid leg value", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ leg: "bogus_leg", fromId: "plant-1", toId: "wh-11", distance: 123.4 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative distance", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: -1 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts distance: 0 (non-negative, not strictly positive)", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 0 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a duplicate (leg, fromId, toId) triple", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [
        { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 100 },
        { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 200 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("allows the same (fromId, toId) pair on two different legs (not a duplicate)", () => {
    // Contrived (real ids wouldn't collide across roles) but exercises that
    // `leg` genuinely participates in the uniqueness key.
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [
        { leg: "plant_to_warehouse", fromId: "x", toId: "y", distance: 100 },
        { leg: "warehouse_to_customer", fromId: "x", toId: "y", distance: 200 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a row with estimated:true", () => {
    const result = jadeInputsSchema.safeParse({
      ...BASE,
      distanceOverrides: [
        { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-11", distance: 123.4, estimated: true },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.distanceOverrides[0].estimated).toBe(true);
  });
});

describe("jadeInputsSchema — rollback-safety shape (unknown keys strip, not reject)", () => {
  it("does not reject an old/foreign scenario carrying an unrelated extra key", () => {
    const result = jadeInputsSchema.safeParse({ ...BASE, someFutureField: "x" });
    expect(result.success).toBe(true);
  });
});
