import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(() => ({ data: [scenario] })),
  useGetScenario: vi.fn(() => ({ data: scenario })),
  useGetDataset: vi.fn(() => ({ data: dataset })),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
}));

import { Workspace } from "@/pages/Workspace";

function renderWorkspace() {
  return render(<Workspace modelId="p-median-us" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.isPending = false;
  mockQueryClient.invalidateQueries.mockReset();
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
