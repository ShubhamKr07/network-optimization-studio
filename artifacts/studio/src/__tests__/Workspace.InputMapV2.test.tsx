import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// T8 (Input Map v2) — Workspace-level integration: mode dispatch (p-median-us
// gets the real map, transport-coal/two-echelon-gold-au keep the Task-4
// legacy pin map, p-median-brazil gets the placeholder) and the Save
// reconciliation/estimate-toast flow (Step 4 of the brief). Mirrors
// Workspace.test.tsx's own mocking convention exactly (mock at the
// generated-hooks level) — kept as a separate file rather than appended to
// that already-large one, matching this repo's established per-concern
// Workspace.*.test.tsx split (Workspace.Brazil/TransportCoal/TwoEchelon/
// OutputMap/StaleOutputs/TabCoverage.test.tsx).

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: mockToast }));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-3", mockNavigate],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn(), fetchQuery: vi.fn() };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

const pmedianInputs = {
  p: 3,
  distanceBands: [200, 400, 800, 1600],
  capacityMode: "none" as const,
  uniformCapacity: null,
  warehouseOverrides: [],
  customerOverrides: [],
  addedWarehouses: [] as { id: string; city: string; state: string; lat: number; lng: number; capacity: number | null; status: string; displayCode?: string }[],
  addedCustomers: [] as unknown[],
  distanceOverrides: [] as { fromId: string; toId: string; distance: number; estimated?: boolean }[],
  gap: 0,
  timeLimitSec: 120,
};

const scenario = {
  id: 1,
  name: "3 Warehouses",
  modelId: "p-median-us",
  inputs: pmedianInputs,
  result: null,
  stale: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const dataset = {
  warehouses: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }],
  customers: [{ id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 }],
};

const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockSolveScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCreateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCloneScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockDeleteScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockLogoutUser = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(() => ({ data: [scenario] })),
  useGetScenario: vi.fn(() => ({ data: scenario })),
  useGetDataset: vi.fn(() => ({ data: dataset })),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useCloneScenario: vi.fn(() => mockCloneScenario),
  useDeleteScenario: vi.fn(() => mockDeleteScenario),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  useListModels: vi.fn(() => ({
    data: [
      {
        id: "p-median-us",
        countryBounds: { sw: [24, -125], ne: [50, -66] },
        capabilities: { supportsP: true, capacityModes: ["none", "uniform", "per_wh"], demandEditable: true, outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"] },
      },
    ],
  })),
  usePrecheckScenario: vi.fn(() => ({ data: { ok: true, errors: [] } })),
  precheckScenario: vi.fn(() => Promise.resolve({ ok: true, errors: [] })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  getPrecheckScenarioQueryKey: vi.fn((id: number) => ["precheck", id]),
  useLogoutUser: vi.fn(() => mockLogoutUser),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
  getGetDatasetQueryKey: vi.fn(() => ["dataset"]),
}));

import { Workspace } from "@/pages/Workspace";

function renderWorkspace() {
  return render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockUpdateScenario.isPending = false;
});

describe("Workspace — Input Map v2 mode dispatch (T8)", () => {
  it("p-median-us gets the real pmedian map surface (toolbar + legend), not the legacy placement toggle", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    expect(screen.getByTestId("pmedian-map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("input-map-placement-toggle")).not.toBeInTheDocument();
  });

  it("shows the manual-Save toolbar on the Input Map tab for p-median-us", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    expect(screen.getByTestId("button-save")).toBeInTheDocument();
    expect(screen.getByTestId("button-save")).toBeDisabled();
  });
});

describe("Workspace — Input Map v2 Save reconciliation + estimate toast (T8)", () => {
  it("creating a warehouse via the map, then Saving, adopts the RESPONSE inputs (isDirty clears) and toasts the count of newly-estimated distances for that entity", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));

    // Right-click empty map -> Add warehouse here -> submit the create dialog.
    const mapEl = document.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));
    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    expect(screen.getByTestId("button-save")).toBeEnabled();
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [saveArgs, saveOpts] = mockUpdateScenario.mutate.mock.calls[0];
    const sentAddedWarehouses = (saveArgs.data.inputs as typeof pmedianInputs).addedWarehouses;
    expect(sentAddedWarehouses).toHaveLength(1);
    const newId = sentAddedWarehouses[0].id;
    const newDisplayCode = sentAddedWarehouses[0].displayCode ?? newId;
    expect(newId).toMatch(/^aw-/);

    // Simulate the server response: T1's normalizer filled in 2 estimated
    // distances for the new warehouse (to the one known customer + itself
    // is never a distance, so just one in this fixture's tiny dataset —
    // kept at 1 to make the toast's singular/plural wording assertion exact).
    const updatedScenario = {
      ...scenario,
      inputs: {
        ...pmedianInputs,
        addedWarehouses: sentAddedWarehouses,
        distanceOverrides: [{ fromId: newId, toId: "C1", distance: 321.5, estimated: true }],
      },
    };
    act(() => {
      saveOpts.onSuccess(updatedScenario);
    });

    // Adopts the response inputs — Save toolbar goes back to "nothing to save".
    expect(screen.getByTestId("button-save")).toBeDisabled();
    expect(screen.queryByTestId("text-unsaved-changes")).not.toBeInTheDocument();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: `1 distance estimated for ${newDisplayCode} — review.` }),
    );
  });

  it("Saving with no map create/move in flight does not toast an estimate message", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    fireEvent.click(screen.getByTestId("toggle-layer-show-inactive")); // a UI-only toggle, not an inputs edit — Save stays disabled
    expect(screen.getByTestId("button-save")).toBeDisabled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  // T10 — bridges this file's own "adopts the RESPONSE inputs" assertion
  // (checked above only via button-save's disabled state + the toast) with
  // DistancesTab's own already-tested "Estimated chip" rendering
  // (DistancesTab.test.tsx) — neither file alone proves the two actually
  // compose: that the exact distanceOverrides row Save's onSuccess adopts is
  // what DistancesTab (Workspace.tsx's real prop wiring, not a hand-built
  // fixture) goes on to render with the chip.
  it("after Save adopts an estimated-distance response, switching to the Distances tab shows the Estimated chip on that row", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));

    const mapEl = document.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));
    fireEvent.click(screen.getByTestId("create-entity-submit"));
    fireEvent.click(screen.getByTestId("button-save"));

    const [saveArgs, saveOpts] = mockUpdateScenario.mutate.mock.calls[0];
    const sentAddedWarehouses = (saveArgs.data.inputs as typeof pmedianInputs).addedWarehouses;
    const newId = sentAddedWarehouses[0].id;

    const updatedScenario = {
      ...scenario,
      inputs: {
        ...pmedianInputs,
        addedWarehouses: sentAddedWarehouses,
        distanceOverrides: [{ fromId: newId, toId: "C1", distance: 321.5, estimated: true }],
      },
    };
    act(() => {
      saveOpts.onSuccess(updatedScenario);
    });

    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId("distances-tab")).toBeInTheDocument();
    expect(screen.getByTestId(`badge-distance-estimated-${newId}-C1`)).toBeInTheDocument();
    // Not flagged "changed" — the saved baseline (savedInputsRef) was synced
    // to the same response, so this row isn't a pending unsaved edit.
    expect(screen.queryByTestId(`badge-distance-changed-${newId}-C1`)).not.toBeInTheDocument();
  });
});
