import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import argon2 from "argon2";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const mockSolveFn = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: mockDb,
  scenariosTable: { id: "id", name: "name", userId: "user_id", modelId: "model_id", createdAt: "created_at", updatedAt: "updated_at" },
  usersTable: { id: "id", email: "email" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ col: _col, val })),
  and: vi.fn((...conds: unknown[]) => ({ and: conds })),
}));

vi.mock("../solver/pmedian.js", () => ({
  solve: mockSolveFn,
}));

import app from "../app.js";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";

// ---------------------------------------------------------------------------
// Chainable drizzle mock
// ---------------------------------------------------------------------------
function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  ["select","from","where","orderBy","insert","values",
   "returning","update","set","delete"].forEach(m => {
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

beforeEach(() => {
  vi.clearAllMocks();
  resetLoginRateLimiterForTests();
  // Defaults: not found / no-op. clearAllMocks() only resets call history, not
  // configured return values, so every mock needs an explicit per-test-file default
  // or a later test can silently inherit an earlier test's mockReturnValue.
  mockDb.select.mockReturnValue(makeChain([]));
  mockDb.update.mockReturnValue(makeChain([]));
  mockDb.delete.mockReturnValue(makeChain(undefined));
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

// ── Delete scenario ────────────────────────────────────────────────────────
describe("DELETE /api/scenarios/:id", () => {
  it("returns 204 on successful delete", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.delete.mockReturnValue(makeChain(undefined));
    const res = await request(app).delete("/api/scenarios/1").set("Cookie", cookie);
    expect(res.status).toBe(204);
  });

  it("returns 204 even when not found (idempotent)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.delete.mockReturnValue(makeChain(undefined));
    const res = await request(app).delete("/api/scenarios/999").set("Cookie", cookie);
    expect(res.status).toBe(204);
  });

  it("returns 204 (never leaks existence) when deleting a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    mockDb.delete.mockReturnValue(makeChain(undefined));
    const res = await request(app).delete("/api/scenarios/1").set("Cookie", cookie);
    expect(res.status).toBe(204);
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
    expect(lines[0]).toBe("template_version,id,city,state,capacity,status");
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
  const solverResult = {
    status: "optimal",
    openWarehouseIds: ["CHI", "ATL"],
    assignments: [],
    objective: 134000000,
    weightedAvgDistanceMi: 412.6,
    bandCoverage: [],
    utilization: [],
    runTimeSec: 0.4,
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("returns 200 with result populated from solver", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    mockDb.update.mockReturnValue(makeChain([{ ...pmedianRow, result: solverResult }]));
    mockSolveFn.mockReturnValue(solverResult);

    const res = await request(app).post("/api/scenarios/1/solve").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("optimal");
    expect(res.body.result.openWarehouseIds).toContain("CHI");
  });

  it("returns 404 when scenario not found", async () => {
    const cookie = await loginAs(OWNER);
    // Default: select returns [] → 404
    const res = await request(app).post("/api/scenarios/999/solve").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) when solving a scenario owned by a different user", async () => {
    const cookie = await loginAs("other-user-id");
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/scenarios/1/solve").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});

// ── Compare scenarios ──────────────────────────────────────────────────────
describe("POST /api/scenarios/compare", () => {
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

  it("returns 200 with comparison metrics for 2 valid scenarios", async () => {
    const cookie = await loginAs(OWNER);
    const row1 = {
      ...pmedianRow, id: 1, name: "2 WH",
      result: {
        status: "optimal",
        openWarehouseIds: ["LA", "CHI"],
        objective: 182000000,
        weightedAvgDistanceMi: 561.3,
        bandCoverage: [{ band: 200, percent: 26 }],
        utilization: [
          { warehouseId: "LA", utilization: 91 },
          { warehouseId: "CHI", utilization: 91 },
        ],
      },
    };
    const row2 = {
      ...pmedianRow, id: 2, name: "3 WH",
      result: {
        status: "optimal",
        openWarehouseIds: ["LA", "CHI", "ATL"],
        objective: 134000000,
        weightedAvgDistanceMi: 412.6,
        bandCoverage: [{ band: 200, percent: 38 }],
        utilization: [
          { warehouseId: "LA", utilization: 72 },
          { warehouseId: "CHI", utilization: 85 },
          { warehouseId: "ATL", utilization: 64 },
        ],
      },
    };

    // compare fetches each id sequentially: select call #1 → row1, #2 → row2
    mockDb.select
      .mockReturnValueOnce(makeChain([row1]))
      .mockReturnValueOnce(makeChain([row2]));

    const res = await request(app)
      .post("/api/scenarios/compare")
      .set("Cookie", cookie)
      .send({ scenarioIds: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body.scenarios).toHaveLength(2);
    expect(res.body.scenarios[0].name).toBe("2 WH");
    expect(res.body.scenarios[1].name).toBe("3 WH");
    expect(res.body.scenarios[0].openSites).toContain("Los Angeles");
    expect(res.body.scenarios[0].avgUtilization).toBe(91);
    expect(res.body.scenarios[1].avgUtilization).toBe(74);
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

// ── Transport solve ────────────────────────────────────────────────────────
describe("POST /api/scenarios/:id/solve — transport", () => {
  const transportSolverResult = {
    status: "optimal",
    openWarehouseIds: [],
    assignments: [
      { customerId: "STN1", warehouseId: "MINE1", distanceMi: 450, band: 0, flowTons: 7000000, flowFraction: 1.0 },
    ],
    objective: 50840650000,
    weightedAvgDistanceMi: 696.4,
    bandCoverage: [],
    utilization: [],
    runTimeSec: 0.3,
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("passes transport fields to the solver and returns result", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...transportRow, inputs: { ...transportInputs, capacityFactor: 1.1, singleSource: true } };
    mockDb.select.mockReturnValue(makeChain([row]));
    mockDb.update.mockReturnValue(makeChain([{ ...row, result: transportSolverResult }]));
    mockSolveFn.mockReturnValue(transportSolverResult);

    const res = await request(app).post("/api/scenarios/8/solve").set("Cookie", cookie);
    expect(res.status).toBe(200);

    const solveCall = mockSolveFn.mock.calls[0][0] as { modelId: string; inputs: Record<string, unknown> };
    expect(solveCall.modelId).toBe("transport-coal");
    expect(solveCall.inputs.capacityFactor).toBe(1.1);
    expect(solveCall.inputs.singleSource).toBe(true);
    expect(solveCall.inputs.capacityInactive).toBe(false);
  });

  it("returns transport flow assignments in result", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([transportRow]));
    mockDb.update.mockReturnValue(makeChain([{ ...transportRow, result: transportSolverResult }]));
    mockSolveFn.mockReturnValue(transportSolverResult);

    const res = await request(app).post("/api/scenarios/8/solve").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("optimal");
    expect(res.body.result.objective).toBe(50840650000);
    expect(res.body.result.assignments).toHaveLength(1);
    expect(res.body.result.assignments[0].flowTons).toBe(7000000);
  });
});

// ── Brazil solve ───────────────────────────────────────────────────────────
describe("POST /api/scenarios/:id/solve — Brazil capacitated p-median", () => {
  const brazilInfeasibleResult = {
    status: "infeasible",
    openWarehouseIds: [],
    assignments: [],
    objective: 0,
    weightedAvgDistanceMi: 0,
    bandCoverage: [],
    utilization: [],
    runTimeSec: 0.1,
    solverUsed: "CBC (PuLP)",
    infeasibilityReason:
      "Demand region São Paulo (29,029,226) exceeds single-warehouse capacity (20,000,000). Relax single-sourcing to split demand across warehouses.",
  };

  const brazilFeasibleResult = {
    status: "optimal",
    openWarehouseIds: ["SAO", "RIO", "CUR", "REC", "MAN"],
    assignments: [
      { customerId: "SP", warehouseId: "SAO", distanceMi: 12, flowFraction: 0.69 },
      { customerId: "SP", warehouseId: "CUR", distanceMi: 234, flowFraction: 0.31 },
    ],
    objective: 8500000000,
    weightedAvgDistanceMi: 287.3,
    bandCoverage: [],
    utilization: [],
    runTimeSec: 1.2,
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("returns infeasible status when singleSource=true and São Paulo exceeds capacity", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...brazilRow, inputs: { ...brazilInputs, singleSource: true } };
    mockDb.select.mockReturnValue(makeChain([row]));
    mockDb.update.mockReturnValue(makeChain([{ ...row, result: brazilInfeasibleResult }]));
    mockSolveFn.mockReturnValue(brazilInfeasibleResult);
    const res = await request(app).post("/api/scenarios/10/solve").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("infeasible");
    expect(res.body.result.infeasibilityReason).toMatch(/São Paulo/);
  });

  it("passes p-median-brazil modelId, warehouseCapacity, singleSource, pValue to solver", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([brazilRow]));
    mockDb.update.mockReturnValue(makeChain([{ ...brazilRow, result: brazilInfeasibleResult }]));
    mockSolveFn.mockReturnValue(brazilInfeasibleResult);
    await request(app).post("/api/scenarios/10/solve").set("Cookie", cookie);
    const call = mockSolveFn.mock.calls[0][0] as { modelId: string; inputs: Record<string, unknown> };
    expect(call.modelId).toBe("p-median-brazil");
    expect(call.inputs.uniformCapacity).toBe(20000000);
    expect(call.inputs.singleSource).toBe(true);
    expect(call.inputs.p).toBe(5);
  });

  it("returns optimal when singleSource=false (relaxed — São Paulo demand splits)", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...brazilRow, inputs: { ...brazilInputs, singleSource: false } };
    mockDb.select.mockReturnValue(makeChain([row]));
    mockDb.update.mockReturnValue(makeChain([{ ...row, result: brazilFeasibleResult }]));
    mockSolveFn.mockReturnValue(brazilFeasibleResult);
    const res = await request(app).post("/api/scenarios/10/solve").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("optimal");
    expect(res.body.result.weightedAvgDistanceMi).toBe(287.3);
    expect(res.body.result.openWarehouseIds).toHaveLength(5);
  });

  it("returns flow assignments with flowFraction for Brazil optimal result", async () => {
    const cookie = await loginAs(OWNER);
    const row = { ...brazilRow, inputs: { ...brazilInputs, singleSource: false } };
    mockDb.select.mockReturnValue(makeChain([row]));
    mockDb.update.mockReturnValue(makeChain([{ ...row, result: brazilFeasibleResult }]));
    mockSolveFn.mockReturnValue(brazilFeasibleResult);
    const res = await request(app).post("/api/scenarios/10/solve").set("Cookie", cookie);
    expect(res.body.result.assignments).toHaveLength(2);
    expect(res.body.result.assignments[0].flowFraction).toBeCloseTo(0.69, 2);
  });

  it("returns 404 when Brazil scenario not found", async () => {
    const cookie = await loginAs(OWNER);
    // Default: select returns [] → 404
    const res = await request(app).post("/api/scenarios/99/solve").set("Cookie", cookie);
    expect(res.status).toBe(404);
  });
});
