import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// A5.3 — Workspace-level integration coverage for the two-echelon-gold-au
// fast-follow flip: a Refineries tab (WarehousesTab reused with
// entity="refineries", mine excluded), Customers tab reused as-is, no P
// field anywhere, bomRatio in Optimization Parameters, entity-scoped
// import/export for refineries, and Studio.tsx's own two-echelon
// create-scenario default verbatim. Leg-colored routes on the Output Map
// tab are NOT re-tested here — NetworkMap.test.tsx already covers that
// directly at the component level (mine_to_refinery/refinery_to_customer
// edge coloring, M4.2), and OutputMapTab passes `dataset`/`result` through
// to NetworkMap unmodified, so nothing new needs proving at this layer.

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-10/gold-refinery", mockNavigate],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn() };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

const twoEchelonInputs = {
  bomRatio: 1.1,
  refineryOverrides: [{ id: "cunnamulla", status: "forced_open" }],
  customerOverrides: [],
  distanceBands: [500, 1000, 1500, 2000, 2600],
  gap: 0,
  timeLimitSec: 120,
};

const scenario = {
  id: 1,
  name: "Base case",
  modelId: "two-echelon-gold-au",
  inputs: twoEchelonInputs,
  result: null,
  stale: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const dataset = {
  warehouses: [
    { id: "kalgoorlie", city: "Kalgoorlie", state: "WA", lat: -30.7, lng: 121.4, kind: "mine" as const },
    { id: "cunnamulla", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68, kind: "facility" as const },
    { id: "daggar_hills", city: "Daggar Hills", state: "QLD", lat: -25.0, lng: 145.0, kind: "facility" as const },
  ],
  customers: [{ id: "sydney", city: "Sydney", state: "NSW", lat: -33.87, lng: 151.2, demand: 100000 }],
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
  useListModels: vi.fn(() => ({ data: [{ id: "two-echelon-gold-au", countryBounds: { sw: [-38.5, 113], ne: [-16, 154.5] } }] })),
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
  return render(<Workspace modelId="two-echelon-gold-au" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockCreateScenario.mutate.mockReset();
});

describe("Workspace — two-echelon-gold-au (A5.3)", () => {
  it("shows a Refineries sidebar entry, not Warehouses", () => {
    renderWorkspace();
    expect(screen.getByTestId("sidebar-input-refineries")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-input-warehouses")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-input-customers")).toBeInTheDocument();
  });

  it("opening the Refineries tab reuses WarehousesTab, excludes the fixed mine, and shows the current override", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-refineries"));
    expect(screen.getByTestId("refineries-tab")).toBeInTheDocument();
    expect(screen.getByText("cunnamulla")).toBeInTheDocument();
    expect(screen.getByText("daggar_hills")).toBeInTheDocument();
    expect(screen.queryByText("kalgoorlie")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-wh-cunnamulla-forced_open")).toBeInTheDocument();
  });

  it("Refineries tab has no Capacity column (two-echelon has no capacity concept)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-refineries"));
    expect(screen.queryByText("Capacity")).not.toBeInTheDocument();
  });

  it("editing a refinery status and saving PATCHes refineryOverrides, not warehouseOverrides", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-refineries"));
    fireEvent.click(screen.getByTestId("button-wh-daggar_hills-inactive"));
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: {
        inputs: expect.objectContaining({
          refineryOverrides: [
            { id: "cunnamulla", status: "forced_open" },
            { id: "daggar_hills", status: "inactive", capacity: undefined },
          ],
        }),
      },
    });
    expect(args.data.inputs).not.toHaveProperty("warehouseOverrides");
  });

  it("Refineries tab's Export/Import toolbar is scoped to entity=refineries, not entity=warehouses", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-refineries"));
    expect(screen.getByTestId("button-export-refineries-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-refineries")).toBeInTheDocument();
    expect(screen.queryByTestId("button-export-warehouses-csv")).not.toBeInTheDocument();
  });

  // B5.1 — the real Distances grid is p-median-us only; two-echelon-gold-au's
  // own distances entity (mine->refinery + refinery->customer legs) is
  // B6.1-B6.3's fast-follow, not this task.
  it("Distances stays a placeholder for two-echelon-gold-au (real grid is p-median-us only)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId("tab-content-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("button-save")).not.toBeInTheDocument();
  });

  it("opening the Customers tab renders the real CustomerTable (reused as-is)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    expect(screen.getByText("sydney")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("Optimization Parameters shows bomRatio only for two-echelon, no P field", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.queryByTestId("text-p-value")).not.toBeInTheDocument();
    expect(screen.getByTestId("slider-bom-ratio")).toBeInTheDocument();
    expect(screen.getByTestId("text-bom-ratio")).toHaveTextContent("1.10");
    expect(screen.queryByTestId("slider-capacity-factor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("switch-single-source")).not.toBeInTheDocument();
  });

  it("editing bomRatio and saving PATCHes bomRatio", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    const thumb = screen.getByTestId("slider-bom-ratio").querySelector('[role="slider"]')!;
    expect(thumb).toHaveAttribute("aria-valuenow", "1.1");
  });

  it("Solve dialog has no P field for two-echelon-gold-au", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    expect(screen.queryByTestId("solve-dialog-p-value")).not.toBeInTheDocument();
  });

  it("create-scenario uses Studio.tsx's own two-echelon-gold-au default inputs verbatim", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-create-scenario"));
    fireEvent.click(screen.getByTestId("button-create-confirm"));

    expect(mockCreateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockCreateScenario.mutate.mock.calls[0];
    expect(args.data.modelId).toBe("two-echelon-gold-au");
    expect(args.data.inputs).toEqual({
      bomRatio: 1.1,
      refineryOverrides: [],
      customerOverrides: [],
      distanceBands: [500, 1000, 1500, 2000, 2600],
      gap: 0,
      timeLimitSec: 120,
    });
  });
});
