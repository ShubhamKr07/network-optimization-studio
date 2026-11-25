import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import argon2 from "argon2";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  WATBOT_MESSAGE_TYPES: [], coursePassagesTable: {}, // routes/index.ts now loads the WatBot router, which reads these at import
  usersTable: { id: "id", email: "email", termsVersion: "terms_version", termsAcceptedAt: "terms_accepted_at" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ col: _col, val })),
  // routes/auth.ts looks users up with `lower(email) = <normalized>` so that
  // rows written before email normalization still match their owner's login.
  // The stand-in keeps the interpolated values inspectable, which is how the
  // normalization tests below assert what the WHERE clause actually received.
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

import app from "../app.js";
import express from "express";
import cookieParser from "cookie-parser";
import { createHmac } from "node:crypto";
import { CURRENT_TERMS_VERSION } from "../lib/terms.js";
import { requireAuth, sessionCookieValue, SESSION_SECRET, SESSION_TTL_MS } from "../middlewares/auth.js";

type Chain = Record<string, ReturnType<typeof vi.fn>>;

function makeChain(returnValue: unknown): Chain {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "insert", "values", "returning", "update", "set"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(returnValue).then(resolve);
  return chain as Chain;
}

/** The value interpolated into `lower(email) = ?` on the Nth select. */
function emailInWhereClause(chain: Chain, call = 0): unknown {
  const arg = chain.where.mock.calls[call]?.[0] as { values?: unknown[] } | undefined;
  return arg?.values?.[1];
}

const OVER_LONG_PASSWORD = "a".repeat(129);

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.select.mockReturnValue(makeChain([]));
});

describe("POST /api/auth/register", () => {
  it("returns 201 with the created user and sets the session cookie", async () => {
    mockDb.insert.mockReturnValue(
      makeChain([{ id: "user-1", email: "student@example.com", role: "student" }]),
    );
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "student@example.com", password: "supersecret", acceptTerms: true });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ id: "user-1", email: "student@example.com", role: "student" });
    expect(res.headers["set-cookie"]?.[0]).toMatch(/nos_session=/);
  });

  it("returns 409 when the email already exists, without leaking password match", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com" }]));
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "student@example.com", password: "supersecret", acceptTerms: true });

    expect(res.status).toBe(409);
    expect(res.body.error).not.toMatch(/password/i);
  });

  it("returns 400 when password is shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "student@example.com", password: "short", acceptTerms: true });
    expect(res.status).toBe(400);
  });

  it("returns 400 without hashing when the password exceeds 128 characters", async () => {
    const hashSpy = vi.spyOn(argon2, "hash");
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "student@example.com", password: OVER_LONG_PASSWORD, acceptTerms: true });

    expect(res.status).toBe(400);
    // The whole point of the cap: argon2 is the expensive part, so an
    // over-long password must never reach it.
    expect(hashSpy).not.toHaveBeenCalled();
    hashSpy.mockRestore();
  });

  it("accepts a password of exactly 128 characters (the bound is inclusive)", async () => {
    mockDb.insert.mockReturnValue(
      makeChain([{ id: "user-128", email: "bound@example.com", role: "student" }]),
    );
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "bound@example.com", password: "a".repeat(128), acceptTerms: true });

    expect(res.status).toBe(201);
  });

  it("stores the email trimmed and lowercased, and checks uniqueness the same way", async () => {
    const selectChain = makeChain([]);
    mockDb.select.mockReturnValue(selectChain);
    const insertChain = makeChain([
      { id: "user-9", email: "student@example.com", role: "student" },
    ]);
    mockDb.insert.mockReturnValue(insertChain);

    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "  Student@Example.COM  ", password: "supersecret", acceptTerms: true });

    expect(res.status).toBe(201);
    // Uniqueness is checked against the normalized form...
    expect(emailInWhereClause(selectChain)).toBe("student@example.com");
    // ...and the normalized form is what lands in the row, so the next login
    // with any casing resolves to this same account.
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ email: "student@example.com" }),
    );
  });

  it("returns 409 for an email that differs only in case from an existing account", async () => {
    mockDb.select.mockReturnValue(
      makeChain([{ id: "user-1", email: "student@example.com" }]),
    );
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "STUDENT@example.com", password: "supersecret", acceptTerms: true });

    expect(res.status).toBe(409);
  });
});

describe("session cookie flags by environment", () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("sets SameSite=Lax and no Secure flag outside production", async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "development" };
    mockDb.insert.mockReturnValue(
      makeChain([{ id: "user-2", email: "dev@example.com", role: "student" }]),
    );
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "dev@example.com", password: "supersecret", acceptTerms: true });

    const setCookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Secure/i);
  });

  it("sets SameSite=None and Secure in production", async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "production" };
    mockDb.insert.mockReturnValue(
      makeChain([{ id: "user-3", email: "prod@example.com", role: "student" }]),
    );
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "prod@example.com", password: "supersecret", acceptTerms: true });

    const setCookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toMatch(/SameSite=None/i);
    expect(setCookie).toMatch(/Secure/i);
  });
});

