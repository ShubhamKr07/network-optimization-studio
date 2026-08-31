// T3 — stable opaque ids + cosmetic human display codes for scenario-local
// added entities (warehouses/customers). The uid is the join key and never
// changes; the display code is regenerated whenever city/state changes and
// exists purely for readability (WH-STATE-CITY-SEQ / CS-STATE-CITY-SEQ).

function randomUuid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
  );
}

export function newUid(kind: "wh" | "cs"): string {
  return `${kind === "wh" ? "aw" : "ac"}-${randomUuid()}`;
}

export function cityCode(city: string): string {
  return city.toUpperCase().replace(/[^A-Z]/g, "");
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function nextDisplayCode(
  kind: "wh" | "cs",
  state: string,
  city: string,
  existingCodes: Iterable<string>,
): string {
  const prefix = kind === "wh" ? "WH" : "CS";
  const taken = new Set(existingCodes);
  const base = `${prefix}-${state}-${cityCode(city)}`;
  let seq = 1;
  let candidate = `${base}-${pad2(seq)}`;
  while (taken.has(candidate)) {
    seq += 1;
    candidate = `${base}-${pad2(seq)}`;
  }
  return candidate;
}
