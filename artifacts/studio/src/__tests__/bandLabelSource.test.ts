import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

// DU-2.2 (spec §5.2.2) — no UI source constructs a "Band N" label by hand: the one text authority is
// `bandRangeLabel` in @workspace/units. Tree walk of studio src/ (non-test) AND artifacts/studio/e2e/
// (the e2e local mirror of a label builder is exactly the copy this guard exists to catch).
// Calls to the units `bandLabelOrOverflow` (re-exported as `bandLabel`) are not construction: they only
// feed the frozen JADE flows client export until DU-4.2. EMPTY allow-list — keep it that way.
const SRC_DIR = resolve(__dirname, "..");
const E2E_DIR = resolve(__dirname, "../../e2e");
const BAND_CONSTRUCT = /`Band \$\{|["']Band ["']\s*\+|["']Band \d/;
const ALLOWED: string[] = [];
const isCode = (l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "__tests__" || e === "node_modules") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}
const rel = (f: string) => relative(resolve(SRC_DIR, ".."), f).split(sep).join("/");
function scan(root: string): { file: string; line: string }[] {
  return walk(root).flatMap(f =>
    readFileSync(f, "utf8").split("\n").flatMap((line, i) =>
      isCode(line) && BAND_CONSTRUCT.test(line) ? [{ file: rel(f), line: `${i + 1}: ${line.trim()}` }] : [],
    ),
  );
}

describe("band label source (DU-2.2)", () => {
  it("non-vacuity: the pattern matches each construction form, and both roots have files", () => {
    expect(BAND_CONSTRUCT.test("`Band ${i + 1}`")).toBe(true);
    expect(BAND_CONSTRUCT.test('"Band " + n')).toBe(true);
    expect(BAND_CONSTRUCT.test('"Band 2"')).toBe(true);
    expect(BAND_CONSTRUCT.test("bandRangeLabel(i, b, u)")).toBe(false);
    expect(walk(SRC_DIR).length).toBeGreaterThan(100);
    expect(walk(E2E_DIR).filter(f => f.endsWith(".spec.ts")).length).toBeGreaterThan(20);
  });
  it("no Band N label construction in studio src or e2e", () => {
    const hits = [SRC_DIR, E2E_DIR].flatMap(scan).filter(h => !ALLOWED.includes(h.file));
    expect(hits).toEqual([]);
  });
});
