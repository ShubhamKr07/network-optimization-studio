// SCU-2.P2.2 (B2.6) — JSON import contract through the real routes and a real
// Postgres (no vi.mock). "Round trip" = the re-export is STRUCTURALLY EQUAL
// (toEqual) to the export that was imported. Base rows/overrides round-trip
// across scenarios; added (scenario-local, opaque-id) entities round-trip
// only into the SAME scenario — in another scenario their ids are unknown.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, scenariosTable } from "@workspace/db";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, TEMPLATE_VERSION, csvColumns } from "@workspace/import-schema";
import app from "../app.js";
import { setLockedModelsForTests } from "../middlewares/lockedModel.js";
import { MODEL_INPUTS } from "./fixtures/importFixtures.js";

beforeEach(() => { setLockedModelsForTests([]); });

const userIds: string[] = [];
const scenarioIds: number[] = [];
afterAll(async () => {
  for (const id of scenarioIds) await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
  for (const id of userIds) await db.delete(usersTable).where(eq(usersTable.id, id));
});

async function register(tag: string): Promise<string> {
  const email = `scu-p2-2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  userIds.push(res.body.user.id);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}

const BASE = MODEL_INPUTS as Record<string, Record<string, unknown>>;

// One populated override per entity (real dataset ids), imported into a FRESH
// scenario. `expectChanges: false` only for plants: base plants have no
// override concept (an added plant is covered by ADDED_CASES below).
const ROUND_TRIP_CASES: Array<{ name: string; modelId: string; entity: string; overrides: Record<string, unknown>; expectChanges: boolean }> = [
  { name: "p-median-us warehouses", modelId: "p-median-us", entity: "warehouses", overrides: { warehouseOverrides: [{ id: "ATL", status: "forced_open" }] }, expectChanges: true },
  { name: "p-median-us customers", modelId: "p-median-us", entity: "customers", overrides: { customerOverrides: [{ id: "C1", demand: 1000, status: "active" }] }, expectChanges: true },
  { name: "p-median-us distances", modelId: "p-median-us", entity: "distances", overrides: { distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 123.4 }] }, expectChanges: true },
  { name: "transport-coal mines", modelId: "transport-coal", entity: "mines", overrides: { mineCapacities: { KY: 1000 } }, expectChanges: true },
  { name: "transport-coal stations", modelId: "transport-coal", entity: "stations", overrides: { stationDemands: { LAX: 500 } }, expectChanges: true },
  { name: "transport-coal laneCosts", modelId: "transport-coal", entity: "laneCosts", overrides: { laneCostOverrides: [{ fromId: "KY", toId: "LAX", cost: 999 }] }, expectChanges: true },
  { name: "gold refineries", modelId: "two-echelon-gold-au", entity: "refineries", overrides: { refineryOverrides: [{ id: "cunnamulla", status: "forced_open" }] }, expectChanges: true },
  { name: "gold customers", modelId: "two-echelon-gold-au", entity: "customers", overrides: { customerOverrides: [{ id: "sydney", demand: 1, status: "active" }] }, expectChanges: true },
  { name: "gold legDistances", modelId: "two-echelon-gold-au", entity: "legDistances", overrides: { distanceOverrides: [{ fromId: "kalgoorlie", toId: "cunnamulla", distance: 1500 }] }, expectChanges: true },
  { name: "jade warehouses", modelId: "two-echelon-jade-us", entity: "warehouses", overrides: { warehouseOverrides: [{ id: "wh-1", status: "inactive" }] }, expectChanges: true },
  { name: "jade customers", modelId: "two-echelon-jade-us", entity: "customers", overrides: { customerOverrides: [{ id: "customer-1", status: "excluded" }] }, expectChanges: true },
  { name: "delivery deliveryCosts", modelId: "delivery-teaching-us", entity: "deliveryCosts", overrides: { laneCostOverrides: [{ fromId: "W8", toId: "C269", cost: 1 }] }, expectChanges: true },
  { name: "jade plants", modelId: "two-echelon-jade-us", entity: "plants", overrides: {}, expectChanges: false },
  { name: "jade plantCapabilities", modelId: "two-echelon-jade-us", entity: "plantCapabilities", overrides: { plantProductCapability: [{ plantId: "plant-1", productId: "product-2", enabled: true }] }, expectChanges: true },
  { name: "jade legDistances", modelId: "two-echelon-jade-us", entity: "legDistances", overrides: { distanceOverrides: [{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 321 }] }, expectChanges: true },
  { name: "delivery warehouses", modelId: "delivery-teaching-us", entity: "warehouses", overrides: { warehouseOverrides: [{ id: "W1", status: "inactive" }] }, expectChanges: true },
  { name: "delivery customers", modelId: "delivery-teaching-us", entity: "customers", overrides: { customerOverrides: [{ id: "C269", demand: 5, status: "active" }] }, expectChanges: true },
];

// One populated ADDED entity per addable entity, re-imported into the SAME
// scenario (review #5). The city carries a quote and a comma, so the CSV
// escaping on the JSON → CSV path is exercised through the real routes.
const ADDED_CASES: Array<{ name: string; modelId: string; entity: string; key: string; added: Record<string, unknown> }> = [
  { name: "p-median-us added warehouse", modelId: "p-median-us", entity: "warehouses", key: "addedWarehouses", added: { id: "aw-scu-p2-2", displayCode: "NEW-W", city: 'Fort "Big", Town', state: "TX", lat: 31.5, lng: -97.1, status: "forced_open" } },
  { name: "p-median-us added customer", modelId: "p-median-us", entity: "customers", key: "addedCustomers", added: { id: "ac-scu-p2-2", displayCode: "NEW-C", city: "Newtown", state: "TX", lat: 31.6, lng: -97.2, demand: 1234 } },
  { name: "transport added mine", modelId: "transport-coal", entity: "mines", key: "addedMines", added: { id: "am-scu-p2-2", displayCode: "NEW-M", city: "Minetown", state: "WV", lat: 38.1, lng: -81.6, capacity: 5000 } },
  { name: "transport added station", modelId: "transport-coal", entity: "stations", key: "addedStations", added: { id: "as-scu-p2-2", displayCode: "NEW-S", city: "Stationville", state: "OH", lat: 40.1, lng: -82.9, demand: 700 } },
  { name: "gold added refinery", modelId: "two-echelon-gold-au", entity: "refineries", key: "addedRefineries", added: { id: "aw-scu-p2-2r", displayCode: "NEW-R", city: "Refinerton", state: "NSW", lat: -32.1, lng: 147.2, status: "active" } },
  { name: "jade added plant", modelId: "two-echelon-jade-us", entity: "plants", key: "addedPlants", added: { id: "ap-scu-p2-2", displayCode: "NEW-P", city: "Plantville", state: "IN", lat: 39.8, lng: -86.2 } },
];

let owner = "";
let stranger = "";
beforeAll(async () => {
  owner = await register("owner");
  stranger = await register("stranger");
});

async function createScenario(cookie: string, modelId: string, inputs: Record<string, unknown>): Promise<number> {
  const res = await request(app).post("/api/scenarios").set("Cookie", cookie).send({ name: `scu-p2-2 ${modelId}`, modelId, inputs });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  scenarioIds.push(res.body.id);
  return res.body.id;
}

async function exportJson(cookie: string, id: number, entity: string) {
  const res = await request(app).get(`/api/scenarios/${id}/export`).query({ entity, format: "json" }).set("Cookie", cookie);
  expect(res.status).toBe(200);
  return res.body as { templateVersion: number; entity: string; unit?: string; rows: Record<string, unknown>[] };
}

const preview = (cookie: string, id: number, body: unknown) => request(app).post(`/api/scenarios/${id}/import`).set("Cookie", cookie).send(body as object);
const apply = (cookie: string, id: number, body: unknown) => request(app).post(`/api/scenarios/${id}/import/apply`).set("Cookie", cookie).send(body as object);
const rawPost = (cookie: string, path: string, raw: string) => request(app).post(path).set("Cookie", cookie).set("Content-Type", "application/json").send(raw);

describe("base rows round-trip across scenarios (structural JSON equality)", () => {
  for (const c of ROUND_TRIP_CASES) {
    it(`${c.name}: export JSON → import JSON into a fresh scenario → equal export`, async () => {
      const sourceId = await createScenario(owner, c.modelId, { ...BASE[c.modelId], ...c.overrides });
      const targetId = await createScenario(owner, c.modelId, BASE[c.modelId]!);
      const document = await exportJson(owner, sourceId, c.entity);
      expect(document.rows.length).toBeGreaterThan(0); // populated, never rows: []

      const p = await preview(owner, targetId, { entity: c.entity, format: "json", document });
      expect(p.status).toBe(200);
      expect(p.body.errors).toEqual([]);
      if (c.expectChanges) {
        expect(p.body.changes.length).toBeGreaterThan(0);
        for (const change of p.body.changes) expect(change.line).toBe(change.rowIndex + 2);
      } else {
        expect(p.body.changes).toEqual([]);
      }

      const a = await apply(owner, targetId, { entity: c.entity, format: "json", document, mode: "all_or_nothing" });
      expect(a.status).toBe(200);
      expect(a.body.errors).toEqual([]);
      expect(await exportJson(owner, targetId, c.entity)).toEqual(document);
    });
  }
});

describe("added entities round-trip into the SAME scenario only", () => {
  for (const c of ADDED_CASES) {
    it(`${c.name}: same-scenario re-import is a no-op; another scenario rejects the opaque id`, async () => {
      const id = await createScenario(owner, c.modelId, { ...BASE[c.modelId], [c.key]: [c.added] });
      const document = await exportJson(owner, id, c.entity);
      const addedIndex = document.rows.findIndex(r => r.id === c.added.id);
      expect(addedIndex).toBeGreaterThanOrEqual(0);
      expect(document.rows[addedIndex]).toMatchObject({ displayCode: c.added.displayCode, city: c.added.city });

      const same = await preview(owner, id, { entity: c.entity, format: "json", document });
      expect(same.body).toEqual({ errors: [], changes: [], warnings: same.body.warnings });
      expect((await apply(owner, id, { entity: c.entity, format: "json", document })).status).toBe(200);
      expect(await exportJson(owner, id, c.entity)).toEqual(document);

      const other = await createScenario(owner, c.modelId, BASE[c.modelId]!);
      const cross = await preview(owner, other, { entity: c.entity, format: "json", document });
      expect(cross.body.errors).toEqual([expect.objectContaining({ errorClass: "logic", rowIndex: addedIndex, message: expect.stringContaining("Unknown id") })]);
    });
  }
});

describe("body handling is scoped to the import routes and runs after ownership (review #1)", () => {
  it("owner: a body over the 2 MiB wire limit is 413 payload_too_large", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const res = await preview(owner, id, { entity: "warehouses", csvText: "x".repeat(MAX_IMPORT_BYTES) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "payload_too_large" });
  });

  it("owner: a 150 kB body is accepted (it was a 500 under the 100 kB default)", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const res = await preview(owner, id, { entity: "warehouses", csvText: "x".repeat(150 * 1024) });
    expect(res.status).toBe(200);
    expect(res.body.errors[0].errorClass).toBe("syntax"); // papaparse: undetectable delimiter on a headerless blob
  });

  it("owner: a body that is not JSON is 400 malformed (preview and apply)", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    for (const path of [`/api/scenarios/${id}/import`, `/api/scenarios/${id}/import/apply`]) {
      const res = await rawPost(owner, path, "{not json");
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Request body is not valid JSON.", errorClass: "malformed" });
    }
  });

  it("non-owner: 404 for a valid, a malformed and an oversized body — never 400/413 — and nothing changes", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const document = await exportJson(owner, id, "warehouses");
    document.rows[1] = { ...document.rows[1], status: "forced_open" };
    expect((await preview(stranger, id, { entity: "warehouses", format: "json", document })).status).toBe(404);
    expect((await apply(stranger, id, { entity: "warehouses", format: "json", document, mode: "partial" })).status).toBe(404);
    expect((await rawPost(stranger, `/api/scenarios/${id}/import`, "{not json")).status).toBe(404);
    expect((await exportJson(owner, id, "warehouses")).rows[1]!.status).toBe("active");
  });

  // The 404 is sent BEFORE the 2 MiB body is read (by design), so the client may
  // get EPIPE/ECONNRESET while still writing. Either is "rejected before body
  // handling"; 413 would mean the body limit ran ahead of ownership.
  it("non-owner: an oversized body gets 404 (or a client-side EPIPE/ECONNRESET), never 413, and nothing changes", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    let s: number | string | undefined;
    try {
      s = (await preview(stranger, id, { entity: "warehouses", csvText: "x".repeat(MAX_IMPORT_BYTES) })).status;
    } catch (e) {
      s = (e as { code?: string }).code;
    }
    expect([404, "EPIPE", "ECONNRESET"]).toContain(s);
    expect((await exportJson(owner, id, "warehouses")).rows[1]!.status).toBe("active");
  });

  it("unauthenticated: 401 before any body handling", async () => {
    expect((await request(app).post("/api/scenarios/1/import").set("Content-Type", "application/json").send("{not json")).status).toBe(401);
  });

  it("a NON-import route keeps malformed-JSON 500; oversize is 413 (SM-12)", async () => {
    const id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const malformed = await request(app).patch(`/api/scenarios/${id}`).set("Cookie", owner).set("Content-Type", "application/json").send("{not json");
    expect(malformed.status).toBe(500);
    const big = await request(app).post("/api/scenarios").set("Cookie", owner).send({ name: "x".repeat(2 * 1024 * 1024 + 10), modelId: "p-median-us", inputs: BASE["p-median-us"] });
    expect(big.status).toBe(413);
  });
});

describe("strict request contract (review #2, #4)", () => {
  let id = 0;
  let document: Awaited<ReturnType<typeof exportJson>>;
  beforeAll(async () => {
    id = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    document = await exportJson(owner, id, "warehouses");
  });

  it("format omitted is CSV (backward compatible) and CSV keeps line, not rowIndex", async () => {
    const csvText = `${csvColumns("warehouses", TEMPLATE_VERSION).join(",")}\n${TEMPLATE_VERSION},ATL,,Atlanta,GA,33.753693,-84.389544,,forced_open\n`;
    const res = await preview(owner, id, { entity: "warehouses", csvText });
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.changes).toEqual([expect.objectContaining({ id: "ATL", line: 2, after: { status: "forced_open", value: null } })]);
    expect(res.body.changes[0].rowIndex).toBeUndefined();
  });

  it.each([
    ["format null", () => ({ entity: "warehouses", format: null, csvText: "x" })],
    ["unknown format", () => ({ entity: "warehouses", format: "xml", csvText: "x" })],
    ["csv + document mixed", () => ({ entity: "warehouses", format: "csv", csvText: "x", document })],
    ["unknown request key", () => ({ entity: "warehouses", csvText: "x", extra: 1 })],
    ["mode on preview", () => ({ entity: "warehouses", csvText: "x", mode: "partial" })],
  ])("request-envelope violation (%s) is 422", async (_name, body) => {
    expect((await preview(owner, id, body())).status).toBe(422);
  });

  it("apply rejects an invalid mode with 422", async () => {
    expect((await apply(owner, id, { entity: "warehouses", csvText: "x", mode: "bogus" })).status).toBe(422);
  });

  it.each([
    ["no rows array", () => ({ templateVersion: TEMPLATE_VERSION, entity: "warehouses" }), "rows"],
    ["unknown top-level document key", () => ({ ...document, exportedAt: "2026-10-17" }), "exportedAt"],
    ["document.entity not an import entity", () => ({ ...document, entity: "assignments" }), "entity"],
    ["a row that is not an object", () => ({ ...document, rows: [1] }), "rows"],
  ])("document schema violation (%s) is 400 malformed on preview and apply", async (_name, doc, field) => {
    for (const res of [await preview(owner, id, { entity: "warehouses", format: "json", document: doc() }), await apply(owner, id, { entity: "warehouses", format: "json", document: doc() })]) {
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ errorClass: "malformed", field });
    }
  });

  it("document.entity must equal entity (a valid but different entity is a preview format error)", async () => {
    const res = await preview(owner, id, { entity: "customers", format: "json", document });
    expect(res.status).toBe(200);
    expect(res.body.changes).toEqual([]);
    expect(res.body.errors).toEqual([expect.objectContaining({ errorClass: "format", line: null, field: "entity" })]);
  });

  it("an unsupported templateVersion is a preview format error on templateVersion", async () => {
    const res = await preview(owner, id, { entity: "warehouses", format: "json", document: { ...document, templateVersion: TEMPLATE_VERSION + 98 } });
    expect(res.body.errors).toEqual([expect.objectContaining({ errorClass: "format", field: "templateVersion" })]);
  });

  it("unknown row keys, wrong types and duplicate ids are per-row errors with rowIndex; partial apply keeps only the good row; all-or-nothing 422 carries the preview", async () => {
    const own = await createScenario(owner, "p-median-us", BASE["p-median-us"]!);
    const doc = await exportJson(owner, own, "warehouses");
    const at = (rowId: string) => doc.rows.findIndex(r => r.id === rowId);
    const aln = at("ALN"), atl = at("ATL"), bal = at("BAL");
    doc.rows[aln] = { ...doc.rows[aln], bogus: 1 };
    doc.rows[atl] = { ...doc.rows[atl], status: "forced_open" };
    doc.rows[bal] = { ...doc.rows[bal], lat: "40" };
    doc.rows.push({ ...doc.rows[atl] });
    const dupIndex = doc.rows.length - 1;
    const body = { entity: "warehouses", format: "json", document: doc };

    const p = await preview(owner, own, body);
    expect(p.status).toBe(200);
    expect(p.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ errorClass: "syntax", line: null, rowIndex: aln, field: "bogus" }),
      expect.objectContaining({ errorClass: "syntax", line: null, rowIndex: bal, field: "lat" }),
      expect.objectContaining({ errorClass: "logic", line: null, rowIndex: dupIndex, message: expect.stringContaining("Duplicate id") }),
    ]));
    expect(p.body.changes).toEqual([expect.objectContaining({ id: "ATL", rowIndex: atl, line: atl + 2 })]);

    const strict = await apply(owner, own, { ...body, mode: "all_or_nothing" });
    expect(strict.status).toBe(422);
    expect(strict.body.preview.errors.length).toBe(p.body.errors.length);

    const partial = await apply(owner, own, { ...body, mode: "partial" });
    expect(partial.status).toBe(200);
    expect(partial.body.applied).toBe(1);
    expect((await exportJson(owner, own, "warehouses")).rows[atl]!.status).toBe("forced_open");
  });

  it("MAX_IMPORT_ROWS + 1 rows is a format error through the route (CSV and JSON)", async () => {
    const line = `${TEMPLATE_VERSION},ATL,,Atlanta,GA,33.75,-84.39,,active`;
    const csvText = `${csvColumns("warehouses", TEMPLATE_VERSION).join(",")}\n${Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => line).join("\n")}\n`;
    const jsonDoc = { templateVersion: TEMPLATE_VERSION, entity: "warehouses", rows: Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({})) };
    for (const body of [{ entity: "warehouses", csvText }, { entity: "warehouses", format: "json", document: jsonDoc }]) {
      const res = await preview(owner, id, body);
      expect(res.status).toBe(200);
      expect(res.body.errors).toEqual([expect.objectContaining({ errorClass: "format", line: null, message: expect.stringContaining(String(MAX_IMPORT_ROWS)) })]);
    }
  });
});
