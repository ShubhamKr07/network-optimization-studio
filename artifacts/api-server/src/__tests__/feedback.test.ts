// COSM-4 — real HTTP app against real Postgres, following
// jadeCoefficientPrecheckIntegration.test.ts's convention: NO `vi.mock` of
// `db` anywhere in this file. Requires a live DATABASE_URL.
//
// `routes.test.ts`'s `loginAs` is not reusable here: it is file-local and
// db-mocked. Supertest has no persistent agent in this codebase's style, so
// every call sets the session cookie explicitly.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { eq, like, sql } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { db, usersTable, feedbackTable } from "@workspace/db";
import app from "../app.js";
import { logger } from "../lib/logger.js";
import { resetFeedbackRateLimiterForTests } from "../routes/feedback.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";

const MARKER = "cosm4-test-";
const registeredUserIds: string[] = [];

// Mirrors jadeCoefficientPrecheckIntegration.test.ts — register a fresh user
// and return its session cookie. Each case calls this, so the per-user
// limiter cannot leak across cases.
async function registerAndGetCookie(): Promise<string> {
  const email = `cosm4-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status).toBe(201);
  registeredUserIds.push(res.body.user.id);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie[0]!.split(";")[0]!;
}

afterAll(async () => {
  await db.delete(feedbackTable).where(like(feedbackTable.body, `${MARKER}%`));
  for (const id of registeredUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

describe("POST /api/feedback", () => {
  beforeEach(async () => {
    resetFeedbackRateLimiterForTests();
    resetLoginRateLimiterForTests();
    await db.delete(feedbackTable).where(like(feedbackTable.body, `${MARKER}%`));
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(app).post("/api/feedback").send({ body: `${MARKER}hello` });
    expect(res.status).toBe(401);
  });

  it("stores a trimmed row carrying no identity", async () => {
    const cookie = await registerAndGetCookie();
    const res = await request(app).post("/api/feedback").set("Cookie", cookie)
      .send({ body: `  ${MARKER}real feedback  ` });
    expect(res.status).toBe(204);

    const rows = await db.select().from(feedbackTable).where(like(feedbackTable.body, `${MARKER}%`));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe(`${MARKER}real feedback`); // trimmed
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    expect(Object.keys(rows[0]!).sort()).toEqual(["body", "createdAt", "id"]);
  });

  // Live-catalog half of the anonymity proof. The declared-schema half is in
  // schemaColumns.test.ts; the declared schema and the applied database can
  // disagree, and only the catalog proves what actually exists. Asserting the
  // EXACT column set is the point — "the row lacks a user property" proves
  // nothing, because a missing value and a missing column are
  // indistinguishable through the ORM.
  it("the live feedback table has no account, session, or IP column", async () => {
    const rows = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'feedback'
    `);
    const columns = (rows.rows as Array<{ column_name: string }>).map((r) => r.column_name).sort();
    expect(columns).toEqual(["body", "created_at", "id"]);
  });

  it("rejects empty, whitespace-only, and over-length bodies with 400", async () => {
    const cookie = await registerAndGetCookie();
    for (const body of ["", "   ", "x".repeat(4001)]) {
      const res = await request(app).post("/api/feedback").set("Cookie", cookie).send({ body });
      expect(res.status).toBe(400);
    }
    const rows = await db.select().from(feedbackTable).where(like(feedbackTable.body, `${MARKER}%`));
    expect(rows).toHaveLength(0);
  });

  it("rate-limits the sixth submission in a window and sets Retry-After", async () => {
    const cookie = await registerAndGetCookie();
    for (let i = 0; i < 5; i++) {
      const ok = await request(app).post("/api/feedback").set("Cookie", cookie).send({ body: `${MARKER}${i}` });
      expect(ok.status).toBe(204);
    }
    const blocked = await request(app).post("/api/feedback").set("Cookie", cookie).send({ body: `${MARKER}6` });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  // The body must not escape when the insert fails. drizzle-orm 0.45.2 builds
  // DrizzleQueryError's message as `Failed query: ${query}\nparams: ${params}`,
  // so the feedback text is inside the thrown error's OWN message — and the
  // three error sinks registered in app.ts (PostHog, Sentry, pino) all read
  // that message. lib/sentry.ts's scrubEvent only clears request data, never
  // an exception message, so the route's catch is the only thing containing it.
  it("does not leak the feedback body when the insert fails", async () => {
    const cookie = await registerAndGetCookie();
    const secret = `${MARKER}do-not-leak-this-sentence`;

    const leaky = new DrizzleQueryError(
      'insert into "feedback" ("body") values ($1)',
      [secret],
      new Error("connection terminated unexpectedly"),
    );
    // The hazard is real, not hypothetical: assert the shape this guards.
    expect(leaky.message).toContain(secret);

    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const insertSpy = vi.spyOn(db, "insert").mockImplementationOnce((() => {
      throw leaky;
    }) as never);
    try {
      const res = await request(app).post("/api/feedback").set("Cookie", cookie).send({ body: secret });

      expect(res.status).toBe(500);
      // The route's own message, NOT app.ts:103's "Internal server error" —
      // that distinction is the proof the error never reached the escape path
      // where all three sinks are mounted.
      expect(res.body).toEqual({ error: "Could not store feedback." });
      expect(res.text).not.toContain(secret);
      // app.ts:95 is the sink we can observe directly: it must never have run,
      // and nothing it was handed may carry the text.
      expect(logSpy).not.toHaveBeenCalled();
      for (const call of logSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(secret);
      }
    } finally {
      insertSpy.mockRestore();
      logSpy.mockRestore();
    }

    const rows = await db.select().from(feedbackTable).where(like(feedbackTable.body, `${MARKER}%`));
    expect(rows).toHaveLength(0);
  });

  it("does not let a malformed body consume quota", async () => {
    const cookie = await registerAndGetCookie();
    for (let i = 0; i < 10; i++) {
      const bad = await request(app).post("/api/feedback").set("Cookie", cookie).send({ body: "" });
      expect(bad.status).toBe(400);
    }
    const ok = await request(app).post("/api/feedback").set("Cookie", cookie).send({ body: `${MARKER}still allowed` });
    expect(ok.status).toBe(204);
  });
});
