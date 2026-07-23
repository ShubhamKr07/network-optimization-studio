import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("wouter", () => ({
  useSearch: vi.fn(() => ""),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

const mockSolveScenario = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };
const mockCompareScenarios = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(),
  useCompareScenarios: vi.fn(() => mockCompareScenarios),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
}));

import { useListScenarios, useGetSolveJob } from "@workspace/api-client-react";
import type { Scenario, SolveResult } from "@workspace/api-client-react";
import { Compare } from "@/pages/Compare";

const mockUseListScenarios = vi.mocked(useListScenarios);
const mockUseGetSolveJob = vi.mocked(useGetSolveJob);

const baseInputs = {
  p: 4,
  distanceBands: [200, 400, 800],
  capacityMode: "none",
  uniformCapacity: null,
  warehouseOverrides: [],
  customerOverrides: [],
  gap: 0,
  timeLimitSec: 120,
};

function pmedianResult(objective: number, openId: string): SolveResult {
  return {
    status: "optimal",
    objective,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [
      { fromId: openId, toId: "c1", flow: 10, distance: 100 },
      { fromId: openId, toId: "c2", flow: 10, distance: 200 },
    ],
    metrics: { weightedAvgDistance: 150, bandCoverage: [{ band: 200, percent: 50 }] },
    details: {},
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };
}

const scenarioP4: Scenario = {
  id: 1,
  name: "P=4",
  modelId: "p-median-us",
  inputs: { ...baseInputs, p: 4 },
  result: pmedianResult(200000, "CHI"),
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  stale: false,
};

const scenarioP5: Scenario = {
  id: 2,
  name: "P=5",
  modelId: "p-median-us",
  inputs: { ...baseInputs, p: 5 },
  result: pmedianResult(150000, "ATL"),
  createdAt: "2026-01-02T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  stale: false,
};

const unsolvedScenario: Scenario = {
  id: 3,
  name: "Unsolved draft",
  modelId: "p-median-us",
  inputs: { ...baseInputs, p: 6 },
  result: null,
  createdAt: "2026-01-03T00:00:00Z",
  updatedAt: "2026-01-03T00:00:00Z",
  stale: false,
};

const staleScenario: Scenario = {
  id: 4,
  name: "Stale one",
  modelId: "p-median-us",
  inputs: { ...baseInputs, p: 7 },
  result: pmedianResult(180000, "CHI"),
  createdAt: "2026-01-04T00:00:00Z",
  updatedAt: "2026-01-05T00:00:00Z",
  stale: true,
};

const brazilScenario: Scenario = {
  id: 9,
  name: "Brazil scenario",
  modelId: "p-median-brazil",
  inputs: { p: 2 },
  result: null,
  createdAt: "2026-01-06T00:00:00Z",
  updatedAt: "2026-01-06T00:00:00Z",
  stale: false,
};

function setScenarios(list: Scenario[]) {
  mockUseListScenarios.mockReturnValue({ data: list, isLoading: false } as ReturnType<typeof useListScenarios>);
}

beforeEach(() => {
  mockSolveScenario.mutate.mockReset();
  mockCompareScenarios.mutate.mockReset();
  mockUseGetSolveJob.mockReturnValue({ data: undefined } as ReturnType<typeof useGetSolveJob>);
});

describe("Compare — picker filtering (same model_id only)", () => {
  it("only lists scenarios sharing the selected model in the picker, never mixing models", () => {
    setScenarios([scenarioP4, scenarioP5, brazilScenario]);
    render(<Compare />);

    expect(screen.getByTestId("checkbox-scenario-1")).toBeInTheDocument();
    expect(screen.getByTestId("checkbox-scenario-2")).toBeInTheDocument();
    expect(screen.queryByTestId("checkbox-scenario-9")).not.toBeInTheDocument();
  });

  it("shows a model selector when the user has scenarios for more than one model", () => {
    setScenarios([scenarioP4, scenarioP5, brazilScenario]);
    render(<Compare />);
    expect(screen.getByTestId("select-model")).toBeInTheDocument();
  });
});

describe("Compare — needs-solving chip + one-click solve", () => {
  it("shows a Needs solving chip and Solve button for an unsolved selected scenario, no numbers", async () => {
    setScenarios([scenarioP4, unsolvedScenario]);
    render(<Compare />);

    // default selection includes both since only two scenarios exist for this model
    expect(screen.getByTestId("badge-needs-solving-3")).toBeInTheDocument();
    expect(screen.getByTestId("button-solve-3")).toBeInTheDocument();
    // no output numbers for the unsolved column
    expect(within(screen.getByTestId("output-objective-3")).getByText("—")).toBeInTheDocument();

    mockSolveScenario.mutate.mockImplementation((vars: { scenarioId: number }, opts: { onSuccess: (r: { jobId: number }) => void }) => {
      expect(vars).toEqual({ scenarioId: 3 });
      opts.onSuccess({ jobId: 42 });
    });
    await userEvent.click(screen.getByTestId("button-solve-3"));
    expect(mockSolveScenario.mutate).toHaveBeenCalledWith({ scenarioId: 3 }, expect.anything());
  });

  it("shows a Stale chip (X1.1 convention: badge-stale-{id}) with a Re-solve action for a stale selected scenario", () => {
    setScenarios([scenarioP4, staleScenario]);
    render(<Compare />);

    expect(screen.getByTestId("badge-stale-4")).toBeInTheDocument();
    expect(screen.getByTestId("button-solve-4")).toHaveTextContent("Re-solve");
  });
});

describe("Compare — p 4→5 diff (PRD acceptance)", () => {
  it("highlights exactly the p input row and shows objective delta / site added / reassigned count", () => {
    setScenarios([scenarioP4, scenarioP5]);
    render(<Compare />);

    // Input diff: p row highlighted (not de-emphasized), sibling rows are.
    const pCellA = screen.getByTestId("input-diff-p-1");
    const pCellB = screen.getByTestId("input-diff-p-2");
    expect(pCellA).not.toHaveClass("text-muted-foreground");
    expect(pCellB).not.toHaveClass("text-muted-foreground");
    expect(pCellA).toHaveTextContent("4");
    expect(pCellB).toHaveTextContent("5");

    const gapCellA = screen.getByTestId("input-diff-gap-1");
    expect(gapCellA).toHaveClass("text-muted-foreground");

    // Output diff: objective delta shown for the non-baseline column.
    expect(screen.getByTestId("output-objective-2")).toHaveTextContent("150000");
    expect(screen.getByTestId("output-objective-2")).toHaveTextContent("-50000");

    // Site added: scenario 2 opens ATL (not open in baseline scenario 1's CHI-only network).
    expect(screen.getByTestId("output-sites-added-2")).toHaveTextContent("+ATL");

    // Reassigned customers: both of scenario 1's customers move to ATL in scenario 2.
    expect(screen.getByTestId("output-reassigned-2")).toHaveTextContent("2");
  });

  it("de-emphasizes identical values when scenarios are otherwise the same", () => {
    const twin = { ...scenarioP4, id: 5, name: "P=4 twin" };
    setScenarios([scenarioP4, twin]);
    render(<Compare />);
    const pCellA = screen.getByTestId("input-diff-p-1");
    const pCellB = screen.getByTestId("input-diff-p-5");
    expect(pCellA).toHaveClass("text-muted-foreground");
    expect(pCellB).toHaveClass("text-muted-foreground");
  });
});
