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
  // T11 — a blank id (not an unrecognized non-blank id, see the "add-mode"
  // describe block below for why this changed) is the ADD trigger now; this
  // still pins the case where an ADD row is ALSO missing the coordinates
  // add-mode requires.
  it("rejects a blank-id add row missing lat/lng as a logic error", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,,ZZZ,Nowhere,XX,,,,active\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/lat\/lng/i) }]);
  });

  it("customers: rejects a negative demand as a logic error", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,C1,,Akron,OH,,,-5,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/non-negative/i) }]);
  });

  it("customers: rejects an invalid status as a logic error", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,C1,,Akron,OH,,,1000,bogus\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/invalid status/i) }]);
  });

  it("produces no change when the imported row matches the current baseline exactly", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,ALN,,Allentown,PA,,,,active\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it("diffs against existing overrides, not just the raw baseline", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,ALN,,Allentown,PA,,,,inactive\n";
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
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,ALN,,Allentown,PA,,,10,active\n1,ATL,,Atlanta,GA,,,10,active\n1,BAL,,Baltimore,MD,,,10,active\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/total capacity/i);
  });
});

// B4.2 — add-mode: a blank id for warehouses/customers is no longer
// automatically an error. It becomes an ADD-classified change (writes into
// scenario.inputs.addedWarehouses/addedCustomers on apply, not
// warehouseOverrides/customerOverrides) as long as it carries the extra
// data a brand-new entity needs (lat/lng, city/state) that an UPDATE row
// doesn't have to.
// T11 — the ADD trigger changed from "unrecognized non-blank id" to "blank
// id": added-entity ids are opaque server-minted uids now (aw-<uuid>/
// ac-<uuid>), so a human can no longer author one at all — the server mints
// a fresh one on every ADD row, and `id` on the resulting change is that
// minted uid, not the CSV's own typed value (which now belongs in the
// display_code column instead). A non-blank id that doesn't resolve as
// either a base or an already-added entity is now a hard "Unknown id"
// error, not an implicit add.
describe("parseAndValidateImport — add-mode (warehouses/customers)", () => {
  it("add-rows.csv: a blank id with valid full data produces an ADD-classified change with a minted uid, not an error", () => {
    const result = parseAndValidateImport("warehouses", fixture("add-rows.csv"), NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      id: expect.stringMatching(/^aw-/),
      line: 2,
      before: { status: "not_present", value: null },
      after: { status: "active", value: 50000 },
      changeType: "add",
      city: "Newtown",
      state: "NC",
      lat: 35.5,
      lng: -80.2,
      displayCode: "WH-NEW1",
    });
  });

  it("add-missing-required-field.csv: missing lat/lng on a blank-id add row is a clear error, not a silent skip", () => {
    const result = parseAndValidateImport("warehouses", fixture("add-missing-required-field.csv"), NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 2 });
    expect(result.errors[0].message).toMatch(/lat\/lng/i);
    expect(result.changes).toEqual([]);
  });

  it("add-with-collision.csv: a displayCode that already belongs to a previously-added warehouse is rejected", () => {
    const result = parseAndValidateImport(
      "warehouses",
      fixture("add-with-collision.csv"), // blank id, display_code "WH-NEW1"
      { addedWarehouses: [{ id: "aw-existing", displayCode: "WH-NEW1" }] },
      3,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/already in use/i);
    expect(result.changes).toEqual([]);
  });

  it("a blank displayCode never collides, even against an existing added warehouse with no displayCode", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,,,Newtown,NC,35.5,-80.2,50000,active\n";
    const result = parseAndValidateImport("warehouses", csv, { addedWarehouses: [{ id: "aw-existing" }] }, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].changeType).toBe("add");
    expect(result.changes[0].displayCode).toBeUndefined();
  });

  it("two blank-displayCode add rows in the same file are never flagged as duplicates of each other", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n"
      + "1,,,Newtown,NC,35.5,-80.2,50000,active\n"
      + "1,,,Oldtown,SC,36.1,-81.3,60000,active\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(2);
    // Every minted uid is unique.
    expect(new Set(result.changes.map(c => c.id)).size).toBe(2);
  });

  it("an id that collides with an existing base-dataset warehouse is just a normal update, not add-mode", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,ALN,,Allentown,PA,,,500000,forced_open\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].changeType).toBeUndefined();
    expect(result.changes[0]).toMatchObject({ id: "ALN", after: { status: "forced_open", value: 500000 } });
  });

  it("a non-blank id that resolves as neither a base nor an already-added warehouse is a hard 'Unknown id' error, not an implicit add", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,some-typo,,Newtown,NC,35.5,-80.2,50000,active\n";
    const result = parseAndValidateImport("warehouses", csv, NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/unknown id/i);
    expect(result.errors[0].message).toMatch(/leave the id column blank/i);
    expect(result.changes).toEqual([]);
  });

  it("an id matching an already-added warehouse's uid is an update_added change, diffed against its own current capacity/status", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,aw-existing,,Newtown,NC,35.5,-80.2,75000,forced_open\n";
    const result = parseAndValidateImport(
      "warehouses",
      csv,
      { addedWarehouses: [{ id: "aw-existing", displayCode: "WH-NC-NEWTOWN-01", capacity: 50000, status: "active" }] },
      3,
    );
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "aw-existing",
      line: 2,
      before: { status: "active", value: 50000 },
      after: { status: "forced_open", value: 75000 },
      changeType: "update_added",
      displayCode: "WH-NC-NEWTOWN-01",
    }]);
  });

  it("an update_added row that matches the added entity's current capacity/status exactly produces no change", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,aw-existing,,Newtown,NC,35.5,-80.2,50000,active\n";
    const result = parseAndValidateImport(
      "warehouses",
      csv,
      { addedWarehouses: [{ id: "aw-existing", capacity: 50000, status: "active" }] },
      3,
    );
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it("customers: a blank-id add-candidate row produces an ADD-classified change with a minted uid", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,,CS-NEW1,Newtown,NC,35.5,-80.2,1200,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      id: expect.stringMatching(/^ac-/),
      line: 2,
      before: { status: "not_present", value: null },
      after: { status: "active", value: 1200 },
      changeType: "add",
      city: "Newtown",
      state: "NC",
      lat: 35.5,
      lng: -80.2,
      displayCode: "CS-NEW1",
    });
  });

  it("customers: a blank demand on an add-candidate row is rejected (addedCustomerSchema requires demand, unlike an override)", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,,CS-NEW1,Newtown,NC,35.5,-80.2,,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/demand is required/i);
  });

  it("customers: an add-candidate row with status=excluded is rejected (v1 has no add-and-exclude)", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,,CS-NEW1,Newtown,NC,35.5,-80.2,1200,excluded\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/add-and-exclude/i);
  });

  it("customers: an update_added row with a non-active status is rejected, same as an add row", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,ac-existing,,Newtown,NC,35.5,-80.2,1200,excluded\n";
    const result = parseAndValidateImport(
      "customers",
      csv,
      { addedCustomers: [{ id: "ac-existing", demand: 900 }] },
      3,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/add-and-exclude/i);
  });

  // T11 (multi-model expansion) — two-echelon-gold-au's addedCustomers field
  // (twoEchelon.ts, B6.2+T11) means add-mode is no longer p-median-us-only;
  // a blank id there is now a real ADD candidate, same as p-median-us.
  it("customers: add-mode also works for two-echelon-gold-au (its own addedCustomers/displayCode field)", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,,CS-NEW1,Newtown,NC,35.5,-80.2,1200,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 0, "two-echelon-gold-au");
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ id: expect.stringMatching(/^ac-/), changeType: "add", displayCode: "CS-NEW1" });
  });

  // T11 (multi-model expansion) — refineries joins the uid+displayCode
  // add-mode set: WarehousesTab.tsx (reused for entity="refineries" per
  // B6.2) already mints uid+displayCode client-side; this brings the
  // backend CSV path in line.
  it("refineries: a blank-id add-candidate row produces an ADD-classified change with a minted uid (aw- prefix, reusing WarehousesTab.tsx's own kind)", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,status\n1,,REF-NEW1,Newtown,WA,35.5,-80.2,active\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: expect.stringMatching(/^aw-/),
      line: 2,
      before: { status: "not_present", value: null },
      after: { status: "active", value: null },
      changeType: "add",
      city: "Newtown",
      state: "WA",
      lat: 35.5,
      lng: -80.2,
      displayCode: "REF-NEW1",
    }]);
  });

  it("refineries: missing lat/lng on a blank-id add row is a clear error", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,status\n1,,REF-NEW1,Newtown,WA,,,active\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 2 });
    expect(result.errors[0].message).toMatch(/lat\/lng/i);
  });

  it("refineries: a displayCode that already belongs to a previously-added refinery is rejected", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,status\n1,,REF-NEW1,Newtown,WA,35.5,-80.2,active\n";
    const result = parseAndValidateImport("refineries", csv, { addedRefineries: [{ id: "aw-existing", displayCode: "REF-NEW1" }] }, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/already in use/i);
  });

  it("refineries: an id matching an already-added refinery's uid is an update_added change, status only (no value concept)", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,status\n1,aw-existing,,Newtown,WA,35.5,-80.2,forced_open\n";
    const result = parseAndValidateImport(
      "refineries",
      csv,
      { addedRefineries: [{ id: "aw-existing", displayCode: "REF-NEW1", status: "active" }] },
      0,
    );
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "aw-existing",
      line: 2,
      before: { status: "active", value: null },
      after: { status: "forced_open", value: null },
      changeType: "update_added",
      displayCode: "REF-NEW1",
    }]);
  });

  it("refineries: a non-blank id that resolves as neither a base nor an already-added refinery is a hard 'Unknown id' error, not an implicit add", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,status\n1,ZZ-NEW,,Nowhere,XX,35.5,-80.2,active\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/unknown id/i);
    expect(result.errors[0].message).toMatch(/leave the id column blank/i);
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

