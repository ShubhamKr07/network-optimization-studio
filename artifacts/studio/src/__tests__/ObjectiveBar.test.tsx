import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SolveResult } from "@workspace/api-client-react";

// ── Hoist stable mocks ────────────────────────────────────────────────────────
const { mockAwardXP, mockToast } = vi.hoisted(() => ({
  mockAwardXP: vi.fn(),
  mockToast: vi.fn(),
}));

// ── Mock GamificationContext ──────────────────────────────────────────────────
vi.mock("@/context/GamificationContext", () => ({
  useGamification: vi.fn(() => ({
    state: {
      activeQuestId: 1,
      solvedScenarios: {},
      xp: 0, level: 1, streakDays: 0, lastSolveDate: null,
      earnedBadges: [], activeView: "lab" as const,
      isLoggedIn: false, userId: null, _synced: false,
    },
    awardXP: mockAwardXP,
    setActiveQuest: vi.fn(),
    setView: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    xpToNextLevel: () => ({ current: 0, next: 500, pct: 0 }),
  })),
}));

// ── Mock useToast ─────────────────────────────────────────────────────────────
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { ObjectiveBar } from "@/components/ObjectiveBar";
import { useGamification } from "@/context/GamificationContext";

const mockUseGamification = vi.mocked(useGamification);

const optimalResult: SolveResult = {
  status: "optimal",
  openWarehouseIds: ["CHI", "LA"],
  assignments: [],
  objective: 1_000_000,
  weightedAvgDistanceMi: 340,
  bandCoverage: [],
  utilization: [],
  runTimeSec: 0.5,
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseGamification.mockReturnValue({
    state: {
      activeQuestId: 1,
      solvedScenarios: {},
      xp: 0, level: 1, streakDays: 0, lastSolveDate: null,
      earnedBadges: [], activeView: "lab" as const,
      isLoggedIn: false, userId: null, _synced: false,
    },
    awardXP: mockAwardXP,
    setActiveQuest: vi.fn(),
    setView: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    xpToNextLevel: () => ({ current: 0, next: 500, pct: 0 }),
  });
});

// ── Quest banner by problemType ───────────────────────────────────────────────

describe("ObjectiveBar — quest banner selection", () => {
  it("shows Al's Athletics chapter header for p_median", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} problemType="p_median" />);
    expect(screen.getByText(/Al's Athletics/)).toBeInTheDocument();
  });

  it("shows Coal Transport LP chapter header for transport", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={8} problemType="transport" />);
    expect(screen.getByText(/Coal Transport LP/)).toBeInTheDocument();
  });

  it("defaults to Al's Athletics when problemType is omitted", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} />);
    expect(screen.getByText(/Al's Athletics/)).toBeInTheDocument();
  });

  it("shows Al's Athletics goal title for p_median", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} problemType="p_median" />);
    expect(screen.getByText(/Beat 390 mi/)).toBeInTheDocument();
  });

  it("shows Coal Transport goal title for transport", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={8} problemType="transport" />);
    expect(screen.getByText(/Beat 500 mi/)).toBeInTheDocument();
  });

  it("shows Chapter 3 in p_median banner", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} problemType="p_median" />);
    expect(screen.getByText(/Chapter 3/)).toBeInTheDocument();
  });

  it("shows Chapter 5 in transport banner", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={8} problemType="transport" />);
    expect(screen.getByText(/Chapter 5/)).toBeInTheDocument();
  });
});

// ── Goal pills ────────────────────────────────────────────────────────────────

