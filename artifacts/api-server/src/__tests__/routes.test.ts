import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import argon2 from "argon2";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb)),
}));

const mockEnqueueSolveJob = vi.hoisted(() => vi.fn());
const mockGetQueueDepth = vi.hoisted(() => vi.fn(() => 0));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  scenariosTable: { id: "id", name: "name", userId: "user_id", modelId: "model_id", createdAt: "created_at", updatedAt: "updated_at" },
  solveJobsTable: { id: "id", scenarioId: "scenario_id", userId: "user_id", status: "status" },
  usersTable: { id: "id", email: "email" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ col: _col, val })),
  and: vi.fn((...conds: unknown[]) => ({ and: conds })),
  desc: vi.fn((_col: unknown) => ({ desc: _col })),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ inArray: _col, vals })),
}));

vi.mock("../solver/jobRunner.js", () => ({
  enqueueSolveJob: mockEnqueueSolveJob,
  getQueueDepth: mockGetQueueDepth,
  QUEUE_DEPTH_LIMIT: 30,
}));

import app from "../app.js";
import { WAREHOUSES, CUSTOMERS, BRAZIL_WAREHOUSES } from "../data/dataset.js";
import { TRANSPORT_COAL_WAREHOUSES } from "../data/transportCoalDataset.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";
// Import the (mocked) table symbols so the DELETE regression test can assert
// which table each db.delete call targeted.
import { scenariosTable, solveJobsTable } from "@workspace/db";

// ---------------------------------------------------------------------------
// Chainable drizzle mock
// ---------------------------------------------------------------------------
function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  ["select","from","where","orderBy","insert","values",
   "returning","update","set","delete","innerJoin","limit"].forEach(m => {
    chain[m] = vi.fn(() => chain);
  });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(returnValue).then(resolve);
  return chain;
}

// ---------------------------------------------------------------------------
// Auth helper — logs in as a given user via the real /auth/login route (so the
// session cookie is genuinely signed by the app's own cookie-parser secret)
// and returns the Cookie header value to attach to subsequent requests.
// ---------------------------------------------------------------------------
let testPasswordHash: string;
beforeAll(async () => {
  testPasswordHash = await argon2.hash("test-password");
});

async function loginAs(userId: string): Promise<string> {
  mockDb.select.mockReturnValueOnce(
    makeChain([{ id: userId, email: `${userId}@example.com`, role: "student", passwordHash: testPasswordHash }]),
  );
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: `${userId}@example.com`, password: "test-password" });
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie[0].split(";")[0];
}

// ---------------------------------------------------------------------------
// Base row shapes — one wide scenariosTable row per model.
// ---------------------------------------------------------------------------
const OWNER = "seed-user-id";

const pmedianInputs = {
  p: 3,
  distanceBands: [200, 400, 800, 1600],
  capacityMode: "none",
  uniformCapacity: null,
  warehouseOverrides: [],
  customerOverrides: [],
  gap: 0,
  timeLimitSec: 120,
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

const pmedianRow = {
  id: 1,
  name: "Base",
  modelId: "p-median-us",
  userId: OWNER,
  inputs: pmedianInputs,
  result: null,
  solvedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const transportInputs = {
  distanceBands: [500, 1000, 1500, 2000],
  gap: 0,
  timeLimitSec: 120,
  capacityFactor: 1.0,
  singleSource: false,
  capacityInactive: false,
};

const transportRow = {
  id: 8,
  name: "Coal Base Case",
  modelId: "transport-coal",
  userId: OWNER,
  inputs: transportInputs,
  result: null,
  solvedAt: null,
  createdAt: new Date("2026-01-02T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

const brazilInputs = {
  p: 5,
  distanceBands: [500, 1000, 2000, 4000],
  capacityMode: "uniform",
  uniformCapacity: 20000000,
  warehouseOverrides: [],
  customerOverrides: [],
  gap: 0,
  timeLimitSec: 120,
  singleSource: true,
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

const brazilRow = {
  id: 10,
  name: "Brazil Base — 20M cap",
  modelId: "p-median-brazil",
  userId: OWNER,
  inputs: brazilInputs,
  result: null,
  solvedAt: null,
  createdAt: new Date("2026-01-03T00:00:00Z"),
  updatedAt: new Date("2026-01-03T00:00:00Z"),
};

const twoEchelonInputs = {
  bomRatio: 1.1,
  refineryOverrides: [],
  customerOverrides: [],
  distanceBands: [500, 1000, 1500, 2000, 2600],
  gap: 0,
  timeLimitSec: 120,
};

const twoEchelonRow = {
  id: 11,
  name: "Gold Base Case",
  modelId: "two-echelon-gold-au",
  userId: OWNER,
  inputs: twoEchelonInputs,
  result: null,
  solvedAt: null,
  createdAt: new Date("2026-01-04T00:00:00Z"),
  updatedAt: new Date("2026-01-04T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  resetLoginRateLimiterForTests();
  // Defaults: not found / no-op. clearAllMocks() only resets call history, not
  // configured return values, so every mock needs an explicit per-test-file default
  // or a later test can silently inherit an earlier test's mockReturnValue.
  mockDb.select.mockReturnValue(makeChain([]));
  mockDb.update.mockReturnValue(makeChain([]));
  mockDb.delete.mockReturnValue(makeChain([]));
  // transaction defaults to running the callback against the shared mockDb,
  // so a route that deletes child rows then the parent resolves in order.
  mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb));
  mockGetQueueDepth.mockReturnValue(0);
});

// ── Health ─────────────────────────────────────────────────────────────────
describe("GET /api/healthz", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });
});

// ── Dataset ────────────────────────────────────────────────────────────────
describe("GET /api/dataset", () => {
  it("returns 200 with 26 warehouses and 200 customers", async () => {
    const res = await request(app).get("/api/dataset");
    expect(res.status).toBe(200);
    expect(res.body.warehouses).toHaveLength(WAREHOUSES.length);
    expect(res.body.customers).toHaveLength(CUSTOMERS.length);
  });

  it("warehouse entries have id, city, lat, lng fields", async () => {
    const res = await request(app).get("/api/dataset");
    const wh = res.body.warehouses[0];
    expect(wh).toHaveProperty("id");
    expect(wh).toHaveProperty("city");
    expect(wh).toHaveProperty("lat");
    expect(wh).toHaveProperty("lng");
  });

  it("customer entries have a numeric demand field", async () => {
    const res = await request(app).get("/api/dataset");
    expect(typeof res.body.customers[0].demand).toBe("number");
  });

  it("serves the C2.1-corrected warehouse labels (single source of truth with solve.py)", async () => {
    const res = await request(app).get("/api/dataset");
    const byId = (id: string) => res.body.warehouses.find((w: { id: string }) => w.id === id);
    expect(byId("SFO")).toMatchObject({ city: "San Francisco", state: "CA" });
    expect(byId("STL")).toMatchObject({ city: "St. Louis", state: "MO" });
    expect(byId("LBB")).toMatchObject({ city: "Lubbock - Current WH", state: "TX" });
  });
});

// ── Anonymous access ───────────────────────────────────────────────────────
// A2.2: every scenario endpoint requires a session; none reachable anonymously.
describe("scenario endpoints require authentication", () => {
  it("GET /api/scenarios returns 401 without a session", async () => {
    expect((await request(app).get("/api/scenarios")).status).toBe(401);
  });
  it("POST /api/scenarios returns 401 without a session", async () => {
    expect((await request(app).post("/api/scenarios").send({ name: "x" })).status).toBe(401);
  });
  it("GET /api/scenarios/:id returns 401 without a session", async () => {
    expect((await request(app).get("/api/scenarios/1")).status).toBe(401);
  });
  it("PATCH /api/scenarios/:id returns 401 without a session", async () => {
    expect((await request(app).patch("/api/scenarios/1").send({ inputs: { p: 5 } })).status).toBe(401);
  });
  it("DELETE /api/scenarios/:id returns 401 without a session", async () => {
    expect((await request(app).delete("/api/scenarios/1")).status).toBe(401);
  });
  it("POST /api/scenarios/:id/solve returns 401 without a session", async () => {
    expect((await request(app).post("/api/scenarios/1/solve")).status).toBe(401);
  });
  it("POST /api/scenarios/:id/clone returns 401 without a session", async () => {
    expect((await request(app).post("/api/scenarios/1/clone")).status).toBe(401);
  });
  it("POST /api/scenarios/compare returns 401 without a session", async () => {
    expect((await request(app).post("/api/scenarios/compare").send({ scenarioIds: [1, 2] })).status).toBe(401);
  });
});

// ── List scenarios ─────────────────────────────────────────────────────────
// GET /api/scenarios issues a single query against the one scenariosTable.
describe("GET /api/scenarios", () => {
  it("returns 200 with array of the caller's own scenarios", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe(1);
    expect(res.body[0].modelId).toBe("p-median-us");
  });

  it("maps dates to ISO strings", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios").set("Cookie", cookie);
    expect(res.body[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns rows for every model in one query", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow, transportRow, brazilRow]));
    const res = await request(app).get("/api/scenarios").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    const ids = res.body.map((s: { modelId: string }) => s.modelId);
    expect(ids).toContain("p-median-us");
    expect(ids).toContain("transport-coal");
    expect(ids).toContain("p-median-brazil");
  });

  it("accepts ?modelId= to scope the list to one chapter's model", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).get("/api/scenarios?modelId=transport-coal").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].modelId).toBe("transport-coal");
  });
});

