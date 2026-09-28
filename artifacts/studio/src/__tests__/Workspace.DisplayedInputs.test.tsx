import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, act, cleanup } from "@testing-library/react";
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
  // chen-bands-units, T14 - field-scoped distanceBands PATCH. Minimal mock;
  // only Workspace.test.tsx asserts on its call args (Save-bands routing).
  useUpdateDistanceBands: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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
      // ch4-2s-8 (R4) — the two-step-workflow test group below (the "R4 —
      // Chapter 4 outputs follow the step toggle" describe) needs a real
      // max-coverage-us manifest entry: its own canonical unit (km) for
      // CostSummaryTab's weighted-avg-distance formatting, and `costSummary`
      // in outputGrids so the sidebar entry/content gate both unlock.
      // Mirrors `solvers/max-coverage-us/manifest.json` verbatim.
      {
        id: "max-coverage-us",
        countryBounds: { sw: [25.78, -123.11], ne: [47.67, -71.02] },
        distanceUnit: "km",
        capabilities: {
          supportsP: true,
          capacityModes: ["none"],
          demandEditable: true,
          outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
          supportsFacilityStatus: true,
          supportsAddedCustomerExclusion: true,
          supportsReferenceDistances: true,
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
  // ch4-2s-8 — default stub: undefined/not-loading/not-errored. Every
  // non-Chapter-4 test in this file never has `scenario.steps` set, so
  // `stepState.isMaxCoverage` is false and this hook's `enabled` is always
  // false here regardless of what it returns.
  useGetScenarioStepResult: vi.fn(() => ({ data: undefined, isLoading: false, isError: false, isSuccess: false, refetch: vi.fn() })),
  getGetScenarioStepResultQueryKey: vi.fn((scenarioId: number, step: number) => ["scenario-step-result", scenarioId, step]),
}));

import { Workspace } from "@/pages/Workspace";
import { useGetScenario, useGetSolveJob, useGetScenarioStepResult } from "@workspace/api-client-react";

const mockUseGetScenario = vi.mocked(useGetScenario);
const mockUseGetSolveJob = vi.mocked(useGetSolveJob);
const mockUseGetScenarioStepResult = vi.mocked(useGetScenarioStepResult);

function renderWorkspace() {
  return render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
}

// ch4-2s-8 (R4) — this file's existing render-helper convention (a plain
// function wrapping `render(<Workspace .../>)`), extended with two named
// variants rather than a parallel scaffold: `renderWorkspaceForPMedian` is
// the existing `renderWorkspace` under the name the R4 tests below use
// (accepts/ignores an options bag for call-site symmetry with the Chapter 4
// variant); `renderWorkspaceForMaxCoverage` swaps in a max-coverage-us
// scenario carrying a real `steps` projection (Task 5's server-derived
// field) and wires `useGetScenarioStepResult`'s mock to answer per the
// `step` argument it's actually called with — proving Workspace.tsx's own
// per-step fetch, not a canned response.
function renderWorkspaceForPMedian(_opts?: { withHistory?: boolean }) {
  // Explicit reset (not just relying on `beforeEach`) — this helper is also
  // used AFTER `renderWorkspaceForMaxCoverage` within the same test (the
  // "hides for Chapter 4, keeps for p-median-us" comparison below), whose
  // own `mockUseGetScenario.mockReturnValue` would otherwise still be in
  // effect for a later render in that same test.
  mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
  return renderWorkspace();
}

