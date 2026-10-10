import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

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

  it("trips at the 11th request from one IP", async () => {
    mockDb.select.mockReturnValue(makeChain([]));
    for (let i = 0; i < 10; i++) {
      const ok = await request(app).post("/api/auth/forgot-password").send({ email: `a${i}@example.test` });
      expect(ok.status).toBe(200);
    }
    const tripped = await request(app).post("/api/auth/forgot-password").send({ email: "a10@example.test" });
    expect(tripped.status).toBe(429);
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
});
