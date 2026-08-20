import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mock toast ────────────────────────────────────────────────────────────────
const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: mockToast }));

// ── Mock wouter ───────────────────────────────────────────────────────────────
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-3", vi.fn()],
}));

// ── Mock React Query ──────────────────────────────────────────────────────────
const mockQueryClient = { invalidateQueries: vi.fn() };
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

// ── Mock the generated API client hooks (mock at the generated-hooks level,
// per this repo's established convention — see Studio.test.tsx) ─────────────
const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockSolveScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(() => ({ data: [scenario] })),
  useGetScenario: vi.fn(() => ({ data: scenario })),
  useGetDataset: vi.fn(() => ({ data: dataset })),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
}));

import { Workspace } from "@/pages/Workspace";
import { useGetSolveJob } from "@workspace/api-client-react";

const mockUseGetSolveJob = vi.mocked(useGetSolveJob);

function renderWorkspace() {
  return render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.isPending = false;
  mockSolveScenario.isPending = false;
  mockQueryClient.invalidateQueries.mockReset();
  mockUseGetSolveJob.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGetSolveJob>);
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
