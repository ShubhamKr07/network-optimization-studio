import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router as WouterRouter } from "wouter";

const { mockUseGetSolveHistory } = vi.hoisted(() => ({
  mockUseGetSolveHistory: vi.fn(() => ({ data: [] as unknown[] })),
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetSolveHistory: mockUseGetSolveHistory,
}));

import { Landing } from "@/pages/Landing";

function renderLanding() {
  return render(
    <WouterRouter>
      <Landing />
    </WouterRouter>,
  );
}

describe("Landing", () => {
  it("lists all three chapter labs", () => {
    renderLanding();
    expect(screen.getByText(/Al's Athletics/)).toBeInTheDocument();
    expect(screen.getByText(/Coal Transport LP/)).toBeInTheDocument();
    expect(screen.getByText(/Brazil Capacity/)).toBeInTheDocument();
  });

  it("links each chapter to its route", () => {
    renderLanding();
    expect(screen.getByTestId("link-/chapter-3")).toHaveAttribute("href", "/chapter-3");
    expect(screen.getByTestId("link-/chapter-5/transport")).toHaveAttribute("href", "/chapter-5/transport");
    expect(screen.getByTestId("link-/chapter-5/brazil")).toHaveAttribute("href", "/chapter-5/brazil");
  });

  it("shows no Recent solves section when history is empty", () => {
    mockUseGetSolveHistory.mockReturnValue({ data: [] });
    renderLanding();
    expect(screen.queryByText("Recent solves")).not.toBeInTheDocument();
  });
});

describe("Landing — Recent solves (G3.2)", () => {
  it("shows status/objective/runtime for each recent solve, newest first as returned", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [
        {
          id: 10, scenarioId: 1, scenarioName: "3 Warehouses", modelId: "p-median-us",
          status: "succeeded", objective: 94500000, weightedAvgDistanceMi: 412.6, runTimeSec: 0.4,
          queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z",
        },
        {
          id: 9, scenarioId: 8, scenarioName: "Coal Base Case", modelId: "transport-coal",
          status: "failed", objective: null, weightedAvgDistanceMi: null, runTimeSec: null,
          queuedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:05Z",
        },
      ],
    });
    renderLanding();

    expect(screen.getByText("Recent solves")).toBeInTheDocument();
    expect(screen.getByText("3 Warehouses")).toBeInTheDocument();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByText("412.6 mi")).toBeInTheDocument();
    expect(screen.getByText("0.40s")).toBeInTheDocument();
    expect(screen.getByText("Coal Base Case")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("clicking a recent solve links to its chapter route with the scenario id", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 10, scenarioId: 1, scenarioName: "3 Warehouses", modelId: "p-median-us",
        status: "succeeded", objective: 1, weightedAvgDistanceMi: 1, runTimeSec: 1,
        queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.getByTestId("link-solve-history-10")).toHaveAttribute("href", "/chapter-3?scenario=1");
  });
});
