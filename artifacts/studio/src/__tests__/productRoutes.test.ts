import { describe, it, expect } from "vitest";
import { productRoutesFor } from "@/lib/productRoutes";
import { jadeRouteDataset as ds, jadeRouteResult as r } from "./fixtures/jadeRouteFixture";

describe("productRoutesFor", () => {
  it("a 2-product customer gives 2 routes with the assignment's warehouse and distance", () => {
    const routes = productRoutesFor(r, ds, "C1");
    expect(routes.map((x) => [x.productId, x.productName, x.warehouseId, x.outboundDistance])).toEqual([
      ["steel", "Steel", "W1", 120], ["wire", "Wire", "W1", 120],
    ]);
  });

  it("sources are inbound edges of the same product into that warehouse, flow descending", () => {
    const steel = productRoutesFor(r, ds, "C1")[0];
    expect(steel.sources).toEqual([
      { sourceId: "P2", flow: 120, distance: 400 },
      { sourceId: "P1", flow: 50, distance: 300 },
    ]);
  });

  it("the split customer's two products carry different warehouses and only their own feeding sources", () => {
    const [steel, wire] = productRoutesFor(r, ds, "C2");
    expect([steel.warehouseId, wire.warehouseId]).toEqual(["W1", "W2"]);
    expect(steel.sources.map((s) => s.sourceId)).toEqual(["P2", "P1"]);
    expect(wire.sources).toEqual([{ sourceId: "P2", flow: 60, distance: 250 }]);
  });

  it("a result with no product-level assignments gives []", () => {
    const pmedian = { ...r, edges: [], details: { openWarehouseIds: ["W1"], assignments: [{ customerId: "C1", warehouseId: "W1", distanceMi: 5, band: 0, flowFraction: 1 }] } };
    expect(productRoutesFor(pmedian as never, ds, "C1")).toEqual([]);
  });

  it("malformed assignment rows are skipped and don't throw", () => {
    const bad = {
      ...r,
      details: { assignments: [null, 7, { customerId: "C1" }, { customerId: "C1", warehouseId: "W1", productId: "steel", distanceMi: "far" }, { customerId: "C1", warehouseId: "W1", productId: "wire", distanceMi: 9 }] },
    };
    expect(productRoutesFor(bad as never, ds, "C1").map((x) => x.productId)).toEqual(["wire"]);
    expect(productRoutesFor({ ...r, details: {} } as never, ds, "C1")).toEqual([]);
  });
});
