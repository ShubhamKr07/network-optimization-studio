import { describe, it, expect } from "vitest";
import { placeCard } from "@/components/workspace/map/placeCard";

const card = { width: 224, height: 230 }, C = { width: 800, height: 600 }, gap = 24;
const rect = (p: { left: number; top: number }) => ({ l: p.left, t: p.top, r: p.left + card.width, b: p.top + card.height });
const keepOut = (a: { x: number; y: number }, m: number) => ({ l: a.x - m / 2 - gap, t: a.y - m / 2 - gap, r: a.x + m / 2 + gap, b: a.y + m / 2 + gap });
type R = { l: number; t: number; r: number; b: number };
const overlaps = (a: R, b: R) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

describe("placeCard", () => {
  it.each([[100, 100], [790, 100], [100, 590], [790, 590], [400, 300]])("never covers a 32px marker at (%i,%i)", (x, y) =>
    expect(overlaps(rect(placeCard({ x, y }, card, C, 32, gap)), keepOut({ x, y }, 32))).toBe(false));
  it("never covers the largest demand bubble (44px incl. ring) near the bottom-right", () =>
    expect(overlaps(rect(placeCard({ x: 780, y: 580 }, card, C, 44, gap)), keepOut({ x: 780, y: 580 }, 44))).toBe(false));
  it("prefers right-below when it fits", () => {
    const p = placeCard({ x: 100, y: 100 }, card, C, 32);
    expect(p.flippedX || p.flippedY).toBe(false);
  });
  it("flips left near the right edge", () => expect(placeCard({ x: 790, y: 100 }, card, C, 32).flippedX).toBe(true));
  it("flips up near the bottom edge", () => expect(placeCard({ x: 100, y: 590 }, card, C, 32).flippedY).toBe(true));
  it("when nothing fits, stays inside the container (>= 4px) and picks a candidate", () => {
    const small = { width: 300, height: 260 };
    const p = placeCard({ x: 150, y: 130 }, card, small, 32);
    expect(p.left).toBeGreaterThanOrEqual(4);
    expect(p.top).toBeGreaterThanOrEqual(4);
    expect(p.left + card.width).toBeLessThanOrEqual(small.width - 4);
    expect(p.top + card.height).toBeLessThanOrEqual(small.height - 4);
  });
});
