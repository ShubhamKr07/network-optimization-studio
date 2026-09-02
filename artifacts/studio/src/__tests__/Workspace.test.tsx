import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mock toast ────────────────────────────────────────────────────────────────
const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: mockToast }));

// ── Mock wouter ───────────────────────────────────────────────────────────────
// `mockNavigate` is a single persistent fn (not a fresh vi.fn() per call) so
// tests can assert on call order/arguments — needed for the
// cache-write-before-navigate regression tests below.
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-3", mockNavigate],
}));

// ── Mock React Query ──────────────────────────────────────────────────────────
const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn() };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────
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

const scenario2 = {
  id: 2,
  name: "Alt scenario",
  modelId: "p-median-us",
  inputs: pmedianInputs,
  result: null,
  stale: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ── Mock the generated API client hooks (mock at the generated-hooks level,
// per this repo's established convention — see Studio.test.tsx) ─────────────
const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockSolveScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCreateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCloneScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockDeleteScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
// Task 10 — logout mutation, mocked the same way as every other generated
// mutation hook in this file (mock at the generated-hooks level).
const mockLogoutUser = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(() => ({ data: [scenario, scenario2] })),
  useGetScenario: vi.fn(() => ({ data: scenario })),
  useGetDataset: vi.fn(() => ({ data: dataset })),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useCloneScenario: vi.fn(() => mockCloneScenario),
  useDeleteScenario: vi.fn(() => mockDeleteScenario),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  // T9 (B2.2-T7 mock gap) — DistancesTab now calls useGetReferenceDistances
  // unconditionally (Rules of Hooks); every test file that can render it
  // (any test opening the Distances tab) needs this mock, even though most
  // scenarios here have referenceCapable disabled and never actually fire it.
  useGetReferenceDistances: vi.fn(() => ({ data: undefined })),
  getGetReferenceDistancesQueryKey: vi.fn((id: string) => ["reference-distances", id]),
  // C6.1, Task 4 — capabilities.outputGrids is now read by Workspace.tsx's
  // output-grid gating (activeModelManifest?.capabilities.outputGrids), so
  // every model this test file exercises needs a real capabilities object,
  // not just id/countryBounds. Values copied verbatim from each model's real
  // manifest.json (Task 1), not guessed.
  useListModels: vi.fn(() => ({
    data: [
      {
        id: "p-median-us",
        countryBounds: { sw: [24, -125], ne: [50, -66] },
        capabilities: {
          supportsP: true,
          capacityModes: ["none", "uniform", "per_wh"],
          demandEditable: true,
          outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
          // T9 (B2.2-T7 wiring) — matches solvers/p-median-us/manifest.json's
          // real capability exactly (the only model with this true).
          supportsReferenceDistances: true,
        },
      },
      {
        id: "p-median-brazil",
        countryBounds: { sw: [-30.04, -67.82], ne: [0.04, -34.86] },
        capabilities: {
          supportsP: true,
          capacityModes: ["uniform"],
          demandEditable: false,
          outputGrids: ["openWarehouses", "assignments", "costSummary", "serviceStats"],
        },
      },
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
  })),
  // B5.2 — precheck query. Defaults to ok:true/no errors so every existing
  // test in this file (none of which care about precheck chips) is
  // unaffected; the dedicated "Workspace — precheck (B5.2)" describe block
  // below overrides this per-test.
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
import { useGetSolveJob, useListScenarios, usePrecheckScenario, useGetScenario } from "@workspace/api-client-react";

const mockUseGetSolveJob = vi.mocked(useGetSolveJob);
const mockUseListScenarios = vi.mocked(useListScenarios);
const mockUsePrecheckScenario = vi.mocked(usePrecheckScenario);
const mockUseGetScenario = vi.mocked(useGetScenario);

function renderWorkspace() {
  return render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // `vi.clearAllMocks()` clears call history but NOT a previously-set
  // `mockImplementation` (see the existing "mockReset() guards against a
  // leftover mockImplementation" note on the Solve-dialog tests below) — a
  // mutate mock's onSuccess/onError implementation set by one test can leak
  // into a later test that never calls onError/onSuccess, causing an
  // unrelated later test (e.g. rename's) to crash if the leaked
  // implementation invokes a callback the later call site never passed.
  // Full `mockReset()` on every mutate fn, every test, closes that off file-wide.
  mockUpdateScenario.mutate.mockReset();
  mockSolveScenario.mutate.mockReset();
  mockCreateScenario.mutate.mockReset();
  mockCloneScenario.mutate.mockReset();
  mockDeleteScenario.mutate.mockReset();
  mockLogoutUser.mutate.mockReset();
  mockUpdateScenario.isPending = false;
  mockSolveScenario.isPending = false;
  mockCreateScenario.isPending = false;
  mockCloneScenario.isPending = false;
  mockDeleteScenario.isPending = false;
  mockQueryClient.invalidateQueries.mockReset();
  mockQueryClient.setQueryData.mockReset();
  mockUseGetSolveJob.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGetSolveJob>);
  mockUseListScenarios.mockReturnValue({ data: [scenario, scenario2] } as unknown as ReturnType<typeof useListScenarios>);
  mockUsePrecheckScenario.mockReturnValue({ data: { ok: true, errors: [] } } as unknown as ReturnType<typeof usePrecheckScenario>);
  mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof useGetScenario>);
});

describe("Workspace — Warehouses tab", () => {
  it("opening the Warehouses sidebar entry renders the real WarehouseTable with the scenario's warehouse data, not a placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(screen.getByText("CHI")).toBeInTheDocument();
    expect(screen.getByText("Chicago")).toBeInTheDocument();
    expect(screen.getByText("IL")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("applies DD-6's label mapping in the Workspace tab", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(screen.getAllByText("Potential").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fixed-Open").length).toBeGreaterThan(0);
  });

  it("Save is disabled when nothing changed, and no mutation fires just from opening the tab", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(screen.getByTestId("button-save")).toBeDisabled();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
  });

  it("an edit does NOT save on its own — only an explicit Save click persists it via useUpdateScenario", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    fireEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));

    // Edited but not yet saved: Save is now enabled, but nothing was sent.
    expect(screen.getByTestId("button-save")).toBeEnabled();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: {
        inputs: expect.objectContaining({
          warehouseOverrides: [{ id: "CHI", status: "forced_open", capacity: undefined }],
        }),
      },
    });
  });

  it("shows an 'Unsaved changes' indicator only while dirty", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(screen.queryByTestId("text-unsaved-changes")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));
    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
  });

  it("applies the scn-theme class to the workspace root shell", () => {
    renderWorkspace();
    expect(screen.getByTestId("workspace-page")).toHaveClass("scn-theme");
  });
});

describe("Workspace — Customers tab", () => {
  it("opening the Customers sidebar entry renders the real CustomerTable with the scenario's customer data, not a placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    expect(screen.getByText("C1")).toBeInTheDocument();
    expect(screen.getByText("New York")).toBeInTheDocument();
    expect(screen.getByText("NY")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("an edit does NOT save on its own — only an explicit Save click persists it via useUpdateScenario", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    fireEvent.change(screen.getByTestId("input-customer-demand-C1"), { target: { value: "250" } });

    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: {
        inputs: expect.objectContaining({
          customerOverrides: [{ id: "C1", status: "active", demand: 250 }],
        }),
      },
    });
  });

  it("Save is disabled when nothing changed", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    expect(screen.getByTestId("button-save")).toBeDisabled();
  });
});

describe("Workspace — placeholder tabs", () => {
  // Every p-median-us input tab is now real content (Customers, Warehouses,
  // Distances, Optimization Parameters) — the standalone "Demand" entry that
  // used to be this test's placeholder example was removed as dead
  // scaffolding (real demand editing already lives inline in the
  // Customers/Stations tabs via CustomerOverride.demand/StationOverride.demand).
  // T5 (Bundle 2, Step 2b) — p-median-brazil's Warehouses/Customers/Distances
  // tabs are now ALSO real content, so this test's own example moved to
  // transport-coal's Input Map tab; T6 moved it on again to
  // two-echelon-gold-au's Input Map (the last "legacy" pin-drop model); T7
  // (Bundle 2) gave two-echelon-gold-au its own full-v2 editor too, closing
  // the last gap — every INPUT tab, on every model, now has a real Save
  // affordance somewhere. Retargeted to an OUTPUT tab instead: `isEditableInputTab`
  // is structurally scoped to `activeTab.kind === "input"` (Workspace.tsx),
  // so an output-kind tab is a permanent, always-true example of "no Save
  // toolbar" — not a moving target that the next model fast-follow would
  // obsolete again.
  it("does not show a Save toolbar for an output tab (isEditableInputTab is input-only)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(screen.queryByTestId("button-save")).not.toBeInTheDocument();
  });
});

