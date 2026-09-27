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

describe("Chapter 4 deletion scoping", () => {
  it("scopes jobs through the parent scenario, not solve_jobs.model_id (T2)", () => {
    // solve_jobs.model_id is A1 Class-1 nullable -- NULL on every pre-A1 row,
    // so filtering on it silently spares exactly the oldest jobs.
    expect(src).toMatch(/innerJoin\s*\(\s*scenariosTable/);
    expect(src).toContain("scenariosTable.modelId");
    expect(src).not.toMatch(/eq\s*\(\s*solveJobsTable\.modelId/);
  });

  it("deletes solve_jobs before scenarios, and purges result_cache, in one transaction", () => {
    const jobsAt = src.indexOf("delete(solveJobsTable)");
    const scenariosAt = src.indexOf("delete(scenariosTable)");
    const cacheAt = src.indexOf("delete(resultCacheTable)");
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

  it("never issues an ad-hoc job status update", () => {
    expect(src).not.toMatch(/set\s*\(\s*\{[^}]*status\s*:/);
  });
});
