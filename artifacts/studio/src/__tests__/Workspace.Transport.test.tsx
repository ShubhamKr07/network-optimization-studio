import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// T6 (Bundle 2) — Workspace-level integration coverage for transport-coal's
// full-v2 Input Map editor (mines + stations), mirroring
// Workspace.Brazil.test.tsx's own structure/conventions for the fast-follow
// sibling: mode dispatch off "legacy", R4 Save-in-Layers, add-then-save
// round trip, R3/R7 absence (supportsFacilityStatus:false), and the T6 Step
// 3 effective-output-dataset projection (an added mine/station's route
// renders in the Output Map; hideClosedWarehouses stays false — R7 is N/A
// for this model, unlike p-median-us/brazil).

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
  mineCapacities: {} as Record<string, number>,
  stationDemands: {} as Record<string, number>,
  addedMines: [] as { id: string; city: string; state: string; lat: number; lng: number; capacity: number | null; displayCode?: string }[],
  addedStations: [] as { id: string; city: string; state: string; lat: number; lng: number; demand: number; displayCode?: string }[],
  laneCostOverrides: [] as { fromId: string; toId: string; cost: number; estimated?: boolean }[],
};

// transport-coal's GET /dataset: warehouses=mines, customers=stations (see
// Workspace.tsx's own knownMineIds/knownStationIds comment).
const transportDataset = {
  warehouses: [{ id: "MN1", city: "Beckley", state: "WV", lat: 37.8, lng: -81.2 }],
  customers: [{ id: "ST1", city: "Newark", state: "NJ", lat: 40.7, lng: -74.2, demand: 500 }],
};

const solvedResult = {
  status: "optimal" as const,
  objective: 12345,
  runTimeSec: 0.5,
  quality: "Optimal",
  edges: [{ fromId: "MN1", toId: "ST1", flow: 500, distance: 300 }],
  metrics: { weightedAvgDistance: 300, bandCoverage: [], utilizationByNode: [] },
  details: { openWarehouseIds: ["MN1"], assignments: [] },
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};

