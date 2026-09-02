import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Phase 3.2, Task 5 — sweeps EVERY sidebar tab (all Inputs entries,
// including the new Input Map, plus every Outputs entry the model's real
// capabilities.outputGrids allows) for the three models that render through
// Workspace.tsx (p-median-us, transport-coal, two-echelon-gold-au;
// p-median-brazil is deliberately excluded — it has no per-row dataset
// endpoint at all, see Workspace.tsx's own `inputEntriesForModel`/
// `renderTabContent` comments, so its Inputs tabs are placeholders by
// design, not something this sweep should assert real content for).
//
// Reuses Workspace.test.tsx's established mocking pattern verbatim (mock
// `@workspace/api-client-react` at the generated-hooks level, mock
// `wouter`/`@tanstack/react-query` the same way) rather than inventing a new
// one — see that file's own header comments for the reasoning.
//
// The per-model sidebar-entry lists below mirror Workspace.tsx's own
// (unexported) `inputEntriesForModel()`/`OUTPUT_ENTRIES` + the
// entity->capability map inside `renderTabContent()` — if either changes,
// keep these lists in sync (there is no exported single source of truth to
// import from instead).

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-3", mockNavigate],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn() };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

// react-leaflet — lightweight mock, same convention InputMapTab.test.tsx/
// NetworkMap.test.tsx already use. This sweep only needs every map-bearing
// tab (Input Map, Output Map) to mount without crashing under jsdom, not to
// exercise Leaflet's own interactive behavior (already covered by those
// dedicated component tests).
vi.mock("react-leaflet", async () => {
  const actual = await vi.importActual<typeof import("react-leaflet")>("react-leaflet");
  return {
    ...actual,
    useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn() }),
    useMapEvents: () => null,
    MapContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="mock-map-container">{children}</div>
    ),
    TileLayer: () => null,
    Marker: () => null,
    CircleMarker: () => null,
    Polyline: () => null,
    Tooltip: () => null,
    Pane: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockSolveScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCreateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCloneScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockDeleteScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockLogoutUser = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(),
  useGetScenario: vi.fn(),
  useGetDataset: vi.fn(),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useCloneScenario: vi.fn(() => mockCloneScenario),
  useDeleteScenario: vi.fn(() => mockDeleteScenario),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  // T9 (B2.2-T7 mock gap) — this sweep opens the Distances tab for
  // p-median-us, which now calls useGetReferenceDistances unconditionally.
  useGetReferenceDistances: vi.fn(() => ({ data: undefined })),
  getGetReferenceDistancesQueryKey: vi.fn((id: string) => ["reference-distances", id]),
  useListModels: vi.fn(),
  usePrecheckScenario: vi.fn(() => ({ data: { ok: true, errors: [] } })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  useLogoutUser: vi.fn(() => mockLogoutUser),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
  getGetDatasetQueryKey: vi.fn(() => ["dataset"]),
  getPrecheckScenarioQueryKey: vi.fn((id: number) => ["precheck", id]),
}));

import { Workspace } from "@/pages/Workspace";
import { useGetScenario, useListScenarios, useGetDataset, useListModels } from "@workspace/api-client-react";

const mockUseGetScenario = vi.mocked(useGetScenario);
const mockUseListScenarios = vi.mocked(useListScenarios);
const mockUseGetDataset = vi.mocked(useGetDataset);
const mockUseListModels = vi.mocked(useListModels);

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockSolveScenario.mutate.mockReset();
  mockCreateScenario.mutate.mockReset();
  mockCloneScenario.mutate.mockReset();
  mockDeleteScenario.mutate.mockReset();
  mockLogoutUser.mutate.mockReset();
});

interface TabCoverageEntry {
  /** matches SidebarTree's `data-testid={\`sidebar-${input|output}-${entry.id}\`}` */
  sidebarId: string;
  /** the real tab's own stable root testid to assert on, once opened */
  tabTestId: string;
}

const OPTIMIZATION_PARAMETERS: TabCoverageEntry = {
  sidebarId: "optimization-parameters",
  tabTestId: "optimization-parameters-tab",
};
const INPUT_MAP: TabCoverageEntry = { sidebarId: "input-map", tabTestId: "input-map-tab" };
const OUTPUT_MAP: TabCoverageEntry = { sidebarId: "output-map", tabTestId: "output-map-tab" };

