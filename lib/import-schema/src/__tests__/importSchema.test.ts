import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import {
  IMPORT_ENTITIES, IMPORT_SCHEMAS, MODEL_IDS, TEMPLATE_VERSION, DISTANCE_TEMPLATE_VERSION,
  MAX_IMPORT_ROWS, MAX_IMPORT_BYTES, csvColumns, exampleCsv, exampleJsonDocument,
  findTemplateVersion, isImportEntity,
} from "../index.js";

// The "no column change" anchor (spec B2.5): today's literal column lists from
// artifacts/api-server/src/services/import.ts:100-211 at 46d2f98. Written out
// by hand on purpose — a test that derived these from the package could not fail.
const LITERAL_COLUMNS: Record<string, Record<number, string[]>> = {
  warehouses: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "capacity", "status"] },
  customers: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "demand", "status"] },
  mines: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "capacity"] },
  stations: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "demand"] },
  refineries: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng", "status"] },
  plants: { 1: ["template_version", "id", "display_code", "city", "state", "lat", "lng"] },
  distances: { 1: ["template_version", "from_id", "to_id", "distance"], 2: ["template_version", "unit", "from_id", "to_id", "distance"] },
  legDistances: { 1: ["template_version", "from_id", "to_id", "distance"], 2: ["template_version", "unit", "from_id", "to_id", "distance"] },
  laneCosts: { 1: ["template_version", "from_id", "to_id", "cost"], 2: ["template_version", "unit", "from_id", "to_id", "cost"] },
  plantCapabilities: { 1: ["template_version", "plant_id", "product_id", "enabled"] },
  deliveryCosts: { 1: ["template_version", "from_id", "to_id", "cost"] },
};

describe("constants", () => {
  it("pins the spec values", () => {
    expect(TEMPLATE_VERSION).toBe(1);
    expect(DISTANCE_TEMPLATE_VERSION).toBe(2);
    expect(MAX_IMPORT_ROWS).toBe(20000);
    expect(MAX_IMPORT_BYTES).toBe(2097152); // what body-parser parses "2mb" to
  });
});

describe("IMPORT_SCHEMAS", () => {
  it("has exactly one schema per entity, keyed by its own name", () => {
    expect(Object.keys(IMPORT_SCHEMAS).sort()).toEqual([...IMPORT_ENTITIES].sort());
    for (const entity of IMPORT_ENTITIES) expect(IMPORT_SCHEMAS[entity].entity).toBe(entity);
  });

  it.each(Object.entries(LITERAL_COLUMNS))("%s: CSV columns equal today's literal header for every version", (entity, byVersion) => {
    const schema = IMPORT_SCHEMAS[entity as keyof typeof IMPORT_SCHEMAS];
    expect(schema.versions.map(v => v.templateVersion)).toEqual(Object.keys(byVersion).map(Number));
    for (const [version, columns] of Object.entries(byVersion)) {
      expect(csvColumns(schema.entity, Number(version))).toEqual(columns);
    }
  });

  it("every entity is covered by the literal table", () => {
    expect(Object.keys(LITERAL_COLUMNS).sort()).toEqual([...IMPORT_ENTITIES].sort());
  });

  it("jsonKey is the camelCase of csvHeader (from_id ↔ fromId)", () => {
    for (const entity of IMPORT_ENTITIES) for (const v of IMPORT_SCHEMAS[entity].versions) for (const f of v.fields) {
      expect(f.jsonKey).toBe(f.csvHeader.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()));
    }
    const distances = findTemplateVersion("distances", DISTANCE_TEMPLATE_VERSION)!;
    expect(distances.fields.map(f => f.jsonKey)).toEqual(["templateVersion", "unit", "fromId", "toId", "distance"]);
  });

  it("nullable is exactly !(requiredForAdd && requiredForUpdate)", () => {
    for (const entity of IMPORT_ENTITIES) for (const v of IMPORT_SCHEMAS[entity].versions) for (const f of v.fields) {
      expect(f.nullable).toBe(!(f.requiredForAdd && f.requiredForUpdate));
    }
  });

  it("examples are well-typed: enum examples are members, number examples parse, booleans are true/false", () => {
    for (const entity of IMPORT_ENTITIES) for (const v of IMPORT_SCHEMAS[entity].versions) for (const f of v.fields) {
      if (f.type === "enum") { expect(f.enum!.length).toBeGreaterThan(0); expect(f.enum).toContain(f.example); }
      if (f.type === "number" && f.example !== "") expect(Number.isFinite(Number(f.example))).toBe(true);
      if (f.type === "boolean") expect(["true", "false"]).toContain(f.example);
      if (f.exclusiveMin) expect(f.min).toBeDefined();
    }
  });

  it("models: entity models are known; addModels and field models are subsets", () => {
    for (const entity of IMPORT_ENTITIES) {
      const s = IMPORT_SCHEMAS[entity];
      expect(s.models.length).toBeGreaterThan(0);
      for (const m of s.models) expect(MODEL_IDS).toContain(m);
      for (const m of s.addModels) expect(s.models).toContain(m);
      for (const v of s.versions) for (const f of v.fields) for (const m of f.models ?? []) expect(s.models).toContain(m);
    }
  });

  it("pair entities have no id column and no add mode; single-id entities have both", () => {
    for (const entity of IMPORT_ENTITIES) {
      const s = IMPORT_SCHEMAS[entity];
      const hasId = s.versions.every(v => v.fields.some(f => f.csvHeader === "id"));
      if (!hasId) expect(s.addModels).toEqual([]);
      else expect(s.addModels.length).toBeGreaterThan(0);
    }
  });

  it("unit-bearing versions carry a unit field fed from the envelope; templateVersion is always envelope-backed", () => {
    for (const entity of IMPORT_ENTITIES) for (const v of IMPORT_SCHEMAS[entity].versions) {
      expect(v.fields[0]).toMatchObject({ csvHeader: "template_version", envelopeKey: "templateVersion", example: String(v.templateVersion) });
      const unit = v.fields.find(f => f.csvHeader === "unit");
      expect(unit === undefined).toBe(v.templateVersion !== DISTANCE_TEMPLATE_VERSION);
      if (unit) expect(unit).toMatchObject({ envelopeKey: "unit", enum: ["km", "mi"] });
    }
  });
});

