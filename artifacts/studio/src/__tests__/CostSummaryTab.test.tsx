import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CostSummaryTab } from "@/components/workspace/tabs/CostSummaryTab";
import * as exportEntity from "@/lib/exportEntity";

const result = {
  status: "optimal" as const, objective: 29873735731, runTimeSec: 0.45, quality: "Proven optimal",
  edges: [], metrics: { weightedAvgDistance: 382.9 }, details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

describe("CostSummaryTab", () => {
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
});
