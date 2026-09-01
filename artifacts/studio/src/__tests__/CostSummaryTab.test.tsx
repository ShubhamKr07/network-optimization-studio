import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import * as exportEntity from "@/lib/exportEntity";
import type { Scenario } from "@workspace/api-client-react";

// R6+R8 — distanceUnit + the supportsP capability flag are both sourced from
// GET /api/models (via useListModels), same pattern ServiceStatsTab.test.tsx
// already established for this suite of Workspace-tab tests.
const mockUseListModels = vi.fn(() => ({
  data: [
    { id: "p-median-us", distanceUnit: "mi", capabilities: { supportsP: true } },
    { id: "p-median-brazil", distanceUnit: "mi", capabilities: { supportsP: true } },
    { id: "transport-coal", distanceUnit: "mi", capabilities: { supportsP: false } },
    { id: "two-echelon-gold-au", distanceUnit: "km", capabilities: { supportsP: false } },
  ],
}));
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => mockUseListModels(),
}));

import { CostSummaryTab } from "@/components/workspace/tabs/CostSummaryTab";

const result = {
  status: "optimal" as const, objective: 29873735731, runTimeSec: 0.45, quality: "Proven optimal",
  edges: [], metrics: { weightedAvgDistance: 382.9 }, details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

function scenario(overrides: Partial<Scenario>): Scenario {
  return {
    id: 1,
    name: "Scenario",
    modelId: "p-median-us",
    inputs: {},
    result: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    stale: false,
    ...overrides,
  } as Scenario;
}

// Test-only helper for "same scenario, different model" fixtures (the
// facility-location-rows-absent tests below) — a plain object spread widens
// `modelId` back to `string`, so this goes through the same `as Scenario`
// cast `scenario()` above uses.
function withModel(s: Scenario, modelId: Scenario["modelId"]): Scenario {
  return { ...s, modelId } as Scenario;
}

describe("CostSummaryTab — single-scenario view (unchanged)", () => {
  it("renders objective, weighted avg distance, runtime, quality, and solver", () => {
    render(<CostSummaryTab result={result} scenarioId={1} />);
    expect(screen.getByTestId("cost-summary-value-objective")).toHaveTextContent("29,873,735,731");
    expect(screen.getByTestId("cost-summary-value-weighted-avg-distance")).toHaveTextContent("382.9 mi");
    expect(screen.getByTestId("cost-summary-value-quality")).toHaveTextContent("Proven optimal");
  });

  it("shows empty state when result is null", () => {
    render(<CostSummaryTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("cost-summary-empty")).toBeInTheDocument();
  });

  it("calls downloadEntityExport with entity=costSummary on Download click", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<CostSummaryTab result={result} scenarioId={1} />);
    fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));
    expect(spy).toHaveBeenCalledWith(1, "costSummary", "csv");
  });

  it("uses the model's distanceUnit ('km') for a two-echelon-gold-au render", () => {
    render(<CostSummaryTab result={result} scenarioId={1} modelId="two-echelon-gold-au" />);
    expect(screen.getByTestId("cost-summary-value-weighted-avg-distance")).toHaveTextContent("382.9 km");
  });
});

