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
  pmedianScenariosTable:   { id: "id", name: "name", createdAt: "created_at", updatedAt: "updated_at" },
  transportScenariosTable: { id: "id", name: "name", createdAt: "created_at", updatedAt: "updated_at" },
  brazilScenariosTable:    { id: "id", name: "name", createdAt: "created_at", updatedAt: "updated_at" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ col: _col, val })),
}));

vi.mock("../solver/pmedian.js", () => ({
  solve: mockSolveFn,
}));

import app from "../app.js";
import { WAREHOUSES, CUSTOMERS } from "../data/dataset.js";

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
// Base row shapes
// ---------------------------------------------------------------------------
const pmedianRow = {
  id: 1,
  name: "Base",
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

const transportRow = {
  id: 8,
  name: "Coal Base Case",
  distanceBands: [500, 1000, 1500, 2000],
  solver: "cbc",
  gap: 0,
  timeLimitSec: 120,
  capacityFactor: 1.0,
  singleSource: false,
  capacityInactive: false,
  result: null,
  createdAt: new Date("2026-01-02T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every db.select() returns an empty array (not found).
  // Individual tests override as needed.
  mockDb.select.mockReturnValue(makeChain([]));
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
});

// ── List scenarios ─────────────────────────────────────────────────────────
// GET /api/scenarios queries all 3 tables via Promise.all (pmedian, transport, brazil)
describe("GET /api/scenarios", () => {
  it("returns 200 with array of scenarios from pmedian table", async () => {
    // Promise.all order: pmedian → transport → brazil
    mockDb.select
      .mockReturnValueOnce(makeChain([pmedianRow]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]));

    const res = await request(app).get("/api/scenarios");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe(1);
    expect(res.body[0].problemType).toBe("p_median");
  });

  it("maps dates to ISO strings", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([pmedianRow]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]));

    const res = await request(app).get("/api/scenarios");
    expect(res.body[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("merges rows from all three tables", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([pmedianRow]))
      .mockReturnValueOnce(makeChain([transportRow]))
      .mockReturnValueOnce(makeChain([]));

    const res = await request(app).get("/api/scenarios");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const types = res.body.map((s: { problemType: string }) => s.problemType);
    expect(types).toContain("p_median");
    expect(types).toContain("transport");
  });
});

// ── Create scenario ────────────────────────────────────────────────────────
describe("POST /api/scenarios", () => {
  it("returns 201 with created p_median scenario and defaults applied", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ ...pmedianRow, name: "New" }]));
    const res = await request(app).post("/api/scenarios").send({ name: "New" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("New");
    expect(res.body.problemType).toBe("p_median");
    expect(res.body.solver).toBe("cbc");
    expect(res.body.result).toBeNull();
  });

  it("returns 201 with transport scenario when problemType=transport", async () => {
    mockDb.insert.mockReturnValue(makeChain([{ ...transportRow, name: "New Transport" }]));
    const res = await request(app)
      .post("/api/scenarios")
      .send({ name: "New Transport", problemType: "transport" });
    expect(res.status).toBe(201);
    expect(res.body.problemType).toBe("transport");
  });
});

