import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, act } from "@testing-library/react";
import { UnitProvider } from "@/contexts/UnitContext";

// chen-bands-units, Part D — components rendered inside this tree now read the
// display-unit preference via useDisplayUnit(), which throws without a
// provider. main.tsx already wraps the real app (T10); these tests render the
// component directly, so they need the same ancestor. RTL's `wrapper` option is
// used rather than a wrapping element so `rerender` keeps the provider too.
const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(ui, { wrapper: UnitProvider, ...options });


// jade-INT — Workspace-level integration coverage for the JADE Ch.9
// Workspace bundle's integration keystone (spec §2/§3/§5/§6/§9/§10):
//   1. #1 live band recolor (multi-model) + history-entry sync on a
//      bands-only save.
//   2. (workspace-fixups-2, item 7) JADE renders the SAME shared free chip
//      band editor as every other model, with no Workspace-level
//      validity-gating on Save/Run (the fixed-4 `JadeBandEditor` +
//      band-validity guard are both deleted; the chip editor's own
//      last-band ×-disabled guard is what now prevents an empty array).
//   3. #8 terminal solve timing retained at job-success and attached to the
//      NEWLY-APPENDED history entry once the refetch lands (not the older
//      displayed entry) — the real job-success-then-refetch-append order.
//   4. #2 `effectivePlants` (dataset.plants ∪ displayedInputs.addedPlants)
//      reaching the JADE Output Map's `plants` prop.
//   5. #9 `enableFilters` wired `true` only on the JADE path for the shared
//      Warehouses/Customers/Open-Warehouses tabs.
//
// OutputMapTab/WarehousesTab/CustomersTab/OpenWarehousesTab are stubbed as
// prop-capturing spies (same convention Workspace.DisplayedInputs.test.tsx
// already uses for OutputMapTab) — this file only needs to prove WHICH
// values reach those components' props, not their own internal rendering
// (already covered by their own component tests). OptimizationParametersTab/
// SolveDialog are left REAL (simple presentational components, no external
// hooks) so the shared chip-editor tests exercise real behavior, not a
// mocked stand-in.

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-3", vi.fn()],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn(), fetchQuery: vi.fn(() => Promise.resolve({ ok: true, errors: [] })) };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

const outputMapTabSpy = vi.fn();
vi.mock("@/components/workspace/tabs/OutputMapTab", () => ({
  OutputMapTab: (props: unknown) => {
    outputMapTabSpy(props);
    return <div data-testid="output-map-tab-stub" />;
  },
}));

const warehousesTabSpy = vi.fn();
vi.mock("@/components/workspace/tabs/WarehousesTab", () => ({
  WarehousesTab: (props: unknown) => {
    warehousesTabSpy(props);
    return <div data-testid="warehouses-tab-stub" />;
  },
}));

const customersTabSpy = vi.fn();
vi.mock("@/components/workspace/tabs/CustomersTab", () => ({
  CustomersTab: (props: unknown) => {
    customersTabSpy(props);
    return <div data-testid="customers-tab-stub" />;
  },
}));

const openWarehousesTabSpy = vi.fn();
vi.mock("@/components/workspace/tabs/OpenWarehousesTab", () => ({
  OpenWarehousesTab: (props: unknown) => {
    openWarehousesTabSpy(props);
    return <div data-testid="open-warehouses-tab-stub" />;
  },
}));

const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockUpdateDistanceBands = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockSolveScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(),
  useGetScenario: vi.fn(),
  useGetDataset: vi.fn(),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  // chen-bands-units, Part G, T14 — field-scoped `distanceBands` PATCH,
  // used by the Save control when only the band lens is dirty.
  useUpdateDistanceBands: vi.fn(() => mockUpdateDistanceBands),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useCreateScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useCloneScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  useListModels: vi.fn(),
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
import { useGetScenario, useListScenarios, useGetDataset, useListModels, useGetSolveJob } from "@workspace/api-client-react";

const mockUseGetScenario = vi.mocked(useGetScenario);
const mockUseListScenarios = vi.mocked(useListScenarios);
const mockUseGetDataset = vi.mocked(useGetDataset);
const mockUseListModels = vi.mocked(useListModels);
const mockUseGetSolveJob = vi.mocked(useGetSolveJob);

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockSolveScenario.mutate.mockReset();
  mockUseGetSolveJob.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGetSolveJob>);
});