describe("Workspace — output grid tabs (Phase C, Task 3)", () => {
  const solvedScenario = {
    ...scenario,
    result: {
      status: "optimal" as const,
      objective: 29873735731,
      runTimeSec: 0.45,
      quality: "Proven optimal",
      edges: [{ fromId: "CHI", toId: "C1", flow: 100, distance: 42.1, band: 0 }],
      metrics: { weightedAvgDistance: 42.1, utilizationByNode: [{ warehouseId: "CHI", city: "Chicago", utilization: 0.5 }] },
      details: {},
      solverUsed: "CBC",
      infeasibilityReason: null,
    },
    stale: false,
  };

  it("renders the Customer Assignments grid when its sidebar entry is opened on a solved p-median-us scenario", async () => {
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario, scenario2] } as unknown as ReturnType<typeof useListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-customer-assignments"));
    // "Customer Assignments" text alone is ambiguous (sidebar entry + tab
    // bar + AssignmentsTab's own header all render it) — assert on the
    // actual grid content instead, which only exists once the real
    // AssignmentsTab component (not a placeholder) is mounted.
    expect(await screen.findByTestId("assignment-row-C1")).toHaveTextContent("CHI");
  });

  // C6.1, Task 4 — capabilities.outputGrids-driven gating replaces the old
  // hardcoded modelId === "p-median-us" check.
  it("renders Open Warehouses for a solved two-echelon-gold-au scenario (previously blocked to p-median-us only)", async () => {
    const twoEchelonScenario = {
      ...solvedScenario,
      modelId: "two-echelon-gold-au",
      result: {
        ...solvedScenario.result,
        edges: [{ fromId: "daggar-hills", toId: "sydney", flow: 80, distance: 2381.79, leg: "refinery_to_customer" }],
      },
    };
    mockUseGetScenario.mockReturnValue({ data: twoEchelonScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [twoEchelonScenario] } as unknown as ReturnType<typeof useListScenarios>);
    render(<Workspace modelId="two-echelon-gold-au" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-output-open-warehouses"));
    expect(await screen.findByTestId("open-warehouse-row-daggar-hills")).toBeInTheDocument();
  });

  it("renders the Flows tab for a solved transport-coal scenario", async () => {
    const transportSolved = {
      ...solvedScenario,
      modelId: "transport-coal",
      result: {
        ...solvedScenario.result,
        edges: [{ fromId: "KY", toId: "CHI", flow: 500, distance: 300 }],
      },
    };
    mockUseGetScenario.mockReturnValue({ data: transportSolved } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [transportSolved] } as unknown as ReturnType<typeof useListScenarios>);
    render(<Workspace modelId="transport-coal" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-output-flows"));
    expect(await screen.findByTestId("flow-row-KY-CHI")).toBeInTheDocument();
  });

  // T9 (B2) — the sidebar entry itself is now gated by
  // capabilities.outputGrids (was: entry always present, content fell back
  // to a placeholder). Open Warehouses isn't in transport-coal's
  // outputGrids (["flows","costSummary","serviceStats"]), so its sidebar
  // entry no longer renders at all — replaces the old
  // "click it, see a placeholder" assertion.
  it("hides the sidebar entry entirely for a grid not in the model's outputGrids capability (Open Warehouses for transport-coal)", () => {
    const transportSolved = { ...solvedScenario, modelId: "transport-coal" };
    mockUseGetScenario.mockReturnValue({ data: transportSolved } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [transportSolved] } as unknown as ReturnType<typeof useListScenarios>);
    render(<Workspace modelId="transport-coal" userEmail="student@example.com" />);
    expect(screen.queryByTestId("sidebar-output-open-warehouses")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-output-customer-assignments")).not.toBeInTheDocument();
    // Its own real outputs stay present.
    expect(screen.getByTestId("sidebar-output-flows")).toBeInTheDocument();
  });

  // T9 (B2) — Flows is p-median-us's own missing capability (mirror of the
  // transport-coal case above).
  it("hides the Flows sidebar entry for p-median-us (not in its outputGrids capability)", () => {
    renderWorkspace();
    expect(screen.queryByTestId("sidebar-output-flows")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-output-open-warehouses")).toBeInTheDocument();
  });

  it("shows the Flows sidebar entry for a model whose outputGrids includes it (transport-coal)", () => {
    const transportSolved = { ...solvedScenario, modelId: "transport-coal" };
    mockUseGetScenario.mockReturnValue({ data: transportSolved } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [transportSolved] } as unknown as ReturnType<typeof useListScenarios>);
    render(<Workspace modelId="transport-coal" userEmail="student@example.com" />);
    expect(screen.getByTestId("sidebar-output-flows")).toBeInTheDocument();
  });

  // T9 (T6 wiring) — Open Warehouses/Customer Assignments now receive
  // `displayedInputs`, built from the SAVED snapshot (never `localInputs`).
  // `solvedScenario`'s own inputs default `capacityMode: "none"` (the
  // fixture's real p-median-us default), so the Utilization column must be
  // hidden end-to-end, not merely absent from a hand-built unit test.
  it("T9 (T6): the Utilization column is hidden end-to-end for the default fixture's capacityMode 'none'", async () => {
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario, scenario2] } as unknown as ReturnType<typeof useListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-open-warehouses"));
    await screen.findByTestId("open-warehouse-row-CHI");
    expect(screen.queryByText("Utilization")).not.toBeInTheDocument();
  });

  it("T9 (T6): the Utilization column shows once the displayed snapshot's capacityMode is not 'none'", async () => {
    const capacitated = { ...solvedScenario, inputs: { ...solvedScenario.inputs, capacityMode: "uniform" } };
    mockUseGetScenario.mockReturnValue({ data: capacitated } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [capacitated, scenario2] } as unknown as ReturnType<typeof useListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-open-warehouses"));
    await screen.findByTestId("open-warehouse-row-CHI");
    expect(screen.getByText("Utilization")).toBeInTheDocument();
  });

  it("T9 (T6): an added warehouse's displayCode (from the SAVED snapshot's addedWarehouses) renders in Open Warehouses and Customer Assignments, not its raw uid", async () => {
    const withAdded = {
      ...solvedScenario,
      inputs: {
        ...solvedScenario.inputs,
        addedWarehouses: [
          { id: "aw-1", displayCode: "WH-NV-RENO-01", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, status: "active" },
        ],
      },
      result: {
        ...solvedScenario.result,
        edges: [{ fromId: "aw-1", toId: "C1", flow: 100, distance: 12.3, band: 0 }],
      },
    };
    mockUseGetScenario.mockReturnValue({ data: withAdded } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [withAdded, scenario2] } as unknown as ReturnType<typeof useListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-open-warehouses"));
    expect(await screen.findByTestId("open-warehouse-row-aw-1")).toHaveTextContent("WH-NV-RENO-01");

    fireEvent.click(screen.getByTestId("sidebar-output-customer-assignments"));
    expect(await screen.findByTestId("assignment-row-C1")).toHaveTextContent("WH-NV-RENO-01");
  });
});

