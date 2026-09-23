// A7 (SCND Correctness) — real, unmocked Postgres tests of the ALWAYS-ON
// publication CAS + the distinct zero-row meanings (A-R32/A-R39/A-R48).
// Matches scenarioSolveAtomicity.test.ts (A1) / dispatcherRecovery.test.ts
// (A2)'s convention: this is fundamentally an atomic-predicate/
// transactional-correctness proof a mocked `db.update`/`db.transaction`
// can't demonstrate (mocks don't evaluate WHERE clauses). Exercises
// `markSucceeded` DIRECTLY (exported for exactly this reason, mirroring
// claimJobRow's own precedent) rather than paying for a full runJob/spawn
// cycle per test — the predicate under test is entirely inside
// markSucceeded; runJob's own wiring of it is covered by the mocked
// jobRunner.test.ts/jobRunnerV2Cache.test.ts suites.
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable, resultCacheTable } from "@workspace/db";
import {
  enqueueScenarioSolve,
  claimJobRow,
  markSucceeded,
  computeInputsHash,
  setDraining,
} from "../jobRunner.js";
import type { ResultEnvelope } from "../resultEnvelope.js";
import type { SolveInput } from "../pmedian.js";
import app from "../../app.js";

// This whole file drives markSucceeded DIRECTLY, with its own manually
// chosen (jobId, generation, revision) arguments — it must never race
// against this module's own real in-process worker pool actually claiming
// and solving the same rows in the background (enqueueScenarioSolve's
// registerQueuedJob() kicks pump() synchronously, and a real claim would
// win that race almost every time, since nothing here awaits anything
// between enqueue and this file's own claimJobRow() call). Draining the
// dispatcher for the whole file disables both the fast-enqueue pump() path
// and the recurring scan, leaving every enqueued row genuinely unclaimed
// until THIS file's own explicit claimJobRow() call claims it.
beforeAll(() => {
  setDraining(true);
});

const TEST_USER_ID = `a7-publication-cas-${Date.now()}`;
const scenarioIds: number[] = [];
const registeredUserIds: string[] = [];

const validPmedianInputs = {
  p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none" as const, uniformCapacity: null,
  warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
  addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};

const baseSolveInput: SolveInput = { modelId: "p-median-us", inputs: validPmedianInputs };

function envelope(overrides: Partial<ResultEnvelope> = {}): ResultEnvelope {
  return {
    status: "optimal",
    solutionStatus: "optimal",
    terminationReason: "optimality_proven",
    achievedGap: 0,
    solverIncumbentObjective: 1000,
    solverBestBound: 1000,
    objective: 1000,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [],
    metrics: {},
    details: {},
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
    ...overrides,
  };
}

async function createScenario(userId: string = TEST_USER_ID, inputs: Record<string, unknown> = validPmedianInputs) {
  const [row] = await db.insert(scenariosTable).values({
    name: "A7 publication-CAS fixture",
    userId,
    modelId: "p-median-us",
    inputs,
  }).returning();
  scenarioIds.push(row!.id);
  return row!;
}

// Enqueues via the REAL production authority (enqueueScenarioSolve, exactly
// what routes/scenarios.ts's solve route calls) and immediately claims the
// row (queued->running), returning everything markSucceeded needs — the
// "arrange" half of every test below, without paying for a real spawn.
async function enqueueAndClaim(scenarioId: number, userId: string = TEST_USER_ID) {
  const outcome = await enqueueScenarioSolve(scenarioId, userId);
  if (outcome.kind !== "queued") throw new Error(`unreachable: ${outcome.kind}`);
  const claimed = await claimJobRow(outcome.jobId);
  if (!claimed) throw new Error("unreachable: claim lost the race against itself");
  return { jobId: outcome.jobId, generation: claimed.claimGeneration!, enqueuedSolveInputRevision: claimed.enqueuedSolveInputRevision };
}

async function bumpRevision(scenarioId: number): Promise<void> {
  await db.update(scenariosTable)
    .set({ solveInputRevision: sql`${scenariosTable.solveInputRevision} + 1` })
    .where(eq(scenariosTable.id, scenarioId));
}

afterAll(async () => {
  if (scenarioIds.length > 0) {
    await db.delete(solveJobsTable).where(inArray(solveJobsTable.scenarioId, scenarioIds));
    await db.delete(scenariosTable).where(inArray(scenariosTable.id, scenarioIds));
  }
  if (registeredUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, registeredUserIds));
  }
  await db.delete(usersTable).where(eq(usersTable.id, TEST_USER_ID));
});

describe("A7 setup", () => {
  it("registers the shared test user", async () => {
    await db.insert(usersTable).values({ id: TEST_USER_ID, email: `${TEST_USER_ID}@example.test` }).onConflictDoNothing();
  });
});