// ── #1 live recolor (multi-model) + history-entry sync ─────────────────────
describe("Workspace — #1 live band recolor + history-entry sync (all models)", () => {
  const pmedianInputs = {
    p: 3,
    distanceBands: [100, 200, 300, 400],
    capacityMode: "none",
    uniformCapacity: null,
    warehouseOverrides: [],
    customerOverrides: [],
    gap: 0,
    timeLimitSec: 120,
  };

  const resultA = {
    status: "optimal" as const,
    objective: 1000,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [{ fromId: "CHI", toId: "C1", flow: 100, distance: 90 }],
    metrics: { weightedAvgDistance: 90, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["CHI"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };
  const resultB = { ...resultA, objective: 2000 };

  const scenarioA = {
    id: 1,
    name: "3 Warehouses",
    modelId: "p-median-us",
    inputs: pmedianInputs,
    result: resultA,
    stale: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const dataset = {
    warehouses: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }],
    customers: [{ id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 }],
  };

  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [scenarioA] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenarioA } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({
      data: [
        {
          id: "p-median-us",
          countryBounds: { sw: [24, -125], ne: [50, -66] },
          distanceUnit: "mi",
          capabilities: { supportsP: true, capacityModes: ["none"], demandEditable: true, outputGrids: [], supportsFacilityStatus: true },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);
  });

  it("editing draft bands recolors the Output Map immediately, with zero network calls (p-median-us)", () => {
    render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);

    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-remove-band-400"));

    outputMapTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(outputMapTabSpy).toHaveBeenCalledWith(expect.objectContaining({ bands: [100, 200, 300] }));
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
    expect(mockSolveScenario.mutate).not.toHaveBeenCalled();
  });

  // chen-bands-units — superseded rewrite (was "a bands-only save updates
  // the DISPLAYED history entry in place"). The dedicated band LENS
  // (decision 1f) makes the old "sync the history entry in place" mechanism
  // unnecessary: `activeBandLens` is untouched by history navigation at all
  // (decision 1b), so step-away/step-back preserves an edited/saved lens
  // structurally, with no per-entry sync needed. A bands-only edit now
  // routes through the FIELD-SCOPED PATCH (`useUpdateDistanceBands`), never
  // `useUpdateScenario`.
  it("a bands-only edit survives step-away/step-back (the lens is independent of history), and Save routes through the field-scoped PATCH", () => {
    const { rerender } = render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);

    // A second solve lands on the SAME scenario (new `.result` reference) —
    // the history effect appends rather than reseeding, so the stepper now
    // has 2 entries and defaults to the newest (index 1, the displayed one).
    const scenarioB = { ...scenarioA, result: resultB };
    mockUseGetScenario.mockReturnValue({ data: scenarioB } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [scenarioB] } as unknown as ReturnType<typeof useListScenarios>);
    rerender(<Workspace modelId="p-median-us" userEmail="student@example.com" />);

    // Edit bands on the currently-displayed (newest) entry — a lens-only
    // change (nothing ordinary edited).
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-remove-band-400"));

    // Step away (to the OLDER entry)...
    fireEvent.click(screen.getByTestId("button-result-back"));
    // ...then back to the newest entry. The lens is untouched by either step.
    fireEvent.click(screen.getByTestId("button-result-forward"));

    outputMapTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(outputMapTabSpy).toHaveBeenCalledWith(expect.objectContaining({ bands: [100, 200, 300] }));

    // Save routes through the field-scoped PATCH, labelled "Save bands",
    // never the whole-input PATCH.
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("button-save")).toHaveTextContent("Save bands");
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateDistanceBands.mutate).toHaveBeenCalledTimes(1);
    expect(mockUpdateDistanceBands.mutate.mock.calls[0][0]).toEqual({
      scenarioId: scenarioA.id,
      data: { distanceBands: [100, 200, 300] },
    });
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
  });
});

