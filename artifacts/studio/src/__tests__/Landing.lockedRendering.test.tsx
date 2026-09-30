import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router as WouterRouter } from "wouter";
import type { Chapter } from "@/lib/chapters";

// ch9-unlock (2026-09-30) — Landing's locked-card and locked-history-row
// rendering, covered against a SYNTHETIC locked chapter.
//
// As of ch9-unlock no chapter ships locked, so `Landing.test.tsx` (which runs
// against the real CHAPTERS) can no longer reach any of this code. Deleting
// the coverage with the last locked chapter would be the wrong trade: the
// lock machinery is deliberately retained for the next migration quiesce
// (ch4-lock's Stage A is the documented pattern), and the day it is used
// again is exactly the day nobody wants to rediscover how the card is
// supposed to look.
//
// Its own file because `vi.mock` is file-wide — mocking CHAPTERS inside
// `Landing.test.tsx` would falsify every other case there.
//
// This is the Landing-side twin of `routes.test.ts`'s
// `setLockedModelsForTests` seam: both keep the lock's behaviour under test
// while nothing real is locked. `lockedChapterDrift.test.ts` is what pins the
// separate claim that the SHIPPED locked set is empty, so this file's fixture
// cannot be mistaken for a statement about what students see.

// Hoisted with the mocks: `vi.mock`'s factory is lifted above every
// module-level `const`, so a plain `const` fixture here would be a TDZ
// ReferenceError inside it.
//
// `as unknown as Chapter` is load-bearing, not laziness: `Chapter.modelId` is
// the closed `StudioModelType` union of real shipped model ids, and these
// fixtures deliberately sit OUTSIDE it. A fixture that borrowed a real id
// (say `two-echelon-jade-us`) would typecheck, and would then read as a claim
// that a shipped chapter is locked — the exact falsehood `lockedChapterDrift`
// exists to catch. An id that cannot be a real model can never be mistaken
// for one. Every other field matches `Chapter` exactly, so a change to the
// interface still surfaces here.
const { LOCKED_CHAPTER, OPEN_CHAPTER, mockUseGetSolveHistory, mockUseGetLandingSummary } = vi.hoisted(() => ({
  LOCKED_CHAPTER: {
    path: "/chapter-fixture",
    modelId: "fixture-locked-model",
    chapter: "Chapter 99",
    title: "Fixture Locked Lab",
    description: "Synthetic locked chapter — exists only in this test's mock.",
    workspace: true,
    locked: true,
    labHeaderTitle: "Fixture · Model Lab",
    labHeaderSubtitle: "Ch 99 · fixture",
  } as unknown as Chapter,
  OPEN_CHAPTER: {
    path: "/chapter-open-fixture",
    modelId: "fixture-open-model",
    chapter: "Chapter 98",
    title: "Fixture Open Lab",
    description: "Synthetic unlocked chapter — the control for every assertion below.",
    workspace: true,
    labHeaderTitle: "Fixture Open · Model Lab",
    labHeaderSubtitle: "Ch 98 · fixture",
  } as unknown as Chapter,
  mockUseGetSolveHistory: vi.fn(() => ({ data: [] as unknown[] })),
  mockUseGetLandingSummary: vi.fn(() => ({ data: undefined as unknown, isPending: false, isError: false })),
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetSolveHistory: mockUseGetSolveHistory,
  useGetLandingSummary: mockUseGetLandingSummary,
}));

// The real helpers are trivial lookups over CHAPTERS; re-deriving them from
// the fixture list keeps the mock honest rather than stubbing them to
// constants that could disagree with the list.
vi.mock("@/lib/chapters", () => {
  const chapters: Chapter[] = [LOCKED_CHAPTER, OPEN_CHAPTER];
  return {
    CHAPTERS: chapters,
    chapterForModelId: (modelId: string | undefined) => chapters.find(c => c.modelId === modelId),
    chapterPathForModelId: (modelId: string | undefined) => chapters.find(c => c.modelId === modelId)?.path,
  };
});

