import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router as WouterRouter } from "wouter";

const { mockUseGetSolveHistory, mockUseGetLandingSummary } = vi.hoisted(() => ({
  mockUseGetSolveHistory: vi.fn(() => ({ data: [] as unknown[] })),
  mockUseGetLandingSummary: vi.fn(() => ({ data: undefined as unknown, isPending: false, isError: false })),
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetSolveHistory: mockUseGetSolveHistory,
  useGetLandingSummary: mockUseGetLandingSummary,
}));

import { Landing } from "@/pages/Landing";

function renderLanding() {
  return render(
    <WouterRouter>
      <Landing />
    </WouterRouter>,
  );
}

beforeEach(() => {
  mockUseGetLandingSummary.mockReturnValue({ data: undefined, isPending: false, isError: false });
});

describe("Landing", () => {
  it("lists Chapter 3 and both Chapter 5 labs", () => {
    renderLanding();
    expect(screen.getByText(/AL's Athletics/)).toBeInTheDocument();
    expect(screen.getByText(/Coal Transport LP/)).toBeInTheDocument();
    expect(screen.getByText(/Brazil Capacity/)).toBeInTheDocument();
    // two-echelon-gold-au is hidden from the Landing grid but still
    // registered as a route; it must NOT appear in the card grid.
    expect(screen.queryByText(/Gold Refinery Siting/)).not.toBeInTheDocument();
  });

  it("links each visible chapter to its route", () => {
    renderLanding();
    expect(screen.getByTestId("link-/chapter-3")).toHaveAttribute("href", "/chapter-3");
    expect(screen.getByTestId("link-/chapter-5/transport")).toHaveAttribute("href", "/chapter-5/transport");
    expect(screen.getByTestId("link-/chapter-5/brazil")).toHaveAttribute("href", "/chapter-5/brazil");
    // Hidden chapter is not rendered in the grid.
    expect(screen.queryByTestId("link-/chapter-10/gold-refinery")).not.toBeInTheDocument();
  });

  it("shows no Recent solves section when history is empty", () => {
    mockUseGetSolveHistory.mockReturnValue({ data: [] });
    renderLanding();
    expect(screen.queryByText("Recent solves")).not.toBeInTheDocument();
  });

  it("shows a chapter number and a start affordance on each card (baseline)", () => {
    mockUseGetSolveHistory.mockReturnValue({ data: [] });
    renderLanding();
    const footer = screen.getByTestId("landing-card-footer-p-median-us");
    expect(footer).toHaveTextContent("03");
    expect(footer).toHaveTextContent("start");
  });

  it("prefixes recent-solve rows with the chapter label", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{ id: 10, scenarioId: 1, scenarioName: "Baseline", modelId: "p-median-us", status: "succeeded", objective: 1, weightedAvgDistanceMi: 1, runTimeSec: 1, queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z" }],
    });
    renderLanding();
    expect(screen.getByText(/Chapter 3 ·/)).toBeInTheDocument();
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

  it("a recent solve whose chapter is hidden from the grid still renders and links to its route", () => {
    // two-echelon-gold-au is hiddenFromLanding on the card grid, but Recent
    // Solves must remain unfiltered — a solve for it still renders and links through.
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 42, scenarioId: 8, scenarioName: "Refinery Base Case", modelId: "two-echelon-gold-au",
        status: "succeeded", objective: 650000, weightedAvgDistanceMi: null, runTimeSec: 0.9,
        queuedAt: "2026-01-03T00:00:00Z", finishedAt: "2026-01-03T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.getByText("Refinery Base Case")).toBeInTheDocument();
    expect(screen.getByTestId("link-solve-history-42")).toHaveAttribute("href", "/chapter-10/gold-refinery?scenario=8");
  });
});

describe("Landing — live summary (T4)", () => {
  it("falls back to the baseline (number + start →, no stats line) while summary is unavailable", () => {
    mockUseGetLandingSummary.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderLanding();
    expect(screen.queryByTestId("landing-stats-line")).not.toBeInTheDocument();
    const footer = screen.getByTestId("landing-card-footer-p-median-us");
    expect(footer).toHaveTextContent("03");
    expect(footer).toHaveTextContent("start");
  });

  it("falls back to the baseline when a background refetch errors even though cached data is retained", () => {
    // isError with stale data present must still render the T2 baseline —
    // never a half-filled footer built from a summary the server rejected.
    mockUseGetLandingSummary.mockReturnValue({
      data: { perChapter: [{ modelId: "p-median-us", scenarioCount: 3, lastSucceededSolveAt: "2020-01-01T00:00:00Z" }], totals: { scenarios: 3, solvedScenarios: 1 } },
      isPending: false,
      isError: true,
    });
    renderLanding();
    expect(screen.queryByTestId("landing-stats-line")).not.toBeInTheDocument();
    const footer = screen.getByTestId("landing-card-footer-p-median-us");
    expect(footer).toHaveTextContent("start");
    expect(footer).not.toHaveTextContent("active");
    expect(footer).not.toHaveTextContent("scenarios");
  });

  it("renders per-card status, the active badge, and the honest stats line", () => {
    mockUseGetLandingSummary.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        perChapter: [
          { modelId: "p-median-us", scenarioCount: 3, lastSucceededSolveAt: "2020-01-01T00:00:00Z" },
          { modelId: "transport-coal", scenarioCount: 2, lastSucceededSolveAt: null },
        ],
        totals: { scenarios: 5, solvedScenarios: 1 },
      },
    });
    renderLanding();

    // stats line — distinct-solve count labelled "solved" (resolution #4)
    expect(screen.getByTestId("landing-stats-line")).toHaveTextContent("3 labs · 5 scenarios · 1 solved");

    // p-median-us: solved + active
    const us = screen.getByTestId("landing-card-footer-p-median-us");
    expect(us).toHaveTextContent(/3 scenarios · solved .* ago/);
    expect(us).toHaveTextContent("active");

    // transport-coal: scenarios, not yet solved, start →
    const coal = screen.getByTestId("landing-card-footer-transport-coal");
    expect(coal).toHaveTextContent("2 scenarios");
    expect(coal).toHaveTextContent("start");
    expect(coal).not.toHaveTextContent("active");

    // brazil: absent from perChapter → "no scenarios yet"
    expect(screen.getByTestId("landing-card-footer-p-median-brazil")).toHaveTextContent("no scenarios yet");
  });
});