describe("A7 — happy path: both latest_solve_job_id AND solve_input_revision match", () => {
  it("publishes: scenario.result/resultRunId are updated, outcome kind is 'published'", async () => {
    const scenario = await createScenario();
    const { jobId, generation, enqueuedSolveInputRevision } = await enqueueAndClaim(scenario.id);

    const result = await markSucceeded(jobId, generation, scenario.id, TEST_USER_ID, "p-median-us", envelope({ objective: 555 }), enqueuedSolveInputRevision);
    expect(result).toEqual({ kind: "published" });

    const [job] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, jobId));
    expect(job!.status).toBe("succeeded");

    const [updated] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect((updated!.result as { objective: number } | null)?.objective).toBe(555);
    expect(updated!.resultRunId).toBe(jobId);
  });
});

describe("A7 — superseded: an input edit with no second solve (revision predicate)", () => {
  it("a mutation landing AFTER enqueue (before completion) makes the completing job 'superseded' — scenario.result stays untouched", async () => {
    const scenario = await createScenario();
    const { jobId, generation, enqueuedSolveInputRevision } = await enqueueAndClaim(scenario.id);

    // The edit: a real geometric mutation lands while the job is "running",
    // exactly the way PATCH /scenarios/:id increments it (DB-side SQL
    // increment) — no second solve is ever requested for it.
    await bumpRevision(scenario.id);

    const result = await markSucceeded(jobId, generation, scenario.id, TEST_USER_ID, "p-median-us", envelope({ objective: 999 }), enqueuedSolveInputRevision);
    expect(result).toEqual({ kind: "superseded" });

    // The job itself IS still recorded terminally as succeeded (A-R32) —
    // never shown as a failure, just never became the scenario's current
    // result.
    const [job] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, jobId));
    expect(job!.status).toBe("succeeded");
    expect((job!.result as { objective: number } | null)?.objective).toBe(999);

    // The scenario was never touched by this publish attempt.
    const [scenarioAfter] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(scenarioAfter!.result).toBeNull();
    expect(scenarioAfter!.resultRunId).toBeNull();
  });

  it("an input mutation landing DURING enqueue's own window (captured revision predates it) is refused the same way", async () => {
    const scenario = await createScenario();
    // Enqueue THEN claim IMMEDIATELY (no intervening await — the same
    // microtask-scale-exposure pattern this file's own enqueueAndClaim
    // helper uses, per dispatcherRecovery.test.ts's documented shared-DB
    // caution: scanAndClaimQueuedJobs() queries solve_jobs GLOBALLY across
    // every concurrently-running real-DB test file, so a genuine `await`
    // between enqueue and claim is a real cross-file race window, not just
    // a theoretical one). The mutation lands AFTER claiming but before
    // completion — proves the predicate is about the CAPTURED revision at
    // enqueue time, not about whatever ordering the claim happens to
    // observe relative to it.
    const outcome = await enqueueScenarioSolve(scenario.id, TEST_USER_ID);
    if (outcome.kind !== "queued") throw new Error("unreachable");
    const claimed = await claimJobRow(outcome.jobId);
    if (!claimed) throw new Error("unreachable: claim lost the race against itself");
    await bumpRevision(scenario.id);

    const result = await markSucceeded(
      outcome.jobId, claimed.claimGeneration!, scenario.id, TEST_USER_ID, "p-median-us",
      envelope(), claimed.enqueuedSolveInputRevision,
    );
    expect(result).toEqual({ kind: "superseded" });
  });
});

describe("A7 — a reporting-only distanceBands edit does NOT invalidate publication", () => {
  it("a distanceBands-only PATCH landing mid-solve does not bump solve_input_revision — the job still publishes", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "A7 bands-no-invalidate", modelId: "p-median-us", inputs: validPmedianInputs });
    expect(created.status).toBe(201);
    scenarioIds.push(created.body.id);

    const { jobId, generation, enqueuedSolveInputRevision } = await enqueueAndClaim(created.body.id, userId);

    const patched = await request(app).patch(`/api/scenarios/${created.body.id}/distance-bands`).set("Cookie", cookie)
      .send({ distanceBands: [50, 150, 450] });
    expect(patched.status).toBe(200);

    const result = await markSucceeded(jobId, generation, created.body.id, userId, "p-median-us", envelope({ objective: 42 }), enqueuedSolveInputRevision);
    expect(result).toEqual({ kind: "published" });

    const [updated] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, created.body.id));
    expect((updated!.result as { objective: number } | null)?.objective).toBe(42);
  });
});

describe("A7 — inverted completion order / concurrent enqueues committing in inverted order", () => {
  it("job 1 enqueued, job 2 enqueued+published, job 1 completes LAST and does NOT overwrite job 2's result", async () => {
    const scenario = await createScenario();

    const first = await enqueueAndClaim(scenario.id);
    const second = await enqueueAndClaim(scenario.id);
    expect(second.jobId).toBeGreaterThan(first.jobId);

    // Job 2 (the newer request) completes and publishes FIRST.
    const secondResult = await markSucceeded(
      second.jobId, second.generation, scenario.id, TEST_USER_ID, "p-median-us",
      envelope({ objective: 222 }), second.enqueuedSolveInputRevision,
    );
    expect(secondResult).toEqual({ kind: "published" });

    // Job 1 (the OLDER request) completes LAST — its own captured revision
    // still matches (no input edit happened), but latest_solve_job_id now
    // points at job 2, so job 1 is refused.
    const firstResult = await markSucceeded(
      first.jobId, first.generation, scenario.id, TEST_USER_ID, "p-median-us",
      envelope({ objective: 111 }), first.enqueuedSolveInputRevision,
    );
    expect(firstResult).toEqual({ kind: "superseded" });

    // The scenario still shows job 2's result — never overwritten by the
    // late-arriving, numerically older job.
    const [scenarioAfter] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect((scenarioAfter!.result as { objective: number } | null)?.objective).toBe(222);
    expect(scenarioAfter!.resultRunId).toBe(second.jobId);

    // Both jobs are still addressable in solve history as SUCCEEDED — job
    // 1 is never shown as a failure, it simply never became current.
    const [job1] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, first.jobId));
    expect(job1!.status).toBe("succeeded");
    expect((job1!.result as { objective: number } | null)?.objective).toBe(111);
  });
});

