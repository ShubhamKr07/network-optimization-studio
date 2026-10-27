// DU-4.3 — contract test for the Service Stats grid's own v4 envelope (Q9).
// Rows come from the PRODUCTION builder over verbatim solve.py results
// (fixtures/solveResults), never a hand-built row; the envelope is validated
// against the regenerated zod `ExportScenarioResponse` and pinned to the
// CONSTANT, never a literal copy of its current value. Populated rows of both
// sections are required: an empty `rows` satisfies every row schema ever written.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ExportScenarioResponse } from "@workspace/api-zod";
import { computeCumulativeBandCoverage, serviceEdgesFor, OVERFLOW_BAND } from "@workspace/units";
import {
  SERVICE_STATS_TEMPLATE_VERSION,
  OUTPUT_TEMPLATE_VERSION,
  buildServiceStatsRows,
  serviceStatsRowsToCsv,
  toServiceStatsJsonRow,
} from "../services/templates.js";
import type { ResultEnvelope } from "../solver/resultEnvelope.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "solveResults");
const load = (n: string) => JSON.parse(readFileSync(path.join(dir, `${n}.json`), "utf8")) as ResultEnvelope;

const jade = load("jade");
const gold = load("gold-au");
const pmedian = load("p-median-us");
const bands = [200, 400, 800, 1600];
const inboundBands = [300, 900]; // distinct from `bands` so the per-leg lens is observable
const lens = { distanceBands: bands, inboundDistanceBands: inboundBands };
const envelope = (rows: unknown[], unit: "mi" | "km" = "mi", templateVersion: number = SERVICE_STATS_TEMPLATE_VERSION) =>
  ({ templateVersion, entity: "serviceStats", unit, rows });

describe("Service Stats export v4 (DU-4.3)", () => {
  const rows = buildServiceStatsRows(jade, "mi", "mi", lens, "two-echelon-jade-us");
  const outbound = rows.filter(r => r.section === "outbound");
  const inbound = rows.filter(r => r.section === "inbound");

  it("the fixture yields populated rows of both sections", () => {
    expect(outbound.length).toBeGreaterThan(0);
    expect(inbound.length).toBeGreaterThan(0);
  });

  it("every row carries SERVICE_STATS_TEMPLATE_VERSION, which differs from the shared output version", () => {
    for (const r of rows) expect(r.templateVersion).toBe(SERVICE_STATS_TEMPLATE_VERSION);
    expect(SERVICE_STATS_TEMPLATE_VERSION).not.toBe(OUTPUT_TEMPLATE_VERSION);
  });

  it("outbound rows are value-identical to the pre-change computation (cumulative, outbound legs, saved bands)", () => {
    const before = computeCumulativeBandCoverage(serviceEdgesFor(jade.edges), bands);
    expect(outbound.map(r => ({ band: r.band, percent: r.percent }))).toEqual(before);
    for (const r of outbound) expect(r.flow).toBeNull();
  });

  it("inbound rows are exclusive, classified on the inbound set, and their flow sums to the total inbound flow", () => {
    const total = jade.edges.filter(e => e.leg === "plant_to_warehouse").reduce((s, e) => s + e.flow, 0);
    expect(inbound.map(r => r.band)).toEqual([...inboundBands, OVERFLOW_BAND]);
    expect(inbound.reduce((s, r) => s + (r.flow ?? 0), 0)).toBeCloseTo(total, 3);
    expect(Math.round(inbound.reduce((s, r) => s + r.percent, 0))).toBe(100);
  });

  it("gold (mine_to_refinery) also gets inbound rows; a p-median result has outbound rows only", () => {
    expect(buildServiceStatsRows(gold, "mi", "mi", lens, "two-echelon-gold-au").some(r => r.section === "inbound")).toBe(true);
    const pm = buildServiceStatsRows(pmedian, "mi", "mi", lens, "p-median-us");
    expect(pm.length).toBeGreaterThan(0);
    expect(pm.every(r => r.section === "outbound")).toBe(true);
  });

  it("unit=km converts the inbound boundaries but never the overflow sentinel", () => {
    const km = buildServiceStatsRows(jade, "mi", "km", lens, "two-echelon-jade-us").filter(r => r.section === "inbound");
    expect(km[0].band).toBeCloseTo(300 * 1.609344, 3);
    expect(km[km.length - 1].band).toBe(OVERFLOW_BAND);
  });

  it("the builder's JSON envelope parses against ExportEnvelope, with a populated row of each section", () => {
    const json = rows.map(toServiceStatsJsonRow);
    expect(json.some(r => r.section === "outbound") && json.some(r => r.section === "inbound")).toBe(true);
    expect(ExportScenarioResponse.safeParse(envelope(json)).success).toBe(true);
  });

  it("an empty envelope is accepted at the grid version and rejected at the shared one; a v3-shaped row is rejected at v4", () => {
    expect(ExportScenarioResponse.safeParse(envelope([])).success).toBe(true);
    expect(ExportScenarioResponse.safeParse(envelope([], "mi", OUTPUT_TEMPLATE_VERSION)).success).toBe(false);
    expect(ExportScenarioResponse.safeParse(envelope([{ band: 200, percent: 50 }])).success).toBe(false);
  });

  it("CSV header and an inbound line carry section and flow", () => {
    const lines = serviceStatsRowsToCsv(rows).trim().split("\n");
    expect(lines[0]).toBe("template_version,section,band,distance_unit,percent,flow");
    expect(lines[1].split(",")).toHaveLength(6);
    expect(lines[1].endsWith(",")).toBe(true); // outbound: blank flow
    expect(lines.some(l => l.split(",")[1] === "inbound" && l.split(",")[5] !== "")).toBe(true);
  });
});