// The 4 output-grid tabs have no single wrapping div with a stable testid of
// their own (unlike the input tabs) — each one's "Download CSV" button IS
// the one testid guaranteed present whenever `result` is non-null,
// regardless of how many rows that grid has (confirmed by reading
// OpenWarehousesTab.tsx/AssignmentsTab.tsx/FlowsTab.tsx/CostSummaryTab.tsx/
// ServiceStatsTab.tsx directly), so it's the most reliable "real content
// mounted" signal available for this sweep.
const OPEN_WAREHOUSES: TabCoverageEntry = { sidebarId: "open-warehouses", tabTestId: "button-download-open-warehouses-csv" };
const CUSTOMER_ASSIGNMENTS: TabCoverageEntry = { sidebarId: "customer-assignments", tabTestId: "button-download-assignments-csv" };
const FLOWS: TabCoverageEntry = { sidebarId: "flows", tabTestId: "button-download-flows-csv" };
const COST_SUMMARY: TabCoverageEntry = { sidebarId: "cost-summary", tabTestId: "button-download-cost-summary-csv" };
const SERVICE_STATS: TabCoverageEntry = { sidebarId: "service-stats", tabTestId: "button-download-service-stats-csv" };

function runTabCoverage(inputs: TabCoverageEntry[], outputs: TabCoverageEntry[]) {
  for (const { sidebarId, tabTestId } of inputs) {
    fireEvent.click(screen.getByTestId(`sidebar-input-${sidebarId}`));
    expect(screen.getByTestId(tabTestId)).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  }
  for (const { sidebarId, tabTestId } of outputs) {
    fireEvent.click(screen.getByTestId(`sidebar-output-${sidebarId}`));
    expect(screen.getByTestId(tabTestId)).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  }
}

// ── p-median-us ──────────────────────────────────────────────────────────
describe("Workspace tab coverage — p-median-us", () => {
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

  const solvedScenario = {
    id: 1,
    name: "3 Warehouses",
    modelId: "p-median-us",
    inputs: pmedianInputs,
    result: {
      status: "optimal" as const,
      objective: 29873735731,
      runTimeSec: 0.45,
      quality: "Proven optimal",
      edges: [{ fromId: "CHI", toId: "C1", flow: 100, distance: 42.1, band: 0 }],
      metrics: {
        weightedAvgDistance: 42.1,
        utilizationByNode: [{ warehouseId: "CHI", city: "Chicago", utilization: 0.5 }],
        bandCoverage: [{ band: 200, percent: 100 }],
      },
      details: {},
      solverUsed: "CBC",
      infeasibilityReason: null,
    },
    stale: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const dataset = {
    warehouses: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }],
    customers: [{ id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 }],
  };

  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({
      data: [
        {
          id: "p-median-us",
          countryBounds: { sw: [24, -125], ne: [50, -66] },
          capabilities: {
            supportsP: true,
            capacityModes: ["none", "uniform", "per_wh"],
            demandEditable: true,
            outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
          },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);
  });

  it("every Inputs entry (incl. Input Map) and every allowed Outputs entry opens its real content, not a placeholder", () => {
    render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);

    runTabCoverage(
      [
        INPUT_MAP,
        { sidebarId: "customers", tabTestId: "customers-tab" },
        { sidebarId: "warehouses", tabTestId: "warehouses-tab" },
        { sidebarId: "distances", tabTestId: "distances-tab" },
        OPTIMIZATION_PARAMETERS,
      ],
      [
        OUTPUT_MAP,
        OPEN_WAREHOUSES,
        CUSTOMER_ASSIGNMENTS,
        COST_SUMMARY,
        SERVICE_STATS,
        // "flows" deliberately NOT included — not in this model's
        // outputGrids capability, so (T9, B2) its sidebar entry doesn't
        // even render (covered by Workspace.test.tsx's own B2 gating tests
        // already; re-asserting the negative here would just duplicate that
        // coverage).
      ],
    );
  });
});

// ── transport-coal ───────────────────────────────────────────────────────
describe("Workspace tab coverage — transport-coal", () => {
  const transportInputs = {
    distanceBands: [500, 1000, 1500, 2000],
    gap: 0,
    timeLimitSec: 120,
    capacityFactor: 1.0,
    singleSource: false,
    capacityInactive: false,
    mineCapacities: {},
    stationDemands: {},
    addedMines: [],
    addedStations: [],
    laneCostOverrides: [],
  };

  const solvedScenario = {
    id: 8,
    name: "Coal Base Case",
    modelId: "transport-coal",
    inputs: transportInputs,
    result: {
      status: "optimal" as const,
      objective: 123456,
      runTimeSec: 0.12,
      quality: "Proven optimal",
      edges: [{ fromId: "KY", toId: "CHI", flow: 500, distance: 300 }],
      metrics: {
        weightedAvgDistance: 300,
        utilizationByNode: [{ warehouseId: "KY", city: "Louisville", utilization: 0.7 }],
        bandCoverage: [{ band: 500, percent: 100 }],
      },
      details: {},
      solverUsed: "CBC",
      infeasibilityReason: null,
    },
    stale: false,
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  };

  const dataset = {
    warehouses: [{ id: "KY", city: "Louisville", state: "KY", lat: 38.25, lng: -85.76 }],
    customers: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62, demand: 900000 }],
  };

  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({
      data: [
        {
          id: "transport-coal",
          countryBounds: { sw: [29.76, -122.42], ne: [47.61, -73.61] },
          capabilities: {
            supportsP: false,
            capacityModes: ["per_mine"],
            demandEditable: true,
            outputGrids: ["flows", "costSummary", "serviceStats"],
          },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);
  });

  it("every Inputs entry (incl. Input Map) and every allowed Outputs entry opens its real content, not a placeholder", () => {
    render(<Workspace modelId="transport-coal" userEmail="student@example.com" />);

    runTabCoverage(
      [
        INPUT_MAP,
        { sidebarId: "mines", tabTestId: "mines-tab" },
        { sidebarId: "stations", tabTestId: "stations-tab" },
        { sidebarId: "laneCosts", tabTestId: "lanecosts-tab" },
        OPTIMIZATION_PARAMETERS,
      ],
      [
        OUTPUT_MAP,
        FLOWS,
        COST_SUMMARY,
        SERVICE_STATS,
        // "open-warehouses"/"customer-assignments" deliberately NOT
        // included — transport-coal has no facility-location concept, so
        // neither is in its outputGrids capability (Flows IS this model's
        // assignment view).
      ],
    );
  });
});

