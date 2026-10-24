import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";

/**
 * QFX-4 — a sortable header renders a <button> around `header`; with
 * `header: ""` that button has no accessible name. Every empty-header column
 * (delete/remove ✕ columns, CostSummary's metric-label column) must therefore
 * say `sortable: false` on the very next property. Walks the whole src tree so
 * an action column added by a later task is checked too.
 */
const SRC_ROOT = resolve(__dirname, "..");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("empty-header DataTable columns are not sortable (QFX-4)", () => {
  it("every `header: \"\"` is followed by `sortable: false`", () => {
    let total = 0;
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/header: "",/g)) {
        total++;
        if (!/^\s*sortable: false,/.test(src.slice(m.index + m[0].length))) {
          offenders.push(`${relative(SRC_ROOT, file).split(sep).join("/")}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    // Non-vacuity: 11 delete/remove columns + 2 CostSummary metric columns at QFX-4 time.
    expect(total).toBeGreaterThanOrEqual(13);
    expect(offenders).toEqual([]);
  });
});
