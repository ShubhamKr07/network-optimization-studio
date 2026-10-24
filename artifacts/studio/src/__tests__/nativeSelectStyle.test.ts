import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

/**
 * QFX-10 — every native single-value <select> gets one look from ONE rule in
 * index.css's `@layer base`. jsdom loads no stylesheet, so this guard reads
 * source; the behavioural proof is the real-browser check (light + dark).
 * Tailwind v4 utilities outrank `@layer base`, so a `px-*`/`pr-*`/`pe-*` class
 * on a select cancels the rule's `padding-right` (the chevron then overlaps the
 * text) and `bg-white` hides the dark-mode chevron — hence the second test,
 * which walks the whole tree so a select in a file nobody has written yet is
 * still checked.
 */
const SRC_ROOT = resolve(__dirname, "..");
const css = readFileSync(join(SRC_ROOT, "index.css"), "utf8");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Each `<select` opening tag's own className: the first `className="…"` before its first `<option`. */
function nativeSelects(): Array<{ site: string; className: string | null }> {
  const found: Array<{ site: string; className: string | null }> = [];
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<select\b/g)) {
      const end = src.indexOf("<option", m.index);
      const tag = src.slice(m.index, end < 0 ? undefined : end);
      const line = src.slice(0, m.index).split("\n").length;
      found.push({
        site: `${relative(SRC_ROOT, file).split(sep).join("/")}:${line}`,
        className: /className="([^"]*)"/.exec(tag)?.[1] ?? null,
      });
    }
  }
  return found;
}

describe("native <select> styling (QFX-10)", () => {
  it("index.css @layer base styles every single-value select: no native arrow, inset token chevron, room for it", () => {
    const base = css.slice(css.indexOf("@layer base {"), css.indexOf("@layer utilities {"));
    const rule = /select:not\(\[multiple\]\):not\(\[size\]\)\s*\{([^}]*)\}/.exec(base);
    expect(rule, "rule missing from @layer base").not.toBeNull();
    const decls = rule![1];
    expect(decls).toMatch(/appearance:\s*none/);
    expect(decls).toMatch(/padding-right:\s*2rem/);
    expect(decls).toMatch(/hsl\(var\(--muted-foreground\)\)/);
    expect(decls).toMatch(/calc\(100% - 0\.6rem\)/);
    expect(decls).toMatch(/border:\s*1px solid hsl\(var\(--input\)\)/);
    expect(base).toMatch(/select:not\(\[multiple\]\):not\(\[size\]\):focus-visible\s*\{[^}]*hsl\(var\(--ring\)\)/);
  });

  it("no native select carries a class that overrides the rule's padding-right or background", () => {
    const selects = nativeSelects();
    // Non-vacuity: superTables, SuperEntityDialog, JadeDistancesTab (+ SuperDistancesTab until QFX-9).
    expect(selects.length).toBeGreaterThanOrEqual(3);
    const offenders = selects.filter(s => /(^|\s)(px|pr|pe)-\S+|(^|\s)bg-white(\s|$)/.test(s.className ?? ""));
    expect(offenders).toEqual([]);
  });
});
