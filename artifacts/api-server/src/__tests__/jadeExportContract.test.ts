// DU-4.2 — contract test for the two JADE export grids' own v4 envelopes
// (Q6). Rows come from the PRODUCTION builders over a verbatim solve.py JADE
// result (fixtures/solveResults/jade.json), never a hand-built row; the
// envelope is validated against the regenerated zod `ExportScenarioResponse`
// and pinned to the CONSTANTS, never a literal copy of their current value
// (a hardcoded 4 is how CH4O's emitter drifted off its published contract).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ExportScenarioResponse } from "@workspace/api-zod";
import { bandRangeLabelForDistance } from "@workspace/units";
import {
  JADE_EXPORT_TEMPLATE_VERSION,
  OUTPUT_TEMPLATE_VERSION,
  buildJadeAssignmentRows,
  buildJadeFlowRows,
  buildAssignmentRows,
  buildFlowRows,
  toJadeAssignmentJsonRow,
  toJadeFlowJsonRow,
  jadeAssignmentRowsToCsv,
  jadeFlowRowsToCsv,
} from "../services/templates.js";
import type { ResultEnvelope } from "../solver/resultEnvelope.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "solveResults");
const load = (n: string) => JSON.parse(readFileSync(path.join(dir, `${n}.json`), "utf8")) as ResultEnvelope;

const jade = load("jade");
const bands = [200, 400, 800, 1600];
const inbound = [300, 900]; // distinct from `bands` so the per-leg lens is observable
const lens = { distanceBands: bands, inboundDistanceBands: inbound };

const envelope = (entity: "assignments" | "flows", unit: "mi" | "km", rows: unknown[], templateVersion: number = JADE_EXPORT_TEMPLATE_VERSION) =>
  ({ templateVersion, entity, unit, rows });

