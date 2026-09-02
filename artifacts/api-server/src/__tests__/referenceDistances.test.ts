import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import referenceDistancesRouter from "../routes/referenceDistances.js";
import { buildReferenceDistancePairs, getReferenceDistances } from "../data/referenceDistances.js";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";

// A minimal standalone app — mirrors registry.test.ts's pattern, avoiding
// the full app.ts (and therefore @workspace/db / DATABASE_URL) for a route
// that has no DB dependency at all (unauthenticated, ownerless).
const testApp = express();
testApp.use("/api", referenceDistancesRouter);

describe("data/referenceDistances loader", () => {
  it("builds the full 5200-pair p-median-us matrix at boot", () => {
    const data = getReferenceDistances("p-median-us");
    expect(data).toBeDefined();
    expect(data!.pairs).toHaveLength(5200);
  });

  it("every pair's fromCode/toCode resolves to a real base warehouse/customer id", () => {
    const data = getReferenceDistances("p-median-us")!;
    const warehouseIds = new Set(WAREHOUSES.map((w) => w.id));
    const customerIds = new Set(CUSTOMERS.map((c) => c.id));
    for (const pair of data.pairs) {
      expect(warehouseIds.has(pair.fromId)).toBe(true);
      expect(warehouseIds.has(pair.fromCode)).toBe(true);
      expect(customerIds.has(pair.toId)).toBe(true);
      expect(customerIds.has(pair.toCode)).toBe(true);
      expect(pair.fromCode).toBe(pair.fromId);
      expect(pair.toCode).toBe(pair.toId);
    }
  });

  it("returns undefined for a model with no registered builder", () => {
    expect(getReferenceDistances("transport-coal")).toBeUndefined();
    expect(getReferenceDistances("not-a-real-model")).toBeUndefined();
  });

  it("buildReferenceDistancePairs maps ordinal keys to entity ids via array order", () => {
    const pairs = buildReferenceDistancePairs(
      { "1,1": 42, "2,3": 99 },
      WAREHOUSES,
      CUSTOMERS,
    );
    expect(pairs).toEqual([
      { fromId: WAREHOUSES[0].id, fromCode: WAREHOUSES[0].id, toId: CUSTOMERS[0].id, toCode: CUSTOMERS[0].id, distance: 42 },
      { fromId: WAREHOUSES[1].id, fromCode: WAREHOUSES[1].id, toId: CUSTOMERS[2].id, toCode: CUSTOMERS[2].id, distance: 99 },
    ]);
  });

  it("throws on a deliberately corrupted ordinal (out of range)", () => {
    expect(() =>
      buildReferenceDistancePairs({ "9999,1": 10 }, WAREHOUSES, CUSTOMERS),
    ).toThrow(/unmapped ordinal pair/);
  });

  it("throws on a non-numeric ordinal", () => {
    expect(() =>
      buildReferenceDistancePairs({ "w,c": 10 }, WAREHOUSES, CUSTOMERS),
    ).toThrow(/unmapped ordinal pair/);
  });
});

describe("GET /api/models/:id/reference-distances", () => {
  it("returns 5200 pairs + distanceUnit 'mi' for p-median-us, with explicit ETag + Cache-Control", async () => {
    const res = await request(testApp).get("/api/models/p-median-us/reference-distances");
    expect(res.status).toBe(200);
    expect(res.body.pairs).toHaveLength(5200);
    expect(res.body.distanceUnit).toBe("mi");
    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).toMatch(/^".+"$/);
    expect(res.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
  });

  it("returns 304 with no body when If-None-Match matches the current ETag", async () => {
    const first = await request(testApp).get("/api/models/p-median-us/reference-distances");
    const etag = first.headers.etag;

    const second = await request(testApp)
      .get("/api/models/p-median-us/reference-distances")
      .set("If-None-Match", etag);

    expect(second.status).toBe(304);
    expect(second.text).toBe("");
  });

  it("returns 200 (not 304) when If-None-Match does not match", async () => {
    const res = await request(testApp)
      .get("/api/models/p-median-us/reference-distances")
      .set("If-None-Match", '"stale-etag"');
    expect(res.status).toBe(200);
  });

  it("returns 422 for a known-but-unsupported model (supportsReferenceDistances: false)", async () => {
    const res = await request(testApp).get("/api/models/transport-coal/reference-distances");
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/does not support reference distances/i);
  });

  it("returns 422 for two-echelon-gold-au and p-median-brazil (also unsupported)", async () => {
    const twoEchelon = await request(testApp).get("/api/models/two-echelon-gold-au/reference-distances");
    expect(twoEchelon.status).toBe(422);
    const brazil = await request(testApp).get("/api/models/p-median-brazil/reference-distances");
    expect(brazil.status).toBe(422);
  });

  it("returns 422 for a genuinely unknown model id", async () => {
    const res = await request(testApp).get("/api/models/not-a-real-model/reference-distances");
    expect(res.status).toBe(422);
  });
});
