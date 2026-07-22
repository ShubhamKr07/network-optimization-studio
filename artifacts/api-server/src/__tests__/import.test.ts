import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseAndValidateImport } from "../services/import.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures", "imports");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

const NO_OVERRIDES = {};

describe("parseAndValidateImport — golden fixtures (warehouses)", () => {
  it("clean.csv: no errors, one change (ATL forced_open + capacity 500000)", () => {
    const result = parseAndValidateImport("warehouses", fixture("clean.csv"), NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      id: "ATL",
      line: 3,
      before: { status: "active", value: null },
      after: { status: "forced_open", value: 500000 },
    });
  });

  it("wrong-columns.csv: rejected as a single format error, no line-by-line parsing attempted", () => {
    const result = parseAndValidateImport("warehouses", fixture("wrong-columns.csv"), NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("format");
    expect(result.changes).toEqual([]);
  });

  it("bad-encoding.csv: rejected as a format error", () => {
    const result = parseAndValidateImport("warehouses", fixture("bad-encoding.csv"), NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("format");
  });

  it("three-bad-rows.csv: exactly 3 errors with correct classes and line numbers, valid rows still processed", () => {
    const result = parseAndValidateImport("warehouses", fixture("three-bad-rows.csv"), NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(3);

    const byLine = new Map(result.errors.map(e => [e.line, e]));
    expect(byLine.get(3)).toMatchObject({ errorClass: "logic" });   // ATL: negative capacity
    expect(byLine.get(4)).toMatchObject({ errorClass: "logic" });   // BAL: bogus_status
    expect(byLine.get(5)).toMatchObject({ errorClass: "syntax" });  // BOS: wrong column count

    // ALN (clean) and CHI (clean) still register as valid rows despite the 3 bad ones.
    expect(result.changes.some(c => c.id === "CHI")).toBe(true);
  });

  it("duplicate-id.csv: second occurrence of an id is a logic error", () => {
    const result = parseAndValidateImport("warehouses", fixture("duplicate-id.csv"), NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 3 });
    expect(result.errors[0].message).toMatch(/duplicate/i);
  });

  it("no-id-city-keyed.csv: rejected as a format error (city is not a valid join key)", () => {
    const result = parseAndValidateImport("warehouses", fixture("no-id-city-keyed.csv"), NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("format");
  });

  it("version-mismatch.csv: template_version mismatch is a logic error, not format", () => {
    const result = parseAndValidateImport("warehouses", fixture("version-mismatch.csv"), NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 2 });
    expect(result.errors[0].message).toMatch(/template_version/);
  });
});

describe("parseAndValidateImport — business rules", () => {
  it("rejects an unknown warehouse id as a logic error", () => {
    const csv = "template_version,id,city,state,capacity,status\n1,ZZZ,Nowhere,XX,,active\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/unknown id/i) }]);
  });

  it("customers: rejects a negative demand as a logic error", () => {
    const csv = "template_version,id,city,state,demand,status\n1,C1,Akron,OH,-5,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/non-negative/i) }]);
  });

  it("customers: rejects an invalid status as a logic error", () => {
    const csv = "template_version,id,city,state,demand,status\n1,C1,Akron,OH,1000,bogus\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/invalid status/i) }]);
  });

  it("produces no change when the imported row matches the current baseline exactly", () => {
    const csv = "template_version,id,city,state,capacity,status\n1,ALN,Allentown,PA,,active\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it("diffs against existing overrides, not just the raw baseline", () => {
    const csv = "template_version,id,city,state,capacity,status\n1,ALN,Allentown,PA,,inactive\n";
    // ALN is already forced_open via an existing override — importing "inactive" is a real change.
    const result = parseAndValidateImport(
      "warehouses",
      csv,
      { warehouseOverrides: [{ id: "ALN", status: "forced_open" }] },
      3,
    );
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ before: { status: "forced_open" }, after: { status: "inactive" } });
  });

  it("warns (non-blocking) when total capacity of the p highest-capacity warehouses is below total demand", () => {
    const csv = "template_version,id,city,state,capacity,status\n1,ALN,Allentown,PA,10,active\n1,ATL,Atlanta,GA,10,active\n1,BAL,Baltimore,MD,10,active\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/total capacity/i);
  });
});