function renderWorkspaceForMaxCoverage(opts: {
  steps: {
    step1: { solved: boolean; stale: boolean; jobId: number | null; summary: typeof step1Summary | null };
    step2: { solved: boolean; stale: boolean; jobId: number | null; summary: typeof step2Summary | null };
  };
  stepResults?: Partial<Record<1 | 2, typeof step1Envelope>>;
}) {
  const scenarioForSteps = {
    id: 1,
    name: "Chen Cosmetics",
    modelId: "max-coverage-us",
    inputs: maxCoverageInputs,
    // `.result` mirrors real server behaviour (whichever step solved last) —
    // Chapter 4's own output surfaces must NOT read this (R4's whole point);
    // it's set here only so any code that happens to touch it (e.g. the
    // dead CostSummaryTab-compare mode-guard fallback) sees a plausible
    // value rather than `null`.
    result: opts.steps.step2.solved ? step2Envelope : opts.steps.step1.solved ? step1Envelope : null,
    stale: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    steps: opts.steps,
  };
  mockUseGetScenario.mockReturnValue({ data: scenarioForSteps } as unknown as ReturnType<typeof useGetScenario>);
  const stepResults = opts.stepResults ?? {};
  mockUseGetScenarioStepResult.mockImplementation((_scenarioId: unknown, step: unknown) => {
    const result = stepResults[step as 1 | 2];
    return {
      data: result ? { result } : undefined,
      isLoading: false,
      isError: false,
      isSuccess: !!result,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useGetScenarioStepResult>;
  });
  return render(<Workspace modelId="max-coverage-us" userEmail="student@example.com" />);
}

const maxCoverageInputs = {
  p: 3,
  highServiceDistKm: 700,
  maxDistKm: 5500,
  avgServiceDistCapKm: 1000,
  distanceBands: [700, 1400, 2800, 5500],
  gap: 0,
  timeLimitSec: 120,
  step2: { gap: 0, timeLimitSec: 120 },
  stepEpoch: 1,
};

// Frozen goldens (SCN v0.3 Global Constraints) — two DISTINCT weighted-avg
// values so a wrong-step render is unambiguous.
const step1Summary = {
  objective: "coverage" as const,
  status: "optimal",
  solutionStatus: "optimal",
  quality: "Proven Optimal",
  coveragePct: 68.4192,
  coveredDemand: 53385024,
  weightedAvgDistance: 635.13,
  distanceUnit: "km",
  runTimeSec: 1.5,
};
const step2Summary = {
  ...step1Summary,
  objective: "min_distance" as const,
  weightedAvgDistance: 624.33,
  runTimeSec: 2.1,
};

const step1Envelope = {
  status: "optimal" as const,
  objective: 68.4192,
  runTimeSec: 1.5,
  quality: "Proven Optimal",
  edges: [{ fromId: "DAL", toId: "C1", flow: 100, distance: 500 }],
  metrics: { weightedAvgDistance: 635.13, bandCoverage: [], utilizationByNode: [] },
  details: { objective: "coverage", openWarehouseIds: ["DAL", "LA", "PIT"], assignments: [] },
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};
const step2Envelope = {
  ...step1Envelope,
  objective: 48714263031.75,
  runTimeSec: 2.1,
  metrics: { weightedAvgDistance: 624.33, bandCoverage: [], utilizationByNode: [] },
  details: { objective: "min_distance", openWarehouseIds: ["DAL", "LA", "PIT"], assignments: [] },
};

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

  // jade-INT (#1, spec §2 R5-1/§22) — T4's "displayedInputs, never the
  // draft" rule is explicitly OVERRIDDEN for the band color/label lens:
  // requirement #1 demands a band edit recolor the Output Map immediately,
  // with zero network calls, and without invalidating the on-screen solve.
  // These two tests replace the pre-INT ones that asserted the OLD
  // (now-superseded) "does NOT change" behavior.
  it("editing DRAFT distance bands in Optimization Parameters DOES immediately recolor the Output Map, with zero network calls", () => {
    renderWorkspace();

    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-remove-band-1600"));

    outputMapTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(outputMapTabSpy).toHaveBeenCalledWith(expect.objectContaining({ bands: [200, 400, 800] }));
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
    expect(mockSolveScenario.mutate).not.toHaveBeenCalled();
  });

  it("editing DRAFT distance bands via the Solve dialog also DOES immediately recolor the Output Map, with zero network calls", () => {
    renderWorkspace();

    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-button-remove-band-1600"));
    fireEvent.click(screen.getByTestId("solve-dialog-cancel"));

    outputMapTabSpy.mockClear();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(outputMapTabSpy).toHaveBeenCalledWith(expect.objectContaining({ bands: [200, 400, 800] }));
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
    expect(mockSolveScenario.mutate).not.toHaveBeenCalled();
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

// ch4-2s-8 (R4) — Workspace.tsx has 44 references to `displayedResult`/
// `displayedInputs` plus `hasFreshSolvedRun`, ALL describing the SCENARIO's
// latest solve, never Chapter 4's step toggle. These two tests prove the
// `activeOutputResult`/`activeOutputInputs`/`activeOutputReady` adapter
// actually closes that gap end-to-end (through a real output tab, Solution
// Summary — CostSummaryTab is stubbed nowhere in this file, so this is the
// genuine component reading the genuine prop), and that the result-history
// stepper — which would otherwise be a SECOND, conflicting result selector —
// is hidden for Chapter 4 while staying exactly as before for every other
// model.
describe("R4 — Chapter 4 outputs follow the step toggle", () => {
  it("renders Step 1's result on step 1 and Step 2's on step 2, from the same scenario", async () => {
    // Two distinct envelopes so a wrong-step render is unambiguous:
    // deviation from this task's illustrative snippet — the real
    // `CostSummaryTab` formats weighted-avg-distance to ONE decimal
    // (`formatDistance`'s own `.toFixed(1)`) under testid
    // `cost-summary-value-weighted-avg-distance` (the label-derived id;
    // `cost-summary-value-wavg` does not exist), not the two-decimal
    // `cost-summary-value-wavg`/"635.13" the task prompt's snippet named —
    // asserting on the real rendered contract instead.
    renderWorkspaceForMaxCoverage({
      steps: {
        step1: { solved: true, stale: false, jobId: 11, summary: step1Summary },
        step2: { solved: true, stale: false, jobId: 12, summary: step2Summary },
      },
      stepResults: { 1: step1Envelope, 2: step2Envelope },
    });

    await screen.findByTestId("sidebar-output-cost-summary");
    fireEvent.click(screen.getByTestId("sidebar-output-cost-summary"));
    expect(await screen.findByTestId("cost-summary-value-weighted-avg-distance")).toHaveTextContent("635.1 km");

    fireEvent.click(screen.getByTestId("step-toggle-2"));
    expect(await screen.findByTestId("cost-summary-value-weighted-avg-distance")).toHaveTextContent("624.3 km");
  });

  it("hides the result-history stepper for Chapter 4 but keeps it for p-median-us", async () => {
    const bothSolvedSteps = {
      step1: { solved: true, stale: false, jobId: 11, summary: step1Summary },
      step2: { solved: true, stale: false, jobId: 12, summary: step2Summary },
    };
    renderWorkspaceForMaxCoverage({ steps: bothSolvedSteps, stepResults: { 1: step1Envelope, 2: step2Envelope } });
    await screen.findByTestId("step-toggle");
    expect(screen.queryByTestId("button-result-back")).not.toBeInTheDocument();
    expect(screen.queryByTestId("text-result-history-position")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-save-as-scenario")).not.toBeInTheDocument();

    cleanup();
    renderWorkspaceForPMedian({ withHistory: true });
    expect(await screen.findByTestId("button-result-back")).toBeInTheDocument();
  });
});
