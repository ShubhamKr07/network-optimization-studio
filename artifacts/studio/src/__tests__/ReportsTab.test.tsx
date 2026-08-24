import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCompareScenarios = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useCompareScenarios: vi.fn(() => mockCompareScenarios),
}));

import { ReportsTab } from "@/components/workspace/tabs/ReportsTab";

const baselineScenario = {
  id: 1, name: "Baseline", createdAt: "2026-01-01T00:00:00Z",
  result: {
    status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "Proven optimal",
    edges: [{ fromId: "ALN", toId: "C1", flow: 100, distance: 100 }],
    metrics: { weightedAvgDistance: 100, utilizationByNode: [{ warehouseId: "ALN", city: "Allentown", utilization: 0.5 }] },
    details: {}, solverUsed: "CBC", infeasibilityReason: null,
  },
};

const currentScenario = {
  id: 2, name: "Current", createdAt: "2026-02-01T00:00:00Z",
  result: {
    status: "optimal" as const, objective: 80, runTimeSec: 0.4, quality: "Proven optimal",
    edges: [{ fromId: "ALN", toId: "C1", flow: 100, distance: 50 }],
    metrics: { weightedAvgDistance: 50, utilizationByNode: [{ warehouseId: "ALN", city: "Allentown", utilization: 0.7 }] },
    details: {}, solverUsed: "CBC", infeasibilityReason: null,
  },
};

describe("ReportsTab", () => {
  beforeEach(() => {
    mockCompareScenarios.mutate.mockReset();
  });

  it("shows objective for both baseline and current with a negative delta percent when current improves on baseline", () => {
    render(<ReportsTab baseline={baselineScenario} current={currentScenario} bands={[50, 150]} />);
    expect(screen.getByTestId("report-objective-baseline")).toHaveTextContent("100");
    expect(screen.getByTestId("report-objective-current")).toHaveTextContent("80");
    expect(screen.getByTestId("report-objective-delta")).toHaveTextContent("-20");
  });

  it("renders a utilization bar per warehouse from the current scenario's metrics", () => {
    render(<ReportsTab baseline={baselineScenario} current={currentScenario} bands={[50, 150]} />);
    expect(screen.getByTestId("report-utilization-ALN")).toHaveTextContent("70%");
  });

  it("renders cumulative (running-sum) band coverage, not the raw exclusive bucket percents", () => {
    // current's one edge has distance=50, band boundary [50,150] — falls in
    // the first exclusive bucket (0,50], so exclusive coverage is [100%, 0%];
    // cumulative rollup must show [100%, 100%], not [100%, 0%].
    render(<ReportsTab baseline={baselineScenario} current={currentScenario} bands={[50, 150]} />);
    expect(screen.getByTestId("report-band-50")).toHaveTextContent("100%");
    expect(screen.getByTestId("report-band-150")).toHaveTextContent("100%");
  });

  it("shows a message when there's no current result to report on", () => {
    render(<ReportsTab baseline={baselineScenario} current={{ ...currentScenario, result: null }} bands={[50, 150]} />);
    expect(screen.getByTestId("reports-empty")).toBeInTheDocument();
  });

  it("applies font-heading to section headings", () => {
    render(<ReportsTab baseline={baselineScenario} current={currentScenario} bands={[50, 150]} />);
    expect(screen.getByText("Cost Breakdown")).toHaveClass("font-heading");
    expect(screen.getByText("Warehouse Utilization")).toHaveClass("font-heading");
  });
});

describe("ReportsTab — compare fold-in (C3.1)", () => {
  beforeEach(() => {
    mockCompareScenarios.mutate.mockReset();
  });

  // Deliberately distinct from baselineScenario.id (1) / currentScenario.id
  // (2) — the picker's candidate list must exclude `current` itself, so any
  // id collision with `currentScenario.id` would silently filter a fixture
  // candidate out of the picker.
  const scenarioA = {
    id: 10,
    name: "A",
    modelId: "p-median-us",
    inputs: { p: 4 },
    result: baselineScenario.result,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    stale: false,
  };

  const scenarioB = {
    id: 20,
    name: "B",
    modelId: "p-median-us",
    inputs: { p: 5 },
    result: currentScenario.result,
    createdAt: "2026-02-01T00:00:00Z",
    updatedAt: "2026-02-01T00:00:00Z",
    stale: false,
  };

  const availableScenarios = [
    { id: 10, name: "A", modelId: "p-median-us" },
    { id: 20, name: "B", modelId: "p-median-us" },
  ];

  it("shows a scenario picker and renders a diff table when 2+ scenarios are selected", async () => {
    mockCompareScenarios.mutate.mockImplementation(
      (_vars: unknown, opts: { onSuccess: (r: { scenarios: unknown[] }) => void }) => {
        opts.onSuccess({ scenarios: [scenarioA, scenarioB] });
      },
    );

    render(
      <ReportsTab
        baseline={baselineScenario}
        current={currentScenario}
        bands={[50, 150]}
        availableScenarios={availableScenarios}
      />,
    );
    fireEvent.click(screen.getByTestId("compare-scenario-checkbox-10"));
    fireEvent.click(screen.getByTestId("compare-scenario-checkbox-20"));
    fireEvent.click(screen.getByTestId("button-run-compare"));
    expect(await screen.findByTestId("compare-diff-table")).toBeInTheDocument();
  });

  it("only offers scenarios sharing the current model in the picker", () => {
    render(
      <ReportsTab
        baseline={baselineScenario}
        current={currentScenario}
        bands={[50, 150]}
        modelId="p-median-us"
        availableScenarios={[
          ...availableScenarios,
          { id: 30, name: "Brazil scenario", modelId: "p-median-brazil" },
        ]}
      />,
    );
    expect(screen.getByTestId("compare-scenario-checkbox-10")).toBeInTheDocument();
    expect(screen.queryByTestId("compare-scenario-checkbox-30")).not.toBeInTheDocument();
  });

  it("disables Run compare until at least 2 scenarios are selected", () => {
    render(
      <ReportsTab
        baseline={baselineScenario}
        current={currentScenario}
        bands={[50, 150]}
        availableScenarios={availableScenarios}
      />,
    );
    expect(screen.getByTestId("button-run-compare")).toBeDisabled();
    fireEvent.click(screen.getByTestId("compare-scenario-checkbox-10"));
    expect(screen.getByTestId("button-run-compare")).toBeDisabled();
    fireEvent.click(screen.getByTestId("compare-scenario-checkbox-20"));
    expect(screen.getByTestId("button-run-compare")).not.toBeDisabled();
  });
});