describe("POST /api/auth/login", () => {
  it("returns 200 with the user and sets the session cookie on valid credentials", async () => {
    const passwordHash = await argon2.hash("correct-horse");
    mockDb.select.mockReturnValue(
      makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash, termsVersion: CURRENT_TERMS_VERSION }]),
    );
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "student@example.com", password: "correct-horse", acceptTerms: true });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: "user-1", email: "student@example.com" });
    expect(res.headers["set-cookie"]?.[0]).toMatch(/nos_session=/);
  });

  it("returns 401 with a generic message on wrong password", async () => {
    const passwordHash = await argon2.hash("correct-horse");
    mockDb.select.mockReturnValue(
      makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash, termsVersion: CURRENT_TERMS_VERSION }]),
    );
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "student@example.com", password: "wrong-password", acceptTerms: true });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("returns the identical 401 body for an unknown email (no user enumeration)", async () => {
    // Default beforeEach: select returns []
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "whatever1", acceptTerms: true });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("logs in an account registered under a different casing", async () => {
    // The regression this branch exists for: the student registered as
    // `Student@Example.com` and is now typing `student@example.com`. Both
    // spellings normalize to one lookup value, and the lookup itself is
    // case-insensitive, so the stored row still matches.
    const passwordHash = await argon2.hash("correct-horse");
    const selectChain = makeChain([
      { id: "user-1", email: "Student@Example.com", role: "student", passwordHash, termsVersion: CURRENT_TERMS_VERSION },
    ]);
    mockDb.select.mockReturnValue(selectChain);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "  STUDENT@example.COM ", password: "correct-horse", acceptTerms: true });

    expect(res.status).toBe(200);
    expect(emailInWhereClause(selectChain)).toBe("student@example.com");
  });

  it("rejects an over-long password before the DB lookup or argon2 ever run", async () => {
    const verifySpy = vi.spyOn(argon2, "verify");
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "student@example.com", password: OVER_LONG_PASSWORD, acceptTerms: true });

    expect(res.status).toBe(401);
    // Indistinguishable from any other bad credential — the cap must not
    // become an oracle.
    expect(res.body.error).toBe("Invalid email or password");
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(verifySpy).not.toHaveBeenCalled();
    verifySpy.mockRestore();
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the session cookie and returns success", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(res.headers["set-cookie"]?.[0]).toMatch(/nos_session=;/);
  });
});

