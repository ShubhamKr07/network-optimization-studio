// PWR-FU5b: login's limiter is per CLIENT ip (trust proxy: 2), not one shared
// bucket keyed on Render's load-balancer address. Real app, real limiter.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import app from "../app.js";
import { loginLimiterSizeForTests, resetLoginRateLimiterForTests } from "../routes/auth.js";

// Well-formed body (a malformed one 401s BEFORE the limiter and proves nothing).
const login = (email: string, xff?: string) => {
  const r = request(app).post("/api/auth/login");
  if (xff) r.set("X-Forwarded-For", xff);
  return r.send({ email, password: "wrong-password-123" });
};

describe("login rate limit keys on the client address behind the proxies", () => {
  beforeEach(() => resetLoginRateLimiterForTests());
  afterEach(() => vi.useRealTimers());

  it("25 distinct clients through one proxy socket are never 429", async () => {
    for (let i = 0; i < 25; i++) {
      const res = await login(`nobody${i}@example.com`, `203.0.113.${i + 1}, 172.71.202.122`);
      expect(res.status, `request ${i + 1}`).toBe(401);
    }
  });

  it("resolves req.ip to the client and ignores injected leading entries", async () => {
    const probe = express();
    probe.set("trust proxy", app.get("trust proxy")); // the real app's setting
    probe.get("/ip", (req, res) => res.send(req.ip));
    const ipFor = async (xff: string) => (await request(probe).get("/ip").set("X-Forwarded-For", xff)).text;
    expect(await ipFor("spoof-ip, client-ip, cf-ip")).toBe("client-ip");
    expect(await ipFor("spoof2, spoof-ip, client-ip, cf-ip")).toBe("client-ip");
  });

  it("21st attempt from one client is 429; another client is unaffected", async () => {
    const chain = "198.51.100.7, 172.71.202.122";
    for (let i = 0; i < 20; i++) expect((await login(`a${i}@example.com`, chain)).status).toBe(401);
    expect((await login("a20@example.com", chain)).status).toBe(429);
    expect((await login("b@example.com", "198.51.100.8, 172.71.202.122")).status).toBe(401);
  });

  it("evicts expired keys so hundreds of IPs do not accumulate", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 600; i++) {
      const r = await login("nobody@example.com", `10.${i >> 8}.${i & 255}.1, 172.71.202.122`);
      expect(r.status, `i=${i}`).toBe(401);
    }
    expect(loginLimiterSizeForTests()).toBeGreaterThan(550); // ~600
    vi.setSystemTime(Date.now() + 61_000);
    await login("nobody@example.com", "192.0.2.1, 172.71.202.122"); // sweep runs on check()
    expect(loginLimiterSizeForTests()).toBe(1);
  }, 30_000);
});
