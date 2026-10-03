import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { UnitProvider } from "@/contexts/UnitContext";

// ch5-edit-5 (Chapter 5, §14) — delivery-teaching-us gains two new editable
// input tabs (Warehouses, Customers) alongside its existing three (Input
// Map, Delivery Costs, Optimization Parameters). This file is the TDD
// coverage for Task 5: the sidebar entry list, the "no added-entity
// section" rule (§14.5 — supportsAddedCustomerExclusion stays false,
// capacityModes stays []), and — the part a render-only test would miss —
// that an edit on either new tab actually reaches useUpdateScenario via the
// shared Save button, not just that the tab mounts.
//
// Mocking convention mirrors Workspace.TabCoverage.test.tsx exactly (mock
// @workspace/api-client-react at the generated-hooks level, mock
// wouter/@tanstack/react-query the same way) rather than inventing a new one.

const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(ui, { wrapper: UnitProvider, ...options });

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-5", mockNavigate],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn(), removeQueries: vi.fn() };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

vi.mock("react-leaflet", async () => {
  const actual = await vi.importActual<typeof import("react-leaflet")>("react-leaflet");
  return {
    ...actual,
    // SBR-3 — InvalidateOnResize observes the map's container and calls
    // invalidateSize; a two-method stub makes it throw from inside an effect.
    useMap: () => ({
      setView: vi.fn(),
      fitBounds: vi.fn(),
      getContainer: () => document.createElement("div"),
      invalidateSize: vi.fn(),
    }),
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
  useUpdateDistanceBands: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useCloneScenario: vi.fn(() => mockCloneScenario),
  useDeleteScenario: vi.fn(() => mockDeleteScenario),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  useGetReferenceDistances: vi.fn(() => ({ data: undefined })),
  getGetReferenceDistancesQueryKey: vi.fn((id: string) => ["reference-distances", id]),
  useGetReferenceCosts: vi.fn(() => ({ data: undefined })),
  getGetReferenceCostsQueryKey: vi.fn((id: string) => ["reference-costs", id]),
  useListModels: vi.fn(),
  usePrecheckScenario: vi.fn(() => ({ data: { ok: true, errors: [] } })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  useLogoutUser: vi.fn(() => mockLogoutUser),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
  getGetDatasetQueryKey: vi.fn(() => ["dataset"]),
  getPrecheckScenarioQueryKey: vi.fn((id: number) => ["precheck", id]),
  useGetScenarioStepResult: vi.fn(() => ({ data: undefined, isLoading: false, isError: false, isSuccess: false, refetch: vi.fn() })),
  getGetScenarioStepResultQueryKey: vi.fn((scenarioId: number, step: number) => ["scenario-step-result", scenarioId, step]),
}));

import { Workspace, inputEntriesForModel } from "@/pages/Workspace";
import { useGetScenario, useListScenarios, useGetDataset, useListModels } from "@workspace/api-client-react";

const mockUseGetScenario = vi.mocked(useGetScenario);
const mockUseListScenarios = vi.mocked(useListScenarios);
const mockUseGetDataset = vi.mocked(useGetDataset);
const mockUseListModels = vi.mocked(useListModels);

// Real capabilities, copied verbatim from solvers/delivery-teaching-us/manifest.json
// (confirmed by reading it directly, not guessed): demandEditable and
// supportsFacilityStatus are both true post-§14; capacityModes stays [] and
// supportsAddedCustomerExclusion stays false.
const deliveryCapabilities = {
  supportsP: true,
  capacityModes: [] as string[],
  demandEditable: true,
  outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
  supportsFacilityStatus: true,
  supportsReferenceDistances: false,
  supportsReferenceCosts: true,
  supportsAddedCustomerExclusion: false,
};

const deliveryInputs = {
  p: 3,
  distanceBands: [400, 800, 1200, 1600],
  gap: 0,
  timeLimitSec: 120,
  costAdjustEnabled: false,
  distanceThreshold: 800,
  costPerMile: 1,
  costPerMileOver: 10,
  laneCostOverrides: [],
  warehouseOverrides: [],
  customerOverrides: [],
};

const deliveryScenario = {
  id: 50,
  name: "Delivery base case",
  modelId: "delivery-teaching-us",
  inputs: deliveryInputs,
  result: null,
  stale: false,
  createdAt: "2026-01-05T00:00:00Z",
  updatedAt: "2026-01-05T00:00:00Z",
};

const deliveryDataset = {
  warehouses: [{ id: "W1", city: "Springfield", state: "IL", lat: 39.78, lng: -89.64 }],
  customers: [{ id: "C1", city: "Chicago", state: "IL", lat: 41.88, lng: -87.63, demand: 100 }],
};

function renderDeliveryWorkspace() {
  return render(<Workspace modelId="delivery-teaching-us" userEmail="student@example.com" />);
}

/**
 * Renders the workspace and clicks into the given sidebar input entry.
 * Unmounts any prior render from this same test first — several tests below
 * call this twice (once per tab) within one `it`, and RTL doesn't
 * auto-cleanup between calls within a single test, only between tests.
 */
let activeUnmount: (() => void) | null = null;
function renderDeliveryWorkspaceTab(entity: "warehouses" | "customers") {
  activeUnmount?.();
  const { unmount } = renderDeliveryWorkspace();
  activeUnmount = unmount;
  fireEvent.click(screen.getByTestId(`sidebar-input-${entity}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockSolveScenario.mutate.mockReset();
  mockCreateScenario.mutate.mockReset();
  mockCloneScenario.mutate.mockReset();
  mockDeleteScenario.mutate.mockReset();
  mockLogoutUser.mutate.mockReset();
  mockUseListScenarios.mockReturnValue({ data: [deliveryScenario] } as unknown as ReturnType<typeof useListScenarios>);
  mockUseGetScenario.mockReturnValue({ data: deliveryScenario } as unknown as ReturnType<typeof useGetScenario>);
  mockUseGetDataset.mockReturnValue({ data: deliveryDataset } as unknown as ReturnType<typeof useGetDataset>);
  mockUseListModels.mockReturnValue({
    data: [
      {
        id: "delivery-teaching-us",
        distanceUnit: "mi",
        countryBounds: { sw: [24, -125], ne: [50, -66] },
        capabilities: deliveryCapabilities,
      },
    ],
  } as unknown as ReturnType<typeof useListModels>);
});

describe("delivery-teaching-us — five input tabs (section 14.5)", () => {
  it("offers Input Map, Warehouses, Customers, Delivery Costs, Optimization Parameters", () => {
    expect(inputEntriesForModel("delivery-teaching-us").map(e => e.id)).toEqual([
      "input-map",
      "warehouses",
      "customers",
      "deliveryCosts",
      "optimization-parameters",
    ]);
  });

  it("does not disturb the p-median default", () => {
    expect(inputEntriesForModel("p-median-us").map(e => e.id)).toEqual([
      "input-map",
      "customers",
      "warehouses",
      "distances",
      "optimization-parameters",
    ]);
  });

  it("renders neither tab's added-entity section — no onAdded* callback is wired for this model", () => {
    renderDeliveryWorkspaceTab("warehouses");
    expect(screen.queryByTestId("added-warehouses-section")).toBeNull();

    renderDeliveryWorkspaceTab("customers");
    expect(screen.queryByTestId("added-customers-section")).toBeNull();
  });

  it("shows no capacity column — this model has capacityModes: []", () => {
    renderDeliveryWorkspaceTab("warehouses");
    expect(screen.queryByText(/capacity/i)).toBeNull();
  });

  it("opening the Warehouses/Customers sidebar entries renders the real tables, not a placeholder", () => {
    renderDeliveryWorkspaceTab("warehouses");
    expect(screen.getByTestId("warehouses-tab")).toBeInTheDocument();
    expect(screen.getByText("W1")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();

    renderDeliveryWorkspaceTab("customers");
    expect(screen.getByTestId("customers-tab")).toBeInTheDocument();
    expect(screen.getByText("C1")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  // The gap a render-only test misses: proving the edit actually reaches
  // useUpdateScenario via the shared Save button (isEditableInputTab +
  // the onChange wiring), not just that the tab mounts and shows a widget.
  it("a warehouse status edit persists via the shared Save button", () => {
    renderDeliveryWorkspaceTab("warehouses");

    expect(screen.getByTestId("button-save")).toBeDisabled();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-wh-W1-forced_open"));
    expect(screen.getByTestId("button-save")).toBeEnabled();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 50,
      data: {
        inputs: expect.objectContaining({
          warehouseOverrides: [{ id: "W1", status: "forced_open", capacity: undefined }],
        }),
      },
    });
  });

  it("a customer demand edit persists via the shared Save button (demandEditable: true)", () => {
    renderDeliveryWorkspaceTab("customers");

    expect(screen.getByTestId("button-save")).toBeDisabled();
    fireEvent.change(screen.getByTestId("input-customer-demand-C1"), { target: { value: "250" } });
    expect(screen.getByTestId("button-save")).toBeEnabled();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 50,
      data: {
        inputs: expect.objectContaining({
          customerOverrides: [{ id: "C1", status: "active", demand: 250 }],
        }),
      },
    });
  });
});
