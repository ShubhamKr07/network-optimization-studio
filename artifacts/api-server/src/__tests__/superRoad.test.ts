import { describe, it, expect } from "vitest";
import { superInputsSchema, SUPER_DEFAULT_INPUTS } from "../validation/inputs/superInputs.js";
import { missingRequiredRoadPairs, validRoadPairs } from "../services/superRoad.js";
import { buildPayload } from "../solver/pmedian.js";

const net = (over: object = {}) => superInputsSchema.parse({
  ...SUPER_DEFAULT_INPUTS, distanceMethod: "road", p: 1,
  products: [{ id: "K", name: "K" }],
  plants: [{ id: "P", name: "P", lat: 1, lng: 1 }],
  warehouses: [{ id: "W1", name: "W1", lat: 2, lng: 2, status: "active" }, { id: "W2", name: "W2", lat: 3, lng: 3, status: "inactive" }],
  customers: [{ id: "C1", name: "C1", lat: 4, lng: 4, status: "active" }, { id: "C2", name: "C2", lat: 5, lng: 5, status: "excluded" }],
  plantProducts: [{ plantId: "P", productId: "K", capacity: 10, costPerUnit: 0 }],
  demand: [{ customerId: "C1", productId: "K", demand: 1 }],
  roadDistances: { fetchedAt: "2026-10-23T00:00:00.000Z", profile: "driving-hgv",
    coords: { P: [1, 1], W1: [2, 2], W2: [3, 3], C1: [4, 4], C2: [5, 5] },
    pairs: [{ fromId: "P", toId: "W1", miles: 10 }, { fromId: "W1", toId: "C1", miles: 20 }, { fromId: "P", toId: "W2", miles: 30 }] },
  ...over,
});

describe("validRoadPairs (D8)", () => {
  it("keeps pairs whose endpoints exist at the snapshot coordinates", () => {
    expect(validRoadPairs(net()).map(p => `${p.fromId}|${p.toId}`)).toEqual(["P|W1", "W1|C1", "P|W2"]);
  });
  it("a moved or removed endpoint invalidates its pairs only", () => {
    const moved = net({ customers: [{ id: "C1", name: "C1", lat: 4.0001, lng: 4, status: "active" }] });
    expect(validRoadPairs(moved).map(p => p.toId)).toEqual(["W1", "W2"]);
    const gone = net({ warehouses: [{ id: "W1", name: "W1", lat: 2, lng: 2, status: "active" }] });
    expect(validRoadPairs(gone).map(p => p.toId)).toEqual(["W1", "C1"]);
  });
  it("no roadDistances -> none", () => expect(validRoadPairs(net({ roadDistances: undefined }))).toEqual([]));
});

describe("required road pairs (readiness)", () => {
  it("complete when every required pair is valid; inactive / excluded never block", () => {
    expect(missingRequiredRoadPairs(net())).toBe(0);
  });
  it("counts a stale required pair; an override covers it", () => {
    const moved = net({ customers: [{ id: "C1", name: "C1", lat: 9, lng: 9, status: "active" }, { id: "C2", name: "C2", lat: 5, lng: 5, status: "excluded" }] });
    expect(missingRequiredRoadPairs(moved)).toBe(1);
    expect(missingRequiredRoadPairs({ ...moved, distanceOverrides: [{ fromId: "W1", toId: "C1", miles: 3 }] })).toBe(0);
  });
});

describe("required road pairs: ids containing '|'", () => {
  it("a missing plant a|b -> wh c pair is not satisfied by a valid plant a -> wh b|c pair", () => {
    const v = net({
      plants: [{ id: "a|b", name: "x", lat: 1, lng: 1 }, { id: "a", name: "y", lat: 2, lng: 2 }],
      warehouses: [{ id: "c", name: "c", lat: 3, lng: 3, status: "active" }, { id: "b|c", name: "d", lat: 4, lng: 4, status: "active" }],
      customers: [], plantProducts: [], demand: [],
      roadDistances: { fetchedAt: "2026-10-23T00:00:00.000Z", profile: "driving-hgv",
        coords: { "a|b": [1, 1], a: [2, 2], c: [3, 3], "b|c": [4, 4] },
        pairs: [{ fromId: "a", toId: "b|c", miles: 5 }] },
    });
    expect(missingRequiredRoadPairs(v)).toBe(3);
  });
});

describe("solve payload", () => {
  it("passes only valid pairs as roadPairs and never roadDistances", () => {
    const moved = net({ customers: [{ id: "C1", name: "C1", lat: 9, lng: 9, status: "active" }] });
    const payload = buildPayload({ modelId: "super-model", inputs: moved }) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("roadDistances");
    expect(payload.roadPairs).toEqual([{ fromId: "P", toId: "W1", miles: 10 }, { fromId: "P", toId: "W2", miles: 30 }]);
    expect((buildPayload({ modelId: "super-model", inputs: net({ distanceMethod: "haversine" }) }) as Record<string, unknown>).roadPairs).toEqual([]);
  });
});
