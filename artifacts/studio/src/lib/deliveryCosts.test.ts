import { describe, it, expect } from "vitest";
import { applyBaseMultiplier, formatCost2, jsonBytes, parseMultiplier, round2, rowsThatFit } from "./deliveryCosts";

describe("round2 / formatCost2 (WQF-C6)", () => {
  it("rounds half up to 2 dp, including binary edge cases", () => {
    expect(round2(1047.7157)).toBe(1047.72);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.125)).toBe(0.13);
    expect(round2(622.1149)).toBe(622.11);
    expect(round2(0)).toBe(0);
  });
  it("always displays two decimals", () => {
    expect(formatCost2(1047.7157)).toBe("1047.72");
    expect(formatCost2(8)).toBe("8.00");
    expect(formatCost2(0)).toBe("0.00");
  });
});

describe("applyBaseMultiplier (WQF-C5)", () => {
  const rows = [
    { fromId: "W1", toId: "C1", base: 10.005 },
    { fromId: "W1", toId: "C2", base: 20 },
    { fromId: "W9", toId: "C9", base: null },
  ];
  it("sets every target with a Base to round2(Base × m), overwriting in place and appending new pairs", () => {
    const existing = [{ fromId: "W1", toId: "C2", cost: 1 }, { fromId: "W5", toId: "C5", cost: 7 }];
    expect(applyBaseMultiplier(existing, rows, 1.5)).toEqual([
      { fromId: "W1", toId: "C2", cost: 30 },
      { fromId: "W5", toId: "C5", cost: 7 },
      { fromId: "W1", toId: "C1", cost: 15.01 },
    ]);
  });
  it("never writes a row without a Base, and never duplicates a pair", () => {
    const out = applyBaseMultiplier([], rows, 2);
    expect(out.map(o => `${o.fromId}|${o.toId}`)).toEqual(["W1|C1", "W1|C2"]);
  });
});

describe("parseMultiplier (WQF-C5)", () => {
  it.each([["1.5", 1.5], [" 2 ", 2], ["0.01", 0.01]])("accepts %j", (t, n) => expect(parseMultiplier(t)).toBe(n));
  it.each(["", "0", "-2", "abc", "Infinity", "NaN"])("rejects %j", t => expect(parseMultiplier(t)).toBeNull());
});

describe("jsonBytes / rowsThatFit — the C5 size guard (WQF-C5)", () => {
  // Synthetic body with a small injected limit; nothing is mocked. Every applied entry
  // {"fromId":"W1","toId":"Cn","cost":20} is 37 bytes, so 5 of them + 4 commas = 189 bytes = 37.8 per row.
  const body = (laneCostOverrides: unknown[]) => ({ inputs: { p: 3, laneCostOverrides } });
  const applied = [1, 2, 3, 4, 5].map(i => ({ fromId: "W1", toId: `C${i}`, cost: 20 }));
  const appliedKeys = new Set(applied.map(o => `${o.fromId}|${o.toId}`));

  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    expect(jsonBytes("é")).toBe(4); // `"é"`: quote + 2-byte é + quote
  });

  it("returns null when the body fits the limit exactly", () => {
    expect(rowsThatFit(body, applied, appliedKeys, jsonBytes(body(applied)))).toBeNull();
  });

  it("on overflow, says how many applied rows fit: floor((limit − bytes without them) / average per row)", () => {
    const without = jsonBytes(body([]));
    expect(rowsThatFit(body, applied, appliedKeys, without + 100)).toBe(2); // floor(100 / 37.8)
    expect(rowsThatFit(body, applied, appliedKeys, jsonBytes(body(applied)) - 1)).toBe(4); // floor(188 / 37.8)
    expect(rowsThatFit(body, applied, appliedKeys, without - 1)).toBe(0); // never negative
  });

  it("counts kept overrides outside the applied rows as fixed weight, not as rows that could be dropped", () => {
    const kept = { fromId: "W9", toId: "C9", cost: 7 }; // 36 bytes
    const next = [kept, ...applied];
    // without = body([kept]); applied add 5 × 37 + 5 commas = 190 → 38 per row; floor(100 / 38) = 2.
    // (Measuring "without" as body([]) instead would give floor(136 / 45.2) = 3.)
    expect(rowsThatFit(body, next, appliedKeys, jsonBytes(body([kept])) + 100)).toBe(2);
  });

  it("is 0 when nothing was applied but the body is still over the limit", () => {
    expect(rowsThatFit(body, [], new Set(), 1)).toBe(0);
  });
});
