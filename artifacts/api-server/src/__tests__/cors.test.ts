import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

describe("CORS origin handling", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("reflects any origin when NODE_ENV is not production (unchanged local-dev behavior)", async () => {
    process.env.NODE_ENV = "development";
    const { default: app } = await import("../app.js");
    const res = await request(app).get("/api/healthz").set("Origin", "http://anything.example.com");
    expect(res.headers["access-control-allow-origin"]).toBe("http://anything.example.com");
  });

  it("allows an origin present in CORS_ALLOWED_ORIGIN when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGIN = "https://nos-studio.onrender.com,https://other.example.com";
    const { default: app } = await import("../app.js");
    const res = await request(app).get("/api/healthz").set("Origin", "https://nos-studio.onrender.com");
    expect(res.headers["access-control-allow-origin"]).toBe("https://nos-studio.onrender.com");
  });

  it("rejects an origin NOT present in CORS_ALLOWED_ORIGIN when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    process.env.CORS_ALLOWED_ORIGIN = "https://nos-studio.onrender.com";
    const { default: app } = await import("../app.js");
    const res = await request(app).get("/api/healthz").set("Origin", "https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
