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
  // B4.2 — an unrecognized id no longer errors on its own (see the
  // "add-mode" describe block below); this now pins the case where an
  // unrecognized id is ALSO missing the coordinates add-mode requires.
  it("rejects an unrecognized warehouse id missing lat/lng as a logic error", () => {
    const csv = "template_version,id,city,state,lat,lng,capacity,status\n1,ZZZ,Nowhere,XX,,,,active\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/lat\/lng/i) }]);
  });

  it("customers: rejects a negative demand as a logic error", () => {
    const csv = "template_version,id,city,state,lat,lng,demand,status\n1,C1,Akron,OH,,,-5,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/non-negative/i) }]);
  });

  it("customers: rejects an invalid status as a logic error", () => {
    const csv = "template_version,id,city,state,lat,lng,demand,status\n1,C1,Akron,OH,,,1000,bogus\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/invalid status/i) }]);
  });

  it("produces no change when the imported row matches the current baseline exactly", () => {
    const csv = "template_version,id,city,state,lat,lng,capacity,status\n1,ALN,Allentown,PA,,,,active\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it("diffs against existing overrides, not just the raw baseline", () => {
    const csv = "template_version,id,city,state,lat,lng,capacity,status\n1,ALN,Allentown,PA,,,,inactive\n";
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
    const csv = "template_version,id,city,state,lat,lng,capacity,status\n1,ALN,Allentown,PA,,,10,active\n1,ATL,Atlanta,GA,,,10,active\n1,BAL,Baltimore,MD,,,10,active\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/total capacity/i);
  });
});

// B4.2 — add-mode: an unrecognized id for warehouses/customers is no longer
// automatically an error. It becomes an ADD-classified change (writes into
// scenario.inputs.addedWarehouses/addedCustomers on apply, not
// warehouseOverrides/customerOverrides) as long as it carries the extra
// data a brand-new entity needs (lat/lng, city/state) that an UPDATE row
// doesn't have to.
describe("parseAndValidateImport — add-mode (warehouses/customers)", () => {
  it("add-rows.csv: an unrecognized id with valid full data produces an ADD-classified change, not an error", () => {
    const result = parseAndValidateImport("warehouses", fixture("add-rows.csv"), NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "WH-NEW1",
      line: 2,
      before: { status: "not_present", value: null },
      after: { status: "active", value: 50000 },
      changeType: "add",
      city: "Newtown",
      state: "NC",
      lat: 35.5,
      lng: -80.2,
    }]);
  });

  it("add-missing-required-field.csv: missing lat/lng on an unrecognized id is a clear error, not a silent skip", () => {
    const result = parseAndValidateImport("warehouses", fixture("add-missing-required-field.csv"), NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 2 });
    expect(result.errors[0].message).toMatch(/lat\/lng/i);
    expect(result.changes).toEqual([]);
  });

  it("add-with-collision.csv: an id that's already a previously-added warehouse is rejected, not silently downgraded to an update", () => {
    const result = parseAndValidateImport(
      "warehouses",
      fixture("add-with-collision.csv"),
      { addedWarehouses: [{ id: "WH-NEW1" }] },
      3,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/already exists/i);
    expect(result.changes).toEqual([]);
  });

  it("an id that collides with an existing base-dataset warehouse is just a normal update, not add-mode", () => {
    const csv = "template_version,id,city,state,lat,lng,capacity,status\n1,ALN,Allentown,PA,,,500000,forced_open\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].changeType).toBeUndefined();
    expect(result.changes[0]).toMatchObject({ id: "ALN", after: { status: "forced_open", value: 500000 } });
  });

  it("customers: a valid add-candidate row produces an ADD-classified change", () => {
    const csv = "template_version,id,city,state,lat,lng,demand,status\n1,C-NEW1,Newtown,NC,35.5,-80.2,1200,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "C-NEW1",
      line: 2,
      before: { status: "not_present", value: null },
      after: { status: "active", value: 1200 },
      changeType: "add",
      city: "Newtown",
      state: "NC",
      lat: 35.5,
      lng: -80.2,
    }]);
  });

  it("customers: a blank demand on an add-candidate row is rejected (addedCustomerSchema requires demand, unlike an override)", () => {
    const csv = "template_version,id,city,state,lat,lng,demand,status\n1,C-NEW1,Newtown,NC,35.5,-80.2,,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/demand is required/i);
  });

  it("customers: an add-candidate row with status=excluded is rejected (v1 has no add-and-exclude)", () => {
    const csv = "template_version,id,city,state,lat,lng,demand,status\n1,C-NEW1,Newtown,NC,35.5,-80.2,1200,excluded\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/add-and-exclude/i);
  });

  it("customers: add-mode is p-median-us only — an unrecognized customer id for two-echelon-gold-au is still a plain 'unknown id' error", () => {
    const csv = "template_version,id,city,state,lat,lng,demand,status\n1,C-NEW1,Newtown,NC,35.5,-80.2,1200,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 0, "two-echelon-gold-au");
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/unknown id/i) }]);
  });

  it("refineries are still out of scope — an unrecognized id is a plain 'unknown id' error, not add-mode", () => {
    const csv = "template_version,id,city,state,status\n1,ZZ-NEW,Nowhere,XX,active\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/unknown id/i) }]);
  });
});

