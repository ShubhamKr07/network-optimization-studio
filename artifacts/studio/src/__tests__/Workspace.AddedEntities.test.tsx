import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";

// jade-INT (Workspace fixups bundle, item 4 + item 2) — the new dedicated
// "Added Entities" sidebar tab (one per model, holding every base entity
// tab's relocated "Added ..." add/delete-row section) and the Flows tab's
// deduped effective-plants snapshot wiring (item 2).
//
// This file covers:
//   1. A data-driven matrix over ALL SIX model ids proving each renders
//      EXACTLY its own inner sub-tab set, plus the three highest-risk
//      presentation props (JADE per-product demand mode, Gold
//      entity="refineries", Chen hasStateColumn={false}).
//   2. Model-specific data + mutation wiring proof for Gold's Refineries
//      sub-tab (the one that reuses WarehousesTab bound to a DIFFERENT
//      model field, addedRefineries, not addedWarehouses) — render, edit,
//      delete, and precheck chip all against the correct array/key.
//   3. The same render+edit proof for a non-reuse model (JADE Plants ->
//      addedPlants) so the pattern isn't Gold-specific.
//   4. A Workspace-level regression proving JadeFlowsTab's effective-plants
//      lookup resolves from the SOLVED snapshot (displayedInputs), never an
//      unsaved localInputs draft, and that stepping the result-history
//      stepper advances the plant lookup and the displayed result together.
//
// Reuses this repo's established mocking conventions verbatim (mock
// `@workspace/api-client-react` at the generated-hooks level, per-describe
// `mockReturnValue` swaps — see Workspace.TabCoverage.test.tsx's own header
// comment) rather than inventing a new one.

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

// react-leaflet — same lightweight mock Workspace.TabCoverage.test.tsx uses;
// this file only opens the Added Entities/Flows tabs (no map-bearing tab
// needs real Leaflet behavior), but the Input Map tab is auto-seeded active
// on mount (didSeedTabRef) for every model, so it still needs to mount
// without crashing under jsdom.
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

// Item 4's #4 test (Workspace-level snapshot regression) stubs JadeFlowsTab
// and PlantsTab (spy-and-capture convention, mirrors
// Workspace.DisplayedInputs.test.tsx's own outputMapTabSpy/warehousesTabSpy
// pattern) so it can inspect exactly which props reach JadeFlowsTab and
// drive PlantsTab's onAddedPlantsChange directly, without needing to
// simulate a real Leaflet drag/click gesture in jsdom.
const jadeFlowsTabSpy = vi.fn();
vi.mock("@/components/workspace/tabs/JadeFlowsTab", () => ({
  JadeFlowsTab: (props: unknown) => {
    jadeFlowsTabSpy(props);
    return <div data-testid="jade-flows-tab-stub" />;
  },
}));

// The Plants-sub-tab data+mutation wiring tests below need the REAL
// PlantsTab (real rows/add-form), so this mock is a passthrough to the
// actual component — it only ADDS the spy, unlike JadeFlowsTab's stub
// above (nothing in this file inspects JadeFlowsTab's own rendered DOM).
const plantsTabSpy = vi.fn();
vi.mock("@/components/workspace/tabs/PlantsTab", async () => {
  const actual = await vi.importActual<typeof import("@/components/workspace/tabs/PlantsTab")>(
    "@/components/workspace/tabs/PlantsTab",
  );
  return {
    ...actual,
    PlantsTab: (props: Parameters<typeof actual.PlantsTab>[0]) => {
      plantsTabSpy(props);
      return <actual.PlantsTab {...props} />;
    },
  };
});

const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockSolveScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCreateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCloneScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockDeleteScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

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
  useGetReferenceDistances: vi.fn(() => ({ data: undefined })),
  getGetReferenceDistancesQueryKey: vi.fn((id: string) => ["reference-distances", id]),
  useListModels: vi.fn(),
  usePrecheckScenario: vi.fn(() => ({ data: { ok: true, errors: [] } })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  useLogoutUser: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
  getGetDatasetQueryKey: vi.fn(() => ["dataset"]),
  getPrecheckScenarioQueryKey: vi.fn((id: number) => ["precheck", id]),
}));

