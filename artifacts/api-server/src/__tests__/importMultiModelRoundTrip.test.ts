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
  // routes/auth.ts matches users with `lower(email) = <normalized>`; without
  // this stand-in the real login these suites perform would call undefined.
  // A1 (SCND Correctness) — routes/scenarios.ts's PATCH and import/apply
  // handlers now do a DB-side `solve_input_revision = solve_input_revision
  // + 1` increment via `sql\`...\`` at module load time; without this export
  // present, the real `sql` tagged-template import resolves to `undefined`
  // against this narrow mock and every write in this file 500s.
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock("../solver/jobRunner.js", () => ({
  enqueueSolveJob: mockEnqueueSolveJob,
  enqueueScenarioSolve: vi.fn(),
  getQueueDepth: mockGetQueueDepth,
  QUEUE_DEPTH_LIMIT: 30,
}));

import app from "../app.js";
import { resetLoginRateLimiterForTests } from "../routes/auth.js";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";

// ch4-lock — this suite round-trips real Chen/JADE imports. Unlock for its
// duration so production locking those chapters does not delete the coverage.
beforeEach(() => { setLockedModelsForTests([]); });

function makeChain(returnValue: unknown) {
  const chain: Record<string, unknown> = {};
  // CH4-2s-2 — "for" (drizzle's `.for("update")` row lock) added: the PATCH
  // and import/apply routes now call services/scenarioInputWrite.ts's
  // applyScenarioInputWrite directly (real, unmocked code), which issues a
  // locked SELECT through this same mocked chain.
  ["select", "from", "where", "orderBy", "insert", "values",
    "returning", "update", "set", "delete", "innerJoin", "limit", "for"].forEach(m => {
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

// C4.4 — max-coverage-us (Chapter 4, US coverage/min-distance). Shares
// p-median-us's warehouses/customers/distances entity set AND (MIG-4: this
// model reuses Chapter 3's own 26-warehouse/200-customer facility list) its
// exact base ids — export/import must resolve max-coverage-us's OWN dataset
// package via its own manifest-scoped code path, never accidentally the
// p-median-us fallback (even though the two now happen to share content,
// the route must still dispatch on modelId, not fall through).
//
// review-4.4a: because the two models' facility lists are now byte-for-byte
// identical (same 26 warehouse ids/cities, same 200 customer ids), row
// count/id-membership/capacity-null assertions below are equally true of the
// p-median-us code path — they do NOT discriminate which dataset actually
// resolved. The real discriminator that survives the shared facility list is
// each model's own manifest-declared canonical distance unit (max-coverage-us
// is "km", p-median-us is "mi" — solvers/*/manifest.json); see the
// reference-distances test at the end of this describe block and the unit
// assertions in the "v1 distances export -> re-import round-trips unchanged"
// describe block below for the assertions that actually pin dataset
// identity.
const maxCoverageInputs = {
  p: 3,
  highServiceDistKm: 600,
  maxDistKm: 5000,
  avgServiceDistCapKm: 1000,
  coverageFloorDemand: 0,
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

const maxCoverageRow = {
  id: 20,
  name: "Max Coverage Base Case",
  modelId: "max-coverage-us",
  userId: OWNER,
  inputs: maxCoverageInputs,
  result: null,
  solvedAt: null,
  createdAt: new Date("2026-01-06T00:00:00Z"),
  updatedAt: new Date("2026-01-06T00:00:00Z"),
};

// ch5-edit-11 — delivery-teaching-us (Chapter 5, modified). §14's Warehouses/
// Customers tabs reuse WarehousesTab/CustomersTab and always render CSV
// Download/Upload buttons when passed a scenarioId — this model was never
// added to the export/import allow-lists, so every button 422'd. Its own
// 33-warehouse/313-customer dataset (W8/C269 are real ids there); no
// addedWarehouses/addedCustomers concept at all (unlike every model above).
const deliveryInputs = {
  p: 3,
  distanceBands: [400, 800, 1200, 1600],
  gap: 0,
  timeLimitSec: 120,
  costAdjustEnabled: false,
  distanceThreshold: 800,
  costPerMile: 1,
  costPerMileOver: 10,
  laneCostOverrides: [],
  warehouseOverrides: [],
  customerOverrides: [],
};

const deliveryRow = {
  id: 21,
  name: "Delivery Base Case",
  modelId: "delivery-teaching-us",
  userId: OWNER,
  inputs: deliveryInputs,
  result: null,
  solvedAt: null,
  createdAt: new Date("2026-01-07T00:00:00Z"),
  updatedAt: new Date("2026-01-07T00:00:00Z"),
};

// The "target" scenario a round trip re-imports INTO — genuinely empty
// overrides, a DIFFERENT scenario id from deliveryRow above. Using a second
// scenario (rather than re-importing into the same one) is deliberate: it
// means the assertion can't trivially pass by comparing a scenario's export
// against its own unchanged state (see the round-trip describe block's own
// header comment for why that would be a weak test).
const deliveryTargetRow = { ...deliveryRow, id: 22, name: "Delivery Target" };

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
    mockDb.select.mockReturnValue(makeChain([transportRow]));
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
    mockDb.select.mockReturnValue(makeChain([transportRow]));
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
    mockDb.select.mockReturnValue(makeChain([transportRow]));
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
    mockDb.select.mockReturnValue(makeChain([twoEchelonRow]));
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
describe("max-coverage-us — export resolves its own dataset via its own code path", () => {
  it("warehouses export returns all 26 rows with no capacity column", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([maxCoverageRow]));
    const res = await request(app).get("/api/scenarios/20/export?entity=warehouses&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(26);
    const ids = res.body.rows.map((r: { id: string }) => r.id);
    // MIG-4: max-coverage-us reuses Chapter 3's exact facility list, so ALN
    // is a genuine max-coverage-us id too (not proof of cross-contamination
    // by itself). Neither the row count (p-median-us's own warehouse count
    // is ALSO 26 — same facility list) nor the capacity===null assertion
    // below (p-median-us's own export emits capacity:null for every row too,
    // given empty warehouseOverrides — templates.ts's `o?.capacity ?? null`)
    // discriminates which model's code path actually resolved. This test
    // exists to prove the response SHAPE (200, 26 rows, no capacity concept);
    // the "reference-distances proves..." test below is what actually pins
    // dataset identity.
    expect(ids).toContain("ALN");
    // max-coverage-us warehouses have no capacity concept.
    expect(res.body.rows.every((r: { capacity: number | null }) => r.capacity === null)).toBe(true);
  });

  it("customers export returns all 200 rows", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([maxCoverageRow]));
    const res = await request(app).get("/api/scenarios/20/export?entity=customers&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(200);
    const ids = res.body.rows.map((r: { id: string }) => r.id);
    expect(ids).toContain("C1");
  });

  it("a sibling model's entity (mines) is rejected (422) for a max-coverage-us scenario", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([maxCoverageRow]));
    const res = await request(app).get("/api/scenarios/20/export?entity=mines&format=json").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  // review-4.4a — the assertions above (row count, id membership, capacity
  // null) are all equally true of the p-median-us dataset now that the two
  // models share an identical 26-warehouse/200-customer facility list, so
  // none of them alone proves max-coverage-us's OWN dataset package
  // resolved rather than p-median-us's. This test uses the one thing that
  // does NOT survive the shared facility list: each model's own
  // manifest-declared canonical distance unit and its real base-matrix
  // value for the SAME (ALN, C1) pair (solvers/max-coverage-us/manifest.json
  // declares "km", solvers/p-median-us/manifest.json declares "mi" — the
  // two datasets are copies of the same facility list but NOT the same
  // distance matrix). GET /models/:id/reference-distances is unauthenticated
  // and model-scoped (routes/referenceDistances.ts), so no scenario mocking
  // is needed here.
  it("reference-distances proves ALN->C1 is a genuinely different matrix from p-median-us despite the shared id", async () => {
    const mc = await request(app).get("/api/models/max-coverage-us/reference-distances");
    expect(mc.status).toBe(200);
    expect(mc.body.distanceUnit).toBe("km");
    const mcPair = (mc.body.pairs as Array<{ fromId: string; toId: string; distance: number }>)
      .find((p) => p.fromId === "ALN" && p.toId === "C1");
    expect(mcPair?.distance).toBe(601.894656);

    const pm = await request(app).get("/api/models/p-median-us/reference-distances");
    expect(pm.status).toBe(200);
    expect(pm.body.distanceUnit).toBe("mi");
    const pmPair = (pm.body.pairs as Array<{ fromId: string; toId: string; distance: number }>)
      .find((p) => p.fromId === "ALN" && p.toId === "C1");
    expect(pmPair?.distance).toBe(374);

    // Same shared id pair, genuinely different underlying matrices.
    expect(mcPair?.distance).not.toBe(pmPair?.distance);
  });
});

describe("max-coverage-us — customers import preview resolves its own dataset", () => {
  it("a base customer (C1) status change previews exactly one change", async () => {
    const cookie = await loginAs(OWNER);
    // COLUMNS.customers: template_version,id,display_code,city,state,lat,lng,demand,status
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,C1,,,,,,458287,excluded\n";
    mockDb.select.mockReturnValueOnce(makeChain([maxCoverageRow]));
    const res = await request(app).post("/api/scenarios/20/import").set("Cookie", cookie)
      .send({ entity: "customers", csvText: csv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0]).toMatchObject({ id: "C1", after: { status: "excluded" } });
  });

  it("an id absent from both models' datasets is rejected as unknown", async () => {
    const cookie = await loginAs(OWNER);
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,C9999,,,,,,100,excluded\n";
    mockDb.select.mockReturnValueOnce(makeChain([maxCoverageRow]));
    const res = await request(app).post("/api/scenarios/20/import").set("Cookie", cookie)
      .send({ entity: "customers", csvText: csv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatchObject({ errorClass: "logic" });
    expect(res.body.errors[0].message).toMatch(/Unknown id "C9999"/);
  });
});

// T3 (spec Part A, supersedes D19): the STORED max-coverage-us
// inputs.distanceBands is preserved VERBATIM on every write path (POST/PATCH/
// import-apply) — the [high,max] overwrite is gone. `[high,max]` is derived
// only as a back-compat default when a payload omits the field entirely. The
// customers import/apply path re-validates the merged inputs through
// validateInputsForModel before storage, so it exercises this WITHOUT
// depending on C4.7's estimator/normalizer.
describe("max-coverage-us — distanceBands preserved verbatim on every write path (T3)", () => {
  it("POST /api/scenarios: a supplied 3-boundary distanceBands array is preserved verbatim on store (never 422)", async () => {
    const cookie = await loginAs(OWNER);
    const chain = makeChain([maxCoverageRow]);
    mockDb.insert.mockReturnValue(chain);
    const supplied = { ...maxCoverageInputs, distanceBands: [600, 5000, 99999] };
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "Max Coverage New", modelId: "max-coverage-us", inputs: supplied });
    expect(res.status).toBe(201);
    const insertArgs = (chain.values as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      inputs: { distanceBands: number[] };
    };
    expect(insertArgs.inputs.distanceBands).toEqual([600, 5000, 99999]);
  });

  it("POST /api/scenarios: omitting the five sparse arrays persists them as []", async () => {
    const cookie = await loginAs(OWNER);
    const chain = makeChain([maxCoverageRow]);
    mockDb.insert.mockReturnValue(chain);
    // A minimal-but-valid coverage input with no override/added/distance arrays.
    const minimalInputs = {
      p: 3, highServiceDistKm: 600, maxDistKm: 5000,
      avgServiceDistCapKm: 1000, coverageFloorDemand: 0, gap: 0, timeLimitSec: 120,
    };
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "Max Coverage Minimal", modelId: "max-coverage-us", inputs: minimalInputs });
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
      ...maxCoverageInputs,
      distanceOverrides: [
        { fromId: "ALN", toId: "C1", distance: 3660 },
        { fromId: "ALN", toId: "C1", distance: 4000 },
      ],
    };
    const res = await request(app).post("/api/scenarios").set("Cookie", cookie)
      .send({ name: "Max Coverage Dup", modelId: "max-coverage-us", inputs: dupInputs });
    expect(res.status).toBe(422);
  });

  it("PATCH /api/scenarios/:id: a supplied 3-boundary distanceBands array is preserved verbatim on store", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValue(makeChain([maxCoverageRow]));
    const chain = makeChain([maxCoverageRow]);
    mockDb.update.mockReturnValue(chain);
    const supplied = { ...maxCoverageInputs, distanceBands: [600, 5000, 99999] };
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
    const suppliedRow = { ...maxCoverageRow, inputs: { ...maxCoverageInputs, distanceBands: [600, 5000, 99999] } };
    mockDb.select.mockReturnValue(makeChain([suppliedRow]));
    const chain = makeChain([suppliedRow]);
    mockDb.update.mockReturnValue(chain);
    const distancesCsv = "template_version,from_id,to_id,distance\n1,ALN,C1,123.4\n";
    const res = await request(app).post("/api/scenarios/20/import/apply").set("Cookie", cookie)
      .send({ entity: "distances", csvText: distancesCsv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      inputs: { distanceBands: number[]; distanceOverrides: Array<{ fromId: string; toId: string; distance: number }> };
    };
    expect(setArgs.inputs.distanceBands).toEqual([600, 5000, 99999]);
    const staged = setArgs.inputs.distanceOverrides.find((o) => o.fromId === "ALN" && o.toId === "C1");
    expect(staged?.distance).toBe(123.4);
  });

  it("POST /api/scenarios/:id/import/apply (customers): re-validation preserves a previously-supplied 3-boundary distanceBands array verbatim", async () => {
    const cookie = await loginAs(OWNER);
    // The persisted scenario carries a valid 3-boundary distanceBands array;
    // the customers apply re-validates the merged inputs
    // (validateInputsForModel), and the reparse must not overwrite it.
    const suppliedRow = { ...maxCoverageRow, inputs: { ...maxCoverageInputs, distanceBands: [600, 5000, 99999] } };
    mockDb.select.mockReturnValue(makeChain([suppliedRow]));
    const chain = makeChain([suppliedRow]);
    mockDb.update.mockReturnValue(chain);
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,C1,,,,,,458287,excluded\n";
    const res = await request(app).post("/api/scenarios/20/import/apply").set("Cookie", cookie)
      .send({ entity: "customers", csvText: csv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      inputs: { distanceBands: number[]; customerOverrides: Array<{ id: string; status: string }> };
    };
    expect(setArgs.inputs.distanceBands).toEqual([600, 5000, 99999]);
    // Sanity: the apply actually merged the customer change it was given.
    expect(setArgs.inputs.customerOverrides).toContainEqual(
      expect.objectContaining({ id: "C1", status: "excluded" }),
    );
  });
});