// Task 30 (B6.1 stage 4) — mines/stations join warehouses/customers'
// add-mode set. Same rules, transport-coal vocabulary: mines have no status
// field (never required, never checked) and capacity stays nullable/
// optional on an add-row (blank capacity means unconstrained — see
// solve.py's get_base_capacity), while stations require demand exactly like
// customers do.
describe("parseAndValidateImport — add-mode (mines/stations)", () => {
  it("mines: an unrecognized id with valid full data (including capacity) produces an ADD-classified change", () => {
    const csv = "template_version,id,city,state,lat,lng,capacity\n1,MN-NEW,Bristol,VA,36.6,-82.19,5000000\n";
    const result = parseAndValidateImport("mines", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "MN-NEW",
      line: 2,
      before: { status: "not_present", value: null },
      after: { status: "active", value: 5000000 },
      changeType: "add",
      city: "Bristol",
      state: "VA",
      lat: 36.6,
      lng: -82.19,
    }]);
  });

  it("mines: an unrecognized id with a BLANK capacity still produces an ADD-classified change — blank capacity means unconstrained, not an error", () => {
    const csv = "template_version,id,city,state,lat,lng,capacity\n1,MN-NEW,Bristol,VA,36.6,-82.19,\n";
    const result = parseAndValidateImport("mines", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "MN-NEW",
      line: 2,
      before: { status: "not_present", value: null },
      after: { status: "active", value: null },
      changeType: "add",
      city: "Bristol",
      state: "VA",
      lat: 36.6,
      lng: -82.19,
    }]);
  });

  it("mines: missing lat/lng on an unrecognized id is a clear error", () => {
    const csv = "template_version,id,city,state,lat,lng,capacity\n1,MN-NEW,Bristol,VA,,,5000000\n";
    const result = parseAndValidateImport("mines", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 2 });
    expect(result.errors[0].message).toMatch(/lat\/lng/i);
  });

  it("mines: an id that's already a previously-added mine is rejected, not silently downgraded to an update", () => {
    const csv = "template_version,id,city,state,lat,lng,capacity\n1,MN-NEW,Bristol,VA,36.6,-82.19,5000000\n";
    const result = parseAndValidateImport("mines", csv, { addedMines: [{ id: "MN-NEW" }] }, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/already exists/i);
  });

  it("mines: an id colliding with a real base-dataset mine is a normal capacity UPDATE, not add-mode", () => {
    const csv = "template_version,id,city,state,lat,lng,capacity\n1,KY,Pikeville,KY,,,1000000\n";
    const result = parseAndValidateImport("mines", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].changeType).toBeUndefined();
    expect(result.changes[0]).toMatchObject({ id: "KY", after: { value: 1000000 } });
  });

  it("stations: an unrecognized id with valid full data produces an ADD-classified change", () => {
    const csv = "template_version,id,city,state,lat,lng,demand\n1,ST-NEW,Newtown,NC,35.5,-80.2,900000\n";
    const result = parseAndValidateImport("stations", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "ST-NEW",
      line: 2,
      before: { status: "not_present", value: null },
      after: { status: "active", value: 900000 },
      changeType: "add",
      city: "Newtown",
      state: "NC",
      lat: 35.5,
      lng: -80.2,
    }]);
  });

  it("stations: a blank demand on an add-candidate row is rejected — demand is required, unlike mine capacity", () => {
    const csv = "template_version,id,city,state,lat,lng,demand\n1,ST-NEW,Newtown,NC,35.5,-80.2,\n";
    const result = parseAndValidateImport("stations", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/demand is required/i);
  });

  it("stations: missing city/state on an unrecognized id is a clear error", () => {
    const csv = "template_version,id,city,state,lat,lng,demand\n1,ST-NEW,,NC,35.5,-80.2,900000\n";
    const result = parseAndValidateImport("stations", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/city and state/i);
  });
});

