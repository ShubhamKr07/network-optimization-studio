// SCU-1.9 (spec B1.1) — one test per family, each fixture shaped like that
// family's real solve.py envelope (line refs per fixture). A missing field
// drops its sentence; nothing is invented.
import { describe, it, expect } from "vitest";
import type { SolveResult } from "@workspace/api-client-react";
import { buildResultNarrative, legLabel } from "@/lib/resultNarrative";

const MI = { toDisplay: (v: number) => v, unit: "mi" };
const BANDS = [200, 400, 800, 1600];
const proven = {
  status: "optimal", solutionStatus: "optimal", terminationReason: "optimality_proven", achievedGap: null,
  quality: "optimal", solverUsed: "CBC", infeasibilityReason: null, runTimeSec: 0.4,
};
const asResult = (r: Record<string, unknown>) => ({ ...proven, ...r }) as unknown as SolveResult;

// solve.py:492-512 — p-median: edges carry no `leg`, details.openWarehouseIds.
const pmedian = asResult({
  objective: 29873735731,
  edges: [
    { fromId: "CHI", toId: "C1", flow: 600, distance: 0, band: 0 },
    { fromId: "CHI", toId: "C2", flow: 300, distance: 350, band: 1 },
    { fromId: "ATL", toId: "C3", flow: 100, distance: 900, band: 3 },
  ],
  metrics: { utilizationByNode: [], bandCoverage: [{ band: 200, percent: 60 }, { band: 400, percent: 90 }, { band: 800, percent: 90 }, { band: 1600, percent: 100 }], weightedAvgDistance: 195.0 },
  details: { openWarehouseIds: ["CHI", "ATL"], assignments: [] },
});

describe("buildResultNarrative — p-median", () => {
  it("narrates objective + solve time, open warehouses, exclusive band coverage and weighted distance", () => {
    expect(buildResultNarrative("p-median-us", pmedian, { bands: BANDS, distance: MI, solveTimeSec: 2 })!.summary).toEqual([
      "Objective: 29,873,735,731, solved in 2.0s.",
      "2 warehouses open: CHI, ATL.",
      "Demand by distance band: 0–200 mi 60%, 200–400 mi 30%, 400–800 mi 0%, 800–1,600 mi 10%, > 1,600 mi 0%.",
      "Weighted average distance: 195.0 mi.",
    ]);
  });

  it("p-median-brazil uses the same adapter", () => {
    expect(buildResultNarrative("p-median-brazil", pmedian, { bands: BANDS, distance: MI })!.summary[1]).toBe("2 warehouses open: CHI, ATL.");
  });

  it("uses display ids when supplied", () => {
    const n = buildResultNarrative("p-median-us", pmedian, { bands: BANDS, distance: MI, displayIdById: { CHI: "WH-IL-CHI" } })!;
    expect(n.summary[1]).toBe("2 warehouses open: WH-IL-CHI, ATL.");
  });

  it("omits the solve time when there is no timing, and every distance sentence while the unit is unresolved", () => {
    expect(buildResultNarrative("p-median-us", pmedian, { bands: BANDS, distance: null })!.summary).toEqual([
      "Objective: 29,873,735,731.",
      "2 warehouses open: CHI, ATL.",
    ]);
  });

  it("drops the open-facility sentence when details.openWarehouseIds is missing (never invented)", () => {
    const n = buildResultNarrative("p-median-us", asResult({ ...pmedian, details: {} }), { bands: BANDS, distance: MI })!;
    expect(n.summary.some(s => s.includes("open"))).toBe(false);
  });

  it("a no-incumbent result gets one truthful sentence and nothing derived from its sentinel zeros", () => {
    const infeasible = asResult({ ...pmedian, status: "infeasible", solutionStatus: "infeasible", terminationReason: null, objective: 0, edges: [] });
    expect(buildResultNarrative("p-median-us", infeasible, { bands: BANDS, distance: MI })!.summary).toEqual([
      "There is no solution to describe (No incumbent).",
    ]);
  });

  it("returns null for a model it has no adapter for", () => {
    expect(buildResultNarrative("not-a-model", pmedian, { bands: BANDS, distance: MI })).toBeNull();
  });
});

