import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { unzipSync, strFromU8 } from "fflate";
import { describeIssue, LEGACY_LOCATION_COLUMNS, parseCsvFiles, parseJsonText, parseXlsx, SUPER_TABLE_FILES, toCsvFiles, toCsvZip, toXlsx } from "@/lib/superFiles";

const sample = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/samples/super-model-sample.json"), "utf8"));
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const csv = (files: Record<string, string>) => parseCsvFiles(Object.entries(files).map(([name, text]) => ({ name, text })));
const msgs = (r: { ok: boolean }) => (r.ok ? [] : (r as { errors: { where: string; message: string }[] }).errors.map(e => `${e.where}: ${e.message}`));
const book = (sheets: Record<string, XLSX.WorkSheet>) => {
  const wb = XLSX.utils.book_new();
  for (const [n, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, ws, n);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};

describe("format parity and round-trip (real writer, not a hand-built fixture)", () => {
  it("the sample exported as CSV files and as XLSX parses back to the identical document", async () => {
    const fromCsv = ok(parseCsvFiles(toCsvFiles(sample))).doc;
    const fromXlsx = ok(await parseXlsx(await toXlsx(sample))).doc;
    const fromJson = ok(parseJsonText(JSON.stringify(sample))).doc;
    expect(fromCsv).toEqual(sample);
    expect(fromXlsx).toEqual(sample);
    expect(fromJson).toEqual(sample);
  });
  it("the CSV zip holds the eight files and re-parses to the same document", async () => {
    const files = unzipSync(await toCsvZip(sample));
    expect(Object.keys(files).sort()).toEqual(["customers.csv", "demand.csv", "distance_overrides.csv", "parameters.csv", "plant_products.csv", "plants.csv", "products.csv", "warehouses.csv"]);
    expect(ok(parseCsvFiles(Object.entries(files).map(([name, u]) => ({ name, text: strFromU8(u) })))).doc).toEqual(sample);
  });
  it("strings starting with = + - @ round-trip through CSV and XLSX", async () => {
    const doc = { products: ["=SUM(A1)", "+1 cmd", "-x", "@me"].map((name, i) => ({ id: `k${i}`, name })) };
    const text = toCsvFiles(doc).find(f => f.name === "products.csv")!.text;
    expect(text).toContain("'=SUM(A1)");                       // guard applied on export
    expect(ok(parseCsvFiles(toCsvFiles(doc))).doc.products).toEqual(doc.products);
    expect(ok(await parseXlsx(await toXlsx(doc))).doc.products).toEqual(doc.products);
  });
  it("R3: numeric-looking strings in text columns round-trip unchanged (clientCsv leaves a finite number unguarded)", async () => {
    const doc = { products: [{ id: "-5", name: "+1" }, { id: "101", name: "=2" }] };
    const text = toCsvFiles(doc).find(f => f.name === "products.csv")!.text;
    expect(text).toContain("-5,+1");                           // no prefix: a finite number cannot carry a formula
    expect(text).toContain("'=2");                             // "=2" is not a finite number, so it is guarded
    expect(ok(parseCsvFiles(toCsvFiles(doc))).doc.products).toEqual(doc.products);
    expect(ok(await parseXlsx(await toXlsx(doc))).doc.products).toEqual(doc.products);
  });
});

describe("cell coercion", () => {
  it("numeric-looking ids stay text; numeric columns parse; empty optional omitted; empty rows skipped", () => {
    const r = ok(csv({ "plants.csv": "id,city,lat,lng\n101,,1.5,-2\n,,,\n102,Town,3,4\n" }));
    expect(r.doc.plants).toEqual([{ id: "101", lat: 1.5, lng: -2 }, { id: "102", city: "Town", lat: 3, lng: 4 }]);
    expect(r.sources.plants).toEqual({ source: "plants.csv", headerRow: 1, rows: [2, 4] });
  });
  it("XLSX: numeric id cell -> text, formula uses cached value; date, error and uncached formula are errors", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["id", "lat", "lng"], [101, 1, 2]]);
    ws["B2"] = { t: "n", v: 5, f: "2+3" };
    const good = ok(await parseXlsx(book({ plants: ws })));
    expect(good.doc.plants).toEqual([{ id: "101", lat: 5, lng: 2 }]);
    for (const [cell, why] of [[{ t: "d", v: new Date("2026-01-01") }, "date"], [{ t: "e", v: 7 }, "error"], [{ t: "n", f: "1+1" }, "cached"]] as const) {
      const bad = XLSX.utils.aoa_to_sheet([["id", "lat", "lng"], ["x", 1, 2]]);
      bad["B2"] = cell as XLSX.CellObject;
      const r = await parseXlsx(book({ plants: bad }));
      expect(r.ok).toBe(false);
      expect(msgs(r).join("\n")).toMatch(new RegExp(`^sheet plants row 2 column lat: .*${why}`));
    }
  });
  it("names the file, row and column of a bad number, a missing required cell and an unknown column", () => {
    const r = csv({ "plants.csv": "id,lat,lng,colour\nA,north,2,red\n,1,2,\n" });
    expect(r.ok).toBe(false);
    expect(msgs(r)).toEqual([
      "plants.csv column colour: unknown column",
      "plants.csv row 2 column lat: is not a number",
      "plants.csv row 3 column id: is required",
    ]);
  });
  it("bad number and missing required cell", () => {
    const r = csv({ "plants.csv": "id,lat,lng\nA,north,2\n,1,2\n" });
    expect(msgs(r)).toEqual(["plants.csv row 2 column lat: is not a number", "plants.csv row 3 column id: is required"]);
  });
  it("rejects unknown files and missing required columns", () => {
    expect(msgs(csv({ "stuff.csv": "a\n1\n" }))).toEqual(["stuff.csv: unknown file name"]);
    expect(msgs(csv({ "demand.csv": "customerId,productId\nc,k\n" }))).toEqual(["demand.csv column demand: required column is missing"]);
  });
});

