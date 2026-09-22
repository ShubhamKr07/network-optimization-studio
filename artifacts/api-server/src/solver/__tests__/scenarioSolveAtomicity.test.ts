// A1 (SCND Correctness) — real, unmocked Postgres tests (matches
// jobRunnerRealIntegration.test.ts's convention). enqueueScenarioSolve's
// whole point is real transactional/locking behavior that a mocked
// `db.transaction` cannot prove — see routes.test.ts's own comment on why
// its solve-route tests deliberately mock enqueueScenarioSolve away instead
// of re-proving this here.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, usersTable, scenariosTable, solveJobsTable } from "@workspace/db";
import { enqueueScenarioSolve, RECOVERY_CONTRACT_IDENTITY } from "../jobRunner.js";
import app from "../../app.js";

const TEST_USER_ID = `a1-scenario-atomicity-${Date.now()}`;
const OTHER_USER_ID = `a1-scenario-atomicity-other-${Date.now()}`;
const scenarioIds: number[] = [];
const registeredUserIds: string[] = [];

const validPmedianInputs = {
  p: 3, distanceBands: [200, 400, 800, 1600], capacityMode: "none", uniformCapacity: null,
  warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 30,
  addedWarehouses: [], addedCustomers: [], distanceOverrides: [],
};

async function createScenario(userId: string, inputs: Record<string, unknown> = validPmedianInputs) {
  const [row] = await db.insert(scenariosTable).values({
    name: "A1 atomicity fixture",
    userId,
    modelId: "p-median-us",
    inputs,
  }).returning();
  scenarioIds.push(row!.id);
  return row!;
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
  await db.delete(usersTable).where(eq(usersTable.id, OTHER_USER_ID));
});

describe("A1 — scenarios.solve_input_revision (Class 2, three-step-migrated)", () => {
  it("a freshly created scenario starts at revision 1 (no row is ever null post-backfill)", async () => {
    await db.insert(usersTable).values({ id: TEST_USER_ID, email: `${TEST_USER_ID}@example.test` }).onConflictDoNothing();
    const scenario = await createScenario(TEST_USER_ID);
    expect(scenario.solveInputRevision).toBe(1);
  });

  it("no scenario row anywhere has a null solve_input_revision (the backfill's own verification, re-checked live)", async () => {
    const [row] = await db.execute(sql`SELECT count(*)::int AS n FROM scenarios WHERE solve_input_revision IS NULL`).then((r) => r.rows as { n: number }[]);
    expect(row.n).toBe(0);
  });

  // A-R55 — the increment is DB-side SQL (`col = col + 1`), never a
  // read-modify-write in app code, specifically so two CONCURRENT mutations
  // can't both read n and both write n+1 (losing one). Proven here against a
  // REAL Postgres row with two genuinely concurrent UPDATE statements.
  it("revision advances by EXACTLY TWO under two simultaneous mutations (real concurrent SQL increments)", async () => {
    const scenario = await createScenario(TEST_USER_ID);
    const increment = () =>
      db.update(scenariosTable)
        .set({ solveInputRevision: sql`${scenariosTable.solveInputRevision} + 1` })
        .where(eq(scenariosTable.id, scenario.id));

    await Promise.all([increment(), increment()]);

    const [after] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(after!.solveInputRevision).toBe(3); // 1 (initial) + 2
  });
});