// ── Get scenario ───────────────────────────────────────────────────────────
// GET /scenarios/:id uses findById → tries pmedian, then transport, then brazil
describe("GET /api/scenarios/:id", () => {
  it("returns 200 with pmedian scenario when found in first table", async () => {
    // findById: first select (pmedian) returns row → done
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    const res = await request(app).get("/api/scenarios/1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.problemType).toBe("p_median");
  });

  it("returns 404 when not found in any table", async () => {
    // Default beforeEach: all selects return []
    const res = await request(app).get("/api/scenarios/999");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Not found" });
  });
});

// ── Update scenario ────────────────────────────────────────────────────────
describe("PATCH /api/scenarios/:id", () => {
  it("returns 200 with updated pmedian scenario", async () => {
    // findById: first select returns pmedian row
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    mockDb.update.mockReturnValue(makeChain([{ ...pmedianRow, pValue: 5 }]));
    const res = await request(app).patch("/api/scenarios/1").send({ pValue: 5 });
    expect(res.status).toBe(200);
    expect(res.body.pValue).toBe(5);
  });

  it("returns 404 when not found", async () => {
    // Default: all selects return [] → findById returns null → 404
    const res = await request(app).patch("/api/scenarios/999").send({ pValue: 5 });
    expect(res.status).toBe(404);
  });
});

// ── Delete scenario ────────────────────────────────────────────────────────
describe("DELETE /api/scenarios/:id", () => {
  it("returns 204 on successful delete", async () => {
    // findById returns pmedian row → delete is called
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    mockDb.delete.mockReturnValue(makeChain(undefined));
    const res = await request(app).delete("/api/scenarios/1");
    expect(res.status).toBe(204);
  });

  it("returns 204 even when not found (idempotent)", async () => {
    // Default: all selects return [] → findById null → 204 anyway
    const res = await request(app).delete("/api/scenarios/999");
    expect(res.status).toBe(204);
  });
});

// ── Clone scenario ─────────────────────────────────────────────────────────
describe("POST /api/scenarios/:id/clone", () => {
  it("returns 201 with name '<original> (copy)' and null result", async () => {
    mockDb.select.mockReturnValue(makeChain([{ ...pmedianRow, name: "My Scenario" }]));
    mockDb.insert.mockReturnValue(makeChain([{ ...pmedianRow, id: 2, name: "My Scenario (copy)" }]));
    const res = await request(app).post("/api/scenarios/1/clone");
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My Scenario (copy)");
    expect(res.body.result).toBeNull();
  });

  it("returns 404 when original not found", async () => {
    // Default: all selects return [] → findById null → 404
    const res = await request(app).post("/api/scenarios/999/clone");
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
    mockDb.select.mockReturnValue(makeChain([pmedianRow]));
    mockDb.update.mockReturnValue(makeChain([{ ...pmedianRow, result: solverResult }]));
    mockSolveFn.mockReturnValue(solverResult);

    const res = await request(app).post("/api/scenarios/1/solve");
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("optimal");
    expect(res.body.result.openWarehouseIds).toContain("CHI");
  });

  it("returns 404 when scenario not found", async () => {
    // Default: all selects return [] → findById null → 404
    const res = await request(app).post("/api/scenarios/999/solve");
    expect(res.status).toBe(404);
  });
});

// ── Compare scenarios ──────────────────────────────────────────────────────
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

    // compare calls Promise.all(ids.map(findById)):
    //   findById(1): select call #1 → [row1] (pmedian match)
    //   findById(2): select call #2 → [row2] (pmedian match)
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
    expect(res.body.scenarios[0].openSites).toContain("Los Angeles");
    expect(res.body.scenarios[0].avgUtilization).toBe(91);
    expect(res.body.scenarios[1].avgUtilization).toBe(74);
  });
});