describe("max-coverage-us — v1 distances export -> re-import round-trips unchanged", () => {
  // Chen-bands-units bundle, T8 — import.ts (this task) now parses the v2
  // header (DISTANCE_TEMPLATE_VERSION=2, `template_version,unit,from_id,
  // to_id,distance`) and converts a file's declared unit to the model's
  // real canonical unit via `fromDisplay`. T9 threaded each model's real
  // manifest-declared canonical unit into `applyDistanceOverrides`'s call
  // sites in `routes/scenarios.ts` (was defaulting to "mi" for every
  // caller, silently mislabeling this model's "km" export as "mi") — its
  // exported CSV now correctly says `unit=km`, so re-importing it converts
  // nothing (km -> km is an identity conversion) and this round trip is
  // genuinely zero-change.
  it("exporting a distanceOverride then re-importing it produces zero changes", async () => {
    const cookie = await loginAs(OWNER);
    const rowWithOverride = { ...maxCoverageRow, inputs: { ...maxCoverageInputs, distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 100 }] } };
    mockDb.select.mockReturnValueOnce(makeChain([rowWithOverride]));
    const exportRes = await request(app).get("/api/scenarios/20/export?entity=distances&format=csv").set("Cookie", cookie);
    expect(exportRes.status).toBe(200);
    // review-4.4a — the header + row-level unit column is the actual proof
    // this export dispatched on max-coverage-us's own "km" manifest, not a
    // p-median-us ("mi") fallback: a route falling through to the
    // p-median-us code path would still emit "ALN,C1,100" (the override
    // value round-trips identically regardless of unit label, since
    // requestedUnit defaults to whichever canonicalUnit gets resolved), but
    // the `unit` column would read "mi", not "km".
    expect(exportRes.text.split("\n")[0]).toBe("template_version,unit,from_id,to_id,distance");
    expect(exportRes.text).toContain("km,ALN,C1,100");
    expect(exportRes.text).not.toContain("mi,ALN,C1,100");

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
    mockDb.select.mockReturnValue(makeChain([jadeRow]));
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
    mockDb.select.mockReturnValue(makeChain([jadeRow]));
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
    mockDb.select.mockReturnValue(makeChain([jadeRow]));
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
    mockDb.select.mockReturnValue(makeChain([jadeRow]));
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

// ch5-edit-11 — delivery-teaching-us (Chapter 5, modified): warehouses/
// customers export resolves its OWN 33-warehouse/313-customer dataset
// (W8/C269 are real ids there, distinct from p-median-us's ALN/C1/26/200
// facility list — no shared-id-space ambiguity to disambiguate here, unlike
// max-coverage-us's review-4.4a situation).
describe("delivery-teaching-us — export resolves its own dataset via its own code path", () => {
  it("warehouses export returns all 33 rows with no capacity column (this model has no capacity concept)", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([deliveryRow]));
    const res = await request(app).get("/api/scenarios/21/export?entity=warehouses&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(33);
    const ids = res.body.rows.map((r: { id: string }) => r.id);
    expect(ids).toContain("W8");
    expect(res.body.rows.every((r: { capacity: number | null }) => r.capacity === null)).toBe(true);
  });

  it("customers export returns all 313 rows", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([deliveryRow]));
    const res = await request(app).get("/api/scenarios/21/export?entity=customers&format=json").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(313);
    const ids = res.body.rows.map((r: { id: string }) => r.id);
    expect(ids).toContain("C269");
  });

  it("a sibling model's entity (mines) is rejected (422) for a delivery-teaching-us scenario", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([deliveryRow]));
    const res = await request(app).get("/api/scenarios/21/export?entity=mines&format=json").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });

  // Scope guard (task requirement): this pass is warehouses/customers only —
  // laneCostOverrides (this model's distance-bearing entity) is deliberately
  // out of scope, unlike p-median-us/max-coverage-us's "distances".
  it("'distances' (out of scope for this model) is rejected (422), not silently resolved via the p-median fallback", async () => {
    const cookie = await loginAs(OWNER);
    mockDb.select.mockReturnValueOnce(makeChain([deliveryRow]));
    const res = await request(app).get("/api/scenarios/21/export?entity=distances&format=json").set("Cookie", cookie);
    expect(res.status).toBe(422);
  });
});

