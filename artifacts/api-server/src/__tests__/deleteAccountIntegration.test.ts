/**
 * WQF-B5 — account deletion against a real database. No db mock. Requires a
 * live DATABASE_URL (local nos_dev only). Root CLAUDE.md migration-test rule:
 * the destructive function is called ONLY with ids this file created, and
 * cleanup is scoped to those ids. Two users per test: a victim and a bystander,
 * so "exactly the user's rows go and nobody else's" is observable.
 */
import { describe, it, expect, afterAll, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db, usersTable, scenariosTable, solveJobsTable, feedbackTable, resultCacheTable,
  watbotConversationsTable, watbotMessagesTable, watbotReportsTable, watbotFeedbackTable,
} from "@workspace/db";
import app from "../app.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";
import { deleteAccountData } from "../services/deleteAccount.js";
import { enqueueScenarioSolve, setAfterScenarioLockForTests, setDraining } from "../solver/jobRunner.js";

const PASSWORD = "correcthorse1";
const createdUserIds: string[] = [];
const createdFeedbackIds: number[] = [];
const createdCacheHashes: string[] = [];

afterAll(async () => {
  if (createdUserIds.length) {
    await db.delete(solveJobsTable).where(inArray(solveJobsTable.userId, createdUserIds));
    await db.delete(scenariosTable).where(inArray(scenariosTable.userId, createdUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  }
  if (createdFeedbackIds.length) await db.delete(feedbackTable).where(inArray(feedbackTable.id, createdFeedbackIds));
  if (createdCacheHashes.length) await db.delete(resultCacheTable).where(inArray(resultCacheTable.inputsHash, createdCacheHashes));
});
beforeEach(() => resetLoginRateLimiterForTests());

async function registerUser(tag: string) {
  const email = `wqfb-del-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, acceptTerms: true });
  expect(res.status).toBe(201);
  createdUserIds.push(res.body.user.id);
  return { id: res.body.user.id as string, email, cookie: (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]! };
}

async function seedOwnedRows(userId: string) {
  const [scenario] = await db.insert(scenariosTable).values({ name: "wqfb-del", userId, modelId: "p-median-us", inputs: {} }).returning();
  const [job] = await db.insert(solveJobsTable)
    .values({ scenarioId: scenario!.id, userId, status: "succeeded", inputsHash: `wqfb-del-${scenario!.id}` }).returning();
  // Point the scenario's SET NULL FKs at the job, as a real solved scenario does.
  await db.update(scenariosTable).set({ latestSolveJobId: job!.id, resultRunId: job!.id }).where(eq(scenariosTable.id, scenario!.id));
  const [conv] = await db.insert(watbotConversationsTable).values({ userId, modelId: "p-median-us", title: "t" }).returning();
  const [msg] = await db.insert(watbotMessagesTable).values({ conversationId: conv!.id, userId, role: "tutor", blocks: [] }).returning();
  await db.insert(watbotReportsTable).values({ userId, messageId: msg!.id, reason: "other" });
  await db.insert(watbotFeedbackTable).values({ userId, conversationId: conv!.id, messageId: msg!.id, helped: true });
  return { scenarioId: scenario!.id };
}

async function counts(userId: string) {
  const n = async (q: Promise<unknown[]>) => (await q).length;
  return {
    users: await n(db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId))),
    scenarios: await n(db.select({ id: scenariosTable.id }).from(scenariosTable).where(eq(scenariosTable.userId, userId))),
    solveJobs: await n(db.select({ id: solveJobsTable.id }).from(solveJobsTable).where(eq(solveJobsTable.userId, userId))),
    conversations: await n(db.select({ id: watbotConversationsTable.id }).from(watbotConversationsTable).where(eq(watbotConversationsTable.userId, userId))),
    messages: await n(db.select({ id: watbotMessagesTable.id }).from(watbotMessagesTable).where(eq(watbotMessagesTable.userId, userId))),
    reports: await n(db.select({ id: watbotReportsTable.id }).from(watbotReportsTable).where(eq(watbotReportsTable.userId, userId))),
    feedback: await n(db.select({ id: watbotFeedbackTable.id }).from(watbotFeedbackTable).where(eq(watbotFeedbackTable.userId, userId))),
  };
}
const ONE_EACH = { users: 1, scenarios: 1, solveJobs: 1, conversations: 1, messages: 1, reports: 1, feedback: 1 };
const NONE = { users: 0, scenarios: 0, solveJobs: 0, conversations: 0, messages: 0, reports: 0, feedback: 0 };

const del = (cookie: string, password = PASSWORD) =>
  request(app).delete("/api/auth/account").set("Cookie", cookie).send({ password });

describe("DELETE /api/auth/account — real Postgres", () => {
  it("removes exactly the caller's rows (incl. cascades); the bystander, site feedback and the result cache stay", async () => {
    const victim = await registerUser("victim");
    const bystander = await registerUser("bystander");
    await seedOwnedRows(victim.id);
    await seedOwnedRows(bystander.id);
    const [fb] = await db.insert(feedbackTable).values({ body: `wqfb-del-marker-${Date.now()}` }).returning();
    createdFeedbackIds.push(fb!.id);
    const hash = `wqfb-del-cache-${Date.now()}`;
    await db.insert(resultCacheTable).values({ inputsHash: hash, modelId: "p-median-us", result: {} });
    createdCacheHashes.push(hash);
    expect(await counts(victim.id)).toEqual(ONE_EACH); // non-vacuity

    const res = await del(victim.cookie);
    expect(res.status).toBe(204);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^nos_session=;/);

    expect(await counts(victim.id)).toEqual(NONE);
    expect(await counts(bystander.id)).toEqual(ONE_EACH);
    expect(await db.select().from(feedbackTable).where(eq(feedbackTable.id, fb!.id))).toHaveLength(1);
    expect(await db.select().from(resultCacheTable).where(eq(resultCacheTable.inputsHash, hash))).toHaveLength(1);
    expect((await request(app).get("/api/scenarios").set("Cookie", victim.cookie)).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: victim.email, password: PASSWORD, acceptTerms: true })).status).toBe(401);
  });

  // A running job with a fresh heartbeat is never claimed or reaped by any
  // dispatcher (claims take only queued rows; the reaper takes heartbeats
  // older than 60s). The queued job is legacy-shaped (no input_snapshot), which
  // the dispatcher scan skips (jobRunner.ts:620-626). Root CLAUDE.md: another
  // session's dispatcher shares nos_dev — if this flakes, check the registry.
  for (const status of ["running", "queued"] as const) {
    it(`409s while a job is ${status}, and deletes nothing`, async () => {
      const victim = await registerUser(`busy-${status}`);
      const { scenarioId } = await seedOwnedRows(victim.id);
      await db.insert(solveJobsTable).values({
        scenarioId, userId: victim.id, status, inputsHash: `wqfb-del-busy-${scenarioId}`,
        ...(status === "running" ? { claimedAt: sql`now()`, ownerHeartbeatAt: sql`now()` } : {}),
      });
      const res = await del(victim.cookie);
      expect(res.status).toBe(409);
      expect({ ...(await counts(victim.id)), solveJobs: 1 }).toEqual(ONE_EACH);
      expect((await counts(victim.id)).solveJobs).toBe(2);
    });
  }

  it("403s a wrong password and deletes nothing", async () => {
    const victim = await registerUser("wrongpw");
    await seedOwnedRows(victim.id);
    expect((await del(victim.cookie, "not-my-password")).status).toBe(403);
    expect(await counts(victim.id)).toEqual(ONE_EACH);
  });

  // D11 — the deleted account's cookie is handled at the auth boundary.
  it("a second DELETE with the same cookie is a 401 that clears the cookie, and touches nobody else", async () => {
    const victim = await registerUser("twice");
    const bystander = await registerUser("twice-bystander");
    await seedOwnedRows(victim.id);
    await seedOwnedRows(bystander.id);

    const first = await del(victim.cookie);
    expect(first.status).toBe(204);
    expect(first.headers["set-cookie"]?.[0]).toMatch(/^nos_session=;.*Expires=Thu, 01 Jan 1970/);

    // A stale copy of the same cookie (another tab, a replay).
    const second = await del(victim.cookie);
    expect(second.status).toBe(401);
    expect(second.body).toEqual({ error: "Not authenticated" });
    expect(second.headers["set-cookie"]?.[0]).toMatch(/^nos_session=;.*Expires=Thu, 01 Jan 1970/);

    // The page-load check clears it too, and answers signed out.
    const me = await request(app).get("/api/auth/user").set("Cookie", victim.cookie);
    expect(me.body).toEqual({ user: null });
    expect(me.headers["set-cookie"]?.[0]).toMatch(/^nos_session=;/);

    // Non-vacuity: a request with no cookie at all is a plain 401 with nothing to clear.
    const anonymous = await request(app).delete("/api/auth/account").send({ password: PASSWORD });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers["set-cookie"]).toBeUndefined();

    expect(await counts(victim.id)).toEqual(NONE);
    expect(await counts(bystander.id)).toEqual(ONE_EACH);
  });
});

// D9 — deletion vs a concurrent solve enqueue for the SAME user, through the
// real enqueueScenarioSolve, with a fixed interleaving. Both tests deadlock
// (40P01, a rejected promise) if deleteAccountData locks the users row before
// the scenarios, which is the inversion they exist to catch.
describe("DELETE vs enqueue — lock order (real Postgres)", () => {
  // Valid delivery inputs (deliveryPrecheckIntegration.test.ts's defaults), so
  // the real enqueue passes validation and precheck and inserts a queued job.
  const DELIVERY_INPUTS = {
    p: 3, distanceBands: [400, 800, 1200, 1600], gap: 0, timeLimitSec: 120,
    costAdjustEnabled: false, distanceThreshold: 800, costPerMile: 1, costPerMileOver: 10,
    laneCostOverrides: [],
  };

  // This process never starts a queued job (pump() stops while draining). Another
  // session's dispatcher on the shared nos_dev may still claim it; the delete's
  // busy check counts queued AND running, so the outcome is the same either way.
  beforeAll(() => setDraining(true));
  afterAll(() => {
    setDraining(false);
    setAfterScenarioLockForTests(null);
  });

  async function solvableScenario(user: { cookie: string }): Promise<number> {
    const res = await request(app).post("/api/scenarios").set("Cookie", user.cookie)
      .send({ name: "wqfb-del-race", modelId: "delivery-teaching-us", inputs: DELIVERY_INPUTS });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function backendPid(conn: Pick<typeof db, "execute">): Promise<number> {
    const r = await conn.execute(sql`select pg_backend_pid() as pid`);
    return (r.rows[0] as { pid: number }).pid;
  }

  /** Polls until some backend waits on a lock `holderPid` holds (or is queued ahead for); returns its pid. */
  async function waitForBlockedBy(holderPid: number): Promise<number> {
    for (let i = 0; i < 200; i++) {
      const r = await db.execute(sql`select pid from pg_stat_activity where ${holderPid} = any(pg_blocking_pids(pid)) limit 1`);
      if (r.rows.length > 0) return (r.rows[0] as { pid: number }).pid;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`no backend became blocked by ${holderPid} within 5 s`);
  }

  it("enqueue first: deletion waits on its scenario lock, the job commits, deletion answers busy — no deadlock", async () => {
    const victim = await registerUser("race-enqueue-first");
    const scenarioId = await solvableScenario(victim);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const enqueuePid = new Promise<number>((resolve) => {
      // Parks the REAL enqueue after its scenario lock, before its users lock.
      setAfterScenarioLockForTests(async (tx) => { resolve(await backendPid(tx)); await gate; });
    });
    try {
      const enqueue = enqueueScenarioSolve(scenarioId, victim.id);
      const holder = await enqueuePid;
      setAfterScenarioLockForTests(null);
      const deletion = deleteAccountData(victim.id);
      await waitForBlockedBy(holder); // the deletion is waiting on the enqueue's scenario lock
      release();

      const [enqueued, deleted] = await Promise.allSettled([enqueue, deletion]);
      expect(enqueued).toEqual({ status: "fulfilled", value: expect.objectContaining({ kind: "queued" }) });
      expect(deleted).toEqual({ status: "fulfilled", value: "busy" });
      const after = await counts(victim.id);
      expect([after.users, after.scenarios, after.solveJobs]).toEqual([1, 1, 1]);
      // The route maps the same state to its documented 409, never a 500.
      expect((await del(victim.cookie)).status).toBe(409);
    } finally {
      setAfterScenarioLockForTests(null);
      release();
    }
  }, 20_000);

  it("deletion first: enqueue waits on deletion's scenario lock, deletion commits, enqueue answers not_found — no deadlock", async () => {
    const victim = await registerUser("race-delete-first");
    const scenarioId = await solvableScenario(victim);
    // Parks the deletion BETWEEN its two locks: this test transaction holds the
    // fixture user's row (and only that row) until released.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let parkerReady!: (pid: number) => void;
    const parkerPid = new Promise<number>((resolve) => { parkerReady = resolve; });
    const parker = db.transaction(async (tx) => {
      await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, victim.id)).for("update");
      parkerReady(await backendPid(tx));
      await gate;
    });
    try {
      const deletion = deleteAccountData(victim.id);
      const deletionPid = await waitForBlockedBy(await parkerPid); // holds the scenario lock, waits for the users row
      const enqueue = enqueueScenarioSolve(scenarioId, victim.id);
      await waitForBlockedBy(deletionPid); // the enqueue is waiting on the deletion's scenario lock
      release();
      await parker;

      const [deleted, enqueued] = await Promise.allSettled([deletion, enqueue]);
      expect(deleted).toEqual({ status: "fulfilled", value: "deleted" });
      expect(enqueued).toEqual({ status: "fulfilled", value: { kind: "not_found" } });
      expect(await counts(victim.id)).toEqual(NONE);
    } finally {
      release();
      await parker.catch(() => {});
    }
  }, 20_000);
});
