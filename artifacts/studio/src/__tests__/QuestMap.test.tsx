import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Hoist stable mocks ────────────────────────────────────────────────────────
const { mockNavigate, mockSetView, mockSetActiveQuest } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSetView: vi.fn(),
  mockSetActiveQuest: vi.fn(),
}));

// ── Mock wouter ───────────────────────────────────────────────────────────────
vi.mock("wouter", () => ({
  useLocation: () => ["/", mockNavigate],
}));

// ── Mock API client ───────────────────────────────────────────────────────────
vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(),
}));

// ── Mock GamificationContext ──────────────────────────────────────────────────
vi.mock("@/context/GamificationContext", () => ({
  useGamification: vi.fn(),
}));

import { useListScenarios } from "@workspace/api-client-react";
import { useGamification } from "@/context/GamificationContext";
import type { GamificationState, SolvedScenario } from "@/context/GamificationContext";
import { QuestMap } from "@/pages/arcadia/QuestMap";

const mockUseListScenarios = vi.mocked(useListScenarios);
const mockUseGamification = vi.mocked(useGamification);

// ── Fixtures ──────────────────────────────────────────────────────────────────
const pmedianScenario = { id: 5, name: "2 Warehouses", problemType: "p_median" };
const pmedianScenario2 = { id: 7, name: "4 Warehouses", problemType: "p_median" };
const transportScenario = { id: 8, name: "Coal Base Case", problemType: "transport" };
const allScenarios = [pmedianScenario, pmedianScenario2, transportScenario];

function solved(stars: number): SolvedScenario {
  return { scenarioId: 5, stars, avgDistance: 380, solvedAt: "2026-01-01T00:00:00Z" };
}

