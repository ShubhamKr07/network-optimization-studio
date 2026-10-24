import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

// DU-1.3 (spec §5.1.3) — status/neutral colour must come from tokens, never
// raw Tailwind palette classes. Tree walk (not a file list), comment lines
// skipped, named allow-list (currently empty — keep it that way or give a
// reason), non-vacuity case. Same shape as rawErrorMessageSurface.test.ts.
const SRC_ROOT = resolve(__dirname, "..");
const RAW = /\b(?:bg|text|border|ring|ring-offset|fill|stroke|divide|outline|placeholder|from|via|to|shadow|accent|caret|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
const ALLOWED: Record<string, string> = {};

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

describe("raw Tailwind palette classes (DU-1.3)", () => {
  it("no source file uses a raw palette colour class", () => {
    const offenders: string[] = [];
    for (const f of collect(SRC_ROOT)) {
      if (rel(f) in ALLOWED) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (isCode(line) && RAW.test(line)) offenders.push(`${rel(f)}:${i + 1} — ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
  it("is not vacuous", () => {
    expect(collect(SRC_ROOT).length).toBeGreaterThan(50);
    expect(RAW.test('className="bg-amber-50"')).toBe(true);
    expect(RAW.test('className="focus:ring-offset-red-600"')).toBe(true);
    expect(RAW.test('className="ring-offset-destructive"')).toBe(false);
  });
});
