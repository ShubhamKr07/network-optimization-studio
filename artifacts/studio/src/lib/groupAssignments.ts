// DU-4.4 (spec §5.4.2, Q10) — display-only group-by for multi-product assignments:
// one group per customer, in first-appearance order. Exports stay flat and never use this.
export interface CustomerAssignmentGroup {
  customerId: string;
  /** One entry per product, sorted by product label (productId when no labeller is given). */
  lines: Array<{ productId: string; warehouseId: string; distance: number }>;
  /** The single warehouse when every product goes to it, else null. */
  warehouseId: string | null;
  warehouseCount: number;
}

export function groupAssignmentsByCustomer(
  rows: Array<{ customerId: string; productId: string; warehouseId: string; distanceMi: number }>,
  productLabelOf: (productId: string) => string = id => id,
): CustomerAssignmentGroup[] {
  const byCustomer = new Map<string, CustomerAssignmentGroup["lines"]>();
  for (const r of rows) {
    const lines = byCustomer.get(r.customerId) ?? [];
    lines.push({ productId: r.productId, warehouseId: r.warehouseId, distance: r.distanceMi });
    byCustomer.set(r.customerId, lines);
  }
  return [...byCustomer].map(([customerId, lines]) => {
    lines.sort((a, b) => productLabelOf(a.productId).localeCompare(productLabelOf(b.productId)));
    const warehouses = new Set(lines.map(l => l.warehouseId));
    return {
      customerId,
      lines,
      warehouseId: warehouses.size === 1 ? lines[0].warehouseId : null,
      warehouseCount: warehouses.size,
    };
  });
}
