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
import { UnitProvider } from "@/contexts/UnitContext";

// Landing now calls useDisplayUnit() unconditionally — needs a UnitProvider
// ancestor.
function renderLanding() {
  return render(
    <UnitProvider>
      <WouterRouter>
        <Landing />
      </WouterRouter>
    </UnitProvider>,
  );
}

beforeEach(() => {
  mockUseGetLandingSummary.mockReturnValue({ data: undefined, isPending: false, isError: false });
});

describe("Landing", () => {
  it("lists Chapter 3 and Chapter 9 — Ch5 and Ch10 are hidden from the grid", () => {
    renderLanding();
    expect(screen.getByText(/AL's Athletics/)).toBeInTheDocument();
    // two-echelon-gold-au (Chapter 10) is hiddenFromLanding — not in the grid,
    // still registered as a route.
    expect(screen.queryByText(/Gold Refinery Siting/)).not.toBeInTheDocument();
    // transport-coal and p-median-brazil (both Chapter 5) are still hidden
    // from the Landing grid but remain registered as routes.
    expect(screen.queryByText(/Coal Transport LP/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Brazil Capacity/)).not.toBeInTheDocument();
    // two-echelon-jade-us (Chapter 9) is unhidden (jade-T17, browser-verified) —
    // it appears in the Landing grid.
    expect(screen.getByText(/JADE Network/)).toBeInTheDocument();
  });

  it("links each visible chapter to its route", () => {
    renderLanding();
    expect(screen.getByTestId("link-/chapter-3")).toHaveAttribute("href", "/chapter-3");
    // ch4-lock — Chapter 9 (JADE) is still UNHIDDEN (jade-T17) and still
    // renders, but it is now LOCKED: the card is no longer wrapped in a
    // <Link>, so there is no href to follow at all. Asserted as the absence
    // of the link plus the presence of the inert wrapper, so this can't pass
    // by the card having merely disappeared.
    expect(screen.queryByTestId("link-/chapter-9/jade")).not.toBeInTheDocument();
    expect(screen.getByTestId("locked-/chapter-9/jade")).toBeInTheDocument();
    expect(screen.getByText(/JADE Network/)).toBeInTheDocument();
    // Chapter 10 is now hidden — not rendered in the grid.
    expect(screen.queryByTestId("link-/chapter-10/gold-refinery")).not.toBeInTheDocument();
    // Chapter 5 stays hidden — not rendered in the grid.
    expect(screen.queryByTestId("link-/chapter-5/transport")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-/chapter-5/brazil")).not.toBeInTheDocument();
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
      data: [{ id: 10, scenarioId: 1, scenarioName: "Baseline", modelId: "p-median-us", status: "succeeded", objective: 1, objectiveMode: null, weightedAvgDistance: 1, distanceUnit: "mi", runTimeSec: 1, queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z" }],
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
          status: "succeeded", objective: 94500000, objectiveMode: null, weightedAvgDistance: 412.6, distanceUnit: "mi", runTimeSec: 0.4,
          queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z",
        },
        {
          id: 9, scenarioId: 2, scenarioName: "5 Warehouses", modelId: "p-median-us",
          status: "failed", objective: null, objectiveMode: null, weightedAvgDistance: null, distanceUnit: "mi", runTimeSec: null,
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
        status: "succeeded", objective: 1, objectiveMode: null, weightedAvgDistance: 1, distanceUnit: "mi", runTimeSec: 1,
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
        status: "succeeded", objective: 1, objectiveMode: null, weightedAvgDistance: 1, distanceUnit: "mi", runTimeSec: 1,
        queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.getByTestId("link-solve-history-10")).toHaveAttribute("href", "/chapter-3?scenario=1");
  });

  it("a recent solve whose chapter is hidden from the grid is also hidden from Recent Solves (item 8: hide everywhere)", () => {
    // p-median-brazil (Chapter 5) is hiddenFromLanding — as of Bundle 6 T5,
    // Recent Solves is filtered consistently with the card grid, not left
    // unfiltered. (Ch10 was unhidden, so this uses a still-hidden model.)
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 42, scenarioId: 8, scenarioName: "Brazil Base Case", modelId: "p-median-brazil",
        status: "succeeded", objective: 650000, objectiveMode: null, weightedAvgDistance: null, distanceUnit: "mi", runTimeSec: 0.9,
        queuedAt: "2026-01-03T00:00:00Z", finishedAt: "2026-01-03T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.queryByText("Brazil Base Case")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-solve-history-42")).not.toBeInTheDocument();
  });
});

// C4.10/D14 — the recent-solves objective label is mode-aware: a coverage
// solve renders as a percentage, a min-distance solve as demand-km, keyed on
// objectiveMode; a null-mode (mile) solve keeps the "obj <sci-notation>" label.
describe("Landing — mode-aware recent-solve objective label (D14)", () => {
  it("renders a coverage solve's objective as a percentage and its distance in km", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 20, scenarioId: 4, scenarioName: "Chen Coverage", modelId: "chens-cosmetics-cn",
        status: "succeeded", objective: 66.5, objectiveMode: "coverage", weightedAvgDistance: 250.5, distanceUnit: "km", runTimeSec: 0.7,
        queuedAt: "2026-01-05T00:00:00Z", finishedAt: "2026-01-05T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.getByText("66.50 %")).toBeInTheDocument();
    expect(screen.getByText("250.5 km")).toBeInTheDocument();
    // NOT the mile-model "obj ..." label.
    expect(screen.queryByText(/^obj /)).not.toBeInTheDocument();
  });

  it("renders a min-distance solve's objective in demand-km", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 21, scenarioId: 5, scenarioName: "Chen Min-Distance", modelId: "chens-cosmetics-cn",
        status: "succeeded", objective: 123456789, objectiveMode: "min_distance", weightedAvgDistance: 300.2, distanceUnit: "km", runTimeSec: 0.9,
        queuedAt: "2026-01-06T00:00:00Z", finishedAt: "2026-01-06T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.getByText(/demand-km$/)).toBeInTheDocument();
    expect(screen.getByText("300.2 km")).toBeInTheDocument();
  });
});

