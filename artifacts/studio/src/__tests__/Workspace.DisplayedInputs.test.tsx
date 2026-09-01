import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// T4/R5 — `displayedInputs` is the inputs snapshot that PRODUCED the
// currently-displayed solve (mirrors `displayedResult`), never the editable
// `localInputs` draft. This file proves the Output Map's band source
// specifically (the one real OUTPUT surface T4 repoints — see Workspace.tsx's
// own comment on why warehouseStatuses/coords stay T6's job): editing draft
// bands (Optimization Parameters OR the Solve dialog) must not change what
// the already-displayed solved result's Output Map shows.
//
// OutputMapTab itself is stubbed out (a spy capturing its props) rather than
// asserting on real Leaflet DOM — Workspace.OutputMap.test.tsx already
// proves the real map renders; this file only needs to prove WHICH bands
// value reaches that component's props.

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-3", vi.fn()],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn() };
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

const solvedResult = {
  status: "optimal" as const,
  objective: 12345,
  runTimeSec: 0.5,
  quality: "Optimal",
  edges: [{ fromId: "CHI", toId: "C1", flow: 100, distance: 900 }],
  metrics: { weightedAvgDistance: 900, bandCoverage: [], utilizationByNode: [] },
  details: { openWarehouseIds: ["CHI"], assignments: [] },
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};

const scenario = {
  id: 1,
  name: "3 Warehouses",
  modelId: "p-median-us",
  inputs: pmedianInputs,
  result: solvedResult,
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

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(() => ({ data: [scenario] })),
  useGetScenario: vi.fn(() => ({ data: scenario })),
  useGetDataset: vi.fn(() => ({ data: dataset })),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useCreateScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useCloneScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  useListModels: vi.fn(() => ({
    data: [{ id: "p-median-us", countryBounds: { sw: [24, -125], ne: [50, -66] }, distanceUnit: "mi" }],
  })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  useLogoutUser: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
  getGetDatasetQueryKey: vi.fn(() => ["dataset"]),
  usePrecheckScenario: vi.fn(() => ({ data: { ok: true, errors: [] } })),
  getPrecheckScenarioQueryKey: vi.fn((id: number) => ["precheck", id]),
}));

import { Workspace } from "@/pages/Workspace";
import { useGetScenario, useGetSolveJob } from "@workspace/api-client-react";

const mockUseGetScenario = vi.mocked(useGetScenario);
const mockUseGetSolveJob = vi.mocked(useGetSolveJob);

function renderWorkspace() {
  return render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks()` clears call history but not a previously-set
  // `mockReturnValue` — reset these defensively every test (same convention
  // Workspace.test.tsx's own beforeEach already uses) so a later test's
  // scenario-swap (used by the T6 history-stepper tests below) can't leak
  // into an unrelated earlier-ordered test.
  mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
  mockUseGetSolveJob.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGetSolveJob>);
  // Same reasoning — a leftover `mockImplementation` from an earlier test
  // (the T6 history-stepper tests below set one) must not leak forward.
  mockUpdateScenario.mutate.mockReset();
  mockSolveScenario.mutate.mockReset();
});

describe("Workspace — displayedInputs snapshot (T4/R5)", () => {
  it("Output Map's band source is the solved scenario's own persisted distanceBands", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(outputMapTabSpy).toHaveBeenCalledWith(expect.objectContaining({ bands: [200, 400, 800, 1600] }));
  });

  it("editing DRAFT distance bands in Optimization Parameters does NOT change the Output Map's bands — it still reflects the displayed solve's own snapshot", () => {
    renderWorkspace();

    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-remove-band-1600"));

    outputMapTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(outputMapTabSpy).toHaveBeenCalledWith(expect.objectContaining({ bands: [200, 400, 800, 1600] }));
  });

  it("editing DRAFT distance bands via the Solve dialog also does NOT recolor the currently-displayed Output Map", () => {
    renderWorkspace();

    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-button-remove-band-1600"));
    fireEvent.click(screen.getByTestId("solve-dialog-cancel"));

    outputMapTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(outputMapTabSpy).toHaveBeenCalledWith(expect.objectContaining({ bands: [200, 400, 800, 1600] }));
  });
});