describe("Workspace — #1 live band recolor (two-echelon-jade-us, multi-model regression)", () => {
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

  const scenario = {
    id: 1,
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
      metrics: { weightedAvgDistance: 150, utilizationByNode: [], bandCoverage: [], openFacilityIds: ["wh-11"] },
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
    products: [{ id: "product-1", name: "Product 1" }],
    plantProductCapabilities: [{ plantId: "plant-1", productId: "product-1", capacity: 210000000 }],
  };

  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
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
            supportsPlantProductCapability: true,
          },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);
  });

  it("editing a valid draft band (shared chip editor, item 7) recolors the JADE Output Map immediately, with zero network calls", () => {
    render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);

    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-remove-band-1600"));
    fireEvent.click(screen.getByTestId("button-bands-plus"));
    fireEvent.change(screen.getByTestId("input-new-band"), { target: { value: "1500" } });
    fireEvent.click(screen.getByTestId("button-add-band-confirm"));

    outputMapTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(outputMapTabSpy).toHaveBeenCalledWith(expect.objectContaining({ bands: [200, 400, 800, 1500] }));
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
  });

  it("passes effectivePlants (dataset.plants ∪ displayedInputs.addedPlants) to the Output Map's `plants` prop (#2)", () => {
    const addedPlantScenario = {
      ...scenario,
      inputs: { ...jadeInputs, addedPlants: [{ id: "ap-1", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8, displayCode: "PL-TX-DALLAS-01" }] },
    };
    mockUseGetScenario.mockReturnValue({ data: addedPlantScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [addedPlantScenario] } as unknown as ReturnType<typeof useListScenarios>);

    render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    const call = outputMapTabSpy.mock.calls.at(-1)?.[0] as { plants?: { id: string }[] };
    expect(call.plants?.map(p => p.id).sort()).toEqual(["ap-1", "plant-1"]);
  });
});

// ── #9 enableFilters — JADE-only opt-in ─────────────────────────────────────
describe("Workspace — #9 enableFilters (JADE-only opt-in)", () => {
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

  const solvedResult = {
    status: "optimal" as const,
    objective: 100,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [{ fromId: "wh-11", toId: "customer-1", flow: 1000, distance: 150, leg: "warehouse_to_customer" as const }],
    metrics: { weightedAvgDistance: 150, utilizationByNode: [], bandCoverage: [] },
    details: {},
    solverUsed: "CBC",
    infeasibilityReason: null,
  };

  const jadeScenario = {
    id: 1,
    name: "JADE base case",
    modelId: "two-echelon-jade-us",
    inputs: jadeInputs,
    result: solvedResult,
    stale: false,
    createdAt: "2026-01-04T00:00:00Z",
    updatedAt: "2026-01-04T00:00:00Z",
  };

  const jadeDataset = {
    warehouses: [{ id: "wh-11", name: "Phoenix", city: "Phoenix", state: "AZ", lat: 33.45, lng: -112.07 }],
    customers: [{ id: "customer-1", name: "Los Angeles", city: "Los Angeles", state: "CA", lat: 34.05, lng: -118.24, demand: 100, demands: { "product-1": 100 } }],
    plants: [{ id: "plant-1", name: "Plant 1", city: "Ashland", state: "KY", lat: 38.45, lng: -82.67 }],
    products: [{ id: "product-1", name: "Product 1" }],
    plantProductCapabilities: [{ plantId: "plant-1", productId: "product-1", capacity: 210000000 }],
  };

  it("passes enableFilters=true to Warehouses/Customers/Open-Warehouses only on the JADE path", () => {
    mockUseListScenarios.mockReturnValue({ data: [jadeScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: jadeScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: jadeDataset } as unknown as ReturnType<typeof useGetDataset>);
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
            supportsPlantProductCapability: true,
          },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);

    render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);

    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(warehousesTabSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enableFilters: true });

    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    expect(customersTabSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enableFilters: true });

    fireEvent.click(screen.getByTestId("sidebar-output-open-warehouses"));
    expect(openWarehousesTabSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enableFilters: true });
  });

  it("does NOT pass enableFilters=true for a non-JADE model (p-median-us)", () => {
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
    const pmedianScenario = {
      id: 2,
      name: "3 Warehouses",
      modelId: "p-median-us",
      inputs: pmedianInputs,
      result: solvedResult,
      stale: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const pmedianDataset = {
      warehouses: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }],
      customers: [{ id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 }],
    };
    mockUseListScenarios.mockReturnValue({ data: [pmedianScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: pmedianScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: pmedianDataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({
      data: [
        {
          id: "p-median-us",
          countryBounds: { sw: [24, -125], ne: [50, -66] },
          distanceUnit: "mi",
          capabilities: { supportsP: true, capacityModes: ["none"], demandEditable: true, outputGrids: ["openWarehouses"], supportsFacilityStatus: true },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);

    render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);

    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(warehousesTabSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enableFilters: false });

    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    expect(customersTabSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enableFilters: false });

    fireEvent.click(screen.getByTestId("sidebar-output-open-warehouses"));
    expect(openWarehousesTabSpy.mock.calls.at(-1)?.[0]).toMatchObject({ enableFilters: false });
  });
});