describe("Workspace — Distances tab (B5.1)", () => {
  it("opening the Distances sidebar entry renders the real grid with the scenario's distanceOverrides, not a placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("distances-tab-empty")).toBeInTheDocument();
  });

  it("shows a Save toolbar for the Distances tab (isEditableInputTab now includes it)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId("button-save")).toBeInTheDocument();
    expect(screen.getByTestId("button-save")).toBeDisabled();
  });

  it("adding a row and saving PATCHes the new entry into inputs.distanceOverrides", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    fireEvent.click(screen.getByTestId("button-add-distance-row"));
    fireEvent.change(screen.getByTestId("input-new-distance-from"), { target: { value: "CHI" } });
    fireEvent.change(screen.getByTestId("input-new-distance-to"), { target: { value: "C1" } });
    fireEvent.change(screen.getByTestId("input-new-distance-value"), { target: { value: "250" } });
    fireEvent.click(screen.getByTestId("button-add-distance-confirm"));

    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: {
        inputs: expect.objectContaining({
          distanceOverrides: [{ fromId: "CHI", toId: "C1", distance: 250 }],
        }),
      },
    });
  });

  it("the grid's known-ids existence check is sourced from the loaded dataset (CHI/C1 resolve, no warning)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    fireEvent.click(screen.getByTestId("button-add-distance-row"));
    fireEvent.change(screen.getByTestId("input-new-distance-from"), { target: { value: "CHI" } });
    fireEvent.change(screen.getByTestId("input-new-distance-to"), { target: { value: "C1" } });
    fireEvent.change(screen.getByTestId("input-new-distance-value"), { target: { value: "250" } });
    fireEvent.click(screen.getByTestId("button-add-distance-confirm"));

    expect(screen.queryByTestId("warning-unknown-from-CHI-C1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("warning-unknown-to-CHI-C1")).not.toBeInTheDocument();
  });

  // T9 (T7 wiring) — modelId/referenceCapable/inactiveWarehouseIds/
  // excludedCustomerIds are now supplied at the Workspace.tsx call site.
  // p-median-us's real manifest capability is true (mocked to match above),
  // so the reference section must actually render.
  it("T9 (T7): the reference-distances section appears for p-median-us (referenceCapable/modelId wired from the manifest)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId("distances-reference-section")).toBeInTheDocument();
  });

  // p-median-brazil's manifest has no supportsReferenceDistances at all
  // (defaults false) — the reference section must stay hidden there, proving
  // this is genuinely capability-driven, not just "always on for any model".
  it("T9 (T7): the reference-distances section stays hidden for a model without the capability (p-median-brazil)", () => {
    const brazilScenario = { ...scenario, id: 9, modelId: "p-median-brazil" };
    mockUseListScenarios.mockReturnValue({ data: [brazilScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: brazilScenario } as unknown as ReturnType<typeof useGetScenario>);
    render(<Workspace modelId="p-median-brazil" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.queryByTestId("distances-reference-section")).not.toBeInTheDocument();
  });
});

// B5.2 — add/delete row for scenario-local addedWarehouses/addedCustomers
// (B1.1), wired end-to-end through Workspace.tsx (deleteAddedEntityAndOverrides,
// the precheck query). WarehousesTab.test.tsx/CustomersTab.test.tsx already
// cover the component-level add/delete/precheck-chip behavior in isolation —
// these tests cover Workspace.tsx's OWN wiring: the cross-array
// distanceOverrides purge on delete, and that the precheck query result
// actually reaches the tab.
describe("Workspace — add/delete added warehouses & customers (B5.2)", () => {
  it("adding a warehouse and saving PATCHes the new entry into inputs.addedWarehouses", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    fireEvent.click(screen.getByTestId("button-add-warehouse-row"));
    // T9 (grid-mirror) — the manual "ID" input is gone; `id` is now a hidden
    // T3 stable uid (`aw-<uuid>`) minted by handleAddRow itself, and
    // `displayCode` (left blank here — never focused, so City/State's blur
    // auto-fill never fires) is the optional human-facing label.
    fireEvent.change(screen.getByTestId("input-new-warehouse-city"), { target: { value: "Denver" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-state"), { target: { value: "CO" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-lat"), { target: { value: "39.74" } });
    fireEvent.change(screen.getByTestId("input-new-warehouse-lng"), { target: { value: "-104.99" } });
    fireEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: {
        inputs: expect.objectContaining({
          addedWarehouses: [
            expect.objectContaining({
              id: expect.stringMatching(/^aw-/),
              city: "Denver",
              state: "CO",
              lat: 39.74,
              lng: -104.99,
              capacity: null,
              status: "active",
            }),
          ],
        }),
      },
    });
  });

  it("deleting an added warehouse removes it from addedWarehouses AND purges any distanceOverrides referencing it, in the SAME save", () => {
    mockUseGetScenario.mockReturnValue({
      data: {
        ...scenario,
        inputs: {
          ...pmedianInputs,
          addedWarehouses: [{ id: "NEWWH", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, capacity: null, status: "active" }],
          distanceOverrides: [
            { fromId: "NEWWH", toId: "C1", distance: 250 },
            { fromId: "CHI", toId: "C1", distance: 100 },
          ],
        },
      },
    } as unknown as ReturnType<typeof useGetScenario>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));

    expect(screen.getByTestId("row-added-warehouse-NEWWH")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-delete-added-warehouse-NEWWH"));
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: {
        inputs: expect.objectContaining({
          addedWarehouses: [],
          // The CHI->C1 override (unrelated to NEWWH) survives; only the
          // NEWWH->C1 override (referencing the deleted warehouse) is gone.
          distanceOverrides: [{ fromId: "CHI", toId: "C1", distance: 100 }],
        }),
      },
    });
  });

  it("base-dataset warehouse rows have no delete affordance in the real Workspace tab (only the status toggle)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(screen.queryByTestId("button-delete-added-warehouse-CHI")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-wh-CHI-forced_open")).toBeInTheDocument();
  });

  it("adding a customer and saving PATCHes the new entry into inputs.addedCustomers", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    fireEvent.click(screen.getByTestId("button-add-customer-row"));
    fireEvent.change(screen.getByTestId("input-new-customer-city"), { target: { value: "Denver" } });
    fireEvent.change(screen.getByTestId("input-new-customer-state"), { target: { value: "CO" } });
    fireEvent.change(screen.getByTestId("input-new-customer-lat"), { target: { value: "39.74" } });
    fireEvent.change(screen.getByTestId("input-new-customer-lng"), { target: { value: "-104.99" } });
    fireEvent.change(screen.getByTestId("input-new-customer-demand"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("button-add-customer-confirm"));

    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args.scenarioId).toBe(1);
    // Input Map v2 / option A: no manual ID input — id is a minted ac-<uuid>.
    // displayCode stays undefined here (fireEvent.change fires no City/State
    // blur, so the auto-fill never runs — its behavior is covered by
    // CustomersTab.test.tsx with a real blur); assert the wiring + id prefix.
    const addedC = (args.data.inputs as { addedCustomers: Array<Record<string, unknown>> }).addedCustomers;
    expect(addedC).toHaveLength(1);
    expect(addedC[0]).toMatchObject({ city: "Denver", state: "CO", lat: 39.74, lng: -104.99, demand: 500 });
    expect(addedC[0].id as string).toMatch(/^ac-/);
  });

  it("deleting an added customer removes it from addedCustomers AND purges any distanceOverrides referencing it", () => {
    mockUseGetScenario.mockReturnValue({
      data: {
        ...scenario,
        inputs: {
          ...pmedianInputs,
          addedCustomers: [{ id: "NEWC", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, demand: 500 }],
          distanceOverrides: [
            { fromId: "CHI", toId: "NEWC", distance: 250 },
            { fromId: "CHI", toId: "C1", distance: 100 },
          ],
        },
      },
    } as unknown as ReturnType<typeof useGetScenario>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));

    fireEvent.click(screen.getByTestId("button-delete-added-customer-NEWC"));
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: {
        inputs: expect.objectContaining({
          addedCustomers: [],
          distanceOverrides: [{ fromId: "CHI", toId: "C1", distance: 100 }],
        }),
      },
    });
  });

  it("the precheck query result reaches the Warehouses tab as a per-row warning chip", () => {
    mockUseGetScenario.mockReturnValue({
      data: {
        ...scenario,
        inputs: {
          ...pmedianInputs,
          addedWarehouses: [{ id: "NEWWH", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, capacity: null, status: "active" }],
        },
      },
    } as unknown as ReturnType<typeof useGetScenario>);
    mockUsePrecheckScenario.mockReturnValue({
      data: { ok: false, errors: [{ code: "completeness", message: "NEWWH missing distances to 1 customer: C1" }] },
    } as unknown as ReturnType<typeof usePrecheckScenario>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));

    expect(screen.getByTestId("warning-precheck-added-warehouse-NEWWH")).toHaveTextContent("1");
  });
});

