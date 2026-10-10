import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import argon2 from "argon2";
import { logger } from "../lib/logger.js";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  usersTable: {
    id: "id",
    email: "email",
    passwordHash: "password_hash",
    resetTokenHash: "reset_token_hash",
    resetTokenExpiresAt: "reset_token_expires_at",
  },
}));

// The handler uses and()/gt() for the conditional UPDATE's WHERE, which
// auth.test.ts's drizzle mock does not provide.
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ op: "eq", col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ op: "gt", col, val })),
  and: vi.fn((...parts: unknown[]) => ({ op: "and", parts })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

// vi.hoisted is mandatory, not stylistic: vitest hoists `vi.mock` and the
// `import app from "../app.js"` below ABOVE a plain `const mockSendEmail =
// vi.fn()`, so the factory would dereference it before initialization and
// throw. This is why auth.test.ts's own mockDb uses vi.hoisted.
const mockSendEmail = vi.hoisted(() => vi.fn());
const mockCaptureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/node", async (orig) => ({
  ...(await orig<typeof import("@sentry/node")>()),
  captureException: mockCaptureException,
}));
vi.mock("../lib/email.js", () => ({ sendEmail: mockSendEmail }));

import app from "../app.js";
import { resetForgotPasswordLimitersForTests } from "../routes/auth.js";
import { hashResetToken } from "../lib/resetTokens.js";

type Chain = Record<string, ReturnType<typeof vi.fn>>;

function makeChain(returnValue: unknown): Chain {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "update", "set", "returning"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(returnValue).then(resolve);
  return chain as Chain;
}

// PWR-FU1 audit: `JSON.stringify(new Error("x"))` is `"{}"` — message and stack
// are non-enumerable — so a `not.toContain(secret)` over raw mock calls CANNOT
// FAIL when the secret leaks inside an Error, which is exactly how a
// DrizzleQueryError leaks its params. Render Errors explicitly. Mirrors the
// same helper in authLookupLeak.test.ts; duplicated on purpose rather than
// shared, so neither file's guard can be weakened by editing the other's.
const dump = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (x instanceof Error ? `${x.message}\n${x.stack}` : x));

// Non-vacuity of the helper itself: if this ever fails, every absence
// assertion below is meaningless.
it("dump() renders an Error's message, so the absence checks below can fail", () => {
  expect(dump(new Error("SECRET-PW-HASH"))).toContain("SECRET-PW-HASH");
  expect(JSON.stringify(new Error("SECRET-PW-HASH"))).not.toContain("SECRET-PW-HASH");
});

const USER = { id: "u1", email: "student@example.test", role: "student", passwordHash: "argon2-hash" };

/** The route answers before it sends, so tests must let the tail run. */
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.clearAllMocks();
  resetForgotPasswordLimitersForTests();
  mockSendEmail.mockResolvedValue(undefined);
  process.env.RESEND_API_KEY = "re_test";
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