// solve.py:668-688 — transport: details.openWarehouseIds holds MINES, so the
// adapter narrates mine -> station flows instead of "warehouses".
describe("buildResultNarrative — transport", () => {
  const transport = asResult({
    objective: 123456,
    edges: [
      { fromId: "M1", toId: "S1", flow: 500, distance: 120, band: 0 },
      { fromId: "M1", toId: "S2", flow: 300, distance: 450, band: 2 },
      { fromId: "M2", toId: "S2", flow: 200, distance: 90, band: 0 },
    ],
    metrics: { utilizationByNode: [], bandCoverage: [{ band: 200, percent: 70 }, { band: 400, percent: 70 }, { band: 800, percent: 100 }, { band: 1600, percent: 100 }], weightedAvgDistance: 213.0 },
    details: { openWarehouseIds: ["M1", "M2"], assignments: [] },
  });

  it("narrates mine -> station flows, never 'warehouses'", () => {
    const n = buildResultNarrative("transport-coal", transport, { bands: BANDS, distance: MI })!;
    expect(n.summary).toEqual([
      "Objective: 123,456.",
      "Coal ships from 2 mines to 2 power stations over 3 lanes.",
      "Tonnage by distance band: 0–200 mi 70%, 200–400 mi 0%, 400–800 mi 30%, 800–1,600 mi 0%, > 1,600 mi 0%.",
      "Weighted average distance: 213.0 mi.",
    ]);
    expect(n.summary.join(" ")).not.toMatch(/warehouse/i);
    expect(n.howToRead).toMatch(/mines/);
  });
});

// solve.py:1630-1642 — max-coverage: coverage is details.coveragePct /
// coveredDemand against details.highServiceDistMi (not a band rollup).
describe("buildResultNarrative — max-coverage", () => {
  const maxCoverage = asResult({
    objective: 66.6667,
    edges: [{ fromId: "W1", toId: "C1", flow: 100, distance: 300 }],
    metrics: { openFacilityIds: ["W1", "W2", "W3"], weightedAvgDistance: 812.4, utilizationByNode: [], bandCoverage: [{ band: 450, percent: 66.6667 }, { band: 3400, percent: 100 }] },
    details: { objective: "coverage", p: 3, highServiceDistMi: 450, maxDistMi: 3400, coverageFloorDemand: 0, openWarehouseIds: ["W1", "W2", "W3"], coveragePct: 66.6667, coveredDemand: 131645389, uncoveredPct: 33.3333, assignments: [] },
  });

  it("narrates coverage from coveragePct/coveredDemand at the high-service distance", () => {
    expect(buildResultNarrative("max-coverage-us", maxCoverage, { bands: [450, 900, 1800, 3400], distance: MI })!.summary).toEqual([
      "Objective: 66.667.",
      "3 warehouses open: W1, W2, W3.",
      "66.67% of demand (131,645,389 units) is within the 450.0 mi high-service distance.",
      "Weighted average distance: 812.4 mi.",
    ]);
  });
});

// solve.py:1850-1863 — delivery: 2-dp bands, no utilizationByNode (no
// capacity), details.objective "base"/"cost_adjusted".
describe("buildResultNarrative — delivery", () => {
  const delivery = asResult({
    objective: 88240913478.1,
    edges: [
      { fromId: "W1", toId: "C1", flow: 2, distance: 0, band: 0 },
      { fromId: "W2", toId: "C2", flow: 1, distance: 900, band: 2 },
    ],
    metrics: { bandCoverage: [{ band: 400, percent: 66.67 }, { band: 800, percent: 66.67 }, { band: 1200, percent: 100 }, { band: 1600, percent: 100 }], weightedAvgDistance: 422.5511, openFacilityIds: ["W1", "W2", "W60"] },
    details: { openWarehouseIds: ["W1", "W2", "W60"], assignments: [], objective: "base" },
  });

  it("narrates 2-dp exclusive bands and no capacity/utilisation text", () => {
    const n = buildResultNarrative("delivery-teaching-us", delivery, { bands: [400, 800, 1200, 1600], distance: MI })!;
    expect(n.summary).toEqual([
      "Objective: 88,240,913,478.1.",
      "3 warehouses open: W1, W2, W60.",
      "Demand by distance band: 0–400 mi 66.67%, 400–800 mi 0%, 800–1,200 mi 33.33%, 1,200–1,600 mi 0%, > 1,600 mi 0%.",
      "Weighted average distance: 422.6 mi.",
    ]);
    expect(n.summary.join(" ")).not.toMatch(/capacity|utili/i);
  });
});

