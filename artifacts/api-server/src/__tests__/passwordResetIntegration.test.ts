/**
 * Real-DB, real-route tests for the properties the mocked passwordReset suite
 * structurally cannot cover: the conditional UPDATE's expiry filter, single
 * use, and the concurrent-confirm race. No vi.mock of db anywhere in this
 * file. Requires a live DATABASE_URL.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import argon2 from "argon2";

// The ONLY mock in this file, and it is not the database: a real Resend call
// from a test suite is unacceptable, and `vi.doMock` cannot help here because
// app.js has already imported lib/email.js by the time it would run. Hoisted
// and static, so it is in place before the first import. Postgres stays real,
// which is the entire point of this file.
const mockSendEmail = vi.hoisted(() => vi.fn());
vi.mock("../lib/email.js", () => ({ sendEmail: mockSendEmail }));

import { db, usersTable } from "@workspace/db";
import app from "../app.js";
import { hashResetToken, generateResetToken } from "../lib/resetTokens.js";
import { resetForgotPasswordLimitersForTests } from "../routes/auth.js";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

beforeEach(() => {
  resetForgotPasswordLimitersForTests();
});

async function registerFreshUser(): Promise<{ id: string; email: string }> {
  const email = `pwr-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correcthorse1" });
  expect(res.status).toBe(201);
  const id = res.body.user.id as string;
  createdUserIds.push(id);
  return { id, email };
}

/** Plant a token directly, so these tests never depend on email delivery. */
async function plantToken(userId: string, expiresAt: Date): Promise<string> {
  const token = generateResetToken();
  await db
    .update(usersTable)
    .set({ resetTokenHash: hashResetToken(token), resetTokenExpiresAt: expiresAt })
    .where(eq(usersTable.id, userId));
  return token;
}

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