describe("delivery-teaching-us — import preview resolves its own dataset, no add-mode", () => {
  it("a base customer (C269) demand-0 override previews exactly one real change", async () => {
    const cookie = await loginAs(OWNER);
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,C269,,,,,,0,active\n";
    mockDb.select.mockReturnValueOnce(makeChain([deliveryRow]));
    const res = await request(app).post("/api/scenarios/21/import").set("Cookie", cookie)
      .send({ entity: "customers", csvText: csv });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0]).toMatchObject({ id: "C269", after: { status: "active", value: 0 } });
  });

  it("an id absent from this model's own dataset is rejected as unknown, naming the id — no DB write", async () => {
    const cookie = await loginAs(OWNER);
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,C99999,,,,,,100,excluded\n";
    mockDb.select.mockReturnValueOnce(makeChain([deliveryRow]));
    const res = await request(app).post("/api/scenarios/21/import/apply").set("Cookie", cookie)
      .send({ entity: "customers", csvText: csv, mode: "all_or_nothing" });
    expect(res.status).toBe(422);
    expect(res.body.preview.errors[0]).toMatchObject({ errorClass: "logic" });
    expect(res.body.preview.errors[0].message).toMatch(/Unknown id "C99999"/);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  // This model has NO addedWarehouses/addedCustomers concept at all
  // (deliveryInputsSchema has neither field) — a blank id must fall through
  // to "Unknown id", never mint an add, all the way through the real HTTP
  // apply route (not just parseAndValidateImport in isolation — see
  // import.test.ts's own unit-level coverage of the same rule).
  it("a blank-id row (the add-mode trigger for every other warehouses/customers model) is rejected end-to-end via HTTP, not silently added", async () => {
    const cookie = await loginAs(OWNER);
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,,WH-NEW,Reno,NV,39.5,-119.8,,active\n";
    mockDb.select.mockReturnValueOnce(makeChain([deliveryRow]));
    const res = await request(app).post("/api/scenarios/21/import/apply").set("Cookie", cookie)
      .send({ entity: "warehouses", csvText: csv, mode: "all_or_nothing" });
    expect(res.status).toBe(422);
    expect(res.body.preview.errors[0]).toMatchObject({ errorClass: "logic" });
    expect(res.body.preview.errors[0].message).toMatch(/Unknown id/);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

// The mutation-resistant round trip: export a SOURCE scenario's overrides,
// then apply the exported CSV into a DIFFERENT, INITIALLY-EMPTY target
// scenario (deliveryTargetRow, id 22 vs deliveryRow's id 21) and inspect the
// REAL (unmocked) db.update().set() payload — only the DB persistence layer
// is mocked; parseAndValidateImport, the merge functions, and
// applyScenarioInputWrite's Zod validation all run for real. Comparing a
// scenario's export against ITS OWN unchanged state (re-importing into the
// same scenario) would pass even if status/demand were silently dropped
// somewhere in the pipeline, because "no change" is indistinguishable from
// "change dropped" when the source and target start identical — using two
// scenarios and asserting on the actual merged override arrays closes that
// gap.
describe("delivery-teaching-us — export -> import/apply round trip is lossless for status AND demand (zero demand distinct from exclusion)", () => {
  it("warehouse status overrides (inactive, forced_open) round-trip byte-identically into a fresh target scenario", async () => {
    const cookie = await loginAs(OWNER);
    const sourceOverrides = [
      { id: "W8", status: "inactive" },
      { id: "W15", status: "forced_open" },
    ];
    const sourceRow = { ...deliveryRow, inputs: { ...deliveryInputs, warehouseOverrides: sourceOverrides } };

    mockDb.select.mockReturnValueOnce(makeChain([sourceRow]));
    const exportRes = await request(app).get("/api/scenarios/21/export?entity=warehouses&format=csv").set("Cookie", cookie);
    expect(exportRes.status).toBe(200);

    mockDb.select.mockReturnValue(makeChain([deliveryTargetRow]));
    const chain = makeChain([{ ...deliveryTargetRow, inputs: { ...deliveryInputs, warehouseOverrides: sourceOverrides } }]);
    mockDb.update.mockReturnValue(chain);
    const applyRes = await request(app).post("/api/scenarios/22/import/apply").set("Cookie", cookie)
      .send({ entity: "warehouses", csvText: exportRes.text, mode: "all_or_nothing" });
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.errors).toEqual([]);
    expect(applyRes.body.applied).toBe(2);

    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: Record<string, unknown> };
    const persisted = setArgs.inputs.warehouseOverrides as Array<{ id: string; status: string }>;
    // Sort by id — merge order (existing-minus-changed then applied) isn't a
    // contract, only membership/content is.
    expect([...persisted].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "W15", status: "forced_open" },
      { id: "W8", status: "inactive" },
    ]);
  });

  it("customer demand-0 (still in model) and a demand+exclusion override round-trip byte-identically, and remain distinguishable from each other", async () => {
    const cookie = await loginAs(OWNER);
    const sourceOverrides = [
      // Zero demand — customer stays in the model (active), still a real
      // change from any positive base demand.
      { id: "C269", demand: 0, status: "active" },
      // Excluded WITH an explicit demand override present — proves status
      // and demand persist as independent fields, not collapsed into one.
      { id: "C50", demand: 12345, status: "excluded" },
    ];
    const sourceRow = { ...deliveryRow, inputs: { ...deliveryInputs, customerOverrides: sourceOverrides } };

    mockDb.select.mockReturnValueOnce(makeChain([sourceRow]));
    const exportRes = await request(app).get("/api/scenarios/21/export?entity=customers&format=csv").set("Cookie", cookie);
    expect(exportRes.status).toBe(200);
    expect(exportRes.text).toContain("C269");
    // The exported row shows demand 0, not blank and not the base demand —
    // proving zero demand round-trips as a real value, not a "no override"
    // sentinel.
    expect(exportRes.text).toMatch(/^1,C269,,[^,]+,[^,]+,[-\d.]+,[-\d.]+,0,active$/m);

    mockDb.select.mockReturnValue(makeChain([deliveryTargetRow]));
    const chain = makeChain([{ ...deliveryTargetRow, inputs: { ...deliveryInputs, customerOverrides: sourceOverrides } }]);
    mockDb.update.mockReturnValue(chain);
    const applyRes = await request(app).post("/api/scenarios/22/import/apply").set("Cookie", cookie)
      .send({ entity: "customers", csvText: exportRes.text, mode: "all_or_nothing" });
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.errors).toEqual([]);
    expect(applyRes.body.applied).toBe(2);

    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: Record<string, unknown> };
    const persisted = setArgs.inputs.customerOverrides as Array<{ id: string; demand: number; status: string }>;
    const byId = new Map(persisted.map(o => [o.id, o]));
    // Both present, both demand AND status intact, and — the specific
    // property this describe block exists to prove — genuinely
    // distinguishable from each other: demand=0/active is NOT the same
    // stored state as demand=12345/excluded.
    expect(byId.get("C269")).toEqual({ id: "C269", demand: 0, status: "active" });
    expect(byId.get("C50")).toEqual({ id: "C50", demand: 12345, status: "excluded" });
    expect(byId.get("C269")).not.toEqual(byId.get("C50"));
  });
});

