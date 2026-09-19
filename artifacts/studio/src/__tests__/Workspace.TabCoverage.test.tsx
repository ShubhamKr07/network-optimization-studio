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
// jade-INT (Workspace fixups bundle, item 4) — every model's
// `inputEntriesForModel` now appends an "Added Entities" entry (last, before
// Optimization Parameters); its content root is `AddedEntitiesTab.tsx`'s own
// `data-testid="added-entities-tab"`.
const ADDED_ENTITIES: TabCoverageEntry = { sidebarId: "added-entities", tabTestId: "added-entities-tab" };
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
        ADDED_ENTITIES,
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
        ADDED_ENTITIES,
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
        ADDED_ENTITIES,
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

// ── two-echelon-jade-us (jade-T15.5) ─────────────────────────────────────
describe("Workspace tab coverage — two-echelon-jade-us", () => {
  const jadeInputs = {
    p: 2,
    distanceBands: [200, 400, 800, 1600],
    gap: 0,
    timeLimitSec: 120,
    warehouseOverrides: [{ id: "wh-11", status: "forced_open" }],
    customerOverrides: [],
    plantProductCapability: [],
    addedPlants: [],
    addedWarehouses: [],
    addedCustomers: [],
    distanceOverrides: [],
  };

  const solvedScenario = {
    id: 20,
    name: "JADE base case",
    modelId: "two-echelon-jade-us",
    inputs: jadeInputs,
    result: {
      status: "optimal" as const,
      objective: 254060828.6157,
      runTimeSec: 0.7,
      quality: "Proven optimal",
      edges: [
        { fromId: "plant-1", toId: "wh-11", flow: 1000, distance: 300, leg: "plant_to_warehouse" as const, productId: "product-1" },
        { fromId: "wh-11", toId: "customer-1", flow: 1000, distance: 150, leg: "warehouse_to_customer" as const },
      ],
      metrics: {
        weightedAvgDistance: 150,
        utilizationByNode: [],
        bandCoverage: [{ band: 200, percent: 100 }],
        openFacilityIds: ["wh-11"],
      },
      details: {},
      solverUsed: "CBC",
      infeasibilityReason: null,
    },
    stale: false,
    createdAt: "2026-01-04T00:00:00Z",
    updatedAt: "2026-01-04T00:00:00Z",
  };

  const dataset = {
    warehouses: [{ id: "wh-11", name: "Phoenix", city: "Phoenix", state: "AZ", lat: 33.45, lng: -112.07 }],
    customers: [{ id: "customer-1", name: "Los Angeles", city: "Los Angeles", state: "CA", lat: 34.05, lng: -118.24, demand: 100, demands: { "product-1": 100 } }],
    plants: [{ id: "plant-1", name: "Plant 1", city: "Ashland", state: "KY", lat: 38.45, lng: -82.67 }],
    products: [
      { id: "product-1", name: "Product 1" },
      { id: "product-2", name: "Product 2" },
      { id: "product-3", name: "Product 3" },
      { id: "product-4", name: "Product 4" },
    ],
    plantProductCapabilities: [{ plantId: "plant-1", productId: "product-1", capacity: 210000000 }],
  };

  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({
      data: [
        {
          id: "two-echelon-jade-us",
          countryBounds: { sw: [25.78, -122.69], ne: [47.61, -71.05] },
          distanceUnit: "mi",
          capabilities: {
            supportsP: true,
            capacityModes: [],
            demandEditable: true,
            outputGrids: ["openWarehouses", "assignments", "flows", "costSummary", "serviceStats"],
            supportsFacilityStatus: true,
            supportsReferenceDistances: true,
            supportsAddedCustomerExclusion: true,
            supportsPlantProductCapability: true,
          },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);
  });

  it("every Inputs entry (incl. Input Map, Plants, Capability Matrix) and every allowed Outputs entry opens its real content, not a placeholder", () => {
    render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);

    runTabCoverage(
      [
        INPUT_MAP,
        { sidebarId: "plants", tabTestId: "plants-tab" },
        { sidebarId: "capability-matrix", tabTestId: "capability-matrix-tab" },
        { sidebarId: "warehouses", tabTestId: "warehouses-tab" },
        { sidebarId: "customers", tabTestId: "customers-tab" },
        { sidebarId: "distances", tabTestId: "jade-distances-tab" },
        ADDED_ENTITIES,
        OPTIMIZATION_PARAMETERS,
      ],
      [
        OUTPUT_MAP,
        OPEN_WAREHOUSES,
        // jade-INT (#4/#5) — JADE renders its OWN JadeAssignmentsTab/
        // JadeFlowsTab (spec §5's "no regression to shared tabs"), not the
        // shared AssignmentsTab/FlowsTab CUSTOMER_ASSIGNMENTS/FLOWS
        // constants above assert on — asserting on each component's own
        // stable root testid instead (JadeFlowsTab has no single top-level
        // download button; its two inner-tab downloads are per-leg).
        { sidebarId: "customer-assignments", tabTestId: "jade-assignments-tab" },
        { sidebarId: "flows", tabTestId: "jade-flows-tab" },
        COST_SUMMARY,
        SERVICE_STATS,
        // two-echelon-jade-us is the SECOND model whose outputGrids
        // includes all 5 grid entries (like two-echelon-gold-au) — its
        // plant_to_warehouse/warehouse_to_customer legs map 1:1 onto Flows/
        // Customer Assignments respectively.
      ],
    );
  });
});