// A9 (SCND correctness, §2.7.1) — nullable-status union / legacy badges /
// errorCode-errorMessage failure rendering / retry affordance, on the real
// live consumer of SolveHistoryEntry.
describe("Landing — A9 legacy badges, errorCode/errorMessage failures, retry", () => {
  it("shows a neutral 'unverified' badge for a succeeded-but-legacyUnverified row, alongside (never replacing) the succeeded badge", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 30, scenarioId: 6, scenarioName: "Old Run", modelId: "p-median-us",
        status: "succeeded", objective: 500, objectiveMode: null, weightedAvgDistance: 100, distanceUnit: "mi", runTimeSec: 0.5,
        legacyUnverified: true, errorCode: null, errorMessage: null,
        queuedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByTestId("badge-legacy-unverified-30")).toHaveTextContent("unverified");
    // The literal false-proof claim this exists to prevent must never appear.
    expect(screen.queryByText(/Proven optimal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Optimal$/i)).not.toBeInTheDocument();
  });

  it("does NOT show the unverified badge for a genuine v2 succeeded row (legacyUnverified: false)", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 31, scenarioId: 7, scenarioName: "Fresh Run", modelId: "p-median-us",
        status: "succeeded", objective: 500, objectiveMode: null, weightedAvgDistance: 100, distanceUnit: "mi", runTimeSec: 0.5,
        legacyUnverified: false, errorCode: null, errorMessage: null,
        queuedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.queryByTestId("badge-legacy-unverified-31")).not.toBeInTheDocument();
  });

  it("renders errorMessage (never a raw diagnostic — there is none on this typed field) for a failed row", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 32, scenarioId: 8, scenarioName: "Broke", modelId: "p-median-us",
        status: "failed", objective: null, objectiveMode: null, weightedAvgDistance: null, distanceUnit: "mi", runTimeSec: null,
        legacyUnverified: false, errorCode: "SOLVE_FAILED", errorMessage: "Solve failed — please try again",
        queuedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.getByTestId("text-error-message-32")).toHaveTextContent("Solve failed — please try again");
  });

  it("renders an explicit Retry affordance for a SOLVE_FAILED row, and for a TIMEOUT row too — errorCode-derived", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [
        {
          id: 33, scenarioId: 9, scenarioName: "Broke A", modelId: "p-median-us",
          status: "failed", objective: null, objectiveMode: null, weightedAvgDistance: null, distanceUnit: "mi", runTimeSec: null,
          legacyUnverified: false, errorCode: "SOLVE_FAILED", errorMessage: "Solve failed",
          queuedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z",
        },
        {
          id: 34, scenarioId: 10, scenarioName: "Broke B", modelId: "p-median-us",
          status: "failed", objective: null, objectiveMode: null, weightedAvgDistance: null, distanceUnit: "mi", runTimeSec: null,
          legacyUnverified: false, errorCode: "TIMEOUT", errorMessage: "Solve timed out",
          queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z",
        },
      ],
    });
    renderLanding();
    expect(screen.getByTestId("link-retry-solve-history-33")).toBeInTheDocument();
    expect(screen.getByTestId("link-retry-solve-history-34")).toBeInTheDocument();
  });

  // The load-bearing invariant, at the real live consumer: retry is derived
  // from errorCode ALONE, never by parsing errorMessage text.
  it("still renders Retry when errorMessage's TEXT reads as non-retryable — only errorCode decides this", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 35, scenarioId: 11, scenarioName: "Broke C", modelId: "p-median-us",
        status: "failed", objective: null, objectiveMode: null, weightedAvgDistance: null, distanceUnit: "mi", runTimeSec: null,
        legacyUnverified: false, errorCode: "SOLVE_FAILED", errorMessage: "This failure is permanent and cannot be retried.",
        queuedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.getByTestId("link-retry-solve-history-35")).toBeInTheDocument();
  });

  it("a superseded-but-successful job (A7) — status 'succeeded' with legacyUnverified false — renders as succeeded, NEVER as a failure, and has no retry affordance", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 36, scenarioId: 12, scenarioName: "Superseded Job", modelId: "p-median-us",
        status: "succeeded", objective: 42, objectiveMode: null, weightedAvgDistance: 10, distanceUnit: "mi", runTimeSec: 0.2,
        legacyUnverified: false, errorCode: null, errorMessage: null,
        queuedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.queryByText("failed")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-retry-solve-history-36")).not.toBeInTheDocument();
  });

  it("renders a mixed collection — legacy-unverified succeeded, v2 succeeded, and failed rows — each correctly, in one list", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [
        {
          id: 40, scenarioId: 20, scenarioName: "Legacy", modelId: "p-median-us",
          status: "succeeded", objective: 1, objectiveMode: null, weightedAvgDistance: 1, distanceUnit: "mi", runTimeSec: 1,
          legacyUnverified: true, errorCode: null, errorMessage: null,
          queuedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z",
        },
        {
          id: 41, scenarioId: 21, scenarioName: "Modern", modelId: "p-median-us",
          status: "succeeded", objective: 2, objectiveMode: null, weightedAvgDistance: 2, distanceUnit: "mi", runTimeSec: 2,
          legacyUnverified: false, errorCode: null, errorMessage: null,
          queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z",
        },
        {
          id: 42, scenarioId: 22, scenarioName: "Broken", modelId: "p-median-us",
          status: "failed", objective: null, objectiveMode: null, weightedAvgDistance: null, distanceUnit: "mi", runTimeSec: null,
          legacyUnverified: false, errorCode: "SOLVE_FAILED", errorMessage: "Solve failed",
          queuedAt: "2026-01-03T00:00:00Z", finishedAt: "2026-01-03T00:00:01Z",
        },
      ],
    });
    renderLanding();
    expect(screen.getByTestId("badge-legacy-unverified-40")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-legacy-unverified-41")).not.toBeInTheDocument();
    expect(screen.getByTestId("link-retry-solve-history-42")).toBeInTheDocument();
    expect(screen.queryByTestId("link-retry-solve-history-40")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-retry-solve-history-41")).not.toBeInTheDocument();
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

    // stats line — labs counts every visible chapter (Ch3 + Ch4 + Ch9 = 3; C4.11
    // registered chens-cosmetics-cn as a visible Chapter 4, and — like Ch9 here —
    // it has no summary row so contributes 0 scenarios/solved; Ch10 now hidden);
    // scenarios/solved come from visiblePerChapter only (p-median-us), not
    // summary.totals, which would incorrectly include the hidden transport-coal row.
    expect(screen.getByTestId("landing-stats-line")).toHaveTextContent("3 labs · 3 scenarios · 1 solved");

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

// ch4-lock — Chapters 4 and 9 are greyed out and locked on Landing. These
// pin the three things that make the lock real rather than cosmetic: the
// card is inert (no <Link>/href), it is visibly greyed, and it still
// RENDERS (a lock is not the same as hiding, which `hiddenFromLanding`
// already does for Chapters 5 and 10).
describe("Landing — locked chapters (ch4-lock)", () => {
  const LOCKED: Array<[string, string, RegExp]> = [
    ["chens-cosmetics-cn", "/chapter-4", /Chen's Cosmetics/],
    ["two-echelon-jade-us", "/chapter-9/jade", /JADE Network/],
  ];

  it.each(LOCKED)("%s renders but is not a link", (modelId, path, titleRe) => {
    renderLanding();
    expect(screen.getByText(titleRe)).toBeInTheDocument();
    expect(screen.queryByTestId(`link-${path}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`locked-${path}`)).toBeInTheDocument();
    expect(screen.getByTestId(`landing-card-${modelId}`)).toHaveAttribute("data-locked", "true");
  });

  it.each(LOCKED)("%s is visibly greyed and shows a Locked badge", (modelId) => {
    renderLanding();
    expect(screen.getByTestId(`landing-card-${modelId}`).className).toContain("opacity-60");
    expect(screen.getByTestId(`landing-card-locked-${modelId}`)).toBeInTheDocument();
    expect(screen.getByTestId(`landing-card-footer-${modelId}`)).toHaveTextContent("locked");
  });

  it("leaves unlocked chapters untouched — Chapter 3 keeps its link and shows no lock badge", () => {
    renderLanding();
    expect(screen.getByTestId("link-/chapter-3")).toHaveAttribute("href", "/chapter-3");
    expect(screen.queryByTestId("locked-/chapter-3")).not.toBeInTheDocument();
    expect(screen.queryByTestId("landing-card-locked-p-median-us")).not.toBeInTheDocument();
    expect(screen.getByTestId("landing-card-p-median-us")).not.toHaveAttribute("data-locked");
  });
});

describe("Landing — locked chapters in Recent solves (ch4-lock)", () => {
  // The lock must hold on BOTH entry points. A locked card beside a clickable
  // history row into the same chapter would make the rule look arbitrary
  // rather than absent. The row still renders — it is the student's own
  // solve history, and hiding it would misreport what they did.
  it("renders a locked chapter's solve row but strips its link", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 20, scenarioId: 7, scenarioName: "JADE Base", modelId: "two-echelon-jade-us",
        status: "succeeded", objective: 1, objectiveMode: null, weightedAvgDistance: 1, distanceUnit: "mi", runTimeSec: 1,
        queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.getByText("JADE Base")).toBeInTheDocument();
    expect(screen.queryByTestId("link-solve-history-20")).not.toBeInTheDocument();
    expect(screen.getByTestId("locked-solve-history-20")).toBeInTheDocument();
  });

  it("still links an unlocked chapter's solve row (no collateral damage)", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [{
        id: 21, scenarioId: 8, scenarioName: "AL Base", modelId: "p-median-us",
        status: "succeeded", objective: 1, objectiveMode: null, weightedAvgDistance: 1, distanceUnit: "mi", runTimeSec: 1,
        queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z",
      }],
    });
    renderLanding();
    expect(screen.getByTestId("link-solve-history-21")).toHaveAttribute("href", "/chapter-3?scenario=8");
    expect(screen.queryByTestId("locked-solve-history-21")).not.toBeInTheDocument();
  });
});
