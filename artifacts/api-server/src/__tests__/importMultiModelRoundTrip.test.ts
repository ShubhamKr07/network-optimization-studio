import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import argon2 from "argon2";

// T10 (Input Map v2 QA) — Part 3: the multi-model uid+displayCode CSV
// consistency T11 built (services/import.ts's parseAndValidateImport) is
// already exhaustively unit-tested in isolation
// (src/__tests__/import.test.ts). What's NOT covered anywhere yet is the
// real END-TO-END round trip through the actual HTTP routes for the two
// non-p-median models: GET export really emits a display_code column, a
// base-override CSV with NO display_code column at all still applies
// (backward compat, at the route/DB-persist layer — import.test.ts only
// proves this against the pure function), an add-mode row's minted uid+
// displayCode really lands in the DB `.set()` write for
// addedMines/addedStations/addedRefineries (not just in
// parseAndValidateImport's returned preview), and a displayCode collision
// really blocks the HTTP apply end-to-end. Mirrors routes.test.ts's own
// mocking convention exactly (chainable drizzle mock, real /auth/login for
// a genuinely signed session cookie) — kept as its own file rather than
// appended to that already-1500-line one.

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
import { resetLoginRateLimiterForTests } from "../routes/auth.js";

function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  ["select", "from", "where", "orderBy", "insert", "values",
    "returning", "update", "set", "delete", "innerJoin", "limit"].forEach(m => {
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

const OWNER = "seed-user-id";

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

// jade-T7 — two-echelon-jade-us (Chapter 9, JADE).
const jadeInputs = {
  p: 2,
  distanceBands: [200, 400, 800, 1600],
  gap: 0,
  timeLimitSec: 120,
  warehouseOverrides: [],
  customerOverrides: [],
  plantProductCapability: [],
  addedPlants: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

const jadeRow = {
  id: 14,
  name: "JADE Base Case",
  modelId: "two-echelon-jade-us",
  userId: OWNER,
  inputs: jadeInputs,
  result: null,
  solvedAt: null,
  createdAt: new Date("2026-01-05T00:00:00Z"),
  updatedAt: new Date("2026-01-05T00:00:00Z"),
};

// C4.4 — chens-cosmetics-cn (Chapter 4, China coverage/min-distance). Shares
// p-median-us's warehouses/customers/distances entity set but its OWN 25-WH/
// 197-customer dataset; export/import must resolve CHEN's rows, never a
// p-median sibling's.
const chensInputs = {
  objective: "coverage",
  p: 3,
  highServiceDistKm: 600,
  maxDistKm: 5000,
  avgServiceDistCapKm: 1000,
  gap: 0,
  timeLimitSec: 120,
  capacityMode: "none",
  distanceBands: [600, 5000],
  warehouseOverrides: [],
  customerOverrides: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

const chensRow = {
  id: 20,
  name: "Chen Base Case",
  modelId: "chens-cosmetics-cn",
  userId: OWNER,
  inputs: chensInputs,
  result: null,
  solvedAt: null,
  createdAt: new Date("2026-01-06T00:00:00Z"),
  updatedAt: new Date("2026-01-06T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  resetLoginRateLimiterForTests();
  mockDb.select.mockReturnValue(makeChain([]));
  mockDb.update.mockReturnValue(makeChain([]));
  mockDb.transaction.mockImplementation(async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb));
  mockGetQueueDepth.mockReturnValue(0);
});

describe("Multi-model CSV round trip — export carries display_code", () => {
  it("mines export CSV has a display_code column", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([transportRow]));
    const res = await request(app).get("/api/scenarios/8/export?entity=mines&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text.split("\n")[0].split(",")).toContain("display_code");
  });

  it("stations export CSV has a display_code column", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([transportRow]));
    const res = await request(app).get("/api/scenarios/8/export?entity=stations&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text.split("\n")[0].split(",")).toContain("display_code");
  });

  it("refineries export CSV has a display_code column", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([twoEchelonRow]));
    const res = await request(app).get("/api/scenarios/11/export?entity=refineries&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text.split("\n")[0].split(",")).toContain("display_code");
  });
});