describe("A1 — enqueueScenarioSolve (the atomic enqueue authority transaction)", () => {
  it("returns not_found for a nonexistent scenario id", async () => {
    const outcome = await enqueueScenarioSolve(999999999, TEST_USER_ID);
    expect(outcome).toEqual({ kind: "not_found" });
  });

  it("returns not_found (never a leak) for a scenario owned by a DIFFERENT user — hard rule #5", async () => {
    await db.insert(usersTable).values({ id: OTHER_USER_ID, email: `${OTHER_USER_ID}@example.test` }).onConflictDoNothing();
    const scenario = await createScenario(TEST_USER_ID);
    const outcome = await enqueueScenarioSolve(scenario.id, OTHER_USER_ID);
    expect(outcome).toEqual({ kind: "not_found" });
  });

  it("happy path: locks the row, inserts a durable job row, and advances latest_solve_job_id", async () => {
    const scenario = await createScenario(TEST_USER_ID);

    const outcome = await enqueueScenarioSolve(scenario.id, TEST_USER_ID);
    expect(outcome.kind).toBe("queued");
    if (outcome.kind !== "queued") throw new Error("unreachable");

    const [job] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, outcome.jobId));
    expect(job).toBeDefined();
    expect(job!.modelId).toBe("p-median-us");
    expect(job!.inputSnapshot).toEqual({ modelId: "p-median-us", inputs: validPmedianInputs });
    // Requested-limit values/sources (Q79) — read straight off the locked
    // row's own inputs, source pinned to the literal 'request'.
    expect(job!.requestedGap).toBe(0);
    expect(job!.requestedGapSource).toBe("request");
    expect(job!.requestedTimeLimitSec).toBe(30);
    expect(job!.requestedTimeLimitSource).toBe("request");
    // Enqueued-revision capture: a brand new scenario is at revision 1.
    expect(job!.enqueuedSolveInputRevision).toBe(1);
    // Recovery-contract identity persisted at enqueue — full 64-hex digest,
    // matching the same constant computed once at process boot.
    expect(job!.recoveryContractIdentity).toBe(RECOVERY_CONTRACT_IDENTITY);
    expect(job!.recoveryContractIdentity).toMatch(/^[0-9a-f]{64}$/);

    const [updatedScenario] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(updatedScenario!.latestSolveJobId).toBe(outcome.jobId);
  });

  // Error mapping — a revalidation failure on the LOCKED row (not the
  // caller's stale belief) returns the same synchronous 422/no-job outcome
  // the pre-lock path always gave. Simulates "an invalid mutation racing
  // the lock" by writing a shape-invalid `inputs` blob directly (bypassing
  // the route's own validateInputsForModel gate, exactly the way a genuine
  // race between a read and an enqueue could theoretically smuggle one in).
  it("an invalid mutation racing the lock returns kind:'invalid' and creates NO job row", async () => {
    const scenario = await createScenario(TEST_USER_ID, { ...validPmedianInputs, capacityMode: "not-a-real-mode" });

    const beforeCount = await db.select().from(solveJobsTable).where(eq(solveJobsTable.scenarioId, scenario.id));
    const outcome = await enqueueScenarioSolve(scenario.id, TEST_USER_ID);
    expect(outcome.kind).toBe("invalid");

    const afterCount = await db.select().from(solveJobsTable).where(eq(solveJobsTable.scenarioId, scenario.id));
    expect(afterCount.length).toBe(beforeCount.length); // no job was ever inserted
  });

  it("a network-edit precheck failure on the locked row returns kind:'precheck_failed' and creates NO job row", async () => {
    // An id-collision precheck failure: an added warehouse reusing a real
    // base-dataset id ("ALN" — Allentown, PA — is a real p-median-us base
    // warehouse id).
    const scenario = await createScenario(TEST_USER_ID, {
      ...validPmedianInputs,
      addedWarehouses: [{ id: "ALN", city: "X", state: "XX", lat: 0, lng: 0, status: "active" }],
    });

    const outcome = await enqueueScenarioSolve(scenario.id, TEST_USER_ID);
    expect(outcome.kind).toBe("precheck_failed");
    if (outcome.kind !== "precheck_failed") throw new Error("unreachable");
    expect(outcome.errors.length).toBeGreaterThan(0);
    expect(outcome.errors.some((e) => e.code === "id_collision")).toBe(true);

    const jobs = await db.select().from(solveJobsTable).where(eq(solveJobsTable.scenarioId, scenario.id));
    expect(jobs.length).toBe(0);
  });

  // A-R32/A-R39 — the publication-authority DATA (this task's scope: A7
  // later reads it to gate publication, not implemented here). Proves the
  // two columns A7's future CAS depends on are captured correctly:
  //   - latest_solve_job_id always ends up pointing at the numerically
  //     GREATEST job id, never an earlier one, regardless of call order.
  //   - a job's own enqueued_solve_input_revision reflects the scenario's
  //     revision AT THE MOMENT it was enqueued — so an older job's captured
  //     revision provably does NOT match the scenario's CURRENT revision
  //     once a mutation has landed after it (exactly the mismatch A7's CAS
  //     will test against to refuse publishing it).
  it("an existing scenario solved BEFORE its first mutation captures revision 1 (matches current — would publish under A7's future CAS)", async () => {
    const scenario = await createScenario(TEST_USER_ID);
    const outcome = await enqueueScenarioSolve(scenario.id, TEST_USER_ID);
    if (outcome.kind !== "queued") throw new Error("unreachable");

    const [job] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, outcome.jobId));
    const [current] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    expect(job!.enqueuedSolveInputRevision).toBe(1);
    expect(current!.solveInputRevision).toBe(1);
    expect(current!.latestSolveJobId).toBe(outcome.jobId);
    // The exact predicate A7 will apply: BOTH match => this job is still
    // authorized to publish.
    expect(job!.enqueuedSolveInputRevision).toBe(current!.solveInputRevision);
    expect(current!.latestSolveJobId).toBe(job!.id);
  });

  it("an existing scenario solved AFTER its first mutation captures the advanced revision (older job's capture now mismatches — would be refused under A7's future CAS)", async () => {
    const scenario = await createScenario(TEST_USER_ID);

    const firstOutcome = await enqueueScenarioSolve(scenario.id, TEST_USER_ID);
    if (firstOutcome.kind !== "queued") throw new Error("unreachable");
    const [firstJob] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, firstOutcome.jobId));
    expect(firstJob!.enqueuedSolveInputRevision).toBe(1);

    // A real geometric input mutation, exactly the way PATCH /scenarios/:id
    // increments it (DB-side SQL increment).
    await db.update(scenariosTable)
      .set({ solveInputRevision: sql`${scenariosTable.solveInputRevision} + 1` })
      .where(eq(scenariosTable.id, scenario.id));

    const secondOutcome = await enqueueScenarioSolve(scenario.id, TEST_USER_ID);
    if (secondOutcome.kind !== "queued") throw new Error("unreachable");
    const [secondJob] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, secondOutcome.jobId));
    const [current] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));

    expect(secondJob!.enqueuedSolveInputRevision).toBe(2);
    expect(current!.solveInputRevision).toBe(2);
    // The first (older) job's captured revision no longer matches the
    // scenario's CURRENT revision — the exact mismatch A7's future CAS uses
    // to refuse publishing a superseded job's result.
    expect(firstJob!.enqueuedSolveInputRevision).not.toBe(current!.solveInputRevision);
    // latest_solve_job_id points at the second (newer) job, not the first.
    expect(current!.latestSolveJobId).toBe(secondJob!.id);
    expect(current!.latestSolveJobId).not.toBe(firstJob!.id);
  });

  // A-R32 — two concurrent enqueues committing in INVERTED order (the
  // numerically SMALLER job id's transaction happens to commit its
  // scenario-pointer update AFTER the numerically LARGER job id's own
  // update already landed) must not let the older job become "latest".
  // Simulated deterministically here (rather than relying on true DB
  // scheduling luck) by directly re-applying the exact same conditional
  // UPDATE predicate enqueueScenarioSolve uses, out of order.
  it("latest_solve_job_id only ever advances — a late-arriving update for an OLDER job id is a no-op", async () => {
    const scenario = await createScenario(TEST_USER_ID);

    const outcomeA = await enqueueScenarioSolve(scenario.id, TEST_USER_ID);
    const outcomeB = await enqueueScenarioSolve(scenario.id, TEST_USER_ID);
    if (outcomeA.kind !== "queued" || outcomeB.kind !== "queued") throw new Error("unreachable");
    expect(outcomeB.jobId).toBeGreaterThan(outcomeA.jobId);

    const [afterBoth] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(afterBoth!.latestSolveJobId).toBe(outcomeB.jobId);

    // Simulate job A's own conditional pointer-update "arriving late" (the
    // exact predicate enqueueScenarioSolve applies) — it must be a no-op
    // because outcomeA.jobId < the already-stored outcomeB.jobId.
    await db.update(scenariosTable)
      .set({ latestSolveJobId: outcomeA.jobId })
      .where(and(
        eq(scenariosTable.id, scenario.id),
        sql`${scenariosTable.latestSolveJobId} IS NULL OR ${scenariosTable.latestSolveJobId} < ${outcomeA.jobId}`,
      ));

    const [afterLateA] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, scenario.id));
    expect(afterLateA!.latestSolveJobId).toBe(outcomeB.jobId); // unchanged — B still wins
  });
});

