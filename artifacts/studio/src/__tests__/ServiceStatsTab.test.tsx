import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import * as exportEntity from "@/lib/exportEntity";

// R9 — distanceUnit is sourced from GET /api/models (via useListModels),
// so this suite mocks it the same way other Workspace-tab tests do
// (e.g. Workspace.OutputMap.test.tsx).
const mockUseListModels = vi.fn(() => ({
  data: [
    { id: "p-median-us", distanceUnit: "mi" },
    // Bundle 2 (B2-T1) relabels two-echelon-gold-au "km" -> "mi" (its base
    // numbers are geographically miles; zero data change).
    { id: "two-echelon-gold-au", distanceUnit: "mi" },
    { id: "two-echelon-jade-us", distanceUnit: "mi" },
  ],
}));
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => mockUseListModels(),
}));

import { ServiceStatsTab } from "@/components/workspace/tabs/ServiceStatsTab";

const result = {
  status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "Proven optimal",
  edges: [], metrics: { bandCoverage: [{ band: 200, percent: 30 }, { band: 400, percent: 45 }] },
  details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

describe("ServiceStatsTab", () => {
  it("renders one bar per band with its exclusive percent", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("30%");
    expect(screen.getByTestId("service-stats-band-400")).toHaveTextContent("45%");
  });

  it("shows a no-bands message when bandCoverage is absent", () => {
    render(<ServiceStatsTab result={{ ...result, metrics: {} }} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-no-bands")).toBeInTheDocument();
  });

  it("shows empty state when result is null", () => {
    render(<ServiceStatsTab result={null} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-empty")).toBeInTheDocument();
  });

  it("calls downloadEntityExport with entity=serviceStats on Download click", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    fireEvent.click(screen.getByTestId("button-download-service-stats-csv"));
    expect(spy).toHaveBeenCalledWith(1, "serviceStats", "csv");
  });

  it("labels the chart as demand-weighted (R9)", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    expect(
      screen.getByText("Percent of demand served within the selected distance bands")
    ).toBeInTheDocument();
  });

  it("uses the model's distanceUnit ('mi') on p-median-us band labels", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("≤ 200 mi");
  });

  it("uses the model's distanceUnit ('mi') on a two-echelon-gold-au render", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="two-echelon-gold-au" />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("≤ 200 mi");
  });

  it("defaults to 'mi' when modelId is not provided (pre-existing call sites)", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("≤ 200 mi");
  });

  // Bundle 3, T9 — mono-numbers pass: band/percent cells are numeric and
  // must render in the monospace font, distinct from prose/labels.
  it("renders the band and percent cells with font-mono (Bundle 3, T9)", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    const row = screen.getByTestId("service-stats-band-200");
    const [bandCell, percentCell] = row.querySelectorAll("span");
    expect(bandCell).toHaveClass("font-mono");
    expect(percentCell).toHaveClass("font-mono");
  });

  // jade-T14 — model-integration-precheck.md Gate 4: an explicit, separately
  // labelled overflow row (band: -1), never folded into the last boundary.
  describe("Chapter 9 JADE — cumulative coverage + explicit overflow row", () => {
    const jadeResult = {
      ...result,
      metrics: {
        bandCoverage: [
          { band: 200, percent: 10 },
          { band: 400, percent: 30 },
          { band: 800, percent: 60 },
          { band: 1600, percent: 85 },
          { band: -1, percent: 15 },
        ],
      },
    };

    it("renders cumulative coverage at all four boundaries", () => {
      render(<ServiceStatsTab result={jadeResult} scenarioId={1} modelId="two-echelon-jade-us" />);
      expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("10%");
      expect(screen.getByTestId("service-stats-band-400")).toHaveTextContent("30%");
      expect(screen.getByTestId("service-stats-band-800")).toHaveTextContent("60%");
      expect(screen.getByTestId("service-stats-band-1600")).toHaveTextContent("85%");
    });

    it("renders a separately labelled '> 1600 mi' overflow row, not folded into the 1600 row", () => {
      render(<ServiceStatsTab result={jadeResult} scenarioId={1} modelId="two-echelon-jade-us" />);
      const overflowRow = screen.getByTestId("service-stats-band--1");
      expect(overflowRow).toHaveTextContent("> 1600 mi");
      expect(overflowRow).toHaveTextContent("15%");
      // The 1600-boundary row is untouched by the overflow (85%, not 100%).
      expect(screen.getByTestId("service-stats-band-1600")).toHaveTextContent("≤ 1600 mi");
      expect(screen.getByTestId("service-stats-band-1600")).not.toHaveTextContent("100%");
    });

    it("does not render an overflow row when bandCoverage has no band: -1 entry (no regression)", () => {
      render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
      expect(screen.queryByTestId("service-stats-band--1")).not.toBeInTheDocument();
    });
  });
});