describe("review hardening", () => {
  it("1e999 is rejected as non-finite, not turned into Infinity/null", () => {
    expect(msgs(csv({ "plants.csv": "id,lat,lng\nA,1e999,2\n" }))).toEqual(["plants.csv row 2 column lat: is not a finite number"]);
  });
  it("a value under no header or past the header width is an error naming row and column position", () => {
    expect(msgs(csv({ "plants.csv": "id,lat,lng\nA,1,2,stray\n" }))).toEqual(["plants.csv row 2 column position 4: has a value but no column header"]);
    expect(msgs(csv({ "plants.csv": "id,,lat,lng\nA,hidden,1,2\n" }))).toEqual(["plants.csv row 2 column position 2: has a value but no column header"]);
  });
  it("header columns in a non-default order parse identically", () => {
    const a = ok(csv({ "plants.csv": "id,lat,lng\nA,1,2\n" })).doc;
    const b = ok(csv({ "plants.csv": "lng,lat,id\n2,1,A\n" })).doc;
    expect(b).toEqual(a);
  });
  it("a duplicate header column is an error", () => {
    expect(msgs(csv({ "plants.csv": "id,lat,lat,lng\nA,1,1,2\n" }))).toEqual(["plants.csv column lat: duplicate column"]);
  });
  it("a non-numeric parameter value is an error", () => {
    expect(msgs(csv({ "parameters.csv": "key,value\np,abc\n" }))).toEqual(["parameters.csv row 2 column value: is not a number"]);
  });
  it("an empty required XLSX cell is an error with sheet, row and column", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["id", "lat", "lng"], ["", 1, 2]]);
    expect(msgs(await parseXlsx(book({ plants: ws })))).toEqual(["sheet plants row 2 column id: is required"]);
  });
});

describe("parameters", () => {
  it("maps keys, nests transportCosts, drops empty values", () => {
    const r = ok(csv({ "parameters.csv": "key,value\np,3\ndistanceMethod,circuity\ngap,\ntransportCosts.icTransCost,0.1\n" }));
    expect(r.doc).toEqual({ p: 3, distanceMethod: "circuity", transportCosts: { icTransCost: 0.1 } });
    expect(r.sources["transportCosts.icTransCost"]).toEqual({ source: "parameters.csv", headerRow: 1, rows: [5] });
  });
  it("unknown and duplicate keys are errors", () => {
    expect(msgs(csv({ "parameters.csv": "key,value\nfoo,1\n" }))).toEqual(["parameters.csv row 2: unknown parameter foo"]);
    expect(msgs(csv({ "parameters.csv": "key,value\np,1\np,2\n" }))).toEqual(["parameters.csv row 3: duplicate parameter p"]);
  });
});