describe("A1 — claim_generation sequence (solve_jobs_claim_generation_seq)", () => {
  it("values are strictly increasing across simulated boots (real Postgres sequence, nextval read twice)", async () => {
    const first = await db.execute(sql`SELECT nextval('solve_jobs_claim_generation_seq') AS v`);
    const second = await db.execute(sql`SELECT nextval('solve_jobs_claim_generation_seq') AS v`);
    const a = Number((first.rows[0] as { v: string | number }).v);
    const b = Number((second.rows[0] as { v: string | number }).v);
    expect(b).toBeGreaterThan(a);
  });
});

describe("A1 — solve_jobs CHECK constraints (DB mirrors of the TypeScript enums)", () => {
  let checksScenarioId: number;

  async function insertJobRow(overrides: Partial<typeof solveJobsTable.$inferInsert>) {
    if (checksScenarioId === undefined) {
      const scenario = await createScenario(TEST_USER_ID);
      checksScenarioId = scenario.id;
    }
    return db.insert(solveJobsTable).values({
      scenarioId: checksScenarioId,
      userId: TEST_USER_ID,
      status: "queued",
      inputsHash: "test-hash",
      ...overrides,
    }).returning({ id: solveJobsTable.id });
  }

  it("error_code rejects any value outside {SOLVE_FAILED, TIMEOUT}", async () => {
    await expect(insertJobRow({ errorCode: "NOT_A_REAL_CODE" })).rejects.toThrow();
  });

  it("error_code accepts SOLVE_FAILED and TIMEOUT", async () => {
    const a = await insertJobRow({ errorCode: "SOLVE_FAILED" });
    const b = await insertJobRow({ errorCode: "TIMEOUT" });
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });

  it("failure_reason rejects any value outside {internal_error, solver_error}", async () => {
    await expect(insertJobRow({ failureReason: "bogus_reason" })).rejects.toThrow();
  });

  it("failure_stage rejects any value outside the 9-value enum", async () => {
    await expect(insertJobRow({ failureStage: "bogus_stage" })).rejects.toThrow();
  });

  it("requested_gap_source rejects any value but the literal 'request'", async () => {
    await expect(insertJobRow({ requestedGapSource: "default" })).rejects.toThrow();
  });

  it("requested_time_limit_source rejects any value but the literal 'request'", async () => {
    await expect(insertJobRow({ requestedTimeLimitSource: "default" })).rejects.toThrow();
  });

  it("requested_gap_source/requested_time_limit_source accept the literal 'request'", async () => {
    const result = await insertJobRow({ requestedGapSource: "request", requestedTimeLimitSource: "request" });
    expect(result.length).toBe(1);
  });

  // §2.11 — the 2048-BYTE bound uses octet_length, not character length, so
  // a multibyte string within the character-ish range but over the byte
  // budget is correctly rejected (character length() would under-count and
  // silently admit ~4x the intended budget).
  it("error_detail rejects a value whose BYTE length (not character length) exceeds 2048 via a multibyte string", async () => {
    // Each '€' is 3 bytes in UTF-8 -> 700 chars = 2100 bytes, over budget,
    // while a character-counting check would see only 700 "characters" and
    // wrongly allow it.
    const oversized = "€".repeat(700);
    expect(Buffer.byteLength(oversized, "utf8")).toBeGreaterThan(2048);
    await expect(insertJobRow({ errorDetail: oversized })).rejects.toThrow();
  });

  it("error_detail accepts a multibyte string within the 2048-byte budget", async () => {
    const withinBudget = "€".repeat(600); // 1800 bytes
    expect(Buffer.byteLength(withinBudget, "utf8")).toBeLessThanOrEqual(2048);
    const result = await insertJobRow({ errorDetail: withinBudget });
    expect(result.length).toBe(1);
  });
});

