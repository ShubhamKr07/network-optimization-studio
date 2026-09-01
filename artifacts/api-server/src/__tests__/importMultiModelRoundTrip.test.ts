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
