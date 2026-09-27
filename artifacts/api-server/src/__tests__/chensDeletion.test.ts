import { describe, it, expect } from "vitest";
import { countAffected, deleteChapter4Data } from "../../../../scripts/src/migrate-delete-chens-scenarios.js";

describe("Chapter 4 deletion scoping", () => {
  it("scopes jobs through the parent scenario, not solve_jobs.model_id (T2)", () => {
    const sql = countAffected.toString();
    expect(sql).toContain("join");
    expect(sql).toContain("scenarios");
    // solve_jobs.model_id is A1 Class-1 nullable -- NULL on every pre-A1 row.
    expect(sql).not.toMatch(/solve_jobs\.model_id\s*=/);
  });

  it("deletes solve_jobs before scenarios, and result_cache, in one transaction", () => {
    const src = deleteChapter4Data.toString();
    const jobsAt = src.indexOf("solveJobsTable");
    const scenariosAt = src.indexOf("scenariosTable");
    expect(jobsAt).toBeGreaterThan(-1);
    expect(jobsAt).toBeLessThan(scenariosAt);
    expect(src).toContain("resultCacheTable");
    expect(src).toContain("transaction");
  });

  it("never issues an ad-hoc job status update", () => {
    const src = deleteChapter4Data.toString() + countAffected.toString();
    expect(src).not.toMatch(/status:\s*["'](succeeded|failed|cancelled)["']/);
  });
});
