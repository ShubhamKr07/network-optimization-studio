import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Assert on the script's SOURCE TEXT, not on Function.prototype.toString().
// Two reasons, both learned the hard way:
//   1. The vitest/esbuild transform STRIPS COMMENTS, so a toString() substring
//      check can only be satisfied by putting the words into runtime code --
//      i.e. by adding dead strings to a shipped script purely to feed a test.
//   2. Importing scripts/src/ from an api-server test is a cross-package import
//      that forces api-server's tsconfig rootDir open to the repo root.
// Reading the file sidesteps both, and matches the pattern this repo already
// uses for source-shape assertions -- see lockedModelGuards.test.ts:33,82.
const SCRIPT = path.resolve(
  import.meta.dirname,
  "../../../../scripts/src/migrate-delete-chens-scenarios.ts",
);
const src = readFileSync(SCRIPT, "utf8");

// Depth-counting brace matcher -- naive `indexOf("}")` finds the FIRST
// closing brace after an opening one, which in this file is almost always
// an inner object literal (e.g. `.returning({ id: ... })`), not the block's
// real end. This walks forward counting `{`/`}` to find the brace that
// actually closes the block starting at `openBraceIndex`.
function findMatchingCloseBrace(text: string, openBraceIndex: number): number {
  let depth = 0;
  for (let i = openBraceIndex; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

describe("Chapter 4 deletion scoping", () => {
  it("scopes jobs through the parent scenario, not solve_jobs.model_id (T2)", () => {
    // solve_jobs.model_id is A1 Class-1 nullable -- NULL on every pre-A1 row,
    // so filtering on it silently spares exactly the oldest jobs.
    expect(src).toMatch(/innerJoin\s*\(\s*scenariosTable/);
    expect(src).toContain("scenariosTable.modelId");
    expect(src).not.toMatch(/eq\s*\(\s*solveJobsTable\.modelId/);
  });

  it("deletes solve_jobs before scenarios, and purges result_cache, in one transaction", () => {
    // Assert on `tx.delete(...)`, not bare `delete(...)` -- that `tx.`
    // prefix is what proves each delete runs on the TRANSACTION handle
    // rather than the bare `database`/`db` connection. A regression that
    // moved a delete outside the transaction (or dropped `tx.` in favor of
    // `database.delete(...)`) would still satisfy a bare `delete(...)`
    // substring check, so that check can't be the whole story.
    // `tx` and `.delete(...)` sit on separate lines in the real source
    // (multi-line fluent chains), so match across whitespace (`\s` covers
    // newlines) rather than a literal contiguous substring.
    const jobsAt = src.search(/\btx\s*\.delete\(solveJobsTable\)/);
    const scenariosAt = src.search(/\btx\s*\.delete\(scenariosTable\)/);
    const cacheAt = src.search(/\btx\s*\.delete\(resultCacheTable\)/);
    expect(jobsAt).toBeGreaterThan(-1);
    expect(scenariosAt).toBeGreaterThan(-1);
    expect(cacheAt).toBeGreaterThan(-1);
    expect(jobsAt).toBeLessThan(scenariosAt);   // FK-safe ordering
    // Matches `database.transaction(async (tx) => { ... })` -- the plan's
    // original `/db\.transaction|tx\s*=>/` doesn't match this script: the
    // variable is `database`, not `db` (no "db." substring in "database"),
    // and the arrow has `) => ` (a closing paren before `=>`), not `tx =>`.
    expect(src).toMatch(/\.transaction\s*\(\s*async\s*\(tx\)/);
  });

  it("purges result_cache even when there are zero live scenarios (no early-return bypass)", () => {
    // Regression guard for the bug where `deleteChapter4Data` returned a
    // hardcoded `{ scenarioCount: 0, jobCount: 0, resultCacheCount: 0 }`
    // BEFORE the transaction whenever `fresh.scenarioIds.length === 0` --
    // silently skipping the result_cache purge (result_cache is keyed by
    // model_id alone, independent of scenarioIds/scenario existence).
    // This must fail if that early-return-with-hardcoded-zeros shape
    // reappears anywhere in the file, and must not be satisfiable by
    // unrelated text (it requires the exact hardcoded triple together).
    expect(src).not.toMatch(
      /return\s*\{\s*scenarioCount:\s*0,\s*jobCount:\s*0,\s*resultCacheCount:\s*0\s*\}/,
    );

    // Positive half: the `tx.delete(resultCacheTable)` call must NOT be
    // nested inside the `if (fresh.scenarioIds.length > 0)` guard that
    // scopes the two scenario-scoped deletes -- i.e. no `if` block opened
    // after the transaction body's start and closed before the
    // resultCacheTable delete appears.
    const txBodyStart = src.indexOf(".transaction(async (tx)");
    const guardOpen = src.indexOf("if (fresh.scenarioIds.length > 0)", txBodyStart);
    expect(guardOpen).toBeGreaterThan(-1);
    const guardOpenBrace = src.indexOf("{", guardOpen);
    const guardClose = findMatchingCloseBrace(src, guardOpenBrace);
    expect(guardClose).toBeGreaterThan(-1);
    // `tx` and `.delete(...)` sit on separate lines -- match across
    // whitespace, not a literal contiguous substring (see the note above).
    const cacheMatch = /\btx\s*\.delete\(resultCacheTable\)/.exec(src.slice(txBodyStart));
    expect(cacheMatch).not.toBeNull();
    const resultCacheDeleteAt = txBodyStart + (cacheMatch?.index ?? -1);
    expect(resultCacheDeleteAt).toBeGreaterThan(guardClose); // outside the guard
  });

  it("never issues an ad-hoc job status update", () => {
    expect(src).not.toMatch(/set\s*\(\s*\{[^}]*status\s*:/);
  });
});