// T11 (multi-model expansion) — refineries gained display_code + lat/lng
// columns (COLUMNS.refineries), matching warehouses/customers' own T11
// column shape. Base-row updates (id = an existing refinery, e.g.
// "cunnamulla") leave display_code/lat/lng blank — same convention
// warehouses/customers already established (only ADD rows need them).
describe("parseAndValidateImport — refineries (no value column, status only)", () => {
  it("clean row: registers a status change, value is always null (refineries have no capacity/demand field)", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,status\n1,cunnamulla,,Cunnamulla,QLD,,,forced_open\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "cunnamulla",
      line: 2,
      before: { status: "active", value: null },
      after: { status: "forced_open", value: null },
    }]);
  });

  it("rejects a row with a stray extra column as a format error (wrong column count)", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,capacity,status\n1,cunnamulla,,Cunnamulla,QLD,,,,forced_open\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("format");
  });

  it("rejects an unknown refinery id (the mine's own id is not importable — it's not a refinery)", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,status\n1,kalgoorlie,,Kalgoorlie,WA,,,forced_open\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
    expect(result.errors[0].message).toMatch(/unknown id/i);
  });

  it("rejects an invalid status", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,status\n1,cunnamulla,,Cunnamulla,QLD,,,bogus\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/invalid status/i) }]);
  });

  it("produces no change when the row matches the current baseline exactly", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,status\n1,cunnamulla,,Cunnamulla,QLD,,,active\n";
    const result = parseAndValidateImport("refineries", csv, NO_OVERRIDES, 0);
    expect(result.changes).toEqual([]);
  });

  it("diffs against an existing refineryOverrides entry, not just the raw baseline", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,status\n1,cunnamulla,,Cunnamulla,QLD,,,inactive\n";
    const result = parseAndValidateImport("refineries", csv, { refineryOverrides: [{ id: "cunnamulla", status: "forced_open" }] }, 0);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ before: { status: "forced_open" }, after: { status: "inactive" } });
  });
});

