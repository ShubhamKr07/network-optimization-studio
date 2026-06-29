import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GamificationProvider, useGamification, XP_THRESHOLDS } from "@/context/GamificationContext";
import type { ReactNode } from "react";

// Stub fetch so login / pushProgress don't hit the network
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () =>
    Promise.resolve({
      xp: 0,
      level: 1,
      streakDays: 0,
      lastSolveDate: null,
      solvedScenarios: {},
      earnedBadges: [],
    }),
}) as unknown as typeof fetch;

// ── Test consumer component ───────────────────────────────────────────────────
function Consumer() {
  const { state, setActiveQuest, awardXP, setView } = useGamification();
  return (
    <div>
      <span data-testid="xp">{state.xp}</span>
      <span data-testid="level">{state.level}</span>
      <span data-testid="quest">{state.activeQuestId}</span>
      <span data-testid="view">{state.activeView}</span>
      <span data-testid="badges">{state.earnedBadges.join(",")}</span>
      <span data-testid="solved-count">{Object.keys(state.solvedScenarios).length}</span>
      <span data-testid="solved-stars">
        {Object.values(state.solvedScenarios).map((s) => s.stars).join(",")}
      </span>
      <button data-testid="set-quest-1" onClick={() => setActiveQuest(1)}>q1</button>
      <button data-testid="set-quest-2" onClick={() => setActiveQuest(2)}>q2</button>
      <button data-testid="award-1star" onClick={() => awardXP(150, 5, 1, 420)}>1★</button>
      <button data-testid="award-2stars" onClick={() => awardXP(300, 5, 2, 375)}>2★</button>
      <button data-testid="award-3stars" onClick={() => awardXP(450, 5, 3, 340)}>3★</button>
      <button data-testid="award-new-scenario" onClick={() => awardXP(300, 8, 2, 490)}>sc8</button>
      <button data-testid="set-view-lab" onClick={() => setView("lab")}>lab</button>
    </div>
  );
}

function wrap(children: ReactNode = <Consumer />) {
  return render(<GamificationProvider>{children}</GamificationProvider>);
}

// ── Initial state ─────────────────────────────────────────────────────────────

describe("GamificationContext — initial state", () => {
  it("starts with xp=0, level=1, activeQuestId=1", () => {
    wrap();
    expect(screen.getByTestId("xp")).toHaveTextContent("0");
    expect(screen.getByTestId("level")).toHaveTextContent("1");
    expect(screen.getByTestId("quest")).toHaveTextContent("1");
  });

  it("starts with empty solvedScenarios and badges", () => {
    wrap();
    expect(screen.getByTestId("solved-count")).toHaveTextContent("0");
    expect(screen.getByTestId("badges")).toHaveTextContent("");
  });

  it("starts with activeView='dash'", () => {
    wrap();
    expect(screen.getByTestId("view")).toHaveTextContent("dash");
  });
});

// ── SET_VIEW ──────────────────────────────────────────────────────────────────

describe("GamificationContext — setView", () => {
  it("changes activeView when setView is called", async () => {
    wrap();
    await userEvent.click(screen.getByTestId("set-view-lab"));
    expect(screen.getByTestId("view")).toHaveTextContent("lab");
  });
});

// ── SET_QUEST ─────────────────────────────────────────────────────────────────

describe("GamificationContext — setActiveQuest", () => {
  it("updates activeQuestId from 1 to 2", async () => {
    wrap();
    await userEvent.click(screen.getByTestId("set-quest-2"));
    expect(screen.getByTestId("quest")).toHaveTextContent("2");
  });

  it("can switch back from 2 to 1", async () => {
    wrap();
    await userEvent.click(screen.getByTestId("set-quest-2"));
    await userEvent.click(screen.getByTestId("set-quest-1"));
    expect(screen.getByTestId("quest")).toHaveTextContent("1");
  });

  it("does not throw or error when called with the current questId (bail-out guard)", async () => {
    wrap();
    // Already at quest 1 — calling again should be a no-op, not an error
    await userEvent.click(screen.getByTestId("set-quest-1"));
    expect(screen.getByTestId("quest")).toHaveTextContent("1");
  });
});

// ── AWARD_XP ─────────────────────────────────────────────────────────────────

describe("GamificationContext — awardXP", () => {
  it("increments xp by the awarded amount", async () => {
    wrap();
    await userEvent.click(screen.getByTestId("award-1star"));
    expect(screen.getByTestId("xp")).toHaveTextContent("150");
  });

  it("accumulates xp across multiple awards", async () => {
    wrap();
    await userEvent.click(screen.getByTestId("award-1star")); // +150
    await userEvent.click(screen.getByTestId("award-new-scenario")); // +300
    expect(screen.getByTestId("xp")).toHaveTextContent("450");
  });

  it("records the solved scenario with correct stars", async () => {
    wrap();
    await userEvent.click(screen.getByTestId("award-2stars"));
    expect(screen.getByTestId("solved-count")).toHaveTextContent("1");
    expect(screen.getByTestId("solved-stars")).toHaveTextContent("2");
  });

  it("keeps the best star count when the same scenario is solved again with fewer stars", async () => {
    wrap();
    await userEvent.click(screen.getByTestId("award-3stars")); // scenario 5 → 3 stars
    await userEvent.click(screen.getByTestId("award-1star")); // scenario 5 → 1 star (should NOT downgrade)
    expect(screen.getByTestId("solved-stars")).toHaveTextContent("3");
  });

  it("awards 'first_solve' badge on the first solve", async () => {
    wrap();
    await userEvent.click(screen.getByTestId("award-1star"));
    expect(screen.getByTestId("badges")).toHaveTextContent("first_solve");
  });

  it("awards 'three_stars' badge when any scenario gets 3 stars", async () => {
    wrap();
    await userEvent.click(screen.getByTestId("award-3stars"));
    expect(screen.getByTestId("badges")).toHaveTextContent("three_stars");
  });

  it("does NOT award 'three_stars' badge for 2-star solves", async () => {
    wrap();
    await userEvent.click(screen.getByTestId("award-2stars"));
    expect(screen.getByTestId("badges")).not.toHaveTextContent("three_stars");
  });

  it("advances level when XP crosses the Level 2 threshold", async () => {
    // XP_THRESHOLDS[1] = 500; award 2★ (300) then 1★ (150) + 1★ more = 600 total
    wrap();
    await userEvent.click(screen.getByTestId("award-2stars")); // +300 xp (scenario 5)
    await userEvent.click(screen.getByTestId("award-new-scenario")); // +300 xp (scenario 8)
    expect(Number(screen.getByTestId("xp").textContent)).toBeGreaterThanOrEqual(XP_THRESHOLDS[1]);
    expect(screen.getByTestId("level")).toHaveTextContent("2");
  });
});

// ── XP_THRESHOLDS contract ────────────────────────────────────────────────────

describe("GamificationContext — XP_THRESHOLDS", () => {
  it("has 10 thresholds (levels 1–10)", () => {
    expect(XP_THRESHOLDS).toHaveLength(10);
  });

  it("starts at 0 for level 1", () => {
    expect(XP_THRESHOLDS[0]).toBe(0);
  });

  it("is strictly increasing", () => {
    for (let i = 1; i < XP_THRESHOLDS.length; i++) {
      expect(XP_THRESHOLDS[i]).toBeGreaterThan(XP_THRESHOLDS[i - 1]);
    }
  });
});
