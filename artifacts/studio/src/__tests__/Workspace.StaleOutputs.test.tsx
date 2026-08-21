import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// A3.2 — Stale-state consumption at the Workspace level: `hasSolvedRun`
// (A0.1, `result != null`) is necessary but not sufficient — a scenario can
// have a non-null `result` and still be `stale` (X1.1). The correct
// "outputs are fresh and viewable" condition is `result != null &&
// !stale`, and it must drive BOTH the sidebar's Outputs greying AND the
// Output Map tab's content (blanked behind StaleOutputBanner instead of
// OutputMapTab's real content). Kept in its own file (own fixtures/mocks,
// dynamic `vi.fn()` hook mocks so scenario data can change between
// assertions within one test) rather than appended to Workspace.test.tsx
// (whose shared fixture always carries `result: null`) or
// Workspace.OutputMap.test.tsx (whose shared fixture always carries
// `stale: false`).

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-3", vi.fn()],
}));

const mockQueryClient = { invalidateQueries: vi.fn() };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

const pmedianInputs = {
  p: 1,
  distanceBands: [250, 500, 750],
  capacityMode: "none",
  uniformCapacity: null,
  warehouseOverrides: [{ id: "CHI", status: "forced_open" }],
  customerOverrides: [],
  gap: 0,
  timeLimitSec: 120,
};

const solvedResult = {
  status: "optimal" as const,
  objective: 12345,
  runTimeSec: 0.5,
  quality: "Optimal",
  edges: [{ fromId: "CHI", toId: "C1", flow: 100, distance: 900 }],
  metrics: { weightedAvgDistance: 900, bandCoverage: [], utilizationByNode: [] },
  details: { openWarehouseIds: ["CHI"], assignments: [] },
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};

const baseScenario = {
  id: 1,
  name: "3 Warehouses",
  modelId: "p-median-us",
  inputs: pmedianInputs,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const unsolvedScenario = { ...baseScenario, result: null, stale: false };
const staleSolvedScenario = { ...baseScenario, result: solvedResult, stale: true };
const freshSolvedScenario = { ...baseScenario, result: solvedResult, stale: false };

const dataset = {
  warehouses: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }],
  customers: [{ id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 }],
};

const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockSolveScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(),
  useGetScenario: vi.fn(),
  useGetDataset: vi.fn(() => ({ data: dataset })),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  useListModels: vi.fn(() => ({ data: [{ id: "p-median-us", countryBounds: { sw: [24, -125], ne: [50, -66] } }] })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
}));

import { Workspace } from "@/pages/Workspace";
import { useGetScenario, useListScenarios, useGetSolveJob } from "@workspace/api-client-react";

const mockUseGetScenario = vi.mocked(useGetScenario);
const mockUseListScenarios = vi.mocked(useListScenarios);
const mockUseGetSolveJob = vi.mocked(useGetSolveJob);

function mockScenario(scenario: typeof unsolvedScenario | typeof staleSolvedScenario | typeof freshSolvedScenario) {
  mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
  mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof useListScenarios>);
}

function renderWorkspace() {
  return render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseGetSolveJob.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGetSolveJob>);
});

describe("Workspace — stale-state consumption (A3.2)", () => {
  it("greys the sidebar Outputs section when the scenario is unsolved (result == null) — no regression on A0.1's behavior", () => {
    mockScenario(unsolvedScenario);
    renderWorkspace();
    const output = screen.getByTestId("sidebar-output-output-map");
    expect(output).toBeDisabled();
    expect(output).toHaveAttribute("aria-disabled", "true");
  });

  it("ALSO greys the sidebar Outputs section when result != null but stale === true (new case)", () => {
    mockScenario(staleSolvedScenario);
    renderWorkspace();
    const output = screen.getByTestId("sidebar-output-output-map");
    expect(output).toBeDisabled();
    expect(output).toHaveAttribute("aria-disabled", "true");
  });

  it("does NOT grey the sidebar Outputs section when result != null and stale === false", () => {
    mockScenario(freshSolvedScenario);
    renderWorkspace();
    const output = screen.getByTestId("sidebar-output-output-map");
    expect(output).not.toBeDisabled();
    expect(output).toHaveAttribute("aria-disabled", "false");
  });

  it("shows the real OutputMapTab content, with no stale banner, when the scenario is solved and fresh", () => {
    mockScenario(freshSolvedScenario);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(screen.getByTestId("output-map-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("stale-output-banner")).not.toBeInTheDocument();
  });

  it("blanks the Output Map tab behind the stale banner (instead of real content) when it's active on a stale-but-solved scenario, and the banner's Run Optimizer CTA opens the same Solve dialog", () => {
    mockScenario(staleSolvedScenario);
    mockSolveScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (r: { jobId: number }) => void }) => {
      opts.onSuccess({ jobId: 7 });
    });
    // The Output Map tab auto-opens+activates on a successful solve
    // regardless of the resulting scenario's freshness (Workspace.tsx's
    // jobStatus effect has no freshness gate of its own — the freshness
    // check lives purely in what renderTabContent() shows for whichever
    // tab happens to be active). This is the realistic way an already-open
    // Output Map tab ends up showing a stale scenario's content: solved
    // once (opens the tab), inputs edited+saved again afterward (stale
    // flips true), tab stays open showing the now-stale scenario.
    mockUseGetSolveJob.mockImplementation((_scenarioId: number, jobId: number) =>
      (jobId
        ? { data: { id: 7, status: "succeeded", error: null, resultSummary: null } }
        : { data: undefined }) as unknown as ReturnType<typeof useGetSolveJob>,
    );

    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    expect(screen.queryByTestId("output-map-tab")).not.toBeInTheDocument();
    const banner = screen.getByTestId("stale-output-banner");
    expect(banner).toBeInTheDocument();
    expect(screen.getByText(/inputs changed since last solve/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-stale-banner-run-optimizer"));
    expect(screen.getByTestId("solve-dialog")).toBeInTheDocument();
  });
});