// ── p-median-brazil (jade-INT, Workspace fixups bundle item 4) ────────────
// Deliberately excluded from the original A5.2 sweep (no per-row dataset
// endpoint at the time — see this file's own header comment), but T5
// (Bundle 2) later gave it a real GET /dataset endpoint + full grid tabs, so
// its own Added Entities coverage belongs here now rather than being folded
// into the p-median-us case above (Codex round-2 review — "both must
// execute", not just the combined label as evidence).
describe("Workspace tab coverage — p-median-brazil", () => {
  const brazilInputs = {
    p: 7,
    distanceBands: [500, 1000, 2000, 4000],
    capacityMode: "uniform",
    uniformCapacity: 20000000,
    warehouseOverrides: [],
    customerOverrides: [],
    addedWarehouses: [],
    addedCustomers: [],
    distanceOverrides: [],
    gap: 0,
    timeLimitSec: 120,
    singleSource: true,
  };

  const solvedScenario = {
    id: 30,
    name: "Base case",
    modelId: "p-median-brazil",
    inputs: brazilInputs,
    result: {
      status: "optimal" as const,
      objective: 12345,
      runTimeSec: 0.5,
      quality: "Optimal",
      edges: [{ fromId: "WH-ANP", toId: "REG-SP", flow: 100, distance: 900 }],
      metrics: { weightedAvgDistance: 900, bandCoverage: [], utilizationByNode: [] },
      details: {},
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: null,
    },
    stale: false,
    createdAt: "2026-01-03T00:00:00Z",
    updatedAt: "2026-01-03T00:00:00Z",
  };

  const dataset = {
    warehouses: [{ id: "WH-ANP", city: "Anápolis", state: "ANP", lat: -16.33, lng: -48.95 }],
    customers: [{ id: "REG-SP", city: "São Paulo", state: "SP", lat: -23.55, lng: -46.63, demand: 5000000 }],
  };

  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({
      data: [
        {
          id: "p-median-brazil",
          countryBounds: { sw: [-30, -68], ne: [0, -35] },
          capabilities: {
            supportsP: true,
            capacityModes: ["uniform"],
            demandEditable: false,
            outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
            supportsFacilityStatus: true,
          },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);
  });

  it("every Inputs entry (incl. Input Map, Added Entities) and every allowed Outputs entry opens its real content, not a placeholder", () => {
    render(<Workspace modelId="p-median-brazil" userEmail="student@example.com" />);

    runTabCoverage(
      [
        INPUT_MAP,
        { sidebarId: "customers", tabTestId: "customers-tab" },
        { sidebarId: "warehouses", tabTestId: "warehouses-tab" },
        { sidebarId: "distances", tabTestId: "distances-tab" },
        ADDED_ENTITIES,
        OPTIMIZATION_PARAMETERS,
      ],
      [
        OUTPUT_MAP,
        OPEN_WAREHOUSES,
        CUSTOMER_ASSIGNMENTS,
        COST_SUMMARY,
        SERVICE_STATS,
      ],
    );
  });
});

// ── chens-cosmetics-cn (jade-INT, Workspace fixups bundle item 4) ─────────
// Chapter 4 (Chen's Cosmetics) — reuses p-median-us's "pmedian" Input Map
// mode and WarehousesTab/CustomersTab (C4.13), so its Added Entities
// sub-tab set is the same {Warehouses, Customers}. Absent from the original
// sweep entirely (added after C4.13) — new coverage, not a modification.
describe("Workspace tab coverage — chens-cosmetics-cn", () => {
  const chensInputs = {
    objective: "coverage",
    p: 3,
    highServiceDistKm: 600,
    maxDistKm: 5000,
    avgServiceDistCapKm: 1000,
    gap: 0,
    timeLimitSec: 120,
    capacityMode: "none",
    distanceBands: [600, 5000],
    warehouseOverrides: [],
    customerOverrides: [],
    addedWarehouses: [],
    addedCustomers: [],
    distanceOverrides: [],
  };

  const solvedScenario = {
    id: 40,
    name: "Chen coverage",
    modelId: "chens-cosmetics-cn",
    inputs: chensInputs,
    result: {
      status: "optimal" as const,
      objective: 66.6667,
      runTimeSec: 0.3,
      quality: "optimal",
      edges: [{ fromId: "wh-cn-1", toId: "cs-cn-1", flow: 100, distance: 300 }],
      metrics: { weightedAvgDistance: 300, bandCoverage: [{ band: 600, percent: 66 }] },
      details: { objective: "coverage", coveragePct: 66.6667, coveredDemand: 100, uncoveredPct: 33.3333 },
      solverUsed: "CBC",
      infeasibilityReason: null,
    },
    stale: false,
    createdAt: "2026-01-04T00:00:00Z",
    updatedAt: "2026-01-04T00:00:00Z",
  };

  // Deliberately blank `state` — Chen's real dataset shape (a China dataset
  // with no state field) — so `hasStateColumn` genuinely resolves `false`.
  const dataset = {
    warehouses: [{ id: "wh-cn-1", city: "Shenzhen", state: "", lat: 22.54, lng: 114.06 }],
    customers: [{ id: "cs-cn-1", city: "Guangzhou", state: "", lat: 23.13, lng: 113.26, demand: 500 }],
  };

  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({
      data: [
        {
          id: "chens-cosmetics-cn",
          distanceUnit: "km",
          countryBounds: { sw: [18.0, 73.0], ne: [54.0, 135.0] },
          capabilities: {
            supportsP: true,
            capacityModes: ["none"],
            demandEditable: true,
            supportsFacilityStatus: true,
            supportsAddedCustomerExclusion: true,
            supportsReferenceDistances: true,
            outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
          },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);
  });

  it("every Inputs entry (incl. Input Map, Added Entities) and every allowed Outputs entry opens its real content, not a placeholder", () => {
    render(<Workspace modelId="chens-cosmetics-cn" userEmail="student@example.com" />);

    runTabCoverage(
      [
        INPUT_MAP,
        { sidebarId: "customers", tabTestId: "customers-tab" },
        { sidebarId: "warehouses", tabTestId: "warehouses-tab" },
        { sidebarId: "distances", tabTestId: "distances-tab" },
        ADDED_ENTITIES,
        OPTIMIZATION_PARAMETERS,
      ],
      [
        OUTPUT_MAP,
        OPEN_WAREHOUSES,
        CUSTOMER_ASSIGNMENTS,
        COST_SUMMARY,
        SERVICE_STATS,
      ],
    );
  });
});
