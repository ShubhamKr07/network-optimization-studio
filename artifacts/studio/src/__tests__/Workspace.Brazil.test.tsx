import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// A5.2 — Workspace-level integration coverage for the p-median-brazil
// fast-follow flip: route flip, Warehouses/Customers/Distances grid entries
// present-but-placeholder (the Input Map is this model's real editor — no
// override-editing UI built for the SEPARATE grid tabs yet), P + singleSource
// in Optimization Parameters (no capacityFactor/capacityInactive/bomRatio),
// and Studio.tsx's own p-median-brazil create-scenario default verbatim.
//
// T5 (Bundle 2) — Brazil got a real GET /dataset endpoint (T3) and the full
// v2 Input Map editor (place/move/edit/delete added warehouses+customers,
// same PMedianMapInputs surface as p-median-us), plus its demandEditable:
// false capability (textbook-fixed region demand) suppressing BASE-row
// demand edits while still requiring one for an ADDED customer. Output Map
// migrated off BrazilMap onto the shared NetworkMap (R7 parity) — see the
// dedicated describe blocks below.

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
  addedWarehouses: [] as { id: string; city: string; state: string; lat: number; lng: number; capacity: number | null; status: string; displayCode?: string }[],
  addedCustomers: [] as { id: string; city: string; state: string; lat: number; lng: number; demand: number; displayCode?: string }[],
  distanceOverrides: [] as { fromId: string; toId: string; distance: number; estimated?: boolean }[],
  gap: 0,
  timeLimitSec: 120,
  singleSource: true,
};

const brazilDataset = {
  warehouses: [{ id: "WH-ANP", city: "Anápolis", state: "ANP", lat: -16.33, lng: -48.95 }],
  customers: [{ id: "REG-SP", city: "São Paulo", state: "SP", lat: -23.55, lng: -46.63, demand: 5000000 }],
};