// ── two-echelon-gold-au ──────────────────────────────────────────────────
describe("Workspace tab coverage — two-echelon-gold-au", () => {
  const twoEchelonInputs = {
    bomRatio: 1.1,
    refineryOverrides: [],
    customerOverrides: [],
    distanceBands: [500, 1000, 1500, 2000, 2600],
    gap: 0,
    timeLimitSec: 120,
  };

  const solvedScenario = {
    id: 12,
    name: "Base case",
    modelId: "two-echelon-gold-au",
    inputs: twoEchelonInputs,
    result: {
      status: "optimal" as const,
      objective: 386576.99,
      runTimeSec: 0.3,
      quality: "Proven optimal",
      edges: [
        { fromId: "kalgoorlie", toId: "daggar_hills", flow: 100, distance: 50, leg: "mine_to_refinery" as const },
        { fromId: "daggar_hills", toId: "sydney", flow: 80, distance: 2381.79, leg: "refinery_to_customer" as const },
      ],
      metrics: {
        weightedAvgDistance: 687.6,
        utilizationByNode: [{ warehouseId: "daggar_hills", city: "Daggar Hills", utilization: 0.9 }],
        bandCoverage: [{ band: 500, percent: 100 }],
        avgDistanceByLeg: { mine_to_refinery: 50, refinery_to_customer: 2381.79 },
      },
      details: {},
      solverUsed: "CBC",
      infeasibilityReason: null,
    },
    stale: false,
    createdAt: "2026-01-03T00:00:00Z",
    updatedAt: "2026-01-03T00:00:00Z",
  };

  const dataset = {
    warehouses: [
      { id: "kalgoorlie", city: "Kalgoorlie", state: "WA", lat: -30.7, lng: 121.4, kind: "mine" as const },
      { id: "cunnamulla", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68, kind: "facility" as const },
      { id: "daggar_hills", city: "Daggar Hills", state: "QLD", lat: -25.0, lng: 145.0, kind: "facility" as const },
    ],
    customers: [{ id: "sydney", city: "Sydney", state: "NSW", lat: -33.87, lng: 151.2, demand: 100000 }],
  };

  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({
      data: [
        {
          id: "two-echelon-gold-au",
          countryBounds: { sw: [-38.5, 113.0], ne: [-16.0, 154.5] },
          capabilities: {
            supportsP: false,
            capacityModes: [],
            demandEditable: true,
            outputGrids: ["openWarehouses", "flows", "assignments", "costSummary", "serviceStats"],
          },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);
  });

  it("every Inputs entry (incl. Input Map) and every allowed Outputs entry opens its real content, not a placeholder", () => {
    render(<Workspace modelId="two-echelon-gold-au" userEmail="student@example.com" />);

    runTabCoverage(
      [
        INPUT_MAP,
        { sidebarId: "refineries", tabTestId: "refineries-tab" },
        { sidebarId: "customers", tabTestId: "customers-tab" },
        { sidebarId: "distances", tabTestId: "legdistances-tab" },
        OPTIMIZATION_PARAMETERS,
      ],
      [
        OUTPUT_MAP,
        OPEN_WAREHOUSES,
        FLOWS,
        CUSTOMER_ASSIGNMENTS,
        COST_SUMMARY,
        SERVICE_STATS,
        // two-echelon-gold-au is the one model whose outputGrids includes
        // all 5 grid entries — its Edge.leg values map 1:1 onto both
        // Flows (mine_to_refinery) and Customer Assignments
        // (refinery_to_customer), per C6.1's own design note.
      ],
    );
  });
});
