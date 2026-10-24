import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

// DU-1.4 (spec §5.1.3) — 11px floor: no arbitrary text size below 11px.
const SRC_ROOT = resolve(__dirname, "..");
const SUB_11_CLASS = /\btext-\[(?:[0-9]|10)(?:\.\d+)?px\]/;
// Inline `fontSize: "10px"` / `fontSize: 10` and CSS-ish `font-size: 10px`; rem/em floor is 11/16.
const FONT_SIZE = /(?:\bfontSize:\s*["']?|\bfont-size:\s*)(\d*\.?\d+)(px|rem|em)?/g;
const SUB_11 = {
  test(line: string): boolean {
    if (SUB_11_CLASS.test(line)) return true;
    for (const m of line.matchAll(FONT_SIZE)) {
      const n = parseFloat(m[1]);
      if (m[2] === "rem" || m[2] === "em" ? n < 0.6875 : n < 11) return true;
    }
    return false;
  },
};
const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
function collect(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "__tests__") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.(?:tsx?|css)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}
const rel = (f: string) => relative(SRC_ROOT, f).split(sep).join("/");

describe("minimum text size (DU-1.4)", () => {
  it("no source file (ts/tsx/css) uses a text size below 11px", () => {
    const offenders: string[] = [];
    for (const f of collect(SRC_ROOT))
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (isCode(line) && SUB_11.test(line)) offenders.push(`${rel(f)}:${i + 1}`);
      });
    expect(offenders).toEqual([]);
  });
  it("is not vacuous", () => {
    expect(SUB_11.test("text-[10px]")).toBe(true);
    expect(SUB_11.test("text-[10.5px]")).toBe(true);
    expect(SUB_11.test("text-[11px]")).toBe(false);
    expect(SUB_11.test('style={{ fontSize: "10px" }}')).toBe(true);
    expect(SUB_11.test("style={{ fontSize: 10 }}")).toBe(true);
    expect(SUB_11.test("font-size:10.5px;")).toBe(true);
    expect(SUB_11.test(".k { font-size: 9px; }")).toBe(true);
    expect(SUB_11.test('fontSize: "0.6rem"')).toBe(true);
    expect(SUB_11.test("font-size: 0.5em")).toBe(true);
    expect(SUB_11.test('fontSize: "11px"')).toBe(false);
    expect(SUB_11.test("fontSize: 12.5")).toBe(false);
    expect(SUB_11.test("font-size: 0.6875rem")).toBe(false);
  });
  it("index.css defines the 11px token and the kicker is >= 11px", () => {
    const css = readFileSync(resolve(SRC_ROOT, "index.css"), "utf8");
    expect(css).toMatch(/--text-2xs:\s*0\.6875rem/);
    expect(css).not.toMatch(/\.scnd-kicker\s*\{[^}]*font-size:\s*10(\.5)?px/);
  });
});
