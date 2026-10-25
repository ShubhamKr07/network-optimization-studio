import type { Dataset, SolveResult } from "@workspace/api-client-react";

// DU-3.4 (PR3-9) — a JADE-shaped result WITH product-level details.assignments
// (shape from solve.py's JADE section), its companion dataset, and one
// split-sourced customer. C1: both products via W1. C2 (split): steel via W1,
// wire via W2. Inbound edges are per (plant, warehouse, product).
export const jadeRouteDataset: Dataset = {
  warehouses: [
    { id: "W1", city: "Whiteville", state: "TX", lat: 35, lng: -95 },
    { id: "W2", city: "Wardtown", state: "OK", lat: 36, lng: -96 },
  ],
  customers: [
    { id: "C1", city: "Cville", state: "AR", lat: 34, lng: -94, demand: 100 },
    { id: "C2", city: "Splitburg", state: "LA", lat: 33, lng: -93, demand: 200 },
  ],
  plants: [
    { id: "P1", name: "Plant One", city: "Pville", state: "IL", lat: 40, lng: -90 },
    { id: "P2", name: "Plant Two", city: "Pton", state: "OH", lat: 41, lng: -91 },
  ],
  products: [
    { id: "steel", name: "Steel" },
    { id: "wire", name: "Wire" },
  ],
};

const inbound = (fromId: string, toId: string, productId: string, flow: number, distance: number) =>
  ({ fromId, toId, flow, distance, leg: "plant_to_warehouse" as const, productId });
const outbound = (fromId: string, toId: string, flow: number, distance: number) =>
  ({ fromId, toId, flow, distance, leg: "warehouse_to_customer" as const });

export const jadeRouteResult: SolveResult = {
  status: "optimal", objective: 1, runTimeSec: 0.1, quality: "Optimal",
  edges: [
    inbound("P1", "W1", "steel", 50, 300),
    inbound("P2", "W1", "steel", 120, 400),
    inbound("P1", "W1", "wire", 80, 300),
    inbound("P2", "W2", "wire", 60, 250),
    inbound("P1", "W2", "steel", 10, 500), // steel into W2: must NOT feed C2's steel route (W1)
    outbound("W1", "C1", 100, 120),
    outbound("W1", "C2", 70, 200),
    outbound("W2", "C2", 30, 340),
  ],
  metrics: { weightedAvgDistance: 100, bandCoverage: [], utilizationByNode: [] },
  details: {
    openWarehouseIds: ["W1", "W2"],
    assignments: [
      { customerId: "C1", warehouseId: "W1", productId: "steel", flow: 60, distanceMi: 120 },
      { customerId: "C1", warehouseId: "W1", productId: "wire", flow: 40, distanceMi: 120 },
      { customerId: "C2", warehouseId: "W1", productId: "steel", flow: 70, distanceMi: 200 },
      { customerId: "C2", warehouseId: "W2", productId: "wire", flow: 30, distanceMi: 340 },
    ],
  },
  solverUsed: "CBC (PuLP)", infeasibilityReason: null,
} as SolveResult;
