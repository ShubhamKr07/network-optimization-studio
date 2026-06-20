import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const mockSolveFn = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: mockDb,
  scenariosTable: {
    id: "id",
    name: "name",
    problemType: "problem_type",
    pValue: "p_value",
    distanceBands: "distance_bands",
    solver: "solver",
    gap: "gap",
    timeLimitSec: "time_limit_sec",
    capacityMode: "capacity_mode",
    uniformCapacity: "uniform_capacity",
    warehouseStatuses: "warehouse_statuses",
    result: "result",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ col: _col, val })),
}));

vi.mock("../solver/pmedian.js", () => ({
  solve: mockSolveFn,
}));

import app from "../app.js";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";

// Chainable drizzle mock: each method returns the same chain; await resolves to returnValue
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

const baseRow = {
  id: 1,
  name: "Base",
  problemType: "p_median",
  pValue: 3,
  distanceBands: [200, 400, 800, 1600],
  solver: "cbc",
  gap: 0,
  timeLimitSec: 120,
  capacityMode: "uniform",
  uniformCapacity: null,
  warehouseStatuses: [],
  result: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => vi.clearAllMocks());

// ── Health ────────────────────────────────────────────────────────────────────
describe("GET /api/healthz", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });
});

// ── Dataset ───────────────────────────────────────────────────────────────────
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
});

// ── List scenarios ────────────────────────────────────────────────────────────
describe("GET /api/scenarios", () => {
  it("returns 200 with array of scenarios", async () => {
    mockDb.select.mockReturnValue(makeChain([baseRow]));
    const res = await request(app).get("/api/scenarios");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe(1);
  });

  it("maps dates to ISO strings", async () => {
    mockDb.select.mockReturnValue(makeChain([baseRow]));
    const res = await request(app).get("/api/scenarios");
    expect(res.body[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── Create scenario ───────────────────────────────────────────────────────────
describe("POST /api/scenarios", () => {
  it("returns 201 with created scenario and defaults applied", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ ...baseRow, name: "New" }]));
    const res = await request(app).post("/api/scenarios").send({ name: "New" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("New");
    expect(res.body.problemType).toBe("p_median");
    expect(res.body.solver).toBe("cbc");
    expect(res.body.result).toBeNull();
  });
});

// ── Get scenario ──────────────────────────────────────────────────────────────
describe("GET /api/scenarios/:id", () => {
  it("returns 200 with scenario when found", async () => {
    mockDb.select.mockReturnValue(makeChain([baseRow]));
    const res = await request(app).get("/api/scenarios/1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it("returns 404 when not found", async () => {
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).get("/api/scenarios/999");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Not found" });
  });
});

// ── Update scenario ───────────────────────────────────────────────────────────
describe("PATCH /api/scenarios/:id", () => {
  it("returns 200 with updated scenario", async () => {
    mockDb.update.mockReturnValue(makeChain([{ ...baseRow, pValue: 5 }]));
    const res = await request(app).patch("/api/scenarios/1").send({ pValue: 5 });
    expect(res.status).toBe(200);
    expect(res.body.pValue).toBe(5);
  });

  it("returns 404 when not found", async () => {
    mockDb.update.mockReturnValue(makeChain([]));
    const res = await request(app).patch("/api/scenarios/999").send({ pValue: 5 });
    expect(res.status).toBe(404);
  });
});

// ── Delete scenario ───────────────────────────────────────────────────────────
describe("DELETE /api/scenarios/:id", () => {
  it("returns 204 on successful delete", async () => {
    mockDb.delete.mockReturnValue(makeChain(undefined));
    const res = await request(app).delete("/api/scenarios/1");
    expect(res.status).toBe(204);
  });
});

// ── Clone scenario ────────────────────────────────────────────────────────────
describe("POST /api/scenarios/:id/clone", () => {
  it("returns 201 with name '<original> (copy)' and null result", async () => {
    mockDb.select.mockReturnValue(makeChain([{ ...baseRow, name: "My Scenario" }]));
    mockDb.insert.mockReturnValue(makeChain([{ ...baseRow, id: 2, name: "My Scenario (copy)" }]));
    const res = await request(app).post("/api/scenarios/1/clone");
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My Scenario (copy)");
    expect(res.body.result).toBeNull();
  });

  it("returns 404 when original not found", async () => {
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/scenarios/999/clone");
    expect(res.status).toBe(404);
  });
});

// ── Solve scenario ────────────────────────────────────────────────────────────
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
    mockDb.select.mockReturnValue(makeChain([baseRow]));
    mockDb.update.mockReturnValue(makeChain([{ ...baseRow, result: solverResult }]));
    mockSolveFn.mockReturnValue(solverResult);

    const res = await request(app).post("/api/scenarios/1/solve");
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("optimal");
    expect(res.body.result.openWarehouseIds).toContain("CHI");
  });

  it("returns 404 when scenario not found", async () => {
    mockDb.select.mockReturnValue(makeChain([]));
    const res = await request(app).post("/api/scenarios/999/solve");
    expect(res.status).toBe(404);
  });
});

// ── Compare scenarios ─────────────────────────────────────────────────────────
describe("POST /api/scenarios/compare", () => {
  it("returns 400 when fewer than 2 IDs provided", async () => {
    const res = await request(app)
      .post("/api/scenarios/compare")
      .send({ scenarioIds: [1] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("2");
  });

  it("returns 400 when scenarioIds is empty", async () => {
    const res = await request(app)
      .post("/api/scenarios/compare")
      .send({ scenarioIds: [] });
    expect(res.status).toBe(400);
  });

  it("returns 200 with comparison metrics for 2 valid scenarios", async () => {
    const row1 = {
      ...baseRow, id: 1, name: "2 WH",
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
      ...baseRow, id: 2, name: "3 WH",
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

    mockDb.select
      .mockReturnValueOnce(makeChain([row1]))
      .mockReturnValueOnce(makeChain([row2]));

    const res = await request(app)
      .post("/api/scenarios/compare")
      .send({ scenarioIds: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body.scenarios).toHaveLength(2);
    expect(res.body.scenarios[0].name).toBe("2 WH");
    expect(res.body.scenarios[1].name).toBe("3 WH");
    // warehouse IDs get resolved to city names
    expect(res.body.scenarios[0].openSites).toContain("Los Angeles");
    expect(res.body.scenarios[0].avgUtilization).toBe(91);
    expect(res.body.scenarios[1].avgUtilization).toBe(74); // round((72+85+64)/3)
  });
});