import { Workspace } from "@/pages/Workspace";
import type { StudioModelType } from "@/lib/chapters";
import { useGetScenario, useListScenarios, useGetDataset, useListModels, usePrecheckScenario } from "@workspace/api-client-react";

const mockUseGetScenario = vi.mocked(useGetScenario);
const mockUseListScenarios = vi.mocked(useListScenarios);
const mockUseGetDataset = vi.mocked(useGetDataset);
const mockUseListModels = vi.mocked(useListModels);
const mockUsePrecheckScenario = vi.mocked(usePrecheckScenario);

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockSolveScenario.mutate.mockReset();
  mockCreateScenario.mutate.mockReset();
  mockCloneScenario.mutate.mockReset();
  mockDeleteScenario.mutate.mockReset();
  mockUsePrecheckScenario.mockReturnValue({ data: { ok: true, errors: [] } } as unknown as ReturnType<typeof usePrecheckScenario>);
});

function innerTabLabels(): string[] {
  const group = screen.getByTestId("added-entities-inner-tabs");
  return within(group)
    .getAllByRole("button")
    .map(b => b.textContent ?? "");
}

// ── Matrix: every model gets EXACTLY its own Added Entities sub-tab set ────

interface ModelFixture {
  modelId: StudioModelType;
  scenario: Record<string, unknown>;
  dataset: Record<string, unknown>;
  models: Record<string, unknown>[];
  expectedSubTabs: string[];
}

const pmedianInputs = {
  p: 3,
  distanceBands: [200, 400, 800, 1600],
  capacityMode: "none",
  uniformCapacity: null,
  warehouseOverrides: [],
  customerOverrides: [],
  addedWarehouses: [],
  addedCustomers: [],
  gap: 0,
  timeLimitSec: 120,
};

const pmedianDataset = {
  warehouses: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }],
  customers: [{ id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 }],
};

const pmedianModel = {
  id: "p-median-us",
  countryBounds: { sw: [24, -125], ne: [50, -66] },
  capabilities: {
    supportsP: true,
    capacityModes: ["none", "uniform", "per_wh"],
    demandEditable: true,
    outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
  },
};

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

const brazilDataset = {
  warehouses: [{ id: "WH-ANP", city: "Anápolis", state: "ANP", lat: -16.33, lng: -48.95 }],
  customers: [{ id: "REG-SP", city: "São Paulo", state: "SP", lat: -23.55, lng: -46.63, demand: 5000000 }],
};

const brazilModel = {
  id: "p-median-brazil",
  countryBounds: { sw: [-30, -68], ne: [0, -35] },
  capabilities: { supportsP: true, capacityModes: ["uniform"], demandEditable: false, outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"], supportsFacilityStatus: true },
};

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

const transportDataset = {
  warehouses: [{ id: "KY", city: "Louisville", state: "KY", lat: 38.25, lng: -85.76 }],
  customers: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62, demand: 900000 }],
};

const transportModel = {
  id: "transport-coal",
  countryBounds: { sw: [29.76, -122.42], ne: [47.61, -73.61] },
  capabilities: { supportsP: false, capacityModes: ["per_mine"], demandEditable: true, outputGrids: ["flows", "costSummary", "serviceStats"] },
};

const goldInputs = {
  bomRatio: 1.1,
  refineryOverrides: [],
  customerOverrides: [],
  addedRefineries: [],
  addedCustomers: [],
  distanceOverrides: [],
  distanceBands: [500, 1000, 1500, 2000, 2600],
  gap: 0,
  timeLimitSec: 120,
};

const goldDataset = {
  warehouses: [
    { id: "kalgoorlie", city: "Kalgoorlie", state: "WA", lat: -30.7, lng: 121.4, kind: "mine" as const },
    { id: "cunnamulla", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68, kind: "facility" as const },
    { id: "daggar_hills", city: "Daggar Hills", state: "QLD", lat: -25.0, lng: 145.0, kind: "facility" as const },
  ],
  customers: [{ id: "sydney", city: "Sydney", state: "NSW", lat: -33.87, lng: 151.2, demand: 100000 }],
};

