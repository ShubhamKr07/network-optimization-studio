import { describe, it, expect } from "vitest";
import { deliveryInputsSchema } from "../validation/inputs/delivery.js";
import { buildPayload } from "../solver/pmedian.js";
import { getManifest } from "../registry/modelRegistry.js";

function baseInputs() {
  return {
    p: 3,
    distanceBands: [400, 800, 1200, 1600],
    gap: 0,
    timeLimitSec: 120,
    costAdjustEnabled: false,
    distanceThreshold: 800,
    costPerMile: 1,
    costPerMileOver: 10,
    laneCostOverrides: [],
  };
}

describe("deliveryInputsSchema", () => {
  it("accepts the default payload and defaults laneCostOverrides", () => {
    const parsed = deliveryInputsSchema.parse({ ...baseInputs(), laneCostOverrides: undefined });
    expect(parsed.laneCostOverrides).toEqual([]);
    expect(parsed.costAdjustEnabled).toBe(false);
  });

  it("accepts p at the 33 bound and rejects 34", () => {
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 33 }).success).toBe(true);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 34 }).success).toBe(false);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), p: 0 }).success).toBe(false);
  });

  // The source ships 33 zero-distance self-lanes, seeded into costs.json as
  // zero costs. A schema forbidding a zero OVERRIDE would forbid restoring a
  // value the dataset itself contains.
  it("accepts a zero lane-cost override but rejects a negative or non-finite one", () => {
    const zero = [{ fromId: "W1", toId: "C1", cost: 0 }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: zero }).success).toBe(true);
    const neg = [{ fromId: "W1", toId: "C1", cost: -1 }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: neg }).success).toBe(false);
    const inf = [{ fromId: "W1", toId: "C1", cost: Number.POSITIVE_INFINITY }];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: inf }).success).toBe(false);
  });

  it("rejects a zero or negative rate", () => {
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), costPerMile: 0 }).success).toBe(false);
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), costPerMileOver: -1 }).success).toBe(false);
  });

  it("rejects duplicate (fromId, toId) override pairs", () => {
    const dup = [
      { fromId: "W1", toId: "C1", cost: 5 },
      { fromId: "W1", toId: "C1", cost: 6 },
    ];
    expect(deliveryInputsSchema.safeParse({ ...baseInputs(), laneCostOverrides: dup }).success).toBe(false);
  });
});

describe("buildPayload — delivery-teaching-us", () => {
  it("emits modelType 'delivery' and passes every rate field through", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse({ ...baseInputs(), costAdjustEnabled: true }),
    }) as Record<string, unknown>;

    expect(payload.modelType).toBe("delivery");
    expect(payload.pValue).toBe(3);
    expect(payload.costAdjustEnabled).toBe(true);
    expect(payload.distanceThreshold).toBe(800);
    expect(payload.costPerMile).toBe(1);
    expect(payload.costPerMileOver).toBe(10);
    expect(payload.distanceBands).toEqual([400, 800, 1200, 1600]);
  });

  // The dispatcher's old failure mode was a missing branch landing in
  // solve_pmedian and returning a plausible WRONG answer.
  it("never emits p_median for this model", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse(baseInputs()),
    }) as Record<string, unknown>;
    expect(payload.modelType).not.toBe("p_median");
  });
});

import request from "supertest";
import app from "../app.js";

describe("GET /dataset — delivery-teaching-us", () => {
  it("returns 33 warehouses and 313 customers and no lane tables", async () => {
    const res = await request(app).get("/api/dataset?modelId=delivery-teaching-us").expect(200);
    expect(res.body.warehouses).toHaveLength(33);
    expect(res.body.customers).toHaveLength(313);
    // The 10,329-lane files must never reach the browser through this route.
    expect(res.body.distances).toBeUndefined();
    expect(res.body.costs).toBeUndefined();
  });

  it("carries role-prefixed ids and inline demand", async () => {
    const res = await request(app).get("/api/dataset?modelId=delivery-teaching-us").expect(200);
    expect(res.body.warehouses.every((w: { id: string }) => w.id.startsWith("W"))).toBe(true);
    expect(res.body.customers.every((c: { id: string }) => c.id.startsWith("C"))).toBe(true);
    expect(res.body.customers.reduce((s: number, c: { demand: number }) => s + c.demand, 0))
      .toBe(208829000);
  });
});