// two-echelon — gold-au (solve.py:1081-1090: refineries in
// details.openWarehouseIds, NO metrics.openFacilityIds) and JADE
// (solve.py:1411-1424: metrics.openFacilityIds = warehouses only).
describe("buildResultNarrative — two-echelon", () => {
  const gold = asResult({
    objective: 98765.43,
    edges: [
      { fromId: "MINE1", toId: "REF1", flow: 1000, distance: 1464.5, band: 3, leg: "mine_to_refinery" },
      { fromId: "REF1", toId: "C1", flow: 600, distance: 100, band: 0, leg: "refinery_to_customer" },
      { fromId: "REF1", toId: "C2", flow: 400, distance: 250, band: 1, leg: "refinery_to_customer" },
    ],
    metrics: {
      utilizationByNode: [], bandCoverage: [{ band: 200, percent: 60 }, { band: 400, percent: 100 }, { band: 800, percent: 100 }, { band: 1600, percent: 100 }],
      weightedAvgDistance: 812.3,
      avgDistanceByLeg: [{ leg: "mine_to_refinery", avgDistance: 1464.5, totalFlow: 1000 }, { leg: "refinery_to_customer", avgDistance: 160.0, totalFlow: 1000 }],
    },
    details: { openWarehouseIds: ["REF1"], assignments: [], bomRatio: 1.1 },
  });

  it("gold-au: open refineries from details.openWarehouseIds, per-leg bands and per-leg averages", () => {
    expect(buildResultNarrative("two-echelon-gold-au", gold, { bands: BANDS, distance: MI })!.summary).toEqual([
      "Objective: 98,765.43.",
      "1 refinery open: REF1.",
      "Mine → Refinery flow by distance band: 0–200 mi 0%, 200–400 mi 0%, 400–800 mi 0%, 800–1,600 mi 100%, > 1,600 mi 0%.",
      "Refinery → Customer flow by distance band: 0–200 mi 60%, 200–400 mi 40%, 400–800 mi 0%, 800–1,600 mi 0%, > 1,600 mi 0%.",
      "Average Mine → Refinery distance: 1464.5 mi.",
      "Average Refinery → Customer distance: 160.0 mi.",
    ]);
  });

  const jade = asResult({
    objective: 4567890.1234,
    edges: [
      { fromId: "P1", toId: "wh-11", flow: 700, distance: 300, leg: "plant_to_warehouse", productId: "product-1" },
      { fromId: "P2", toId: "wh-14", flow: 300, distance: 900, leg: "plant_to_warehouse", productId: "product-2" },
      { fromId: "wh-11", toId: "c1", flow: 600, distance: 150, band: 0, leg: "warehouse_to_customer" },
      { fromId: "wh-14", toId: "c2", flow: 400, distance: 500, band: 2, leg: "warehouse_to_customer" },
    ],
    metrics: {
      utilizationByNode: [], bandCoverage: [{ band: 200, percent: 60 }, { band: 400, percent: 0 }, { band: 800, percent: 40 }, { band: 1600, percent: 0 }],
      weightedAvgDistance: 385.0, openFacilityIds: ["wh-11", "wh-14"], totalDemand: 1000, inboundCost: 1, outboundCost: 2,
      avgDistanceByLeg: [{ leg: "plant_to_warehouse", avgDistance: 480.0, totalFlow: 1000 }, { leg: "warehouse_to_customer", avgDistance: 290.0, totalFlow: 1000 }],
    },
    details: { openWarehouseIds: ["wh-11", "wh-14"], assignments: [] },
  });

  it("JADE: open warehouses from metrics.openFacilityIds; plants are never narrated as 'open'", () => {
    const n = buildResultNarrative("two-echelon-jade-us", jade, { bands: BANDS, distance: MI })!;
    expect(n.summary).toEqual([
      "Objective: 4,567,890.123.",
      "2 warehouses open: wh-11, wh-14.",
      "Plant → Warehouse flow by distance band: 0–200 mi 0%, 200–400 mi 70%, 400–800 mi 0%, 800–1,600 mi 30%, > 1,600 mi 0%.",
      "Warehouse → Customer flow by distance band: 0–200 mi 60%, 200–400 mi 0%, 400–800 mi 40%, 800–1,600 mi 0%, > 1,600 mi 0%.",
      "Average Plant → Warehouse distance: 480.0 mi.",
      "Average Warehouse → Customer distance: 290.0 mi.",
    ]);
    expect(n.summary.join(" ")).not.toMatch(/plants? open/i);
  });
});

describe("buildResultNarrative — 'How to read this map'", () => {
  it("every supported model has fixed, non-empty reading guidance mentioning the band legend", () => {
    for (const id of ["p-median-us", "p-median-brazil", "transport-coal", "max-coverage-us", "delivery-teaching-us", "two-echelon-gold-au", "two-echelon-jade-us"]) {
      const n = buildResultNarrative(id, pmedian, { bands: BANDS, distance: MI })!;
      expect(n.howToRead, id).toMatch(/legend/);
    }
  });
});

describe("legLabel (moved from OutputMapTab)", () => {
  it("derives a label from the leg string itself", () => {
    expect(legLabel("plant_to_warehouse")).toBe("Plant → Warehouse");
    expect(legLabel("mine_to_refinery")).toBe("Mine → Refinery");
    expect(legLabel("custom")).toBe("Custom");
  });
});
