import { describe, it, expect } from "vitest";
// @workspace/db exports exactly two entry points — "." and "./schema".
// Deep subpaths like "@workspace/db/schema/solve_jobs" do NOT resolve.
import { solveJobsTable, scenariosTable, feedbackTable } from "@workspace/db/schema";
import { getTableConfig } from "drizzle-orm/pg-core";

describe("Part F schema additions", () => {
  it("solve_jobs.result exists and is nullable", () => {
    expect(solveJobsTable.result).toBeDefined();
    expect(solveJobsTable.result.notNull).toBe(false);
  });
  it("scenarios.result_run_id exists and is nullable", () => {
    expect(scenariosTable.resultRunId).toBeDefined();
    expect(scenariosTable.resultRunId.notNull).toBe(false);
  });
});

describe("COSM-4 — feedback rows are anonymous at rest", () => {
  // Declared-schema half of the proof. The live-catalog half lives in
  // feedback.test.ts, which has a real `db`: the declared schema and the
  // applied database can disagree, and only the catalog proves what exists.
  // Asserting the EXACT column set is the point — "the selected row lacks a
  // user property" proves nothing, because a missing value and a missing
  // column look identical through the ORM.
  it("feedback declares no account, session, or IP column", () => {
    const names = getTableConfig(feedbackTable).columns.map((c) => c.name).sort();
    expect(names).toEqual(["body", "created_at", "id"]);
    for (const banned of ["user_id", "userid", "session_id", "ip", "ip_address", "email"]) {
      expect(names).not.toContain(banned);
    }
  });
});

describe("CH4-11 — one active solve job per Chapter 4 scenario", () => {
  it("declares a partial unique index scoped to max-coverage-us AND active status", () => {
    const config = getTableConfig(solveJobsTable);
    const unique = config.indexes.find((i) => i.config.name === "UQ_solve_jobs_active_per_scenario");
    expect(unique).toBeDefined();
    expect(unique!.config.unique).toBe(true);

    // R1 — assert the PREDICATE, not merely that a `where` exists. A test that
    // only checks `where !== undefined` passes just as happily on an unscoped
    // index, which is the exact defect this assertion exists to catch: an
    // unscoped predicate would impose one-active-job on all six models.
    //
    // Deviation from the plan's literal `JSON.stringify(unique!.config.where)`
    // (hard rule #8, smallest correct fix, noted here + in the commit body):
    // this repo's installed drizzle-orm builds each ExtraConfigColumn chunk
    // with a `column.table` back-reference to the owning PgTable, so a bare
    // JSON.stringify throws "Converting circular structure to JSON" instead
    // of producing the string this assertion needs. A replacer that drops the
    // `table` key (the sole cycle-closing edge) and any already-visited
    // object keeps the assertion's actual intent — inspect the predicate's
    // CONTENT — unchanged.
    const seen = new WeakSet<object>();
    const predicate = JSON.stringify(unique!.config.where, (key, value) => {
      if (key === "table") return undefined;
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return undefined;
        seen.add(value);
      }
      return value;
    });
    expect(predicate).toContain("max-coverage-us");
    expect(predicate).toContain("queued");
    expect(predicate).toContain("running");
  });
});