// ── Create scenario ────────────────────────────────────────────────────────
describe("POST /api/scenarios", () => {
  it("returns 201 with created p-median-us scenario", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.insert.mockReturnValue(makeChain([{ ...pmedianRow, name: "New" }]));
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "New", modelId: "p-median-us", inputs: pmedianInputs });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("New");
    expect(res.body.modelId).toBe("p-median-us");
    expect(res.body.result).toBeNull();
  });

  it("stamps the created scenario with the caller's own userId", async () => {
    const cookie = await loginAs(OWNER);
    const chain = makeChain([{ ...pmedianRow, name: "New" }]);
    mockDb.insert.mockReturnValue(chain);
    await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "New", modelId: "p-median-us", inputs: pmedianInputs });
    expect(chain.values).toHaveBeenCalledWith(expect.objectContaining({ userId: OWNER }));
  });

  it("returns 201 with transport scenario when modelId=transport-coal", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.insert.mockReturnValue(makeChain([{ ...transportRow, name: "New Transport" }]));
    const res = await request(app)
      .post("/api/scenarios")
      .set("Cookie", cookie)
      .send({ name: "New Transport", modelId: "transport-coal", inputs: transportInputs });
    expect(res.status).toBe(201);
    expect(res.body.modelId).toBe("transport-coal");
  });

  it("returns 201 with Brazil scenario when modelId=p-median-brazil", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.insert.mockReturnValue(makeChain([{ ...brazilRow, id: 11, name: "Brazil Relaxed", inputs: { ...brazilInputs, singleSource: false } }]));
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "Brazil Relaxed",
      modelId: "p-median-brazil",
      inputs: { ...brazilInputs, singleSource: false },
    });
    expect(res.status).toBe(201);
    expect(res.body.modelId).toBe("p-median-brazil");
    expect(res.body.inputs.uniformCapacity).toBe(20000000);
    expect(res.body.inputs.singleSource).toBe(false);
  });

  it("returns 422 when modelId is missing", async () => {
    const cookie = await loginAs(OWNER);
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie).send({ name: "No type" });
    expect(res.status).toBe(422);
  });

  it("returns 422 when modelId is not a recognized model", async () => {
    const cookie = await loginAs(OWNER);
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "Bad type", modelId: "not_a_real_model", inputs: pmedianInputs });
    expect(res.status).toBe(422);
  });

  it("returns 422 when inputs fails model-specific validation", async () => {
    const cookie = await loginAs(OWNER);
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "Bad inputs", modelId: "p-median-us", inputs: { ...pmedianInputs, capacityMode: "bogus" } });
    expect(res.status).toBe(422);
  });
});

// ── Get scenario ───────────────────────────────────────────────────────────
describe("GET /api/scenarios/:id", () => {
  it("returns 200 with the matching scenario", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.modelId).toBe("p-median-us");
  });

  it("returns 200 with Brazil fields when scenario is p-median-brazil", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([brazilRow]));
    const res = await request(app).get("/api/scenarios/10").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.modelId).toBe("p-median-brazil");
    expect(res.body.inputs.p).toBe(5);
    expect(res.body.inputs.uniformCapacity).toBe(20000000);
    expect(res.body.inputs.singleSource).toBe(true);
  });

  it("returns 404 when not found", async () => {
    const cookie = await loginAs(OWNER);
    // Default beforeEach: select returns []
    const res = await request(app).get("/api/scenarios/999").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Not found" });
  });

  it("returns 404 (not 403) for a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    // The AND-filtered query finds nothing for this caller, same as truly not found.
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).get("/api/scenarios/1").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

// ── Update scenario ────────────────────────────────────────────────────────
describe("PATCH /api/scenarios/:id", () => {
  it("returns 200 with updated pmedian scenario", async () => {
    const cookie = await loginAs(OWNER);
    const newInputs = { ...pmedianInputs, p: 5 };
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    mockDb.update.mockReturnValue(makeChain([{ ...pmedianRow, inputs: newInputs }]));
    const res = await request(app).patch("/api/scenarios/1").set("Cookie", cookie).send({ inputs: newInputs });
    expect(res.status).toBe(200);
    expect(res.body.inputs.p).toBe(5);
  });

  it("updates transport capacityFactor and singleSource", async () => {
    const cookie = await loginAs(OWNER);
    const newInputs = { ...transportInputs, capacityFactor: 1.1, singleSource: true };
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    mockDb.update.mockReturnValue(makeChain([{ ...transportRow, inputs: newInputs }]));
    const res = await request(app).patch("/api/scenarios/8").set("Cookie", cookie).send({
      inputs: newInputs,
    });
    expect(res.status).toBe(200);
    expect(res.body.inputs.capacityFactor).toBe(1.1);
    expect(res.body.inputs.singleSource).toBe(true);
  });

  it("updates Brazil uniformCapacity and singleSource", async () => {
    const cookie = await loginAs(OWNER);
    const newInputs = { ...brazilInputs, uniformCapacity: 30000000, singleSource: false };
    mockDb.select.mockReturnValue(makeChain([brazilRow]));
    mockDb.update.mockReturnValue(makeChain([{ ...brazilRow, inputs: newInputs }]));
    const res = await request(app).patch("/api/scenarios/10").set("Cookie", cookie).send({
      inputs: newInputs,
    });
    expect(res.status).toBe(200);
    expect(res.body.inputs.uniformCapacity).toBe(30000000);
    expect(res.body.inputs.singleSource).toBe(false);
  });

  it("returns 404 when not found", async () => {
    const cookie = await loginAs(OWNER);
    // Default: select returns [] → 404
    const res = await request(app).patch("/api/scenarios/999").set("Cookie", cookie).send({ inputs: pmedianInputs });
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) when patching a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    mockDb.select.mockReturnValue(makeChain([]));
    mockDb.update.mockReturnValue(makeChain([]));
    const res = await request(app).patch("/api/scenarios/1").set("Cookie", cookie).send({ inputs: pmedianInputs });
    expect(res.status).toBe(404);
  });

  it("returns 422 when the body includes modelId (fixed at creation)", async () => {
    const cookie = await loginAs(OWNER);
    const res = await request(app).patch("/api/scenarios/1").set("Cookie", cookie)
      .send({ inputs: pmedianInputs, modelId: "transport-coal" });
    expect(res.status).toBe(422);
  });

  it("returns 422 when inputs fails model-specific validation", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).patch("/api/scenarios/1").set("Cookie", cookie)
      .send({ inputs: { ...pmedianInputs, capacityMode: "bogus" } });
    expect(res.status).toBe(422);
  });
});

