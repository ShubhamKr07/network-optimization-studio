// T3 — stable opaque ids + cosmetic human display codes for scenario-local
// added entities (warehouses/customers). The uid is the join key and never
// changes; the display code is regenerated whenever city/state changes and
// exists purely for readability (WH-STATE-CITY-SEQ / CS-STATE-CITY-SEQ).
// T11 (Step A) — mines/stations join the same identity model
// (MN-STATE-CITY-SEQ / ST-STATE-CITY-SEQ, am-/as-<uuid> uids), matching the
// backend's own mintAddedEntityUid prefix convention exactly.

function randomUuid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
  );
}

const UID_PREFIX: Record<"wh" | "cs" | "mn" | "st", string> = {
  wh: "aw",
  cs: "ac",
  mn: "am",
  st: "as",
};

export function newUid(kind: "wh" | "cs" | "mn" | "st"): string {
  return `${UID_PREFIX[kind]}-${randomUuid()}`;
}

export function cityCode(city: string): string {
  return city.toUpperCase().replace(/[^A-Z]/g, "");
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

const DISPLAY_CODE_PREFIX: Record<"wh" | "cs" | "mn" | "st", string> = {
  wh: "WH",
  cs: "CS",
  mn: "MN",
  st: "ST",
};

export function nextDisplayCode(
  kind: "wh" | "cs" | "mn" | "st",
  state: string,
  city: string,
  existingCodes: Iterable<string>,
): string {
  const prefix = DISPLAY_CODE_PREFIX[kind];
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