import { Landing } from "@/pages/Landing";
import { UnitProvider } from "@/contexts/UnitContext";

function renderLanding() {
  return render(
    <UnitProvider>
      <WouterRouter>
        <Landing />
      </WouterRouter>
    </UnitProvider>,
  );
}

function historyRow(id: number, scenarioId: number, modelId: string, scenarioName: string) {
  return {
    id, scenarioId, scenarioName, modelId,
    status: "succeeded", objective: 1, objectiveMode: null,
    weightedAvgDistance: 1, distanceUnit: "mi", runTimeSec: 1,
    queuedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:00:01Z",
  };
}

beforeEach(() => {
  mockUseGetSolveHistory.mockReturnValue({ data: [] });
  mockUseGetLandingSummary.mockReturnValue({ data: undefined, isPending: false, isError: false });
});

describe("Landing — a locked chapter's card", () => {
  // The three things that make a lock real rather than cosmetic: the card is
  // inert (no <Link>/href), it is visibly greyed, and it still RENDERS — a
  // lock is not the same as hiding, which `hiddenFromLanding` already does.
  it("renders but is not a link", () => {
    renderLanding();
    expect(screen.getByText(/Fixture Locked Lab/)).toBeInTheDocument();
    expect(screen.queryByTestId(`link-${LOCKED_CHAPTER.path}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`locked-${LOCKED_CHAPTER.path}`)).toBeInTheDocument();
    expect(screen.getByTestId(`landing-card-${LOCKED_CHAPTER.modelId}`)).toHaveAttribute("data-locked", "true");
  });

  it("is visibly greyed and shows a Locked badge", () => {
    renderLanding();
    expect(screen.getByTestId(`landing-card-${LOCKED_CHAPTER.modelId}`).className).toContain("opacity-60");
    expect(screen.getByTestId(`landing-card-locked-${LOCKED_CHAPTER.modelId}`)).toBeInTheDocument();
    expect(screen.getByTestId(`landing-card-footer-${LOCKED_CHAPTER.modelId}`)).toHaveTextContent("locked");
  });

  it("leaves a sibling unlocked chapter untouched", () => {
    renderLanding();
    expect(screen.getByTestId(`link-${OPEN_CHAPTER.path}`)).toHaveAttribute("href", OPEN_CHAPTER.path);
    expect(screen.queryByTestId(`locked-${OPEN_CHAPTER.path}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`landing-card-locked-${OPEN_CHAPTER.modelId}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`landing-card-${OPEN_CHAPTER.modelId}`)).not.toHaveAttribute("data-locked");
  });
});

describe("Landing — a locked chapter in Recent solves", () => {
  // The lock must hold on BOTH entry points. A locked card beside a clickable
  // history row into the same chapter would make the rule look arbitrary
  // rather than absent. The row still renders — it is the student's own solve
  // history, and hiding it would misreport what they did.
  it("renders the solve row but strips its link", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [historyRow(20, 7, LOCKED_CHAPTER.modelId, "Locked Base")],
    });
    renderLanding();
    expect(screen.getByText("Locked Base")).toBeInTheDocument();
    expect(screen.queryByTestId("link-solve-history-20")).not.toBeInTheDocument();
    expect(screen.getByTestId("locked-solve-history-20")).toBeInTheDocument();
  });

  it("still links an unlocked chapter's solve row (no collateral damage)", () => {
    mockUseGetSolveHistory.mockReturnValue({
      data: [historyRow(21, 8, OPEN_CHAPTER.modelId, "Open Base")],
    });
    renderLanding();
    expect(screen.getByTestId("link-solve-history-21"))
      .toHaveAttribute("href", `${OPEN_CHAPTER.path}?scenario=8`);
    expect(screen.queryByTestId("locked-solve-history-21")).not.toBeInTheDocument();
  });
});