// Task 30 (B6.1 stage 4) — transport-coal's Mines/Stations tabs' add/delete
// wiring, and the new Lane costs tab, mirroring the p-median-us "add/delete
// added warehouses & customers (B5.2)" and "Distances tab (B5.1)" blocks
// above exactly. MinesTab.test.tsx/StationsTab.test.tsx/LaneCostsTab.test.tsx
// already cover component-level behavior in isolation — these tests cover
// Workspace.tsx's OWN wiring: the cross-array laneCostOverrides purge on
// delete, the precheck query reaching the tab, and that the sidebar/render
// gates actually route to these components for modelId="transport-coal".
describe("Workspace — transport-coal Mines/Stations/Lane costs tabs (Task 30)", () => {
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

  const transportScenario = {
    id: 8,
    name: "Coal Base Case",
    modelId: "transport-coal",
    inputs: transportInputs,
    result: null,
    stale: false,
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  };

  function renderTransportWorkspace() {
    return render(<Workspace modelId="transport-coal" userEmail="student@example.com" />);
  }

  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [transportScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportScenario } as unknown as ReturnType<typeof useGetScenario>);
  });

  it("sidebar shows a 'Lane costs' entry (not 'Distances') for transport-coal", () => {
    renderTransportWorkspace();
    expect(screen.getByTestId("sidebar-input-laneCosts")).toHaveTextContent("Lane costs");
    expect(screen.queryByTestId("sidebar-input-distances")).not.toBeInTheDocument();
  });

  it("opening the Mines sidebar entry renders the real MineTable, not a placeholder", () => {
    renderTransportWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-mines"));
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("mines-tab")).toBeInTheDocument();
  });

  it("adding a mine and saving PATCHes the new entry into inputs.addedMines", () => {
    renderTransportWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-mines"));
    fireEvent.click(screen.getByTestId("button-add-mine-row"));
    // T11 (Step A, grid-mirror) — the manual "ID" input is gone; `id` is now
    // a hidden T3 stable uid (`am-<uuid>`) minted by handleAddRow itself,
    // and `displayCode` (left blank here — never focused, so City/State's
    // blur auto-fill never fires under `fireEvent.change`) is the optional
    // human-facing label. Mirrors the equivalent warehouse test exactly.
    fireEvent.change(screen.getByTestId("input-new-mine-city"), { target: { value: "Bristol" } });
    fireEvent.change(screen.getByTestId("input-new-mine-state"), { target: { value: "VA" } });
    fireEvent.change(screen.getByTestId("input-new-mine-lat"), { target: { value: "36.6" } });
    fireEvent.change(screen.getByTestId("input-new-mine-lng"), { target: { value: "-82.19" } });
    fireEvent.click(screen.getByTestId("button-add-mine-confirm"));

    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 8,
      data: {
        inputs: expect.objectContaining({
          addedMines: [
            expect.objectContaining({
              id: expect.stringMatching(/^am-/),
              city: "Bristol",
              state: "VA",
              lat: 36.6,
              lng: -82.19,
              capacity: null,
            }),
          ],
        }),
      },
    });
  });

  it("deleting an added mine removes it from addedMines AND purges any laneCostOverrides referencing it, in the SAME save", () => {
    mockUseGetScenario.mockReturnValue({
      data: {
        ...transportScenario,
        inputs: {
          ...transportInputs,
          addedMines: [{ id: "MNEW", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: null }],
          laneCostOverrides: [
            { fromId: "MNEW", toId: "CHI", cost: 250 },
            { fromId: "KY", toId: "CHI", cost: 100 },
          ],
        },
      },
    } as unknown as ReturnType<typeof useGetScenario>);
    renderTransportWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-mines"));

    expect(screen.getByTestId("row-added-mine-MNEW")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-delete-added-mine-MNEW"));
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 8,
      data: {
        inputs: expect.objectContaining({
          addedMines: [],
          // The KY->CHI override (unrelated to MNEW) survives; only the
          // MNEW->CHI override (referencing the deleted mine) is gone.
          laneCostOverrides: [{ fromId: "KY", toId: "CHI", cost: 100 }],
        }),
      },
    });
  });

  it("adding a station and saving PATCHes the new entry into inputs.addedStations", () => {
    renderTransportWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-stations"));
    fireEvent.click(screen.getByTestId("button-add-station-row"));
    // T11 (Step A, grid-mirror) — mirrors the mine test's own comment above.
    fireEvent.change(screen.getByTestId("input-new-station-city"), { target: { value: "Newtown" } });
    fireEvent.change(screen.getByTestId("input-new-station-state"), { target: { value: "NC" } });
    fireEvent.change(screen.getByTestId("input-new-station-lat"), { target: { value: "35.5" } });
    fireEvent.change(screen.getByTestId("input-new-station-lng"), { target: { value: "-80.2" } });
    fireEvent.change(screen.getByTestId("input-new-station-demand"), { target: { value: "900000" } });
    fireEvent.click(screen.getByTestId("button-add-station-confirm"));

    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 8,
      data: {
        inputs: expect.objectContaining({
          addedStations: [
            expect.objectContaining({
              id: expect.stringMatching(/^as-/),
              city: "Newtown",
              state: "NC",
              lat: 35.5,
              lng: -80.2,
              demand: 900000,
            }),
          ],
        }),
      },
    });
  });

  it("deleting an added station removes it from addedStations AND purges any laneCostOverrides referencing it", () => {
    mockUseGetScenario.mockReturnValue({
      data: {
        ...transportScenario,
        inputs: {
          ...transportInputs,
          addedStations: [{ id: "SNEW", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 900000 }],
          laneCostOverrides: [
            { fromId: "KY", toId: "SNEW", cost: 250 },
            { fromId: "KY", toId: "CHI", cost: 100 },
          ],
        },
      },
    } as unknown as ReturnType<typeof useGetScenario>);
    renderTransportWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-stations"));

    fireEvent.click(screen.getByTestId("button-delete-added-station-SNEW"));
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 8,
      data: {
        inputs: expect.objectContaining({
          addedStations: [],
          laneCostOverrides: [{ fromId: "KY", toId: "CHI", cost: 100 }],
        }),
      },
    });
  });

  it("the precheck query result reaches the Mines tab as a per-row warning chip", () => {
    mockUseGetScenario.mockReturnValue({
      data: {
        ...transportScenario,
        inputs: {
          ...transportInputs,
          addedMines: [{ id: "MNEW", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: null }],
        },
      },
    } as unknown as ReturnType<typeof useGetScenario>);
    mockUsePrecheckScenario.mockReturnValue({
      data: { ok: false, errors: [{ code: "completeness", message: "MNEW missing lane costs to 1 station: C1" }] },
    } as unknown as ReturnType<typeof usePrecheckScenario>);
    renderTransportWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-mines"));

    expect(screen.getByTestId("warning-precheck-added-mine-MNEW")).toHaveTextContent("1");
  });

  it("opening the Lane costs sidebar entry renders the real grid, not a placeholder", () => {
    renderTransportWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-laneCosts"));
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("lanecosts-tab-empty")).toBeInTheDocument();
  });

  it("shows a Save toolbar for the Lane costs tab (isEditableInputTab includes it)", () => {
    renderTransportWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-laneCosts"));
    expect(screen.getByTestId("button-save")).toBeInTheDocument();
    expect(screen.getByTestId("button-save")).toBeDisabled();
  });

  it("adding a lane cost row and saving PATCHes the new entry into inputs.laneCostOverrides", () => {
    renderTransportWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-laneCosts"));
    fireEvent.click(screen.getByTestId("button-add-lanecost-row"));
    fireEvent.change(screen.getByTestId("input-new-lanecost-from"), { target: { value: "CHI" } });
    fireEvent.change(screen.getByTestId("input-new-lanecost-to"), { target: { value: "C1" } });
    fireEvent.change(screen.getByTestId("input-new-lanecost-value"), { target: { value: "250" } });
    fireEvent.click(screen.getByTestId("button-add-lanecost-confirm"));

    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 8,
      data: {
        inputs: expect.objectContaining({
          laneCostOverrides: [{ fromId: "CHI", toId: "C1", cost: 250 }],
        }),
      },
    });
  });
});

describe("Workspace — Optimization Parameters tab", () => {
  it("opening the sidebar entry renders the real form with the scenario's values, not a placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("text-p-value")).toHaveTextContent("3");
    expect(screen.getByTestId("input-gap")).toHaveValue(0);
    expect(screen.getByTestId("input-time-limit")).toHaveValue(120);
  });

  it("Save is disabled when nothing changed, and no mutation fires just from opening the tab", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("button-save")).toBeDisabled();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
  });

  it("an edit does NOT save on its own — only an explicit Save click persists it via useUpdateScenario (the same shared mechanism as Warehouses/Customers)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-p-quick-10"));

    expect(screen.getByTestId("button-save")).toBeEnabled();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: {
        inputs: expect.objectContaining({ p: 10 }),
      },
    });
  });

  it("edits to gap/timeLimitSec/distanceBands all funnel through the same localInputs draft and are saved together", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.change(screen.getByTestId("input-gap"), { target: { value: "0.05" } });
    fireEvent.change(screen.getByTestId("input-time-limit"), { target: { value: "300" } });
    fireEvent.click(screen.getByTestId("button-remove-band-400"));

    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: {
        inputs: expect.objectContaining({
          gap: 0.05,
          timeLimitSec: 300,
          distanceBands: [200, 800, 1600],
        }),
      },
    });
  });

  it("shows an 'Unsaved changes' indicator only while dirty", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.queryByTestId("text-unsaved-changes")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("button-p-quick-10"));
    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
  });
});

