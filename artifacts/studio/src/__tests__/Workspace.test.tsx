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
const mockResetToBaseline = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
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
  useResetScenarioToBaseline: vi.fn(() => mockResetToBaseline),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  useListModels: vi.fn(() => ({ data: [{ id: "p-median-us", countryBounds: { sw: [24, -125], ne: [50, -66] } }] })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  useLogoutUser: vi.fn(() => mockLogoutUser),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
}));

import { Workspace } from "@/pages/Workspace";
import { useGetSolveJob, useListScenarios } from "@workspace/api-client-react";

const mockUseGetSolveJob = vi.mocked(useGetSolveJob);
const mockUseListScenarios = vi.mocked(useListScenarios);

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
  mockResetToBaseline.mutate.mockReset();
  mockLogoutUser.mutate.mockReset();
  mockUpdateScenario.isPending = false;
  mockSolveScenario.isPending = false;
  mockCreateScenario.isPending = false;
  mockCloneScenario.isPending = false;
  mockDeleteScenario.isPending = false;
  mockResetToBaseline.isPending = false;
  mockQueryClient.invalidateQueries.mockReset();
  mockQueryClient.setQueryData.mockReset();
  mockUseGetSolveJob.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGetSolveJob>);
  mockUseListScenarios.mockReturnValue({ data: [scenario, scenario2] } as unknown as ReturnType<typeof useListScenarios>);
});

describe("Workspace — Warehouses tab", () => {
  it("opening the Warehouses sidebar entry renders the real WarehouseTable with the scenario's warehouse data, not a placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-warehouses"));
    expect(screen.getByText("CHI")).toBeInTheDocument();
    expect(screen.getByText("Chicago, IL")).toBeInTheDocument();
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
});

describe("Workspace — Customers tab", () => {
  it("opening the Customers sidebar entry renders the real CustomerTable with the scenario's customer data, not a placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    expect(screen.getByText("C1")).toBeInTheDocument();
    expect(screen.getByText("New York, NY")).toBeInTheDocument();
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
  it("does not show a Save toolbar for a tab with nothing wired to save yet", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.queryByTestId("button-save")).not.toBeInTheDocument();
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

describe("Workspace — reset to baseline", () => {
  it("requires an explicit confirm before calling useResetScenarioToBaseline", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-reset-scenario-1"));
    expect(mockResetToBaseline.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-confirm-reset-1"));
    expect(mockResetToBaseline.mutate).toHaveBeenCalledWith({ scenarioId: 1 }, expect.anything());
  });

  it("on success for the ACTIVE scenario, resyncs the local inputs draft from the response (same mechanism as import-apply)", () => {
    const updated = { ...scenario, inputs: { ...pmedianInputs, p: 7 } };
    mockResetToBaseline.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (s: typeof updated) => void }) => {
      opts.onSuccess(updated);
    });
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-reset-scenario-1"));
    fireEvent.click(screen.getByTestId("button-confirm-reset-1"));

    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("text-p-value")).toHaveTextContent("7");
    expect(mockQueryClient.invalidateQueries).toHaveBeenCalled();
  });

  it("resetting a SIBLING scenario's baseline does not clobber the active scenario's local input draft", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    fireEvent.click(screen.getByTestId("button-p-quick-10"));
    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();

    const updatedSibling = { ...scenario2, inputs: { ...pmedianInputs, p: 99 } };
    mockResetToBaseline.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (s: typeof updatedSibling) => void }) => {
      opts.onSuccess(updatedSibling);
    });

    fireEvent.click(screen.getByTestId("button-reset-scenario-2"));
    fireEvent.click(screen.getByTestId("button-confirm-reset-2"));

    // active scenario (id=1)'s dirty p=10 edit is untouched by scenario 2's reset
    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
    expect(screen.getByTestId("text-p-value")).toHaveTextContent("10");
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
