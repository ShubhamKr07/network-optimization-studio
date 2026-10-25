/** DU-2.8 — quick P choices around the current value; manifests carry no default P. */
export function pPresets(p: number, pMax: number): number[] {
  const hi = Math.max(1, pMax);
  const out = new Set<number>();
  for (let n = p - 2; n <= p + 2; n++) if (n >= 1 && n <= hi) out.add(n);
  return [...out].sort((a, b) => a - b);
}
