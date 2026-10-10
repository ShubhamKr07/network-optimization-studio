import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SolveResult } from "@workspace/api-client-react";
import { FloorExceedsMaxAlert } from "@/components/workspace/FloorExceedsMaxAlert";

const model1 = { openWarehouseIds: ["DAL", "LA", "PIT"], coveredDemand: 54946145, coveragePct: 70.42, weightedAvgDistance: 394.6, optimal: true };
const infeasible = {
  status: "infeasible", solutionStatus: "infeasible", terminationReason: "infeasible", achievedGap: null,
  objective: 0, runTimeSec: 1.2, quality: "infeasible", edges: [],
  metrics: { weightedAvgDistance: 0, bandCoverage: [], utilizationByNode: [] },
  details: { openWarehouseIds: [], assignments: [], objective: "min_distance", coverageFloorDemand: 500100100, maxCoverableDemand: 54946145, model1 },
  solverUsed: "CBC (PuLP)", infeasibilityReason: "x",
} as unknown as SolveResult;
const fmt = (v: number) => `${v.toFixed(1)} mi`;

describe("FloorExceedsMaxAlert (CH4OS §6.3)", () => {
  it("states the floor, the proven maximum, Model 1's summary and the fix", () => {
    render(<FloorExceedsMaxAlert result={infeasible} formatDistance={fmt} />);
    const alert = screen.getByTestId("floor-exceeds-max-alert");
    expect(alert).toHaveTextContent("Coverage floor 500,100,100 exceeds the maximum coverable demand 54,946,145.");
    expect(alert).toHaveTextContent("Model 2 is infeasible.");
    expect(alert).toHaveTextContent("Model 1 (max coverage): sites DAL, LA, PIT · coverage 70.42 % (54,946,145 demand) · avg distance 394.6 mi.");
    expect(alert).toHaveTextContent("Lower the floor to at most 54,946,145.");
  });

  it("uses best-found wording, and never 'maximum' or a lower-to advice, when Model 1 is not proven optimal", () => {
    const notProven = { ...infeasible, details: { ...(infeasible.details as object), model1: { ...model1, optimal: false } } } as unknown as SolveResult;
    render(<FloorExceedsMaxAlert result={notProven} formatDistance={fmt} />);
    const alert = screen.getByTestId("floor-exceeds-max-alert");
    expect(alert).toHaveTextContent("Coverage floor 500,100,100 could not be met.");
    expect(alert).toHaveTextContent("Model 1's best coverable demand found was 54,946,145; the exact maximum was not proven within the time/gap limit.");
    expect(alert).not.toHaveTextContent("maximum coverable demand");
    expect(alert).not.toHaveTextContent("Lower the floor");
  });

  it("renders nothing for a feasible result or an infeasible one without Model 1's summary", () => {
    const { container, rerender } = render(<FloorExceedsMaxAlert result={{ ...infeasible, status: "optimal", solutionStatus: "optimal" } as unknown as SolveResult} formatDistance={fmt} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FloorExceedsMaxAlert result={{ ...infeasible, details: { openWarehouseIds: [], assignments: [] } } as unknown as SolveResult} formatDistance={fmt} />);
    expect(container).toBeEmptyDOMElement();
  });
});