describe("helpers", () => {
  it("csvColumns throws on an unknown version", () => {
    expect(() => csvColumns("warehouses", 99)).toThrow(/warehouses/);
  });

  it("exampleCsv is real CSV: it parses back to exactly the latest header + example row", () => {
    for (const entity of IMPORT_ENTITIES) {
      const versions = IMPORT_SCHEMAS[entity].versions;
      const latest = versions[versions.length - 1]!;
      const csv = exampleCsv(entity);
      expect(csv.endsWith("\n")).toBe(true);
      expect(Papa.parse<string[]>(csv.trim()).data).toEqual([latest.fields.map(f => f.csvHeader), latest.fields.map(f => f.example)]);
    }
  });

  it("exampleJsonDocument is an export-shaped envelope with one populated row", () => {
    const doc = exampleJsonDocument("distances");
    expect(doc).toEqual({ templateVersion: DISTANCE_TEMPLATE_VERSION, entity: "distances", unit: "mi", rows: [{ fromId: "ALN", toId: "C1", distance: 123.4 }] });
    const wh = exampleJsonDocument("warehouses");
    expect(wh.unit).toBeUndefined();
    expect(wh.rows[0]).toMatchObject({ id: "ALN", displayCode: null, capacity: null, status: "forced_open", lat: 40.602812 });
    expect(exampleJsonDocument("plantCapabilities").rows[0]).toEqual({ plantId: "plant-1", productId: "product-2", enabled: true });
  });

  it("isImportEntity", () => {
    expect(isImportEntity("warehouses")).toBe(true);
    expect(isImportEntity("assignments")).toBe(false);
    expect(isImportEntity(7)).toBe(false);
  });
});

describe("deliveryCosts (D1)", () => {
  it("is v1-only, unitless, cost >= 0 inclusive, delivery-only, no add mode", () => {
    const s = IMPORT_SCHEMAS.deliveryCosts;
    expect(s.models).toEqual(["delivery-teaching-us"]);
    expect(s.addModels).toEqual([]);
    expect(s.versions.map(v => v.templateVersion)).toEqual([TEMPLATE_VERSION]);
    const cost = s.versions[0]!.fields.find(f => f.csvHeader === "cost")!;
    expect(cost).toMatchObject({ type: "number", min: 0, requiredForUpdate: true });
    expect(cost.exclusiveMin).toBeUndefined();
    expect(cost.unitFamily).toBeUndefined(); // billable miles, never unit-converted
    expect(exampleJsonDocument("deliveryCosts")).toEqual({ templateVersion: TEMPLATE_VERSION, entity: "deliveryCosts", rows: [{ fromId: "W8", toId: "C269", cost: 1047.7157 }] });
  });
});