const unsolvedScenario = {
  id: 1,
  name: "Base case",
  modelId: "transport-coal",
  inputs: transportInputs,
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
const mockUseGetDataset = vi.fn(() => ({ data: transportDataset }));

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
  useListModels: vi.fn(() => ({
    data: [
      {
        id: "transport-coal",
        countryBounds: { sw: [24, -125], ne: [49, -66] },
        capabilities: { supportsP: false, capacityModes: ["per_mine"], demandEditable: true, outputGrids: ["flows", "costSummary", "serviceStats"], supportsFacilityStatus: false },
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
  return render(<Workspace modelId="transport-coal" userEmail="student@example.com" />);
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
  mockUseGetDataset.mockReturnValue({ data: transportDataset } as unknown as ReturnType<typeof mockUseGetDataset>);
});

describe("Workspace — transport-coal Input Map (T6, Bundle 2)", () => {
  it("renders the real transport map surface (toolbar + legend), not the legacy pin-drop flow", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    expect(screen.getByTestId("transport-map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("input-map-placement-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("Save lives inside the Input Map's own Layers row (R4), same relocation as p-median-us/brazil", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    const toolbar = screen.getByTestId("transport-map-toolbar");
    const saveButton = screen.getByTestId("button-save");
    expect(toolbar).toContainElement(saveButton);
    expect(screen.getAllByTestId("button-save")).toHaveLength(1);
  });

  it("R3/R7 N/A — no status legend rows on this model's Input Map", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    expect(screen.queryByTestId("legend-status-active")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legend-status-forced_open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legend-status-inactive")).not.toBeInTheDocument();
  });

  it("adding a mine via the map registers a new addedMines row on Save, with no status/distanceOverrides fields in the PATCH", () => {
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
    const sentInputs = saveArgs.data.inputs as typeof transportInputs;
    expect(sentInputs.addedMines).toHaveLength(1);
    expect(sentInputs.addedMines[0].id).toMatch(/^am-/);
    expect(sentInputs.addedMines[0]).not.toHaveProperty("status");
    // A transport PATCH never carries a meaningless status/distanceOverrides
    // field — this model uses laneCostOverrides.cost, not distanceOverrides,
    // and has no status concept at all.
    expect(sentInputs).not.toHaveProperty("distanceOverrides");
    expect(sentInputs).not.toHaveProperty("warehouseOverrides");
    expect(sentInputs).not.toHaveProperty("customerOverrides");
  });

  it("adding a station via the map registers a new addedStations row on Save", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));

    const mapEl = document.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByTestId("map-add-menu-cs"));
    fireEvent.change(screen.getByTestId("create-entity-demand"), { target: { value: "900" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));
    fireEvent.click(screen.getByTestId("button-save"));

    const [saveArgs] = mockUpdateScenario.mutate.mock.calls[0];
    const sentStations = (saveArgs.data.inputs as typeof transportInputs).addedStations;
    expect(sentStations).toHaveLength(1);
    expect(sentStations[0].demand).toBe(900);
  });
});

// T6 Step 3 (P1) — effective output dataset: added mines/stations from
// displayedInputs project into the Output Map so NetworkMap can resolve a
// result edge whose endpoint is scenario-local. hideClosedWarehouses stays
// false throughout (R7 N/A) — unlike the Brazil sibling test, there's no
// "closed candidate is hidden" assertion here, deliberately.
describe("Workspace — transport-coal Output Map effective dataset (T6, Bundle 2, Step 3)", () => {
  it("renders the shared NetworkMap with the base mine→station route", () => {
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(routePathCount(container)).toBe(1);
    // Only mines render as a true Leaflet Marker (triangle divIcon);
    // stations render as a CircleMarker bubble — warehouseMarkerCount only
    // counts `.leaflet-marker-icon`, i.e. mines (same convention
    // Workspace.Brazil.test.tsx's own helper already established).
    expect(warehouseMarkerCount(container)).toBe(1);
  });

  it("an added-and-opened mine renders, along with its route to an added station — even though neither exists in the base dataset", () => {
    const addedScenario = {
      ...solvedScenario,
      inputs: {
        ...transportInputs,
        addedMines: [{ id: "am-1", city: "Roanoke", state: "VA", lat: 37.3, lng: -79.9, capacity: null }],
        addedStations: [{ id: "as-1", city: "Erie", state: "PA", lat: 42.1, lng: -80.1, demand: 300 }],
      },
      result: {
        ...solvedResult,
        edges: [{ fromId: "am-1", toId: "as-1", flow: 300, distance: 200 }],
        details: { openWarehouseIds: ["MN1", "am-1"], assignments: [] },
      },
    };
    mockUseGetScenario.mockReturnValue({ data: addedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [addedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);

    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    // Base mine (never assigned this time — only the added pair carries an
    // edge) still renders as a Marker (R7 N/A — nothing is ever hidden for
    // this model), plus the added mine: 2 true Markers. The two stations
    // render as CircleMarker bubbles, not counted by warehouseMarkerCount.
    expect(warehouseMarkerCount(container)).toBe(2);
    expect(routePathCount(container)).toBe(1);
  });

  it("an unsaved Input Map coordinate edit does NOT move the already-displayed solve (displayedInputs snapshot)", () => {
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
    const { container } = renderWorkspace();

    // Add (but do NOT save) a new mine on the Input Map — an unsaved draft
    // edit to localInputs.
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    const mapEl = document.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));
    fireEvent.click(screen.getByTestId("create-entity-submit"));
    expect(screen.getByTestId("button-save")).toBeEnabled(); // dirty, unsaved

    // The Output Map must still reflect only the SOLVED (displayedInputs)
    // geometry — the unsaved added mine must not appear.
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(warehouseMarkerCount(container)).toBe(1);
    expect(routePathCount(container)).toBe(1);
  });
});
