import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// DU-1.2 / spec §5.1.1 — numeric gates on the shipped tokens, re-computed
// from index.css so a value edit can never silently drop below the gate.
const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8");
const ROOT = CSS.slice(CSS.indexOf("/* LIGHT MODE */"), CSS.indexOf(".dark {"));

function token(name: string): string {
  const m = ROOT.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`token ${name} not found as a hex literal in :root`);
  return m[1];
}
function lum(hex: string): number {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const MAP_TILE = "#F2EFE9"; // OSM standard land fill under every lane

describe("distance-band ramp (spec §5.1.1)", () => {
  const bands = [0, 1, 2, 3, 4].map(i => token(`--band-${i}`));
  it("every band reaches >= 3:1 against the map tile", () => {
    for (const b of bands) expect(contrast(b, MAP_TILE)).toBeGreaterThanOrEqual(3);
  });
  it("adjacent bands differ by >= 1.4:1", () => {
    for (let i = 0; i < 4; i++) expect(contrast(bands[i], bands[i + 1])).toBeGreaterThanOrEqual(1.4);
  });
  it("runs near = light -> far = dark", () => {
    for (let i = 0; i < 4; i++) expect(lum(bands[i])).toBeGreaterThan(lum(bands[i + 1]));
  });
  it("overflow stays violet", () => {
    expect(token("--band-overflow").toUpperCase()).toBe("#7C3AED");
  });
});

describe("map entity hues (spec §5.1.1)", () => {
  it("open/fixed-open warehouses are ink, not green", () => {
    expect(token("--map-warehouse-open").toUpperCase()).toBe("#181A15");
  });
  it("plants (approver-pinned #2E7D32) stay distinguishable from customers (>= 1.5:1; measured 2.22)", () => {
    expect(contrast(token("--map-plant"), token("--map-customer"))).toBeGreaterThanOrEqual(1.5);
  });
});

describe("status text contrast (DU-1.3)", () => {
  for (const s of ["success", "warning", "danger", "info"]) {
    it(`--${s} on --${s}-bg >= 4.5:1`, () => {
      expect(contrast(token(`--${s}`), token(`--${s}-bg`))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("contrast fixes (DU-1.4)", () => {
  it("primary-coloured text token (--green-700) >= 4.5:1 on the page background", () => {
    expect(contrast(token("--green-700"), "#FCFCFA")).toBeGreaterThanOrEqual(4.5);
  });
  it("input border matches --line-strong (#C9CCBD = hsl 72 13% 77%)", () => {
    expect(ROOT).toMatch(/--input:\s*72 13% 77%/);
    expect(token("--line-strong").toUpperCase()).toBe("#C9CCBD");
  });
});

describe("faint text is decorative-only (DU-1.4)", () => {
  it("--text-muted, the essential-text fallback, passes AA on the page background", () => {
    expect(contrast(token("--text-muted"), "#FCFCFA")).toBeGreaterThanOrEqual(4.5);
  });
});
