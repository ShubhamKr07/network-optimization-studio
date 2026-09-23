import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import argon2 from "argon2";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  usersTable: { id: "id", email: "email" },
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
import { requireAuth } from "../middlewares/auth.js";

type Chain = Record<string, ReturnType<typeof vi.fn>>;

function makeChain(returnValue: unknown): Chain {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "insert", "values", "returning"].forEach((m) => {
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
      .send({ email: "student@example.com", password: "supersecret" });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ id: "user-1", email: "student@example.com", role: "student" });
    expect(res.headers["set-cookie"]?.[0]).toMatch(/nos_session=/);
  });

  it("returns 409 when the email already exists, without leaking password match", async () => {
    mockDb.select.mockReturnValue(makeChain([{ id: "user-1", email: "student@example.com" }]));
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "student@example.com", password: "supersecret" });

    expect(res.status).toBe(409);
    expect(res.body.error).not.toMatch(/password/i);
  });

  it("returns 400 when password is shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "student@example.com", password: "short" });
    expect(res.status).toBe(400);
  });

  it("returns 400 without hashing when the password exceeds 128 characters", async () => {
    const hashSpy = vi.spyOn(argon2, "hash");
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "student@example.com", password: OVER_LONG_PASSWORD });

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
      .send({ email: "bound@example.com", password: "a".repeat(128) });

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
      .send({ email: "  Student@Example.COM  ", password: "supersecret" });

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
      .send({ email: "STUDENT@example.com", password: "supersecret" });

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
      .send({ email: "dev@example.com", password: "supersecret" });

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
      .send({ email: "prod@example.com", password: "supersecret" });

    const setCookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toMatch(/SameSite=None/i);
    expect(setCookie).toMatch(/Secure/i);
  });
});

describe("POST /api/auth/login", () => {
  it("returns 200 with the user and sets the session cookie on valid credentials", async () => {
    const passwordHash = await argon2.hash("correct-horse");
    mockDb.select.mockReturnValue(
      makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash }]),
    );
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "student@example.com", password: "correct-horse" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: "user-1", email: "student@example.com" });
    expect(res.headers["set-cookie"]?.[0]).toMatch(/nos_session=/);
  });

  it("returns 401 with a generic message on wrong password", async () => {
    const passwordHash = await argon2.hash("correct-horse");
    mockDb.select.mockReturnValue(
      makeChain([{ id: "user-1", email: "student@example.com", role: "student", passwordHash }]),
    );
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "student@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("returns the identical 401 body for an unknown email (no user enumeration)", async () => {
    // Default beforeEach: select returns []
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "whatever1" });

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
      { id: "user-1", email: "Student@Example.com", role: "student", passwordHash },
    ]);
    mockDb.select.mockReturnValue(selectChain);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "  STUDENT@example.COM ", password: "correct-horse" });

    expect(res.status).toBe(200);
    expect(emailInWhereClause(selectChain)).toBe("student@example.com");
  });

  it("rejects an over-long password before the DB lookup or argon2 ever run", async () => {
    const verifySpy = vi.spyOn(argon2, "verify");
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "student@example.com", password: OVER_LONG_PASSWORD });

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
});

describe("requireAuth middleware", () => {
  it("returns 401 JSON and does not call next() when no session cookie is present", () => {
    const req = { signedCookies: {} } as any;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as any;
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("sets req.userId and calls next() when a session cookie is present", () => {
    const req = { signedCookies: { nos_session: "user-1" } } as any;
    const res = {} as any;
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(req.userId).toBe("user-1");
    expect(next).toHaveBeenCalledOnce();
  });
});