const solvedResult = {
  status: "optimal" as const,
  objective: 12345,
  runTimeSec: 0.5,
  quality: "Optimal",
  edges: [{ fromId: "WH-ANP", toId: "REG-SP", flow: 100, distance: 900 }],
  metrics: { weightedAvgDistance: 900, bandCoverage: [], utilizationByNode: [] },
  details: { openWarehouseIds: ["WH-ANP"], assignments: [] },
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
const mockUseListScenarios = vi.fn(() => ({ data: [unsolvedScenario] }));
const mockUseGetDataset = vi.fn(() => ({ data: brazilDataset }));

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: () => mockUseListScenarios(),
  useGetScenario: () => mockUseGetScenario(),
  useGetDataset: () => mockUseGetDataset(),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useCloneScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  // T9 (B2.2-T7 mock gap) — see Workspace.test.tsx's own comment on this
  // same mock addition.
  useGetReferenceDistances: vi.fn(() => ({ data: undefined })),
  getGetReferenceDistancesQueryKey: vi.fn((id: string) => ["reference-distances", id]),
  useListModels: vi.fn(() => ({
    data: [
      {
        id: "p-median-brazil",
        countryBounds: { sw: [-30, -68], ne: [0, -35] },
        capabilities: { supportsP: true, capacityModes: ["uniform"], demandEditable: false, outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"], supportsFacilityStatus: true },
      },
    ],
  })),
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
  return render(<Workspace modelId="p-median-brazil" userEmail="student@example.com" />);
}

function routePathCount(container: HTMLElement): number {
  const html = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
  return (html.match(/<path/g) ?? []).length;
}

function warehouseMarkerCount(container: HTMLElement): number {
  return container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon").length;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockCreateScenario.mutate.mockReset();
  mockUseGetScenario.mockReturnValue({ data: unsolvedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
  mockUseListScenarios.mockReturnValue({ data: [unsolvedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
  mockUseGetDataset.mockReturnValue({ data: brazilDataset } as unknown as ReturnType<typeof mockUseGetDataset>);
});

describe("Workspace — p-median-brazil (A5.2)", () => {
  it("shows Warehouses/Customers sidebar entries (naming parity with the pilot)", () => {
    renderWorkspace();
    expect(screen.getByTestId("sidebar-input-warehouses")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-input-customers")).toBeInTheDocument();
  });

  // T5 (Bundle 2, Step 2b) — Warehouses/Customers/Distances are now the
  // SAME WarehousesTab/CustomersTab/DistancesTab components p-median-us
  // already uses (T9's backend gate + T3's own GET /dataset entry) — no
  // longer a placeholder.
  it("Warehouses tab renders the real WarehousesTab, not a placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(screen.getByTestId("warehouses-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-export-warehouses-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-warehouses")).toBeInTheDocument();
  });

  it("Customers tab renders the real CustomersTab, not a placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    expect(screen.getByTestId("customers-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-export-customers-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-customers")).toBeInTheDocument();
  });

  it("Distances tab renders the real DistancesTab, not a placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId("distances-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
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

  it("Outputs stay greyed out pre-solve, same as every other model", () => {
    renderWorkspace();
    expect(screen.getByTestId("sidebar-output-output-map")).toHaveAttribute("aria-disabled", "true");
  });
});

// T5 (Bundle 2, Step 1) — Brazil's Input Map is the real v2 editor now
// (PMedianMapInputs, same surface as p-median-us), not the placeholder mode.
describe("Workspace — p-median-brazil Input Map (T5, Bundle 2)", () => {
  it("renders the real pmedian map surface (toolbar + legend), not the placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    expect(screen.getByTestId("pmedian-map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("Save lives inside the Input Map's own Layers row (R4), same relocation as p-median-us", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    const toolbar = screen.getByTestId("pmedian-map-toolbar");
    const saveButton = screen.getByTestId("button-save");
    expect(toolbar).toContainElement(saveButton);
    expect(screen.getAllByTestId("button-save")).toHaveLength(1);
  });

  it("adding a warehouse via the map registers a new addedWarehouses row on Save", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));

    const mapEl = document.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    expect(screen.getByTestId("button-save")).toBeEnabled();
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [saveArgs] = mockUpdateScenario.mutate.mock.calls[0];
    const sentAddedWarehouses = (saveArgs.data.inputs as typeof brazilInputs).addedWarehouses;
    expect(sentAddedWarehouses).toHaveLength(1);
    expect(sentAddedWarehouses[0].id).toMatch(/^aw-/);
  });
});

// T5 (Bundle 2, Step 1b) — demandEditable: false suppresses BASE-region
// demand editing but never blocks an ADDED customer's (a new region has no
// textbook demand to protect).
describe("Workspace — p-median-brazil demandEditable: false (T5, Bundle 2, Step 1b)", () => {
  it("a BASE region's demand is read-only in the Edit dialog", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));

    const markers = document.querySelectorAll(".leaflet-marker-icon");
    // Only one marker in this fixture's dataset: the base customer/region
    // (this file's brazilInputs has no addedWarehouses, and the warehouse
    // marker is a triangle rendered before it — see EntityMarkers' render
    // order — so the last marker is the base region).
    fireEvent.contextMenu(markers[markers.length - 1]);
    fireEvent.click(screen.getByTestId("map-action-edit"));

    expect(screen.getByTestId("edit-customer-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("edit-customer-demand-input")).toBeDisabled();
    expect(screen.getByTestId("edit-customer-demand-slider")).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("edit-customer-demand-readonly-note")).toBeInTheDocument();
  });

  it("an ADDED customer's demand is still required + editable via CreateEntityDialog, regardless of demandEditable", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));

    const mapEl = document.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByTestId("map-add-menu-cs"));

    const demandInput = screen.getByTestId("create-entity-demand");
    expect(demandInput).not.toBeDisabled();
    fireEvent.change(demandInput, { target: { value: "42000" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    fireEvent.click(screen.getByTestId("button-save"));
    const [saveArgs] = mockUpdateScenario.mutate.mock.calls[0];
    const sentAddedCustomers = (saveArgs.data.inputs as typeof brazilInputs).addedCustomers;
    expect(sentAddedCustomers).toHaveLength(1);
    expect(sentAddedCustomers[0].demand).toBe(42000);
  });

  // T5 (Step 2b) — same locked decision, second surface: the SEPARATE
  // Customers grid tab (not the Input Map dialog) must honor demandEditable
  // too, or a student could bypass the map's own read-only gate.
  it("a BASE region's demand is read-only in the Customers GRID tab too", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    expect(screen.getByTestId(`input-customer-demand-${brazilDataset.customers[0].id}`)).toBeDisabled();
  });
});

