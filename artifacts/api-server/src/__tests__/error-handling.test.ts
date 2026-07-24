import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import argon2 from "argon2";

// Same vi.hoisted + makeChain mocking pattern as auth.test.ts / routes.test.ts.
// The db.select mock is the lever we use to force an unhandled throw out of a
// route handler: by making select itself throw, the awaited `db.select()...`
// chain in GET /api/scenarios rejects before any try/catch in the route can
// convert it — so the request falls through to the catch-all error middleware.
const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  usersTable: { id: "id", email: "email" },
  scenariosTable: {
    id: "id",
    name: "name",
    userId: "user_id",
    modelId: "model_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  solveJobsTable: { id: "id", scenarioId: "scenario_id", userId: "user_id", status: "status" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ col: _col, val })),
  and: vi.fn((...conds: unknown[]) => ({ and: conds })),
  desc: vi.fn((_col: unknown) => ({ desc: _col })),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ inArray: _col, vals })),
}));

import app from "../app.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";

// ---------------------------------------------------------------------------
// Chainable drizzle mock — identical helper to the other test files. The error
// test never actually awaits the chain (select throws first), but loginAs
// still needs it to satisfy the /auth/login lookup before we reach /scenarios.
// ---------------------------------------------------------------------------
function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "orderBy", "insert", "values", "returning"].forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(returnValue).then(resolve);
  return chain;
}

let testPasswordHash: string;
beforeAll(async () => {
  testPasswordHash = await argon2.hash("test-password");
});

beforeEach(() => {
  vi.clearAllMocks();
  resetLoginRateLimiterForTests();
});

// Logs in as the given user via the real /auth/login route (so the session
// cookie is genuinely signed by cookie-parser's secret), returning the Cookie
// header value to attach to the subsequent /scenarios request.
async function loginAs(userId: string): Promise<string> {
  mockDb.select.mockReturnValueOnce(
    makeChain([
      { id: userId, email: `${userId}@example.com`, role: "student", passwordHash: testPasswordHash },
    ]),
  );
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: `${userId}@example.com`, password: "test-password" });
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie[0].split(";")[0];
}

describe("catch-all error-handling middleware", () => {
  it("converts an unhandled thrown error into a JSON 500, never an HTML page", async () => {
    const cookie = await loginAs("owner-1");
    // Force the awaited db.select() chain in GET /api/scenarios to throw —
    // simulates a real DB failure (connection drop, etc.) propagating out of
    // an async handler with no try/catch. The catch-all middleware must turn
    // this into {error: "Internal server error"}.
    const boom = new Error("simulated database outage — connection refused");
    mockDb.select.mockImplementation(() => {
      throw boom;
    });

    const res = await request(app).get("/api/scenarios").set("Cookie", cookie);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    // The whole point of the middleware: the body is JSON, NOT Express's
    // default HTML error page.
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    // Never leak internals — the thrown message/stack must not appear in the
    // response body in any environment.
    expect(res.text).not.toContain("simulated database outage");
    expect(res.text).not.toContain("connection refused");
  });
});
