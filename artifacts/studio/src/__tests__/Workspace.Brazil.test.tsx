import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// A5.2 — Workspace-level integration coverage for the p-median-brazil
// fast-follow flip: route flip, BrazilMap (not NetworkMap) on the Output Map
// tab, Warehouses/Customers entries present-but-placeholder (no dataset
// endpoint exists for this model — confirmed against openapi.yaml, not
// invented), P + singleSource in Optimization Parameters (no
// capacityFactor/capacityInactive/bomRatio), and Studio.tsx's own
// p-median-brazil create-scenario default verbatim.

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-5/brazil", mockNavigate],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn() };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

const brazilInputs = {
  p: 7,
  distanceBands: [500, 1000, 2000, 4000],
  capacityMode: "uniform",
  uniformCapacity: 20000000,
  warehouseOverrides: [],
  customerOverrides: [],
  gap: 0,
  timeLimitSec: 120,
  singleSource: true,
};

const solvedResult = {
  status: "optimal" as const,
  objective: 12345,
  runTimeSec: 0.5,
  quality: "Optimal",
  edges: [{ fromId: "WH1", toId: "C1", flow: 100, distance: 900 }],
  metrics: { weightedAvgDistance: 900, bandCoverage: [], utilizationByNode: [] },
  details: { openWarehouseIds: ["WH1"], assignments: [] },
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};

const unsolvedScenario = {
  id: 1,
  name: "Base case",
  modelId: "p-median-brazil",
  inputs: brazilInputs,
  result: null,
  stale: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const solvedScenario = { ...unsolvedScenario, result: solvedResult };

const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCreateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockUseGetScenario = vi.fn(() => ({ data: unsolvedScenario }));

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(() => ({ data: [unsolvedScenario] })),
  useGetScenario: () => mockUseGetScenario(),
  useGetDataset: vi.fn(() => ({ data: undefined })),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useCloneScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useResetScenarioToBaseline: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  useListModels: vi.fn(() => ({ data: [{ id: "p-median-brazil", countryBounds: { sw: [-30, -68], ne: [0, -35] } }] })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  getGetDatasetQueryKey: vi.fn(() => ["dataset"]),
  useLogoutUser: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
}));

import { Workspace } from "@/pages/Workspace";

function renderWorkspace() {
  return render(<Workspace modelId="p-median-brazil" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockCreateScenario.mutate.mockReset();
  mockUseGetScenario.mockReturnValue({ data: unsolvedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
});

describe("Workspace — p-median-brazil (A5.2)", () => {
  it("shows Warehouses/Customers sidebar entries (naming parity with the pilot)", () => {
    renderWorkspace();
    expect(screen.getByTestId("sidebar-input-warehouses")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-input-customers")).toBeInTheDocument();
  });

  it("Warehouses/Customers tabs show an honest placeholder, not the real WarehouseTable/CustomerTable (no dataset endpoint for this model)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(screen.getByTestId("tab-content-placeholder")).toBeInTheDocument();
    expect(screen.getByText(/not available for this model yet/)).toBeInTheDocument();
    expect(screen.queryByTestId("button-save")).not.toBeInTheDocument();
  });

  it("Optimization Parameters shows P and singleSource, but no capacityFactor/capacityInactive/bomRatio", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("text-p-value")).toHaveTextContent("7");
    expect(screen.getByTestId("switch-single-source")).toBeInTheDocument();
    expect(screen.queryByTestId("slider-capacity-factor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("switch-capacity-inactive")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slider-bom-ratio")).not.toBeInTheDocument();
  });

  it("Solve dialog shows the P field for p-median-brazil (supportsP: true)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    expect(screen.getByTestId("solve-dialog-p-value")).toHaveTextContent("7");
  });

  it("create-scenario uses Studio.tsx's own p-median-brazil default inputs verbatim", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-create-scenario"));
    fireEvent.click(screen.getByTestId("button-create-confirm"));

    expect(mockCreateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockCreateScenario.mutate.mock.calls[0];
    expect(args.data.modelId).toBe("p-median-brazil");
    expect(args.data.inputs).toEqual({
      p: 7,
      distanceBands: [500, 1000, 2000, 4000],
      capacityMode: "uniform",
      uniformCapacity: 20000000,
      warehouseOverrides: [],
      customerOverrides: [],
      gap: 0,
      timeLimitSec: 120,
      singleSource: true,
    });
  });

  it("Output Map tab renders BrazilMap once solved, without ever requiring GET /dataset to resolve", () => {
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(screen.getByTestId("brazil-map")).toBeInTheDocument();
    // BrazilMap's simplified toggle set: only Lanes, no Warehouses/Customers/
    // Color-by-band (BrazilMap has no such layers to toggle).
    expect(screen.getByTestId("checkbox-toggle-lanes")).toBeInTheDocument();
    expect(screen.queryByTestId("checkbox-toggle-warehouses")).not.toBeInTheDocument();
    expect(screen.queryByTestId("checkbox-toggle-customers")).not.toBeInTheDocument();
    expect(screen.queryByTestId("checkbox-color-lanes-band")).not.toBeInTheDocument();
  });

  it("Outputs stay greyed out pre-solve, same as every other model (hasSolvedRun doesn't depend on the disabled dataset query)", () => {
    renderWorkspace();
    expect(screen.getByTestId("sidebar-output-output-map")).toHaveAttribute("aria-disabled", "true");
  });
});
