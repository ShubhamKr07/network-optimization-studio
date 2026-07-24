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

  it("returns 400 for an unknown modelId", async () => {
    const res = await request(app).get("/api/dataset?modelId=not-a-real-model");
    expect(res.status).toBe(400);
  });
});
