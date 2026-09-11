import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// POSTHOG-5 — funnel-event tracking wired into Workspace.tsx at its
// already-confirmed chokepoints (handleSolve, handleAddedArrayChange, the
// TabBar onActivate handler). Mocking harness mirrors
// Workspace.test.tsx/Workspace.StaleOutputs.test.tsx's established pattern
// (mock the generated API-client hooks, real component tree).
// POSTHOG-6 extends this same file with "override edited"/"distance
// override set" coverage.

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-3", vi.fn()],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn(), removeQueries: vi.fn() };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

const mockTrack = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...args: unknown[]) => mockTrack(...args) }));

const pmedianInputs = {
  p: 3,
  distanceBands: [200, 400, 800, 1600],
  capacityMode: "none",
  uniformCapacity: null,
  warehouseOverrides: [],
  customerOverrides: [],
  gap: 0,
  timeLimitSec: 120,
};

const baseScenario = {
  id: 1,
  name: "3 Warehouses",
  modelId: "p-median-us",
  inputs: pmedianInputs,
  result: null,
  stale: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
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

const staleSolvedScenario = { ...baseScenario, result: solvedResult, stale: true };

const dataset = {
  warehouses: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }],
  customers: [{ id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 }],
};

const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockSolveScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCreateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCloneScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockDeleteScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(() => ({ data: [baseScenario] })),
  useGetScenario: vi.fn(() => ({ data: baseScenario })),
  useGetDataset: vi.fn(() => ({ data: dataset })),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useCloneScenario: vi.fn(() => mockCloneScenario),
  useDeleteScenario: vi.fn(() => mockDeleteScenario),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  useGetReferenceDistances: vi.fn(() => ({ data: undefined })),
  getGetReferenceDistancesQueryKey: vi.fn((id: string) => ["reference-distances", id]),
  useListModels: vi.fn(() => ({
    data: [
      {
        id: "p-median-us",
        countryBounds: { sw: [24, -125], ne: [50, -66] },
        capabilities: {
          supportsP: true,
          capacityModes: ["none", "uniform", "per_wh"],
          demandEditable: true,
          outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
          supportsFacilityStatus: true,
          supportsReferenceDistances: true,
          supportsAddedCustomerExclusion: true,
        },
      },
    ],
  })),
  usePrecheckScenario: vi.fn(() => ({ data: { ok: true, errors: [] } })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  getGetDatasetQueryKey: vi.fn(() => ["dataset"]),
  getPrecheckScenarioQueryKey: vi.fn((id: number) => ["precheck", id]),
}));

import { Workspace } from "@/pages/Workspace";
import { useGetSolveJob, useGetScenario, useListScenarios } from "@workspace/api-client-react";

const mockUseGetSolveJob = vi.mocked(useGetSolveJob);
const mockUseGetScenario = vi.mocked(useGetScenario);
const mockUseListScenarios = vi.mocked(useListScenarios);

function renderWorkspace() {
  return render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
}

function mockScenario(scenario: typeof baseScenario | typeof staleSolvedScenario) {
  mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
  mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof useListScenarios>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockSolveScenario.mutate.mockReset();
  mockUpdateScenario.isPending = false;
  mockSolveScenario.isPending = false;
  mockUseGetSolveJob.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGetSolveJob>);
  mockScenario(baseScenario);
});

describe("Workspace — analytics: solve funnel (POSTHOG-5)", () => {
  it("tracks 'solve triggered' on solve", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith(
        "solve triggered",
        expect.objectContaining({ scenario_id: 1, model_id: "p-median-us" }),
      ),
    );
  });

  it("also tracks 'scenario stale resolved' when the scenario was stale", async () => {
    mockScenario(staleSolvedScenario);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith(
        "scenario stale resolved",
        expect.objectContaining({ scenario_id: 1, model_id: "p-median-us" }),
      ),
    );
  });

  it("does NOT track 'scenario stale resolved' when the scenario was not stale", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith("solve triggered", expect.anything()),
    );
    expect(mockTrack).not.toHaveBeenCalledWith("scenario stale resolved", expect.anything());
  });
});

describe("Workspace — analytics: map entity added (POSTHOG-5)", () => {
  it("tracks 'map entity added' when an added-entity array grows (warehouses)", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));
    fireEvent.change(screen.getByTestId("input-new-warehouse-city"), { target: { value: "Denver" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-state"), { target: { value: "CO" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-lat"), { target: { value: "39.74" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-lng"), { target: { value: "-104.99" } });
    fireEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith(
        "map entity added",
        expect.objectContaining({ entity: "warehouses", model_id: "p-median-us" }),
      ),
    );
  });

  it("does NOT track 'map entity added' on an edit (array does not grow)", async () => {
    mockScenario({
      ...baseScenario,
      inputs: { ...pmedianInputs, warehouseOverrides: [{ id: "CHI", status: "forced_open" }] },
    } as unknown as typeof baseScenario);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    fireEvent.click(screen.getByTestId("button-wh-CHI-inactive"));

    expect(mockTrack).not.toHaveBeenCalledWith("map entity added", expect.anything());
  });
});

describe("Workspace — analytics: tab activation (POSTHOG-5)", () => {
  it("tracks 'scenario tab viewed' on tab activation", async () => {
    renderWorkspace();
    // Open a second tab (Warehouses) alongside the auto-seeded Input Map tab —
    // opening via the sidebar activates it directly (not through TabBar's
    // onActivate), so no track call is expected from this click itself.
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    mockTrack.mockClear();

    // Now activate the (now-inactive) Input Map tab from the tab strip —
    // this goes through TabBar's onActivate -> handleActivateTab.
    fireEvent.click(screen.getByTestId("tab-input:input-map"));

    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith(
        "scenario tab viewed",
        expect.objectContaining({ tab: "input:input-map", model_id: "p-median-us" }),
      ),
    );
  });
});

// POSTHOG-6's "override edited"/"distance override set" tests are appended
// to this same file by that task (extends this file, per the plan).