// ── A2.1 — Solve dialog ──────────────────────────────────────────────────────
describe("Workspace — Solve dialog", () => {
  it("Run Optimizer opens the dialog showing the scenario's current p/gap/timeLimitSec — synced with Optimization Parameters", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    expect(screen.getByTestId("solve-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-p-value")).toHaveTextContent("3");
    expect(screen.getByTestId("solve-dialog-input-gap")).toHaveValue(0);
    expect(screen.getByTestId("solve-dialog-input-time-limit")).toHaveValue(120);
  });

  it("editing p in the Optimization Parameters tab is reflected in the Solve dialog (single source of truth)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-p-quick-10"));

    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    expect(screen.getByTestId("solve-dialog-p-value")).toHaveTextContent("10");
  });

  it("editing gap in the Solve dialog is reflected in the Optimization Parameters tab (single source of truth)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.change(screen.getByTestId("solve-dialog-input-gap"), { target: { value: "0.05" } });
    fireEvent.click(screen.getByTestId("solve-dialog-cancel"));

    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("input-gap")).toHaveValue(0.05);
  });

  // T4/R5 — same "single source of truth" contract as p/gap above, now for
  // the new distance-band editor: this dialog and the Optimization
  // Parameters tab both read/write the SAME localInputs.distanceBands draft.
  it("editing distance bands in the Solve dialog is reflected in the Optimization Parameters tab (single source of truth)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-button-remove-band-1600"));
    fireEvent.click(screen.getByTestId("solve-dialog-cancel"));

    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.queryByTestId("button-remove-band-1600")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-remove-band-800")).toBeInTheDocument();
  });

  // T2's ModelInfo.distanceUnit isn't in this file's useListModels fixture
  // (unresolved/absent) — the dialog must fall back to "mi", matching the
  // same default the public API boundary itself applies.
  it("the Solve dialog's distance-band editor defaults to the 'mi' unit label when the model manifest has no distanceUnit resolved", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    expect(screen.getByText("Distance bands (mi)")).toBeInTheDocument();
  });

  // Same save-before-solve contract the test below already proves for `p` —
  // an edited DRAFT distanceBands must be part of what gets persisted before
  // the solve is enqueued, not silently discarded (R5: bands are a real
  // solve input, not a post-solve lens).
  it("clicking Solve after editing bands in the Solve dialog saves the edited distanceBands before enqueuing the solve", () => {
    mockUpdateScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => {
      opts.onSuccess();
    });
    renderWorkspace();

    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-button-remove-band-1600"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [saveArgs] = mockUpdateScenario.mutate.mock.calls[0];
    expect(saveArgs).toEqual({
      scenarioId: 1,
      data: { inputs: expect.objectContaining({ distanceBands: [200, 400, 800] }) },
    });
    expect(mockSolveScenario.mutate).toHaveBeenCalledTimes(1);
  });

  // The one test that must exist per the task brief: this repo already shipped
  // and fixed this exact bug once in Studio.tsx (CLAUDE.md's "Round 2" —
  // handleSolve firing against stale persisted inputs because POST /solve has
  // no body and reads whatever's already saved). SolveDialog's Solve button
  // must save a dirty localInputs draft first, and only enqueue the solve once
  // that save succeeds.
  it("clicking Solve with unsaved edits SAVES FIRST, then solves only after the save succeeds", () => {
    mockUpdateScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => {
      opts.onSuccess();
    });
    renderWorkspace();

    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-p-quick-10"));

    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [saveArgs] = mockUpdateScenario.mutate.mock.calls[0];
    expect(saveArgs).toEqual({
      scenarioId: 1,
      data: { inputs: expect.objectContaining({ p: 10 }) },
    });
    expect(mockSolveScenario.mutate).toHaveBeenCalledTimes(1);
    expect(mockSolveScenario.mutate.mock.calls[0][0]).toEqual({ scenarioId: 1 });
  });

  it("clicking Solve with a dirty draft does NOT enqueue the solve before the save resolves", () => {
    // Save mutate is called but its onSuccess is never invoked in this test —
    // simulates the save still being in flight. `mockReset` guards against a
    // leftover `mockImplementation` from an earlier test in this file (`vi
    // .clearAllMocks()` in the top-level beforeEach clears calls, not a
    // previously-set implementation).
    mockUpdateScenario.mutate.mockReset();
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-p-quick-10"));

    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    expect(mockSolveScenario.mutate).not.toHaveBeenCalled();
  });

  it("clicking Solve with no unsaved changes solves immediately, without saving first", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
    expect(mockSolveScenario.mutate).toHaveBeenCalledTimes(1);
    expect(mockSolveScenario.mutate.mock.calls[0][0]).toEqual({ scenarioId: 1 });
  });

  it("shows a progress state while the solve is in flight, and disables the Solve button", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    expect(screen.getByTestId("solve-dialog-progress")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-solve")).toBeDisabled();
  });

  it("shows a destructive toast and an inline error, and does not proceed to solve, when the pre-solve save is rejected", () => {
    mockUpdateScenario.mutate.mockImplementation((_vars: unknown, opts: { onError: (err: unknown) => void }) => {
      opts.onError(new Error("HTTP 422 Unprocessable Entity: inputs fails model-specific validation"));
    });
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-p-quick-10"));

    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't save your changes",
      variant: "destructive",
    }));
    expect(mockSolveScenario.mutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("solve-dialog-error")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-solve")).not.toBeDisabled();
  });

  it("shows a destructive toast when enqueuing the solve itself fails", () => {
    mockSolveScenario.mutate.mockImplementation((_vars: unknown, opts: { onError: (err: unknown) => void }) => {
      opts.onError(new Error("HTTP 429: queue depth limit exceeded"));
    });
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Solve failed to start",
      variant: "destructive",
    }));
  });

  it("on a successful poll, opens and activates the Output Map tab and closes the dialog", () => {
    mockSolveScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (r: { jobId: number }) => void }) => {
      opts.onSuccess({ jobId: 7 });
    });
    mockUseGetSolveJob.mockImplementation((_scenarioId: number, jobId: number) =>
      (jobId
        ? { data: { id: 7, status: "succeeded", error: null, resultSummary: null } }
        : { data: undefined }) as unknown as ReturnType<typeof useGetSolveJob>
    );
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    expect(screen.queryByTestId("solve-dialog")).not.toBeInTheDocument();
    const outputMapTab = screen.getByTestId("tab-output:output-map");
    expect(outputMapTab).toBeInTheDocument();
    expect(outputMapTab).toHaveAttribute("aria-selected", "true");
  });

  it("shows a destructive toast and does not open Output Map when the polled job fails", () => {
    mockSolveScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (r: { jobId: number }) => void }) => {
      opts.onSuccess({ jobId: 7 });
    });
    mockUseGetSolveJob.mockImplementation((_scenarioId: number, jobId: number) =>
      (jobId
        ? { data: { id: 7, status: "failed", error: "Solver timed out", resultSummary: null } }
        : { data: undefined }) as unknown as ReturnType<typeof useGetSolveJob>
    );
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Solve failed",
      description: "Solver timed out",
    }));
    expect(screen.queryByTestId("tab-output:output-map")).not.toBeInTheDocument();
  });
});

