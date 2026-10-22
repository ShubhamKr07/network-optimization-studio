import { describe, it, expect } from "vitest";
import { cascadeDelete, referencingRows } from "@/lib/superNetwork";
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
