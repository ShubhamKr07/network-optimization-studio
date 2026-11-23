import { describe, it, expect } from "vitest";
import type { SolveResult } from "@workspace/api-client-react";
import { solveBounds } from "@/lib/solveBounds";

const r = (o: Record<string, unknown>) => ({ objective: 100, details: {}, ...o }) as unknown as SolveResult;

describe("solveBounds", () => {
  it("optimal: lower = upper = objective, gap 0, proven", () => {
    for (const details of [{}, { objective: "coverage" }])
      expect(solveBounds(r({ solutionStatus: "optimal", details }))).toEqual({ upper: 100, lower: 100, gap: 0, provenOptimal: true });
  });
  it("feasible + gap, minimise: lower = obj*(1-gap)", () => {
    const b = solveBounds(r({ solutionStatus: "feasible", achievedGap: 0.05 }))!;
    expect(b.upper).toBe(100);
    expect(b.lower).toBeCloseTo(95);
    expect(b.gap).toBe(0.05);
    expect(b.provenOptimal).toBe(false);
  });
  it("feasible + gap, maximise: upper = obj*(1+gap)", () => {
    const b = solveBounds(r({ solutionStatus: "feasible", achievedGap: 0.05, details: { objective: "coverage" } }))!;
    expect(b.lower).toBe(100);
    expect(b.upper).toBeCloseTo(105);
  });
  it("feasible without gap: one bound, nulls", () => {
    expect(solveBounds(r({ solutionStatus: "feasible" }))).toEqual({ upper: 100, lower: null, gap: null, provenOptimal: false });
    expect(solveBounds(r({ solutionStatus: "feasible", details: { objective: "coverage" } }))).toEqual({ upper: null, lower: 100, gap: null, provenOptimal: false });
  });
  it("Ch4 coverage never uses solver raw-unit numbers", () => {
    const b = solveBounds(r({ solutionStatus: "feasible", objective: 70.42, achievedGap: 0.01, solverIncumbentObjective: 54946145, solverBestBound: 55495606, details: { objective: "coverage" } }))!;
    expect(b.lower).toBe(70.42);
    expect(b.upper).toBeCloseTo(71.1242, 4);
  });
  it("no incumbent: null", () => {
    expect(solveBounds(r({ solutionStatus: "infeasible" }))).toBeNull();
    expect(solveBounds(r({ status: "error" }))).toBeNull();
  });
  it("legacy (no solutionStatus, status ok): one bound", () => {
    expect(solveBounds(r({ status: "optimal" }))).toEqual({ upper: 100, lower: null, gap: null, provenOptimal: false });
  });
});
