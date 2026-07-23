// E3.1 — achieved-quality statement, per the plan's OQ4 pre-resolved
// decision: ship the status-statement version now ("proven optimal" /
// "within configured gap X%, limit reached"); real CBC log parsing (which
// would say whether the gap tolerance was actually the binding stop
// condition) is an explicit fast-follow, not built here.
export function qualityStatement(status: string, gap: number): string | null {
  if (status !== "optimal") return null;
  if (gap <= 0) return "Proven optimal";
  const pct = gap * 100;
  const formatted = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);
  return `Within configured gap ${formatted}%, limit reached`;
}
