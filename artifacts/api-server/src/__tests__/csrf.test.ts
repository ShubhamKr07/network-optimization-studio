import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

// SEC-1 — cross-site state-changing requests are rejected in production before
// any body parsing or auth. /api/auth/logout needs no DB, so it observes "passed
// the guard" (200) without a database; every other route is checked only for the
// 403, which the guard returns before the route (and its DB access) is reached.
describe("CSRF origin guard", () => {
  const ORIGINAL_ENV = process.env;
  const STUDIO = "https://nos-studio.onrender.com";
  const EVIL = "https://evil.example";

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "production", CORS_ALLOWED_ORIGIN: STUDIO };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  const targets: Array<[string, string]> = [
    ["post", "/api/auth/login"],
    ["post", "/api/auth/logout"],
    ["post", "/api/auth/forgot-password"],
    ["post", "/api/scenarios/1/clone"],
    ["post", "/api/scenarios/1/solve"],
    ["post", "/api/scenarios/1/import/apply"],
    ["patch", "/api/scenarios/1"],
    ["delete", "/api/scenarios/1"],
  ];

  it.each(targets)("rejects %s %s from a foreign Origin (form, text/plain, no body)", async (method, path) => {
    const { default: app } = await import("../app.js");
    const agent = request(app);
    const form = await agent[method as "post"](path).set("Origin", EVIL).type("form").send("email=a%40b.c&password=x");
    const text = await agent[method as "post"](path).set("Origin", EVIL).set("Content-Type", "text/plain").send("{}");
    const empty = await agent[method as "post"](path).set("Origin", EVIL);
    for (const res of [form, text, empty]) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "cross_site_request_rejected" });
    }
  });

  it("rejects an opaque `null` Origin", async () => {
    const { default: app } = await import("../app.js");
    const res = await request(app).post("/api/auth/logout").set("Origin", "null");
    expect(res.status).toBe(403);
  });

  it("rejects a header-less-Origin request the browser marks cross-site", async () => {
    const { default: app } = await import("../app.js");
    const res = await request(app).post("/api/auth/logout").set("Sec-Fetch-Site", "cross-site");
    expect(res.status).toBe(403);
  });

  it("allows the allowlisted Studio origin", async () => {
    const { default: app } = await import("../app.js");
    const res = await request(app).post("/api/auth/logout").set("Origin", STUDIO);
    expect(res.status).toBe(200);
  });

  it("allows a non-browser client with no Origin and no Sec-Fetch-Site", async () => {
    const { default: app } = await import("../app.js");
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(200);
  });

  it("allows same-site requests without Origin", async () => {
    const { default: app } = await import("../app.js");
    const res = await request(app).post("/api/auth/logout").set("Sec-Fetch-Site", "same-site");
    expect(res.status).toBe(200);
  });

  it("never blocks safe methods from a foreign Origin", async () => {
    const { default: app } = await import("../app.js");
    const res = await request(app).get("/api/healthz").set("Origin", EVIL);
    expect(res.status).toBe(200);
  });

  it("is a no-op outside production", async () => {
    process.env.NODE_ENV = "development";
    const { default: app } = await import("../app.js");
    const res = await request(app).post("/api/auth/logout").set("Origin", EVIL);
    expect(res.status).toBe(200);
  });
});