// ── #1 JADE band-validity guard on every save/solve entry point ────────────
// jade-INT (workspace-fixups-2, item 7) — JADE's fixed-4-slot
// `JadeBandEditor` (+ its Workspace-level Save/Solve validity gate) is
// deleted; JADE now renders the SAME shared free chip editor as every other
// model (its backend schema was relaxed to `.min(1)`, matching
// p-median/transport/gold-au) with NO validity gating on Save/Run — the
// shared chip editor's own last-band `×`-disabled guard (item 7) is the only
// thing preventing an empty array, by construction, not a Workspace-level
// block.
describe("Workspace — JADE uses the shared chip band editor, no validity gate (item 7)", () => {
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

  const unsolvedScenario = {
    id: 1,
    name: "JADE base case",
    modelId: "two-echelon-jade-us",
    inputs: jadeInputs,
    result: null,
    stale: false,
    createdAt: "2026-01-04T00:00:00Z",
    updatedAt: "2026-01-04T00:00:00Z",
  };

  const dataset = {
    warehouses: [{ id: "wh-11", name: "Phoenix", city: "Phoenix", state: "AZ", lat: 33.45, lng: -112.07 }],
    customers: [{ id: "customer-1", name: "Los Angeles", city: "Los Angeles", state: "CA", lat: 34.05, lng: -118.24, demand: 100, demands: { "product-1": 100 } }],
    plants: [{ id: "plant-1", name: "Plant 1", city: "Ashland", state: "KY", lat: 38.45, lng: -82.67 }],
    products: [{ id: "product-1", name: "Product 1" }],
    plantProductCapabilities: [{ plantId: "plant-1", productId: "product-1", capacity: 210000000 }],
  };

  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [unsolvedScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: unsolvedScenario } as unknown as ReturnType<typeof useGetScenario>);
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
            supportsPlantProductCapability: true,
          },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);
  });

  it("Optimization Parameters renders the shared chip editor for JADE, not the fixed-4 editor", () => {
    render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));

    expect(screen.queryByTestId("jade-band-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-bands-plus")).toBeInTheDocument();
    expect(screen.getByTestId("button-remove-band-200")).toBeInTheDocument();
  });

  // chen-bands-units — a band-only edit (nothing ordinary changed) now
  // routes through the FIELD-SCOPED `distanceBands` PATCH (decision 1f),
  // never the whole-input PATCH.
  it("adding a 5th band and saving succeeds with no error — no validity gating blocks it", () => {
    render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));

    fireEvent.click(screen.getByTestId("button-bands-plus"));
    fireEvent.change(screen.getByTestId("input-new-band"), { target: { value: "3000" } });
    fireEvent.click(screen.getByTestId("button-add-band-confirm"));

    expect(screen.getByTestId("button-remove-band-3000")).toBeInTheDocument();
    expect(screen.getByTestId("button-save")).toBeEnabled();
    expect(screen.getByTestId("button-save")).toHaveTextContent("Save bands");

    fireEvent.click(screen.getByTestId("button-save"));
    expect(mockUpdateDistanceBands.mutate).toHaveBeenCalledTimes(1);
    expect(mockUpdateDistanceBands.mutate.mock.calls[0][0]).toEqual({
      scenarioId: unsolvedScenario.id,
      data: { distanceBands: [200, 400, 800, 1600, 3000] },
    });
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
  });

  it("removing down to one band disables that last band's × control (Optimization Parameters)", () => {
    const oneBandScenario = { ...unsolvedScenario, inputs: { ...jadeInputs, distanceBands: [500] } };
    mockUseGetScenario.mockReturnValue({ data: oneBandScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [oneBandScenario] } as unknown as ReturnType<typeof useListScenarios>);
    render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));

    expect(screen.getByTestId("button-remove-band-500")).toBeDisabled();
  });

  it("the Solve dialog's chip editor also disables the last band's × control at length 1", () => {
    const oneBandScenario = { ...unsolvedScenario, inputs: { ...jadeInputs, distanceBands: [500] } };
    mockUseGetScenario.mockReturnValue({ data: oneBandScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [oneBandScenario] } as unknown as ReturnType<typeof useListScenarios>);
    render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("button-run-optimizer"));

    expect(screen.queryByTestId("jade-band-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-button-remove-band-500")).toBeDisabled();
  });

  it("a valid JADE band edit via the Solve dialog does not block Run — the solve is enqueued", () => {
    render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);

    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    expect(mockSolveScenario.mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("solve-dialog-error")).not.toBeInTheDocument();
  });
});

