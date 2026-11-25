// WQF-C5/C6 — numbers in Chapter 5's Delivery Cost table. A cost is billable miles, never a distance:
// no unit conversion here (DeliveryCostsTab.tsx header comment).

/** Round half up to 2 dp. `Number.EPSILON` keeps 1.005 → 1.01 (it is 1.00499… in binary). Costs are ≥ 0. */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Display form, always two decimals: 1047.7157 → "1047.72", 8 → "8.00". */
export function formatCost2(x: number): string {
  return round2(x).toFixed(2);
}
