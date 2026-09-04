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
  it("lists Chapter 3 only — Ch5 and Ch10 are hidden from the grid", () => {
    renderLanding();
    expect(screen.getByText(/AL's Athletics/)).toBeInTheDocument();
    // transport-coal and p-median-brazil (both Chapter 5) are hidden from
    // the Landing grid but still registered as routes.
    expect(screen.queryByText(/Coal Transport LP/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Brazil Capacity/)).not.toBeInTheDocument();
    // two-echelon-gold-au is hidden from the Landing grid but still
    // registered as a route; it must NOT appear in the card grid.
    expect(screen.queryByText(/Gold Refinery Siting/)).not.toBeInTheDocument();
  });

  it("links each visible chapter to its route", () => {
    renderLanding();
    expect(screen.getByTestId("link-/chapter-3")).toHaveAttribute("href", "/chapter-3");
    // Hidden chapters are not rendered in the grid.
    expect(screen.queryByTestId("link-/chapter-5/transport")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-/chapter-5/brazil")).not.toBeInTheDocument();
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

  it("clips the card and gives the footer a sunken full-bleed strip", () => {
    mockUseGetLandingSummary.mockReturnValue({ data: { perChapter: [], totals: { scenarios: 0, solvedScenarios: 0 } }, isPending: false, isError: false });
    renderLanding();
    const footer = screen.getByTestId("landing-card-footer-p-median-us");
    const card = footer.closest("[class*='overflow-hidden']");
    expect(card).not.toBeNull();
    expect(footer.className).toContain("border-t");
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
          id: 9, scenarioId: 2, scenarioName: "5 Warehouses", modelId: "p-median-us",
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
    expect(screen.getByText("5 Warehouses")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("does not render a Recent-Solves entry for a hidden model (transport-coal)", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 11, scenarioId: 3, scenarioName: "Coal Base Case", modelId: "transport-coal",
        status: "succeeded", objective: 1, weightedAvgDistanceMi: 1, runTimeSec: 1,
        queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z",
      }],
    });
    renderLanding();
    // Every history entry is for a hidden model, so the whole section is
    // gated off (mirrors the "no rows" empty state).
    expect(screen.queryByText("Recent solves")).not.toBeInTheDocument();
    expect(screen.queryByText("Coal Base Case")).not.toBeInTheDocument();
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

  it("a recent solve whose chapter is hidden from the grid is also hidden from Recent Solves (item 8: hide everywhere)", () => {
    // two-echelon-gold-au is hiddenFromLanding — as of Bundle 6 T5, Recent
    // Solves is filtered consistently with the card grid, not left unfiltered.
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 42, scenarioId: 8, scenarioName: "Refinery Base Case", modelId: "two-echelon-gold-au",
        status: "succeeded", objective: 650000, weightedAvgDistanceMi: null, runTimeSec: 0.9,
        queuedAt: "2026-01-03T00:00:00Z", finishedAt: "2026-01-03T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.queryByText("Refinery Base Case")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-solve-history-42")).not.toBeInTheDocument();
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
      data: { perChapter: [{ modelId: "p-median-us", scenarioCount: 3, solvedScenarioCount: 1, lastSucceededSolveAt: "2020-01-01T00:00:00Z" }], totals: { scenarios: 3, solvedScenarios: 1 } },
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

  it("renders per-card status, the active badge, and the honest stats line — computed from visible (non-hidden) chapters only", () => {
    mockUseGetLandingSummary.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        perChapter: [
          { modelId: "p-median-us", scenarioCount: 3, solvedScenarioCount: 1, lastSucceededSolveAt: "2020-01-01T00:00:00Z" },
          // transport-coal is hiddenFromLanding — its counts must NOT leak
          // into the stats line or affect which card shows "active".
          { modelId: "transport-coal", scenarioCount: 2, solvedScenarioCount: 2, lastSucceededSolveAt: "2025-01-01T00:00:00Z" },
        ],
        totals: { scenarios: 5, solvedScenarios: 3 },
      },
    });
    renderLanding();

    // stats line — computed from visiblePerChapter only (p-median-us), not
    // summary.totals, which would incorrectly include the hidden transport-coal row.
    expect(screen.getByTestId("landing-stats-line")).toHaveTextContent("1 labs · 3 scenarios · 1 solved");

    // p-median-us: solved + active (the only visible chapter, so it's the
    // most-recently-solved-among-visible even though transport-coal's own
    // lastSucceededSolveAt is more recent).
    const us = screen.getByTestId("landing-card-footer-p-median-us");
    expect(us).toHaveTextContent(/3 scenarios · solved .* ago/);
    expect(us).toHaveTextContent("active");

    // transport-coal and p-median-brazil are hidden from the grid entirely —
    // no card, no footer testid.
    expect(screen.queryByTestId("landing-card-footer-transport-coal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("landing-card-footer-p-median-brazil")).not.toBeInTheDocument();
  });
});