describe("ObjectiveBar — goal pills", () => {
  it("shows ✓ on node pill when pValue is within limit (p_median: ≤ 3)", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} problemType="p_median" />);
    expect(screen.getByText(/≤ 3 nodes ✓/)).toBeInTheDocument();
  });

  it("shows current P when pValue exceeds limit", () => {
    render(<ObjectiveBar pValue={4} result={null} scenarioId={5} problemType="p_median" />);
    expect(screen.getByText(/P=4/)).toBeInTheDocument();
  });

  it("shows avg < 390 mi placeholder when result is null (p_median)", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} problemType="p_median" />);
    expect(screen.getByText(/avg < 390 mi/)).toBeInTheDocument();
  });

  it("shows avg < 500 mi placeholder when result is null (transport)", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={8} problemType="transport" />);
    expect(screen.getByText(/avg < 500 mi/)).toBeInTheDocument();
  });

  it("shows actual distance and ✓ when result is within target", () => {
    const goodResult: SolveResult = { ...optimalResult, weightedAvgDistanceMi: 340 };
    render(<ObjectiveBar pValue={2} result={goodResult} scenarioId={5} problemType="p_median" />);
    expect(screen.getByText(/340.*✓/)).toBeInTheDocument();
  });

  it("shows actual distance without ✓ when result exceeds target", () => {
    const badResult: SolveResult = { ...optimalResult, weightedAvgDistanceMi: 400 };
    render(<ObjectiveBar pValue={2} result={badResult} scenarioId={5} problemType="p_median" />);
    // 400 < 390 is false → no check mark on distance pill
    const distPill = screen.getByText(/avg 400 mi/);
    expect(distPill).toBeInTheDocument();
    expect(distPill.textContent).not.toContain("✓");
  });
});

// ── XP awarding ──────────────────────────────────────────────────────────────

describe("ObjectiveBar — XP awarding", () => {
  it("calls awardXP with 3 stars when distance < targetDistance and pValue ok (p_median)", () => {
    // p_median targetDistance=360, maxAvgDistance=390, maxWarehouses=3
    // result.weightedAvgDistanceMi=340 < 360 AND pValue=2 ≤ 3 → 3 stars → 450 XP
    render(<ObjectiveBar pValue={2} result={optimalResult} scenarioId={5} problemType="p_median" />);
    expect(mockAwardXP).toHaveBeenCalledWith(450, 5, 3, 340);
  });

  it("calls awardXP with 2 stars when distance between target and max", () => {
    // weightedAvgDistanceMi=370 → between 360 (target) and 390 (max) → 2 stars → 300 XP
    const midResult: SolveResult = { ...optimalResult, weightedAvgDistanceMi: 370 };
    render(<ObjectiveBar pValue={2} result={midResult} scenarioId={5} problemType="p_median" />);
    expect(mockAwardXP).toHaveBeenCalledWith(300, 5, 2, 370);
  });

  it("calls awardXP with 1 star when pValue exceeds maxWarehouses", () => {
    // pValue=5 > maxWarehouses=3 → 1 star → 150 XP
    render(<ObjectiveBar pValue={5} result={optimalResult} scenarioId={5} problemType="p_median" />);
    expect(mockAwardXP).toHaveBeenCalledWith(150, 5, 1, 340);
  });

  it("does NOT call awardXP when result is null", () => {
    render(<ObjectiveBar pValue={2} result={null} scenarioId={5} problemType="p_median" />);
    expect(mockAwardXP).not.toHaveBeenCalled();
  });

  it("does NOT call awardXP when result status is not optimal", () => {
    const infeasibleResult: SolveResult = { ...optimalResult, status: "infeasible" };
    render(<ObjectiveBar pValue={2} result={infeasibleResult} scenarioId={5} problemType="p_median" />);
    expect(mockAwardXP).not.toHaveBeenCalled();
  });

  it("does NOT award XP again when same scenario already has equal or better stars", () => {
    mockUseGamification.mockReturnValue({
      state: {
        activeQuestId: 1,
        solvedScenarios: {
          5: { scenarioId: 5, stars: 3, avgDistance: 340, solvedAt: "2026-01-01T00:00:00Z" },
        },
        xp: 450, level: 1, streakDays: 0, lastSolveDate: null,
        earnedBadges: [], activeView: "lab" as const,
        isLoggedIn: false, userId: null, _synced: false,
      },
      awardXP: mockAwardXP,
      setActiveQuest: vi.fn(),
      setView: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      xpToNextLevel: () => ({ current: 450, next: 500, pct: 90 }),
    });
    render(<ObjectiveBar pValue={2} result={optimalResult} scenarioId={5} problemType="p_median" />);
    expect(mockAwardXP).not.toHaveBeenCalled();
  });

  it("awards XP for transport quest using transport goal thresholds", () => {
    // transport targetDistance=430, maxAvgDistance=500, maxWarehouses=5
    // weightedAvgDistanceMi=340 < 430 AND pValue=3 ≤ 5 → 3 stars → 450 XP
    render(<ObjectiveBar pValue={3} result={optimalResult} scenarioId={8} problemType="transport" />);
    expect(mockAwardXP).toHaveBeenCalledWith(450, 8, 3, 340);
  });
});
