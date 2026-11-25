import type { LaneCostOverride } from "@/components/workspace/tabs/LaneCostsTab";

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

/** WQF-C5 — the one (fromId, toId) key the multiplier, its size guard and the tab share. */
export const pairKey = (o: { fromId: string; toId: string }): string => `${o.fromId}|${o.toId}`;

/** WQF-C5 — Cost = round2(Base × multiplier) for every target row that has a Base, overwriting any existing
 * override for that pair in place; overrides outside `targets` are kept; new pairs are appended. One entry per
 * pair, because the server refuses duplicate (fromId, toId) pairs (validation/inputs/delivery.ts). */
export function applyBaseMultiplier(
  overrides: LaneCostOverride[],
  targets: ReadonlyArray<{ fromId: string; toId: string; base: number | null }>,
  multiplier: number,
): LaneCostOverride[] {
  const byPair = new Map(overrides.map(o => [pairKey(o), o]));
  for (const t of targets) {
    if (t.base == null) continue;
    byPair.set(pairKey(t), { fromId: t.fromId, toId: t.toId, cost: round2(t.base * multiplier) });
  }
  return [...byPair.values()];
}

/** WQF-C5 — a request body's size on the wire: the UTF-8 bytes of its JSON, which is what the server's
 * `express.json({ limit })` counts. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** WQF-C5 size guard (spec C5). `body(overrides)` must build the request body exactly as the save sends it,
 * with `laneCostOverrides` = `overrides`. Returns null when `body(next)` fits `limit`; otherwise an estimate of
 * how many of the applied rows would fit: floor((limit − bytes without the applied rows) / average bytes per
 * applied row). Overrides outside `appliedKeys` stay in the "without" weight: Apply keeps them. */
export function rowsThatFit(
  body: (laneCostOverrides: LaneCostOverride[]) => unknown,
  next: LaneCostOverride[],
  appliedKeys: ReadonlySet<string>,
  limit: number,
): number | null {
  const bytesWith = jsonBytes(body(next));
  if (bytesWith <= limit) return null;
  if (appliedKeys.size === 0) return 0;
  const bytesWithoutNewOverrides = jsonBytes(body(next.filter(o => !appliedKeys.has(pairKey(o)))));
  const averageBytesPerOverride = (bytesWith - bytesWithoutNewOverrides) / appliedKeys.size;
  return Math.max(0, Math.floor((limit - bytesWithoutNewOverrides) / averageBytesPerOverride));
}

/** WQF-C5 — the multiplier Apply accepts: a finite number > 0, else null. */
export function parseMultiplier(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}