describe("422 issue -> file/row/column (the describeIssue contract above)", () => {
  it("row map, column, parameter row, table-level, unmapped index and missing source", () => {
    const { sources } = ok(csv({ "plants.csv": "id,lat,lng\nA,1,2\n,,\nB,3,4\n", "parameters.csv": "key,value\np,0\ntransportCosts.icMinTrans,-1\n" }));
    expect(describeIssue({ path: ["plants", 1, "lat"], message: "too big" }, sources)).toBe("plants.csv row 4 column lat: too big");
    expect(describeIssue({ path: ["plants", 0], message: "bad row" }, sources)).toBe("plants.csv row 2: bad row");
    expect(describeIssue({ path: ["plants"], message: "Existing plants row 3: x" }, sources)).toBe("plants.csv: Existing plants row 3: x");
    expect(describeIssue({ path: ["plants", 7, "lat"], message: "x" }, sources)).toBe("plants.csv (unmapped row index 7): x");
    expect(describeIssue({ path: ["p"], message: "must be ≥ 1" }, sources)).toBe("parameters.csv row 2: must be ≥ 1");
    expect(describeIssue({ path: ["transportCosts", "icMinTrans"], message: "must be ≥ 0" }, sources)).toBe("parameters.csv row 3: must be ≥ 0");
    expect(describeIssue({ path: ["demand"], message: "Existing demand row 3: x" }, sources)).toBe("demand: Existing demand row 3: x");
  });
  it("P4: an XLSX table that does not start at A1 reports real sheet rows", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["id", "lat", "lng"], ["A", 1, 2], ["B", "north", 4]], { origin: "B3" });
    ws["!ref"] = "B3:D5";   // SheetJS 0.20.3 reports A1:D5 for an origin write; pin the real B3:D5 dimension
    const bad = await parseXlsx(book({ plants: ws }));
    expect(msgs(bad)).toEqual(["sheet plants row 5 column lat: is not a number"]);
    ws["C5"] = { t: "n", v: 3 };
    const good = ok(await parseXlsx(book({ plants: ws })));
    expect(good.sources.plants).toEqual({ source: "sheet plants", headerRow: 3, rows: [4, 5] });
  });
});

describe("parseCsvFiles case", () => {
  it("matches .CSV and the stem case-insensitively but names the original file in errors", () => {
    const r = parseCsvFiles([{ name: "Plants.CSV", text: "id,lat,lng\nA,1,2\n" }]);
    expect(r.ok).toBe(true);
    const bad = parseCsvFiles([{ name: "Nope.CSV", text: "a\n1\n" }]);
    expect(JSON.stringify(bad)).toContain("Nope.CSV");
  });
});

describe("QFX-7: location tables have no name; a legacy name column is accepted and discarded", () => {
  it("LEGACY_LOCATION_COLUMNS is exactly name, set on the three location files only, none of which lists name as a column", () => {
    expect(LEGACY_LOCATION_COLUMNS).toEqual(["name"]);
    expect(SUPER_TABLE_FILES.filter(t => t.legacy).map(t => t.key)).toEqual(["plants", "warehouses", "customers"]);
    for (const t of SUPER_TABLE_FILES.filter(t => t.legacy)) expect(t.cols.map(col => col.field), t.key).not.toContain("name");
  });
  it("CSV: a legacy name column with values imports on every location table and the values are dropped", () => {
    const r = ok(csv({
      "plants.csv": "id,name,lat,lng\nP,Old plant,1,2\n",
      "warehouses.csv": "id,name,lat,lng,status\nW,Old wh,3,4,active\n",
      "customers.csv": "name,id,lat,lng\nOld cust,C,5,6\n",
    }));
    expect(r.doc).toEqual({
      plants: [{ id: "P", lat: 1, lng: 2 }],
      warehouses: [{ id: "W", lat: 3, lng: 4, status: "active" }],
      customers: [{ id: "C", lat: 5, lng: 6 }],
    });
    for (const t of ["plants", "warehouses", "customers"]) expect((r.doc[t] as Record<string, unknown>[])[0], t).not.toHaveProperty("name");
  });
  it("XLSX: a legacy name column is discarded the same way", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["id", "name", "lat", "lng"], ["P", "Old", 1, 2]]);
    const r = ok(await parseXlsx(book({ plants: ws })));
    expect(r.doc.plants).toEqual([{ id: "P", lat: 1, lng: 2 }]);
    expect((r.doc.plants as Record<string, unknown>[])[0]).not.toHaveProperty("name");
  });
  it("name is not legacy on products (still required, still kept); any other unknown location column is still an error", () => {
    expect(msgs(csv({ "products.csv": "id\nk\n" }))).toEqual(["products.csv column name: required column is missing"]);
    expect(ok(csv({ "products.csv": "id,name\nk,K\n" })).doc.products).toEqual([{ id: "k", name: "K" }]);
    expect(msgs(csv({ "plants.csv": "id,name,label,lat,lng\nP,a,b,1,2\n" }))).toEqual(["plants.csv column label: unknown column"]);
  });
  it("export writes no name column for locations, even from a draft row that still carries one; products keep it", () => {
    const files = toCsvFiles({ plants: [{ id: "P", name: "Old", lat: 1, lng: 2 }], products: [{ id: "k", name: "K" }] });
    expect(files.find(f => f.name === "plants.csv")!.text.split("\n")[0]).toBe("id,city,state,lat,lng");
    expect(files.find(f => f.name === "plants.csv")!.text).not.toContain("Old");
    expect(files.find(f => f.name === "products.csv")!.text.split("\n")[0]).toBe("id,name");
  });
});