describe("JADE export v4 envelopes (DU-4.2)", () => {
  const aRows = buildJadeAssignmentRows(jade, "mi", bands, "mi");
  const fRows = buildJadeFlowRows(jade, lens, "mi", "mi");

  it("the fixture yields populated rows for both grids", () => {
    expect(aRows.length).toBeGreaterThan(0);
    expect(fRows.some(r => r.leg === "plant_to_warehouse")).toBe(true);
    expect(fRows.some(r => r.leg === "warehouse_to_customer")).toBe(true);
  });

  it("every row of both grids is stamped JADE_EXPORT_TEMPLATE_VERSION, and it differs from the shared output version", () => {
    for (const r of [...aRows, ...fRows]) expect(r.templateVersion).toBe(JADE_EXPORT_TEMPLATE_VERSION);
    expect(JADE_EXPORT_TEMPLATE_VERSION).not.toBe(OUTPUT_TEMPLATE_VERSION);
  });

  it("the builders' JSON envelopes parse against ExportEnvelope", () => {
    expect(ExportScenarioResponse.safeParse(envelope("assignments", "mi", aRows.map(toJadeAssignmentJsonRow))).success).toBe(true);
    expect(ExportScenarioResponse.safeParse(envelope("flows", "mi", fRows.map(toJadeFlowJsonRow))).success).toBe(true);
  });

  it("an empty JADE envelope is accepted at v4 and a generic empty envelope at v3 — version discriminates when rows are empty", () => {
    expect(ExportScenarioResponse.safeParse(envelope("assignments", "mi", [])).success).toBe(true);
    expect(ExportScenarioResponse.safeParse(envelope("flows", "km", [])).success).toBe(true);
    expect(ExportScenarioResponse.safeParse(envelope("assignments", "mi", [], OUTPUT_TEMPLATE_VERSION)).success).toBe(true);
    // Neither family admits a version it does not own.
    expect(ExportScenarioResponse.safeParse(envelope("flows", "mi", [], JADE_EXPORT_TEMPLATE_VERSION + 1)).success).toBe(false);
  });

  it("a generic-version envelope carrying a JADE row is rejected, a generic row at the generic version still parses", () => {
    // Deliberately negative: JADE's string `band` is not a generic row's integer index.
    expect(ExportScenarioResponse.safeParse(envelope("assignments", "mi", [toJadeAssignmentJsonRow(aRows[0])], OUTPUT_TEMPLATE_VERSION)).success).toBe(false);
    expect(ExportScenarioResponse.safeParse(envelope("flows", "mi", [toJadeFlowJsonRow(fRows[0])], OUTPUT_TEMPLATE_VERSION)).success).toBe(false);
    // ...and a v4 envelope with a generic (integer-band) row is rejected the other way.
    const gA = buildAssignmentRows(jade, "mi", "mi", bands);
    expect(gA.length).toBeGreaterThan(0);
    expect(ExportScenarioResponse.safeParse(envelope("assignments", "mi", gA.map(({ templateVersion: _t, distanceUnit: _u, ...r }) => r))).success).toBe(false);
    const gF = buildFlowRows(jade, "mi", "mi", lens);
    const okGeneric = ExportScenarioResponse.safeParse(
      envelope("flows", "mi", gF.map(({ templateVersion: _t, distanceUnit: _u, ...r }) => r), OUTPUT_TEMPLATE_VERSION),
    );
    expect(okGeneric.success).toBe(true);
  });

  it("assignment `band` equals bandRangeLabelForDistance on the CANONICAL distance", () => {
    const raw = (jade.details.assignments as { distanceMi: number }[]);
    expect(aRows).toHaveLength(raw.length);
    aRows.forEach((r, i) => expect(r.band).toBe(bandRangeLabelForDistance(raw[i].distanceMi, bands, "mi", "mi")));
  });

  it("flow `band` is classified against each leg's own band set", () => {
    const pw = fRows.filter(r => r.leg === "plant_to_warehouse");
    const wc = fRows.filter(r => r.leg === "warehouse_to_customer");
    pw.forEach(r => expect(r.band).toBe(bandRangeLabelForDistance(r.distance, inbound, "mi", "mi")));
    wc.forEach(r => expect(r.band).toBe(bandRangeLabelForDistance(r.distance, bands, "mi", "mi")));
  });

  it("no JSON row or CSV line contains 'Band N' or 'Overflow'", () => {
    const text = JSON.stringify([...aRows, ...fRows]) + jadeAssignmentRowsToCsv(aRows) + jadeFlowRowsToCsv(fRows);
    expect(text).not.toMatch(/Band \d|Overflow/);
    expect(text).toMatch(/≤|>/);
  });

  it("unit=km renders the label's boundaries in km while classification stays canonical", () => {
    const kmA = buildJadeAssignmentRows(jade, "mi", bands, "km");
    const kmF = buildJadeFlowRows(jade, lens, "mi", "km");
    const raw = (jade.details.assignments as { distanceMi: number }[]);
    kmA.forEach((r, i) => {
      expect(r.band).toBe(bandRangeLabelForDistance(raw[i].distanceMi, bands, "mi", "km"));
      expect(r.band.endsWith(" km")).toBe(true);
    });
    expect(kmA.some((r, i) => r.band !== aRows[i].band)).toBe(true);
    expect(kmF.every(r => r.band.endsWith(" km"))).toBe(true);
    expect(ExportScenarioResponse.safeParse(envelope("assignments", "km", kmA.map(toJadeAssignmentJsonRow))).success).toBe(true);
    expect(ExportScenarioResponse.safeParse(envelope("flows", "km", kmF.map(toJadeFlowJsonRow))).success).toBe(true);
  });
});

describe("non-JADE exports are byte-identical (DU-4.2 Q6/Q7)", () => {
  it("p-median assignments and gold flows stay on the shared output version with numeric band indices", () => {
    const pm = buildAssignmentRows(load("p-median-us"), "mi", "mi", bands);
    expect(pm.length).toBeGreaterThan(0);
    for (const r of pm) {
      expect(r.templateVersion).toBe(OUTPUT_TEMPLATE_VERSION);
      expect(typeof r.band).toBe("number");
    }
    const gold = buildFlowRows(load("gold-au"), "mi", "mi", { distanceBands: bands });
    expect(gold.length).toBeGreaterThan(0);
    for (const r of gold) {
      expect(r.templateVersion).toBe(OUTPUT_TEMPLATE_VERSION);
      expect(typeof r.band).toBe("number");
    }
  });
});
