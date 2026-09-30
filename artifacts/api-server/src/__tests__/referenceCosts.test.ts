import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app.js";
import { buildDeliveryReferenceCostsFrom } from "../data/referenceCosts.js";

describe("GET /models/:id/reference-costs", () => {
  it("serves all 10,329 lanes for delivery-teaching-us", async () => {
    const res = await request(app).get("/api/models/delivery-teaching-us/reference-costs").expect(200);
    expect(res.body.pairs).toHaveLength(10329);
    expect(res.body.distanceUnit).toBe("mi");
    const p = res.body.pairs[0];
    expect(p).toHaveProperty("fromId");
    expect(p).toHaveProperty("toId");
    expect(p).toHaveProperty("cost");
  });

  it("sets an ETag and answers 304 to a matching if-none-match", async () => {
    const first = await request(app).get("/api/models/delivery-teaching-us/reference-costs").expect(200);
    const etag = first.headers.etag;
    expect(etag).toBeTruthy();
    await request(app).get("/api/models/delivery-teaching-us/reference-costs")
      .set("If-None-Match", etag).expect(304);
  });

  it("422s a model without the capability", async () => {
    await request(app).get("/api/models/p-median-us/reference-costs").expect(422);
    await request(app).get("/api/models/not-a-model/reference-costs").expect(422);
  });

  // M-3 (whole-branch review) — `.not.toBe(404)` was a vacuous mount guard:
  // with `router.use(referenceCostsRouter)` commented out, an unmatched
  // `/api/...` path falls through to scenariosRouter's `requireAuth` and
  // returns 401, not 404 — so the old assertion still passed with the mount
  // missing. `.expect(200)` actually proves the route is reachable.
  //
  // The silent failure this test exists for: a route file that is created but
  // never registered in routes/index.ts 404s with no error anywhere.
  it("is reachable through the top-level mount, not merely defined", async () => {
    await request(app).get("/api/models/delivery-teaching-us/reference-costs").expect(200);
  });
});

// Spec 6.4 / 12.4.2: the builder is the ONLY domain check on the lane table
// (PACKAGE_SPECS' DistanceMap accepts zeros and negatives). Exercise it on a
// malformed in-memory table rather than a mutated file, so the test never
// touches the real dataset.
describe("buildDeliveryReferenceCosts — malformed source", () => {
  it.each([
    ["a negative cost",          { "W1,C1": -1 }],
    ["a non-finite cost",        { "W1,C1": Number.NaN }],
    ["an unknown warehouse",     { "W999,C1": 1 }],
    ["a malformed key",          { "W1": 1 }],
    ["a missing lane (count)",   {}],
  ])("throws on %s", (_label, costs) => {
    expect(() => buildDeliveryReferenceCostsFrom(costs as Record<string, number>, costs as Record<string, number>))
      .toThrow(/referenceCosts:/);
  });
});