// ── Scenario.stale (X1.1) ───────────────────────────────────────────────────
describe("Scenario.stale", () => {
  it("an unsolved scenario is never stale", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1").set("Cookie", cookie);
    expect(res.body.stale).toBe(false);
  });

  it("a freshly solved scenario (solvedAt >= inputsUpdatedAt) is not stale", async () => {
    // G3.1: solve is now async (jobRunner writes scenarios.result/solvedAt
    // in the background — covered by jobRunner.test.ts). This test checks
    // isStale()'s own logic via GET against a row shaped like the result
    // of a completed solve.
    const cookie = await loginAs(OWNER);
    const solvedAt = new Date("2026-01-02T00:00:00Z");
    mockDb.select.mockReturnValue(makeChain([{ ...pmedianRow, result: { status: "optimal" }, solvedAt, inputsUpdatedAt: pmedianRow.createdAt }]));
    const res = await request(app).get("/api/scenarios/1").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(false);
  });

  it("patching inputs on a previously-solved scenario marks it stale", async () => {
    const cookie = await loginAs(OWNER);
    const solvedAt = new Date("2026-01-01T00:00:00Z");
    const solvedRow = { ...pmedianRow, result: { status: "optimal" }, solvedAt, inputsUpdatedAt: solvedAt };
    mockDb.select.mockReturnValue(makeChain([solvedRow]));
    const newInputs = { ...pmedianInputs, p: 5 };
    const bumpedAt = new Date("2026-01-02T00:00:00Z");
    mockDb.update.mockReturnValue(makeChain([{ ...solvedRow, inputs: newInputs, inputsUpdatedAt: bumpedAt }]));
    const res = await request(app).patch("/api/scenarios/1").set("Cookie", cookie).send({ inputs: newInputs });
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(true);
  });

  it("patching only name does not bump inputsUpdatedAt", async () => {
    const cookie = await loginAs(OWNER);
    const solvedAt = new Date("2026-01-01T00:00:00Z");
    const solvedRow = { ...pmedianRow, result: { status: "optimal" }, solvedAt, inputsUpdatedAt: solvedAt };
    mockDb.select.mockReturnValue(makeChain([solvedRow]));
    const chain = makeChain([{ ...solvedRow, name: "Renamed" }]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).patch("/api/scenarios/1").set("Cookie", cookie).send({ name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(false);
    const setArg = (chain.set as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(setArg).not.toHaveProperty("inputsUpdatedAt");
  });

  it("after a re-solve catches solvedAt up to inputsUpdatedAt, GET shows stale=false", async () => {
    // Same isStale() logic, exercised against the row shape a completed
    // re-solve leaves behind (jobRunner.test.ts covers the write itself).
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([{
      ...pmedianRow,
      result: { status: "optimal" },
      solvedAt: new Date("2026-01-03T00:00:00Z"),
      inputsUpdatedAt: new Date("2026-01-02T00:00:00Z"),
    }]));
    const res = await request(app).get("/api/scenarios/1").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(false);
  });
});

// ── Delete scenario ────────────────────────────────────────────────────────
describe("DELETE /api/scenarios/:id", () => {
  it("returns 204 on successful delete", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.delete.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).delete("/api/scenarios/1").set("Cookie", cookie);
    expect(res.status).toBe(204);
  });

  // Regression: a solved scenario owns solve_jobs rows whose
  // scenario_id FK points at it (no ON DELETE CASCADE). Deleting the
  // scenario first trips the FK constraint → 500. The fix deletes
  // solve_jobs inside a transaction BEFORE the scenario, scoped by both
  // scenarioId AND userId.
  it("returns 204 (not 500) when deleting a solved scenario that owns solve_jobs rows, and deletes the jobs first", async () => {
    const cookie = await loginAs(OWNER);
    // Sequence the deletes so the FIRST db.delete call (the solve_jobs
    // cleanup, scoped by scenarioId + userId) resolves cleanly, and the
    // SECOND (the scenario itself) returns the deleted scenario row.
    mockDb.delete
      .mockReturnValueOnce(makeChain([{ count: 1 }])) // solve_jobs delete
      .mockReturnValueOnce(makeChain([pmedianRow])); // scenario delete

    const res = await request(app).delete("/api/scenarios/1").set("Cookie", cookie);

    expect(res.status).toBe(204);
    expect(mockDb.delete).toHaveBeenCalledTimes(2);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    // Both deletes happened inside the transaction's callback (tx.delete),
    // not against the top-level db directly.
    const deleteCalls = (mockDb.delete as ReturnType<typeof vi.fn>).mock.calls;
    expect(deleteCalls[0][0]).toBe(solveJobsTable);
    expect(deleteCalls[1][0]).toBe(scenariosTable);
  });

  it("returns 404 when not found (no row deleted)", async () => {
    const cookie = await loginAs(OWNER);
    // Default: delete returns no deleted row → 404
    const res = await request(app).delete("/api/scenarios/999").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Not found" });
  });

  it("returns 404 (never leaks existence) when deleting a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    // Ownership-filtered delete affects zero rows → 404, same as nonexistent.
    mockDb.delete.mockReturnValue(makeChain([]));
    const res = await request(app).delete("/api/scenarios/1").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

// ── Export scenario ────────────────────────────────────────────────────────
describe("GET /api/scenarios/:id/export", () => {
  it("returns 401 without a session", async () => {
    expect((await request(app).get("/api/scenarios/1/export?entity=warehouses&format=json")).status).toBe(401);
  });

  it("returns 422 for an invalid entity", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1/export?entity=bogus&format=json").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  it("returns 422 for an invalid format", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1/export?entity=warehouses&format=bogus").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  it("returns 404 when not found", async () => {
    const cookie = await loginAs(OWNER);
    const res = await request(app).get("/api/scenarios/999/export?entity=warehouses&format=json").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) when exporting a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).get("/api/scenarios/1/export?entity=warehouses&format=json").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("returns 422 for a non-p-median-us scenario (transport)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).get("/api/scenarios/8/export?entity=warehouses&format=json").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  it("returns JSON with templateVersion/entity/rows reflecting scenario overrides", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...pmedianRow, inputs: { ...pmedianInputs, warehouseOverrides: [{ id: "ALN", status: "forced_open" }] } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/1/export?entity=warehouses&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.entity).toBe("warehouses");
    expect(typeof res.body.templateVersion).toBe("number");
    expect(res.body.rows).toHaveLength(26);
    expect(res.body.rows.find((r: { id: string }) => r.id === "ALN").status).toBe("forced_open");
  });

  it("returns CSV with a header row and one line per warehouse", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1/export?entity=warehouses&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const lines = (res.text as string).trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,lat,lng,capacity,status");
    expect(lines.length).toBe(27); // header + 26 warehouses
  });

  it("customer export reflects a demand override", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...pmedianRow, inputs: { ...pmedianInputs, customerOverrides: [{ id: "C1", status: "active", demand: 999 }] } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/1/export?entity=customers&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(200);
    expect(res.body.rows.find((r: { id: string }) => r.id === "C1").demand).toBe(999);
  });

  // Transport-coal mine/station export (Task 7) — mirrors the p-median-us
  // warehouses/customers export above, scoped to entity=mines|stations and
  // modelId=transport-coal.
  it("exports a transport-coal scenario's mine capacity overrides as CSV", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...transportRow, inputs: { ...transportInputs, mineCapacities: { KY: 1000000 } } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/8/export?entity=mines&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const lines = (res.text as string).trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,capacity");
    expect(lines.length).toBe(5); // header + 4 mines
    // KY's override must surface on its row.
    expect(lines.some((l) => l.startsWith("1,KY,"))).toBe(true);
  });

  it("exports a transport-coal scenario's mine overrides as JSON reflecting overrides", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...transportRow, inputs: { ...transportInputs, mineCapacities: { KY: 1000000 } } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/8/export?entity=mines&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.entity).toBe("mines");
    expect(res.body.rows).toHaveLength(4);
    expect(res.body.rows.find((r: { id: string }) => r.id === "KY").capacity).toBe(1000000);
  });

  it("exports a transport-coal scenario's station demand overrides as CSV", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...transportRow, inputs: { ...transportInputs, stationDemands: { CHI: 12000000 } } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/8/export?entity=stations&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const lines = (res.text as string).trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,demand");
    expect(lines.length).toBe(16); // header + 15 stations
    // CHI's override must surface on its row.
    expect(lines.some((l) => l.startsWith("1,CHI,"))).toBe(true);
  });

  it("exports a transport-coal scenario's station overrides as JSON reflecting overrides", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...transportRow, inputs: { ...transportInputs, stationDemands: { CHI: 12000000 } } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/8/export?entity=stations&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.entity).toBe("stations");
    expect(res.body.rows).toHaveLength(15);
    expect(res.body.rows.find((r: { id: string }) => r.id === "CHI").demand).toBe(12000000);
  });

  it("rejects entity=warehouses for a transport-coal scenario (422)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).get("/api/scenarios/8/export?entity=warehouses&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  it("rejects entity=mines for a p-median-us scenario (422)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1/export?entity=mines&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  // Two-echelon-gold-au refinery/customer export — mirrors the transport-coal
  // mines/stations pairing above, scoped to entity=refineries|customers and
  // modelId=two-echelon-gold-au. Only 2 refineries (the mine is excluded).
  it("exports a two-echelon-gold-au scenario's refinery overrides as CSV (mine excluded)", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...twoEchelonRow, inputs: { ...twoEchelonInputs, refineryOverrides: [{ id: "cunnamulla", status: "forced_open" }] } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/11/export?entity=refineries&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const lines = (res.text as string).trim().split("\n");
    expect(lines[0]).toBe("template_version,id,city,state,status");
    expect(lines.length).toBe(3); // header + 2 refineries, mine not included
    expect(lines.some((l) => l.startsWith("1,cunnamulla,") && l.endsWith("forced_open"))).toBe(true);
  });

  it("exports a two-echelon-gold-au scenario's refinery overrides as JSON", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...twoEchelonRow, inputs: { ...twoEchelonInputs, refineryOverrides: [{ id: "cunnamulla", status: "forced_open" }] } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/11/export?entity=refineries&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.entity).toBe("refineries");
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows.find((r: { id: string }) => r.id === "cunnamulla").status).toBe("forced_open");
  });

  it("exports a two-echelon-gold-au scenario's customer overrides against its own 10-customer dataset", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...twoEchelonRow, inputs: { ...twoEchelonInputs, customerOverrides: [{ id: "sydney", status: "active", demand: 1 }] } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/11/export?entity=customers&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(10);
    expect(res.body.rows.find((r: { id: string }) => r.id === "sydney").demand).toBe(1);
  });

  it("rejects entity=warehouses for a two-echelon-gold-au scenario (422)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([twoEchelonRow]));
    const res = await request(app).get("/api/scenarios/11/export?entity=warehouses&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  it("rejects entity=refineries for a p-median-us scenario (422)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1/export?entity=refineries&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  // B4.3 — warehouse/customer export gains lat/lng + overridden, plus added
  // entities.
  it("warehouse export includes lat/lng matching the real dataset coordinates", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1/export?entity=warehouses&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const aln = res.body.rows.find((r: { id: string }) => r.id === "ALN");
    const real = WAREHOUSES.find(w => w.id === "ALN")!;
    expect(aln.lat).toBeCloseTo(real.lat);
    expect(aln.lng).toBeCloseTo(real.lng);
    expect(aln.overridden).toBe(false);
  });

  it("an added warehouse appears in the export with overridden: true", async () => {
    const cookie = await loginAs(OWNER);
    const row = {
      ...pmedianRow,
      inputs: { ...pmedianInputs, addedWarehouses: [{ id: "WH-NEW1", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, capacity: null, status: "active" }] },
    };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/1/export?entity=warehouses&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(27);
    const added = res.body.rows.find((r: { id: string }) => r.id === "WH-NEW1");
    expect(added).toMatchObject({ city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, overridden: true });
  });

  it("a base warehouse with an active capacity override exports overridden: true", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...pmedianRow, inputs: { ...pmedianInputs, warehouseOverrides: [{ id: "ALN", status: "active", capacity: 500000 }] } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/1/export?entity=warehouses&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows.find((r: { id: string }) => r.id === "ALN").overridden).toBe(true);
  });

  // B4.3 — distances export.
  it("distances export returns only the current distanceOverrides, not the full base matrix", async () => {
    const cookie = await loginAs(OWNER);
    const row = {
      ...pmedianRow,
      inputs: { ...pmedianInputs, distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 123.4 }] },
    };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/1/export?entity=distances&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.entity).toBe("distances");
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({ fromId: "ALN", toId: "C1", distance: 123.4, overridden: true });
  });

  it("distances export CSV has the 4-column header, no overridden column", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...pmedianRow, inputs: { ...pmedianInputs, distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 123.4 }] } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/1/export?entity=distances&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const lines = (res.text as string).trim().split("\n");
    expect(lines[0]).toBe("template_version,from_id,to_id,distance");
    expect(lines.length).toBe(2);
  });

  it("returns an empty distances export when the scenario has no distanceOverrides", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1/export?entity=distances&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });

  it("rejects entity=distances for a transport-coal scenario (422)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).get("/api/scenarios/8/export?entity=distances&format=json").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  // B4.3 — stub generator (fill-in-the-blanks distance template).
  it("stubFor a warehouse id emits one blank row per active customer (200 minus excluded)", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...pmedianRow, inputs: { ...pmedianInputs, customerOverrides: [{ id: "C1", status: "excluded" }] } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/1/export?entity=distances&format=json&stubFor=ALN").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(CUSTOMERS.length - 1);
    expect(res.body.rows.every((r: { fromId: string; distance: null }) => r.fromId === "ALN" && r.distance === null)).toBe(true);
    expect(res.body.rows.some((r: { toId: string }) => r.toId === "C1")).toBe(false);
  });

  it("stubFor a customer id emits one blank row per active warehouse (26 minus excluded)", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...pmedianRow, inputs: { ...pmedianInputs, warehouseOverrides: [{ id: "ALN", status: "inactive" }] } };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/1/export?entity=distances&format=json&stubFor=C1").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(WAREHOUSES.length - 1);
    expect(res.body.rows.every((r: { toId: string; distance: null }) => r.toId === "C1" && r.distance === null)).toBe(true);
    expect(res.body.rows.some((r: { fromId: string }) => r.fromId === "ALN")).toBe(false);
  });

  it("stubFor an unrecognized id returns 422", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1/export?entity=distances&format=json&stubFor=bogus-id").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  it("stubFor combined with an entity other than distances returns 422", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1/export?entity=warehouses&format=json&stubFor=ALN").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });
});