describe("GET /api/auth/user", () => {
  it("returns user: null when no session cookie is present", async () => {
    const res = await request(app).get("/api/auth/user");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it("returns the user for a cookie issued by login, and null once the password hash changes", async () => {
    const row = { id: "user-1", email: "student@example.com", role: "student", passwordHash: await argon2.hash("supersecret"), termsVersion: CURRENT_TERMS_VERSION };
    mockDb.select.mockReturnValue(makeChain([row]));
    const login = await request(app).post("/api/auth/login").send({ email: row.email, password: "supersecret", acceptTerms: true });
    const cookie = (login.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

    const ok = await request(app).get("/api/auth/user").set("Cookie", cookie);
    expect(ok.body).toEqual({ user: { id: "user-1", email: "student@example.com", role: "student" } });

    mockDb.select.mockReturnValue(makeChain([{ ...row, passwordHash: await argon2.hash("reset-password") }]));
    const revoked = await request(app).get("/api/auth/user").set("Cookie", cookie);
    expect(revoked.body).toEqual({ user: null });
  });
});

// SEC-2 — the session is bound to the user's current password hash and to an
// issued-at time, checked against the users row on every request.
describe("requireAuth middleware", () => {
  const HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaGhhc2hoYXNo";
  const row = { id: "user-1", email: "a@b.c", role: "student", passwordHash: HASH, termsVersion: CURRENT_TERMS_VERSION };

  async function run(cookie: unknown) {
    const req = { signedCookies: { nos_session: cookie } } as any;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const clearCookie = vi.fn();
    const next = vi.fn();
    await requireAuth(req, { status, clearCookie } as any, next);
    return { req, status, json, next, clearCookie };
  }

  it("returns 401 JSON and does not call next() when no session cookie is present", async () => {
    const { status, next, clearCookie } = await run(undefined);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(clearCookie).not.toHaveBeenCalled();
  });

  it("sets req.userId and calls next() for a current session", async () => {
    mockDb.select.mockReturnValue(makeChain([row]));
    const { req, next } = await run(sessionCookieValue(row));
    expect(req.userId).toBe("user-1");
    expect(next).toHaveBeenCalledOnce();
  });

  it("401s a session issued before the password changed", async () => {
    const cookie = sessionCookieValue(row);
    mockDb.select.mockReturnValue(makeChain([{ ...row, passwordHash: HASH + "x" }]));
    const { status, next } = await run(cookie);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s a session older than SESSION_TTL_MS", async () => {
    vi.useFakeTimers({ now: Date.now() - SESSION_TTL_MS - 1000 });
    const cookie = sessionCookieValue(row);
    vi.useRealTimers();
    mockDb.select.mockReturnValue(makeChain([row]));
    const { status, next } = await run(cookie);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s a session whose user has not accepted the current terms (WQF-B4 one-time log-out)", async () => {
    const cookie = sessionCookieValue(row);
    for (const termsVersion of [null, "1999-01-01"]) {
      mockDb.select.mockReturnValue(makeChain([{ ...row, termsVersion }]));
      const { status, next } = await run(cookie);
      expect(status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("401s a deleted user AND clears the cookie, so the browser stops sending it (WQF-B6 D11)", async () => {
    const cookie = sessionCookieValue(row);
    mockDb.select.mockReturnValue(makeChain([]));
    const { status, clearCookie } = await run(cookie);
    expect(status).toHaveBeenCalledWith(401);
    expect(clearCookie).toHaveBeenCalledWith("nos_session", expect.objectContaining({ path: "/" }));
  });

  it("401s a pre-SEC-2 cookie (bare user id) without a DB lookup", async () => {
    const { status } = await run("user-1");
    expect(status).toHaveBeenCalledWith(401);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("looks the session up once per request, however many routers mount requireAuth", async () => {
    mockDb.select.mockReturnValue(makeChain([row]));
    const probe = express();
    probe.use(cookieParser(SESSION_SECRET));
    for (let i = 0; i < 6; i++) {
      const r = express.Router();
      r.use(requireAuth);
      probe.use(r);
    }
    probe.get("/probe", (req, res) => res.json({ userId: req.userId }));
    const v = sessionCookieValue(row);
    const signed = `s:${v}.${createHmac("sha256", SESSION_SECRET).update(v).digest("base64").replace(/=+$/, "")}`;
    const res = await request(probe).get("/probe").set("Cookie", `nos_session=${encodeURIComponent(signed)}`);
    expect(res.body).toEqual({ userId: "user-1" });
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("answers 500, not 401, when the lookup fails", async () => {
    const cookie = sessionCookieValue(row);
    const chain = makeChain([]);
    (chain as { then: unknown }).then = (_ok: unknown, fail: (e: Error) => void) => Promise.reject(new Error("db down")).catch(fail);
    mockDb.select.mockReturnValue(chain);
    const { status, json, next } = await run(cookie);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: "Could not verify your session." });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("WQF-B3 — terms consent at register and log-in", () => {
  const hashOf = (pw: string) => argon2.hash(pw);

  it("refuses to register without acceptTerms: true, before any lookup or insert", async () => {
    for (const extra of [{}, { acceptTerms: false }]) {
      const res = await request(app).post("/api/auth/register")
        .send({ email: "student@example.com", password: "supersecret", ...extra });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Accept the Terms of Service and the Privacy Notice to create an account." });
    }
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("records the current terms version and a DB-side time on the new row", async () => {
    const insertChain = makeChain([{ id: "user-1", email: "student@example.com", role: "student", termsVersion: CURRENT_TERMS_VERSION }]);
    mockDb.insert.mockReturnValue(insertChain);
    const res = await request(app).post("/api/auth/register")
      .send({ email: "student@example.com", password: "supersecret", acceptTerms: true });
    expect(res.status).toBe(201);
    const values = insertChain.values.mock.calls[0]![0] as Record<string, unknown>;
    expect(values.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(values.termsAcceptedAt).toBeDefined();
  });

  it("403s terms_required with no cookie when the stored version is stale and acceptTerms is absent", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash: await hashOf("supersecret"), termsVersion: null }]));
    const res = await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "supersecret" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "terms_required" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("checks the password before the terms: a wrong password is still the generic 401", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash: await hashOf("supersecret"), termsVersion: null }]));
    const res = await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid email or password" });
  });

  it("records acceptance and logs in when acceptTerms is true and the stored version is stale", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash: await hashOf("supersecret"), termsVersion: "1999-01-01" }]));
    const updateChain = makeChain([]);
    mockDb.update.mockReturnValue(updateChain);
    const res = await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "supersecret", acceptTerms: true });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/nos_session=/);
    const written = updateChain.set.mock.calls[0]![0] as Record<string, unknown>;
    expect(written.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(written.termsAcceptedAt).toBeDefined();
  });

  it("does not write the users row when the stored version is already current (D2)", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash: await hashOf("supersecret"), termsVersion: CURRENT_TERMS_VERSION }]));
    const res = await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "supersecret", acceptTerms: true });
    expect(res.status).toBe(200);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("a failed acceptance write is the route's own 500, and its params never reach the body", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash: await hashOf("supersecret"), termsVersion: null }]));
    const chain = makeChain([]);
    (chain as { then: unknown }).then = (_ok: unknown, fail: (e: Error) => void) =>
      Promise.reject(new Error("Failed query: update users\nparams: SECRET-USER-ID")).catch(fail);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).post("/api/auth/login").send({ email: "student@example.com", password: "supersecret", acceptTerms: true });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Could not sign in." });
    expect(JSON.stringify(res.body)).not.toContain("SECRET-USER-ID");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
