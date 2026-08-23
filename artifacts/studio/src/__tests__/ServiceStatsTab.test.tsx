import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ServiceStatsTab } from "@/components/workspace/tabs/ServiceStatsTab";
import * as exportEntity from "@/lib/exportEntity";

const result = {
  status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "Proven optimal",
  edges: [], metrics: { bandCoverage: [{ band: 200, percent: 30 }, { band: 400, percent: 45 }] },
  details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

describe("ServiceStatsTab", () => {
  it("renders one bar per band with its exclusive percent", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("30%");
    expect(screen.getByTestId("service-stats-band-400")).toHaveTextContent("45%");
  });

  it("shows a no-bands message when bandCoverage is absent", () => {
    render(<ServiceStatsTab result={{ ...result, metrics: {} }} scenarioId={1} />);
    expect(screen.getByTestId("service-stats-no-bands")).toBeInTheDocument();
  });

  it("shows empty state when result is null", () => {
    render(<ServiceStatsTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("service-stats-empty")).toBeInTheDocument();
  });

  it("calls downloadEntityExport with entity=serviceStats on Download click", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<ServiceStatsTab result={result} scenarioId={1} />);
    fireEvent.click(screen.getByTestId("button-download-service-stats-csv"));
    expect(spy).toHaveBeenCalledWith(1, "serviceStats", "csv");
  });
});