// ── Import preview + apply ─────────────────────────────────────────────────
describe("POST /api/scenarios/:id/import", () => {
  // B4.2 — 8-column format (lat,lng inserted after state). ATL is an
  // existing base warehouse id (an UPDATE), so lat/lng are left blank —
  // allowed on update rows.
  const cleanCsv = "template_version,id,city,state,lat,lng,capacity,status\n1,ATL,Atlanta,GA,,,500000,forced_open\n";
  // ZZZ is unrecognized (add-mode candidate) but missing lat/lng, which is
  // required to add a brand-new warehouse — still a genuine logic error
  // under B4.2, just via the "missing required add-mode field" path
  // instead of the old blanket "unknown id" path.
  const badCsv = "template_version,id,city,state,lat,lng,capacity,status\n1,ZZZ,Nowhere,XX,,,,active\n";

  it("returns 401 without a session", async () => {
    const res = await request(app).post("/api/scenarios/1/import").send({ entity: "warehouses", csvText: cleanCsv });
    expect(res.status).toBe(401);
  });

  it("returns 404 (not 403) for a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/scenarios/1/import").set("Cookie", cookie).send({ entity: "warehouses", csvText: cleanCsv });
    expect(res.status).toBe(404);
  });

  it("returns 422 for a non-p-median-us scenario", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).post("/api/scenarios/8/import").set("Cookie", cookie).send({ entity: "warehouses", csvText: cleanCsv });
    expect(res.status).toBe(422);
  });

  it("returns a preview with no errors and one change for a clean CSV, without mutating the scenario", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).post("/api/scenarios/1/import").set("Cookie", cookie).send({ entity: "warehouses", csvText: cleanCsv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toHaveLength(1);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("returns a preview with a logic error for an add-candidate row missing required lat/lng", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).post("/api/scenarios/1/import").set("Cookie", cookie).send({ entity: "warehouses", csvText: badCsv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].errorClass).toBe("logic");
  });

  // B4.2 — an unrecognized id with full valid data (including lat/lng) is
  // no longer an error at all; it's an ADD-classified change.
  it("returns a preview with no errors and one ADD-classified change for an unrecognized id with valid full data", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const addCsv = "template_version,id,city,state,lat,lng,capacity,status\n1,WH-NEW1,Newtown,NC,35.5,-80.2,50000,active\n";
    const res = await request(app).post("/api/scenarios/1/import").set("Cookie", cookie).send({ entity: "warehouses", csvText: addCsv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0]).toMatchObject({ id: "WH-NEW1", changeType: "add", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2 });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  // Transport-coal mine/station import preview (Task 7).
  it("previews a transport-coal mine import with one change and no mutation", async () => {
    const cookie = await loginAs(OWNER);
    const mineCsv = "template_version,id,city,state,capacity\n1,KY,Pikeville,KY,1000000\n";
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).post("/api/scenarios/8/import").set("Cookie", cookie).send({ entity: "mines", csvText: mineCsv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0].id).toBe("KY");
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("previews a transport-coal station import with one change", async () => {
    const cookie = await loginAs(OWNER);
    const stationCsv = "template_version,id,city,state,demand\n1,CHI,Chicago,IL,12000000\n";
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).post("/api/scenarios/8/import").set("Cookie", cookie).send({ entity: "stations", csvText: stationCsv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0].id).toBe("CHI");
  });

  it("rejects entity=warehouses for a transport-coal import (422)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).post("/api/scenarios/8/import").set("Cookie", cookie).send({ entity: "warehouses", csvText: cleanCsv });
    expect(res.status).toBe(422);
  });

  // Two-echelon-gold-au refinery import preview (Task 7).
  it("previews a two-echelon-gold-au refinery import with one change and no mutation", async () => {
    const cookie = await loginAs(OWNER);
    const refineryCsv = "template_version,id,city,state,status\n1,cunnamulla,Cunnamulla,QLD,forced_open\n";
    mockDb.select.mockReturnValue(makeChain([twoEchelonRow]));
    const res = await request(app).post("/api/scenarios/11/import").set("Cookie", cookie).send({ entity: "refineries", csvText: refineryCsv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0].id).toBe("cunnamulla");
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("previews a two-echelon-gold-au customer import against its own dataset (not p-median's)", async () => {
    const cookie = await loginAs(OWNER);
    const customerCsv = "template_version,id,city,state,lat,lng,demand,status\n1,sydney,Sydney,NSW,,,1,active\n";
    mockDb.select.mockReturnValue(makeChain([twoEchelonRow]));
    const res = await request(app).post("/api/scenarios/11/import").set("Cookie", cookie).send({ entity: "customers", csvText: customerCsv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0].id).toBe("sydney");
  });

  it("rejects entity=warehouses for a two-echelon-gold-au import (422)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([twoEchelonRow]));
    const res = await request(app).post("/api/scenarios/11/import").set("Cookie", cookie).send({ entity: "warehouses", csvText: cleanCsv });
    expect(res.status).toBe(422);
  });

  // B4.1 — distances is p-median-us only (composite key, uses real
  // WAREHOUSES/CUSTOMERS ids ALN/C1 via mocked scenario 1).
  it("previews a p-median-us distances import with one composite-keyed change", async () => {
    const cookie = await loginAs(OWNER);
    const distancesCsv = "template_version,from_id,to_id,distance\n1,ALN,C1,123.4\n";
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).post("/api/scenarios/1/import").set("Cookie", cookie).send({ entity: "distances", csvText: distancesCsv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toEqual([{
      id: "ALN|C1",
      line: 2,
      before: { status: "active", value: null },
      after: { status: "active", value: 123.4 },
      fromId: "ALN",
      toId: "C1",
    }]);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("rejects entity=distances for a transport-coal import (422)", async () => {
    const cookie = await loginAs(OWNER);
    const distancesCsv = "template_version,from_id,to_id,distance\n1,ALN,C1,123.4\n";
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).post("/api/scenarios/8/import").set("Cookie", cookie).send({ entity: "distances", csvText: distancesCsv });
    expect(res.status).toBe(422);
  });
});

describe("POST /api/scenarios/:id/import/apply", () => {
  const cleanCsv = "template_version,id,city,state,lat,lng,capacity,status\n1,ATL,Atlanta,GA,,,500000,forced_open\n";
  const badCsv = "template_version,id,city,state,lat,lng,capacity,status\n1,ZZZ,Nowhere,XX,,,,active\n";

  it("all_or_nothing mode: an import with errors applies nothing (no DB write) and returns 422", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).post("/api/scenarios/1/import/apply").set("Cookie", cookie)
      .send({ entity: "warehouses", csvText: badCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(422);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("all_or_nothing mode: a clean import applies and persists the change via a single update", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const updatedRow = { ...pmedianRow, inputs: { ...pmedianInputs, warehouseOverrides: [{ id: "ATL", status: "forced_open", capacity: 500000 }] } };
    mockDb.update.mockReturnValue(makeChain([updatedRow]));
    const res = await request(app).post("/api/scenarios/1/import/apply").set("Cookie", cookie)
      .send({ entity: "warehouses", csvText: cleanCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(res.body.errors).toEqual([]);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  // B4.2 — ADD-classified rows write into addedWarehouses/addedCustomers,
  // not warehouseOverrides/customerOverrides; captures the actual
  // `.set(...)` payload (not just the mocked return value) to prove the
  // route computed and persisted the right shape, re-validated against
  // B1.1's Zod schema.
  it("all_or_nothing mode: applies an ADD-classified warehouse row into addedWarehouses, re-validated", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const chain = makeChain([{ ...pmedianRow, inputs: { ...pmedianInputs, addedWarehouses: [{ id: "WH-NEW1", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, capacity: 50000, status: "active" }] } }]);
    mockDb.update.mockReturnValue(chain);
    const addCsv = "template_version,id,city,state,lat,lng,capacity,status\n1,WH-NEW1,Newtown,NC,35.5,-80.2,50000,active\n";
    const res = await request(app).post("/api/scenarios/1/import/apply").set("Cookie", cookie)
      .send({ entity: "warehouses", csvText: addCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(res.body.errors).toEqual([]);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: { addedWarehouses: unknown[]; warehouseOverrides: unknown[] } };
    expect(setArgs.inputs.addedWarehouses).toEqual([{ id: "WH-NEW1", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, capacity: 50000, status: "active" }]);
    // The ADD row must not also land in warehouseOverrides — the two
    // arrays are disjoint write targets.
    expect(setArgs.inputs.warehouseOverrides).toEqual([]);
  });

  // Task 26 — addedCustomerSchema now has a real `state` field, so an
  // ADD-classified customer row's parsed CSV `state` column value is carried
  // all the way through to the persisted addedCustomers record (previously
  // discarded, since the schema had nowhere to put it).
  it("all_or_nothing mode: applies an ADD-classified customer row into addedCustomers, including state", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const chain = makeChain([{ ...pmedianRow, inputs: { ...pmedianInputs, addedCustomers: [{ id: "C-NEW1", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 1200 }] } }]);
    mockDb.update.mockReturnValue(chain);
    const addCsv = "template_version,id,city,state,lat,lng,demand,status\n1,C-NEW1,Newtown,NC,35.5,-80.2,1200,active\n";
    const res = await request(app).post("/api/scenarios/1/import/apply").set("Cookie", cookie)
      .send({ entity: "customers", csvText: addCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(res.body.errors).toEqual([]);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: { addedCustomers: unknown[] } };
    expect(setArgs.inputs.addedCustomers).toEqual([{ id: "C-NEW1", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 1200 }]);
  });

  it("returns 404 (not 403) when applying to a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/scenarios/1/import/apply").set("Cookie", cookie)
      .send({ entity: "warehouses", csvText: cleanCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(404);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  // Transport-coal mine import apply (Task 7) — persists into the
  // mineCapacities sparse dict, mirroring the warehouses array apply above.
  it("all_or_nothing mode: applies a clean transport-coal mine import into mineCapacities", async () => {
    const cookie = await loginAs(OWNER);
    const mineCsv = "template_version,id,city,state,capacity\n1,KY,Pikeville,KY,1000000\n";
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const updatedRow = { ...transportRow, inputs: { ...transportInputs, mineCapacities: { KY: 1000000 } } };
    mockDb.update.mockReturnValue(makeChain([updatedRow]));
    const res = await request(app).post("/api/scenarios/8/import/apply").set("Cookie", cookie)
      .send({ entity: "mines", csvText: mineCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(res.body.errors).toEqual([]);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  // Two-echelon-gold-au refinery import apply (Task 7) — persists into the
  // refineryOverrides array (status-only, no capacity field), mirroring the
  // warehouses array apply above.
  it("all_or_nothing mode: applies a clean two-echelon-gold-au refinery import into refineryOverrides", async () => {
    const cookie = await loginAs(OWNER);
    const refineryCsv = "template_version,id,city,state,status\n1,cunnamulla,Cunnamulla,QLD,forced_open\n";
    mockDb.select.mockReturnValue(makeChain([twoEchelonRow]));
    const updatedRow = { ...twoEchelonRow, inputs: { ...twoEchelonInputs, refineryOverrides: [{ id: "cunnamulla", status: "forced_open" }] } };
    mockDb.update.mockReturnValue(makeChain([updatedRow]));
    const res = await request(app).post("/api/scenarios/11/import/apply").set("Cookie", cookie)
      .send({ entity: "refineries", csvText: refineryCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(res.body.errors).toEqual([]);
    expect(res.body.scenario.inputs.refineryOverrides).toEqual([{ id: "cunnamulla", status: "forced_open" }]);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  // B4.2 — two-echelon-gold-au's customer entity also flows through the new
  // warehouses/customers apply branch (it shares the "customers" entity name
  // with p-median-us), but add-mode is p-median-us only — this scenario's
  // modelId means addChanges is always empty here. Confirms the new
  // re-validation step (validateInputsForModel against
  // twoEchelonInputsSchema, which has no addedCustomers field at all)
  // doesn't break this pre-existing, unrelated code path.
  it("all_or_nothing mode: applies a clean two-echelon-gold-au customer import into customerOverrides (add-mode inapplicable, re-validation is a no-op)", async () => {
    const cookie = await loginAs(OWNER);
    const customerCsv = "template_version,id,city,state,lat,lng,demand,status\n1,sydney,Sydney,NSW,,,999,active\n";
    mockDb.select.mockReturnValue(makeChain([twoEchelonRow]));
    const chain = makeChain([{ ...twoEchelonRow, inputs: { ...twoEchelonInputs, customerOverrides: [{ id: "sydney", status: "active", demand: 999 }] } }]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios/11/import/apply").set("Cookie", cookie)
      .send({ entity: "customers", csvText: customerCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(res.body.errors).toEqual([]);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: Record<string, unknown> };
    expect(setArgs.inputs.customerOverrides).toEqual([{ id: "sydney", status: "active", demand: 999 }]);
    // No addedCustomers leaks into a model whose schema has no such field.
    expect(setArgs.inputs.addedCustomers).toBeUndefined();
  });

  // B4.1 — distances apply persists into distanceOverrides via the
  // composite-key merge (mergeDistanceChangesIntoOverrides), not the
  // single-id mergeChangesIntoOverrides every other array-shaped entity uses.
  it("all_or_nothing mode: applies a clean p-median-us distances import into distanceOverrides", async () => {
    const cookie = await loginAs(OWNER);
    const distancesCsv = "template_version,from_id,to_id,distance\n1,ALN,C1,123.4\n";
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const updatedRow = { ...pmedianRow, inputs: { ...pmedianInputs, distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 123.4 }] } };
    mockDb.update.mockReturnValue(makeChain([updatedRow]));
    const res = await request(app).post("/api/scenarios/1/import/apply").set("Cookie", cookie)
      .send({ entity: "distances", csvText: distancesCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(res.body.errors).toEqual([]);
    expect(res.body.scenario.inputs.distanceOverrides).toEqual([{ fromId: "ALN", toId: "C1", distance: 123.4 }]);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it("all_or_nothing mode: a distances import with an unresolvable from_id applies nothing (422)", async () => {
    const cookie = await loginAs(OWNER);
    const badDistancesCsv = "template_version,from_id,to_id,distance\n1,ZZZ,C1,123.4\n";
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).post("/api/scenarios/1/import/apply").set("Cookie", cookie)
      .send({ entity: "distances", csvText: badDistancesCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(422);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

// ── Reset to baseline ───────────────────────────────────────────────────────
describe("POST /api/scenarios/:id/reset-to-baseline", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).post("/api/scenarios/1/reset-to-baseline");
    expect(res.status).toBe(401);
  });

  it("returns 404 (not 403) for a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/scenarios/1/reset-to-baseline").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("returns 422 for a p-median-brazil scenario (no overrides to reset)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([brazilRow]));
    const res = await request(app).post("/api/scenarios/10/reset-to-baseline").set("Cookie", cookie);
    expect(res.status).toBe(422);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("clears mineCapacities and stationDemands for a transport-coal scenario, leaving other inputs untouched", async () => {
    const cookie = await loginAs(OWNER);
    const dirtyRow = {
      ...transportRow,
      inputs: {
        ...transportInputs,
        mineCapacities: { KY: 1000000 },
        stationDemands: { CHI: 999 },
      },
    };
    mockDb.select.mockReturnValue(makeChain([dirtyRow]));
    const clearedRow = { ...transportRow, inputs: { ...transportInputs, mineCapacities: {}, stationDemands: {} } };
    mockDb.update.mockReturnValue(makeChain([clearedRow]));

    const res = await request(app).post("/api/scenarios/8/reset-to-baseline").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.inputs.mineCapacities).toEqual({});
    expect(res.body.inputs.stationDemands).toEqual({});
    // Other transport-coal inputs must survive the reset.
    expect(res.body.inputs.capacityFactor).toBe(transportInputs.capacityFactor);
    expect(res.body.inputs.singleSource).toBe(transportInputs.singleSource);
    expect(res.body.inputs.capacityInactive).toBe(transportInputs.capacityInactive);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it("clears refineryOverrides and customerOverrides for a two-echelon-gold-au scenario, leaving bomRatio untouched", async () => {
    const cookie = await loginAs(OWNER);
    const dirtyRow = {
      ...twoEchelonRow,
      inputs: { ...twoEchelonInputs, refineryOverrides: [{ id: "cunnamulla", status: "forced_open" }], customerOverrides: [{ id: "sydney", status: "active", demand: 1 }] },
    };
    mockDb.select.mockReturnValue(makeChain([dirtyRow]));
    const clearedRow = { ...twoEchelonRow, inputs: { ...twoEchelonInputs, refineryOverrides: [], customerOverrides: [] } };
    mockDb.update.mockReturnValue(makeChain([clearedRow]));

    const res = await request(app).post("/api/scenarios/11/reset-to-baseline").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.inputs.refineryOverrides).toEqual([]);
    expect(res.body.inputs.customerOverrides).toEqual([]);
    expect(res.body.inputs.bomRatio).toBe(twoEchelonInputs.bomRatio);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it("clears warehouseOverrides and customerOverrides, leaving other inputs untouched", async () => {
    const cookie = await loginAs(OWNER);
    const dirtyRow = {
      ...pmedianRow,
      inputs: {
        ...pmedianInputs,
        warehouseOverrides: [{ id: "ATL", status: "forced_open", capacity: 500000 }],
        customerOverrides: [{ id: "C1", status: "excluded" }],
      },
    };
    mockDb.select.mockReturnValue(makeChain([dirtyRow]));
    const clearedRow = { ...dirtyRow, inputs: { ...pmedianInputs, warehouseOverrides: [], customerOverrides: [] } };
    mockDb.update.mockReturnValue(makeChain([clearedRow]));

    const res = await request(app).post("/api/scenarios/1/reset-to-baseline").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.inputs.warehouseOverrides).toEqual([]);
    expect(res.body.inputs.customerOverrides).toEqual([]);
    expect(res.body.inputs.p).toBe(pmedianInputs.p);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the scenario does not exist", async () => {
    const cookie = await loginAs(OWNER);
    const res = await request(app).post("/api/scenarios/999/reset-to-baseline").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

// ── Clone scenario ─────────────────────────────────────────────────────────
describe("POST /api/scenarios/:id/clone", () => {
  it("returns 201 with name '<original> (copy)' and null result", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([{ ...pmedianRow, name: "My Scenario" }]));
    mockDb.insert.mockReturnValue(makeChain([{ ...pmedianRow, id: 2, name: "My Scenario (copy)" }]));
    const res = await request(app).post("/api/scenarios/1/clone").set("Cookie", cookie);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My Scenario (copy)");
    expect(res.body.result).toBeNull();
  });

  it("clones a Brazil scenario with null result", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([{ ...brazilRow, name: "Brazil Base" }]));
    mockDb.insert.mockReturnValue(makeChain([{ ...brazilRow, id: 11, name: "Brazil Base (copy)" }]));
    const res = await request(app).post("/api/scenarios/10/clone").set("Cookie", cookie);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Brazil Base (copy)");
    expect(res.body.modelId).toBe("p-median-brazil");
    expect(res.body.result).toBeNull();
  });

  it("returns 404 when original not found", async () => {
    const cookie = await loginAs(OWNER);
    // Default: select returns [] → 404
    const res = await request(app).post("/api/scenarios/999/clone").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) when cloning a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/scenarios/1/clone").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

// ── Solve scenario ─────────────────────────────────────────────────────────
describe("POST /api/scenarios/:id/solve", () => {
  // G3.1: solve is now async — the route's job is to validate + enqueue and
  // return 202 {jobId}. Input-translation (buildPayload) and result-shape
  // translation (envelopeToLegacy) are pure functions covered directly in
  // pmedian.test.ts; the actual job lifecycle is covered in
  // jobRunner.test.ts. This block only tests the route's own contract.
  it("returns 202 with a jobId and enqueues the job with the scenario's modelId/inputs", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    mockEnqueueSolveJob.mockResolvedValue(42);

    const res = await request(app).post("/api/scenarios/1/solve").set("Cookie", cookie);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe(42);
    expect(mockEnqueueSolveJob).toHaveBeenCalledWith(1, OWNER, { modelId: "p-median-us", inputs: pmedianInputs });
  });

  it("enqueues transport-coal scenarios with their modelId/inputs", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    mockEnqueueSolveJob.mockResolvedValue(7);

    const res = await request(app).post("/api/scenarios/8/solve").set("Cookie", cookie);
    expect(res.status).toBe(202);
    expect(mockEnqueueSolveJob).toHaveBeenCalledWith(8, OWNER, { modelId: "transport-coal", inputs: { ...transportInputs, mineCapacities: {}, stationDemands: {}, addedMines: [], addedStations: [], laneCostOverrides: [] } });
  });

  it("enqueues p-median-brazil scenarios with their modelId/inputs", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([brazilRow]));
    mockEnqueueSolveJob.mockResolvedValue(9);

    const res = await request(app).post("/api/scenarios/10/solve").set("Cookie", cookie);
    expect(res.status).toBe(202);
    expect(mockEnqueueSolveJob).toHaveBeenCalledWith(10, OWNER, { modelId: "p-median-brazil", inputs: brazilInputs });
  });

  it("returns 404 when scenario not found", async () => {
    const cookie = await loginAs(OWNER);
    // Default: select returns [] → 404
    const res = await request(app).post("/api/scenarios/999/solve").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(mockEnqueueSolveJob).not.toHaveBeenCalled();
  });

  it("returns 404 (not 403) when solving a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/scenarios/1/solve").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(mockEnqueueSolveJob).not.toHaveBeenCalled();
  });

  it("returns 422 when the scenario's stored inputs fail model validation", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([{ ...pmedianRow, inputs: { ...pmedianInputs, capacityMode: "bogus" } }]));
    const res = await request(app).post("/api/scenarios/1/solve").set("Cookie", cookie);
    expect(res.status).toBe(422);
    expect(mockEnqueueSolveJob).not.toHaveBeenCalled();
  });

  // P1.1 — backpressure: queue depth at/over the threshold sheds load with
  // 429 + Retry-After instead of enqueuing.
  it("returns 429 with a Retry-After header when queue depth is at the limit, and does not enqueue", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    mockGetQueueDepth.mockReturnValue(30); // mocked QUEUE_DEPTH_LIMIT is 30

    const res = await request(app).post("/api/scenarios/1/solve").set("Cookie", cookie);

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(res.body.error).toBeTypeOf("string");
    expect(mockEnqueueSolveJob).not.toHaveBeenCalled();
  });

  it("returns 429 when queue depth exceeds the limit (not just exactly at it)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    mockGetQueueDepth.mockReturnValue(31);

    const res = await request(app).post("/api/scenarios/1/solve").set("Cookie", cookie);
    expect(res.status).toBe(429);
    expect(mockEnqueueSolveJob).not.toHaveBeenCalled();
  });

  it("still enqueues normally when queue depth is just below the limit", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    mockGetQueueDepth.mockReturnValue(29);
    mockEnqueueSolveJob.mockResolvedValue(55);

    const res = await request(app).post("/api/scenarios/1/solve").set("Cookie", cookie);
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe(55);
    expect(mockEnqueueSolveJob).toHaveBeenCalled();
  });

  it("the 429 backpressure check runs before the scenario ownership lookup (fails fast without a DB query)", async () => {
    const cookie = await loginAs(OWNER);
    mockGetQueueDepth.mockReturnValue(30);
    // mockDb.select default (from beforeEach) returns [] — if the route queried
    // the DB before the capacity check, a nonexistent scenario would 404 instead
    // of 429; asserting 429 here proves the capacity check ran first.
    const res = await request(app).post("/api/scenarios/999999/solve").set("Cookie", cookie);
    expect(res.status).toBe(429);
  });

  // B2.1 — semantic precheck runs after shape validation, before enqueue.
  it("returns 422 with structured precheck errors when a p-median-us scenario's network edits fail precheck, and does not enqueue", async () => {
    const cookie = await loginAs(OWNER);
    const row = {
      ...pmedianRow,
      inputs: {
        ...pmedianInputs,
        // Reuses a real base-dataset warehouse id — an id-collision finding.
        addedWarehouses: [{ id: WAREHOUSES[0].id, city: "X", state: "XX", lat: 0, lng: 0, status: "active" }],
      },
    };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).post("/api/scenarios/1/solve").set("Cookie", cookie);
    expect(res.status).toBe(422);
    expect(res.body.error).toBeTypeOf("string");
    expect(res.body.errors).toContainEqual({
      code: "id_collision",
      message: `Added warehouse id '${WAREHOUSES[0].id}' collides with an existing base-dataset warehouse id`,
    });
    expect(mockEnqueueSolveJob).not.toHaveBeenCalled();
  });

  it("still enqueues a p-median-us scenario with no network edits (precheck trivially passes)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    mockEnqueueSolveJob.mockResolvedValue(99);
    const res = await request(app).post("/api/scenarios/1/solve").set("Cookie", cookie);
    expect(res.status).toBe(202);
    expect(mockEnqueueSolveJob).toHaveBeenCalled();
  });

  it("does not run the p-median-us precheck against non-p-median-us models (transport-coal enqueues with its own trivially-passing precheck)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    mockEnqueueSolveJob.mockResolvedValue(100);
    const res = await request(app).post("/api/scenarios/8/solve").set("Cookie", cookie);
    expect(res.status).toBe(202);
    expect(mockEnqueueSolveJob).toHaveBeenCalled();
  });

  // B6.1 — transport-coal gets its own precheck function (precheckTransportInputs).
  it("returns 422 with structured precheck errors when a transport-coal scenario's network edits fail precheck, and does not enqueue", async () => {
    const cookie = await loginAs(OWNER);
    const row = {
      ...transportRow,
      inputs: {
        ...transportInputs,
        // Reuses a real base-dataset mine id — an id-collision finding.
        addedMines: [{ id: TRANSPORT_COAL_WAREHOUSES[0].id, city: "X", state: "XX", lat: 0, lng: 0 }],
      },
    };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).post("/api/scenarios/8/solve").set("Cookie", cookie);
    expect(res.status).toBe(422);
    expect(res.body.error).toBeTypeOf("string");
    expect(res.body.errors).toContainEqual({
      code: "id_collision",
      message: `Added mine id '${TRANSPORT_COAL_WAREHOUSES[0].id}' collides with an existing base-dataset mine id`,
    });
    expect(mockEnqueueSolveJob).not.toHaveBeenCalled();
  });

  it("still enqueues a transport-coal scenario with no network edits (precheck trivially passes)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    mockEnqueueSolveJob.mockResolvedValue(102);
    const res = await request(app).post("/api/scenarios/8/solve").set("Cookie", cookie);
    expect(res.status).toBe(202);
    expect(mockEnqueueSolveJob).toHaveBeenCalled();
  });

  // B6.3 — p-median-brazil fast-follows p-median-us' precheck wiring.
  it("returns 422 with structured precheck errors when a p-median-brazil scenario's network edits fail precheck, and does not enqueue", async () => {
    const cookie = await loginAs(OWNER);
    const row = {
      ...brazilRow,
      inputs: {
        ...brazilInputs,
        // Reuses a real Brazil base-dataset warehouse id — an id-collision finding.
        addedWarehouses: [{ id: BRAZIL_WAREHOUSES[0].id, city: "X", state: "XX", lat: 0, lng: 0, status: "active" }],
      },
    };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).post("/api/scenarios/10/solve").set("Cookie", cookie);
    expect(res.status).toBe(422);
    expect(res.body.error).toBeTypeOf("string");
    expect(res.body.errors).toContainEqual({
      code: "id_collision",
      message: `Added warehouse id '${BRAZIL_WAREHOUSES[0].id}' collides with an existing base-dataset warehouse id`,
    });
    expect(mockEnqueueSolveJob).not.toHaveBeenCalled();
  });

  it("still enqueues a p-median-brazil scenario with no network edits (precheck trivially passes)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([brazilRow]));
    mockEnqueueSolveJob.mockResolvedValue(101);
    const res = await request(app).post("/api/scenarios/10/solve").set("Cookie", cookie);
    expect(res.status).toBe(202);
    expect(mockEnqueueSolveJob).toHaveBeenCalled();
  });
});

// B2.1 — standalone precheck endpoint (frontend inline warnings, B5.2).
describe("GET /api/scenarios/:id/precheck", () => {
  it("returns 401 without a session", async () => {
    expect((await request(app).get("/api/scenarios/1/precheck")).status).toBe(401);
  });

  it("returns 404 when not found", async () => {
    const cookie = await loginAs(OWNER);
    const res = await request(app).get("/api/scenarios/999/precheck").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) for a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).get("/api/scenarios/1/precheck").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("returns ok:true with no errors for a scenario with no network edits", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1/precheck").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, errors: [] });
  });

  it("returns the same structured errors the solve route's 422 would return, for the same scenario state", async () => {
    const cookie = await loginAs(OWNER);
    const row = {
      ...pmedianRow,
      inputs: {
        ...pmedianInputs,
        addedWarehouses: [{ id: WAREHOUSES[0].id, city: "X", state: "XX", lat: 0, lng: 0, status: "active" }],
      },
    };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/1/precheck").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors).toContainEqual({
      code: "id_collision",
      message: `Added warehouse id '${WAREHOUSES[0].id}' collides with an existing base-dataset warehouse id`,
    });
  });

  it("never writes to the DB (read-only)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    await request(app).get("/api/scenarios/1/precheck").set("Cookie", cookie);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  // B6.3 — p-median-brazil fast-follow: same endpoint, checked against the
  // real Brazil base dataset (BRAZIL_DATASET) instead of p-median-us's.
  it("returns structured precheck errors for a p-median-brazil scenario against the real Brazil dataset", async () => {
    const cookie = await loginAs(OWNER);
    const row = {
      ...brazilRow,
      inputs: {
        ...brazilInputs,
        addedWarehouses: [{ id: BRAZIL_WAREHOUSES[0].id, city: "X", state: "XX", lat: 0, lng: 0, status: "active" }],
      },
    };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/10/precheck").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors).toContainEqual({
      code: "id_collision",
      message: `Added warehouse id '${BRAZIL_WAREHOUSES[0].id}' collides with an existing base-dataset warehouse id`,
    });
  });

  // B6.1 — transport-coal fast-follow: same endpoint, checked against
  // precheckTransportInputs and the real transport-coal base dataset.
  it("returns structured precheck errors for a transport-coal scenario against the real transport-coal dataset", async () => {
    const cookie = await loginAs(OWNER);
    const row = {
      ...transportRow,
      inputs: {
        ...transportInputs,
        addedMines: [{ id: TRANSPORT_COAL_WAREHOUSES[0].id, city: "X", state: "XX", lat: 0, lng: 0 }],
      },
    };
    mockDb.select.mockReturnValue(makeChain([row]));
    const res = await request(app).get("/api/scenarios/8/precheck").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.errors).toContainEqual({
      code: "id_collision",
      message: `Added mine id '${TRANSPORT_COAL_WAREHOUSES[0].id}' collides with an existing base-dataset mine id`,
    });
  });

  it("returns ok:true with no errors for a transport-coal scenario with no network edits", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).get("/api/scenarios/8/precheck").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, errors: [] });
  });
});