// ── #8 terminal timing — retained at job-success, attached to the NEW entry ─
describe("Workspace — #8 solve timing survives the job-success-then-refetch-append race", () => {
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

  const resultA = {
    status: "optimal" as const,
    objective: 1000,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [{ fromId: "CHI", toId: "C1", flow: 100, distance: 90 }],
    metrics: { weightedAvgDistance: 90, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["CHI"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };
  const resultB = { ...resultA, objective: 2000 };

  const scenarioA = {
    id: 1,
    name: "3 Warehouses",
    modelId: "p-median-us",
    inputs: pmedianInputs,
    result: resultA,
    stale: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  const dataset = {
    warehouses: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }],
    customers: [{ id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 }],
  };

  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [scenarioA] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenarioA } as unknown as ReturnType<typeof useGetScenario>);
    mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof useGetDataset>);
    mockUseListModels.mockReturnValue({
      data: [
        {
          id: "p-median-us",
          countryBounds: { sw: [24, -125], ne: [50, -66] },
          distanceUnit: "mi",
          capabilities: { supportsP: true, capacityModes: ["none"], demandEditable: true, outputGrids: [], supportsFacilityStatus: true },
        },
      ],
    } as unknown as ReturnType<typeof useListModels>);
  });

  it("retains the terminal timing at job success and attaches it to the newly-appended history entry, not the older displayed one", () => {
    const { rerender } = render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);

    // Enqueue a solve (not dirty — direct solve path).
    mockSolveScenario.mutate.mockImplementation((_vars, opts) => opts.onSuccess({ jobId: 42 }));
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));
    expect(mockSolveScenario.mutate).toHaveBeenCalledTimes(1);

    const queuedAt = new Date("2026-02-01T00:00:00.000Z");
    const startedAt = new Date("2026-02-01T00:00:02.000Z");
    const finishedAt = new Date("2026-02-01T00:00:07.000Z");

    // Job succeeds — polled BEFORE the refetch lands a genuinely new
    // `.result` (the real production ordering: job-success observed first,
    // history-append effect fires later once the invalidated query
    // refetches). Timing is retained here, not attached yet (no new entry
    // exists to attach it to).
    mockUseGetSolveJob.mockReturnValue({
      data: { id: 42, status: "succeeded", error: null, resultSummary: null, queuedAt, startedAt, finishedAt },
    } as unknown as ReturnType<typeof useGetSolveJob>);
    rerender(<Workspace modelId="p-median-us" userEmail="student@example.com" />);

    // The refetch now lands: a genuinely new `.result` reference for the
    // SAME scenario id — the append effect fires and must consume the
    // retained timing onto THIS new entry, not the older (resultA) one.
    const scenarioB = { ...scenarioA, result: resultB };
    mockUseGetScenario.mockReturnValue({ data: scenarioB } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [scenarioB] } as unknown as ReturnType<typeof useListScenarios>);
    rerender(<Workspace modelId="p-median-us" userEmail="student@example.com" />);

    // Output Map is already the active tab (auto-opened by the earlier
    // job-success effect) — re-clicking an already-active tab is a
    // no-op that doesn't re-render, so read the call this rerender itself
    // already produced rather than clicking again.
    const call = outputMapTabSpy.mock.calls.at(-1)?.[0] as { timing?: { totalSec: number; queuedSec: number; activeSec: number } };
    expect(call.timing).toEqual({ totalSec: 7, queuedSec: 2, activeSec: 5 });

    // Step back to the OLDER entry (resultA, this session's first-load
    // entry) — it never had a matching job, so its timing must be
    // SUPPRESSED (undefined), never the just-retained one bleeding onto it.
    outputMapTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("button-result-back"));
    const olderCall = outputMapTabSpy.mock.calls.at(-1)?.[0] as { timing?: unknown };
    expect(olderCall.timing).toBeUndefined();
  });
});