describe("A1 — historical-null tolerance on read paths", () => {
  it("a solve_jobs row written with none of the A1 columns set reads back with every new column null, without crashing", async () => {
    const scenario = await createScenario(TEST_USER_ID);
    const [job] = await db.insert(solveJobsTable).values({
      scenarioId: scenario.id,
      userId: TEST_USER_ID,
      status: "queued",
      inputsHash: "legacy-pre-a1-row",
      // Deliberately omit every A1 column — simulates a row that predates
      // this migration (drizzle omits => DB default/null applies).
    }).returning();

    const [reread] = await db.select().from(solveJobsTable).where(eq(solveJobsTable.id, job!.id));
    expect(reread!.modelId).toBeNull();
    expect(reread!.inputSnapshot).toBeNull();
    expect(reread!.failureReason).toBeNull();
    expect(reread!.failureStage).toBeNull();
    expect(reread!.errorCode).toBeNull();
    expect(reread!.errorDetail).toBeNull();
    expect(reread!.requestedGap).toBeNull();
    expect(reread!.requestedTimeLimitSec).toBeNull();
    expect(reread!.requestedGapSource).toBeNull();
    expect(reread!.requestedTimeLimitSource).toBeNull();
    expect(reread!.claimGeneration).toBeNull();
    expect(reread!.claimedAt).toBeNull();
    expect(reread!.ownerHeartbeatAt).toBeNull();
    expect(reread!.enqueuedSolveInputRevision).toBeNull();
    expect(reread!.recoveryContractIdentity).toBeNull();
  });

  it("scenarios.latest_solve_job_id reads back null for a scenario that has never been solved", async () => {
    const scenario = await createScenario(TEST_USER_ID);
    expect(scenario.latestSolveJobId).toBeNull();
  });
});

