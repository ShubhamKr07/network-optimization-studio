import { describe, it, expect } from "vitest";
// @workspace/db exports exactly two entry points — "." and "./schema".
// Deep subpaths like "@workspace/db/schema/solve_jobs" do NOT resolve.
import { solveJobsTable, scenariosTable } from "@workspace/db/schema";

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
