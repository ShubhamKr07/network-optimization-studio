// SCU-2.R6a — spreadsheet formula-injection guard on every server CSV, and the
// import-side strip so download -> edit -> upload round-trips. Rows come from the
// production writers (applyWarehouseOverrides -> warehouseRowsToCsv), not hand-built CSV.
import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import { applyWarehouseOverrides, warehouseRowsToCsv, deliveryCostRowsToCsv, csvCell } from "../services/templates.js";
import { parseAndValidateImport, parseAndValidateJsonImport, readImportRequest } from "../services/import.js";
import { TEMPLATE_VERSION } from "@workspace/import-schema";

const added = [
  { id: "W-X1", displayCode: "=HYPERLINK(\"x\")", city: "@cmd", state: "-NY", lat: 40.5, lng: -74.25, capacity: 5, status: "active" as const },
  { id: "W-X2", displayCode: "A,B", city: "Line\rBreak", state: "+x", lat: -10, lng: -20, capacity: 7, status: "forced_open" as const },
  { id: "W-Q", displayCode: "Q", city: "'=quoted", state: "NY", lat: 1, lng: 2, capacity: 1, status: "active" as const },
];
const parse = (csv: string) => Papa.parse<string[]>(csv.trim(), { skipEmptyLines: true }).data;

describe("csvCell", () => {
  it("prefixes risky strings, quotes , \" CR LF, leaves numbers and numeric-looking strings", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("a\rb")).toBe('"a\rb"');
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell(true)).toBe("true");
  });
});

describe("warehouse export + import round trip (real writer)", () => {
  const csv = warehouseRowsToCsv(applyWarehouseOverrides([], added));
  it("neutralises formula-leading text and quotes comma/CR; numeric negatives untouched", () => {
    expect(csv).toContain('"Line\rBreak"');
    const rows = parse(csv);
    const x1 = rows.find(r => r[1] === "W-X1")!;
    expect(x1.slice(2, 5)).toEqual(["'=HYPERLINK(\"x\")", "'@cmd", "'-NY"]);
    expect(x1[6]).toBe("-74.25");
    expect(x1[7]).toBe("5");
    const x2 = rows.find(r => r[1] === "W-X2")!;
    expect(x2.slice(2, 5)).toEqual(["A,B", "Line\rBreak", "'+x"]);
    expect(rows.find(r => r[1] === "W-X2")![5]).toBe("-10");
  });
  it("export -> upload as add-mode rows stores the ORIGINAL formula-leading text (non-vacuous: needs the strip)", () => {
    const [header, ...body] = parse(csv);
    const addRows = body.filter(r => r[1].startsWith("W-X") || r[1] === "W-Q").map(r => { const c = [...r]; c[1] = ""; c[2] = ""; return c; });
    const preview = parseAndValidateImport("warehouses", Papa.unparse([header, ...addRows], { newline: "\n" }), {} as never, 5);
    expect(preview.errors).toEqual([]);
    const json = JSON.stringify(preview.changes);
    for (const v of ["@cmd", "-NY", "'=quoted", "Line\rBreak"]) expect(json).toContain(JSON.stringify(v));
    expect(json).not.toContain("\"'@cmd\"");
    expect(json).not.toContain("\"''=quoted\"");
  });
  it("a stored value already starting with ' + formula char survives export -> upload", () => {
    expect(csvCell("'=x")).toBe("''=x");
  });
  it("an add-mode row's guarded text cells are stored without the ' (strip is not vacuous)", () => {
    const header = csv.split("\n")[0];
    const row = [TEMPLATE_VERSION, "", "", "'=SUM(1)", "'-NY", 41, -73, 9, "active"].join(",");
    const preview = parseAndValidateImport("warehouses", `${header}\n${row}\n`, {} as never, 5);
    expect(preview.errors).toEqual([]);
    const json = JSON.stringify(preview.changes);
    expect(json).toContain('"=SUM(1)"');
    expect(json).not.toContain("'=SUM(1)");
  });
  it("JSON path is not stripped: a JSON string starting with ' is kept verbatim", () => {
    const doc = { templateVersion: TEMPLATE_VERSION, entity: "warehouses", rows: [{ city: "'=keep", state: "NY", lat: 1, lng: 2, capacity: 3, status: "active" }] };
    const preview = parseAndValidateJsonImport("warehouses", doc as never, { addedWarehouses: added } as never, 5);
    expect(JSON.stringify(preview.changes)).toContain("'=keep");
  });
});

describe("deliveryCostRowsToCsv", () => {
  it("quotes an id containing a comma so the CSV stays well-formed", () => {
    const rows = parse(deliveryCostRowsToCsv([{ fromId: "W,1", toId: "=C", cost: 3 }]));
    expect(rows[1]).toEqual([String(TEMPLATE_VERSION), "W,1", "'=C", "3"]);
  });
});

describe("readImportRequest malformed messages are plain sentences", () => {
  const base = { entity: "warehouses", format: "json" };
  const doc = { templateVersion: TEMPLATE_VERSION, entity: "warehouses", rows: [] };
  const msg = (document: unknown) => {
    const r = readImportRequest({ ...base, document }, "preview");
    if (r.ok || r.status !== 400) throw new Error("expected 400");
    return r.body;
  };
  it("unknown field", () => {
    expect(msg({ ...doc, foo: 1 })).toMatchObject({ error: 'Unknown field "foo" in the document.', field: "foo", errorClass: "malformed" });
  });
  it("missing required field", () => {
    const { rows: _r, ...noRows } = doc;
    expect(msg(noRows).error).toBe('Missing required field "rows".');
  });
  it("wrong type", () => {
    expect(msg({ ...doc, rows: "x" }).error).toMatch(/^Wrong type for "rows": expected array, got string\.$/);
  });
});