// A1 — writer enumeration, proven end-to-end over the REAL app + REAL DB
// (real HTTP registration/session, no mocking anywhere): every solve-
// relevant input writer increments solve_input_revision EXCEPT the
// reporting-only distanceBands-only PATCH.
describe("A1 — writer enumeration, real HTTP (PATCH /scenarios/:id vs the distanceBands-only PATCH)", () => {
  async function registerAndGetCookie(): Promise<string> {
    const email = `a1-writer-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
    registeredUserIds.push(res.body.user.id);
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    return setCookie[0]!.split(";")[0]!;
  }

  it("a geometric PATCH /scenarios/:id (changing p) increments solve_input_revision by 1", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "writer-enum p-median", modelId: "p-median-us", inputs: validPmedianInputs });
    expect(created.status).toBe(201);
    scenarioIds.push(created.body.id);

    const patched = await request(app).patch(`/api/scenarios/${created.body.id}`).set("Cookie", cookie)
      .send({ inputs: { ...validPmedianInputs, p: 4 } });
    expect(patched.status).toBe(200);

    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, created.body.id));
    expect(row!.solveInputRevision).toBe(2);
  });

  it("a distanceBands-only PATCH /scenarios/:id/distance-bands does NOT increment solve_input_revision (reporting lens, not a model constraint)", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "writer-enum bands-only", modelId: "p-median-us", inputs: validPmedianInputs });
    expect(created.status).toBe(201);
    scenarioIds.push(created.body.id);

    const patched = await request(app).patch(`/api/scenarios/${created.body.id}/distance-bands`).set("Cookie", cookie)
      .send({ distanceBands: [100, 300, 900] });
    expect(patched.status).toBe(200);

    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, created.body.id));
    expect(row!.solveInputRevision).toBe(1); // unchanged
  });

  // A PATCH whose ONLY changed inputs key is distanceBands (via the GENERAL
  // PATCH /scenarios/:id endpoint, not the dedicated field-scoped route)
  // must ALSO be treated as non-geometric — same exception, same route.
  it("a PATCH /scenarios/:id whose sole changed inputs key is distanceBands does NOT increment solve_input_revision either", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "writer-enum bands-only-general-patch", modelId: "p-median-us", inputs: validPmedianInputs });
    expect(created.status).toBe(201);
    scenarioIds.push(created.body.id);

    const patched = await request(app).patch(`/api/scenarios/${created.body.id}`).set("Cookie", cookie)
      .send({ inputs: { ...validPmedianInputs, distanceBands: [111, 222, 999] } });
    expect(patched.status).toBe(200);

    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, created.body.id));
    expect(row!.solveInputRevision).toBe(1); // unchanged
  });

  it("import/apply (a geometric write) increments solve_input_revision by 1", async () => {
    const cookie = await registerAndGetCookie();
    const created = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "writer-enum import-apply", modelId: "p-median-us", inputs: validPmedianInputs });
    expect(created.status).toBe(201);
    scenarioIds.push(created.body.id);

    // A minimal customers CSV override — one real base customer id with an
    // edited demand value (a genuine geometric change).
    const exportRes = await request(app).get(`/api/scenarios/${created.body.id}/export?entity=customers&format=csv`).set("Cookie", cookie);
    expect(exportRes.status).toBe(200);
    const lines = (exportRes.text as string).trim().split("\n");
    const header = lines[0]!;
    const firstDataLine = lines[1]!.split(",");
    // demand is the last column per templates.ts's customer CSV shape.
    firstDataLine[firstDataLine.length - 1] = String(Number(firstDataLine[firstDataLine.length - 1]) + 1000);
    const csvText = [header, firstDataLine.join(",")].join("\n");

    const applied = await request(app).post(`/api/scenarios/${created.body.id}/import/apply`).set("Cookie", cookie)
      .send({ entity: "customers", csvText, mode: "partial" });
    expect(applied.status).toBe(200);

    const [row] = await db.select().from(scenariosTable).where(eq(scenariosTable.id, created.body.id));
    expect(row!.solveInputRevision).toBe(2);
  });
});
