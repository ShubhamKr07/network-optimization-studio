import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import referenceDistancesRouter from "../routes/referenceDistances.js";
import { buildReferenceDistancePairs, buildMaxCoverageReferenceDistancePairs, getReferenceDistances } from "../data/referenceDistances.js";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import { MAX_COVERAGE_WAREHOUSES, MAX_COVERAGE_CUSTOMERS } from "../data/maxCoverageDataset.js";

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

// Chapter 9 (jade-T10) — JADE's single distances.json mixes both leg
// key-namespaces (plant->warehouse + warehouse->customer), so its reference
// pairs must carry an explicit `leg` discriminator the p-median-us matrix
// never needed.
describe("JADE (two-echelon-jade-us) reference distances", () => {
  it("builds all 2600 pairs (100 inbound + 2500 outbound) at boot, each tagged with the correct leg", () => {
    const data = getReferenceDistances("two-echelon-jade-us");
    expect(data).toBeDefined();
    expect(data!.pairs).toHaveLength(2600);

    const inbound = data!.pairs.filter((p) => p.leg === "plant_to_warehouse");
    const outbound = data!.pairs.filter((p) => p.leg === "warehouse_to_customer");
    expect(inbound).toHaveLength(100);
    expect(outbound).toHaveLength(2500);

    for (const pair of inbound) {
      expect(pair.fromId.startsWith("plant-")).toBe(true);
      expect(pair.toId.startsWith("wh-")).toBe(true);
    }
    for (const pair of outbound) {
      expect(pair.fromId.startsWith("wh-")).toBe(true);
      expect(pair.toId.startsWith("customer-")).toBe(true);
    }
  });

  it("GET /api/models/two-echelon-jade-us/reference-distances returns 2600 pairs + distanceUnit 'mi'", async () => {
    const res = await request(testApp).get("/api/models/two-echelon-jade-us/reference-distances");
    expect(res.status).toBe(200);
    expect(res.body.pairs).toHaveLength(2600);
    expect(res.body.distanceUnit).toBe("mi");
    expect(res.body.pairs.some((p: { leg?: string }) => p.leg === "plant_to_warehouse")).toBe(true);
    expect(res.body.pairs.some((p: { leg?: string }) => p.leg === "warehouse_to_customer")).toBe(true);
    expect(res.headers.etag).toBeDefined();
  });

  it("returns 304 with no body when If-None-Match matches the current ETag", async () => {
    const first = await request(testApp).get("/api/models/two-echelon-jade-us/reference-distances");
    const etag = first.headers.etag;

    const second = await request(testApp)
      .get("/api/models/two-echelon-jade-us/reference-distances")
      .set("If-None-Match", etag);

    expect(second.status).toBe(304);
    expect(second.text).toBe("");
  });
});

// Chapter 4 (max-coverage-us) — this model's distances.json is a flat
// DistanceMap keyed DIRECTLY by entity id ("ALN,C1"), like two-echelon/JADE,
// NOT by ordinal — so its builder splits the key and validates role
// membership (fromId a warehouse, toId a customer), throwing on any
// malformed/unresolved key. CH4O-8 (§2.1): miles, like every other model --
// this matrix IS Chapter 3's integer-mile matrix re-keyed by entity id.
describe("max-coverage-us reference distances", () => {
  it("builds all 5200 pairs (26×200) at boot", () => {
    const data = getReferenceDistances("max-coverage-us");
    expect(data).toBeDefined();
    expect(data!.pairs).toHaveLength(5200);
  });

  it("the loaded matrix carries the golden ALN -> C1 == 374 raw-mile pair", () => {
    // CH4O-8 — 374 is p-median-us's own integer value for this pair; the old
    // golden 601.894656 was exactly 374 * 1.609344, which is why the
    // conversion is lossless in both directions.
    const data = getReferenceDistances("max-coverage-us")!;
    const pair = data.pairs.find((p) => p.fromId === "ALN" && p.toId === "C1");
    expect(pair).toBeDefined();
    expect(pair!.distance).toBe(374);
    expect(pair!.fromCode).toBe("ALN");
    expect(pair!.toCode).toBe("C1");
  });

  it("every pair resolves to a real max-coverage-us warehouse/customer id (strict role membership)", () => {
    const data = getReferenceDistances("max-coverage-us")!;
    const warehouseIds = new Set(MAX_COVERAGE_WAREHOUSES.map((w) => w.id));
    const customerIds = new Set(MAX_COVERAGE_CUSTOMERS.map((c) => c.id));
    for (const pair of data.pairs) {
      expect(warehouseIds.has(pair.fromId)).toBe(true);
      expect(customerIds.has(pair.toId)).toBe(true);
    }
  });

  it("throws on a malformed key (no comma)", () => {
    expect(() =>
      buildMaxCoverageReferenceDistancePairs({ "ALN": 10 }, MAX_COVERAGE_WAREHOUSES, MAX_COVERAGE_CUSTOMERS),
    ).toThrow(/malformed max-coverage-us distance key/);
  });

  it("throws on an unresolved pair (a customer id in the warehouse slot)", () => {
    expect(() =>
      buildMaxCoverageReferenceDistancePairs({ "C1,C2": 10 }, MAX_COVERAGE_WAREHOUSES, MAX_COVERAGE_CUSTOMERS),
    ).toThrow(/unresolved max-coverage-us pair/);
  });

  it("throws when the full matrix is incomplete (count mismatch)", () => {
    expect(() =>
      buildMaxCoverageReferenceDistancePairs({ "ALN,C1": 374 }, MAX_COVERAGE_WAREHOUSES, MAX_COVERAGE_CUSTOMERS),
    ).toThrow(/expected 5200 max-coverage-us pairs/);
  });

  it("GET /api/models/max-coverage-us/reference-distances returns 5200 pairs + distanceUnit 'mi'", async () => {
    const res = await request(testApp).get("/api/models/max-coverage-us/reference-distances");
    expect(res.status).toBe(200);
    expect(res.body.pairs).toHaveLength(5200);
    expect(res.body.distanceUnit).toBe("mi");
    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).toMatch(/^".+"$/);
  });
});
