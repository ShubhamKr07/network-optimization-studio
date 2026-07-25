import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SolveResult } from "@workspace/api-client-react";
import { ObjectiveBar } from "@/components/ObjectiveBar";

const optimalResult: SolveResult = {
  status: "optimal",
  objective: 1_000_000,
  runTimeSec: 0.5,
  quality: "Optimal",
  edges: [],
  metrics: { weightedAvgDistance: 340, bandCoverage: [], utilizationByNode: [] },
  details: { openWarehouseIds: ["CHI", "LA"], assignments: [] },
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};

// ── Chapter/title by model (all 4 models) ───────────────────────────────────
// Regression coverage for the bug this replaced: ObjectiveBar used to be a
// hardcoded MODEL_TARGETS table with no entry for two-echelon-gold-au, so it
// silently fell back to "Chapter 3 · Al's Athletics" on every Chapter 10
// screen. Now it's sourced from chapters.ts (single source of truth) for
// every model, so every model gets a real assertion here, not just the ones
// the old table happened to cover.
describe("ObjectiveBar — chapter/title by model", () => {
  it("p-median-us shows Chapter 3 / Al's Athletics", () => {
    render(<ObjectiveBar result={null} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText("Chapter 3")).toBeInTheDocument();
    expect(screen.getByText(/Al's Athletics/)).toBeInTheDocument();
  });

  it("transport-coal shows Chapter 5 / Coal Transport LP", () => {
    render(<ObjectiveBar result={null} scenarioId={8} modelId="transport-coal" />);
    expect(screen.getByText("Chapter 5")).toBeInTheDocument();
    expect(screen.getByText(/Coal Transport LP/)).toBeInTheDocument();
  });

  it("p-median-brazil shows Chapter 5 / Brazil Capacity", () => {
    render(<ObjectiveBar result={null} scenarioId={10} modelId="p-median-brazil" />);
    expect(screen.getByText("Chapter 5")).toBeInTheDocument();
    expect(screen.getByText(/Brazil Capacity/)).toBeInTheDocument();
  });

  it("two-echelon-gold-au shows Chapter 10 / Gold Refinery Siting, NOT Al's Athletics", () => {
    render(<ObjectiveBar result={null} scenarioId={20} modelId="two-echelon-gold-au" />);
    expect(screen.getByText("Chapter 10")).toBeInTheDocument();
    expect(screen.getByText(/Gold Refinery Siting/)).toBeInTheDocument();
    expect(screen.queryByText(/Al's Athletics/)).not.toBeInTheDocument();
  });

  it("shows a neutral 'Model' fallback (not Al's Athletics) when modelId is omitted", () => {
    render(<ObjectiveBar result={null} scenarioId={5} />);
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.queryByText(/Al's Athletics/)).not.toBeInTheDocument();
  });
});

// ── Scenario name ────────────────────────────────────────────────────────────
describe("ObjectiveBar — scenario name", () => {
  it("shows the scenario name when provided", () => {
    render(<ObjectiveBar result={null} scenarioId={5} modelId="p-median-us" scenarioName="3 Warehouses" />);
    expect(screen.getByText("3 Warehouses")).toBeInTheDocument();
  });

  it("renders without a scenario name (no crash, nothing extra shown)", () => {
    render(<ObjectiveBar result={null} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText(/Al's Athletics/)).toBeInTheDocument();
  });
});

// ── Solve stats (neutral — no targets, no hit/miss, no checkmarks) ──────────
describe("ObjectiveBar — solve stats", () => {
  it("shows 'Not yet solved' when result is null", () => {
    render(<ObjectiveBar result={null} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText("Not yet solved")).toBeInTheDocument();
  });

  it("shows objective, avg distance, and run time when a result is present", () => {
    render(<ObjectiveBar result={optimalResult} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText(/objective 1,000,000/)).toBeInTheDocument();
    expect(screen.getByText(/avg distance 340 mi/)).toBeInTheDocument();
    expect(screen.getByText(/run 0\.50s/)).toBeInTheDocument();
    expect(screen.queryByText("Not yet solved")).not.toBeInTheDocument();
  });

  it("formats a large objective with thousands separators, not scientific notation", () => {
    const bigResult: SolveResult = { ...optimalResult, objective: 29_873_735_731 };
    render(<ObjectiveBar result={bigResult} scenarioId={5} modelId="p-median-us" />);
    expect(screen.getByText(/objective 29,873,735,731/)).toBeInTheDocument();
    expect(screen.queryByText(/e\+/)).not.toBeInTheDocument();
  });

  it("omits the avg distance stat when the model's metrics don't populate it", () => {
    const noBandResult: SolveResult = { ...optimalResult, metrics: { weightedAvgDistance: undefined as unknown as number, bandCoverage: [], utilizationByNode: [] } };
    render(<ObjectiveBar result={noBandResult} scenarioId={5} modelId="p-median-us" />);
    expect(screen.queryByText(/avg distance/)).not.toBeInTheDocument();
    expect(screen.getByText(/objective/)).toBeInTheDocument();
  });

  it("never renders a hit/miss checkmark (no more arbitrary per-model targets)", () => {
    render(<ObjectiveBar result={optimalResult} scenarioId={5} modelId="p-median-us" />);
    expect(screen.queryByText(/✓/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Beat/)).not.toBeInTheDocument();
  });
});