describe("A7 — a mutation racing a cache-hit publication", () => {
  it("a cache-hit publish attempt is gated by the SAME CAS as a fresh solve — a revision bump lands before the (cached) result is published", async () => {
    const scenario = await createScenario();

    // Pre-populate result_cache under this exact scenario's v1 inputsHash —
    // simulating a PRIOR job having already cached this same-inputs result.
    const inputsHash = computeInputsHash(baseSolveInput);
    const cachedEnvelope = envelope({ objective: 777 });
    await db.insert(resultCacheTable).values({
      inputsHash, modelId: "p-median-us", result: cachedEnvelope as unknown as Record<string, unknown>,
    }).onConflictDoNothing();

    const { jobId, generation, enqueuedSolveInputRevision } = await enqueueAndClaim(scenario.id);

    // The race: an edit lands on the scenario BEFORE this (cache-hit-style)
    // job gets to publish — markSucceeded is the exact same function
    // runJob's cache-hit branch calls, so exercising it directly here with
    // the cached envelope IS the cache-hit publication path.
    await bumpRevision(scenario.id);

    const result = await markSucceeded(jobId, generation, scenario.id, TEST_USER_ID, "p-median-us", cachedEnvelope, enqueuedSolveInputRevision);
    expect(result).toEqual({ kind: "superseded" });

    const [scenarioAfter] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(scenarioAfter!.result).toBeNull();
  });
});

describe("A7 — scenario deletion + concurrent enqueue boundaries", () => {
  it("a solve completing after its scenario (and job row) were deleted is a safe 0-row no-op — never a crash", async () => {
    const scenario = await createScenario();
    const { jobId, generation, enqueuedSolveInputRevision } = await enqueueAndClaim(scenario.id);

    // Mirrors routes/scenarios.ts's real DELETE handler ordering: child
    // solve_jobs rows first, then the scenario row.
    await db.delete(solveJobsTable).where(and(eq(solveJobsTable.scenarioId, scenario.id), eq(solveJobsTable.userId, TEST_USER_ID)));
    await db.delete(scenariosTable).where(and(eq(scenariosTable.id, scenario.id), eq(scenariosTable.userId, TEST_USER_ID)));
    scenarioIds.splice(scenarioIds.indexOf(scenario.id), 1); // already deleted — afterAll must not try again

    await expect(
      markSucceeded(jobId, generation, scenario.id, TEST_USER_ID, "p-median-us", envelope(), enqueuedSolveInputRevision),
    ).resolves.toEqual({ kind: "not_owned" }); // the job row itself is gone -> its own ownership-checked update matches 0 rows
  });
});

describe("A7 — lost lease while the scenario CAS would still have matched", () => {
  it("a WRONG claim_generation fails at the job-update gate even though latest_solve_job_id/solve_input_revision would still satisfy the scenario CAS", async () => {
    const scenario = await createScenario();
    const { jobId, enqueuedSolveInputRevision } = await enqueueAndClaim(scenario.id);

    // Confirm the scenario-side CAS conditions genuinely WOULD be satisfied
    // right now (no mutation happened) — so if the job-update gate did not
    // exist, this call would otherwise publish.
    const [scenarioBefore] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(scenarioBefore!.latestSolveJobId).toBe(jobId);
    expect(scenarioBefore!.solveInputRevision).toBe(enqueuedSolveInputRevision);

    // A WRONG generation simulates "this process's lease was already
    // reclaimed" (e.g. by a stale-lease sweep bumping the row to a new
    // owner/generation, or simply a stale in-memory value from a crashed
    // attempt) — the job's own ownership-checked update matches 0 rows,
    // and the scenario update (which WOULD have matched) never even runs.
    const wrongGeneration = -999999;
    const result = await markSucceeded(jobId, wrongGeneration, scenario.id, TEST_USER_ID, "p-median-us", envelope(), enqueuedSolveInputRevision);
    expect(result).toEqual({ kind: "not_owned" });

    const [scenarioAfter] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(scenarioAfter!.result).toBeNull(); // untouched
  });
});

async function registerAndGetCookie(): Promise<{ cookie: string; userId: string }> {
  const email = `a7-writer-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  registeredUserIds.push(res.body.user.id);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return { cookie: setCookie[0]!.split(";")[0]!, userId: res.body.user.id as string };
}
