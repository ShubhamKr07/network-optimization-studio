import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// A5.1 — Workspace-level integration coverage for the transport-coal fast-
// follow flip: Mines/Stations tabs (not Warehouses/Customers), no P field
// anywhere, model-specific solve params, and create-scenario using
// Studio.tsx's own transport-coal default inputs verbatim.

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-5/transport", mockNavigate],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn() };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

const transportInputs = {
  distanceBands: [500, 1000, 1500, 2000],
  gap: 0,
  timeLimitSec: 120,
  capacityFactor: 1.0,
  singleSource: false,
  capacityInactive: false,
  mineCapacities: { M1: 5000 },
  stationDemands: {},
};

const scenario = {
  id: 1,
  name: "Base case",
  modelId: "transport-coal",
  inputs: transportInputs,
  result: null,
  stale: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const dataset = {
  warehouses: [{ id: "M1", city: "Gillette", state: "WY", lat: 44.29, lng: -105.5 }],
  customers: [{ id: "S1", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62, demand: 1000 }],
};

const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCreateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(() => ({ data: [scenario] })),
  useGetScenario: vi.fn(() => ({ data: scenario })),
  useGetDataset: vi.fn(() => ({ data: dataset })),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useCloneScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useResetScenarioToBaseline: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  useListModels: vi.fn(() => ({ data: [{ id: "transport-coal", countryBounds: { sw: [24, -125], ne: [50, -66] } }] })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  getGetDatasetQueryKey: vi.fn(() => ["dataset"]),
  usePrecheckScenario: vi.fn(() => ({ data: { ok: true, errors: [] } })),
  getPrecheckScenarioQueryKey: vi.fn((id: number) => ["precheck", id]),
  useLogoutUser: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
}));

import { Workspace } from "@/pages/Workspace";

function renderWorkspace() {
  return render(<Workspace modelId="transport-coal" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockCreateScenario.mutate.mockReset();
});

describe("Workspace — transport-coal (A5.1)", () => {
  it("shows Mines/Stations sidebar entries, not Warehouses/Customers", () => {
    renderWorkspace();
    expect(screen.getByTestId("sidebar-input-mines")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-input-stations")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-input-warehouses")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-input-customers")).not.toBeInTheDocument();
  });

  it("opening the Mines tab renders the real MineTable with the dataset's mines and the current capacity override", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-mines"));
    expect(screen.getByText("M1")).toBeInTheDocument();
    expect(screen.getByTestId("input-mine-capacity-M1")).toHaveValue(5000);
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("opening the Stations tab renders the real StationTable", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-stations"));
    expect(screen.getByText("S1")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("editing a mine capacity and saving PATCHes mineCapacities as a dict, not an array", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-mines"));
    fireEvent.change(screen.getByTestId("input-mine-capacity-M1"), { target: { value: "8000" } });
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: { inputs: expect.objectContaining({ mineCapacities: { M1: 8000 } }) },
    });
  });

  it("Mines tab's Export/Import toolbar is scoped to entity=mines, Stations to entity=stations", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-mines"));
    expect(screen.getByTestId("button-export-mines-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-mines")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sidebar-input-stations"));
    expect(screen.getByTestId("button-export-stations-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-stations")).toBeInTheDocument();
  });

  it("Optimization Parameters tab has no P field (supportsP: false) but shows capacityFactor/singleSource/capacityInactive", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.queryByTestId("text-p-value")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slider-p-value")).not.toBeInTheDocument();
    expect(screen.getByTestId("slider-capacity-factor")).toBeInTheDocument();
    expect(screen.getByTestId("switch-single-source")).toBeInTheDocument();
    expect(screen.getByTestId("switch-capacity-inactive")).toBeInTheDocument();
    expect(screen.queryByTestId("slider-bom-ratio")).not.toBeInTheDocument();
  });

  it("Solve dialog also has no P field for transport-coal", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    expect(screen.queryByTestId("solve-dialog-p-value")).not.toBeInTheDocument();
    expect(screen.queryByTestId("solve-dialog-slider-p")).not.toBeInTheDocument();
  });

  // Task 30 (B6.1 stage 4) — transport-coal's Distances placeholder is gone;
  // it's now a real "Lane costs" entry/tab (its own entity id, not the
  // shared "distances" one p-median-us uses) — see Workspace.test.tsx's
  // "transport-coal Mines/Stations/Lane costs tabs (Task 30)" block for full
  // grid-behavior coverage. This test now just pins that the OLD placeholder
  // entry id no longer exists for this model.
  it("has no 'distances' sidebar entry — it's 'laneCosts' now (Task 30)", () => {
    renderWorkspace();
    expect(screen.queryByTestId("sidebar-input-distances")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-input-laneCosts")).toBeInTheDocument();
  });

  it("create-scenario uses Studio.tsx's own transport-coal default inputs verbatim", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-create-scenario"));
    fireEvent.click(screen.getByTestId("button-create-confirm"));

    expect(mockCreateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockCreateScenario.mutate.mock.calls[0];
    expect(args.data.modelId).toBe("transport-coal");
    expect(args.data.inputs).toEqual({
      distanceBands: [500, 1000, 1500, 2000],
      gap: 0,
      timeLimitSec: 120,
      capacityFactor: 1.0,
      singleSource: false,
      capacityInactive: false,
    });
  });
});
