import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// DU-5.2 — surfaces that hard-code a light colour do not flip in dark mode.
// Same shape as rawPaletteClasses.test.ts: tree walk, comment lines skipped,
// non-vacuity. Exceptions are per LINE, not per file (Codex PR5-5): an
// allow-listed file can still hold a real offender elsewhere.
const SRC = resolve(__dirname, "..");
const PATTERNS: Array<[string, RegExp]> = [
  ["bg-white", /\bbg-white\b(?!\/)/],
  ["text-white", /\btext-white\b/],
  ["raw palette var", /var\(--(?:ink|green)-\d{3}\)/],
];
const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);
// [file, substring that identifies the allowed line(s), reason]. Each entry must still match.
const ALLOWED: Array<[string, string, string]> = [
  ["components/AppShell.tsx", "var(--ink-300)", "ink header band (Q8)"],
  ["components/AppShell.tsx", "var(--green-400)", "ink header band title (Q8)"],
  ["components/auth/AuthShell.tsx", "var(--ink-300)", "ink header panel (Q8)"],
  ["components/auth/AuthShell.tsx", "var(--green-400)", "ink header panel border + diamond (Q8)"],
  ["pages/Workspace.tsx", "var(--ink-", "ink header band :4593-4629 (Q8)"],
];
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "__tests__" ? [] : walk(p)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const rel = (f: string) => relative(SRC, f).split(sep).join("/");
const allowed = (file: string, line: string) => ALLOWED.some(([f, needle]) => f === file && line.includes(needle));

describe("themed surfaces (DU-5.2)", () => {
  const files = walk(SRC);
  it("is not vacuous", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(PATTERNS[0][1].test('className="bg-white"')).toBe(true);
    expect(PATTERNS[0][1].test('className="hover:bg-white/10"')).toBe(false);
  });
  it("no hard-coded light surface outside the allow-list", () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (!isCode(line) || allowed(rel(f), line)) return;
        for (const [name, re] of PATTERNS) if (re.test(line)) hits.push(`${rel(f)}:${i + 1} ${name} — ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
  it("every allow-list entry still matches a line with a pattern", () => {
    for (const [f, needle] of ALLOWED) {
      const lines = readFileSync(join(SRC, f), "utf8").split("\n").filter(l => isCode(l) && l.includes(needle));
      expect(lines.some(l => PATTERNS.some(([, re]) => re.test(l))), f).toBe(true);
    }
  });
});
