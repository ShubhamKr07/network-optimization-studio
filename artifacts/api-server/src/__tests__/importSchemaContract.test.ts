// SCU-2.P2.2 (B2.6) — the regenerated contract, exercised with POPULATED rows
// built by the production writers and versions read from the CONSTANTS (never
// literals): root CLAUDE.md "contract-version" + "hand-authored fixture"
// gotchas. Plus the strict-oneOf parity table: the generated Zod and the
// server's hand parser must accept and reject exactly the same bodies.
import { describe, it, expect } from "vitest";
import {
  PreviewScenarioImportBody,
  ApplyScenarioImportBody,
  PreviewScenarioImportResponse,
  ImportEntity as GeneratedImportEntity,
  ExportScenarioEntity,
} from "@workspace/api-zod";
import { IMPORT_ENTITIES, TEMPLATE_VERSION, DISTANCE_TEMPLATE_VERSION } from "@workspace/import-schema";
import { applyWarehouseOverrides, applyDistanceOverrides, toDistanceJsonRow } from "../services/templates.js";
import { parseAndValidateJsonImport, readImportRequest } from "../services/import.js";

const DOC = { templateVersion: TEMPLATE_VERSION, entity: "warehouses", rows: [{ id: "ATL", status: "forced_open" }] };
const CSV = { entity: "warehouses", csvText: "x" };
const JSON_REQ = { entity: "warehouses", format: "json", document: DOC };

describe("import contract", () => {
  it("the OpenAPI ImportEntity enum is exactly import-schema's IMPORT_ENTITIES", () => {
    expect(Object.values(GeneratedImportEntity).sort()).toEqual([...IMPORT_ENTITIES].sort());
  });

  it("every import entity is also an export entity", () => {
    for (const e of IMPORT_ENTITIES) expect(Object.values(ExportScenarioEntity)).toContain(e);
  });

  it("a JSON request built from real export rows parses as preview and apply bodies", () => {
    const rows = applyWarehouseOverrides([{ id: "ATL", status: "forced_open" }]);
    expect(rows.length).toBeGreaterThan(0);
    const body = { entity: "warehouses", format: "json", document: { templateVersion: TEMPLATE_VERSION, entity: "warehouses", rows } };
    expect(PreviewScenarioImportBody.safeParse(body).success).toBe(true);
    expect(ApplyScenarioImportBody.safeParse({ ...body, mode: "partial" }).success).toBe(true);
    expect(readImportRequest(body, "preview").ok).toBe(true);
  });

  it("a v2 distance document parses with its unit", () => {
    const rows = applyDistanceOverrides([{ fromId: "ALN", toId: "C1", distance: 12 }], "mi").map(toDistanceJsonRow);
    const body = { entity: "distances", format: "json", document: { templateVersion: DISTANCE_TEMPLATE_VERSION, entity: "distances", unit: "mi", rows } };
    expect(PreviewScenarioImportBody.safeParse(body).success).toBe(true);
    expect(readImportRequest(body, "preview").ok).toBe(true);
  });

  it("a real JSON preview carrying rowIndex/field errors AND changes survives the response schema unchanged", () => {
    const rows: Record<string, unknown>[] = applyWarehouseOverrides([]).map(r => ({ ...r }));
    rows[0] = { ...rows[0], bogus: 1 };
    rows[1] = { ...rows[1], status: "forced_open" };
    const preview = parseAndValidateJsonImport("warehouses", { templateVersion: TEMPLATE_VERSION, entity: "warehouses", rows }, {}, 3, "p-median-us");
    expect(preview.errors[0]).toMatchObject({ errorClass: "syntax", line: null, rowIndex: 0, field: "bogus" });
    expect(preview.changes).toEqual([expect.objectContaining({ rowIndex: 1, line: 3 })]);
    expect(PreviewScenarioImportResponse.parse(preview)).toEqual(preview);
  });
});

// [case, body, accepted, expected server status when rejected]
const PREVIEW_CASES: Array<[string, unknown, boolean, 400 | 422 | null]> = [
  ["format omitted (csv)", CSV, true, null],
  ["format csv", { ...CSV, format: "csv" }, true, null],
  ["format json", JSON_REQ, true, null],
  ["format null", { ...CSV, format: null }, false, 422],
  ["unknown format", { ...CSV, format: "xml" }, false, 422],
  ["mixed: csv + document", { ...CSV, format: "csv", document: DOC }, false, 422],
  ["mixed: format omitted + document", { ...CSV, document: DOC }, false, 422],
  ["json carrying csvText", { entity: "warehouses", format: "json", csvText: "x" }, false, 422],
  ["unknown request key", { ...CSV, extra: 1 }, false, 422],
  ["mode on preview", { ...CSV, mode: "partial" }, false, 422],
  ["entity not an import entity", { ...CSV, entity: "assignments" }, false, 422],
  ["json without document", { entity: "warehouses", format: "json" }, false, 400],
  ["document extra top-level key", { ...JSON_REQ, document: { ...DOC, exportedAt: "x" } }, false, 400],
  ["document.entity not an import entity", { ...JSON_REQ, document: { ...DOC, entity: "assignments" } }, false, 400],
  ["document.unit not km/mi", { ...JSON_REQ, document: { ...DOC, unit: "ft" } }, false, 400],
  ["document.rows not an array", { ...JSON_REQ, document: { ...DOC, rows: {} } }, false, 400],
  ["document row not an object", { ...JSON_REQ, document: { ...DOC, rows: [1] } }, false, 400],
  ["document.templateVersion not a number", { ...JSON_REQ, document: { ...DOC, templateVersion: "1" } }, false, 400],
];
const APPLY_CASES: Array<[string, unknown, boolean]> = [
  ["mode omitted", CSV, true],
  ["mode partial", { ...CSV, mode: "partial" }, true],
  ["json + mode", { ...JSON_REQ, mode: "all_or_nothing" }, true],
  ["mode bogus", { ...CSV, mode: "bogus" }, false],
  ["mode null", { ...CSV, mode: null }, false],
];

describe("strict oneOf: generated Zod and readImportRequest agree on every case", () => {
  it.each(PREVIEW_CASES)("preview — %s", (_name, body, accepted, status) => {
    expect(PreviewScenarioImportBody.safeParse(body).success).toBe(accepted);
    const result = readImportRequest(body, "preview");
    expect(result.ok).toBe(accepted);
    if (!result.ok) {
      expect(result.status).toBe(status);
      if (status === 400) expect(result.body.errorClass).toBe("malformed");
    }
  });
  it.each(APPLY_CASES)("apply — %s", (_name, body, accepted) => {
    expect(ApplyScenarioImportBody.safeParse(body).success).toBe(accepted);
    expect(readImportRequest(body, "apply").ok).toBe(accepted);
  });
});
