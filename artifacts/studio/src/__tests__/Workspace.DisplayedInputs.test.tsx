import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

// T7 QA backfill — same stub-and-spy convention as OutputMapTab above, used
// by the two T6/R7 tests at the bottom of this file to reach Workspace.tsx's
// real `handleAddedArrayChange` glue (the production code path an unsaved
// added-warehouse coordinate edit actually goes through) without needing to
// simulate a real Leaflet drag gesture in jsdom.
const warehousesTabSpy = vi.fn();
vi.mock("@/components/workspace/tabs/WarehousesTab", () => ({
  WarehousesTab: (props: unknown) => {
    warehousesTabSpy(props);
    return <div data-testid="warehouses-tab-stub" />;
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
  // Bundle 6 T2 fix — Input Map now auto-opens on mount (one-shot seed), so
  // PMedianInputMap renders unconditionally and calls
  // useSupportsAddedCustomerExclusion, which unconditionally reads
  // `.capabilities` off this mock; a bare id/countryBounds/distanceUnit
  // entry (never exercised before, since Input Map was never rendered by
  // default) crashes.
  useListModels: vi.fn(() => ({
    data: [
      {
        id: "p-median-us",
        countryBounds: { sw: [24, -125], ne: [50, -66] },
        distanceUnit: "mi",
        capabilities: {
          supportsP: true,
          capacityModes: ["none", "uniform", "per_wh"],
          demandEditable: true,
          outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
          supportsFacilityStatus: true,
          supportsReferenceDistances: true,
          supportsAddedCustomerExclusion: true,
        },
      },
    ],
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

// T6/R7 backfill (T7 QA) — the other real OUTPUT surface `displayedInputs`
// covers besides bands: added-warehouse/added-customer GEOMETRY. Workspace.tsx
// passes `addedWarehousesFromInputs(displayedInputs)`/
// `addedCustomersFromInputs(displayedInputs)` into OutputMapTab's props (see
// that call site's own comment) — never `localInputs`, the editable draft.
// These two tests prove that wiring directly, mirroring the bands tests
// above's stub-and-spy convention rather than asserting on real Leaflet DOM
// (Workspace.OutputMap.test.tsx already proves the real map renders real
// geometry; this file only needs to prove WHICH snapshot's geometry reaches
// OutputMapTab's props).
describe("Workspace — Output Map added-entity geometry reads displayedInputs, not the draft (T6/R7)", () => {
  it("an unsaved coordinate edit of an added warehouse does NOT move the Output Map's rendered geometry — it still reflects the displayed solve's own snapshot", () => {
    const addedWarehouse = { id: "WH-ADD", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, status: "active" as const };
    const scenarioWithAdded = {
      ...scenario,
      inputs: { ...pmedianInputs, addedWarehouses: [addedWarehouse] },
    };
    mockUseGetScenario.mockReturnValue({ data: scenarioWithAdded } as unknown as ReturnType<typeof useGetScenario>);

    renderWorkspace();

    // Confirm the Output Map starts out showing the solve-time coordinates.
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(outputMapTabSpy).toHaveBeenCalledWith(
      expect.objectContaining({ addedWarehouses: [expect.objectContaining({ id: "WH-ADD", lat: 39.74, lng: -104.99 })] }),
    );

    // Draft-edit the added warehouse's coordinates through the real
    // Workspace.tsx wiring (handleAddedArrayChange, the same glue a real
    // drag-and-confirm move would call) WITHOUT saving or re-solving —
    // simulates exactly the "unsaved coordinate edit" this test is for.
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    const lastWarehousesTabProps = warehousesTabSpy.mock.calls.at(-1)?.[0] as {
      onAddedWarehousesChange: (next: unknown[]) => void;
    };
    act(() => lastWarehousesTabProps.onAddedWarehousesChange([{ ...addedWarehouse, lat: 10, lng: 10 }]));

    outputMapTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    // Output Map still shows the ORIGINAL solve-time coordinates, not the
    // unsaved draft edit.
    expect(outputMapTabSpy).toHaveBeenCalledWith(
      expect.objectContaining({ addedWarehouses: [expect.objectContaining({ id: "WH-ADD", lat: 39.74, lng: -104.99 })] }),
    );
  });

  it("stepping the result-history stepper back renders that OLDER entry's own added-entity geometry, not the latest solve's", () => {
    const addedWarehouseOld = { id: "WH-ADD", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, status: "active" as const };
    const addedWarehouseNew = { id: "WH-ADD", city: "Reno", state: "NV", lat: 39.53, lng: -119.81, status: "active" as const };

    const scenarioOld = {
      ...scenario,
      inputs: { ...pmedianInputs, addedWarehouses: [addedWarehouseOld] },
      // A distinct object reference from the shared `solvedResult` fixture —
      // resultHistoryState's seeding/append effect compares result objects
      // by reference (see Workspace.tsx's own comment on why).
      result: { ...solvedResult },
    };
    mockUseGetScenario.mockReturnValue({ data: scenarioOld } as unknown as ReturnType<typeof useGetScenario>);

    const { rerender } = renderWorkspace();

    const scenarioNew = {
      ...scenario,
      inputs: { ...pmedianInputs, addedWarehouses: [addedWarehouseNew] },
      result: { ...solvedResult, objective: 99999 },
    };
    mockUseGetScenario.mockReturnValue({ data: scenarioNew } as unknown as ReturnType<typeof useGetScenario>);
    rerender(<Workspace modelId="p-median-us" userEmail="student@example.com" />);

    // A fresh solve landed on the SAME scenario (same id, new result
    // reference) — the history effect appends rather than reseeding, so the
    // stepper now has 2 entries and defaults to the newest (index 1).
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(outputMapTabSpy).toHaveBeenCalledWith(
      expect.objectContaining({ addedWarehouses: [expect.objectContaining({ id: "WH-ADD", lat: 39.53, lng: -119.81 })] }),
    );

    outputMapTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("button-result-back"));

    // Stepped back to the OLDER entry — Output Map renders THAT entry's own
    // snapshot geometry, not the latest solve's.
    expect(outputMapTabSpy).toHaveBeenCalledWith(
      expect.objectContaining({ addedWarehouses: [expect.objectContaining({ id: "WH-ADD", lat: 39.74, lng: -104.99 })] }),
    );
  });
});
