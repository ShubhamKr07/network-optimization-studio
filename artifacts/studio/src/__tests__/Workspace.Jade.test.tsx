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


// jade-T15.5 — Workspace-level integration coverage for the Chapter 9 JADE
// (two-echelon-jade-us) fast-follow flip: the tab registry (Plants,
// Capability Matrix, alongside the reused Warehouses/Customers/Distances/
// Optimization Parameters components), the effective-row projection built
// for the Input Map + Capability Matrix (Gate 6.5 — base ⊕ overrides ∪
// added), and Save reconciliation (the server's normalizeAddedEntityDistances-
// augmented `inputs` must be adopted so a newly-estimated distance row
// persists and the scenario isn't immediately re-flagged dirty). Mirrors
// Workspace.TwoEchelon.test.tsx's own structure for its sibling fast-follow
// task. Full tab-mount/gating coverage (every Inputs/Outputs entry opens
// real content, not a placeholder) lives in Workspace.TabCoverage.test.tsx's
// own two-echelon-jade-us describe block — not duplicated here.

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-9/jade", mockNavigate],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn(), fetchQuery: vi.fn(() => Promise.resolve({ ok: true, errors: [] })) };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

const jadeInputs = {
  p: 2,
  distanceBands: [200, 400, 800, 1600],
  gap: 0,
  timeLimitSec: 120,
  // wh-11 forced to "inactive" — the effective-row projection test below
  // asserts the Input Map reflects THIS override, not the base "active"
  // default.
  warehouseOverrides: [{ id: "wh-11", status: "inactive" }],
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
  result: null,
  stale: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
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

const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCreateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockUseGetScenario = vi.fn(() => ({ data: scenario }));
const mockUseListScenarios = vi.fn(() => ({ data: [scenario] }));
const mockUseGetDataset = vi.fn(() => ({ data: dataset }));

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
  useGetReferenceDistances: vi.fn(() => ({ data: undefined })),
  getGetReferenceDistancesQueryKey: vi.fn((id: string) => ["reference-distances", id]),
  useListModels: vi.fn(() => ({
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
  return render(<Workspace modelId="two-echelon-jade-us" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockCreateScenario.mutate.mockReset();
  mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof mockUseGetScenario>);
  mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
  mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof mockUseGetDataset>);
});

describe("Workspace — two-echelon-jade-us tab registry (jade-T15.5)", () => {
  it("shows Plants and Capability Matrix sidebar entries alongside the reused Warehouses/Customers/Distances", () => {
    renderWorkspace();
    expect(screen.getByTestId("sidebar-input-plants")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-input-capability-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-input-warehouses")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-input-customers")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-input-distances")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-input-optimization-parameters")).toBeInTheDocument();
  });

  it("Warehouses tab has no Capacity column (JADE's capacityModes: [] — no capacity concept)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(screen.getByTestId("warehouses-tab")).toBeInTheDocument();
    expect(screen.queryByText("Capacity")).not.toBeInTheDocument();
  });

  it("create-scenario uses this model's own default inputs (no static p.max, every added-entity array starts empty)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-create-scenario"));
    fireEvent.click(screen.getByTestId("button-create-confirm"));

    expect(mockCreateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockCreateScenario.mutate.mock.calls[0];
    expect(args.data.modelId).toBe("two-echelon-jade-us");
    expect(args.data.inputs).toEqual({
      p: 3,
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
    });
  });
});