// ── Task 6 (C5.1) — result-history stepper ───────────────────────────────────
describe("Workspace — result history stepper (Task 6)", () => {
  it("hides the stepper buttons when there is no result history yet", () => {
    // Default `scenario` fixture is unsolved (result: null) — no history to step through yet.
    renderWorkspace();
    expect(screen.queryByTestId("button-result-back")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-result-forward")).not.toBeInTheDocument();
  });

  it("accumulates each new solve into history and steps back/forward through both result and inputs", async () => {
    const resultA = {
      status: "optimal" as const, objective: 111, runTimeSec: 0.1, quality: "Proven optimal",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
    };
    const resultB = { ...resultA, objective: 222 };
    const scenarioWithA = { ...scenario, inputs: { ...pmedianInputs, p: 3 }, result: resultA, stale: false };
    const scenarioWithB = { ...scenario, inputs: { ...pmedianInputs, p: 10 }, result: resultB, stale: false };

    // Save (used by the second, dirty-draft solve) and solve both resolve
    // synchronously via their mocked onSuccess callbacks.
    mockUpdateScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => opts.onSuccess());
    mockSolveScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (r: { jobId: number }) => void }) =>
      opts.onSuccess({ jobId: 7 }),
    );
    mockUseGetSolveJob.mockImplementation((_scenarioId: number, jobId: number) =>
      (jobId
        ? { data: { id: 7, status: "succeeded", error: null, resultSummary: null } }
        : { data: undefined }) as unknown as ReturnType<typeof useGetSolveJob>
    );

    const view = renderWorkspace();

    // First solve: scenario starts unsolved, no unsaved edits — solves
    // immediately, no save needed. This is the flow that produces
    // `scenarioWithA` on the wire — simulated here by re-mocking
    // useGetScenario and forcing a re-render, standing in for the async
    // useGetScenario refetch that a real invalidateQueries triggers (jobRunner
    // itself is fully mocked in this test file).
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));
    mockUseGetScenario.mockReturnValue({ data: scenarioWithA } as unknown as ReturnType<typeof useGetScenario>);
    view.rerender(<Workspace modelId="p-median-us" userEmail="student@example.com" />);

    expect(await screen.findByTestId("text-result-history-position")).toHaveTextContent("1/1");

    // Change P (dirty draft), solve again — handleSolve saves first, then
    // solves, producing `scenarioWithB` (objective B, p=10) on the wire.
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-p-quick-10"));
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));
    mockUseGetScenario.mockReturnValue({ data: scenarioWithB } as unknown as ReturnType<typeof useGetScenario>);
    view.rerender(<Workspace modelId="p-median-us" userEmail="student@example.com" />);

    expect(await screen.findByTestId("text-result-history-position")).toHaveTextContent("2/2");

    fireEvent.click(screen.getByTestId("button-result-back"));
    expect(await screen.findByTestId("text-result-history-position")).toHaveTextContent("1/2");
    // Stepping back restores the RESPECTIVE inputs too (p reverts to 3, the
    // value that produced resultA), not just the displayed result.
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("text-p-value")).toHaveTextContent("3");

    fireEvent.click(screen.getByTestId("button-result-forward"));
    expect(await screen.findByTestId("text-result-history-position")).toHaveTextContent("2/2");
  });

  // C5.1 fix — final-whole-branch-review Important finding: stepping through
  // result history updated `localInputs` (input tabs) but every OUTPUT
  // surface kept reading `currentScenario.result` (always the LATEST solve),
  // so the Cost Summary/Assignments/Open Warehouses/Service Stats grids,
  // Output Map, and Reports tab all silently kept showing the newest result
  // even while the input tabs showed a stepped-to historical snapshot. This
  // test proves an output grid tab (Cost Summary — simplest reliable
  // assertion via its `cost-summary-value-objective` testid) tracks the
  // stepper, not just the input tabs Task 6's own test already covers.
  it("wires the stepped-to history entry's result into an output grid tab (Cost Summary), not just the input tabs", async () => {
    const resultA = {
      status: "optimal" as const, objective: 111, runTimeSec: 0.1, quality: "Proven optimal",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
    };
    const resultB = { ...resultA, objective: 222 };
    const scenarioWithA = { ...scenario, inputs: { ...pmedianInputs, p: 3 }, result: resultA, stale: false };
    const scenarioWithB = { ...scenario, inputs: { ...pmedianInputs, p: 10 }, result: resultB, stale: false };

    mockUpdateScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => opts.onSuccess());
    mockSolveScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (r: { jobId: number }) => void }) =>
      opts.onSuccess({ jobId: 7 }),
    );
    mockUseGetSolveJob.mockImplementation((_scenarioId: number, jobId: number) =>
      (jobId
        ? { data: { id: 7, status: "succeeded", error: null, resultSummary: null } }
        : { data: undefined }) as unknown as ReturnType<typeof useGetSolveJob>
    );

    const view = renderWorkspace();

    // Build the same 2-entry history as Task 6's own test (resultA then
    // resultB, objective 111 then 222).
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));
    mockUseGetScenario.mockReturnValue({ data: scenarioWithA } as unknown as ReturnType<typeof useGetScenario>);
    view.rerender(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
    expect(await screen.findByTestId("text-result-history-position")).toHaveTextContent("1/1");

    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-p-quick-10"));
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));
    mockUseGetScenario.mockReturnValue({ data: scenarioWithB } as unknown as ReturnType<typeof useGetScenario>);
    view.rerender(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
    expect(await screen.findByTestId("text-result-history-position")).toHaveTextContent("2/2");

    // Currently at entry 2 (objective 222) — the Cost Summary tab should show it.
    fireEvent.click(screen.getByTestId("sidebar-output-cost-summary"));
    expect(await screen.findByTestId("cost-summary-value-objective")).toHaveTextContent("222");

    // Step back to entry 1 (objective 111) — the ALREADY-OPEN Cost Summary
    // tab must update to reflect it, not keep showing 222.
    fireEvent.click(screen.getByTestId("button-result-back"));
    expect(await screen.findByTestId("text-result-history-position")).toHaveTextContent("1/2");
    expect(await screen.findByTestId("cost-summary-value-objective")).toHaveTextContent("111");

    // Step forward again — restores 222.
    fireEvent.click(screen.getByTestId("button-result-forward"));
    expect(await screen.findByTestId("text-result-history-position")).toHaveTextContent("2/2");
    expect(await screen.findByTestId("cost-summary-value-objective")).toHaveTextContent("222");
  });
});

// ── Task 7 (C5.1) — "Save as scenario" from a history entry (DD-7) ──────────
describe("Workspace — save as scenario from a history entry (Task 7)", () => {
  it("creates a new scenario from the currently-viewed history entry's inputs and triggers a solve when Save as scenario is clicked", async () => {
    const resultA = {
      status: "optimal" as const, objective: 111, runTimeSec: 0.1, quality: "Proven optimal",
      edges: [], metrics: {}, details: {}, solverUsed: "CBC", infeasibilityReason: null,
    };
    const resultB = { ...resultA, objective: 222 };
    const scenarioWithA = { ...scenario, inputs: { ...pmedianInputs, p: 3 }, result: resultA, stale: false };
    const scenarioWithB = { ...scenario, inputs: { ...pmedianInputs, p: 10 }, result: resultB, stale: false };

    mockUpdateScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => opts.onSuccess());
    mockSolveScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (r: { jobId: number }) => void }) =>
      opts.onSuccess({ jobId: 7 }),
    );
    mockUseGetSolveJob.mockImplementation((_scenarioId: number, jobId: number) =>
      (jobId
        ? { data: { id: 7, status: "succeeded", error: null, resultSummary: null } }
        : { data: undefined }) as unknown as ReturnType<typeof useGetSolveJob>
    );

    const view = renderWorkspace();

    // Build a 2-entry history (same setup as Task 6's own test), then step
    // back to entry 1 (p=3, resultA) — that's the "currently-viewed" entry
    // this test asserts Save as scenario reads from, NOT entry 2 (p=10).
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));
    mockUseGetScenario.mockReturnValue({ data: scenarioWithA } as unknown as ReturnType<typeof useGetScenario>);
    view.rerender(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
    expect(await screen.findByTestId("text-result-history-position")).toHaveTextContent("1/1");

    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-p-quick-10"));
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    fireEvent.click(screen.getByTestId("solve-dialog-solve"));
    mockUseGetScenario.mockReturnValue({ data: scenarioWithB } as unknown as ReturnType<typeof useGetScenario>);
    view.rerender(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
    expect(await screen.findByTestId("text-result-history-position")).toHaveTextContent("2/2");

    fireEvent.click(screen.getByTestId("button-result-back"));
    expect(await screen.findByTestId("text-result-history-position")).toHaveTextContent("1/2");

    // Now clicking Save as scenario must create a scenario from entry 1's
    // inputs (p=3), not entry 2's (p=10).
    const created = {
      id: 42,
      name: "3 Warehouses (saved run)",
      modelId: "p-median-us",
      inputs: { ...pmedianInputs, p: 3 },
      result: null,
      stale: false,
      createdAt: "x",
      updatedAt: "x",
    };
    mockCreateScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (s: typeof created) => void }) => {
      opts.onSuccess(created);
    });

    fireEvent.click(screen.getByTestId("button-save-as-scenario"));

    expect(mockCreateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockCreateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      data: {
        name: "3 Warehouses (saved run)",
        modelId: "p-median-us",
        inputs: { ...pmedianInputs, p: 3 },
      },
    });

    // handleSolve is not called for this path — Save as scenario triggers the
    // solve mutation directly (a freshly-created scenario is never dirty).
    expect(mockSolveScenario.mutate).toHaveBeenCalledWith(
      { scenarioId: 42 },
      expect.anything(),
    );
    expect(mockNavigate).toHaveBeenCalledWith("?scenario=42");
  });
});

