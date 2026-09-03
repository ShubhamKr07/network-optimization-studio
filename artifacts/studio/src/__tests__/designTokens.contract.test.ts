import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// NOTE: `new URL("../index.css", import.meta.url)` (the plan's literal Step 1 code) is
// intercepted by Vite's static asset-URL analysis and rewritten to a dev-server URL
// (e.g. "http://localhost:3000/src/index.css") instead of a file:// URL, so
// fileURLToPath throws "The URL must be of scheme file". Confirmed environmental, not
// specific to this file: the pre-existing ObjectiveBar.test.tsx uses the identical
// pattern and fails identically. path.join(import.meta.dirname, ...) avoids the
// static-analysis trigger and resolves the real path.
const css = readFileSync(path.join(import.meta.dirname, "..", "index.css"), "utf8");

function value(name: string): string {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : "";
}
const HSL_TRIPLE = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;
const HEX = /^#[0-9A-Fa-f]{3,8}$/;

// EXHAUSTIVE — every color the `@theme inline` block maps via hsl(var(--x))
// must be an HSL triple. Derived from the @theme `--color-*: hsl(var(--*))` lines.
const HSL_MAPPED = [
  "background","foreground","border","input","ring",
  "card","card-foreground","card-border",
  "popover","popover-foreground","popover-border",
  "primary","primary-foreground","secondary","secondary-foreground",
  "muted","muted-foreground","accent","accent-foreground",
  "destructive","destructive-foreground",
  "chart-1","chart-2","chart-3","chart-4","chart-5",
  "sidebar","sidebar-foreground","sidebar-border",
  "sidebar-primary","sidebar-primary-foreground",
  "sidebar-accent","sidebar-accent-foreground","sidebar-ring",
];
// Complete raw-token inventory (bare var(--x), never hsl-wrapped).
const HEX_RAW = [
  "green-050","green-100","green-200","green-300","green-400","green-500","green-600","green-700","green-800",
  "ink-900","ink-800","ink-700","ink-500","ink-400","ink-300",
  "text-body","text-muted","text-faint","text-brand",
  "surface-band","surface-band-fg","surface-selected","surface-sunken",
  "line","line-strong","primary-hover","primary-active","link","link-hover","focus-ring",
  "success","success-bg","success-border","warning","warning-bg","warning-border","danger","danger-bg","danger-border",
  "band-0","band-1","band-2","band-3","band-4",
  "map-warehouse","map-warehouse-open","map-customer","map-customer-stroke","map-flow","map-inactive",
  "map-ring-forced-open","map-ring-select","map-ring-multiselect","map-default-stroke",
  "chart-grid","chart-axis-label","utilization",
];

describe("design tokens — representation contract", () => {
  it.each(HSL_MAPPED)("@theme-mapped --%s is an HSL triple", (n) => {
    expect(value(n), n).toMatch(HSL_TRIPLE);
  });
  it.each(HEX_RAW)("raw --%s is a complete hex color", (n) => {
    expect(value(n), n).toMatch(HEX);
  });
  it("pins the critical values", () => {
    expect(value("primary")).toBe("82 52% 33%");
    expect(value("accent-foreground")).toBe("84 11% 9%");        // ink, not white (finding 1)
    expect(value("sidebar-accent-foreground")).toBe("84 11% 9%");
    expect(value("radius-sm")).toBe("3px");
    expect(value("radius-lg")).toBe("6px");
    expect(value("radius-xl")).toBe("6px");
    expect(value("surface-band")).toBe("#181A15");
  });
  it("no `red` placeholder and no transparent runtime shadow placeholders remain", () => {
    expect(css).not.toMatch(/--chart-[1-5]\s*:\s*red/);
    expect(css).not.toMatch(/--shadow[-a-z0-9]*\s*:[^;]*\/\s*0\.00/); // the old transparent placeholders
  });
  it("@theme declares the shadow namespace incl. xs (buttons/badges depend on it)", () => {
    for (const s of ["--shadow-xs","--shadow-sm","--shadow-md","--shadow-lg"]) {
      expect(css.includes(s), s).toBe(true);
    }
  });
});