// ── Solve job polling ──────────────────────────────────────────────────────
describe("GET /api/scenarios/:id/solve-jobs/:jobId", () => {
  const jobRow = {
    id: 42, scenarioId: 1, userId: OWNER, status: "succeeded",
    inputsHash: "abc123", resultSummary: { status: "optimal", objective: 100 }, error: null,
    queuedAt: new Date("2026-01-01T00:00:00Z"),
    startedAt: new Date("2026-01-01T00:00:01Z"),
    finishedAt: new Date("2026-01-01T00:00:02Z"),
  };

  it("returns 200 with the job's status", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([jobRow]));
    const res = await request(app).get("/api/scenarios/1/solve-jobs/42").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("succeeded");
    expect(res.body.resultSummary).toEqual({ status: "optimal", objective: 100 });
    expect(res.body.error).toBeNull();
  });

  it("returns 401 without a session", async () => {
    const res = await request(app).get("/api/scenarios/1/solve-jobs/42");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the job does not exist", async () => {
    const cookie = await loginAs(OWNER);
    // Default: select returns [] → 404
    const res = await request(app).get("/api/scenarios/1/solve-jobs/999").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) for a job owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).get("/api/scenarios/1/solve-jobs/42").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

// ── Solve history (G3.2) ─────────────────────────────────────────────────────
describe("GET /api/solve-history", () => {
  const historyRow1 = {
    id: 10, scenarioId: 1, status: "succeeded",
    resultSummary: { status: "optimal", objective: 94500000, weightedAvgDistanceMi: 412.6, runTimeSec: 0.4 },
    queuedAt: new Date("2026-01-02T00:00:00Z"),
    finishedAt: new Date("2026-01-02T00:00:01Z"),
    scenarioName: "3 Warehouses", modelId: "p-median-us",
  };
  const historyRow2 = {
    id: 9, scenarioId: 8, status: "failed",
    resultSummary: null,
    queuedAt: new Date("2026-01-01T00:00:00Z"),
    finishedAt: new Date("2026-01-01T00:00:05Z"),
    scenarioName: "Coal Base Case", modelId: "transport-coal",
  };

  it("returns 401 without a session", async () => {
    const res = await request(app).get("/api/solve-history");
    expect(res.status).toBe(401);
  });

  it("returns the caller's jobs newest first, joined to scenario name/modelId", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([historyRow1, historyRow2]));
    const res = await request(app).get("/api/solve-history").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      id: 10, scenarioId: 1, scenarioName: "3 Warehouses", modelId: "p-median-us",
      status: "succeeded", objective: 94500000, weightedAvgDistanceMi: 412.6, runTimeSec: 0.4,
    });
  });

  it("defaults resultSummary fields to null for a failed job with no summary", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([historyRow2]));
    const res = await request(app).get("/api/solve-history").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ status: "failed", objective: null, weightedAvgDistanceMi: null, runTimeSec: null });
  });

  it("defaults limit to 5 and caps an oversized limit at 50", async () => {
    const cookie = await loginAs(OWNER);
    const chain = makeChain([]);
    mockDb.select.mockReturnValue(chain);
    await request(app).get("/api/solve-history?limit=9999").set("Cookie", cookie);
    expect(chain.limit).toHaveBeenCalledWith(50);
  });

  it("returns an empty array when the caller has never solved anything", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).get("/api/solve-history").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── Compare scenarios ──────────────────────────────────────────────────────
