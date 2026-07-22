import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SolveResult } from "@workspace/api-client-react";
import { ObjectiveBar } from "@/components/ObjectiveBar";

const optimalResult: SolveResult = {
  status: "optimal",
  openWarehouseIds: ["CHI", "LA"],
  assignments: [],
  objective: 1_000_000,
  weightedAvgDistanceMi: 340,
  bandCoverage: [],
  utilization: [],
  runTimeSec: 0.5,
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};

// ── Chapter header by problemType ─────────────────────────────────────────────

describe("ObjectiveBar — chapter header selection", () => {
  it("shows Al's Athletics chapter header for p_median", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText(/Al's Athletics/)).toBeInTheDocument();
  });

  it("shows Coal Transport LP chapter header for transport", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={8} modelId="transport-coal" />);
    expect(screen.getByText(/Coal Transport LP/)).toBeInTheDocument();
  });

  it("defaults to Al's Athletics when modelId is omitted", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} />);
    expect(screen.getByText(/Al's Athletics/)).toBeInTheDocument();
  });

  it("shows Al's Athletics goal title for p_median", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText(/Beat 390 mi/)).toBeInTheDocument();
  });

  it("shows Coal Transport goal title for transport", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={8} modelId="transport-coal" />);
    expect(screen.getByText(/Beat 500 mi/)).toBeInTheDocument();
  });

  it("shows Chapter 3 in p_median banner", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText(/Chapter 3/)).toBeInTheDocument();
  });

  it("shows Chapter 5 in transport banner", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={8} modelId="transport-coal" />);
    expect(screen.getByText(/Chapter 5/)).toBeInTheDocument();
  });
});

// ── Goal pills ────────────────────────────────────────────────────────────────

describe("ObjectiveBar — goal pills", () => {
  it("shows ✓ on node pill when pValue is within limit (p_median: ≤ 3)", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText(/≤ 3 nodes ✓/)).toBeInTheDocument();
  });

  it("shows current P when pValue exceeds limit", () => {
    render(<ObjectiveBar pValue={4} result={null} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText(/P=4/)).toBeInTheDocument();
  });

  it("shows avg < 390 mi placeholder when result is null (p_median)", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText(/avg < 390 mi/)).toBeInTheDocument();
  });

  it("shows avg < 500 mi placeholder when result is null (transport)", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={8} modelId="transport-coal" />);
    expect(screen.getByText(/avg < 500 mi/)).toBeInTheDocument();
  });

  it("shows actual distance and ✓ when result is within target", () => {
    const goodResult: SolveResult = { ...optimalResult, weightedAvgDistanceMi: 340 };
    render(<ObjectiveBar pValue={2} result={goodResult} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText(/340.*✓/)).toBeInTheDocument();
  });

  it("shows actual distance without ✓ when result exceeds target", () => {
    const badResult: SolveResult = { ...optimalResult, weightedAvgDistanceMi: 400 };
    render(<ObjectiveBar pValue={2} result={badResult} scenarioId={5} modelId="p-median-us" />);
    // 400 < 390 is false → no check mark on distance pill
    const distPill = screen.getByText(/avg 400 mi/);
    expect(distPill).toBeInTheDocument();
    expect(distPill.textContent).not.toContain("✓");
  });
});

// ── Brazil Capacity goals ──────────────────────────────────────────────────
describe("ObjectiveBar — Brazil Capacity goals", () => {
  it("shows Brazil chapter header for capacitated_pmedian", () => {
    render(<ObjectiveBar pValue={5} result={null} scenarioId={10} modelId="p-median-brazil" />);
    expect(screen.getByText(/Brazil Capacity/)).toBeInTheDocument();
  });

  it("shows Chapter 5 in Brazil banner", () => {
    render(<ObjectiveBar pValue={5} result={null} scenarioId={10} modelId="p-median-brazil" />);
    expect(screen.getByText(/Chapter 5/)).toBeInTheDocument();
  });

  it("shows Beat 350 mi goal title for Brazil", () => {
    render(<ObjectiveBar pValue={5} result={null} scenarioId={10} modelId="p-median-brazil" />);
    expect(screen.getByText(/Beat 350 mi/)).toBeInTheDocument();
  });

  it("shows avg < 350 mi placeholder when result is null (Brazil)", () => {
    render(<ObjectiveBar pValue={5} result={null} scenarioId={10} modelId="p-median-brazil" />);
    expect(screen.getByText(/avg < 350 mi/)).toBeInTheDocument();
  });

  it("shows ≤ 5 nodes ✓ pill when pValue=5 (Brazil limit)", () => {
    render(<ObjectiveBar pValue={5} result={null} scenarioId={10} modelId="p-median-brazil" />);
    expect(screen.getByText(/≤ 5 nodes ✓/)).toBeInTheDocument();
  });

  it("shows P=6 pill when pValue exceeds Brazil limit of 5", () => {
    render(<ObjectiveBar pValue={6} result={null} scenarioId={10} modelId="p-median-brazil" />);
    expect(screen.getByText(/P=6/)).toBeInTheDocument();
  });

  it("shows tagline about relaxing single-sourcing", () => {
    render(<ObjectiveBar pValue={5} result={null} scenarioId={10} modelId="p-median-brazil" />);
    expect(screen.getByText(/relax single-sourcing/i)).toBeInTheDocument();
  });
});