// ── Transport LP field serialization ───────────────────────────────────────
describe("transport scenario — field serialization", () => {
  it("GET /api/scenarios returns transport fields when row is in transport table", async () => {
    // Promise.all order: pmedian (empty), transport (has row), brazil (empty)
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([transportRow]))
      .mockReturnValueOnce(makeChain([]));

    const res = await request(app).get("/api/scenarios");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const s = res.body[0];
    expect(s.problemType).toBe("transport");
    expect(s.capacityFactor).toBe(1.0);
    expect(s.singleSource).toBe(false);
    expect(s.capacityInactive).toBe(false);
  });

  it("GET /api/scenarios/:id returns transport fields for transport row", async () => {
    // findById: pmedian empty → transport returns row
    mockDb.select
      .mockReturnValueOnce(makeChain([]))          // pmedian: not found
      .mockReturnValueOnce(makeChain([transportRow])); // transport: found

    const res = await request(app).get("/api/scenarios/8");
    expect(res.status).toBe(200);
    expect(res.body.problemType).toBe("transport");
    expect(res.body.capacityFactor).toBe(1.0);
    expect(res.body.singleSource).toBe(false);
    expect(res.body.capacityInactive).toBe(false);
  });

  it("POST /api/scenarios stores transport fields from body", async () => {
    const created = { ...transportRow, id: 9, capacityFactor: 1.1, singleSource: true };
    mockDb.insert.mockReturnValue(makeChain([created]));
    const res = await request(app).post("/api/scenarios").send({
      name: "Coal +10%",
      problemType: "transport",
      capacityFactor: 1.1,
      singleSource: true,
      capacityInactive: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.problemType).toBe("transport");
    expect(res.body.capacityFactor).toBe(1.1);
    expect(res.body.singleSource).toBe(true);
  });

  it("PATCH /api/scenarios/:id updates transport capacityFactor and singleSource", async () => {
    const updated = { ...transportRow, capacityFactor: 1.1, singleSource: true };
    // findById: pmedian empty → transport returns row
    mockDb.select
      .mockReturnValueOnce(makeChain([]))           // pmedian: not found
      .mockReturnValueOnce(makeChain([transportRow])); // transport: found
    mockDb.update.mockReturnValue(makeChain([updated]));
    const res = await request(app).patch("/api/scenarios/8").send({
      capacityFactor: 1.1,
      singleSource: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.capacityFactor).toBe(1.1);
    expect(res.body.singleSource).toBe(true);
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
    const row = { ...transportRow, capacityFactor: 1.1, singleSource: true };
    // findById: pmedian empty → transport returns row
    mockDb.select
      .mockReturnValueOnce(makeChain([]))     // pmedian: not found
      .mockReturnValueOnce(makeChain([row])); // transport: found
    mockDb.update.mockReturnValue(makeChain([{ ...row, result: transportSolverResult }]));
    mockSolveFn.mockReturnValue(transportSolverResult);

    const res = await request(app).post("/api/scenarios/8/solve");
    expect(res.status).toBe(200);

    const solveCall = mockSolveFn.mock.calls[0][0] as Record<string, unknown>;
    expect(solveCall.modelType).toBe("transport");
    expect(solveCall.capacityFactor).toBe(1.1);
    expect(solveCall.singleSource).toBe(true);
    expect(solveCall.capacityInactive).toBe(false);
  });

  it("returns transport flow assignments in result", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([]))              // pmedian: not found
      .mockReturnValueOnce(makeChain([transportRow])); // transport: found
    mockDb.update.mockReturnValue(makeChain([{ ...transportRow, result: transportSolverResult }]));
    mockSolveFn.mockReturnValue(transportSolverResult);

    const res = await request(app).post("/api/scenarios/8/solve");
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("optimal");
    expect(res.body.result.objective).toBe(50840650000);
    expect(res.body.result.assignments).toHaveLength(1);
    expect(res.body.result.assignments[0].flowTons).toBe(7000000);
  });
});

// ── Brazil scenario row fixture ────────────────────────────────────────────
const brazilRow = {
  id: 10,
  name: "Brazil Base — 20M cap",
  pValue: 5,
  warehouseCapacity: 20000000,
  singleSource: true,
  distanceBands: [500, 1000, 2000, 4000],
  solver: "cbc",
  gap: 0,
  timeLimitSec: 120,
  result: null,
  createdAt: new Date("2026-01-03T00:00:00Z"),
  updatedAt: new Date("2026-01-03T00:00:00Z"),
};

