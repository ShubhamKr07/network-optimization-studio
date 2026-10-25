import type { SolveResult } from "@workspace/api-client-react";
import { isInboundLeg } from "@/lib/legPalette";

// DU-3.3 — per-warehouse figures for the filter-aware narrative. EDGES only,
// never details.assignments: JADE/Super outbound edges are product-aggregated
// (solve.py:1336-1340) and the assignments are per product.
export interface WarehouseFigures {
  customers: number;
  demandServed: number;
  avgDistance: number | null;
  farthest: { customerId: string; distance: number } | null;
  feedingIds: string[];
}

export function warehouseFigures(result: SolveResult, warehouseId: string): WarehouseFigures {
  const out = result.edges.filter((e) => e.fromId === warehouseId && !isInboundLeg(e.leg));
  const demandServed = out.reduce((s, e) => s + e.flow, 0);
  let farthest: WarehouseFigures["farthest"] = null;
  for (const e of out) if (farthest == null || e.distance > farthest.distance) farthest = { customerId: e.toId, distance: e.distance };
  return {
    customers: new Set(out.map((e) => e.toId)).size,
    demandServed,
    avgDistance: demandServed > 0 ? out.reduce((s, e) => s + e.flow * e.distance, 0) / demandServed : null,
    farthest,
    feedingIds: [...new Set(result.edges.filter((e) => e.toId === warehouseId && isInboundLeg(e.leg)).map((e) => e.fromId))].sort(),
  };
}

/** Every warehouse with a non-inbound edge to this customer (split sourcing → several). */
export function servingWarehouseIds(result: SolveResult, customerId: string): string[] {
  return [...new Set(result.edges.filter((e) => e.toId === customerId && !isInboundLeg(e.leg)).map((e) => e.fromId))];
}