describe("POST /api/auth/forgot-password", () => {
  it("returns 200 and writes a token for a known account", async () => {
    const selectChain = makeChain([USER]);
    const updateChain = makeChain([USER]);
    mockDb.select.mockReturnValue(selectChain);
    mockDb.update.mockReturnValue(updateChain);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "student@example.test" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    await flush();
    expect(updateChain.set).toHaveBeenCalledTimes(1);
    const written = updateChain.set.mock.calls[0]![0] as { resetTokenHash: string; resetTokenExpiresAt: Date };
    expect(written.resetTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(written.resetTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  // Non-vacuity: proves the token was hashed rather than stored raw. The
  // emailed link must contain a token that hashes TO the stored value and is
  // not itself the stored value.
  it("emails a raw token whose hash is what got stored", async () => {
    mockDb.select.mockReturnValue(makeChain([USER]));
    const updateChain = makeChain([USER]);
    mockDb.update.mockReturnValue(updateChain);

    await request(app).post("/api/auth/forgot-password").send({ email: "student@example.test" });
    await flush();

    const stored = (updateChain.set.mock.calls[0]![0] as { resetTokenHash: string }).resetTokenHash;
    const html = mockSendEmail.mock.calls[0]![2] as string;
    const emailed = /#token=([A-Za-z0-9_-]+)/.exec(html)?.[1];
    expect(emailed).toBeTruthy();
    expect(emailed).not.toBe(stored);
    expect(hashResetToken(emailed!)).toBe(stored);
  });

  it("returns the same 200 for an unknown account and writes nothing", async () => {
    mockDb.select.mockReturnValue(makeChain([]));
    const updateChain = makeChain([]);
    mockDb.update.mockReturnValue(updateChain);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@example.test" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    await flush();
    expect(updateChain.set).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("refuses to issue for a row with a null password_hash", async () => {
    mockDb.select.mockReturnValue(makeChain([{ ...USER, passwordHash: null }]));
    const updateChain = makeChain([]);
    mockDb.update.mockReturnValue(updateChain);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "student@example.test" });
    expect(res.status).toBe(200);

    await flush();
    expect(updateChain.set).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still returns 200 for a malformed body, and sends nothing", async () => {
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "not-an-email" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    await flush();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still returns 200 when the send fails", async () => {
    mockDb.select.mockReturnValue(makeChain([USER]));
    mockDb.update.mockReturnValue(makeChain([USER]));
    mockSendEmail.mockRejectedValue(new Error("Resend 500: boom"));

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "student@example.test" });
    expect(res.status).toBe(200);
    await flush();
  });

  it("429s the same address on the 4th request in an hour (per-address limiter)", async () => {
    mockDb.select.mockReturnValue(makeChain([]));
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await request(app).post("/api/auth/forgot-password").send({ email: "same@example.test" });
      statuses.push(r.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("the global cap trips at the 121st request across distinct addresses, without the per-address limiter firing", async () => {
    mockDb.select.mockReturnValue(makeChain([]));
    for (let i = 0; i < 120; i++) {
      const ok = await request(app).post("/api/auth/forgot-password").send({ email: `g${i}@example.test` });
      expect(ok.status).toBe(200);
    }
    const tripped = await request(app).post("/api/auth/forgot-password").send({ email: "g120@example.test" });
    expect(tripped.status).toBe(429);
  });

  // Non-vacuity of the leak assertions: the hash/token-hash a failed drizzle
  // query would carry in its message must not reach the logger or Sentry.
  it("a rejected token write is swallowed without its error reaching the logger or Sentry", async () => {
    mockDb.select.mockReturnValue(makeChain([USER]));
    const updateChain = makeChain([]);
    (updateChain as { then: unknown }).then = (_ok: unknown, fail: (e: Error) => void) =>
      Promise.reject(new Error("Failed query: update users\nparams: SECRET-TOKEN-HASH")).catch(fail);
    mockDb.update.mockReturnValue(updateChain);
    const logSpy = vi.spyOn(logger, "error");

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "student@example.test" });
    expect(res.status).toBe(200);
    await flush();
    await flush();

    expect(logSpy).toHaveBeenCalledWith({ step: "reset-token-write" }, "password reset token write failed");
    expect(dump(logSpy.mock.calls)).not.toContain("SECRET-TOKEN-HASH");
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

describe("POST /api/auth/reset-password", () => {
  it("sets the new password, consumes the token, and logs the caller in", async () => {
    const updateChain = makeChain([USER]);
    mockDb.update.mockReturnValue(updateChain);

    const res = await request(app).post("/api/auth/reset-password").send({ token: "raw-token", password: "correcthorse1" });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: "u1", email: "student@example.test", role: "student" });
    expect(res.headers["set-cookie"]?.[0]).toMatch(/nos_session=/);

    const written = updateChain.set.mock.calls[0]![0] as Record<string, unknown>;
    expect(written.resetTokenHash).toBeNull();
    expect(written.resetTokenExpiresAt).toBeNull();
    expect(typeof written.passwordHash).toBe("string");
    expect(written.passwordHash).not.toBe("correcthorse1");
  });

  it("matches on the HASH of the token, never the token itself", async () => {
    const updateChain = makeChain([USER]);
    mockDb.update.mockReturnValue(updateChain);
    await request(app).post("/api/auth/reset-password").send({ token: "raw-token", password: "correcthorse1" });

    const where = JSON.stringify(updateChain.where.mock.calls[0]![0]);
    expect(where).toContain(hashResetToken("raw-token"));
    expect(where).not.toContain("raw-token");
    // Expiry is enforced inside the UPDATE's WHERE, not in JS after a fetch.
    expect(where).toMatch(/"op":"gt"[^}]*reset_token_expires_at|reset_token_expires_at[^}]*"op":"gt"/);
    // Structural witness: the confirm path never SELECTs before updating.
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("returns the generic 400 when no row matches", async () => {
    mockDb.update.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/auth/reset-password").send({ token: "stale", password: "correcthorse1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This reset link is invalid or has expired.");
  });

  it("rejects a password under the minimum", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "t", password: "short" });
    expect(res.status).toBe(400);
  });

  it("rejects a password over the maximum before hashing", async () => {
    const updateChain = makeChain([]);
    mockDb.update.mockReturnValue(updateChain);
    const res = await request(app).post("/api/auth/reset-password").send({ token: "t", password: "a".repeat(129) });
    expect(res.status).toBe(400);
    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it("returns the generic 400, not the password message, for a missing or empty token", async () => {
    for (const body of [{ password: "correcthorse1" }, { token: "", password: "correcthorse1" }]) {
      const res = await request(app).post("/api/auth/reset-password").send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("This reset link is invalid or has expired.");
    }
  });

  it("keeps the password-length message for a good token and a 7-char password", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "t", password: "1234567" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^password must be \d+-\d+ characters$/);
  });

  it("caps concurrent hashes at 4: the 5th is a 429 that never reaches argon2, and slots free afterwards", async () => {
    mockDb.update.mockReturnValue(makeChain([]));
    const releases: Array<() => void> = [];
    const hashSpy = vi.spyOn(argon2, "hash").mockImplementation(
      () => new Promise<string>((resolve) => releases.push(() => resolve("h"))),
    );
    const send = () => request(app).post("/api/auth/reset-password").send({ token: "t", password: "correcthorse1" });

    const inFlight = [send(), send(), send(), send()].map((r) => r.then((x) => x));
    while (hashSpy.mock.calls.length < 4) await new Promise((r) => setTimeout(r, 5));

    const tripped = await send();
    expect(tripped.status).toBe(429);
    expect(tripped.body.error).toBe("Too many reset attempts, try again shortly");
    expect(hashSpy).toHaveBeenCalledTimes(4);

    releases.forEach((r) => r());
    const done = await Promise.all(inFlight);
    expect(done.map((d) => d.status)).toEqual([400, 400, 400, 400]);

    // Slots are back: a fresh request is admitted (and hashes).
    hashSpy.mockImplementation(async () => "h");
    expect((await send()).status).toBe(400);
    expect(hashSpy).toHaveBeenCalledTimes(5);
    hashSpy.mockRestore();
  });

  it("releases its slot when the hash throws, so the cap cannot wedge", async () => {
    mockDb.update.mockReturnValue(makeChain([]));
    const hashSpy = vi.spyOn(argon2, "hash").mockRejectedValue(new Error("argon2 boom"));
    const send = () => request(app).post("/api/auth/reset-password").send({ token: "t", password: "correcthorse1" });

    for (let i = 0; i < 6; i++) expect((await send()).status).toBe(500);
    hashSpy.mockRestore();
    expect((await send()).status).toBe(400);
  });

  it("a rejected password write answers 500 and the new hash never reaches the response, logger or Sentry", async () => {
    const updateChain = makeChain([]);
    (updateChain as { then: unknown }).then = (_ok: unknown, fail: (e: Error) => void) =>
      Promise.reject(new Error("Failed query: update users\nparams: $argon2id$SECRET-PW-HASH")).catch(fail);
    mockDb.update.mockReturnValue(updateChain);
    const logSpy = vi.spyOn(logger, "error");

    const res = await request(app).post("/api/auth/reset-password").send({ token: "t", password: "correcthorse1" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Could not set your new password." });
    expect(logSpy).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(dump([res.body, logSpy.mock.calls])).not.toContain("SECRET-PW-HASH");
    logSpy.mockRestore();
  });
});
