// SCU-2.P2.2 (B2.6) — edge values through the JSON → CSV → validator path, and
// the 20,000 / 20,001 row boundary for both formats. Pure (no DB).
import { describe, it, expect } from "vitest";
import { MAX_IMPORT_ROWS, TEMPLATE_VERSION, DISTANCE_TEMPLATE_VERSION, csvColumns } from "@workspace/import-schema";
import type { ImportEntity } from "@workspace/import-schema";
import { parseAndValidateImport, parseAndValidateJsonImport } from "../services/import.js";

const M = "p-median-us";
const json = (entity: ImportEntity, rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
  parseAndValidateJsonImport(entity, { templateVersion: TEMPLATE_VERSION, entity, rows, ...extra }, {}, 3, M);
const ATL = { id: "ATL", displayCode: null, city: "Atlanta", state: "GA", lat: 33.753693, lng: -84.389544, capacity: null, status: "active" };

describe("edge values", () => {
  it("quotes, commas and newlines survive JSON → CSV → validator unchanged", () => {
    const city = 'Fort "Big", Town\nNorth';
    const displayCode = 'A,B "C"';
    const p = json("warehouses", [{ ...ATL, id: null, displayCode, city, status: "active" }]);
    expect(p.errors).toEqual([]);
    expect(p.changes).toEqual([expect.objectContaining({ changeType: "add", city, displayCode, rowIndex: 0, line: 2 })]);
  });

  it("false survives: disabling a capable plant×product pair is a real change", () => {
    const p = parseAndValidateJsonImport("plantCapabilities", { templateVersion: TEMPLATE_VERSION, entity: "plantCapabilities", rows: [{ plantId: "plant-1", productId: "product-1", enabled: false }] }, {}, 2, "two-echelon-jade-us");
    expect(p.errors).toEqual([]);
    expect(p.changes).toEqual([expect.objectContaining({ after: { status: "false", value: 0 }, rowIndex: 0 })]);
  });

  it("null on a nullable field is a blank cell, not an error", () => {
    expect(json("warehouses", [{ ...ATL, displayCode: null, capacity: null, lat: null }]).errors).toEqual([]);
  });

  it("envelope-backed fields may be omitted from rows (templateVersion; unit on v2)", () => {
    expect(json("warehouses", [ATL]).errors).toEqual([]);
    const v2 = parseAndValidateJsonImport("distances", { templateVersion: DISTANCE_TEMPLATE_VERSION, entity: "distances", unit: "mi", rows: [{ fromId: "ALN", toId: "C1", distance: 123.4 }] }, {}, 3, M);
    expect(v2.errors).toEqual([]);
    expect(v2.changes[0]!.after.value).toBe(123.4); // mi → mi is identity
  });

  it("km converts to the canonical mi with the existing 4-dp rounding (100 km → 62.1371 mi)", () => {
    const p = parseAndValidateJsonImport("distances", { templateVersion: DISTANCE_TEMPLATE_VERSION, entity: "distances", unit: "km", rows: [{ fromId: "ALN", toId: "C1", distance: 100 }] }, {}, 3, M);
    expect(p.errors).toEqual([]);
    expect(p.changes[0]!.after.value).toBe(62.1371);
  });

  it("a row-level templateVersion wins over the envelope's", () => {
    expect(json("warehouses", [{ ...ATL, templateVersion: TEMPLATE_VERSION + 1 }]).errors).toEqual([expect.objectContaining({ rowIndex: 0, message: expect.stringContaining("template_version") })]);
  });

  it("a non-null value of the wrong JSON type is a syntax error on that field", () => {
    expect(json("warehouses", [{ ...ATL, capacity: "5" }]).errors).toEqual([expect.objectContaining({ errorClass: "syntax", rowIndex: 0, field: "capacity" })]);
  });
});

describe("row-count boundary (MAX_IMPORT_ROWS)", () => {
  const capError = (errors: Array<{ message: string }>) => errors.some(e => e.message.includes(`maximum is ${MAX_IMPORT_ROWS}`));
  const csvWith = (n: number) => `${csvColumns("warehouses", TEMPLATE_VERSION).join(",")}\n${Array.from({ length: n }, () => `${TEMPLATE_VERSION},ATL,,Atlanta,GA,33.75,-84.39,,active`).join("\n")}\n`;

  it(`CSV: ${MAX_IMPORT_ROWS} rows accepted by the cap, ${MAX_IMPORT_ROWS + 1} rejected`, () => {
    expect(capError(parseAndValidateImport("warehouses", csvWith(MAX_IMPORT_ROWS), {}, 3, M).errors)).toBe(false);
    expect(parseAndValidateImport("warehouses", csvWith(MAX_IMPORT_ROWS + 1), {}, 3, M).errors).toEqual([expect.objectContaining({ errorClass: "format", line: null })]);
  });

  it(`JSON: ${MAX_IMPORT_ROWS} rows accepted by the cap, ${MAX_IMPORT_ROWS + 1} rejected`, () => {
    expect(capError(json("warehouses", Array.from({ length: MAX_IMPORT_ROWS }, () => ATL)).errors)).toBe(false);
    expect(json("warehouses", Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ATL)).errors).toEqual([expect.objectContaining({ errorClass: "format", line: null })]);
  });
});
