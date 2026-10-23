import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { unzipSync, strFromU8 } from "fflate";
import { describeIssue, parseCsvFiles, parseJsonText, parseXlsx, toCsvFiles, toCsvZip, toXlsx } from "@/lib/superFiles";

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
    const r = ok(csv({ "plants.csv": "id,name,city,lat,lng\n101,P,,1.5,-2\n,,,,\n102,Q,Town,3,4\n" }));
    expect(r.doc.plants).toEqual([{ id: "101", name: "P", lat: 1.5, lng: -2 }, { id: "102", name: "Q", city: "Town", lat: 3, lng: 4 }]);
    expect(r.sources.plants).toEqual({ source: "plants.csv", headerRow: 1, rows: [2, 4] });
  });
  it("XLSX: numeric id cell -> text, formula uses cached value; date, error and uncached formula are errors", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["id", "name", "lat", "lng"], [101, "P", 1, 2]]);
    ws["C2"] = { t: "n", v: 5, f: "2+3" };
    const good = ok(await parseXlsx(book({ plants: ws })));
    expect(good.doc.plants).toEqual([{ id: "101", name: "P", lat: 5, lng: 2 }]);
    for (const [cell, why] of [[{ t: "d", v: new Date("2026-01-01") }, "date"], [{ t: "e", v: 7 }, "error"], [{ t: "n", f: "1+1" }, "cached"]] as const) {
      const bad = XLSX.utils.aoa_to_sheet([["id", "name", "lat", "lng"], ["x", "P", 1, 2]]);
      bad["C2"] = cell as XLSX.CellObject;
      const r = await parseXlsx(book({ plants: bad }));
      expect(r.ok).toBe(false);
      expect(msgs(r).join("\n")).toMatch(new RegExp(`^sheet plants row 2 column lat: .*${why}`));
    }
  });
  it("names the file, row and column of a bad number, a missing required cell and an unknown column", () => {
    const r = csv({ "plants.csv": "id,name,lat,lng,colour\nA,P,north,2,red\n,Q,1,2,\n" });
    expect(r.ok).toBe(false);
    expect(msgs(r)).toEqual([
      "plants.csv column colour: unknown column",
      "plants.csv row 2 column lat: is not a number",
      "plants.csv row 3 column id: is required",
    ]);
  });
  it("bad number and missing required cell", () => {
    const r = csv({ "plants.csv": "id,name,lat,lng\nA,P,north,2\n,Q,1,2\n" });
    expect(msgs(r)).toEqual(["plants.csv row 2 column lat: is not a number", "plants.csv row 3 column id: is required"]);
  });
  it("rejects unknown files and missing required columns", () => {
    expect(msgs(csv({ "stuff.csv": "a\n1\n" }))).toEqual(["stuff.csv: unknown file name"]);
    expect(msgs(csv({ "demand.csv": "customerId,productId\nc,k\n" }))).toEqual(["demand.csv column demand: required column is missing"]);
  });
});

describe("review hardening", () => {
  it("1e999 is rejected as non-finite, not turned into Infinity/null", () => {
    expect(msgs(csv({ "plants.csv": "id,name,lat,lng\nA,P,1e999,2\n" }))).toEqual(["plants.csv row 2 column lat: is not a finite number"]);
  });
  it("a value under no header or past the header width is an error naming row and column position", () => {
    expect(msgs(csv({ "plants.csv": "id,name,lat,lng\nA,P,1,2,stray\n" }))).toEqual(["plants.csv row 2 column position 5: has a value but no column header"]);
    expect(msgs(csv({ "plants.csv": "id,name,,lat,lng\nA,P,hidden,1,2\n" }))).toEqual(["plants.csv row 2 column position 3: has a value but no column header"]);
  });
  it("header columns in a non-default order parse identically", () => {
    const a = ok(csv({ "plants.csv": "id,name,lat,lng\nA,P,1,2\n" })).doc;
    const b = ok(csv({ "plants.csv": "lng,lat,name,id\n2,1,P,A\n" })).doc;
    expect(b).toEqual(a);
  });
  it("a duplicate header column is an error", () => {
    expect(msgs(csv({ "plants.csv": "id,name,lat,lat,lng\nA,P,1,1,2\n" }))).toEqual(["plants.csv column lat: duplicate column"]);
  });
  it("a non-numeric parameter value is an error", () => {
    expect(msgs(csv({ "parameters.csv": "key,value\np,abc\n" }))).toEqual(["parameters.csv row 2 column value: is not a number"]);
  });
  it("an empty required XLSX cell is an error with sheet, row and column", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["id", "name", "lat", "lng"], ["A", "", 1, 2]]);
    expect(msgs(await parseXlsx(book({ plants: ws })))).toEqual(["sheet plants row 2 column name: is required"]);
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
    const { sources } = ok(csv({ "plants.csv": "id,name,lat,lng\nA,P,1,2\n,,,\nB,Q,3,4\n", "parameters.csv": "key,value\np,0\ntransportCosts.icMinTrans,-1\n" }));
    expect(describeIssue({ path: ["plants", 1, "lat"], message: "too big" }, sources)).toBe("plants.csv row 4 column lat: too big");
    expect(describeIssue({ path: ["plants", 0], message: "bad row" }, sources)).toBe("plants.csv row 2: bad row");
    expect(describeIssue({ path: ["plants"], message: "Existing plants row 3: x" }, sources)).toBe("plants.csv: Existing plants row 3: x");
    expect(describeIssue({ path: ["plants", 7, "lat"], message: "x" }, sources)).toBe("plants.csv (unmapped row index 7): x");
    expect(describeIssue({ path: ["p"], message: "must be ≥ 1" }, sources)).toBe("parameters.csv row 2: must be ≥ 1");
    expect(describeIssue({ path: ["transportCosts", "icMinTrans"], message: "must be ≥ 0" }, sources)).toBe("parameters.csv row 3: must be ≥ 0");
    expect(describeIssue({ path: ["demand"], message: "Existing demand row 3: x" }, sources)).toBe("demand: Existing demand row 3: x");
  });
  it("P4: an XLSX table that does not start at A1 reports real sheet rows", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["id", "name", "lat", "lng"], ["A", "P", 1, 2], ["B", "Q", "north", 4]], { origin: "B3" });
    ws["!ref"] = "B3:E5";   // SheetJS 0.20.3 reports A1:E5 for an origin write; pin the real B3:E5 dimension
    const bad = await parseXlsx(book({ plants: ws }));
    expect(msgs(bad)).toEqual(["sheet plants row 5 column lat: is not a number"]);
    ws["D5"] = { t: "n", v: 3 };
    const good = ok(await parseXlsx(book({ plants: ws })));
    expect(good.sources.plants).toEqual({ source: "sheet plants", headerRow: 3, rows: [4, 5] });
  });
});
