// ADM-T2 — admin routes are reachable only through the gated mount (plan review F4).
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import app from "../app.js";
import { adminRoutesForTests } from "../routes/admin.js";

const admin = readFileSync(new URL("../routes/admin.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("../routes/index.ts", import.meta.url), "utf8");
const ids: string[] = [];
afterAll(async () => { for (const id of ids) await db.delete(usersTable).where(eq(usersTable.id, id)); });

async function asStudent(): Promise<string> {
  const email = `adm-t2g-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery", acceptTerms: true });
  expect(res.status).toBe(201);
  ids.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}

it("admin.ts registers nothing on `router` except the one gated mount", () => {
  const onRouter = [...admin.matchAll(/\brouter\.(\w+)\(/g)].map((m) => m[0]);
  expect(onRouter).toEqual(["router.use("]);
  expect(admin).toContain('router.use("/admin", requireAdmin, admin, ');
});

// Behavioural half: whatever form a route takes, every path on the admin
// sub-router answers a STUDENT with 404.
it("every route on the admin sub-router 404s a student", async () => {
  const stack = adminRoutesForTests.stack as { route?: { path: string; methods: Record<string, boolean> } }[];
  const routes = stack.flatMap((l) => (l.route ? [l.route] : []));
  expect(routes.length).toBeGreaterThanOrEqual(3); // non-vacuity: feedback, metrics, flagged
  expect(stack.every((l) => !!l.route)).toBe(true); // no nested use() to hide routes
  const cookie = await asStudent();
  for (const route of routes) {
    for (const method of Object.keys(route.methods).filter((m) => route.methods[m])) {
      const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method]!("/api/admin" + route.path + "?from=2026-11-01&to=2026-11-27").set("Cookie", cookie);
      expect(res.status).toBe(404);
    }
  }
});

it("an admin on an unknown admin path gets a JSON 404, not Express's HTML", async () => {
  const email = `adm-t2n-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
  const reg = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery", acceptTerms: true });
  ids.push(reg.body.user.id);
  await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, reg.body.user.id));
  const cookie = (reg.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
  const res = await request(app).get("/api/admin/nope").set("Cookie", cookie);
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: "Not found" });
});

it("adminRouter is registered right after authRouter, before any router that mounts requireAuth", () => {
  const order = [...index.matchAll(/router\.use\((\w+)\)/g)].map((m) => m[1]);
  expect(order.indexOf("adminRouter")).toBe(order.indexOf("authRouter") + 1);
});