// Task 30 (B6.1 stage 4) — laneCosts is composite-keyed (from_id,to_id),
// mirroring B4.1's distances entity test coverage exactly, transport-coal
// vocabulary (mine/station, cost).
describe("parseAndValidateImport — laneCosts (composite key)", () => {
  it("valid lane cost rows parse correctly as a real change", () => {
    const csv = "template_version,from_id,to_id,cost\n1,KY,CHI,123.4\n";
    const result = parseAndValidateImport("laneCosts", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "KY|CHI",
      line: 2,
      before: { status: "active", value: null },
      after: { status: "active", value: 123.4 },
      fromId: "KY",
      toId: "CHI",
    }]);
  });

  it("rejects a row with an unresolvable from_id (unknown mine) as a logic error", () => {
    const csv = "template_version,from_id,to_id,cost\n1,ZZZ,CHI,100\n";
    const result = parseAndValidateImport("laneCosts", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 2 });
    expect(result.errors[0].message).toMatch(/from_id/i);
  });

  it("rejects a row with an unresolvable to_id (unknown station) as a logic error", () => {
    const csv = "template_version,from_id,to_id,cost\n1,KY,ZZZ,100\n";
    const result = parseAndValidateImport("laneCosts", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 2 });
    expect(result.errors[0].message).toMatch(/to_id/i);
  });

  it("rejects a backwards row (from_id=a real station, to_id=a real mine), not silently accepted", () => {
    const csv = "template_version,from_id,to_id,cost\n1,CHI,KY,100\n";
    const result = parseAndValidateImport("laneCosts", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/from_id/i);
  });

  it("rejects a duplicate (from_id,to_id) pair within one file", () => {
    const csv = "template_version,from_id,to_id,cost\n1,KY,CHI,100\n1,KY,CHI,200\n";
    const result = parseAndValidateImport("laneCosts", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/duplicate/i);
    expect(result.changes).toHaveLength(1);
  });

  it("resolves a valid override against an added mine and added station, not just base dataset entities", () => {
    const csv = "template_version,from_id,to_id,cost\n1,MN-NEW,ST-NEW,55\n";
    const result = parseAndValidateImport(
      "laneCosts",
      csv,
      { addedMines: [{ id: "MN-NEW" }], addedStations: [{ id: "ST-NEW" }] },
      0,
    );
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ fromId: "MN-NEW", toId: "ST-NEW", after: { value: 55 } });
  });

  it("diffs against an existing laneCostOverrides entry, not just a null baseline", () => {
    const csv = "template_version,from_id,to_id,cost\n1,KY,CHI,999\n";
    const result = parseAndValidateImport(
      "laneCosts",
      csv,
      { laneCostOverrides: [{ fromId: "KY", toId: "CHI", cost: 111 }] },
      0,
    );
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ before: { value: 111 }, after: { value: 999 } });
  });

  it("rejects a non-positive cost as a logic error", () => {
    const csv = "template_version,from_id,to_id,cost\n1,KY,CHI,0\n";
    const result = parseAndValidateImport("laneCosts", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/positive/i) }]);
  });

  it("still enforces the shared header-check machinery (wrong columns -> single format error)", () => {
    const csv = "template_version,id,city,state,capacity\n1,KY,Pikeville,KY,1000000\n";
    const result = parseAndValidateImport("laneCosts", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("format");
  });
});