describe("password reset against a real database", () => {
  it("accepts a live token, then refuses the same token a second time", async () => {
    const user = await registerFreshUser();
    const token = await plantToken(user.id, inAnHour());

    const first = await request(app).post("/api/auth/reset-password").send({ token, password: "newpassword1" });
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/auth/reset-password").send({ token, password: "anotherpass1" });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("This reset link is invalid or has expired.");

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(row!.resetTokenHash).toBeNull();
    expect(row!.resetTokenExpiresAt).toBeNull();
  });

  it("the new password actually works at login and the old one does not", async () => {
    const user = await registerFreshUser();
    const token = await plantToken(user.id, inAnHour());
    await request(app).post("/api/auth/reset-password").send({ token, password: "brandnewpass1" });

    const good = await request(app).post("/api/auth/login").send({ email: user.email, password: "brandnewpass1" });
    expect(good.status).toBe(200);

    resetForgotPasswordLimitersForTests();
    const bad = await request(app).post("/api/auth/login").send({ email: user.email, password: "correcthorse1" });
    expect(bad.status).toBe(401);
  });

  it("refuses an expired token and leaves the password alone", async () => {
    const user = await registerFreshUser();
    const token = await plantToken(user.id, anHourAgo());

    const res = await request(app).post("/api/auth/reset-password").send({ token, password: "newpassword1" });
    expect(res.status).toBe(400);
    // Same body as an unknown token: a distinct "expired" message is an oracle.
    expect(res.body.error).toBe("This reset link is invalid or has expired.");

    const stillWorks = await request(app).post("/api/auth/login").send({ email: user.email, password: "correcthorse1" });
    expect(stillWorks.status).toBe(200);
  });

  it("a never-issued token gets the identical error string as an expired one", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: generateResetToken(), password: "newpassword1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This reset link is invalid or has expired.");
  });

  // The race the conditional UPDATE exists for. Both handlers run argon2.hash
  // BEFORE touching the database, and unaided they finish up to ~60ms apart,
  // so a broken SELECT-then-UPDATE would often serialise by luck and still
  // return [200, 400]. A two-party barrier on argon2.hash releases both
  // handlers in the same tick so they reach the database together.
  it("two concurrent confirms of one token produce exactly one 200", async () => {
    const user = await registerFreshUser();
    const token = await plantToken(user.id, inAnHour());

    const realHash = argon2.hash.bind(argon2);
    let arrived = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hashSpy = vi.spyOn(argon2, "hash").mockImplementation(async (...args: Parameters<typeof argon2.hash>) => {
      arrived += 1;
      if (arrived >= 2) release();
      await Promise.race([
        bothArrived,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("barrier timeout: fewer than two argon2.hash calls arrived")), 5_000),
        ),
      ]);
      return realHash(...args);
    });

    try {
      const [a, b] = await Promise.all([
        request(app).post("/api/auth/reset-password").send({ token, password: "racepassword1" }),
        request(app).post("/api/auth/reset-password").send({ token, password: "racepassword2" }),
      ]);

      // Both really hit the barrier (non-vacuity: the overlap happened).
      expect(hashSpy).toHaveBeenCalledTimes(2);
      expect([a.status, b.status].sort()).toEqual([200, 400]);

      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
      expect(row!.resetTokenHash).toBeNull();

      // The password that persisted is the winner's.
      const winnerPassword = a.status === 200 ? "racepassword1" : "racepassword2";
      const loserPassword = a.status === 200 ? "racepassword2" : "racepassword1";
      resetForgotPasswordLimitersForTests();
      const good = await request(app).post("/api/auth/login").send({ email: user.email, password: winnerPassword });
      expect(good.status).toBe(200);
      resetForgotPasswordLimitersForTests();
      const bad = await request(app).post("/api/auth/login").send({ email: user.email, password: loserPassword });
      expect(bad.status).toBe(401);
    } finally {
      hashSpy.mockRestore();
    }
  });

  it("a second forgot-password request invalidates the first token (last token wins)", async () => {
    const user = await registerFreshUser();
    mockSendEmail.mockClear();
    mockSendEmail.mockResolvedValue(undefined);
    process.env.RESEND_API_KEY = "re_test";

    const tokens: string[] = [];
    for (let n = 0; n < 2; n++) {
      const res = await request(app).post("/api/auth/forgot-password").send({ email: user.email });
      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalledTimes(n + 1), { timeout: 5_000 });
      const html = mockSendEmail.mock.calls[n]![2] as string;
      const emailed = /#token=([A-Za-z0-9_-]+)/.exec(html)?.[1];
      expect(emailed).toBeTruthy();
      tokens.push(emailed!);
    }
    expect(tokens[0]).not.toBe(tokens[1]);

    const stale = await request(app).post("/api/auth/reset-password").send({ token: tokens[0], password: "newpassword1" });
    expect(stale.status).toBe(400);

    const fresh = await request(app).post("/api/auth/reset-password").send({ token: tokens[1], password: "newpassword2" });
    expect(fresh.status).toBe(200);
  });

  // Closes the loop the mocked suite cannot: the token that reaches the
  // reader's inbox must be the one whose hash landed in the real column.
  it("the full request path emails a raw token whose hash is what the column holds", async () => {
    const user = await registerFreshUser();
    mockSendEmail.mockClear();
    mockSendEmail.mockResolvedValue(undefined);
    process.env.RESEND_API_KEY = "re_test";

    const res = await request(app).post("/api/auth/forgot-password").send({ email: user.email });
    expect(res.status).toBe(200);

    // The route answers before it sends, so wait for the tail to land.
    await vi.waitFor(() => expect(mockSendEmail).toHaveBeenCalledTimes(1), { timeout: 5_000 });

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(row!.resetTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.resetTokenExpiresAt).not.toBeNull();

    const html = mockSendEmail.mock.calls[0]![2] as string;
    const emailed = /#token=([A-Za-z0-9_-]+)/.exec(html)?.[1];
    expect(emailed).toBeTruthy();
    expect(emailed).not.toBe(row!.resetTokenHash);
    expect(hashResetToken(emailed!)).toBe(row!.resetTokenHash);

    // And the emailed token actually works end to end.
    const confirm = await request(app).post("/api/auth/reset-password").send({ token: emailed, password: "fromemail1" });
    expect(confirm.status).toBe(200);
  });
});
