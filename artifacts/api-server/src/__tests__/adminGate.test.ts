// ADM-T2 — real HTTP app against real Postgres (no db mock). Requires DATABASE_URL.
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import { db, usersTable, feedbackTable } from "@workspace/db";
import app from "../app.js";

const MARKER = "adm-t2-test-";
const ids: string[] = [];

async function register(): Promise<{ id: string; cookie: string }> {
  const email = `adm-t2-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery", acceptTerms: true });
  expect(res.status).toBe(201);
  ids.push(res.body.user.id);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return { id: res.body.user.id, cookie: setCookie[0]!.split(";")[0]! };
}
const setRole = (id: string, role: string) => db.update(usersTable).set({ role }).where(eq(usersTable.id, id));

const asStudent = async () => (await register()).cookie;
async function asInstructor() { const u = await register(); await setRole(u.id, "instructor"); return u.cookie; }
async function asAdmin() { const u = await register(); await setRole(u.id, "admin"); return u.cookie; }
async function asStaleTermsAdmin() {
  const u = await register();
  await db.update(usersTable).set({ role: "admin", termsVersion: "2000-01-01" }).where(eq(usersTable.id, u.id));
  return u.cookie;
}
async function asDeletedAdmin() {
  const u = await register();
  await setRole(u.id, "admin");
  await db.delete(usersTable).where(eq(usersTable.id, u.id));
  return u.cookie;
}

afterAll(async () => {
  await db.delete(feedbackTable).where(like(feedbackTable.body, `${MARKER}%`));
  for (const id of ids) await db.delete(usersTable).where(eq(usersTable.id, id));
});

const PATHS = ["/api/admin/watbot/metrics", "/api/admin/watbot/flagged", "/api/admin/feedback"];
const Q = "?from=2026-11-01&to=2026-11-27";

describe("admin gate", () => {
  it.each(PATHS)("%s: signed out → 404 (not 401)", async (p) => {
    const res = await request(app).get(p + Q);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it.each(PATHS)("%s: student, instructor, stale-terms admin and deleted admin → 404", async (p) => {
    for (const setup of [asStudent, asInstructor, asStaleTermsAdmin, asDeletedAdmin]) {
      const cookie = await setup();
      const res = await request(app).get(p + Q).set("Cookie", cookie);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Not found" });
    }
  });

  it.each(PATHS)("admin → 200 on %s", async (p) => {
    const cookie = await asAdmin();
    expect((await request(app).get(p + Q).set("Cookie", cookie)).status).toBe(200);
  });

  it.each(PATHS)("%s: 422s on a bad range, as plain sentences", async (p) => {
    const cookie = await asAdmin();
    for (const q of ["?from=2026-02-30&to=2026-03-02", "?from=2026-11-01&to=2026-11-31", "?from=2026-11-27&to=2026-11-01", "?from=2026-01-01&to=2026-11-27", "?from=2099-01-01&to=2099-01-02", "?from=x&to=y"]) {
      const res = await request(app).get(p + q).set("Cookie", cookie);
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/^[A-Z][^[{]*\.$/);
    }
  });

  it("422s on an unknown modelId (metrics and flagged; feedback ignores it)", async () => {
    const cookie = await asAdmin();
    for (const p of ["/api/admin/watbot/metrics", "/api/admin/watbot/flagged"]) {
      const res = await request(app).get(p + Q + "&modelId=nope").set("Cookie", cookie);
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/^[A-Z][^[{]*\.$/);
    }
  });
});

describe("GET /api/admin/feedback", () => {
  it("ignores modelId (not a parameter of this endpoint)", async () => {
    const cookie = await asAdmin();
    expect((await request(app).get("/api/admin/feedback" + Q + "&modelId=nope").set("Cookie", cookie)).status).toBe(200);
  });

  it("caps at 500 items and reports truncated", async () => {
    const cookie = await asAdmin();
    await db.insert(feedbackTable).values(Array.from({ length: 501 }, (_, i) => ({ body: `${MARKER}cap-${i}`, createdAt: new Date("2026-09-15T12:00:00Z") })));
    const res = await request(app).get("/api/admin/feedback?from=2026-09-15&to=2026-09-15").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(500);
    expect(res.body.truncated).toBe(true);
  });

  it("returns exactly {id, body, createdAt}, newest first, in range", async () => {
    const cookie = await asAdmin();
    await db.insert(feedbackTable).values([
      { body: `${MARKER}old`, createdAt: new Date("2026-10-01T12:00:00Z") },
      { body: `${MARKER}a`, createdAt: new Date("2026-11-20T12:00:00Z") },
      { body: `${MARKER}b`, createdAt: new Date("2026-11-21T12:00:00Z") },
    ]);
    const res = await request(app).get("/api/admin/feedback?from=2026-11-01&to=2026-11-27").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const mine = res.body.items.filter((i: { body: string }) => i.body.startsWith(MARKER));
    expect(mine.map((i: { body: string }) => i.body)).toEqual([`${MARKER}b`, `${MARKER}a`]);
    for (const i of res.body.items) expect(Object.keys(i).sort()).toEqual(["body", "createdAt", "id"]);
  });
});
