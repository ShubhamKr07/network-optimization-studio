import { describe, it, expect } from "vitest";
import { addLocation, cascadeDelete, copyLocation, editLocation, moveLocation, nextFreeId, referencingRows, type SuperInputsLike } from "@/lib/superNetwork";
const inputs = {
  products: [{ id: "k" }], plants: [{ id: "p" }], warehouses: [{ id: "w" }], customers: [{ id: "c" }],
  plantProducts: [{ plantId: "p", productId: "k", capacity: 1, costPerUnit: 0 }],
  demand: [{ customerId: "c", productId: "k", demand: 1 }],
  distanceOverrides: [{ fromId: "p", toId: "w", miles: 1 }, { fromId: "w", toId: "c", miles: 1 }],
};
describe("superNetwork", () => {
  it("counts and removes everything a product references", () => {
    expect(referencingRows(inputs, "products", "k")).toBe(2);
    const n = cascadeDelete(inputs, "products", "k");
    expect(n.products).toEqual([]); expect(n.plantProducts).toEqual([]); expect(n.demand).toEqual([]);
    expect(n.distanceOverrides).toHaveLength(2);
  });
  it("warehouse delete removes overrides on both legs", () => {
    expect(referencingRows(inputs, "warehouses", "w")).toBe(2);
    expect(cascadeDelete(inputs, "warehouses", "w").distanceOverrides).toEqual([]);
  });
  it("plant and customer deletes", () => {
    expect(referencingRows(inputs, "plants", "p")).toBe(2);
    expect(referencingRows(inputs, "customers", "c")).toBe(2);
  });
});

const n = (): SuperInputsLike => ({
  products: [{ id: "K1", name: "K1" }, { id: "K2", name: "K2" }],
  plants: [{ id: "PL-1", lat: 1, lng: 2 }],
  warehouses: [{ id: "WH-1", lat: 3, lng: 4, status: "active" }],
  customers: [{ id: "C-1", lat: 5, lng: 6, status: "active" }, { id: "PL-2", lat: 0, lng: 0, status: "active" }],
  plantProducts: [{ plantId: "PL-1", productId: "K1", capacity: 9, costPerUnit: 1 }],
  demand: [{ customerId: "C-1", productId: "K1", demand: 4 }],
  distanceOverrides: [{ fromId: "PL-1", toId: "WH-1", miles: 3 }, { fromId: "WH-1", toId: "C-1", miles: 2 }],
});

describe("SM2-2 map mutators", () => {
  it("nextFreeId is the first free n across all location tables", () => {
    expect(nextFreeId(n(), "pl")).toBe("PL-3");   // PL-2 is taken by a customer (global uniqueness, §3.3)
    expect(nextFreeId(n(), "wh")).toBe("WH-2");
    expect(nextFreeId(n(), "cs")).toBe("C-2");
  });
  it("addLocation writes the row and only positive demand rows; a plant gets no plantProducts", () => {
    const a = addLocation(n(), "cs", { id: "C-9", city: "", lat: 7, lng: 8, status: "active" }, { K1: 0, K2: 3 });
    expect(a.customers.at(-1)).toEqual({ id: "C-9", lat: 7, lng: 8, status: "active" });
    expect(a.customers.at(-1)).not.toHaveProperty("name");
    expect(a.demand.filter(d => d.customerId === "C-9")).toEqual([{ customerId: "C-9", productId: "K2", demand: 3 }]);
    const p = addLocation(n(), "pl", { id: "PL-3", lat: 1, lng: 1 });
    expect(p.plantProducts).toEqual(n().plantProducts);
  });
  it("editLocation keeps id and coordinates, replaces the customer's demand rows", () => {
    const e = editLocation(n(), "cs", { id: "C-1", lat: 99, lng: 99, status: "excluded" }, { K2: 5 });
    expect(e.customers[0]).toEqual({ id: "C-1", lat: 5, lng: 6, status: "excluded" });
    expect(e.demand).toEqual([{ customerId: "C-1", productId: "K2", demand: 5 }]);
  });
  it("moveLocation writes lat/lng only", () => {
    expect(moveLocation(n(), "wh", "WH-1", 10, 20).warehouses[0]).toEqual({ id: "WH-1", lat: 10, lng: 20, status: "active" });
  });
  it("copy: next id, same text fields (no suffix), 0.05° east, copies demand / plantProducts, never overrides", () => {
    const c = copyLocation(n(), "cs", "C-1");
    expect(c.customers.at(-1)).toEqual({ id: "C-2", lat: 5, lng: 6.05, status: "active" });
    expect(c.customers.at(-1)).not.toHaveProperty("name");
    expect(c.demand).toContainEqual({ customerId: "C-2", productId: "K1", demand: 4 });
    const p = copyLocation(n(), "pl", "PL-1");
    expect(p.plantProducts).toContainEqual({ plantId: "PL-3", productId: "K1", capacity: 9, costPerUnit: 1 });
    expect(p.distanceOverrides).toEqual(n().distanceOverrides);
    expect(copyLocation({ ...n(), warehouses: [{ id: "WH-1", lat: 0, lng: 179.99, status: "active" }] }, "wh", "WH-1").warehouses.at(-1)!.lng).toBe(180);
  });
  it("QFX-7: editing a legacy row that still carries name writes it back without name", () => {
    const legacy = { ...n(), plants: [{ name: "Old", id: "PL-1", city: "Ashland", lat: 1, lng: 2 }] };
    const e = editLocation(legacy, "pl", { id: "PL-1", city: "Ashland", lat: 0, lng: 0 });
    expect(e.plants[0]).toStrictEqual({ id: "PL-1", city: "Ashland", lat: 1, lng: 2 });
  });
});