// T5 (Bundle 2, Step 2) — Output Map migrated off BrazilMap onto the shared
// NetworkMap: real dataset-driven markers/routes, R7 hide-closed parity, and
// the displayedInputs snapshot principle (an unsaved coordinate edit must
// not move the solve that's already on screen).
describe("Workspace — p-median-brazil Output Map (T5, Bundle 2, Step 2)", () => {
  it("renders the shared NetworkMap (real markers/routes), not BrazilMap's summary-counts view", () => {
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(screen.queryByTestId("brazil-map")).not.toBeInTheDocument();
    // Full layer-toggle set, same as p-median-us's own Output Map.
    expect(screen.getByTestId("checkbox-toggle-warehouses")).toBeInTheDocument();
    expect(screen.getByTestId("checkbox-toggle-customers")).toBeInTheDocument();
    expect(screen.getByTestId("checkbox-color-lanes-band")).toBeInTheDocument();
    expect(routePathCount(container)).toBe(1);
  });

  it("R7 — a closed candidate (never assigned by the solver) is absent from the Output Map", () => {
    const twoWarehouseDataset = {
      ...brazilDataset,
      warehouses: [...brazilDataset.warehouses, { id: "WH-SP", city: "São Paulo", state: "SP", lat: -23.55, lng: -46.63 }],
    };
    mockUseGetDataset.mockReturnValue({ data: twoWarehouseDataset } as unknown as ReturnType<typeof mockUseGetDataset>);
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);

    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    // Only WH-ANP (opened, per solvedResult's openWarehouseIds) renders —
    // WH-SP (closed candidate) is hidden.
    expect(warehouseMarkerCount(container)).toBe(1);
  });

  it("an added-and-opened warehouse renders, along with its route to an added customer — even though neither exists in the base dataset", () => {
    const addedScenario = {
      ...solvedScenario,
      inputs: {
        ...brazilInputs,
        addedWarehouses: [{ id: "WH-ADDED", city: "Curitiba", state: "PR", lat: -25.43, lng: -49.27, capacity: null, status: "active" }],
        addedCustomers: [{ id: "REG-ADDED", city: "Florianópolis", state: "SC", lat: -27.6, lng: -48.55, demand: 75 }],
      },
      result: {
        ...solvedResult,
        edges: [{ fromId: "WH-ADDED", toId: "REG-ADDED", flow: 75, distance: 500 }],
        details: { openWarehouseIds: ["WH-ADDED"], assignments: [] },
      },
    };
    mockUseGetScenario.mockReturnValue({ data: addedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [addedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);

    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    // WH-ANP (base warehouse) is closed under this result — hidden. Only
    // the added, opened warehouse renders.
    expect(warehouseMarkerCount(container)).toBe(1);
    expect(routePathCount(container)).toBe(1);
  });

  it("an unsaved Input Map coordinate edit does NOT move the already-displayed solve (displayedInputs snapshot)", () => {
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
    const { container } = renderWorkspace();

    // Add (but do NOT save) a new warehouse on the Input Map — an unsaved
    // draft edit to localInputs.
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    const mapEl = document.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));
    fireEvent.click(screen.getByTestId("create-entity-submit"));
    expect(screen.getByTestId("button-save")).toBeEnabled(); // dirty, unsaved

    // The Output Map must still reflect only the SOLVED (displayedInputs)
    // geometry — the unsaved added warehouse must not appear.
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(warehouseMarkerCount(container)).toBe(1);
    expect(routePathCount(container)).toBe(1);
  });
});
