import type { Dataset, SolveResult } from "@workspace/api-client-react";
import { isInboundLeg } from "@/lib/legPalette";

export interface ProductRoute {
  productId: string;
  productName: string;
  warehouseId: string;
  outboundDistance: number; // canonical, from the assignment
  /** Inbound edges with this productId into warehouseId, flow desc. */
  sources: { sourceId: string; flow: number; distance: number }[];
}

/**
 * Per-product routes for one customer from details.assignments (rows must have
 * customerId, warehouseId, productId, distanceMi). [] when the result has no
 * product-level assignments (single-product models) or the rows are malformed.
 */
export function productRoutesFor(result: SolveResult, dataset: Dataset, customerId: string): ProductRoute[] {
  const rows = (result.details as { assignments?: unknown }).assignments;
  if (!Array.isArray(rows)) return [];
  const routes: ProductRoute[] = [];
  for (const a of rows as Record<string, unknown>[]) {
    if (
      !a || a.customerId !== customerId || typeof a.warehouseId !== "string" ||
      typeof a.productId !== "string" || typeof a.distanceMi !== "number"
    ) continue;
    const { warehouseId, productId } = a;
    routes.push({
      productId,
      productName: dataset.products?.find((p) => p.id === productId)?.name ?? productId,
      warehouseId,
      outboundDistance: a.distanceMi,
      sources: result.edges
        .filter((e) => e.productId === productId && e.toId === warehouseId && isInboundLeg(e.leg))
        .map((e) => ({ sourceId: e.fromId, flow: e.flow, distance: e.distance }))
        .sort((x, y) => y.flow - x.flow),
    });
  }
  return routes;
}