// ── A4.1 — sidebar scenario operations ───────────────────────────────────────
const pmedianDefaultInputs = {
  p: 3,
  distanceBands: [200, 400, 800, 1600],
  capacityMode: "none",
  uniformCapacity: null,
  warehouseOverrides: [],
  customerOverrides: [],
  gap: 0,
  timeLimitSec: 120,
};

describe("Workspace — create scenario", () => {
  it("clicking + in the sidebar opens a create-scenario dialog, pre-filled with a sequential default name", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-create-scenario"));
    expect(screen.getByTestId("input-new-scenario-name")).toHaveValue("Scenario 3");
  });

  it("confirming create calls useCreateScenario with the p-median-us default inputs shape (Studio.tsx's own default, not invented)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-create-scenario"));
    fireEvent.change(screen.getByTestId("input-new-scenario-name"), { target: { value: "New Scenario" } });
    fireEvent.click(screen.getByTestId("button-create-confirm"));

    expect(mockCreateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockCreateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      data: {
        name: "New Scenario",
        modelId: "p-median-us",
        inputs: pmedianDefaultInputs,
      },
    });
  });

  // CRITICAL — the one regression this task must not reintroduce (CLAUDE.md's
  // "post-migration bug audit," Task 2 finding, already fixed once in
  // Studio.tsx's handleCreateConfirm/handleClone/handleDelete).
  it("CRITICAL — writes the created scenario into the scenarios-list cache BEFORE navigating, then refreshes in the background", () => {
    const callOrder: string[] = [];
    mockQueryClient.setQueryData.mockImplementation(() => callOrder.push("setQueryData"));
    mockNavigate.mockImplementation(() => callOrder.push("navigate"));
    const created = { id: 99, name: "New Scenario", modelId: "p-median-us", inputs: pmedianDefaultInputs, result: null, stale: false, createdAt: "x", updatedAt: "x" };
    mockCreateScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (s: typeof created) => void }) => {
      opts.onSuccess(created);
    });

    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-create-scenario"));
    fireEvent.change(screen.getByTestId("input-new-scenario-name"), { target: { value: "New Scenario" } });
    fireEvent.click(screen.getByTestId("button-create-confirm"));

    expect(callOrder).toEqual(["setQueryData", "navigate"]);
    expect(mockNavigate).toHaveBeenCalledWith("?scenario=99");
    // background consistency refresh — non-blocking, strictly after navigate.
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalled();
  });

  it("closes the dialog after a successful create", () => {
    const created = { id: 99, name: "New Scenario", modelId: "p-median-us", inputs: pmedianDefaultInputs, result: null, stale: false, createdAt: "x", updatedAt: "x" };
    mockCreateScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (s: typeof created) => void }) => {
      opts.onSuccess(created);
    });
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-create-scenario"));
    fireEvent.click(screen.getByTestId("button-create-confirm"));
    expect(screen.queryByTestId("input-new-scenario-name")).not.toBeInTheDocument();
  });
});

describe("Workspace — clone scenario", () => {
  it("clicking Clone on a sidebar row clones that scenario", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-clone-scenario-2"));
    expect(mockCloneScenario.mutate).toHaveBeenCalledTimes(1);
    expect(mockCloneScenario.mutate.mock.calls[0][0]).toEqual({ scenarioId: 2 });
  });

  it("CRITICAL — writes the cloned scenario into the scenarios-list cache BEFORE navigating, then refreshes in the background", () => {
    const callOrder: string[] = [];
    mockQueryClient.setQueryData.mockImplementation(() => callOrder.push("setQueryData"));
    mockNavigate.mockImplementation(() => callOrder.push("navigate"));
    const cloned = { id: 42, name: "Alt scenario (copy)", modelId: "p-median-us", inputs: pmedianInputs, result: null, stale: false, createdAt: "x", updatedAt: "x" };
    mockCloneScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (s: typeof cloned) => void }) => {
      opts.onSuccess(cloned);
    });

    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-clone-scenario-2"));

    expect(callOrder).toEqual(["setQueryData", "navigate"]);
    expect(mockNavigate).toHaveBeenCalledWith("?scenario=42");
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalled();
  });
});

describe("Workspace — delete scenario", () => {
  it("delete requires an explicit sidebar confirm before useDeleteScenario fires", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-delete-scenario-2"));
    expect(mockDeleteScenario.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-confirm-delete-2"));
    expect(mockDeleteScenario.mutate).toHaveBeenCalledWith({ scenarioId: 2 }, expect.anything());
  });

  // CRITICAL — same cache-write-before-navigate ordering as create/clone.
  it("CRITICAL — deleting the currently active scenario writes the trimmed list into cache BEFORE navigating to the next remaining scenario", () => {
    const callOrder: string[] = [];
    mockQueryClient.setQueryData.mockImplementation(() => callOrder.push("setQueryData"));
    mockNavigate.mockImplementation(() => callOrder.push("navigate"));
    mockDeleteScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => {
      opts.onSuccess();
    });

    renderWorkspace(); // active scenario is id=1 (mocked ?scenario=1)
    fireEvent.click(screen.getByTestId("button-delete-scenario-1"));
    fireEvent.click(screen.getByTestId("button-confirm-delete-1"));

    expect(mockDeleteScenario.mutate).toHaveBeenCalledWith({ scenarioId: 1 }, expect.anything());
    expect(callOrder).toEqual(["setQueryData", "navigate"]);
    expect(mockNavigate).toHaveBeenCalledWith("?scenario=2");
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalled();
  });

  it("deleting a scenario that is NOT the active one removes it from the sidebar cache but does not navigate", () => {
    mockDeleteScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => {
      opts.onSuccess();
    });
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-delete-scenario-2"));
    fireEvent.click(screen.getByTestId("button-confirm-delete-2"));

    expect(mockDeleteScenario.mutate).toHaveBeenCalledWith({ scenarioId: 2 }, expect.anything());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockQueryClient.setQueryData).toHaveBeenCalled();
  });

  it("deleting the last remaining scenario navigates back to the bare chapter path", () => {
    mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockDeleteScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => {
      opts.onSuccess();
    });
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-delete-scenario-1"));
    fireEvent.click(screen.getByTestId("button-confirm-delete-1"));

    expect(mockNavigate).toHaveBeenCalledWith("/chapter-3");
  });
});

// The design nuance this task's brief calls out explicitly: rename fires its
// own immediate {name}-only PATCH, independent of the active scenario's
// input-editing Save flow (A1.1/A1.2) — a sibling row's rename has no
// "active scenario Save" context to defer to.
describe("Workspace — rename scenario", () => {
  it("renaming a SIBLING (non-active) scenario fires its own immediate name-only PATCH, independent of the active scenario's unsaved tab-editing state", () => {
    renderWorkspace();
    // Dirty the ACTIVE scenario's (id=1) unsaved input state first.
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-p-quick-10"));
    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();

    // Rename scenario 2 — a sibling, not the active one.
    fireEvent.click(screen.getByTestId("button-rename-scenario-2"));
    fireEvent.change(screen.getByTestId("input-rename-scenario-2"), { target: { value: "Renamed sibling" } });
    fireEvent.keyDown(screen.getByTestId("input-rename-scenario-2"), { key: "Enter" });

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 2,
      data: { name: "Renamed sibling" },
    });

    // The active scenario's dirty editing state (a wholly separate concern)
    // is untouched by the sibling's rename.
    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
    expect(screen.getByTestId("text-p-value")).toHaveTextContent("10");
  });

  it("renaming the active scenario also fires the same immediate name-only PATCH (not bundled with inputs)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-rename-scenario-1"));
    fireEvent.change(screen.getByTestId("input-rename-scenario-1"), { target: { value: "Renamed active" } });
    fireEvent.keyDown(screen.getByTestId("input-rename-scenario-1"), { key: "Enter" });

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: { name: "Renamed active" },
    });
  });
});

