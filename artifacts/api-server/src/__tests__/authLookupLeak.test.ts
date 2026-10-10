import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createHmac } from "node:crypto";
import { logger } from "../lib/logger.js";

const mockDb = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: mockDb,
  usersTable: { id: "id", email: "email" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  gt: vi.fn(),
  and: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));
const mockCaptureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/node", async (orig) => ({
  ...(await orig<typeof import("@sentry/node")>()),
  captureException: mockCaptureException,
}));
vi.mock("../lib/email.js", () => ({ sendEmail: vi.fn() }));

import app from "../app.js";
import { resetForgotPasswordLimitersForTests, resetLoginRateLimiterForTests } from "../routes/auth.js";

/** A rejecting query chain whose error text carries the param, as drizzle's does. */
function failingSelect(secret: string, column: string) {
  const err = () =>
    new Error(`Failed query: select "id" from "users" where ${column} = $1\nparams: ${secret}`);
  const chain: Record<string, unknown> = {};
  ["select", "from", "where"].forEach((m) => (chain[m] = vi.fn(() => chain)));
  (chain as { then: unknown }).then = (_ok: unknown, fail: (e: Error) => void) =>
    Promise.reject(err()).catch(fail);
  return chain;
}

// JSON.stringify(new Error(..)) is "{}" (message is non-enumerable), which would
// make every "not.toContain" below pass with the leak intact. Render errors out.
const dump = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (x instanceof Error ? `${x.message}\n${x.stack}` : x));
const flush = () => new Promise((r) => setImmediate(r));
const signed = (v: string) =>
  encodeURIComponent(
    `s:${v}.${createHmac("sha256", process.env.SESSION_SECRET || "arcadia-dev-secret").update(v).digest("base64").replace(/=+$/, "")}`,
  );

beforeEach(() => {
  vi.clearAllMocks();
  resetLoginRateLimiterForTests();
  resetForgotPasswordLimitersForTests();
});

describe("a failed user lookup never carries its params into an error sink", () => {
  it("/auth/login answers 500 (not 401) and the email reaches no sink", async () => {
    mockDb.select.mockReturnValue(failingSelect("victim@example.com", 'lower("users"."email")'));
    const logSpy = vi.spyOn(logger, "error");

    const res = await request(app).post("/api/auth/login").send({ email: "victim@example.com", password: "whatever-pw" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Could not sign in." });
    expect(logSpy).toHaveBeenCalledWith({ step: "user-lookup-by-email" }, "user lookup failed");
    expect(dump([res.body, logSpy.mock.calls, mockCaptureException.mock.calls])).not.toContain("victim@example.com");
    logSpy.mockRestore();
  });

  it("/auth/forgot-password swallows the failure and the email reaches no sink", async () => {
    mockDb.select.mockReturnValue(failingSelect("victim@example.com", 'lower("users"."email")'));
    const logSpy = vi.spyOn(logger, "error");

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "victim@example.com" });
    await flush();
    await flush();

    expect(res.status).toBe(200);
    expect(logSpy).toHaveBeenCalled(); // non-vacuity: the failure was observed
    expect(dump([res.body, logSpy.mock.calls, mockCaptureException.mock.calls])).not.toContain("victim@example.com");
    logSpy.mockRestore();
  });

  it("/auth/user answers 500 and the user id reaches no sink", async () => {
    mockDb.select.mockReturnValue(failingSelect("victim-user-id-123", '"users"."id"'));
    const logSpy = vi.spyOn(logger, "error");

    const res = await request(app).get("/api/auth/user").set("Cookie", `nos_session=${signed("victim-user-id-123")}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Could not load your account." });
    expect(logSpy).toHaveBeenCalledWith({ step: "auth-user-lookup" }, "current user lookup failed");
    expect(dump([res.body, logSpy.mock.calls, mockCaptureException.mock.calls])).not.toContain("victim-user-id-123");
    logSpy.mockRestore();
  });
});

describe("a failed register insert never carries its params into an error sink", () => {
  it("/auth/register answers 500 and neither the email nor the password hash reaches any sink", async () => {
    const hash = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaGhhc2hoYXNo";
    // existence check finds no account
    const empty: Record<string, unknown> = {};
    ["select", "from", "where"].forEach((m) => (empty[m] = vi.fn(() => empty)));
    (empty as { then: unknown }).then = (ok: (v: unknown[]) => void) => Promise.resolve([]).then(ok);
    mockDb.select.mockReturnValue(empty);
    const err = () =>
      new Error(`Failed query: insert into "users" ("id", "email", "password_hash", "role") values (default, $1, $2, $3)\nparams: victim@example.com,${hash},student`);
    const ins: Record<string, unknown> = {};
    ["values", "returning"].forEach((m) => (ins[m] = vi.fn(() => ins)));
    (ins as { then: unknown }).then = (_ok: unknown, fail: (e: Error) => void) => Promise.reject(err()).catch(fail);
    mockDb.insert.mockReturnValue(ins);
    const logSpy = vi.spyOn(logger, "error");

    const res = await request(app).post("/api/auth/register").send({ email: "victim@example.com", password: "a-long-enough-pw" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Could not create your account." });
    expect(logSpy).toHaveBeenCalledWith({ step: "register-insert" }, "user insert failed");
    const sinks = dump([res.body, logSpy.mock.calls, mockCaptureException.mock.calls]);
    expect(sinks).not.toContain("victim@example.com");
    expect(sinks).not.toContain("argon2id");
    logSpy.mockRestore();
  });

  it("/auth/register answers 500 when the existence check itself fails", async () => {
    mockDb.select.mockReturnValue(failingSelect("victim@example.com", 'lower("users"."email")'));
    const res = await request(app).post("/api/auth/register").send({ email: "victim@example.com", password: "a-long-enough-pw" });
    expect(res.status).toBe(500);
    expect(dump([res.body, mockCaptureException.mock.calls])).not.toContain("victim@example.com");
  });
});