describe("parseAndValidateImport — refineries (no value column, status only)", () => {
  it("clean row: registers a status change, value is always null (refineries have no capacity/demand field)", () => {
    const csv = "template_version,id,city,state,status\n1,cunnamulla,Cunnamulla,QLD,forced_open\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "cunnamulla",
      line: 2,
      before: { status: "active", value: null },
      after: { status: "forced_open", value: null },
    }]);
  });

  it("rejects a row with a stray value column as a format error (wrong column count)", () => {
    const csv = "template_version,id,city,state,capacity,status\n1,cunnamulla,Cunnamulla,QLD,,forced_open\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("format");
  });

  it("rejects an unknown refinery id (the mine's own id is not importable — it's not a refinery)", () => {
    const csv = "template_version,id,city,state,status\n1,kalgoorlie,Kalgoorlie,WA,forced_open\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/unknown id/i) }]);
  });

  it("rejects an invalid status", () => {
    const csv = "template_version,id,city,state,status\n1,cunnamulla,Cunnamulla,QLD,bogus\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/invalid status/i) }]);
  });

  it("produces no change when the row matches the current baseline exactly", () => {
    const csv = "template_version,id,city,state,status\n1,cunnamulla,Cunnamulla,QLD,active\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.changes).toEqual([]);
  });

  it("diffs against an existing refineryOverrides entry, not just the raw baseline", () => {
    const csv = "template_version,id,city,state,status\n1,cunnamulla,Cunnamulla,QLD,inactive\n";
    const result = parseAndValidateImport("refineries", csv, { refineryOverrides: [{ id: "cunnamulla", status: "forced_open" }] }, 0);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ before: { status: "forced_open" }, after: { status: "inactive" } });
  });
});

describe("parseAndValidateImport — 'customers' entity disambiguated by modelId", () => {
  it("modelId two-echelon-gold-au validates against the 10-row gold dataset, not p-median's 200", () => {
    const csv = "template_version,id,city,state,lat,lng,demand,status\n1,sydney,Sydney,NSW,,,1,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 0, "two-echelon-gold-au");
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{ id: "sydney", line: 2, before: { status: "active", value: 500000 }, after: { status: "active", value: 1 } }]);
  });

  // B4.2 — defaults to p-median-us's dataset when modelId is omitted, so
  // "sydney" (unknown to the 200-row p-median dataset) now hits add-mode
  // instead of a plain error; with valid coordinates supplied it's
  // classified as an ADD, which itself proves the dataset resolved to
  // p-median-us and not the gold dataset (where "sydney" is a real id and
  // this same row would have produced a value-500000 UPDATE instead, per
  // the test above).
  it("defaults to p-median-us's dataset when modelId is omitted — a gold customer id is genuinely unknown there, so it's an ADD candidate", () => {
    const csv = "template_version,id,city,state,lat,lng,demand,status\n1,sydney,Sydney,NSW,35.5,-80.2,1,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "sydney",
      line: 2,
      before: { status: "not_present", value: null },
      after: { status: "active", value: 1 },
      changeType: "add",
      city: "Sydney",
      state: "NSW",
      lat: 35.5,
      lng: -80.2,
    }]);
  });
});