describe("POST /api/scenarios/compare", () => {
  // Standardized result envelope (Phase 3.5/G2.1) — this is the current
  // scenario.result shape; compare must read it as-is, not the old
  // pre-envelope flat fields (utilization/openWarehouseIds/bandCoverage/etc
  // at the top level).
  function envelope(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      status: "optimal",
      objective: 182000000,
      runTimeSec: 0.5,
      quality: "Proven optimal",
      edges: [],
      metrics: { utilizationByNode: [], bandCoverage: [], weightedAvgDistance: 561.3 },
      details: { openWarehouseIds: ["LA", "CHI"] },
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: null,
      ...overrides,
    };
  }

  const solvedAt = new Date("2026-01-05T00:00:00Z");
  const row1 = {
    ...pmedianRow, id: 1, name: "2 WH",
    result: envelope(), solvedAt, inputsUpdatedAt: pmedianRow.createdAt,
  };
  const row2 = {
    ...pmedianRow, id: 2, name: "3 WH",
    result: envelope({ objective: 134000000 }), solvedAt, inputsUpdatedAt: pmedianRow.createdAt,
  };

  it("returns 400 when fewer than 2 IDs provided", async () => {
    const cookie = await loginAs(OWNER);
    const res = await request(app)
      .post("/api/scenarios/compare")
      .set("Cookie", cookie)
      .send({ scenarioIds: [1] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("2");
  });

  it("returns 400 when scenarioIds is empty", async () => {
    const cookie = await loginAs(OWNER);
    const res = await request(app)
      .post("/api/scenarios/compare")
      .set("Cookie", cookie)
      .send({ scenarioIds: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when more than 4 IDs provided", async () => {
    const cookie = await loginAs(OWNER);
    const res = await request(app)
      .post("/api/scenarios/compare")
      .set("Cookie", cookie)
      .send({ scenarioIds: [1, 2, 3, 4, 5] });
    expect(res.status).toBe(400);
  });

  it("returns 404 when a requested scenario doesn't exist or isn't owned by the caller", async () => {
    const cookie = await loginAs(OWNER);
    // The DB query already scopes by userId — a non-owned/nonexistent id
    // simply doesn't come back, so only 1 of the 2 requested rows resolves.
    mockDb.select.mockReturnValueOnce(makeChain([row1]));
    const res = await request(app)
      .post("/api/scenarios/compare")
      .set("Cookie", cookie)
      .send({ scenarioIds: [1, 999] });
    expect(res.status).toBe(404);
  });

  it("returns 422 when scenarios don't share the same model", async () => {
    const cookie = await loginAs(OWNER);
    const brazilRowSolved = {
      ...brazilRow, id: 10,
      result: envelope(), solvedAt, inputsUpdatedAt: brazilRow.createdAt,
    };
    mockDb.select.mockReturnValueOnce(makeChain([row1, brazilRowSolved]));
    const res = await request(app)
      .post("/api/scenarios/compare")
      .set("Cookie", cookie)
      .send({ scenarioIds: [1, 10] });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/same model/i);
  });

  it("returns 422 listing offending IDs when a scenario is unsolved", async () => {
    const cookie = await loginAs(OWNER);
    const unsolvedRow = { ...pmedianRow, id: 3, result: null, solvedAt: null };
    mockDb.select.mockReturnValueOnce(makeChain([row1, unsolvedRow]));
    const res = await request(app)
      .post("/api/scenarios/compare")
      .set("Cookie", cookie)
      .send({ scenarioIds: [1, 3] });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/solved/i);
    expect(res.body.offendingIds).toEqual([3]);
  });

  it("returns 422 listing offending IDs when a scenario is stale", async () => {
    const cookie = await loginAs(OWNER);
    const staleRow = {
      ...pmedianRow, id: 4,
      result: envelope(), solvedAt, inputsUpdatedAt: new Date("2026-01-06T00:00:00Z"),
    };
    mockDb.select.mockReturnValueOnce(makeChain([row1, staleRow]));
    const res = await request(app)
      .post("/api/scenarios/compare")
      .set("Cookie", cookie)
      .send({ scenarioIds: [1, 4] });
    expect(res.status).toBe(422);
    expect(res.body.offendingIds).toEqual([4]);
  });

  it("returns 200 with each scenario's opaque inputs and result envelope", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([row1, row2]));

    const res = await request(app)
      .post("/api/scenarios/compare")
      .set("Cookie", cookie)
      .send({ scenarioIds: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body.scenarios).toHaveLength(2);
    expect(res.body.scenarios[0].name).toBe("2 WH");
    expect(res.body.scenarios[0].inputs).toEqual(pmedianInputs);
    expect(res.body.scenarios[0].result.objective).toBe(182000000);
    expect(res.body.scenarios[0].result.details).toEqual({ openWarehouseIds: ["LA", "CHI"] });
    expect(res.body.scenarios[0].stale).toBe(false);
    expect(res.body.scenarios[1].name).toBe("3 WH");
    expect(res.body.scenarios[1].result.objective).toBe(134000000);
  });

  it("returns scenarios in the requested order, regardless of DB row order", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([row2, row1]));

    const res = await request(app)
      .post("/api/scenarios/compare")
      .set("Cookie", cookie)
      .send({ scenarioIds: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body.scenarios.map((s: { id: number }) => s.id)).toEqual([1, 2]);
  });
});