// Task 10 — Workspace's self-contained header (chosen instead of wrapping in
// AppShell, to avoid a double-header — see A0.2's review) had no logout
// button and no way back to Landing, leaving the pilot route (/chapter-3)
// with zero logout affordance. Fixed by reusing AppShell.tsx's exact logout
// pattern (see AppShell.test.tsx) and Studio.tsx's exact page-back
// convention (button-page-back, navigate("/")) rather than inventing new UX.
describe("Workspace — logout / back to Landing", () => {
  it("the back-to-Landing control navigates to \"/\", matching Studio.tsx's page-back convention", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-page-back"));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("clicking logout calls the logout mutation and, on success, writes the auth-user cache to { user: null } BEFORE navigating to /login — mirroring AppShell.tsx's documented race fix", () => {
    const callOrder: string[] = [];
    mockQueryClient.setQueryData.mockImplementation(() => callOrder.push("setQueryData"));
    mockNavigate.mockImplementation(() => callOrder.push("navigate"));
    mockLogoutUser.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => {
      opts.onSuccess();
    });

    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-logout"));

    expect(mockLogoutUser.mutate).toHaveBeenCalledTimes(1);
    // Same race this repo already documented and fixed once in AppShell.tsx:
    // navigating to "/login" before the auth-user cache is updated used to
    // race Gate()'s auth-gated render against an async invalidate+refetch,
    // producing a 404. The synchronous cache write must happen strictly
    // before navigate, not merely "eventually" via invalidateQueries.
    expect(callOrder).toEqual(["setQueryData", "navigate"]);
    expect(mockQueryClient.setQueryData).toHaveBeenCalledWith(["getCurrentAuthUser"], { user: null });
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("does not navigate to /login if the logout mutation never succeeds", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-logout"));

    expect(mockLogoutUser.mutate).toHaveBeenCalledTimes(1);
    expect(mockQueryClient.setQueryData).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("Workspace — header centered chapter/summary + divider layout (B2.1-T3, items 4/5)", () => {
  it("item 4: renders a centered chapter+summary block with the chapter and description for p-median-us", () => {
    renderWorkspace();
    const summary = screen.getByTestId("workspace-chapter-summary");
    expect(summary).toHaveTextContent("Chapter 3");
    expect(summary).toHaveTextContent(
      "Facility-location: choose which warehouses to open to minimize weighted distance to customers."
    );
  });

  it("item 4: renders the chapter+summary block for transport-coal too (a second model, not just p-median-us)", () => {
    const transportScenario = { ...scenario, id: 8, modelId: "transport-coal" };
    mockUseListScenarios.mockReturnValue({ data: [transportScenario] } as unknown as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportScenario } as unknown as ReturnType<typeof useGetScenario>);
    render(<Workspace modelId="transport-coal" userEmail="student@example.com" />);
    const summary = screen.getByTestId("workspace-chapter-summary");
    expect(summary).toHaveTextContent("Chapter 5");
    expect(summary).toHaveTextContent("Transportation LP: route coal from mines to power stations at minimum cost.");
  });

  it("item 5: header controls (result-history stepper's save-as-scenario, Run Optimizer) still render alongside the centered summary", () => {
    renderWorkspace();
    expect(screen.getByTestId("workspace-chapter-summary")).toBeInTheDocument();
    expect(screen.getByTestId("button-run-optimizer")).toBeInTheDocument();
    expect(screen.getByTestId("button-logout")).toBeInTheDocument();
    expect(screen.getByTestId("text-user-email")).toBeInTheDocument();
  });
});

// T9 — C2 (items 13/14/15): 3-track grid header (selector left / summary
// centered in its own track / account+stepper+solve right), replacing the
// old absolute-centering layout. Below `md` the grid collapses to a single
// column so the three zones stack into rows.
describe("Workspace — header grid layout (T9, C2)", () => {
  it("removes the old title/subtitle block (text-app-name) entirely", () => {
    renderWorkspace();
    expect(screen.queryByTestId("text-app-name")).not.toBeInTheDocument();
  });

  it("lays out the scenario selector (left) before the centered summary (center) before email/logout (right), in that DOM order", () => {
    renderWorkspace();
    const selector = screen.getByTestId("select-scenario-context");
    const summary = screen.getByTestId("workspace-chapter-summary");
    const email = screen.getByTestId("text-user-email");
    // eslint-disable-next-line no-bitwise
    expect(selector.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(summary.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the summary is full/untruncated text at rest — no more max-w-[38%]/absolute positioning against the whole header", () => {
    renderWorkspace();
    const summary = screen.getByTestId("workspace-chapter-summary");
    expect(summary.className).not.toContain("absolute");
    expect(summary.className).not.toContain("max-w-[38%]");
    expect(summary).toHaveTextContent(
      "Chapter 3 · Facility-location: choose which warehouses to open to minimize weighted distance to customers."
    );
  });

  it("the header uses a responsive grid-cols-1 -> md:grid-cols-[auto_1fr_auto] track layout, not a fixed-width flex row", () => {
    renderWorkspace();
    const grid = screen.getByTestId("select-scenario-context").closest('[class*="grid-cols"]') as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("md:grid-cols-[auto_1fr_auto]");
  });

  it("the result-history stepper, Save as scenario, and Run Optimizer stay in the right zone, directly below email/logout — unmoved relative position", () => {
    const solvedScenario = {
      ...scenario,
      result: {
        status: "optimal" as const,
        objective: 1,
        runTimeSec: 0.1,
        quality: "Proven optimal",
        edges: [],
        metrics: {},
        details: {},
        solverUsed: "CBC",
        infeasibilityReason: null,
      },
      stale: false,
    };
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario, scenario2] } as unknown as ReturnType<typeof useListScenarios>);
    renderWorkspace();
    const email = screen.getByTestId("text-user-email");
    const runOptimizer = screen.getByTestId("button-run-optimizer");
    const saveAsScenario = screen.getByTestId("button-save-as-scenario");
    // Both live in the SAME right-hand zone (share a common ancestor closer
    // than the header itself), and the stepper/Run-Optimizer row follows the
    // email/logout row within it — exactly the pre-T9 relative order.
    const rightZone = email.closest('[class*="items-end"]') as HTMLElement;
    expect(rightZone).toContainElement(runOptimizer);
    expect(rightZone).toContainElement(saveAsScenario);
    // eslint-disable-next-line no-bitwise
    expect(email.compareDocumentPosition(runOptimizer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Narrow-viewport behavior — the grid collapses to one column (via
  // Tailwind's `md:` prefix) rather than forcing horizontal overflow; every
  // control stays reachable in the DOM regardless of viewport (jsdom doesn't
  // evaluate media queries, so this asserts the RESPONSIVE CLASSES that
  // drive that collapse are present, matching AppShell.test.tsx's own
  // established narrow-viewport convention for this repo).
  it("at a narrow (375px) viewport, every header control stays reachable and the summary carries truncating classes instead of forcing overflow", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
    window.dispatchEvent(new Event("resize"));
    try {
      renderWorkspace();
      expect(screen.getByTestId("button-page-back")).toBeInTheDocument();
      expect(screen.getByTestId("select-scenario-context")).toBeInTheDocument();
      expect(screen.getByTestId("workspace-chapter-summary")).toBeInTheDocument();
      expect(screen.getByTestId("text-user-email")).toBeInTheDocument();
      expect(screen.getByTestId("button-logout")).toBeInTheDocument();
      expect(screen.getByTestId("button-run-optimizer")).toBeInTheDocument();

      const summary = screen.getByTestId("workspace-chapter-summary");
      expect(summary.className).toContain("truncate");
      expect(summary.className).toContain("min-w-0");

      const grid = screen.getByTestId("select-scenario-context").closest('[class*="grid-cols-1"]') as HTMLElement;
      expect(grid).not.toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: originalWidth });
    }
  });
});

// T9 — C1: AppFooter mounted inside the root scn-theme shell, as the last
// child (after the body region), so it never overlaps the map/tab content.
describe("Workspace — footer (T9, C1)", () => {
  it("mounts AppFooter inside the root workspace-page shell", () => {
    renderWorkspace();
    const root = screen.getByTestId("workspace-page");
    const footer = screen.getByTestId("app-footer");
    expect(root).toContainElement(footer);
  });

  it("the footer follows the body/tab-content region in DOM order and is flex-shrink-0 (reserves its own row, never overlapped)", () => {
    renderWorkspace();
    const bodyRegion = screen.getByTestId("tab-content-region");
    const footer = screen.getByTestId("app-footer");
    // eslint-disable-next-line no-bitwise
    expect(bodyRegion.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer.className).toContain("flex-shrink-0");
  });
});

// T9 — B4: Solution Summary (cost-summary) immediately follows Output Map.
describe("Workspace — output sidebar tab order (T9, B4)", () => {
  it("Solution Summary is the second Outputs sidebar entry, immediately after Output Map", () => {
    renderWorkspace();
    const sidebarOutputIds = Array.from(document.querySelectorAll('[data-testid^="sidebar-output-"]')).map(el =>
      el.getAttribute("data-testid"),
    );
    expect(sidebarOutputIds[0]).toBe("sidebar-output-output-map");
    expect(sidebarOutputIds[1]).toBe("sidebar-output-cost-summary");
  });
});
