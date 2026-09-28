import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app.js";

describe("GET /api/dataset", () => {
  it("defaults to the p-median-us dataset (26 warehouses, 200 customers) when modelId is omitted", async () => {
    const res = await request(app).get("/api/dataset");
    expect(res.status).toBe(200);
    expect(res.body.warehouses).toHaveLength(26);
    expect(res.body.customers).toHaveLength(200);
  });

  it("returns the transport-coal dataset (mines as warehouses, stations as customers) when modelId=transport-coal", async () => {
    const res = await request(app).get("/api/dataset?modelId=transport-coal");
    expect(res.status).toBe(200);
    expect(res.body.warehouses).toHaveLength(4);
    expect(res.body.customers).toHaveLength(15);
    const ky = res.body.warehouses.find((w: { id: string }) => w.id === "KY");
    expect(ky).toMatchObject({ id: "KY", city: "Pikeville", state: "KY", lat: 37.54, lng: -82.75 });
    const chi = res.body.customers.find((c: { id: string }) => c.id === "CHI");
    expect(chi).toMatchObject({ id: "CHI", city: "Chicago", state: "IL", demand: 6000000 });
  });

  it("returns the p-median-brazil dataset (warehouses + regions-as-customers, city=name/state=id) when modelId=p-median-brazil", async () => {
    const res = await request(app).get("/api/dataset?modelId=p-median-brazil");
    expect(res.status).toBe(200);
    expect(res.body.warehouses).toHaveLength(25);
    expect(res.body.customers).toHaveLength(25);
    const anp = res.body.warehouses.find((w: { id: string }) => w.id === "ANP");
    expect(anp).toMatchObject({ id: "ANP", city: "Anápolis", state: "GO", lat: -16.32, lng: -48.96 });
    const sp = res.body.customers.find((c: { id: string }) => c.id === "SP");
    expect(sp).toMatchObject({ id: "SP", city: "São Paulo Region", state: "SP", lat: -23.53, lng: -46.63, demand: 29029226 });
  });

  // C4.4 — Chapter 4 (max-coverage-us), US single-echelon coverage/
  // min-distance model. 26 candidate warehouses (id-keyed record-map, slug
  // ids like "ALN" — MIG-4: reuses Chapter 3's own facility list), 200
  // customers ("C<n>", id/city/lat/lng/demand). No plant/product echelon, so
  // warehouses/customers is the full response.
  it("returns the max-coverage-us dataset (26 warehouses / 200 customers) when modelId=max-coverage-us", async () => {
    const res = await request(app).get("/api/dataset?modelId=max-coverage-us");
    expect(res.status).toBe(200);
    expect(res.body.warehouses).toHaveLength(26);
    expect(res.body.customers).toHaveLength(200);
    const aln = res.body.warehouses.find((w: { id: string }) => w.id === "ALN");
    expect(aln).toMatchObject({ id: "ALN", city: "Allentown", lat: 40.602812, lng: -75.470433 });
    const c1 = res.body.customers.find((c: { id: string }) => c.id === "C1");
    expect(c1).toMatchObject({ id: "C1", city: "Akron", demand: 205375 });
  });

  it("returns 400 for an unknown modelId", async () => {
    const res = await request(app).get("/api/dataset?modelId=not-a-real-model");
    expect(res.status).toBe(400);
  });

  // Chapter 9 (jade-T10) — JADE's dataset response gains a plant echelon +
  // product axis + the base plant×product capability matrix, alongside the
  // existing warehouses/customers shape every other model already returns.
  it("returns the two-echelon-jade-us dataset (4 plants / 4 products / 25 warehouses / 100 customers / 16 capability cells) when modelId=two-echelon-jade-us", async () => {
    const res = await request(app).get("/api/dataset?modelId=two-echelon-jade-us");
    expect(res.status).toBe(200);
    expect(res.body.plants).toHaveLength(4);
    expect(res.body.products).toHaveLength(4);
    expect(res.body.warehouses).toHaveLength(25);
    expect(res.body.customers).toHaveLength(100);
    expect(res.body.plantProductCapabilities).toHaveLength(16);

    const plant1 = res.body.plants.find((p: { id: string }) => p.id === "plant-1");
    expect(plant1).toMatchObject({ id: "plant-1", sourceId: 1, name: expect.any(String), city: expect.any(String), state: expect.any(String) });

    const wh11 = res.body.warehouses.find((w: { id: string }) => w.id === "wh-11");
    expect(wh11).toMatchObject({ id: "wh-11", sourceId: 11, name: expect.any(String) });

    const customer1 = res.body.customers.find((c: { id: string }) => c.id === "customer-1");
    expect(customer1).toMatchObject({ id: "customer-1", sourceId: 1, name: expect.any(String) });
    expect(customer1.demands).toBeDefined();
    expect(typeof customer1.demands["product-1"]).toBe("number");
    expect(customer1.demand).toBeCloseTo(
      Object.values(customer1.demands as Record<string, number>).reduce((a, b) => a + b, 0),
      6,
    );

    const cap = res.body.plantProductCapabilities.find(
      (c: { plantId: string; productId: string }) => c.plantId === "plant-1" && c.productId === "product-1",
    );
    expect(cap).toMatchObject({ plantId: "plant-1", productId: "product-1", capacity: expect.any(Number) });
  });
});
