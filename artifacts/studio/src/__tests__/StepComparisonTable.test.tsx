import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepComparisonTable } from "@/components/workspace/StepComparisonTable";

const step1 = {
  objective: "coverage" as const, status: "optimal", solutionStatus: "optimal",
  quality: "Proven Optimal", coveragePct: 68.4192, coveredDemand: 53385024,
  weightedAvgDistance: 635.13, distanceUnit: "km", runTimeSec: 1.5,
};
const step2 = { ...step1, objective: "min_distance" as const, weightedAvgDistance: 624.33, runTimeSec: 2.1 };

describe("CH4-13 — frame 3d comparison", () => {
  it("renders both steps side by side from data the scenario already holds", () => {
    render(<StepComparisonTable step1={step1} step2={step2} />);
    expect(screen.getByTestId("step-comparison")).toBeInTheDocument();
    expect(screen.getByTestId("step-comparison-coveredDemand-1")).toHaveTextContent("53,385,024");
    expect(screen.getByTestId("step-comparison-coveredDemand-2")).toHaveTextContent("53,385,024");
    expect(screen.getByTestId("step-comparison-weightedAvgDistance-1")).toHaveTextContent("635.13 km");
    expect(screen.getByTestId("step-comparison-weightedAvgDistance-2")).toHaveTextContent("624.33 km");
  });

  it("shows coverage percent to 4 decimals, matching the solver's own rounding", () => {
    render(<StepComparisonTable step1={step1} step2={step2} />);
    expect(screen.getByTestId("step-comparison-coveragePct-1")).toHaveTextContent("68.4192");
  });

  it("renders an em dash for a null metric rather than NaN or blank", () => {
    render(<StepComparisonTable step1={{ ...step1, coveragePct: null }} step2={step2} />);
    expect(screen.getByTestId("step-comparison-coveragePct-1")).toHaveTextContent("—");
  });
});