// ── Brazil scenario serialization ──────────────────────────────────────────
describe("brazil scenario — field serialization", () => {
  it("GET /api/scenarios includes Brazil row with problemType 'capacitated_pmedian'", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([brazilRow]));
    const res = await request(app).get("/api/scenarios");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const s = res.body[0];
    expect(s.problemType).toBe("capacitated_pmedian");
    expect(s.pValue).toBe(5);
    expect(s.uniformCapacity).toBe(20000000);
    expect(s.singleSource).toBe(true);
  });

  it("GET /api/scenarios merges rows from all three tables (pmedian + transport + brazil)", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([pmedianRow]))
      .mockReturnValueOnce(makeChain([transportRow]))
      .mockReturnValueOnce(makeChain([brazilRow]));
    const res = await request(app).get("/api/scenarios");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    const types = res.body.map((s: { problemType: string }) => s.problemType);
    expect(types).toContain("p_median");
    expect(types).toContain("transport");
    expect(types).toContain("capacitated_pmedian");
  });

  it("GET /api/scenarios/:id returns Brazil fields when found in brazil table", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([brazilRow]));
    const res = await request(app).get("/api/scenarios/10");
    expect(res.status).toBe(200);
    expect(res.body.problemType).toBe("capacitated_pmedian");
    expect(res.body.pValue).toBe(5);
    expect(res.body.uniformCapacity).toBe(20000000);
    expect(res.body.singleSource).toBe(true);
  });

  it("returns 404 when id not found in any of the three tables", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]));
    const res = await request(app).get("/api/scenarios/99");
    expect(res.status).toBe(404);
  });

  it("POST /api/scenarios creates Brazil scenario with capacitated_pmedian fields", async () => {
    const created = { ...brazilRow, id: 11, name: "Brazil Relaxed", singleSource: false };
    mockDb.insert.mockReturnValue(makeChain([created]));
    const res = await request(app).post("/api/scenarios").send({
      name: "Brazil Relaxed",
      problemType: "capacitated_pmedian",
      pValue: 5,
      warehouseCapacity: 20000000,
      singleSource: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.problemType).toBe("capacitated_pmedian");
    expect(res.body.uniformCapacity).toBe(20000000);
    expect(res.body.singleSource).toBe(false);
  });

  it("PATCH /api/scenarios/:id updates Brazil warehouseCapacity and singleSource", async () => {
    const updated = { ...brazilRow, warehouseCapacity: 30000000, singleSource: false };
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([brazilRow]));
    mockDb.update.mockReturnValue(makeChain([updated]));
    const res = await request(app).patch("/api/scenarios/10").send({
      uniformCapacity: 30000000,
      singleSource: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.uniformCapacity).toBe(30000000);
    expect(res.body.singleSource).toBe(false);
  });

  it("DELETE /api/scenarios/:id deletes Brazil scenario and returns 204", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([brazilRow]));
    mockDb.delete.mockReturnValue(makeChain(undefined));
    const res = await request(app).delete("/api/scenarios/10");
    expect(res.status).toBe(204);
  });

  it("POST /api/scenarios/:id/clone clones Brazil scenario with null result", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([{ ...brazilRow, name: "Brazil Base" }]));
    mockDb.insert.mockReturnValue(makeChain([{ ...brazilRow, id: 11, name: "Brazil Base (copy)" }]));
    const res = await request(app).post("/api/scenarios/10/clone");
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Brazil Base (copy)");
    expect(res.body.problemType).toBe("capacitated_pmedian");
    expect(res.body.result).toBeNull();
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
    const row = { ...brazilRow, singleSource: true };
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([row]));
    mockDb.update.mockReturnValue(makeChain([{ ...row, result: brazilInfeasibleResult }]));
    mockSolveFn.mockReturnValue(brazilInfeasibleResult);
    const res = await request(app).post("/api/scenarios/10/solve");
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("infeasible");
    expect(res.body.result.infeasibilityReason).toMatch(/São Paulo/);
  });

  it("passes capacitated_pmedian modelType, warehouseCapacity, singleSource, numberOfWhs to solver", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([brazilRow]));
    mockDb.update.mockReturnValue(makeChain([{ ...brazilRow, result: brazilInfeasibleResult }]));
    mockSolveFn.mockReturnValue(brazilInfeasibleResult);
    await request(app).post("/api/scenarios/10/solve");
    const call = mockSolveFn.mock.calls[0][0] as Record<string, unknown>;
    expect(call.modelType).toBe("capacitated_pmedian");
    expect(call.warehouseCapacity).toBe(20000000);
    expect(call.singleSource).toBe(true);
    expect(call.pValue).toBe(5);
  });

  it("returns optimal when singleSource=false (relaxed — São Paulo demand splits)", async () => {
    const row = { ...brazilRow, singleSource: false };
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([row]));
    mockDb.update.mockReturnValue(makeChain([{ ...row, result: brazilFeasibleResult }]));
    mockSolveFn.mockReturnValue(brazilFeasibleResult);
    const res = await request(app).post("/api/scenarios/10/solve");
    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe("optimal");
    expect(res.body.result.weightedAvgDistanceMi).toBe(287.3);
    expect(res.body.result.openWarehouseIds).toHaveLength(5);
  });

  it("returns flow assignments with flowFraction for Brazil optimal result", async () => {
    const row = { ...brazilRow, singleSource: false };
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([row]));
    mockDb.update.mockReturnValue(makeChain([{ ...row, result: brazilFeasibleResult }]));
    mockSolveFn.mockReturnValue(brazilFeasibleResult);
    const res = await request(app).post("/api/scenarios/10/solve");
    expect(res.body.result.assignments).toHaveLength(2);
    expect(res.body.result.assignments[0].flowFraction).toBeCloseTo(0.69, 2);
  });

  it("returns 404 when Brazil scenario not found", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]));
    const res = await request(app).post("/api/scenarios/99/solve");
    expect(res.status).toBe(404);
  });
});
