import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import argon2 from "argon2";
import { createHmac } from "node:crypto";

const mockDeleteAccountData = vi.hoisted(() => vi.fn());
vi.mock("../services/deleteAccount.js", () => ({ deleteAccountData: mockDeleteAccountData }));
// One mock serves requireAuth's session lookup AND the route's re-read before the password check.
const mockFindUserById = vi.hoisted(() => vi.fn());
vi.mock("../lib/sessionUser.js", () => ({ findUserById: mockFindUserById }));

import app from "../app.js";
import { sessionCookieValue, SESSION_SECRET } from "../middlewares/auth.js";
import { CURRENT_TERMS_VERSION } from "../lib/terms.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";

let row: { id: string; email: string; role: string; passwordHash: string; termsVersion: string };
beforeAll(async () => {
  row = { id: "user-1", email: "s@example.test", role: "student", passwordHash: await argon2.hash("correcthorse1"), termsVersion: CURRENT_TERMS_VERSION };
});
beforeEach(() => {
  vi.clearAllMocks();
  resetLoginRateLimiterForTests();
  mockFindUserById.mockReset();
  mockFindUserById.mockImplementation(async () => row);
});

function cookie(): string {
  const v = sessionCookieValue(row);
  const signed = `s:${v}.${createHmac("sha256", SESSION_SECRET).update(v).digest("base64").replace(/=+$/, "")}`;
  return `nos_session=${encodeURIComponent(signed)}`;
}
const del = (body: unknown, withCookie = true) => {
  const r = request(app).delete("/api/auth/account");
  return (withCookie ? r.set("Cookie", cookie()) : r).send(body as object);
};

describe("DELETE /api/auth/account (route)", () => {
  it("401s without a session and deletes nothing", async () => {
    const res = await del({ password: "correcthorse1" }, false);
    expect(res.status).toBe(401);
    expect(mockDeleteAccountData).not.toHaveBeenCalled();
  });

  it("400s a missing password", async () => {
    const res = await del({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Enter your current password to delete your account." });
    expect(mockDeleteAccountData).not.toHaveBeenCalled();
  });

  it("403s a wrong password and deletes nothing (D8)", async () => {
    const res = await del({ password: "wrong-password" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "That password is not correct." });
    expect(mockDeleteAccountData).not.toHaveBeenCalled();
  });

  it("deletes ONLY the session's own user id, answers 204 and clears the cookie", async () => {
    mockDeleteAccountData.mockResolvedValue("deleted");
    const res = await del({ password: "correcthorse1", userId: "someone-else" });
    expect(res.status).toBe(204);
    expect(mockDeleteAccountData).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^nos_session=;.*Expires=Thu, 01 Jan 1970/);
  });

  it("a user row that vanished after requireAuth is signed out: 401, cookie cleared, nothing deleted (D11)", async () => {
    // requireAuth's lookup sees the row; the route's re-read before the password check does not.
    mockFindUserById.mockResolvedValueOnce(row).mockResolvedValueOnce(undefined);
    const res = await del({ password: "correcthorse1" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^nos_session=;.*Expires=Thu, 01 Jan 1970/);
    expect(mockDeleteAccountData).not.toHaveBeenCalled();
  });

  it("409s while a solve is queued or running, and keeps the cookie", async () => {
    mockDeleteAccountData.mockResolvedValue("busy");
    const res = await del({ password: "correcthorse1" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "A solve is still queued or running for your account. Wait for it to finish, then try again." });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("a failed transaction is the route's own 500 and its params never escape", async () => {
    mockDeleteAccountData.mockRejectedValue(new Error("Failed query: delete from scenarios\nparams: SECRET-USER-ID"));
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await del({ password: "correcthorse1" });
    expect(res.status).toBe(500);
    // Without the no-binding catch this is app.ts's generic "Internal server error".
    expect(res.body).toEqual({ error: "Could not delete your account. Nothing was deleted. Try again." });
    expect(JSON.stringify(res.body)).not.toContain("SECRET-USER-ID");
    logSpy.mockRestore();
  });

  it("shares the log-in limiter: the 21st attempt in a minute is a 429", async () => {
    for (let i = 0; i < 20; i++) await del({ password: "wrong-password" });
    const res = await del({ password: "correcthorse1" });
    expect(res.status).toBe(429);
    expect(mockDeleteAccountData).not.toHaveBeenCalled();
  });
});