describe("Workspace — two-echelon-jade-us effective-row projection (Gate 6.5)", () => {
  it("renders the full jade Input Map editor (plant square + warehouse triangle + customer bubble), not a placeholder", () => {
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    expect(screen.getByTestId("jade-map-toolbar")).toBeInTheDocument();
    // wh-11 is forced "inactive" by this file's default fixture — the map's
    // own "Show inactive" layer toggle defaults off (EntityMarkers.tsx), so
    // its marker is intentionally hidden until that's switched on (see the
    // very next test, which does exactly that and asserts the EFFECTIVE
    // status directly).
    fireEvent.click(screen.getByTestId("toggle-layer-show-inactive"));
    expect(container.querySelector(".pl-marker")).not.toBeNull();
    expect(container.querySelector(".wh-marker")).not.toBeNull();
    expect(container.querySelector(".cs-marker")).not.toBeNull();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("an inactive warehouseOverride is reflected on the map as the EFFECTIVE status, not the base dataset's implicit 'active'", () => {
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    // Reveal the (by-default-hidden) inactive candidate first.
    fireEvent.click(screen.getByTestId("toggle-layer-show-inactive"));
    const whMarker = container.querySelector(".wh-marker") as HTMLElement;
    expect(whMarker).not.toBeNull();
    fireEvent.click(whMarker);
    expect(screen.getByTestId("map-details-status")).toHaveTextContent("Inactive");
  });

  it("an added plant is unioned onto the base plant, both rendered on the map", () => {
    const addedScenario = {
      ...scenario,
      inputs: { ...jadeInputs, addedPlants: [{ id: "ap-1", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8 }] },
    };
    mockUseGetScenario.mockReturnValue({ data: addedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [addedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    expect(container.querySelectorAll(".pl-marker")).toHaveLength(2);
  });

  it("the Capability Matrix tab's effective plants include an added plant, defaulting every capability cell to disabled", () => {
    const addedScenario = {
      ...scenario,
      inputs: {
        ...jadeInputs,
        addedPlants: [{ id: "ap-1", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8, displayCode: "PL-TX-DALLAS-01" }],
      },
    };
    mockUseGetScenario.mockReturnValue({ data: addedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [addedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-capability-matrix"));
    expect(screen.getByTestId("row-capability-ap-1")).toBeInTheDocument();
    expect(screen.getByTestId("checkbox-capability-ap-1-product-1")).not.toBeChecked();
    // The base plant's own base-matrix cell IS enabled (capacity 210000000).
    expect(screen.getByTestId("checkbox-capability-plant-1-product-1")).toBeChecked();
  });
});

describe("Workspace — two-echelon-jade-us Save reconciliation (Gate 6.5)", () => {
  it("adopts the server response's inputs after Save, so a newly-added plant's backend-estimated distance persists and the scenario is not re-flagged dirty", async () => {
    renderWorkspace();
    // jade-INT (workspace-fixups-2, item 1 revert) — the add-row form is
    // back inline on the base Plants tab.
    fireEvent.click(screen.getByTestId("sidebar-input-plants"));
    fireEvent.click(screen.getByTestId("button-add-plant-row"));
    fireEvent.change(screen.getByTestId("input-new-plant-city"), { target: { value: "Dallas" } });
    fireEvent.change(screen.getByTestId("input-new-plant-state"), { target: { value: "TX" } });
    fireEvent.change(screen.getByTestId("input-new-plant-lat"), { target: { value: "32.78" } });
    fireEvent.change(screen.getByTestId("input-new-plant-lng"), { target: { value: "-96.8" } });
    fireEvent.click(screen.getByTestId("button-add-plant-confirm"));

    // Dirty (unsaved) before Save.
    expect(screen.getByTestId("button-save")).toBeEnabled();

    fireEvent.click(screen.getByTestId("button-save"));
    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [saveArgs, saveOpts] = mockUpdateScenario.mutate.mock.calls[0];
    const sentInputs = saveArgs.data.inputs as Record<string, unknown> & { addedPlants: { id: string }[] };
    expect(sentInputs.addedPlants).toHaveLength(1);
    const plantId = sentInputs.addedPlants[0].id;
    expect(plantId).toMatch(/^ap-/);

    // Simulate the backend's normalizeAddedEntityDistances (T12) augmenting
    // the persisted `inputs` with an estimated plant->warehouse distance for
    // the newly-created plant — the shape a REAL server response carries.
    const serverResponse = {
      ...scenario,
      inputs: {
        ...sentInputs,
        distanceOverrides: [
          { leg: "plant_to_warehouse", fromId: plantId, toId: "wh-11", distance: 542.17, estimated: true },
        ],
      },
    };
    await act(async () => {
      saveOpts.onSuccess(serverResponse);
      // Flush the fire-and-forget `reportPendingPrecheckWatches` promise
      // chain (invalidateQueries -> fetchQuery, both mocked) so its
      // microtasks resolve inside this act() block rather than leaking
      // into the next test.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Save reconciliation: localInputs/savedInputsRef now both equal the
    // server's response — the scenario must NOT still read as dirty.
    expect(screen.getByTestId("button-save")).toBeDisabled();
    expect(screen.queryByTestId("text-unsaved-changes")).not.toBeInTheDocument();

    // And the estimated row must actually be visible on the Distances tab —
    // proving the augmented distanceOverrides was adopted into the live
    // draft, not silently discarded/overwritten on the next render.
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId(`badge-jadedistance-estimated-plant_to_warehouse-${plantId}-wh-11`)).toBeInTheDocument();
  });
});
