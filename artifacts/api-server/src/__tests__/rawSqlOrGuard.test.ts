import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

// FLK-1 — structural guard for one bug class: a raw sql`… OR …` fragment
// passed to drizzle's and(). drizzle does NOT parenthesise a raw fragment, so
//   and(eq(t.id, 1), sql`${t.x} IS NULL OR ${t.x} < ${n}`)
// renders `(id = $1 and x IS NULL OR x < $2)`, which Postgres binds as
// `(id = $1 AND x IS NULL) OR x < $2` — a WHERE that matches every row with
// x < n. scenarioSolveAtomicity.test.ts did exactly that and rewrote
// latest_solve_job_id on every scenario in the database, including
// concurrently-running test files' rows.
//
// If this fails for code you just wrote: use drizzle's or(...) helper, or
// wrap the whole fragment in parentheses.
//
// lib/db/src/schema is out of scope: its sql`` fragments are whole CHECK /
// partial-index expressions, which Postgres parenthesises itself.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ROOTS = ["artifacts/api-server/src", "lib/db/src", "scripts/src"];
const SKIP_DIRS = new Set(["node_modules", "dist", "generated", "schema"]);

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : tsFiles(join(dir, e.name));
    return e.name.endsWith(".ts") ? [join(dir, e.name)] : [];
  });
}

// True when the fragment has an OR at parenthesis depth 0. ${…} placeholders
// are blanked first so their contents cannot fake a depth change.
function hasTopLevelOr(fragment: string): boolean {
  const text = fragment.replace(/\$\{[^}]*\}/g, "_");
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && /^OR\b/i.test(text.slice(i)) && !/\w/.test(text[i - 1] ?? " ")) return true;
  }
  return false;
}

describe("FLK-1 — no raw sql`` fragment with a top-level OR", () => {
  it("the detector flags the original bug shape and passes its parenthesised / or() forms", () => {
    expect(hasTopLevelOr("${t.x} IS NULL OR ${t.x} < ${n}")).toBe(true);
    expect(hasTopLevelOr("(${t.x} IS NULL OR ${t.x} < ${n})")).toBe(false);
    expect(hasTopLevelOr("a AND (b OR c)")).toBe(false);
    expect(hasTopLevelOr("ORDER BY ${t.x}")).toBe(false);
  });

  it("no source file contains one", () => {
    const fragments: { file: string; line: number }[] = [];
    let scanned = 0;
    for (const root of ROOTS) {
      for (const file of tsFiles(join(REPO, root))) {
        // Whole-line comments blanked (newlines kept, so line numbers hold):
        // this file's header and the fix site's note quote the bad shape.
        // Only whole lines, so a "://" inside code cannot swallow a backtick.
        const src = readFileSync(file, "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
        for (const m of src.matchAll(/\bsql(?:<[^>`]*>)?(?:\.raw\()?`([^`]*)`/g)) {
          scanned++;
          if (hasTopLevelOr(m[1])) {
            fragments.push({ file: relative(REPO, file), line: src.slice(0, m.index).split("\n").length });
          }
        }
      }
    }
    // Non-vacuity: a walk that found no sql`` at all proves nothing.
    expect(scanned).toBeGreaterThan(20);
    expect(fragments).toEqual([]);
  });
});