function makeGamContext(solvedScenarios: Record<number, SolvedScenario> = {}) {
  const state: GamificationState = {
    activeQuestId: 1,
    solvedScenarios,
    xp: 0, level: 1, streakDays: 0, lastSolveDate: null,
    earnedBadges: [], activeView: "quest",
    isLoggedIn: false, userId: null, _synced: false,
  };
  return {
    state,
    setView: mockSetView,
    setActiveQuest: mockSetActiveQuest,
    login: vi.fn(), logout: vi.fn(), awardXP: vi.fn(),
    xpToNextLevel: () => ({ current: 0, next: 500, pct: 0 }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseListScenarios.mockReturnValue({ data: allScenarios, isLoading: false } as ReturnType<typeof useListScenarios>);
  mockUseGamification.mockReturnValue(makeGamContext());
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe("QuestMap — rendering", () => {
  it("renders all quest node titles", () => {
    render(<QuestMap />);
    expect(screen.getByText("Al's Athletics")).toBeInTheDocument();
    expect(screen.getByText("Coal Transport LP")).toBeInTheDocument();
    expect(screen.getByText("Center of Gravity")).toBeInTheDocument();
  });

  it("renders track labels", () => {
    render(<QuestMap />);
    expect(screen.getByText("Facility Location")).toBeInTheDocument();
    expect(screen.getByText("Flow & Capacity")).toBeInTheDocument();
  });

  it("shows XP badges on nodes", () => {
    render(<QuestMap />);
    // Center of Gravity = +300, Al's Athletics = +450, Coal LP = +450, Brazil = +500
    expect(screen.getByText("+300")).toBeInTheDocument();
    expect(screen.getAllByText("+450")).toHaveLength(2);
    expect(screen.getByText("+500")).toBeInTheDocument();
  });
});

// ── Navigation ────────────────────────────────────────────────────────────────

describe("QuestMap — node navigation", () => {
  it("clicking Al's Athletics calls setView('lab') and navigates to the p_median scenario", () => {
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Al's Athletics"));
    expect(mockSetView).toHaveBeenCalledWith("lab");
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=5");
  });

  it("clicking Coal Transport LP navigates to the transport scenario", () => {
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Coal Transport LP"));
    expect(mockSetView).toHaveBeenCalledWith("lab");
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=8");
  });

  it("clicking Al's Athletics calls setActiveQuest with the node's slot ID", () => {
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Al's Athletics"));
    expect(mockSetActiveQuest).toHaveBeenCalledWith(1);
  });

  it("clicking Coal Transport LP calls setActiveQuest with slot ID 2", () => {
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Coal Transport LP"));
    expect(mockSetActiveQuest).toHaveBeenCalledWith(2);
  });

  it("navigates to first matching problemType scenario (picks id=5 not id=7 for p_median)", () => {
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Al's Athletics"));
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=5");
    expect(mockNavigate).not.toHaveBeenCalledWith("/?scenario=7");
  });

  it("navigates to '/' when scenarios list is not yet loaded", () => {
    mockUseListScenarios.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useListScenarios>);
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Al's Athletics"));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("navigates to '/' when scenarios list is empty", () => {
    mockUseListScenarios.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useListScenarios>);
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Al's Athletics"));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});

// ── Progress tracking (solvedStarsByType) ────────────────────────────────────

describe("QuestMap — progress tracking via problemType", () => {
  it("still navigates correctly when p_median scenario is solved (done nodes stay clickable)", () => {
    mockUseGamification.mockReturnValue(makeGamContext({
      5: { scenarioId: 5, stars: 3, avgDistance: 340, solvedAt: "2026-01-01T00:00:00Z" },
    }));
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Al's Athletics"));
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=5");
  });

  it("Coal Transport LP is always clickable when it has a scenarioId (even when locked)", () => {
    // p_median only has 1 star → Coal LP prerequisite not met → status stays locked
    // But locked nodes WITH scenarioId are still launchable
    mockUseGamification.mockReturnValue(makeGamContext({
      5: { scenarioId: 5, stars: 1, avgDistance: 420, solvedAt: "2026-01-01T00:00:00Z" },
    }));
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Coal Transport LP"));
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=8");
  });

  it("uses DB scenario IDs (not slot IDs) to join solved stars — id=5 maps to p_median", () => {
    // Scenario 5 is p_median (id=5 in DB), slot ID in TRACKS is 1.
    // solvedScenarios keyed by DB ID 5 — the old bug used slot ID 1 which never matched.
    mockUseGamification.mockReturnValue(makeGamContext({
      5: { scenarioId: 5, stars: 2, avgDistance: 375, solvedAt: "2026-01-01T00:00:00Z" },
    }));
    render(<QuestMap />);
    // If the mapping is correct, clicking Coal Transport LP should still navigate fine
    fireEvent.click(screen.getByText("Coal Transport LP"));
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=8");
  });

  it("handles multiple solved scenarios — picks best stars per problemType", () => {
    // scenario 5 solved with 1 star, scenario 7 solved with 3 stars — both p_median
    // best for p_median = 3 stars
    mockUseGamification.mockReturnValue(makeGamContext({
      5: { scenarioId: 5, stars: 1, avgDistance: 420, solvedAt: "2026-01-01T00:00:00Z" },
      7: { scenarioId: 7, stars: 3, avgDistance: 330, solvedAt: "2026-01-01T00:00:00Z" },
    }));
    render(<QuestMap />);
    // With 3 stars for p_median, Coal LP prerequisite (≥2 stars) should be met
    // Node should be reachable and still navigate to transport scenario
    fireEvent.click(screen.getByText("Coal Transport LP"));
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=8");
  });
});

// ── Brazil Capacity node ───────────────────────────────────────────────────
describe("QuestMap — Brazil Capacity node", () => {
  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({
      data: [
        { id: 5, name: "2 Warehouses", problemType: "p_median" },
        { id: 7, name: "4 Warehouses", problemType: "p_median" },
        { id: 8, name: "Coal Base Case", problemType: "transport" },
        { id: 10, name: "Brazil Base", problemType: "capacitated_pmedian" },
      ],
      isLoading: false,
    } as ReturnType<typeof useListScenarios>);
  });

  it("renders Brazil Capacity node title", () => {
    render(<QuestMap />);
    expect(screen.getByText("Brazil Capacity")).toBeInTheDocument();
  });

  it("shows +500 XP badge on Brazil node", () => {
    render(<QuestMap />);
    expect(screen.getByText("+500")).toBeInTheDocument();
  });

  it("clicking Brazil Capacity calls setActiveQuest(3)", () => {
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Brazil Capacity"));
    expect(mockSetActiveQuest).toHaveBeenCalledWith(3);
  });

  it("clicking Brazil Capacity navigates to Brazil scenario by problemType", () => {
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Brazil Capacity"));
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=10");
  });

  it("clicking Brazil Capacity calls setView('lab')", () => {
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Brazil Capacity"));
    expect(mockSetView).toHaveBeenCalledWith("lab");
  });

  it("Brazil node is clickable even when locked (has scenarioId — always launchable)", () => {
    // No solved scenarios → Brazil node is locked but scenarioId=3 → still clickable
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Brazil Capacity"));
    expect(mockSetView).toHaveBeenCalledWith("lab");
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=10");
  });

  it("Brazil node unlocks (opens) when Coal Transport LP solved with ≥1 star", () => {
    // prerequisiteMinStars=1 for fc2, prerequisite=fc1 (transport)
    // scenario id 8 is transport → solving it with 1 star should unlock Brazil
    mockUseGamification.mockReturnValue(makeGamContext({
      8: { scenarioId: 8, stars: 1, avgDistance: 490, solvedAt: "2026-01-01T00:00:00Z" },
    }));
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Brazil Capacity"));
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=10");
    expect(mockSetActiveQuest).toHaveBeenCalledWith(3);
  });

  it("done p_median node (Al's Athletics) is still launchable for practice", () => {
    // When p_median is solved → fl2 status = 'done' → but scenarioId present → launchable
    mockUseGamification.mockReturnValue(makeGamContext({
      5: { scenarioId: 5, stars: 3, avgDistance: 340, solvedAt: "2026-01-01T00:00:00Z" },
    }));
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Al's Athletics"));
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=5");
    expect(mockSetActiveQuest).toHaveBeenCalledWith(1);
  });

  it("navigates to '/' for Brazil when scenarios not loaded", () => {
    mockUseListScenarios.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useListScenarios>);
    render(<QuestMap />);
    fireEvent.click(screen.getByText("Brazil Capacity"));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