// M6's duplicate-id guard (deliveryInputsSchema's own `.refine()`, a
// concurrent fix on this same branch) is a SCHEMA-level rule and out of
// scope for this task, but the import PARSE layer already rejects an
// in-file duplicate id before it ever reaches that schema — proven at the
// unit level in import.test.ts. Nothing to duplicate here.

describe("delivery-teaching-us — a stray capacity column value is dropped before persistence (deliberate 'ignore', not 'reject')", () => {
  // validation/inputs/delivery.ts's warehouseOverrideSchema is {id, status}
  // ONLY — no `capacity` field (this model has no capacity concept,
  // capacityModes: []). The CSV's capacity column is still physically
  // present (ENTITY_HAS_VALUE is keyed by entity name only, not model — see
  // import.ts's own header comment), so a stray value there parses without
  // error but must never reach the persisted row: deliveryInputsSchema is
  // non-strict, so validateInputsForModel silently strips it during
  // applyScenarioInputWrite's revalidation, exactly like
  // max-coverage-us/two-echelon-jade-us's own capacity-less warehouses
  // already rely on.
  it("a warehouse row carrying a capacity value applies successfully with no error, and the persisted override has no capacity key", async () => {
    const cookie = await loginAs(OWNER);
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,W8,,,,,,250000,inactive\n";
    mockDb.select.mockReturnValue(makeChain([deliveryRow]));
    const chain = makeChain([{ ...deliveryRow, inputs: { ...deliveryInputs, warehouseOverrides: [{ id: "W8", status: "inactive" }] } }]);
    mockDb.update.mockReturnValue(chain);
    const res = await request(app).post("/api/scenarios/21/import/apply").set("Cookie", cookie)
      .send({ entity: "warehouses", csvText: csv, mode: "all_or_nothing" });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.applied).toBe(1);

    const setArgs = (chain.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as { inputs: Record<string, unknown> };
    const persisted = setArgs.inputs.warehouseOverrides as Array<Record<string, unknown>>;
    expect(persisted).toEqual([{ id: "W8", status: "inactive" }]);
    expect(persisted[0]).not.toHaveProperty("capacity");
  });
});
