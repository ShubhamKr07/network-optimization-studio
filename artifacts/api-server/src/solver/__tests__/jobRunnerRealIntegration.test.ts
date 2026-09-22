// A3 — a genuine, fully unmocked end-to-end test of the production wiring:
// real `child_process.spawn` (detached, 4-entry stdio, NOS_SOLVE_WORKDIR),
// real `solve.py`, real fd3 message, real classifyTerminal(), real
// toLegacyStoredResult(), and a real Postgres DB (solve_jobs/scenarios).
// Every other jobRunner test in this repo mocks `child_process` and/or
// `@workspace/db` — this file exists because none of them actually prove the
// real pipeline connects end-to-end. Requires a live DATABASE_URL (same
// requirement as routes.test.ts / dataset.test.ts) — run with e.g.
// `DATABASE_URL=postgresql://... pnpm --filter api-server exec vitest run
// src/solver/__tests__/jobRunnerRealIntegration.test.ts`.
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import { enqueueSolveJob } from "../jobRunner.js";
import type { SolveInput } from "../pmedian.js";

const TEST_USER_ID = `a3-no-orphan-proof-${Date.now()}`;
let scenarioId: number;

async function pollJob(jobId: number, timeoutMs: number): Promise<{ status: string; error: string | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, jobId));
    if (row && (row.status === "succeeded" || row.status === "failed")) {
      return { status: row.status, error: row.error };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`job ${jobId} did not terminate within ${timeoutMs}ms`);
}

afterAll(async () => {
  if (scenarioId) {
    await db.delete(solveJobsTable).where(eq(solveJobsTable.scenarioId, scenarioId));
    await db.delete(scenariosTable).where(eq(scenariosTable.id, scenarioId));
  }
  await db.delete(usersTable).where(eq(usersTable.id, TEST_USER_ID));
});

describe("A3 — real end-to-end solve via the unmocked production pipeline", () => {
  it("a real p-median-us solve succeeds through the real fd3 protocol and publishes a legacy-shaped result", async () => {
    await db.insert(usersTable).values({ id: TEST_USER_ID, email: `${TEST_USER_ID}@example.test` });

    const input: SolveInput = {
      modelId: "p-median-us",
      inputs: {
        p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
        warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
        addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
      },
    };

    const [scenario] = await db.insert(scenariosTable).values({
      name: "A3 real-integration proof",
      userId: TEST_USER_ID,
      modelId: input.modelId,
      inputs: input.inputs as unknown as Record<string, unknown>,
    }).returning();
    scenarioId = scenario!.id;

    const jobId = await enqueueSolveJob(scenarioId, TEST_USER_ID, input);
    const result = await pollJob(jobId, 60000);

    expect(result.status).toBe("succeeded");

    const [job] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, jobId));
    const jobResult = job!.result as { status: string; objective: number; edges: unknown[] } | null;
    expect(jobResult).not.toBeNull();
    expect(jobResult!.status).toBe("optimal");
    expect(jobResult!.objective).toBeGreaterThan(0);
    expect(Array.isArray(jobResult!.edges)).toBe(true);

    const [updatedScenario] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenarioId));
    expect(updatedScenario!.resultRunId).toBe(jobId);
    expect((updatedScenario!.result as { status: string } | null)?.status).toBe("optimal");
  }, 65000);
});
