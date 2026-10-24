import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

// DU-1.4 (spec §5.1.3) — 11px floor: no arbitrary text size below 11px.
const SRC_ROOT = resolve(__dirname, "..");
const SUB_11 = /\btext-\[(?:[0-9]|10)(?:\.\d+)?px\]/;
const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
function collect(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "__tests__") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}
const rel = (f: string) => relative(SRC_ROOT, f).split(sep).join("/");

describe("minimum text size (DU-1.4)", () => {
  it("no source file uses an arbitrary text size below 11px", () => {
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
  });
  it("index.css defines the 11px token and the kicker is >= 11px", () => {
    const css = readFileSync(resolve(SRC_ROOT, "index.css"), "utf8");
    expect(css).toMatch(/--text-2xs:\s*0\.6875rem/);
    expect(css).not.toMatch(/\.scnd-kicker\s*\{[^}]*font-size:\s*10(\.5)?px/);
  });
});
