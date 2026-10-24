import { describe, it, expect } from "vitest";
import type { SuperInputsLike } from "@/lib/superNetwork";
import { superAddDefaults, superAddDisabledReason, superAddOptions, validateSuperAdd } from "@/components/workspace/super/superAddForms";

const net = (over: Partial<SuperInputsLike> = {}): SuperInputsLike => ({
  products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [], ...over,
});
const loc = (id: string) => ({ id, lat: 0, lng: 0 });
const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => loc(`${p}${i}`));
const products = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `k${i}`, name: "x" }));

describe("superAddDisabledReason", () => {
  it("entity tables are never source-gated", () => {
    for (const t of ["products", "plants", "warehouses", "customers"] as const) expect(superAddDisabledReason(t, net())).toBeNull();
  });
  it("pair tables need their sources", () => {
    expect(superAddDisabledReason("plantProducts", net({ plants: [loc("P")] }))).toBe("Add a plant and a product first.");
    expect(superAddDisabledReason("plantProducts", net({ plants: [loc("P")], products: products(1) }))).toBeNull();
    expect(superAddDisabledReason("demand", net({ products: products(1) }))).toBe("Add a customer and a product first.");
    expect(superAddDisabledReason("demand", net({ customers: [loc("C")], products: products(1) }))).toBeNull();
    expect(superAddDisabledReason("distanceOverrides", net({ plants: [loc("P")], customers: [loc("C")] }))).toBe("Add warehouses with plants or customers first.");
    expect(superAddDisabledReason("distanceOverrides", net({ warehouses: [loc("W")] }))).toBe("Add warehouses with plants or customers first.");
    expect(superAddDisabledReason("distanceOverrides", net({ warehouses: [loc("W")], customers: [loc("C")] }))).toBeNull();
    expect(superAddDisabledReason("distanceOverrides", net({ plants: [loc("P")], warehouses: [loc("W")] }))).toBeNull();
  });
  it("at a table's server limit the button is disabled with that limit", () => {
    expect(superAddDisabledReason("products", net({ products: products(10) }))).toBe("Limit reached: at most 10 products.");
    expect(superAddDisabledReason("plants", net({ plants: many(20, "p") }))).toBe("Limit reached: at most 20 plants.");
    expect(superAddDisabledReason("warehouses", net({ warehouses: many(50, "w") }))).toBe("Limit reached: at most 50 warehouses.");
    expect(superAddDisabledReason("customers", net({ customers: many(500, "c") }))).toBe("Limit reached: at most 500 customers.");
    expect(superAddDisabledReason("plants", net({ plants: many(19, "p") }))).toBeNull();
  });
});

describe("superAddDefaults", () => {
  it("locations default to nextFreeId in the SHARED location namespace; status defaults to active", () => {
    const n = net({ plants: [loc("PL-1")], customers: [loc("PL-2")] });
    expect(superAddDefaults("plants", n)).toEqual({ id: "PL-3", city: "", state: "", lat: "", lng: "" });
    expect(superAddDefaults("warehouses", n)).toEqual({ id: "WH-1", city: "", state: "", lat: "", lng: "", status: "active" });
    expect(superAddDefaults("customers", n)).toMatchObject({ id: "C-1", status: "active" });
  });
  it("products and pair tables start empty", () => {
    expect(superAddDefaults("products", net())).toEqual({ id: "", name: "" });
    expect(superAddDefaults("demand", net())).toEqual({ customerId: "", productId: "", demand: "" });
    expect(superAddDefaults("distanceOverrides", net())).toEqual({ fromId: "", toId: "", miles: "" });
  });
});