describe("CostSummaryTab — R6+R8 multi-scenario compare", () => {
  const s1 = scenario({
    id: 1, name: "Baseline", modelId: "p-median-us",
    result: { ...result, objective: 100, metrics: { weightedAvgDistance: 300, bandCoverage: [{ band: 200, percent: 40 }, { band: 400, percent: 80 }], utilizationByNode: [{ warehouseId: "WH1", city: "A", utilization: 50 }, { warehouseId: "WH2", city: "B", utilization: 90 }] }, edges: [{ fromId: "WH1", toId: "C1", flow: 1, distance: 100 }, { fromId: "WH2", toId: "C2", flow: 1, distance: 100 }] },
  });
  const s2 = scenario({
    id: 2, name: "Alt P", modelId: "p-median-us",
    result: { ...result, objective: 120, metrics: { weightedAvgDistance: 250, bandCoverage: [{ band: 200, percent: 60 }, { band: 400, percent: 90 }], utilizationByNode: [{ warehouseId: "WH1", city: "A", utilization: 70 }] }, edges: [{ fromId: "WH1", toId: "C1", flow: 1, distance: 100 }] },
  });
  const unsolved = scenario({ id: 3, name: "Unsolved", modelId: "p-median-us", result: null });
  const stale = scenario({ id: 4, name: "Stale", modelId: "p-median-us", result: { ...result }, stale: true });
  const otherModel = scenario({ id: 5, name: "Other model scenario", modelId: "transport-coal", result: { ...result } });

  it("only enables solved + non-stale scenarios for compare, others show a solve-first hint", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2, unsolved, stale]} />);
    expect(screen.getByTestId("cost-summary-compare-toggle-3").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("cost-summary-compare-hint-3")).toHaveTextContent("(solve first)");
    expect(screen.getByTestId("cost-summary-compare-toggle-4").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("cost-summary-compare-hint-4")).toHaveTextContent("(solve first)");
    expect(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")).not.toBeDisabled();
  });

  it("cross-model selection is impossible — scenarios from another model never appear as toggles", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2, otherModel]} />);
    expect(screen.queryByTestId("cost-summary-compare-toggle-5")).not.toBeInTheDocument();
  });

  it("selecting 2 scenarios shows scalar rows (objective/distance/runtime/quality) per column", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-table")).toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-objective-1")).toHaveTextContent("100");
    expect(screen.getByTestId("cost-summary-compare-objective-2")).toHaveTextContent("120");
    expect(screen.getByTestId("cost-summary-compare-distance-1")).toHaveTextContent("300.0");
    expect(screen.getByTestId("cost-summary-compare-distance-2")).toHaveTextContent("250.0");
    expect(screen.getByTestId("cost-summary-compare-runtime-1")).toHaveTextContent("0.45s");
    expect(screen.getByTestId("cost-summary-compare-quality-2")).toHaveTextContent("Proven optimal");
  });

  it("shows the unit in the weighted-distance row heading, not hardcoded", () => {
    const twoEchelonS1 = withModel(s1, "two-echelon-gold-au");
    const twoEchelonS2 = withModel(s2, "two-echelon-gold-au");
    render(<CostSummaryTab result={twoEchelonS1.result} scenarioId={1} modelId="two-echelon-gold-au" scenarios={[twoEchelonS1, twoEchelonS2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByText("Weighted avg. distance (km)")).toBeInTheDocument();
  });

  it("facility-location rows (open facilities + aggregate utilization, opened nodes only) present for p-median-us", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-open-facilities-1")).toHaveTextContent("2");
    expect(screen.getByTestId("cost-summary-compare-open-facilities-2")).toHaveTextContent("1");
    // s1: WH1=50, WH2=90 both opened -> mean 70; s2: only WH1=70 opened -> 70
    expect(screen.getByTestId("cost-summary-compare-utilization-1")).toHaveTextContent("70%");
    expect(screen.getByTestId("cost-summary-compare-utilization-2")).toHaveTextContent("70%");
  });

  it("facility-location rows absent for transport-coal (every mine 'open')", () => {
    const t1 = withModel(s1, "transport-coal");
    const t2 = withModel(s2, "transport-coal");
    render(<CostSummaryTab result={t1.result} scenarioId={1} modelId="transport-coal" scenarios={[t1, t2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("cost-summary-compare-open-facilities-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cost-summary-compare-utilization-1")).not.toBeInTheDocument();
  });

  it("facility-location rows absent for two-echelon-gold-au (closed refineries carry a real 0)", () => {
    const g1 = withModel(s1, "two-echelon-gold-au");
    const g2 = withModel(s2, "two-echelon-gold-au");
    render(<CostSummaryTab result={g1.result} scenarioId={1} modelId="two-echelon-gold-au" scenarios={[g1, g2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("cost-summary-compare-open-facilities-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cost-summary-compare-utilization-1")).not.toBeInTheDocument();
  });

  it("shows per-band coverage rows when all selected scenarios share identical bands", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-band-200-1")).toHaveTextContent("40%");
    expect(screen.getByTestId("cost-summary-compare-band-200-2")).toHaveTextContent("60%");
    expect(screen.queryByTestId("cost-summary-compare-bands-note")).not.toBeInTheDocument();
  });

  it("shows a per-scenario note instead of band rows when bands differ", () => {
    const s2DifferentBands: Scenario = {
      ...s2,
      result: { ...s2.result!, metrics: { ...s2.result!.metrics, bandCoverage: [{ band: 500, percent: 60 }] } },
    };
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2DifferentBands]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("cost-summary-compare-band-200-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-bands-note")).toBeInTheDocument();
  });

  it("disables all toggles with a return-to-latest hint while browsing result history", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} isBrowsingHistory />);
    expect(screen.getByTestId("cost-summary-history-hint")).toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-toggle-1").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")).toBeDisabled();
  });

  it("hides Download CSV in compare mode", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("button-download-cost-summary-csv")).not.toBeInTheDocument();
  });

  it("1 selected renders the normal single-scenario summary, including Download CSV", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    expect(screen.getByTestId("cost-summary-list")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-cost-summary-csv")).toBeInTheDocument();
    expect(screen.queryByTestId("cost-summary-compare-table")).not.toBeInTheDocument();
  });
});