describe("delivery-teaching-us manifest/schema parity", () => {
  it("manifest.inputsSchema and deliveryInputsSchema agree on bounds and required keys", () => {
    // inputsSchema is z.record(z.string(), z.unknown()) on the Manifest type
    // (dataset-schema/src/index.ts:263), so a local shape is needed to read it.
    type Bound = { minimum?: number; maximum?: number; exclusiveMinimum?: number };
    type Prop = Bound & { items?: { properties?: Record<string, Bound> } };
    const m = getManifest("delivery-teaching-us")!.inputsSchema as {
      properties: Record<string, Prop>;
      required: string[];
    };
    expect(m.properties.p).toMatchObject({ minimum: 1, maximum: 33 });
    expect(m.properties.laneCostOverrides!.items!.properties!.cost).toMatchObject({ minimum: 0 });   // zero allowed, matches .nonnegative()
    expect(m.properties.costPerMile).toMatchObject({ exclusiveMinimum: 0 });                            // matches .positive()
    expect(new Set(m.required)).toEqual(new Set(["p", "distanceBands", "gap", "timeLimitSec",
      "costAdjustEnabled", "distanceThreshold", "costPerMile", "costPerMileOver"]));
  });

  // Coordinator review (ch5-edit-2b) — the required-only comparison above
  // cannot catch a field that is optional on BOTH sides (every override
  // array has `.default([])`), which is exactly how warehouseOverrides/
  // customerOverrides went missing from the manifest the first time. Compare
  // the FULL property key set so the next optional field added to one side
  // and not the other fails here, not silently.
  it("manifest.inputsSchema declares every deliveryInputsSchema key, and no others", () => {
    const m = getManifest("delivery-teaching-us")!.inputsSchema as {
      properties: Record<string, unknown>;
    };
    expect(new Set(Object.keys(m.properties)))
      .toEqual(new Set(Object.keys(deliveryInputsSchema.shape)));
  });

  // §14 — the model has no capacity; the manifest's published contract must
  // say so as plainly as the Zod schema does (see delivery.ts's
  // warehouseOverrideSchema comment). Mirrors max-coverage-us's identical
  // assertion (manifest.test.ts:381) for the same reason.
  it("warehouseOverrides item declares no capacity, and customerOverrides carries a nonnegative nullable demand", () => {
    type Prop = { minimum?: number; enum?: string[] };
    const m = getManifest("delivery-teaching-us")!.inputsSchema as {
      properties: {
        warehouseOverrides: { items: { properties: Record<string, Prop> } };
        customerOverrides: { items: { properties: Record<string, Prop> } };
      };
    };
    expect(m.properties.warehouseOverrides.items.properties.capacity).toBeUndefined();
    expect(m.properties.warehouseOverrides.items.properties.status.enum)
      .toEqual(["active", "forced_open", "inactive"]);
    expect(m.properties.customerOverrides.items.properties.demand).toMatchObject({ minimum: 0 });
    expect(m.properties.customerOverrides.items.properties.status.enum)
      .toEqual(["active", "excluded"]);
  });
});

// §14 amendment (ch5-edit-2) — editable Warehouses and Customers.
describe("deliveryInputsSchema — editable overrides (section 14)", () => {
  it("accepts warehouse status overrides and defaults them to []", () => {
    const parsed = deliveryInputsSchema.parse(baseInputs());
    expect(parsed.warehouseOverrides).toEqual([]);
    expect(parsed.customerOverrides).toEqual([]);
  });

  it("accepts the three warehouse statuses and rejects anything else", () => {
    for (const status of ["active", "forced_open", "inactive"]) {
      expect(deliveryInputsSchema.safeParse({
        ...baseInputs(), warehouseOverrides: [{ id: "W8", status }],
      }).success).toBe(true);
    }
    expect(deliveryInputsSchema.safeParse({
      ...baseInputs(), warehouseOverrides: [{ id: "W8", status: "closed" }],
    }).success).toBe(false);
  });

  // The model has no capacity. Accepting a field the solver ignores is the
  // persisted-but-ignored trap section 14 exists to avoid.
  it("strips or rejects a capacity on a warehouse override", () => {
    const parsed = deliveryInputsSchema.parse({
      ...baseInputs(), warehouseOverrides: [{ id: "W8", status: "inactive", capacity: 500 }],
    });
    expect((parsed.warehouseOverrides[0] as Record<string, unknown>).capacity).toBeUndefined();
  });

  it("accepts zero demand but rejects negative", () => {
    expect(deliveryInputsSchema.safeParse({
      ...baseInputs(), customerOverrides: [{ id: "C1", demand: 0, status: "active" }],
    }).success).toBe(true);
    expect(deliveryInputsSchema.safeParse({
      ...baseInputs(), customerOverrides: [{ id: "C1", demand: -1, status: "active" }],
    }).success).toBe(false);
  });
});

describe("buildPayload — section 14 wire fields", () => {
  it("derives customerDemands, excludedCustomerIds and warehouseStatuses", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse({
        ...baseInputs(),
        warehouseOverrides: [
          { id: "W6", status: "forced_open" },
          { id: "W8", status: "inactive" },
          { id: "W9", status: "active" },
        ],
        customerOverrides: [
          { id: "C1", demand: 20_000_000, status: "active" },
          { id: "C2", demand: null, status: "excluded" },
        ],
      }),
    }) as Record<string, unknown>;

    expect(payload.customerDemands).toEqual({ C1: 20_000_000 });
    expect(payload.excludedCustomerIds).toEqual(["C2"]);
    // `active` is the default and is NOT sent — only deviations travel.
    expect(payload.warehouseStatuses).toEqual([
      { warehouseId: "W6", status: "forced_open" },
      { warehouseId: "W8", status: "inactive" },
    ]);
  });

  it("keeps the ids role-prefixed with no translation", () => {
    const payload = buildPayload({
      modelId: "delivery-teaching-us",
      inputs: deliveryInputsSchema.parse({
        ...baseInputs(), customerOverrides: [{ id: "C269", demand: 1, status: "active" }],
      }),
    }) as Record<string, Record<string, unknown>>;
    expect(Object.keys(payload.customerDemands)).toEqual(["C269"]);
  });
});
