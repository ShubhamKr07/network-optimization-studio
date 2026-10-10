/**
 * Real-DB, real-route tests for the properties the mocked passwordReset suite
 * structurally cannot cover: the conditional UPDATE's expiry filter, single
 * use, and the concurrent-confirm race. No vi.mock of db anywhere in this
 * file. Requires a live DATABASE_URL.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

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

    const stillWorks = await request(app).post("/api/auth/login").send({ email: user.email, password: "correcthorse1" });
    expect(stillWorks.status).toBe(200);
  });

  // The race the conditional UPDATE exists for. A SELECT-then-UPDATE pair
  // lets both of these win.
  it("two concurrent confirms of one token produce exactly one 200", async () => {
    const user = await registerFreshUser();
    const token = await plantToken(user.id, inAnHour());

    const [a, b] = await Promise.all([
      request(app).post("/api/auth/reset-password").send({ token, password: "racepassword1" }),
      request(app).post("/api/auth/reset-password").send({ token, password: "racepassword2" }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
  });

  it("a second request invalidates the first token", async () => {
    const user = await registerFreshUser();
    const firstToken = await plantToken(user.id, inAnHour());
    const secondToken = await plantToken(user.id, inAnHour());

    const stale = await request(app).post("/api/auth/reset-password").send({ token: firstToken, password: "newpassword1" });
    expect(stale.status).toBe(400);

    const fresh = await request(app).post("/api/auth/reset-password").send({ token: secondToken, password: "newpassword2" });
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