describe("parseAndValidateImport — 'customers' entity disambiguated by modelId", () => {
  it("modelId two-echelon-gold-au validates against the 10-row gold dataset, not p-median's 200", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,sydney,,Sydney,NSW,,,1,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 0, "two-echelon-gold-au");
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{ id: "sydney", line: 2, before: { status: "active", value: 500000 }, after: { status: "active", value: 1 } }]);
  });

  // T11 — defaults to p-median-us's dataset when modelId is omitted, so a
  // blank-id row (unknown to the 200-row p-median dataset by construction —
  // blank never matches anything) now hits add-mode instead of a plain
  // error; with valid coordinates supplied it's classified as an ADD, which
  // itself proves the dataset resolved to p-median-us and not the gold
  // dataset (where "sydney" is a real id and a non-blank "sydney" row would
  // have produced a value-500000 UPDATE instead, per the test above).
  it("defaults to p-median-us's dataset when modelId is omitted — add-mode is reachable there (unlike two-echelon-gold-au, where it's disabled)", () => {
    const csv = "template_version,id,display_code,city,state,lat,lng,demand,status\n1,,sydney,Sydney,NSW,35.5,-80.2,1,active\n";
    const result = parseAndValidateImport("customers", csv, NO_OVERRIDES, 3);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      id: expect.stringMatching(/^ac-/),
      line: 2,
      before: { status: "not_present", value: null },
      after: { status: "active", value: 1 },
      changeType: "add",
      city: "Sydney",
      state: "NSW",
      lat: 35.5,
      lng: -80.2,
      displayCode: "sydney",
    });
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

