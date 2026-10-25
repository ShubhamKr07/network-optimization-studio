/** DU-2.1 — the ONE number authority for a displayed distance (studio UI now; server exports from DU-4.2).
 *  en-US pinned (labels feed downloads), at most 2 dp, no unit. `roundForFile` (4 dp) stays the serialization contract. */
export function formatDistanceNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
