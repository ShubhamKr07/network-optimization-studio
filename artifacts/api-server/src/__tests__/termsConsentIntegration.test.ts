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
