import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
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
});