const goldModel = {
  id: "two-echelon-gold-au",
  countryBounds: { sw: [-38.5, 113.0], ne: [-16.0, 154.5] },
  capabilities: { supportsP: false, capacityModes: [], demandEditable: true, outputGrids: ["openWarehouses", "flows", "assignments", "costSummary", "serviceStats"] },
};

const jadeInputs = {
  p: 2,
  distanceBands: [200, 400, 800, 1600],
  gap: 0,
  timeLimitSec: 120,
  warehouseOverrides: [],
  customerOverrides: [],
  plantProductCapability: [],
  addedPlants: [],
  addedWarehouses: [],
  addedCustomers: [],
  distanceOverrides: [],
};

const jadeDataset = {
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

const jadeModel = {
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
};

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

// Deliberately blank `state` on every row (Chen's real dataset shape — a
// China dataset with no state field at all) so `hasStateColumn` (computed
// from real data presence, Workspace.tsx's own `useMemo`) genuinely resolves
// `false` here, proving the wiring rather than assuming it.
const chensDataset = {
  warehouses: [{ id: "wh-cn-1", city: "Shenzhen", state: "", lat: 22.54, lng: 114.06 }],
  customers: [{ id: "cs-cn-1", city: "Guangzhou", state: "", lat: 23.13, lng: 113.26, demand: 500 }],
};

const chensModel = {
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
};

function makeScenario(id: number, modelId: string, inputs: Record<string, unknown>) {
  return {
    id,
    name: "Test scenario",
    modelId,
    inputs,
    result: null,
    stale: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const fixtures: ModelFixture[] = [
  { modelId: "p-median-us", scenario: makeScenario(1, "p-median-us", pmedianInputs), dataset: pmedianDataset, models: [pmedianModel], expectedSubTabs: ["Warehouses", "Customers"] },
  { modelId: "p-median-brazil", scenario: makeScenario(2, "p-median-brazil", brazilInputs), dataset: brazilDataset, models: [brazilModel], expectedSubTabs: ["Warehouses", "Customers"] },
  { modelId: "transport-coal", scenario: makeScenario(3, "transport-coal", transportInputs), dataset: transportDataset, models: [transportModel], expectedSubTabs: ["Mines", "Stations"] },
  { modelId: "two-echelon-gold-au", scenario: makeScenario(4, "two-echelon-gold-au", goldInputs), dataset: goldDataset, models: [goldModel], expectedSubTabs: ["Refineries", "Customers"] },
  { modelId: "two-echelon-jade-us", scenario: makeScenario(5, "two-echelon-jade-us", jadeInputs), dataset: jadeDataset, models: [jadeModel], expectedSubTabs: ["Plants", "Warehouses", "Customers"] },
  { modelId: "chens-cosmetics-cn", scenario: makeScenario(6, "chens-cosmetics-cn", chensInputs), dataset: chensDataset, models: [chensModel], expectedSubTabs: ["Warehouses", "Customers"] },
];

describe("Workspace — Added Entities tab, per-model sub-tab matrix (all 6 models)", () => {
  for (const fx of fixtures) {
    it(`${fx.modelId}: Added Entities tab renders EXACTLY {${fx.expectedSubTabs.join(", ")}}`, () => {
      mockUseListScenarios.mockReturnValue({ data: [fx.scenario] } as unknown as ReturnType<typeof useListScenarios>);
      mockUseGetScenario.mockReturnValue({ data: fx.scenario } as unknown as ReturnType<typeof useGetScenario>);
      mockUseGetDataset.mockReturnValue({ data: fx.dataset } as unknown as ReturnType<typeof useGetDataset>);
      mockUseListModels.mockReturnValue({ data: fx.models } as unknown as ReturnType<typeof useListModels>);

      render(<Workspace modelId={fx.modelId} userEmail="student@example.com" />);
      fireEvent.click(screen.getByTestId("sidebar-input-added-entities"));

      expect(innerTabLabels()).toEqual(fx.expectedSubTabs);
      // No base table/toolbar leaks into the Added Entities tab itself —
      // its content region has no `${entity}-tab` testid at all (see
      // WarehousesTab.tsx/CustomersTab.tsx/etc.'s own `showBaseTable=false`
      // branch, a bare unlabeled `<div>`).
      expect(screen.queryByTestId("warehouses-tab")).not.toBeInTheDocument();
      expect(screen.queryByTestId("customers-tab")).not.toBeInTheDocument();
    });
  }

  it("two-echelon-jade-us: the Customers sub-tab stays in per-product demand mode (product columns, not a scalar Demand column)", () => {
    const scenario = makeScenario(5, "two-echelon-jade-us", {
      ...jadeInputs,
      addedCustomers: [{ id: "ac-1", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, demands: { "product-1": 50 } }],
    });
    mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: jadeDataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({ data: [jadeModel] } as unknown as ReturnType<typeof useListModels>);

    render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-added-entities"));
    fireEvent.click(screen.getByTestId("button-added-entities-inner-customers"));

    // Product-named column header (per-product mode), not the scalar "Demand"
    // header a non-JADE model's Customers sub-tab would show.
    expect(screen.getByRole("columnheader", { name: "Product 1" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Demand" })).not.toBeInTheDocument();
    expect(screen.getByTestId("input-added-customer-demand-ac-1-product-1")).toBeInTheDocument();
  });

  it("two-echelon-gold-au: the Refineries sub-tab is entity=\"refineries\" (singular copy says 'refinery', not 'warehouse')", () => {
    const scenario = makeScenario(4, "two-echelon-gold-au", goldInputs);
    mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: goldDataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({ data: [goldModel] } as unknown as ReturnType<typeof useListModels>);

    render(<Workspace modelId="two-echelon-gold-au" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-added-entities"));
    // "refineries" is this model's first, default-active, sub-tab.
    expect(screen.getByText("Added refineries")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-warehouse-row")).toHaveTextContent("+ Add refinery");
  });

  it("chens-cosmetics-cn: the Warehouses sub-tab has hasStateColumn=false (no State column in the added-rows table or add-row form)", () => {
    const scenario = makeScenario(6, "chens-cosmetics-cn", chensInputs);
    mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: chensDataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({ data: [chensModel] } as unknown as ReturnType<typeof useListModels>);

    render(<Workspace modelId="chens-cosmetics-cn" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-added-entities"));
    // "warehouses" is this model's first, default-active, sub-tab.
    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));

    expect(screen.queryByTestId("input-new-warehouse-state")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "State" })).not.toBeInTheDocument();
  });
});

// ── Model-specific data + mutation wiring: two-echelon-gold-au Refineries ──
// (highest risk — reuses WarehousesTab bound to addedRefineries, NOT
// addedWarehouses; must render/edit/delete/precheck against the CORRECT key)

describe("Workspace — Added Entities, Gold Refineries sub-tab data + mutation wiring (highest risk: addedRefineries, not addedWarehouses)", () => {
  const existingRefinery = { id: "ar-1", displayCode: "RF-QLD-TST-01", city: "Testville", state: "QLD", lat: -20.0, lng: 140.0, capacity: null, status: "active" as const };

  function renderGoldWithRefinery(precheckOk = true) {
    const scenario = makeScenario(4, "two-echelon-gold-au", { ...goldInputs, addedRefineries: [existingRefinery] });
    mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: goldDataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({ data: [goldModel] } as unknown as ReturnType<typeof useListModels>);
    if (!precheckOk) {
      mockUsePrecheckScenario.mockReturnValue({
        data: { ok: false, errors: [{ code: "completeness", message: "ar-1 missing distances to 1 customer(s): sydney" }] },
      } as unknown as ReturnType<typeof usePrecheckScenario>);
    }
    render(<Workspace modelId="two-echelon-gold-au" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-added-entities"));
  }

  it("(a)+(d) an existing addedRefineries row renders from the correct model-specific array, and the precheck chip reaches it", () => {
    renderGoldWithRefinery(false);

    expect(screen.getByTestId("row-added-warehouse-ar-1")).toBeInTheDocument();
    expect(screen.getByText("Testville")).toBeInTheDocument();
    expect(screen.getByTestId("warning-precheck-added-warehouse-ar-1")).toHaveTextContent("1");
  });

  it("(b) editing an added-row field (status) calls the correct callback and Saves into addedRefineries, NOT addedWarehouses", () => {
    renderGoldWithRefinery();
    fireEvent.click(screen.getByTestId("button-added-wh-ar-1-inactive"));
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    const sentInputs = args.data.inputs as Record<string, unknown>;
    expect(sentInputs.addedRefineries).toEqual([expect.objectContaining({ id: "ar-1", status: "inactive" })]);
    expect(sentInputs.addedWarehouses ?? []).toEqual([]);
  });

  it("(c) deleting the added row removes it from addedRefineries, NOT addedWarehouses", () => {
    renderGoldWithRefinery();
    fireEvent.click(screen.getByTestId("button-delete-added-warehouse-ar-1"));
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    const sentInputs = args.data.inputs as Record<string, unknown>;
    expect(sentInputs.addedRefineries).toEqual([]);
    expect(sentInputs.addedWarehouses ?? []).toEqual([]);
  });
});

// ── Model-specific data + mutation wiring, non-reuse model: JADE Plants ────
// (Plants has no shared-component reuse trap like Gold's Refineries, but
// proves the pattern generalizes beyond Gold — render an existing row +
// mutate via the real add-row form, Save into the correct key.)

describe("Workspace — Added Entities, JADE Plants sub-tab data + mutation wiring (non-reuse model)", () => {
  const existingPlant = { id: "ap-1", displayCode: "PL-TX-DAL-01", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8 };

  function renderJadeWithPlant() {
    const scenario = makeScenario(5, "two-echelon-jade-us", { ...jadeInputs, addedPlants: [existingPlant] });
    mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: jadeDataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({ data: [jadeModel] } as unknown as ReturnType<typeof useListModels>);
    render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-added-entities"));
  }

  it("(a) an existing addedPlants row renders from the correct array (Plants is this model's default-active sub-tab)", () => {
    renderJadeWithPlant();
    expect(screen.getByTestId("row-added-plant-ap-1")).toBeInTheDocument();
    expect(screen.getByText("Dallas")).toBeInTheDocument();
  });

  it("(b) adding a new plant via the real add-row form calls onAddedPlantsChange and Saves into addedPlants", () => {
    renderJadeWithPlant();
    fireEvent.click(screen.getByTestId("button-add-plant-row"));
    fireEvent.change(screen.getByTestId("input-new-plant-city"), { target: { value: "Reno" } });
    fireEvent.change(screen.getByTestId("input-new-plant-state"), { target: { value: "NV" } });
    fireEvent.change(screen.getByTestId("input-new-plant-lat"), { target: { value: "39.53" } });
    fireEvent.change(screen.getByTestId("input-new-plant-lng"), { target: { value: "-119.81" } });
    fireEvent.click(screen.getByTestId("button-add-plant-confirm"));

    fireEvent.click(screen.getByTestId("button-save"));
    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    const sentPlants = (args.data.inputs as { addedPlants: Record<string, unknown>[] }).addedPlants;
    expect(sentPlants).toHaveLength(2);
    expect(sentPlants).toEqual(
      expect.arrayContaining([existingPlant, expect.objectContaining({ city: "Reno", state: "NV" })]),
    );
  });
});

// ── Item 2: Flows effective-plants snapshot regression (Workspace-level) ──

describe("Workspace — JadeFlowsTab effectivePlants resolves from the SOLVED snapshot (displayedInputs), never the unsaved draft", () => {
  const solvedAddedPlant = { id: "ap-1", displayCode: "PL-SS-SOL-01", city: "Solved City", state: "SS", lat: 1, lng: 1 };

  function makeJadeSolvedScenario(id: number, addedPlant: typeof solvedAddedPlant, objective: number) {
    return {
      id,
      name: "JADE base case",
      modelId: "two-echelon-jade-us",
      inputs: { ...jadeInputs, addedPlants: [addedPlant] },
      result: {
        status: "optimal" as const,
        objective,
        runTimeSec: 0.5,
        quality: "Proven optimal",
        edges: [{ fromId: "ap-1", toId: "wh-11", flow: 1000, distance: 300, leg: "plant_to_warehouse" as const, productId: "product-1" }],
        metrics: { weightedAvgDistance: 150, utilizationByNode: [], bandCoverage: [] },
        details: {},
        solverUsed: "CBC",
        infeasibilityReason: null,
      },
      stale: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
  }

  function renderJade() {
    mockUseGetDataset.mockReturnValue({ data: jadeDataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({ data: [jadeModel] } as unknown as ReturnType<typeof useListModels>);
    return render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);
  }

  it("an unsaved draft edit to the SAME added plant's city does not change the Flows plant label — it still resolves from the solved snapshot", () => {
    const scenario = makeJadeSolvedScenario(5, solvedAddedPlant, 100000);
    mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
    renderJade();

    fireEvent.click(screen.getByTestId("sidebar-output-flows"));
    expect(jadeFlowsTabSpy).toHaveBeenCalledWith(
      expect.objectContaining({ effectivePlants: expect.arrayContaining([expect.objectContaining({ id: "ap-1", city: "Solved City", state: "SS" })]) }),
    );

    // Mutate the DRAFT (localInputs) directly through PlantsTab's own real
    // onAddedPlantsChange callback (captured via the spy) — same production
    // code path a real edit would call — WITHOUT saving.
    fireEvent.click(screen.getByTestId("sidebar-input-added-entities"));
    const lastPlantsTabProps = plantsTabSpy.mock.calls.at(-1)?.[0] as {
      onAddedPlantsChange: (next: unknown[]) => void;
    };
    act(() => lastPlantsTabProps.onAddedPlantsChange([{ ...solvedAddedPlant, city: "Draft City" }]));

    jadeFlowsTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("sidebar-output-flows"));

    // STILL the solved snapshot's city — the unsaved draft never reaches it.
    expect(jadeFlowsTabSpy).toHaveBeenCalledWith(
      expect.objectContaining({ effectivePlants: expect.arrayContaining([expect.objectContaining({ id: "ap-1", city: "Solved City", state: "SS" })]) }),
    );
  });

  it("stepping the result-history stepper advances BOTH the effectivePlants lookup and the displayed result together", () => {
    const oldScenario = makeJadeSolvedScenario(5, solvedAddedPlant, 100000);
    mockUseListScenarios.mockReturnValue({ data: [oldScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: oldScenario } as unknown as ReturnType<typeof useGetScenario>);
    const { rerender } = renderJade();

    const newAddedPlant = { ...solvedAddedPlant, city: "New Solve City" };
    const newScenario = makeJadeSolvedScenario(5, newAddedPlant, 999999);
    mockUseGetScenario.mockReturnValue({ data: newScenario } as unknown as ReturnType<typeof useGetScenario>);
    rerender(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);

    // A fresh solve landed on the SAME scenario (same id, new result
    // reference) — the history effect appends; the stepper now has 2
    // entries and defaults to the newest.
    fireEvent.click(screen.getByTestId("sidebar-output-flows"));
    expect(jadeFlowsTabSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ objective: 999999 }),
        effectivePlants: expect.arrayContaining([expect.objectContaining({ id: "ap-1", city: "New Solve City" })]),
      }),
    );

    jadeFlowsTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("button-result-back"));

    // Stepped back to the OLDER entry — BOTH the result AND the
    // effective-plants lookup revert together, from the SAME call's props
    // (proves they're driven by the same displayedInputs/displayedResult
    // pairing, not two independently-drifting sources).
    expect(jadeFlowsTabSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ objective: 100000 }),
        effectivePlants: expect.arrayContaining([expect.objectContaining({ id: "ap-1", city: "Solved City" })]),
      }),
    );
  });
});
