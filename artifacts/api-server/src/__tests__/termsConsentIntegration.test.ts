/**
 * WQF-B — terms consent against a real database. No db mock. Requires a live
 * DATABASE_URL (local nos_dev). Every row this file touches is one it created;
 * cleanup is scoped to those ids.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import app from "../app.js";
import { CURRENT_TERMS_VERSION } from "../lib/terms.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";
import { hashResetToken, generateResetToken } from "../lib/resetTokens.js";

const createdUserIds: string[] = [];
const PASSWORD = "correcthorse1";

afterAll(async () => {
  if (createdUserIds.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
});
beforeEach(() => resetLoginRateLimiterForTests());

async function registerFreshUser(): Promise<{ id: string; email: string; cookie: string }> {
  const email = `wqfb-terms-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: PASSWORD, acceptTerms: true });
  expect(res.status).toBe(201);
  createdUserIds.push(res.body.user.id);
  return { id: res.body.user.id, email, cookie: (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]! };
}

async function termsRow(id: string) {
  const [row] = await db.select({ v: usersTable.termsVersion, at: usersTable.termsAcceptedAt }).from(usersTable).where(eq(usersTable.id, id));
  return row!;
}

describe("WQF-B — terms acceptance record (real Postgres)", () => {
  it("declares both columns nullable, terms_accepted_at as timestamptz", async () => {
    const res = await db.execute(sql`
      SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('terms_version', 'terms_accepted_at')
      ORDER BY column_name`);
    expect(res.rows).toEqual([
      { column_name: "terms_accepted_at", data_type: "timestamp with time zone", is_nullable: "YES" },
      { column_name: "terms_version", data_type: "text", is_nullable: "YES" },
    ]);
  });

  it("register records the current version and a time within a minute of now", async () => {
    const user = await registerFreshUser();
    const row = await termsRow(user.id);
    expect(row.v).toBe(CURRENT_TERMS_VERSION);
    expect(Math.abs(row.at!.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("a stale user is refused without the box, then recorded when they accept", async () => {
    const user = await registerFreshUser();
    await db.update(usersTable).set({ termsVersion: null, termsAcceptedAt: null }).where(eq(usersTable.id, user.id));

    const refused = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: "terms_required" });
    expect(refused.headers["set-cookie"]).toBeUndefined();
    expect((await termsRow(user.id)).v).toBeNull(); // the refusal wrote nothing

    const accepted = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD, acceptTerms: true });
    expect(accepted.status).toBe(200);
    const row = await termsRow(user.id);
    expect(row.v).toBe(CURRENT_TERMS_VERSION);
    expect(Math.abs(row.at!.getTime() - Date.now())).toBeLessThan(60_000);
  });
});

async function plantToken(userId: string): Promise<string> {
  const token = generateResetToken();
  await db.update(usersTable)
    .set({ resetTokenHash: hashResetToken(token), resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) })
    .where(eq(usersTable.id, userId));
  return token;
}

describe("WQF-B — one-time log-out and the reset landing (real Postgres)", () => {
  it("a version change signs an existing session out on its next request", async () => {
    const user = await registerFreshUser();
    expect((await request(app).get("/api/scenarios").set("Cookie", user.cookie)).status).toBe(200); // non-vacuity
    await db.update(usersTable).set({ termsVersion: "1999-01-01" }).where(eq(usersTable.id, user.id));
    expect((await request(app).get("/api/scenarios").set("Cookie", user.cookie)).status).toBe(401);
    expect((await request(app).get("/api/auth/user").set("Cookie", user.cookie)).body).toEqual({ user: null });
  });

  it("reset sets no cookie for a stale account; the account then logs in by accepting", async () => {
    const user = await registerFreshUser();
    await db.update(usersTable).set({ termsVersion: null }).where(eq(usersTable.id, user.id));
    const reset = await request(app).post("/api/auth/reset-password").send({ token: await plantToken(user.id), password: "brandnewpass1" });
    expect(reset.status).toBe(200);
    expect(reset.body.user.id).toBe(user.id);
    expect(reset.headers["set-cookie"]).toBeUndefined();
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password: "brandnewpass1", acceptTerms: true });
    expect(login.status).toBe(200);
  });

  it("reset still signs a current account straight in", async () => {
    const user = await registerFreshUser();
    const reset = await request(app).post("/api/auth/reset-password").send({ token: await plantToken(user.id), password: "brandnewpass1" });
    expect(reset.status).toBe(200);
    const cookie = (reset.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    expect((await request(app).get("/api/auth/user").set("Cookie", cookie)).body.user.id).toBe(user.id);
  });
});
