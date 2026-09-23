// A-fix (F3) — the coverage hole that let F1 (composePublishedResult had
// ZERO production callers, so the output-export legacy-unverified gate
// 409'd EVERY user PERMANENTLY) through: no existing test ever ran a real
// solve end-to-end and then tried to export its output data. Every other
// export test in this repo (routes.test.ts's "GET /api/scenarios/:id/export"
// describe block) mocks the scenario's stored `result` directly, never a
// genuine `enqueueScenarioSolve` -> real solve.py -> markSucceeded round
// trip — so a wiring gap in THAT publish path was invisible to the suite.
//
// This file is a REAL, unmocked integration test (same convention as
// solver/__tests__/scenarioSolveAtomicity.test.ts and
// solver/__tests__/jobRunnerRealIntegration.test.ts): real HTTP app, real
// Postgres, real child_process.spawn of solve.py, real fd3 protocol. No
// `vi.mock` of jobRunner/db/child_process anywhere in this file. Requires a
// live DATABASE_URL (same requirement as those two files and routes.test.ts).
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import { isLegacyUnverifiedResult } from "../routes/scenarios.js";
import app from "../app.js";

const registeredUserIds: string[] = [];
const scenarioIds: number[] = [];

afterAll(async () => {
  if (scenarioIds.length > 0) {
    for (const id of scenarioIds) {
      await db.delete(solveJobsTable).where(eq(solveJobsTable.scenarioId, id));
    }
    for (const id of scenarioIds) {
      await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
    }
  }
  for (const id of registeredUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

async function registerAndGetCookie(): Promise<string> {
  const email = `a-fix-f3-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie[0]!.split(";")[0]!;
}

const validPmedianInputs = {
  p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
  warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
  addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};

// Polls the REAL solve-job status endpoint (not the DB directly) — exercises
// the same public poll surface the frontend actually uses.
async function pollSolveJob(cookie: string, scenarioId: number, jobId: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request(app).get(`/api/scenarios/${scenarioId}/solve-jobs/${jobId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    if (res.body.status === "succeeded" || res.body.status === "failed") {
      return res.body.status as string;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`solve job ${jobId} did not terminate within ${timeoutMs}ms`);
}

describe("A-fix (F3) — a freshly-solved scenario's output data actually exports (real solve -> real export)", () => {
  it("register -> create scenario -> real solve -> export assignments -> 200", async () => {
    const cookie = await registerAndGetCookie();

    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "F3 solve->export proof", modelId: "p-median-us", inputs: validPmedianInputs });
    expect(created.status).toBe(201);
    const scenarioId = created.body.id as number;
    scenarioIds.push(scenarioId);

    const solveRes = await request(app).post(`/api/scenarios/${scenarioId}/solve`).set("Cookie", cookie);
    expect(solveRes.status).toBe(202);
    const jobId = solveRes.body.jobId as number;

    const finalStatus = await pollSolveJob(cookie, scenarioId, jobId, 60000);
    expect(finalStatus).toBe("succeeded");

    // The whole point of F1/F3: a genuinely fresh, truthful solve's output
    // data must be exportable — NOT 409 "LEGACY_RESULT_REQUIRES_RESOLVE".
    const exportRes = await request(app)
      .get(`/api/scenarios/${scenarioId}/export?entity=assignments&format=json`)
      .set("Cookie", cookie);
    expect(exportRes.status).toBe(200);

    // Also confirm the openWarehouses grid — a second, independent output
    // entity — exports cleanly too (not entity-specific luck).
    const openWhRes = await request(app)
      .get(`/api/scenarios/${scenarioId}/export?entity=openWarehouses&format=json`)
      .set("Cookie", cookie);
    expect(openWhRes.status).toBe(200);
  }, 65000);
});

// A-fix (F3, per explicit coordinator follow-up) — the CONVERGENCE property:
// re-solving a genuinely pre-B scenario clears the "legacy unverified"
// export block in exactly ONE pass, proving the resolve prompt terminates
// rather than looping forever (independent of the v2 flag, which defaults
// off and is never touched by this file).
describe("A-fix (F3) — convergence: re-solving a pre-B scenario clears the export block in one pass", () => {
  it("409 on a genuinely pre-B stored result -> real solve -> solutionStatus present, legacyUnverified:false, export 200", async () => {
    const cookie = await registerAndGetCookie();

    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "F3 convergence proof", modelId: "p-median-us", inputs: validPmedianInputs });
    expect(created.status).toBe(201);
    const scenarioId = created.body.id as number;
    scenarioIds.push(scenarioId);

    // Seed a genuinely PRE-B stored result directly on the row (no
    // solutionStatus/terminationReason at all — the exact shape
    // hasTruthfulStatusEvidence/normalizeLegacyResult treat as the ONLY
    // still-legacyUnverified case post A-fix). Written straight to the DB
    // (never through the PATCH route — F2 now rejects a client-supplied
    // `result` entirely) so this simulates a row that predates Bundle B,
    // exactly like the real historical rows this gate exists to catch.
    const now = new Date();
    const inThePast = new Date(now.getTime() - 60_000);
    await db.update(scenariosTable)
      .set({
        result: {
          status: "optimal",
          objective: 12345,
          runTimeSec: 0.4,
          quality: "Optimal",
          edges: [],
          metrics: {},
          details: {},
          solverUsed: "CBC (PuLP)",
          infeasibilityReason: null,
        },
        solvedAt: now,
        inputsUpdatedAt: inThePast, // must be <= solvedAt, or isStale() also 422s (a different gate than the one under test)
      })
      .where(eq(scenariosTable.id, scenarioId));

    const preResolveExport = await request(app)
      .get(`/api/scenarios/${scenarioId}/export?entity=assignments&format=json`)
      .set("Cookie", cookie);
    expect(preResolveExport.status).toBe(409);
    expect(preResolveExport.body.code).toBe("LEGACY_RESULT_REQUIRES_RESOLVE");

    // Re-solve — the real production path (enqueue + claim + run), through
    // the real HTTP route, exactly as a student clicking "Run Optimizer"
    // after seeing the "re-solve to produce a verified result" prompt would.
    const solveRes = await request(app).post(`/api/scenarios/${scenarioId}/solve`).set("Cookie", cookie);
    expect(solveRes.status).toBe(202);
    const jobId = solveRes.body.jobId as number;
    const finalStatus = await pollSolveJob(cookie, scenarioId, jobId, 60000);
    expect(finalStatus).toBe("succeeded");

    const [updated] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenarioId));
    const storedResult = updated!.result as Record<string, unknown>;
    // The fresh solve wrote a genuinely truthful row: a real solutionStatus
    // is present (never null/absent, unlike the seeded pre-B row above).
    expect(storedResult.solutionStatus).not.toBeNull();
    expect(storedResult.solutionStatus).not.toBeUndefined();
    expect(isLegacyUnverifiedResult(storedResult)).toBe(false);

    // The SAME export, same entity, same scenario — now 200. One pass, not
    // a loop: exactly one solve cleared the block.
    const postResolveExport = await request(app)
      .get(`/api/scenarios/${scenarioId}/export?entity=assignments&format=json`)
      .set("Cookie", cookie);
    expect(postResolveExport.status).toBe(200);
  }, 65000);
});