describe("Multi-model CSV round trip — backward compat: display_code column present but its CELL blank (a base-row update, no add) still applies", () => {
  // The real backward-compat contract (confirmed against services/
  // import.ts's fixed COLUMNS/expectedColumns machinery — a row's column
  // COUNT must always match the entity's current template, there's no
  // legacy shorter-header tolerance) is: an update-only row leaves the
  // display_code CELL blank, exactly like every pre-T11 base-row update
  // already did. mines/refineries already have this proven at the route
  // level (routes.test.ts); stations does not — genuinely new coverage.
  it("stations: a clean update-only CSV (blank display_code cell) applies via the real route into stationDemands", async () => {
    const cookie = await loginAs(OWNER);
    const stationCsv = "template_version,id,display_code,city,state,lat,lng,demand\n1,NYC,,New York,NY,,,50000\n";
    mockDb.select.mockReturnValueOnce(makeChain([transportRow]));
    const updatedRow = { ...transportRow, inputs: { ...transportInputs, stationDemands: { NYC: 50000 } } };
    mockDb.update.mockReturnValue(makeChain([updatedRow]));
    const res = await request(app).post("/api/scenarios/8/import/apply").set("Cookie", cookie)
      .send({ entity: "stations", csvText: stationCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(res.body.errors).toEqual([]);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  // A genuinely PRE-T11 export (the display_code column entirely absent,
  // not just its cell blank) is safely rejected with a clear header/column-
  // count error instead of being silently misparsed (e.g. reading a
  // capacity value out of what's actually the city column) — this is the
  // real backward-compat risk worth proving false: an old file doesn't
  // silently corrupt data, it's cleanly rejected as a whole-file format
  // mismatch (the shared header-check machinery — see import.test.ts's own
  // "still enforces the shared header-check machinery" case for the same
  // errorClass on a wrong-column-count file).
  it("mines: a CSV missing the display_code column entirely is rejected (422, clear format error), not silently misparsed", async () => {
    const cookie = await loginAs(OWNER);
    const preT11Csv = "template_version,id,city,state,capacity\n1,KY,Pikeville,KY,1000000\n";
    mockDb.select.mockReturnValueOnce(makeChain([transportRow]));
    const res = await request(app).post("/api/scenarios/8/import/apply").set("Cookie", cookie)
      .send({ entity: "mines", csvText: preT11Csv, mode: "all_or_nothing" });
    expect(res.status).toBe(422);
    expect(res.body.preview.errors[0]).toMatchObject({ errorClass: "format" });
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe("Multi-model CSV round trip — add-mode mints a role-prefixed uid + displayCode all the way into the DB write", () => {
  it("mines: a blank-id add row's minted 'am-' uid + displayCode reach the real db.update().set() payload's addedMines", async () => {
    const cookie = await loginAs(OWNER);
    const addCsv = "template_version,id,display_code,city,state,lat,lng,capacity\n1,,MN-NEW,Bristol,VA,36.6,-82.19,5000000\n";
    mockDb.select.mockReturnValueOnce(makeChain([transportRow]));
    const chain = makeChain([{ ...transportRow, inputs: { ...transportInputs, addedMines: [{ id: "am-x" }] } }]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios/8/import/apply").set("Cookie", cookie)
      .send({ entity: "mines", csvText: addCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: Record<string, unknown> };
    const added = setArgs.inputs.addedMines as Array<{ id: string; displayCode: string; city: string; state: string }>;
    expect(added).toHaveLength(1);
    expect(added[0].id).toMatch(/^am-/);
    expect(added[0].displayCode).toBe("MN-NEW");
    expect(added[0].city).toBe("Bristol");
  });

  it("stations: a blank-id add row's minted 'as-' uid + displayCode reach the real db.update().set() payload's addedStations", async () => {
    const cookie = await loginAs(OWNER);
    const addCsv = "template_version,id,display_code,city,state,lat,lng,demand\n1,,ST-NEW,Bristol,VA,36.6,-82.19,50000\n";
    mockDb.select.mockReturnValueOnce(makeChain([transportRow]));
    const chain = makeChain([{ ...transportRow, inputs: { ...transportInputs, addedStations: [{ id: "as-x" }] } }]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios/8/import/apply").set("Cookie", cookie)
      .send({ entity: "stations", csvText: addCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: Record<string, unknown> };
    const added = setArgs.inputs.addedStations as Array<{ id: string; displayCode: string }>;
    expect(added).toHaveLength(1);
    expect(added[0].id).toMatch(/^as-/);
    expect(added[0].displayCode).toBe("ST-NEW");
  });

  it("refineries: a blank-id add row's minted 'aw-' uid + displayCode reach the real db.update().set() payload's addedRefineries", async () => {
    const cookie = await loginAs(OWNER);
    const addCsv = "template_version,id,display_code,city,state,lat,lng,status\n1,,REF-NEW,Newtown,WA,35.5,-80.2,active\n";
    mockDb.select.mockReturnValueOnce(makeChain([twoEchelonRow]));
    const chain = makeChain([{ ...twoEchelonRow, inputs: { ...twoEchelonInputs, addedRefineries: [{ id: "aw-x" }] } }]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios/11/import/apply").set("Cookie", cookie)
      .send({ entity: "refineries", csvText: addCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: Record<string, unknown> };
    const added = setArgs.inputs.addedRefineries as Array<{ id: string; displayCode: string }>;
    expect(added).toHaveLength(1);
    expect(added[0].id).toMatch(/^aw-/);
    expect(added[0].displayCode).toBe("REF-NEW");
  });
});

describe("Multi-model CSV round trip — displayCode collision blocks the real HTTP apply", () => {
  it("mines: an add row whose display_code already belongs to a previously-added mine is rejected end-to-end (422, no DB write)", async () => {
    const cookie = await loginAs(OWNER);
    const addCsv = "template_version,id,display_code,city,state,lat,lng,capacity\n1,,MN-DUP,Bristol,VA,36.6,-82.19,5000000\n";
    const rowWithExisting = { ...transportRow, inputs: { ...transportInputs, addedMines: [{ id: "am-existing", displayCode: "MN-DUP" }] } };
    mockDb.select.mockReturnValueOnce(makeChain([rowWithExisting]));
    const res = await request(app).post("/api/scenarios/8/import/apply").set("Cookie", cookie)
      .send({ entity: "mines", csvText: addCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(422);
    expect(res.body.preview.errors[0]).toMatchObject({ errorClass: "logic" });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("the same collision surfaces on the preview (POST /import) route too, before any apply is attempted", async () => {
    const cookie = await loginAs(OWNER);
    const addCsv = "template_version,id,display_code,city,state,lat,lng,status\n1,,REF-DUP,Newtown,WA,35.5,-80.2,active\n";
    const rowWithExisting = { ...twoEchelonRow, inputs: { ...twoEchelonInputs, addedRefineries: [{ id: "aw-existing", displayCode: "REF-DUP" }] } };
    mockDb.select.mockReturnValueOnce(makeChain([rowWithExisting]));
    const res = await request(app).post("/api/scenarios/11/import").set("Cookie", cookie)
      .send({ entity: "refineries", csvText: addCsv });
    expect(res.status).toBe(200); // preview always 200s — errors surface inside the body
    expect(res.body.errors[0]).toMatchObject({ errorClass: "logic" });
    expect(res.body.changes).toEqual([]);
  });
});

// jade-T7 — two-echelon-jade-us (Chapter 9, JADE) real HTTP round trip:
// export every JADE entity (warehouses/customers/plants/plantCapabilities/
// legDistances) 200s, a sibling model's entity 422s, legDistances round-trips
// export->import for both legs, import-apply persists into the right
// `inputs` field. Note: no reset-to-baseline coverage here — that endpoint
// (`POST /scenarios/:id/reset-to-baseline`) was removed repo-wide in SCN
// v0.3 Phase 3.2 (see CLAUDE.md's Phase 3.2 Task 1 entry), before this JADE
// plan was written; there is nothing to register JADE into.
describe("Chen (chens-cosmetics-cn) — export resolves CHEN's dataset, not a p-median sibling's", () => {
  it("warehouses export returns Chen's own rows (wh-<n>, no capacity column), NOT p-median-us rows", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([chensRow]));
    const res = await request(app).get("/api/scenarios/20/export?entity=warehouses&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(25);
    const ids = res.body.rows.map((r: { id: string }) => r.id);
    expect(ids).toContain("wh-15");
    // A p-median-us warehouse id (ALN) must NOT appear — proves Chen's own
    // dataset was resolved, not the p-median fallback.
    expect(ids).not.toContain("ALN");
    // Chen warehouses have no capacity concept.
    expect(res.body.rows.every((r: { capacity: number | null }) => r.capacity === null)).toBe(true);
  });

  it("customers export returns Chen's own 197 rows (cs-<n>), NOT p-median-us's 200", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([chensRow]));
    const res = await request(app).get("/api/scenarios/20/export?entity=customers&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(197);
    const ids = res.body.rows.map((r: { id: string }) => r.id);
    expect(ids).toContain("cs-1");
    expect(ids).not.toContain("C1");
  });

  it("a sibling model's entity (mines) is rejected (422) for a Chen scenario", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([chensRow]));
    const res = await request(app).get("/api/scenarios/20/export?entity=mines&format=json").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });
});

describe("Chen (chens-cosmetics-cn) — customers import preview resolves Chen's dataset", () => {
  it("a base Chen customer (cs-1) status change previews exactly one change", async () => {
    const cookie = await loginAs(OWNER);
    // COLUMNS.customers: template_version,id,display_code,city,state,lat,lng,demand,status
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,cs-1,,,,,,458287,excluded\n";
    mockDb.select.mockReturnValueOnce(makeChain([chensRow]));
    const res = await request(app).post("/api/scenarios/20/import").set("Cookie", cookie)
      .send({ entity: "customers", csvText: csv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0]).toMatchObject({ id: "cs-1", after: { status: "excluded" } });
  });

  it("a p-median-us customer id (C1) is rejected as unknown against Chen's dataset (proves it is NOT the p-median baseline)", async () => {
    const cookie = await loginAs(OWNER);
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,C1,,,,,,100,excluded\n";
    mockDb.select.mockReturnValueOnce(makeChain([chensRow]));
    const res = await request(app).post("/api/scenarios/20/import").set("Cookie", cookie)
      .send({ entity: "customers", csvText: csv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatchObject({ errorClass: "logic" });
    expect(res.body.errors[0].message).toMatch(/Unknown id "C1"/);
  });
});

// T3 (spec Part A, supersedes D19): the STORED Chen inputs.distanceBands is
// preserved VERBATIM on every write path (POST/PATCH/import-apply) — the
// [high,max] overwrite is gone. `[high,max]` is derived only as a back-compat
// default when a payload omits the field entirely. The customers import/apply
// path re-validates the merged inputs through validateInputsForModel before
// storage, so it exercises this WITHOUT depending on C4.7's estimator/normalizer.
describe("Chen (chens-cosmetics-cn) — distanceBands preserved verbatim on every write path (T3)", () => {
  it("POST /api/scenarios: a supplied 3-boundary distanceBands array is preserved verbatim on store (never 422)", async () => {
    const cookie = await loginAs(OWNER);
    const chain = makeChain([chensRow]);
    mockDb.insert.mockReturnValue(chain);
    const supplied = { ...chensInputs, distanceBands: [600, 5000, 99999] };
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "Chen New", modelId: "chens-cosmetics-cn", inputs: supplied });
    expect(res.status).toBe(201);
    const insertArgs = (chain.values as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      inputs: { distanceBands: number[] };
    };
    expect(insertArgs.inputs.distanceBands).toEqual([600, 5000, 99999]);
  });

  it("POST /api/scenarios: omitting the five sparse arrays persists them as []", async () => {
    const cookie = await loginAs(OWNER);
    const chain = makeChain([chensRow]);
    mockDb.insert.mockReturnValue(chain);
    // A minimal-but-valid Chen coverage input with no override/added/distance arrays.
    const minimalInputs = {
      objective: "coverage", p: 3, highServiceDistKm: 600, maxDistKm: 5000,
      avgServiceDistCapKm: 1000, gap: 0, timeLimitSec: 120,
    };
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "Chen Minimal", modelId: "chens-cosmetics-cn", inputs: minimalInputs });
    expect(res.status).toBe(201);
    const insertArgs = (chain.values as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      inputs: {
        warehouseOverrides: unknown[]; customerOverrides: unknown[];
        addedWarehouses: unknown[]; addedCustomers: unknown[]; distanceOverrides: unknown[];
      };
    };
    expect(insertArgs.inputs.warehouseOverrides).toEqual([]);
    expect(insertArgs.inputs.customerOverrides).toEqual([]);
    expect(insertArgs.inputs.addedWarehouses).toEqual([]);
    expect(insertArgs.inputs.addedCustomers).toEqual([]);
    expect(insertArgs.inputs.distanceOverrides).toEqual([]);
  });

  it("POST /api/scenarios: two distanceOverrides rows for the same (fromId,toId) pair are rejected (422)", async () => {
    const cookie = await loginAs(OWNER);
    const dupInputs = {
      ...chensInputs,
      distanceOverrides: [
        { fromId: "wh-15", toId: "cs-1", distance: 3660 },
        { fromId: "wh-15", toId: "cs-1", distance: 4000 },
      ],
    };
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "Chen Dup", modelId: "chens-cosmetics-cn", inputs: dupInputs });
    expect(res.status).toBe(422);
  });

  it("PATCH /api/scenarios/:id: a supplied 3-boundary distanceBands array is preserved verbatim on store", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([chensRow]));
    const chain = makeChain([chensRow]);
    mockDb.update.mockReturnValue(chain);
    const supplied = { ...chensInputs, distanceBands: [600, 5000, 99999] };
    const res = await request(app).patch("/api/scenarios/20").set("Cookie", cookie)
      .send({ inputs: supplied });
    expect(res.status).toBe(200);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      inputs: { distanceBands: number[] };
    };
    expect(setArgs.inputs.distanceBands).toEqual([600, 5000, 99999]);
  });

  // The mandatory route-level proof (plan Step 5b): a `distances`
  // import/apply's merged-inputs reparse must NOT overwrite a
  // previously-supplied band array — a ROUTE-level assertion the applied
  // bands actually land in scenario storage, not just that they parse
  // cleanly in isolation (import.test.ts only exercises the parser).
  it("POST /api/scenarios/:id/import/apply (distances): a previously-supplied 3-boundary distanceBands array is preserved verbatim in stored scenario state", async () => {
    const cookie = await loginAs(OWNER);
    const suppliedRow = { ...chensRow, inputs: { ...chensInputs, distanceBands: [600, 5000, 99999] } };
    mockDb.select.mockReturnValueOnce(makeChain([suppliedRow]));
    const chain = makeChain([suppliedRow]);
    mockDb.update.mockReturnValue(chain);
    const distancesCsv = "template_version,from_id,to_id,distance\n1,wh-15,cs-1,123.4\n";
    const res = await request(app).post("/api/scenarios/20/import/apply").set("Cookie", cookie)
      .send({ entity: "distances", csvText: distancesCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      inputs: { distanceBands: number[]; distanceOverrides: Array<{ fromId: string; toId: string; distance: number }> };
    };
    expect(setArgs.inputs.distanceBands).toEqual([600, 5000, 99999]);
    const staged = setArgs.inputs.distanceOverrides.find((o) => o.fromId === "wh-15" && o.toId === "cs-1");
    expect(staged?.distance).toBe(123.4);
  });

  it("POST /api/scenarios/:id/import/apply (customers): re-validation preserves a previously-supplied 3-boundary distanceBands array verbatim", async () => {
    const cookie = await loginAs(OWNER);
    // The persisted scenario carries a valid 3-boundary distanceBands array;
    // the customers apply re-validates the merged inputs
    // (validateInputsForModel), and the reparse must not overwrite it.
    const suppliedRow = { ...chensRow, inputs: { ...chensInputs, distanceBands: [600, 5000, 99999] } };
    mockDb.select.mockReturnValueOnce(makeChain([suppliedRow]));
    const chain = makeChain([suppliedRow]);
    mockDb.update.mockReturnValue(chain);
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,cs-1,,,,,,458287,excluded\n";
    const res = await request(app).post("/api/scenarios/20/import/apply").set("Cookie", cookie)
      .send({ entity: "customers", csvText: csv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      inputs: { distanceBands: number[]; customerOverrides: Array<{ id: string; status: string }> };
    };
    expect(setArgs.inputs.distanceBands).toEqual([600, 5000, 99999]);
    // Sanity: the apply actually merged the customer change it was given.
    expect(setArgs.inputs.customerOverrides).toContainEqual(
      expect.objectContaining({ id: "cs-1", status: "excluded" }),
    );
  });
});

describe("Chen (chens-cosmetics-cn) — v1 distances export -> re-import round-trips unchanged", () => {
  // Chen-bands-units bundle, T8 — import.ts (this task) now parses the v2
  // header (DISTANCE_TEMPLATE_VERSION=2, `template_version,unit,from_id,
  // to_id,distance`) and converts a file's declared unit to the model's
  // real canonical unit via `fromDisplay`. That is NOT enough to make this
  // specific round trip pass, though: `routes/scenarios.ts`'s export
  // handler still calls `applyDistanceOverrides(inputs.distanceOverrides ??
  // [])` with NO unit argument for every caller, including Chen's own
  // export branch (`scenarios.ts` ~line 985) — it defaults to "mi", so
  // Chen's exported CSV is mislabeled `unit=mi` even though the stored
  // value is already canonical km. Importing that mislabeled file back
  // would (correctly, given what the file SAYS) convert a real km value as
  // if it were miles — producing a wrong, non-zero change, not the "zero
  // changes" this test asserts. Threading each model's real canonical unit
  // into `applyDistanceOverrides`'s call sites is `routes/scenarios.ts`
  // work (T9's Wave, per this file's own earlier note and the task
  // brief's explicit instruction not to half-implement T9 from within T8)
  // — re-enable once T9 lands.
  it.skip("exporting a distanceOverride then re-importing it produces zero changes (Chen id space resolves both roles)", async () => {
    const cookie = await loginAs(OWNER);
    const rowWithOverride = { ...chensRow, inputs: { ...chensInputs, distanceOverrides: [{ fromId: "wh-15", toId: "cs-1", distance: 100 }] } };
    mockDb.select.mockReturnValueOnce(makeChain([rowWithOverride]));
    const exportRes = await request(app).get("/api/scenarios/20/export?entity=distances&format=csv").set("Cookie", cookie);
    expect(exportRes.status).toBe(200);
    expect(exportRes.text).toContain("wh-15,cs-1,100");

    // Re-import the exact exported CSV against the same override — no change.
    mockDb.select.mockReturnValueOnce(makeChain([rowWithOverride]));
    const importRes = await request(app).post("/api/scenarios/20/import").set("Cookie", cookie)
      .send({ entity: "distances", csvText: exportRes.text });
    expect(importRes.status).toBe(200);
    expect(importRes.body.errors).toEqual([]);
    expect(importRes.body.changes).toEqual([]);
  });
});

describe("JADE (two-echelon-jade-us) — export every entity 200s", () => {
  it.each(["warehouses", "customers", "plants", "plantCapabilities", "legDistances"])("entity=%s -> 200", async (entity) => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([jadeRow]));
    const res = await request(app).get(`/api/scenarios/14/export?entity=${entity}&format=json`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.entity).toBe(entity);
  });

  it("plants export CSV has no capacity/status column", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([jadeRow]));
    const res = await request(app).get("/api/scenarios/14/export?entity=plants&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text.split("\n")[0]).toBe("template_version,id,display_code,city,state,lat,lng");
  });

  it("plantCapabilities export CSV emits the real 16-cell matrix", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([jadeRow]));
    const res = await request(app).get("/api/scenarios/14/export?entity=plantCapabilities&format=csv").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const lines = res.text.trim().split("\n");
    expect(lines).toHaveLength(1 + 16); // header + 16 (plant x product) cells
  });
});

describe("JADE (two-echelon-jade-us) — a sibling model's entity is rejected (422)", () => {
  it("refineries (two-echelon-gold-au's entity) is rejected for a JADE scenario", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([jadeRow]));
    const res = await request(app).get("/api/scenarios/14/export?entity=refineries&format=json").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  it("laneCosts (transport-coal's entity) is rejected for a JADE scenario", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([jadeRow]));
    const res = await request(app).get("/api/scenarios/14/export?entity=laneCosts&format=json").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  it("plants (JADE's own entity) is rejected for a two-echelon-gold-au scenario", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([twoEchelonRow]));
    const res = await request(app).get("/api/scenarios/11/export?entity=plants&format=json").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  it("plantCapabilities (JADE's own entity) is rejected for a p-median-us scenario", async () => {
    const cookie = await loginAs(OWNER);
    const pMedianRow = { id: 1, name: "US Base Case", modelId: "p-median-us", userId: OWNER, inputs: {}, result: null, solvedAt: null, createdAt: new Date(), updatedAt: new Date() };
    mockDb.select.mockReturnValueOnce(makeChain([pMedianRow]));
    const res = await request(app).get("/api/scenarios/1/export?entity=plantCapabilities&format=json").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });
});

describe("JADE (two-echelon-jade-us) — legDistances export/import round-trips both legs", () => {
  // Chen-bands-units bundle, T8 — unlike Chen's own distances round trip
  // (see that describe block's header comment above), JADE's canonical
  // distanceUnit IS "mi" (its manifest), matching applyDistanceOverrides'
  // unwired default of "mi" exactly — so this model's export label is
  // already correct today, with no T9 dependency, and this test can be
  // re-enabled by T8 alone.
  it("a plant->warehouse override round-trips through export then import (preview, no DB write)", async () => {
    const cookie = await loginAs(OWNER);
    const rowWithOverride = { ...jadeRow, inputs: { ...jadeInputs, distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 123.4 }] } };
    mockDb.select.mockReturnValueOnce(makeChain([rowWithOverride]));
    const exportRes = await request(app).get("/api/scenarios/14/export?entity=legDistances&format=csv").set("Cookie", cookie);
    expect(exportRes.status).toBe(200);
    expect(exportRes.text).toContain("plant-1,wh-1,123.4");

    mockDb.select.mockReturnValueOnce(makeChain([jadeRow]));
    const importRes = await request(app).post("/api/scenarios/14/import").set("Cookie", cookie)
      .send({ entity: "legDistances", csvText: exportRes.text });
    expect(importRes.status).toBe(200);
    expect(importRes.body.errors).toEqual([]);
    expect(importRes.body.changes).toEqual([{
      id: "plant-1|wh-1", line: 2,
      before: { status: "active", value: null }, after: { status: "active", value: 123.4 },
      fromId: "plant-1", toId: "wh-1",
    }]);
  });

  // Chen-bands-units bundle, T8 — same reasoning as above (JADE's canonical
  // unit already matches applyDistanceOverrides' default).
  it("a warehouse->customer override round-trips through export then import", async () => {
    const cookie = await loginAs(OWNER);
    const rowWithOverride = { ...jadeRow, inputs: { ...jadeInputs, distanceOverrides: [{ leg: "warehouse_to_customer", fromId: "wh-1", toId: "customer-1", distance: 42.1 }] } };
    mockDb.select.mockReturnValueOnce(makeChain([rowWithOverride]));
    const exportRes = await request(app).get("/api/scenarios/14/export?entity=legDistances&format=csv").set("Cookie", cookie);
    expect(exportRes.status).toBe(200);
    expect(exportRes.text).toContain("wh-1,customer-1,42.1");

    mockDb.select.mockReturnValueOnce(makeChain([jadeRow]));
    const importRes = await request(app).post("/api/scenarios/14/import").set("Cookie", cookie)
      .send({ entity: "legDistances", csvText: exportRes.text });
    expect(importRes.status).toBe(200);
    expect(importRes.body.errors).toEqual([]);
    expect(importRes.body.changes).toHaveLength(1);
    expect(importRes.body.changes[0]).toMatchObject({ fromId: "wh-1", toId: "customer-1", after: { value: 42.1 } });
  });

  it("import/apply persists a plant->warehouse legDistances change with the `leg` field attached (never trusted from the client, resolved from id spaces)", async () => {
    const cookie = await loginAs(OWNER);
    const csv = "template_version,from_id,to_id,distance\n1,plant-1,wh-1,123.4\n";
    mockDb.select.mockReturnValueOnce(makeChain([jadeRow]));
    const chain = makeChain([{ ...jadeRow, inputs: { ...jadeInputs, distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 123.4 }] } }]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios/14/import/apply").set("Cookie", cookie)
      .send({ entity: "legDistances", csvText: csv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: Record<string, unknown> };
    const distanceOverrides = setArgs.inputs.distanceOverrides as Array<{ leg: string; fromId: string; toId: string; distance: number }>;
    expect(distanceOverrides).toHaveLength(1);
    expect(distanceOverrides[0]).toEqual({ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 123.4 });
  });

  it("import/apply persists a warehouse->customer legDistances change with the `leg` field attached", async () => {
    const cookie = await loginAs(OWNER);
    const csv = "template_version,from_id,to_id,distance\n1,wh-1,customer-1,42.1\n";
    mockDb.select.mockReturnValueOnce(makeChain([jadeRow]));
    const chain = makeChain([{ ...jadeRow, inputs: { ...jadeInputs, distanceOverrides: [{ leg: "warehouse_to_customer", fromId: "wh-1", toId: "customer-1", distance: 42.1 }] } }]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios/14/import/apply").set("Cookie", cookie)
      .send({ entity: "legDistances", csvText: csv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: Record<string, unknown> };
    const distanceOverrides = setArgs.inputs.distanceOverrides as Array<{ leg: string; fromId: string; toId: string; distance: number }>;
    expect(distanceOverrides).toEqual([{ leg: "warehouse_to_customer", fromId: "wh-1", toId: "customer-1", distance: 42.1 }]);
  });
});

describe("JADE (two-echelon-jade-us) — plants import/apply persists into addedPlants", () => {
  it("a blank-id add row's minted 'ap-' uid + displayCode reach the real db.update().set() payload's addedPlants", async () => {
    const cookie = await loginAs(OWNER);
    const addCsv = "template_version,id,display_code,city,state,lat,lng\n1,,PL-NEW,Reno,NV,39.5,-119.8\n";
    mockDb.select.mockReturnValueOnce(makeChain([jadeRow]));
    const chain = makeChain([{ ...jadeRow, inputs: { ...jadeInputs, addedPlants: [{ id: "ap-x", displayCode: "PL-NEW", city: "Reno", state: "NV", lat: 39.5, lng: -119.8 }] } }]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios/14/import/apply").set("Cookie", cookie)
      .send({ entity: "plants", csvText: addCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: Record<string, unknown> };
    const added = setArgs.inputs.addedPlants as Array<{ id: string; displayCode: string; city: string }>;
    expect(added).toHaveLength(1);
    expect(added[0].id).toMatch(/^ap-/);
    expect(added[0].displayCode).toBe("PL-NEW");
    expect(added[0].city).toBe("Reno");
  });
});

describe("JADE (two-echelon-jade-us) — plantCapabilities import/apply persists into plantProductCapability", () => {
  it("a flipped cell reaches the real db.update().set() payload's plantProductCapability array", async () => {
    const cookie = await loginAs(OWNER);
    const csv = "template_version,plant_id,product_id,enabled\n1,plant-1,product-1,false\n";
    mockDb.select.mockReturnValueOnce(makeChain([jadeRow]));
    const chain = makeChain([{ ...jadeRow, inputs: { ...jadeInputs, plantProductCapability: [{ plantId: "plant-1", productId: "product-1", enabled: false }] } }]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios/14/import/apply").set("Cookie", cookie)
      .send({ entity: "plantCapabilities", csvText: csv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: Record<string, unknown> };
    const capability = setArgs.inputs.plantProductCapability as Array<{ plantId: string; productId: string; enabled: boolean }>;
    expect(capability).toEqual([{ plantId: "plant-1", productId: "product-1", enabled: false }]);
  });
});