// B6.2 stage 4 — legDistances is two-echelon-gold-au's own composite-keyed
// entity (from_id,to_id), the exact same DISTANCES_COLUMNS header as the
// distances entity above but validated against THREE id spaces (mine/
// refinery/customer), not two — real base ids kalgoorlie (mine), cunnamulla/
// daggar-hills (refineries), sydney (customer) are used directly, same
// convention the distances describe block above already establishes.
describe("parseAndValidateImport — legDistances (composite key, three id spaces)", () => {
  it("valid mine->refinery rows parse correctly as a real change", () => {
    const csv = "template_version,from_id,to_id,distance\n1,kalgoorlie,cunnamulla,1464.5\n";
    const result = parseAndValidateImport("legDistances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([]);
    expect(result.changes).toEqual([{
      id: "kalgoorlie|cunnamulla",
      line: 2,
      before: { status: "active", value: null },
      after: { status: "active", value: 1464.5 },
      fromId: "kalgoorlie",
      toId: "cunnamulla",
    }]);
  });

  it("valid refinery->customer rows parse correctly as a real change", () => {
    const csv = "template_version,from_id,to_id,distance\n1,cunnamulla,sydney,610.5\n";
    const result = parseAndValidateImport("legDistances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ fromId: "cunnamulla", toId: "sydney", after: { value: 610.5 } });
  });

  it("rejects a pair that skips a leg entirely (mine -> customer directly)", () => {
    const csv = "template_version,from_id,to_id,distance\n1,kalgoorlie,sydney,999\n";
    const result = parseAndValidateImport("legDistances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ errorClass: "logic", line: 2 });
    expect(result.errors[0].message).toMatch(/does not resolve as a mine->refinery leg or a refinery->customer leg/);
  });

  it("rejects a backwards row (from_id=a real customer, to_id=a real refinery)", () => {
    const csv = "template_version,from_id,to_id,distance\n1,sydney,cunnamulla,999\n";
    const result = parseAndValidateImport("legDistances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
  });

  it("rejects a row with an unresolvable from_id", () => {
    const csv = "template_version,from_id,to_id,distance\n1,ZZZ,sydney,100\n";
    const result = parseAndValidateImport("legDistances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("logic");
  });

  it("rejects a duplicate (from_id,to_id) pair within one file", () => {
    const csv = "template_version,from_id,to_id,distance\n1,kalgoorlie,cunnamulla,100\n1,kalgoorlie,cunnamulla,200\n";
    const result = parseAndValidateImport("legDistances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/duplicate/i);
    expect(result.changes).toHaveLength(1);
  });

  it("resolves a valid override against an added refinery and added customer, not just base dataset entities", () => {
    const csv = "template_version,from_id,to_id,distance\n1,ref-new,cust-new,55\n";
    const result = parseAndValidateImport(
      "legDistances",
      csv,
      { addedRefineries: [{ id: "ref-new" }], addedCustomers: [{ id: "cust-new" }] },
      0,
    );
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ fromId: "ref-new", toId: "cust-new", after: { value: 55 } });
  });

  it("resolves a valid override against the real mine and an added refinery", () => {
    const csv = "template_version,from_id,to_id,distance\n1,kalgoorlie,ref-new,42\n";
    const result = parseAndValidateImport(
      "legDistances",
      csv,
      { addedRefineries: [{ id: "ref-new" }] },
      0,
    );
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);
  });

  it("diffs against an existing distanceOverrides entry, not just a null baseline", () => {
    const csv = "template_version,from_id,to_id,distance\n1,cunnamulla,sydney,999\n";
    const result = parseAndValidateImport(
      "legDistances",
      csv,
      { distanceOverrides: [{ fromId: "cunnamulla", toId: "sydney", distance: 610.5 }] },
      0,
    );
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ before: { value: 610.5 }, after: { value: 999 } });
  });

  it("rejects a non-positive distance as a logic error", () => {
    const csv = "template_version,from_id,to_id,distance\n1,cunnamulla,sydney,0\n";
    const result = parseAndValidateImport("legDistances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/positive/i) }]);
  });

  it("still enforces the shared header-check machinery (wrong columns -> single format error)", () => {
    const csv = "template_version,id,city,state,status\n1,cunnamulla,Cunnamulla,QLD,active\n";
    const result = parseAndValidateImport("legDistances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errorClass).toBe("format");
  });

  it("still enforces the shared template_version mismatch check", () => {
    const csv = "template_version,from_id,to_id,distance\n2,kalgoorlie,cunnamulla,100\n";
    const result = parseAndValidateImport("legDistances", csv, NO_OVERRIDES, 0);
    expect(result.errors).toEqual([{ errorClass: "logic", line: 2, message: expect.stringMatching(/template_version/) }]);
  });
});