// B4.1 — distances is composite-keyed (from_id,to_id), not single-id like
// every other entity: real base ids ALN (warehouse) and C1 (customer) are
// used directly rather than a fixture file, since "unknown" here means
// reference-integrity against the id spaces (base + added), not a status
// baseline diff.
describe("parseAndValidateImport — distances (composite key, DD-2 long format)", () => {
  it("valid distance rows parse correctly as a real change", () => {
    const csv = "template_version,from_id,to_id,distance\n1,ALN,C1,123.4\n";
    const result = parseAndValidateImport("distances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "ALN|C1",
      line: 2,
      before: { status: "active", value: null },
      after: { status: "active", value: 123.4 },
      fromId: "ALN",
      toId: "C1",
    }]);
  });

  it("rejects a row with an unresolvable from_id (unknown warehouse) as a logic error", () => {
    const csv = "template_version,from_id,to_id,distance\n1,ZZZ,C1,100\n";
    const result = parseAndValidateImport("distances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 2 });
    expect(result.errors[0].message).toMatch(/from_id/i);
    expect(result.changes).toEqual([]);
  });

  it("rejects a row with an unresolvable to_id (unknown customer) as a logic error", () => {
    const csv = "template_version,from_id,to_id,distance\n1,ALN,ZZZ,100\n";
    const result = parseAndValidateImport("distances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 2 });
    expect(result.errors[0].message).toMatch(/to_id/i);
    expect(result.changes).toEqual([]);
  });

  it("rejects a backwards row (from_id=a real customer, to_id=a real warehouse), not silently accepted", () => {
    const csv = "template_version,from_id,to_id,distance\n1,C1,ALN,100\n";
    const result = parseAndValidateImport("distances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/from_id/i);
    expect(result.changes).toEqual([]);
  });

  it("rejects a duplicate (from_id,to_id) pair within one file — first occurrence still registers as a change", () => {
    const csv = "template_version,from_id,to_id,distance\n1,ALN,C1,100\n1,ALN,C1,200\n";
    const result = parseAndValidateImport("distances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 3 });
    expect(result.errors[0].message).toMatch(/duplicate/i);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ fromId: "ALN", toId: "C1", after: { value: 100 } });
  });

  it("resolves a valid override against an added warehouse and added customer, not just base dataset entities", () => {
    const csv = "template_version,from_id,to_id,distance\n1,WH-NEW,CUST-NEW,55\n";
    const result = parseAndValidateImport(
      "distances",
      csv,
      { addedWarehouses: [{ id: "WH-NEW" }], addedCustomers: [{ id: "CUST-NEW" }] },
      0,
    );
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ fromId: "WH-NEW", toId: "CUST-NEW", after: { value: 55 } });
  });

  it("diffs against an existing distanceOverrides entry, not just a null baseline", () => {
    const csv = "template_version,from_id,to_id,distance\n1,ALN,C1,999\n";
    const result = parseAndValidateImport(
      "distances",
      csv,
      { distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 111 }] },
      0,
    );
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ before: { value: 111 }, after: { value: 999 } });
  });

  it("produces no change when the row matches an existing override exactly", () => {
    const csv = "template_version,from_id,to_id,distance\n1,ALN,C1,111\n";
    const result = parseAndValidateImport(
      "distances",
      csv,
      { distanceOverrides: [{ fromId: "ALN", toId: "C1", distance: 111 }] },
      0,
    );
    expect(result.changes).toEqual([]);
  });

  it("rejects a non-positive distance as a logic error", () => {
    const csv = "template_version,from_id,to_id,distance\n1,ALN,C1,0\n";
    const result = parseAndValidateImport("distances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/positive/i) }]);
  });

  it("still enforces the shared header-check machinery (wrong columns -> single format error)", () => {
    const csv = "template_version,id,city,state,capacity,status\n1,ALN,Allentown,PA,,active\n";
    const result = parseAndValidateImport("distances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("format");
    expect(result.changes).toEqual([]);
  });

  it("still enforces the shared bad-encoding format check", () => {
    const csv = "template_version,from_id,to_id,distance\n1,ALN,C1,�100\n";
    const result = parseAndValidateImport("distances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("format");
  });

  it("still enforces the shared template_version mismatch check", () => {
    const csv = "template_version,from_id,to_id,distance\n2,ALN,C1,100\n";
    const result = parseAndValidateImport("distances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/template_version/) }]);
  });
});
