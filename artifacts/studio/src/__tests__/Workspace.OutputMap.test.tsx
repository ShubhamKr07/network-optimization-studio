import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// A3.1 — Workspace-level integration coverage for the Output Map tab: opening
// the sidebar "Output Map" entry renders real content (not the generic
// placeholder), and a solved scenario's `result` only reaches the map while
// that tab is actually the active one (mirrors Studio.tsx's `activeTab ===
// "output" ? result : null` guard) so a stale result never bleeds into an
// unrelated tab. Kept in its own file (own fixtures/mocks) rather than
// appended to Workspace.test.tsx, whose shared `scenario` fixture always
// carries `result: null`.

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

const solvedScenario = {
  id: 1,
  name: "3 Warehouses",
  modelId: "p-median-us",
  inputs: pmedianInputs,
  result: solvedResult,
  stale: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const dataset = {
  warehouses: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }],
  customers: [{ id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 }],
};

const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockSolveScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(() => ({ data: [solvedScenario] })),
  useGetScenario: vi.fn(() => ({ data: solvedScenario })),
  useGetDataset: vi.fn(() => ({ data: dataset })),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useCreateScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useCloneScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useResetScenarioToBaseline: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  useListModels: vi.fn(() => ({ data: [{ id: "p-median-us", countryBounds: { sw: [24, -125], ne: [50, -66] } }] })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  useLogoutUser: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
  getGetDatasetQueryKey: vi.fn(() => ["dataset"]),
}));

import { Workspace } from "@/pages/Workspace";

function renderWorkspace() {
  return render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

function routePathCount(container: HTMLElement): number {
  const html = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
  return (html.match(/<path/g) ?? []).length;
}

describe("Workspace — Output Map tab (real content, not the placeholder)", () => {
  it("opening the sidebar 'Output Map' entry renders the real OutputMapTab, not the generic placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(screen.getByTestId("output-map-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("shows the solved result's routes once the Output Map tab is active", () => {
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(routePathCount(container)).toBe(1);
    expect(screen.queryByTestId("output-map-no-result")).not.toBeInTheDocument();
  });

  it("does NOT show the solved result's routes while a different tab is active — a stale result never bleeds into an unrelated tab", () => {
    const { container } = renderWorkspace();
    // Open Output Map first (result visible), then switch to an input tab —
    // the scenario stays solved throughout, only the active tab changes.
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(routePathCount(container)).toBe(1);

    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));

    // Output Map's own content (and its routes) must no longer be in the
    // tree at all once a different tab is active.
    expect(screen.queryByTestId("output-map-tab")).not.toBeInTheDocument();
    expect(container.querySelector(".leaflet-route-pane")).not.toBeInTheDocument();
  });

  it("reopening the Output Map tab after visiting another tab shows the result again", () => {
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(screen.getByTestId("output-map-tab")).toBeInTheDocument();
    expect(routePathCount(container)).toBe(1);
  });
});
