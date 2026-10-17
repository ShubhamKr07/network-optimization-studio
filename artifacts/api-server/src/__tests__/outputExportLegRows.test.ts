// SCU-2.R3 — exports must drop non-demand legs, matching the studio tabs.
// Fixtures are VERBATIM solve.py output (regenerate via the solve_* functions
// in solver/solve.py), not hand-authored rows.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildAssignmentRows, buildOpenWarehouseRows } from "../services/templates.js";
import type { ResultEnvelope } from "../solver/resultEnvelope.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "solveResults");
const load = (n: string) => JSON.parse(readFileSync(path.join(dir, `${n}.json`), "utf8")) as ResultEnvelope;

describe("output exports exclude non-demand legs (SCU-2.R3)", () => {
  it("JADE openWarehouses ids == metrics.openFacilityIds (no plant rows)", () => {
    const r = load("jade");
    const rows = buildOpenWarehouseRows(r, new Map());
    expect(rows.map(x => x.warehouseId).sort()).toEqual([...r.metrics.openFacilityIds!].sort());
  });

  it("gold-au assignments are only refinery_to_customer edges (no mine->refinery row)", () => {
    const r = load("gold-au");
    const expected = r.edges.filter(e => e.leg === "refinery_to_customer");
    expect(expected.length).toBeLessThan(r.edges.length);
    const rows = buildAssignmentRows(r, "mi");
    expect(rows.map(x => x.customerId)).toEqual(expected.map(e => e.toId));
    expect(rows).toHaveLength(10);
  });

  it("p-median-us (no legs) is unchanged: one row per edge, openWarehouses = distinct fromIds", () => {
    const r = load("p-median-us");
    expect(buildAssignmentRows(r, "mi")).toHaveLength(r.edges.length);
    expect(buildOpenWarehouseRows(r, new Map()).map(x => x.warehouseId).sort())
      .toEqual([...new Set(r.edges.map(e => e.fromId))].sort());
  });
});