// ── Transport LP field serialization ───────────────────────────────────────
describe("transport scenario — field serialization", () => {
  it("GET /api/scenarios returns transport fields", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).get("/api/scenarios").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const s = res.body[0];
    expect(s.modelId).toBe("transport-coal");
    expect(s.inputs.capacityFactor).toBe(1.0);
    expect(s.inputs.singleSource).toBe(false);
    expect(s.inputs.capacityInactive).toBe(false);
  });

  it("GET /api/scenarios/:id returns transport fields", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    const res = await request(app).get("/api/scenarios/8").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.modelId).toBe("transport-coal");
    expect(res.body.inputs.capacityFactor).toBe(1.0);
    expect(res.body.inputs.singleSource).toBe(false);
    expect(res.body.inputs.capacityInactive).toBe(false);
  });

  it("POST /api/scenarios stores transport fields from body", async () => {
    const cookie = await loginAs(OWNER);
    const newInputs = { ...transportInputs, capacityFactor: 1.1, singleSource: true };
    const created = { ...transportRow, id: 9, inputs: newInputs };
    mockDb.insert.mockReturnValue(makeChain([created]));
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie).send({
      name: "Coal +10%",
      modelId: "transport-coal",
      inputs: newInputs,
    });
    expect(res.status).toBe(201);
    expect(res.body.modelId).toBe("transport-coal");
    expect(res.body.inputs.capacityFactor).toBe(1.1);
    expect(res.body.inputs.singleSource).toBe(true);
  });
});