describe("validateSuperAdd", () => {
  const base = net({
    products: [{ id: "K1", name: "Bolts" }], plants: [loc("P1")], warehouses: [loc("W1")], customers: [loc("C1")],
    plantProducts: [{ plantId: "P1", productId: "K1", capacity: 5, costPerUnit: 1 }],
  });

  it("location: trims text, accepts signed lat/lng at the bounds, omits blank optional text", () => {
    const r = validateSuperAdd("plants", { id: " P2 ", city: " ", state: "", lat: "-33.5", lng: "-180" }, base);
    expect(r.errors).toEqual({});
    expect(r.row).toEqual({ id: "P2", lat: -33.5, lng: -180 });
  });
  it("location: lat/lng out of range or blank are field errors", () => {
    const r = validateSuperAdd("customers", { id: "C2", city: "", state: "", lat: "90.1", lng: "", status: "active" }, base);
    expect(r.errors).toEqual({ lat: "Must be between -90 and 90.", lng: "Required." });
    expect(r.row).toBeNull();
    expect(validateSuperAdd("plants", { id: "P2", lat: "0", lng: "180.5" }, base).errors.lng).toBe("Must be between -180 and 180.");
  });
  it("location ids are unique across plants, warehouses and customers; products are their own namespace", () => {
    expect(validateSuperAdd("customers", { id: "W1", lat: "1", lng: "1", status: "active" }, base).errors.id)
      .toBe('ID "W1" is already used by a plant, warehouse or customer.');
    expect(validateSuperAdd("products", { id: "P1", name: " Plant-named " }, base).row).toEqual({ id: "P1", name: "Plant-named" });
    expect(validateSuperAdd("products", { id: "K1", name: "Dup" }, base).errors.id).toBe('ID "K1" is already used by a product.');
    expect(validateSuperAdd("products", { id: "K2", name: "  " }, base).errors.name).toBe("Required.");
  });
  it(">= 0 numerics accept 0 and reject negatives and non-numbers", () => {
    const ok = validateSuperAdd("plantProducts", { plantId: "P1", productId: "K1", capacity: "0", costPerUnit: "0" }, { ...base, plantProducts: [] });
    expect(ok.row).toEqual({ plantId: "P1", productId: "K1", capacity: 0, costPerUnit: 0 });
    expect(validateSuperAdd("demand", { customerId: "C1", productId: "K1", demand: "-1" }, base).errors.demand).toBe("Must be 0 or more.");
    expect(validateSuperAdd("demand", { customerId: "C1", productId: "K1", demand: "abc" }, base).errors.demand).toBe("Enter a number.");
  });
  it("an existing composite pair cannot be added again", () => {
    const r = validateSuperAdd("plantProducts", { plantId: "P1", productId: "K1", capacity: "1", costPerUnit: "1" }, base);
    expect(r.formError).toBe("Plant P1 already has a row for product K1.");
    expect(r.row).toBeNull();
    const d = net({ ...base, demand: [{ customerId: "C1", productId: "K1", demand: 2 }] });
    expect(validateSuperAdd("demand", { customerId: "C1", productId: "K1", demand: "1" }, d).formError).toBe("Customer C1 already has demand for product K1.");
    const o = net({ ...base, distanceOverrides: [{ fromId: "W1", toId: "C1", miles: 2 }] });
    expect(validateSuperAdd("distanceOverrides", { fromId: "W1", toId: "C1", miles: "1" }, o).formError).toBe("An override for W1 → C1 already exists.");
  });
  it("a select value not in its list is rejected", () => {
    expect(validateSuperAdd("demand", { customerId: "nope", productId: "K1", demand: "1" }, base).errors.customerId).toBe("Choose from the list.");
  });
  it("Distances: To is filtered by From (plant→warehouse, warehouse→customer only)", () => {
    expect(superAddOptions("fromId", {}, base)).toEqual(["P1", "W1"]);
    expect(superAddOptions("toId", { fromId: "P1" }, base)).toEqual(["W1"]);
    expect(superAddOptions("toId", { fromId: "W1" }, base)).toEqual(["C1"]);
    expect(superAddOptions("toId", { fromId: "" }, base)).toEqual([]);
    expect(validateSuperAdd("distanceOverrides", { fromId: "P1", toId: "C1", miles: "3" }, base).errors.toId).toBe("Choose from the list.");
    expect(validateSuperAdd("distanceOverrides", { fromId: "W1", toId: "C1", miles: "0" }, base).row).toEqual({ fromId: "W1", toId: "C1", miles: 0 });
  });
  it("a From with nothing reachable is not offered", () => {
    expect(superAddOptions("fromId", {}, net({ plants: [loc("P1")], warehouses: [loc("W1")] }))).toEqual(["P1"]);
    expect(superAddOptions("fromId", {}, net({ warehouses: [loc("W1")], customers: [loc("C1")] }))).toEqual(["W1"]);
  });
  it("warehouses × customers × products may reach 50,000 but not exceed it", () => {
    const at = net({ products: products(10), customers: many(500, "c"), warehouses: many(9, "w") });
    expect(validateSuperAdd("warehouses", { id: "W-new", lat: "0", lng: "0", status: "active" }, at).formError).toBeNull();
    const over = { ...at, warehouses: many(10, "w") };
    const r = validateSuperAdd("warehouses", { id: "W-new", lat: "0", lng: "0", status: "active" }, over);
    expect(r.formError).toBe("Limit reached: warehouses × customers × products would be 55,000 (at most 50,000).");
    expect(r.row).toBeNull();
    // a table that does not grow the product is never blocked by it
    expect(validateSuperAdd("plants", { id: "P-new", lat: "0", lng: "0" }, over).formError).toBeNull();
  });
});
