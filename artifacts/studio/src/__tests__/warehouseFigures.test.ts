// DU-3.3 — per-warehouse figures come from EDGES only (real solve envelopes).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import type { SolveResult } from "@workspace/api-client-react";
import { servingWarehouseIds, warehouseFigures } from "@/lib/warehouseFigures";

const load = (p: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", p), "utf8"));
const fixture = (name: string): SolveResult => load(`narrative/${name}.json`).result;
const superResult = (): SolveResult => load("superResult.json");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("warehouseFigures", () => {
  it("p-median-us: matches an inline reduce over the warehouse's outbound edges", () => {
    const r = fixture("p-median-us");
    const out = r.edges.filter(e => e.fromId === "BAL");
    const flow = sum(out.map(e => e.flow));
    const f = warehouseFigures(r, "BAL");
    expect(f.customers).toBe(new Set(out.map(e => e.toId)).size);
    expect(f.demandServed).toBe(flow);
    expect(f.avgDistance).toBeCloseTo(sum(out.map(e => e.flow * e.distance)) / flow, 9);
    const far = out.reduce((a, b) => (b.distance > a.distance ? b : a));
    expect(f.farthest).toEqual({ customerId: far.toId, distance: far.distance });
    expect(f.feedingIds).toEqual([]);
  });

  it("gold: feedingIds are the mine_to_refinery fromIds into the refinery", () => {
    const r = fixture("two-echelon-gold-au");
    const f = warehouseFigures(r, "cunnamulla");
    expect(f.feedingIds).toEqual(r.edges.filter(e => e.leg === "mine_to_refinery" && e.toId === "cunnamulla").map(e => e.fromId).sort());
    expect(f.feedingIds.length).toBeGreaterThan(0);
    expect(f.demandServed).toBe(sum(r.edges.filter(e => e.leg === "refinery_to_customer").map(e => e.flow)));
  });

  it.each([["jade", () => fixture("two-echelon-jade-us")], ["super", superResult]] as const)(
    "%s: feeding = plant_to_warehouse fromIds; demandServed = outbound EDGE sum; customers counted on edges, not per-product assignments",
    (_n, get) => {
      const r = get();
      const w = (r.details as { openWarehouseIds: string[] }).openWarehouseIds[0];
      const f = warehouseFigures(r, w);
      const out = r.edges.filter(e => e.fromId === w && e.leg === "warehouse_to_customer");
      expect(f.demandServed).toBe(sum(out.map(e => e.flow)));
      expect(f.feedingIds).toEqual([...new Set(r.edges.filter(e => e.leg === "plant_to_warehouse" && e.toId === w).map(e => e.fromId))].sort());
      expect(f.feedingIds.length).toBeGreaterThan(0);
      const assignments = ((r.details as { assignments?: Array<{ warehouseId: string }> }).assignments ?? []).filter(a => a.warehouseId === w);
      // Edges are product-aggregated: counting per-product assignment rows would overcount customers.
      expect(f.customers).toBe(new Set(out.map(e => e.toId)).size);
      if (assignments.length > 0) expect(f.customers).toBeLessThan(assignments.length);
    },
  );

  it("an open warehouse with no outbound flow reports zeros and nulls", () => {
    const r = fixture("p-median-us");
    const f = warehouseFigures({ ...r, edges: r.edges.filter(e => e.fromId !== "BAL") }, "BAL");
    expect(f).toEqual({ customers: 0, demandServed: 0, avgDistance: null, farthest: null, feedingIds: [] });
  });

  it("an unknown id reports zeros and nulls", () => {
    expect(warehouseFigures(fixture("p-median-us"), "NOPE")).toEqual({ customers: 0, demandServed: 0, avgDistance: null, farthest: null, feedingIds: [] });
  });
});

describe("servingWarehouseIds", () => {
  it("returns every warehouse with an outbound edge to a split-sourced customer, ignoring inbound legs", () => {
    const base = fixture("p-median-us");
    const r = { ...base, edges: [
      { fromId: "A", toId: "C1", flow: 1, distance: 1 },
      { fromId: "B", toId: "C1", flow: 1, distance: 2 },
      { fromId: "M", toId: "A", flow: 1, distance: 3, leg: "mine_to_refinery" },
    ] } as SolveResult;
    expect(servingWarehouseIds(r, "C1").sort()).toEqual(["A", "B"]);
    expect(servingWarehouseIds(r, "A")).toEqual([]);
  });
});
