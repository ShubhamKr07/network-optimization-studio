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

describe("new light tokens (DU-5.1)", () => {
  it("--text-primary and --map-highlight equal --green-700 in light", () => {
    expect(token("--text-primary").toUpperCase()).toBe("#48611E");
    expect(token("--map-highlight").toUpperCase()).toBe("#48611E");
  });
});

const DARK = CSS.slice(CSS.indexOf(".dark {"), CSS.indexOf("}", CSS.indexOf(".dark {")));
// A token is a hex literal or an "H S% L%" triple (consumed as hsl(var(--x))).
// Triples are converted to the hex the browser renders, so every gate measures
// what students see, not a nearby palette value (Codex PR5-4).
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}
function darkToken(name: string): string {
  const m = DARK.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6}|\\d+ \\d+% \\d+%)`));
  if (!m) throw new Error(`token ${name} not declared in .dark`);
  if (m[1].startsWith("#")) return m[1];
  const [h, s, l] = m[1].split(/[ %]+/).map(Number);
  return hslToHex(h, s, l);
}
const DARK_BG = darkToken("--background");
const DARK_CARD = darkToken("--card"); // legend + BandLabel surface
// OSM land #F2EFE9 through TILE_FILTER, as Chromium renders it (measured
// 2026-11-04, phase-5 plan Q1); DU-5.4 re-samples a real tile. The pin below
// keeps the filter and this constant in step.
const TILE_FILTER = "invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)";
const DARK_TILE = "#1C1915";

describe("dark theme (DU-5.1, spec §5.5)", () => {
  it("tiles are darkened by exactly the filter the gates assume", () => {
    expect(CSS).toContain(`.dark .leaflet-tile-pane { filter: ${TILE_FILTER}; }`);
  });
  const bands = [0, 1, 2, 3, 4].map(i => darkToken(`--band-${i}`));
  it("band ramp: >= 3:1 on the dark tile and the dark card, adjacent >= 1.4:1, near = light -> far = dark", () => {
    for (const b of bands) {
      expect(contrast(b, DARK_TILE)).toBeGreaterThanOrEqual(3);
      expect(contrast(b, DARK_CARD)).toBeGreaterThanOrEqual(3);
    }
    for (let i = 0; i < 4; i++) {
      expect(contrast(bands[i], bands[i + 1])).toBeGreaterThanOrEqual(1.4);
      expect(lum(bands[i])).toBeGreaterThan(lum(bands[i + 1]));
    }
  });
  it("overflow stays violet", () => {
    expect(darkToken("--band-overflow").toUpperCase()).toBe("#A78BFA");
  });
  for (const t of ["--map-warehouse", "--map-warehouse-open", "--map-customer", "--map-plant", "--map-inactive",
                   "--map-ring-forced-open", "--map-ring-select", "--map-ring-multiselect", "--map-default-stroke",
                   "--map-highlight", "--band-overflow"]) {
    it(`${t} >= 3:1 on the dark tile`, () => {
      expect(contrast(darkToken(t), DARK_TILE)).toBeGreaterThanOrEqual(3);
    });
  }
  it("plants stay distinguishable from customers (>= 1.5:1)", () => {
    expect(contrast(darkToken("--map-plant"), darkToken("--map-customer"))).toBeGreaterThanOrEqual(1.5);
  });
  for (const s of ["success", "warning", "danger", "info"]) {
    it(`--${s} on --${s}-bg >= 4.5:1`, () => {
      expect(contrast(darkToken(`--${s}`), darkToken(`--${s}-bg`))).toBeGreaterThanOrEqual(4.5);
    });
  }
  for (const t of ["--text-body", "--text-muted", "--text-brand", "--text-primary", "--link"]) {
    it(`${t} >= 4.5:1 on background and card`, () => {
      expect(contrast(darkToken(t), DARK_BG)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(darkToken(t), DARK_CARD)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("--text-faint stays decorative-only but is not invisible (>= 3:1)", () => {
    expect(contrast(darkToken("--text-faint"), DARK_BG)).toBeGreaterThanOrEqual(3);
  });
  it("primary and destructive fills carry >= 4.5:1 foreground text", () => {
    expect(contrast(darkToken("--primary-foreground"), darkToken("--primary"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkToken("--destructive-foreground"), darkToken("--destructive"))).toBeGreaterThanOrEqual(4.5);
  });
  it("KNOWN EXCEPTION (Q3, user 2026-11-04): text-destructive below AA in dark, pinned >= 3:1", () => {
    expect(contrast(darkToken("--destructive"), DARK_BG)).toBeGreaterThanOrEqual(3);
    expect(contrast(darkToken("--destructive"), DARK_CARD)).toBeGreaterThanOrEqual(3);
  });
  it("muted-foreground >= 4.5:1 on muted", () => {
    expect(contrast(darkToken("--muted-foreground"), darkToken("--muted"))).toBeGreaterThanOrEqual(4.5);
  });
  it("hslToHex is exact (non-vacuity)", () => {
    expect(hslToHex(84, 11, 9)).toBe("#171914");
    expect(hslToHex(0, 0, 100)).toBe("#FFFFFF");
  });
});

describe("dark token inventory (DU-5.1, Codex PR5-7)", () => {
  // Every semantic token declared in the light block has a dark value, except
  // families that are not theme-dependent or are derived from another token.
  // Exact derived-border list (Codex PR5-R2-7): --card-border, --sidebar-border,
  // --popover-border and the status borders are semantic and must have dark values.
  const EXEMPT = /^--(?:green-\d|ink-\d|accent-\d|demand|app-font|radius|tracking|spacing|(?:sidebar-primary|sidebar-accent|primary|secondary|muted|accent|destructive)-border$)/;
  const declared = (block: string) => new Set([...block.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]));
  it("covers every light semantic token", () => {
    const light = [...declared(ROOT)].filter(t => !EXEMPT.test(t));
    expect(light.length).toBeGreaterThan(40); // non-vacuity
    const dark = declared(DARK);
    expect(light.filter(t => !dark.has(t))).toEqual([]);
  });
});
