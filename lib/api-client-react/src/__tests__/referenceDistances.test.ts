import { describe, it, expect, vi, beforeEach } from "vitest";
import { getReferenceDistances, getDataset } from "../generated/api.js";
import { ApiError } from "../custom-fetch.js";

// Bundle 2.2 (B2.2-T2) — generated-client coverage for the two conditional
// (non-200) responses documented on GET /models/{id}/reference-distances:
// 304 (If-None-Match matched) and 422 (known-but-unsupported model). The
// generated getReferenceDistances() is a thin wrapper over customFetch,
// which throws ApiError for any non-2xx status (304 included, since
// fetch's response.ok is only true for 200-299) — this is the real,
// already-shipped customFetch contract, not something new to this route.
describe("generated getReferenceDistances — 304/422 handling", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws ApiError(304) when the server returns 304 Not Modified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 304 })),
    );

    await expect(getReferenceDistances("p-median-us")).rejects.toMatchObject({
      name: "ApiError",
      status: 304,
    });
    await expect(getReferenceDistances("p-median-us")).rejects.toBeInstanceOf(ApiError);
  });

  it("throws ApiError(422) with the error body when the model is known-but-unsupported", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Model transport-coal does not support reference distances" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const err = await getReferenceDistances("transport-coal").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.data).toMatchObject({ error: expect.stringContaining("does not support reference distances") });
  });

  it("returns the parsed body on 200", async () => {
    const body = { pairs: [{ fromId: "ALN", fromCode: "ALN", toId: "C1", toCode: "C1", distance: 374 }], distanceUnit: "mi" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await getReferenceDistances("p-median-us");
    expect(result).toEqual(body);
  });

  // Chapter 9 (jade-T10) — confirm the generated client's `leg`-carrying
  // shape round-trips through the typed wrapper unchanged; this is the one
  // field a stale/regenerated-wrong client could silently strip.
  it("returns the parsed body on 200, retaining JADE's per-pair leg field", async () => {
    const body = {
      pairs: [
        { fromId: "plant-1", fromCode: "plant-1", toId: "wh-11", toCode: "wh-11", distance: 1808.9, leg: "plant_to_warehouse" },
        { fromId: "wh-11", fromCode: "wh-11", toId: "customer-1", toCode: "customer-1", distance: 372.1, leg: "warehouse_to_customer" },
      ],
      distanceUnit: "mi",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await getReferenceDistances("two-echelon-jade-us");
    expect(result).toEqual(body);
    expect(result.pairs.map((p) => p.leg)).toEqual(["plant_to_warehouse", "warehouse_to_customer"]);
  });
});

// Chapter 9 (jade-T10) — the generated getDataset() client must retain
// JADE's plant echelon/product axis/capability matrix fields, and
// warehouses/customers' new optional name/sourceId/demands fields, without
// any hand-written parsing on the frontend side (the whole point of
// contract-first codegen: T3.5's regenerated Dataset type already declares
// these, this just confirms the runtime wrapper doesn't drop them).
describe("generated getDataset — JADE shape retention", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("retains plants/products/plantProductCapabilities and warehouse/customer name+sourceId+demands", async () => {
    const body = {
      warehouses: [{ id: "wh-11", sourceId: 11, name: "Phoenix", city: "Phoenix", state: "AZ", lat: 33.45, lng: -112.07 }],
      customers: [
        {
          id: "customer-1",
          sourceId: 1,
          name: "Los Angeles",
          city: "Los Angeles",
          state: "CA",
          lat: 33.97,
          lng: -118.25,
          demand: 86877.5,
          demands: { "product-1": 32007.5, "product-2": 22862.5, "product-3": 18290.0, "product-4": 13717.5 },
        },
      ],
      plants: [{ id: "plant-1", sourceId: 1, name: "Plant 1", city: "Ashland", state: "KY", lat: 38.45, lng: -82.67 }],
      products: [{ id: "product-1", sourceId: 1, name: "Product Family 1" }],
      plantProductCapabilities: [{ plantId: "plant-1", productId: "product-1", capacity: 210000000 }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await getDataset({ modelId: "two-echelon-jade-us" });
    expect(result).toEqual(body);
    expect(result.plants).toHaveLength(1);
    expect(result.products).toHaveLength(1);
    expect(result.plantProductCapabilities).toHaveLength(1);
    expect(result.customers[0].demands).toBeDefined();
  });
});
