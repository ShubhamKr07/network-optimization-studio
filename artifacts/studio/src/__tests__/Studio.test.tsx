import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Hoist stable mocks before vi.mock hoisting ────────────────────────────────
const { mockNavigate, mockToast } = vi.hoisted(() => ({ mockNavigate: vi.fn(), mockToast: vi.fn() }));

// ── Mock wouter ───────────────────────────────────────────────────────────────
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/", mockNavigate],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

// ── Mock toast ────────────────────────────────────────────────────────────────
vi.mock("@/hooks/use-toast", () => ({ toast: mockToast }));

// ── Mock React Query ──────────────────────────────────────────────────────────
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

// ── Mock NetworkMap & ObjectiveBar (heavy deps) ───────────────────────────────
vi.mock("@/components/NetworkMap", () => ({
  NetworkMap: (props: { countryBounds?: { sw: number[]; ne: number[] } }) => (
    <div data-testid="network-map" data-country-bounds={props.countryBounds ? JSON.stringify(props.countryBounds) : ""} />
  ),
}));
vi.mock("@/components/ObjectiveBar", () => ({
  ObjectiveBar: () => <div data-testid="objective-bar" />,
}));
vi.mock("@/components/BrazilMap", () => ({
  BrazilMap: () => <div data-testid="brazil-map" />,
}));

// ── Shared scenario fixtures ──────────────────────────────────────────────────
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

const pmedianScenario = {
  id: 1,
  name: "3 Warehouses",
  modelId: "p-median-us",
  inputs: pmedianInputs,
  result: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const transportInputs = {
  distanceBands: [500, 1000, 1500, 2000],
  gap: 0,
  timeLimitSec: 120,
  capacityFactor: 1.0,
  singleSource: false,
  capacityInactive: false,
};

const transportScenario = {
  id: 8,
  name: "Coal Base Case",
  modelId: "transport-coal",
  inputs: transportInputs,
  result: null,
  createdAt: "2026-01-02T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
};

const dataset = {
  warehouses: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }],
  customers: [{ id: "C1", lat: 40.71, lng: -74.00, demand: 100 }],
};

// ── Mock API client hooks ─────────────────────────────────────────────────────
const mockUpdateScenario = { mutateAsync: vi.fn(), mutate: vi.fn() };
const mockSolveScenario = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };
const mockCloneScenario = { mutateAsync: vi.fn(), mutate: vi.fn() };
const mockCreateScenario = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };
const mockDeleteScenario = { mutateAsync: vi.fn(), mutate: vi.fn() };
const mockResetToBaseline = { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false };

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(),
  useGetDataset: vi.fn(),
  useListModels: vi.fn(() => ({ data: [] })),
  useGetScenario: vi.fn(),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  useCloneScenario: vi.fn(() => mockCloneScenario),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useDeleteScenario: vi.fn(() => mockDeleteScenario),
  useResetScenarioToBaseline: vi.fn(() => mockResetToBaseline),
  exportScenario: vi.fn(),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
}));

import { useSearch } from "wouter";
import { useListScenarios, useGetDataset, useGetScenario, useGetSolveJob, useListModels } from "@workspace/api-client-react";
import { Studio } from "@/pages/Studio";

const mockUseListScenarios = vi.mocked(useListScenarios);
const mockUseGetDataset = vi.mocked(useGetDataset);
const mockUseListModels = vi.mocked(useListModels);
const mockUseGetScenario = vi.mocked(useGetScenario);
const mockUseSearch = vi.mocked(useSearch);
const mockUseGetSolveJob = vi.mocked(useGetSolveJob);

function renderStudio(modelId: "p-median-us" | "transport-coal" | "p-median-brazil" = "p-median-us") {
  return render(<Studio modelId={modelId} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNavigate.mockReset();
  mockUseGetDataset.mockReturnValue({ data: dataset, isLoading: false } as ReturnType<typeof useGetDataset>);
  mockUseSearch.mockReturnValue("?scenario=1");
  mockUseGetSolveJob.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGetSolveJob>);
});

// ── P-Median rendering ────────────────────────────────────────────────────────

describe("Studio — P-Median scenario", () => {
  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [pmedianScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: pmedianScenario } as ReturnType<typeof useGetScenario>);
  });

  it("renders without crashing", () => {
    renderStudio();
    expect(screen.getAllByText("3 Warehouses").length).toBeGreaterThan(0);
  });

  it("shows P-Median header subtitle", () => {
    renderStudio();
    const subtitles = screen.getAllByText(/p-median/i);
    expect(subtitles.length).toBeGreaterThan(0);
  });

  it("shows Overrides section with Warehouses/Customers buttons in configure panel", () => {
    renderStudio();
    expect(screen.getByTestId("button-open-warehouse-table")).toBeInTheDocument();
    expect(screen.getByTestId("button-open-customer-table")).toBeInTheDocument();
  });

  it("does NOT show Mine capacity factor for p-median-us", () => {
    renderStudio();
    expect(screen.queryByText("Mine capacity factor")).not.toBeInTheDocument();
  });

  it("does NOT show Single-source toggle for p-median-us", () => {
    renderStudio();
    expect(screen.queryByText("Single-source")).not.toBeInTheDocument();
  });

  it("shows P-Value control", () => {
    renderStudio();
    expect(screen.getByText("Warehouses to open (P)")).toBeInTheDocument();
  });

  it("shows p-value as 3", () => {
    renderStudio();
    expect(screen.getByTestId("text-p-value")).toHaveTextContent("3");
  });
});

// ── Transport scenario rendering (configure tab) ──────────────────────────────

describe("Studio — Transport scenario (configure)", () => {
  beforeEach(() => {
    mockUseSearch.mockReturnValue("?scenario=8");
    mockUseListScenarios.mockReturnValue({ data: [transportScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportScenario } as ReturnType<typeof useGetScenario>);
  });

  it("renders the transport scenario name", () => {
    renderStudio("transport-coal");
    expect(screen.getAllByText("Coal Base Case").length).toBeGreaterThan(0);
  });

  it("shows transport header subtitle", () => {
    renderStudio("transport-coal");
    expect(screen.getByText(/Ch 5/i)).toBeInTheDocument();
    expect(screen.getByText(/coal mines/i)).toBeInTheDocument();
  });

  it("shows Mine capacity factor slider", () => {
    renderStudio("transport-coal");
    expect(screen.getByText("Mine capacity factor")).toBeInTheDocument();
  });

  it("shows Single-source toggle", () => {
    renderStudio("transport-coal");
    expect(screen.getByText("Single-source")).toBeInTheDocument();
  });

  it("shows Ignore capacity toggle", () => {
    renderStudio("transport-coal");
    expect(screen.getByText("Ignore capacity")).toBeInTheDocument();
  });

  it("does NOT show Overrides section for transport", () => {
    renderStudio("transport-coal");
    expect(screen.queryByTestId("button-open-warehouse-table")).not.toBeInTheDocument();
  });

  it("does NOT show Number of warehouses (P-value) for transport", () => {
    renderStudio("transport-coal");
    expect(screen.queryByText(/Number of warehouses/i)).not.toBeInTheDocument();
  });

  it("shows transport constraints in constraints panel", () => {
    renderStudio("transport-coal");
    expect(screen.getByText(/C1 Meet all station demand/)).toBeInTheDocument();
    expect(screen.getByText(/C2 Mine capacity limits/)).toBeInTheDocument();
  });
});

// ── Transport scenario results ─────────────────────────────────────────────────

describe("Studio — Transport scenario (output tab)", () => {
  const transportSolvedScenario = {
    ...transportScenario,
    result: {
      status: "optimal",
      objective: 50840650000,
      runTimeSec: 0.3,
      quality: "Optimal",
      edges: [
        { fromId: "PRB", toId: "STN1", flow: 7000000, distance: 1071, band: 2 },
        { fromId: "ILL", toId: "STN2", flow: 3500000, distance: 400, band: 0 },
      ],
      metrics: { weightedAvgDistance: 696.4, bandCoverage: [], utilizationByNode: [] },
      details: {
        openWarehouseIds: [],
        assignments: [
          { customerId: "STN1", warehouseId: "PRB", distanceMi: 1071, band: 2, flowTons: 7000000, flowFraction: 1.0 },
          { customerId: "STN2", warehouseId: "ILL", distanceMi: 400, band: 0, flowTons: 3500000, flowFraction: 0.5 },
        ],
      },
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: null,
    },
  };

  beforeEach(() => {
    mockUseSearch.mockReturnValue("?scenario=8");
    mockUseListScenarios.mockReturnValue({ data: [transportSolvedScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportSolvedScenario } as ReturnType<typeof useGetScenario>);
  });

  it("shows flow table header on output tab", async () => {
    renderStudio("transport-coal");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByText(/Flow assignments/i)).toBeInTheDocument();
  });

  it("renders mine → station flow rows", async () => {
    renderStudio("transport-coal");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByText(/PRB.*STN1/)).toBeInTheDocument();
  });

  it("shows weighted avg distance in summary", async () => {
    renderStudio("transport-coal");
    await userEvent.click(screen.getByText("Output"));
    const distanceEl = screen.getByTestId("result-weighted-avg-distance");
    expect(distanceEl).toHaveTextContent("696.4");
    expect(distanceEl).toHaveTextContent("miles");
  });

  it("does NOT show warehouse utilization bars for transport", async () => {
    renderStudio("transport-coal");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.queryByText("Open warehouses · utilization")).not.toBeInTheDocument();
  });

  it("does NOT show band coverage for transport", async () => {
    renderStudio("transport-coal");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.queryByText("Demand served within band")).not.toBeInTheDocument();
  });
});

// ── Studio header labels by active lab ─────────────────────────────────────────

describe("Studio — Header lab name by active lab", () => {
  it("shows Al's Athletics · Model Lab when active lab is 1 (p-median-us)", () => {
    mockUseListScenarios.mockReturnValue({ data: [pmedianScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: pmedianScenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    expect(screen.getByText(/Al's Athletics · Model Lab/)).toBeInTheDocument();
  });

  it("shows Coal Transport LP · Model Lab when active lab is 2 (transport-coal)", () => {
    mockUseSearch.mockReturnValue("?scenario=8");
    mockUseListScenarios.mockReturnValue({ data: [transportScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportScenario } as ReturnType<typeof useGetScenario>);
    renderStudio("transport-coal");
    expect(screen.getByText(/Coal Transport LP · Model Lab/)).toBeInTheDocument();
  });
});

// ── Lab-based auto-redirect ─────────────────────────────────────────────────
// The chapter route (App.tsx) now supplies modelId as a real prop, so
// these can test "redirect to the scenario matching the active lab" properly.

describe("Studio — Lab-based scenario redirect", () => {
  const pmedianWith5 = { ...pmedianScenario, id: 5 };
  const transportWith8 = { ...transportScenario, id: 8 };
  const multiScenarios = [pmedianWith5, transportWith8];

  beforeEach(() => {
    mockUseSearch.mockReturnValue("");
    mockUseGetScenario.mockReturnValue({ data: undefined } as ReturnType<typeof useGetScenario>);
  });

  it("redirects to first p-median scenario when lab is p-median-us and URL has no scenario", () => {
    mockUseListScenarios.mockReturnValue({ data: multiScenarios, isLoading: false } as ReturnType<typeof useListScenarios>);
    renderStudio("p-median-us");
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=5", { replace: true });
  });

  it("redirects to first transport scenario when lab is transport-coal and URL has no scenario", () => {
    mockUseListScenarios.mockReturnValue({ data: multiScenarios, isLoading: false } as ReturnType<typeof useListScenarios>);
    renderStudio("transport-coal");
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=8", { replace: true });
  });

  it("does NOT redirect when no scenario matches the active lab (stays at current URL)", () => {
    // Only p-median-us available, but the active lab is transport-coal → no matching scenario → no navigate
    mockUseListScenarios.mockReturnValue({ data: [pmedianWith5], isLoading: false } as ReturnType<typeof useListScenarios>);
    renderStudio("transport-coal");
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining("/?scenario="), expect.anything());
  });

  it("does NOT redirect when a valid ?scenario= matching the active lab is already in the URL", () => {
    mockUseSearch.mockReturnValue("?scenario=5");
    mockUseGetScenario.mockReturnValue({ data: pmedianWith5 } as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: multiScenarios, isLoading: false } as ReturnType<typeof useListScenarios>);
    renderStudio("p-median-us");
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ── Brazil scenario fixture ────────────────────────────────────────────────
const brazilInputs = {
  p: 5,
  distanceBands: [500, 1000, 2000, 4000],
  capacityMode: "uniform",
  uniformCapacity: 20000000,
  warehouseOverrides: [],
  customerOverrides: [],
  gap: 0,
  timeLimitSec: 120,
  singleSource: true,
};

const brazilScenario = {
  id: 10,
  name: "Brazil Base — 20M cap",
  modelId: "p-median-brazil",
  inputs: brazilInputs,
  result: null,
  createdAt: "2026-01-03T00:00:00Z",
  updatedAt: "2026-01-03T00:00:00Z",
};

// ── Brazil Studio — configure rendering ───────────────────────────────────
describe("Studio — Brazil Capacity scenario (configure tab, active lab=3)", () => {
  beforeEach(() => {
    mockUseSearch.mockReturnValue("?scenario=10");
    mockUseListScenarios.mockReturnValue({ data: [brazilScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: brazilScenario } as ReturnType<typeof useGetScenario>);
  });

  it("shows Brazil Capacity · Model Lab header when active lab is 3", () => {
    renderStudio("p-median-brazil");
    expect(screen.getByText(/Brazil Capacity · Model Lab/)).toBeInTheDocument();
  });

  it("shows Brazil subtitle in header (Ch 5 · capacitated p-median)", () => {
    renderStudio("p-median-brazil");
    expect(screen.getByText(/Ch 5.*capacitated p-median.*Brazil/i)).toBeInTheDocument();
  });

  it("renders BrazilMap component instead of NetworkMap for Brazil scenario", () => {
    renderStudio("p-median-brazil");
    expect(screen.getByTestId("brazil-map")).toBeInTheDocument();
    expect(screen.queryByTestId("network-map")).not.toBeInTheDocument();
  });

  it("shows Single-source toggle in configure panel for Brazil", () => {
    renderStudio("p-median-brazil");
    expect(screen.getByText("Single-source")).toBeInTheDocument();
  });

  it("shows São Paulo capacity hint in configure panel when singleSource=true", () => {
    renderStudio("p-median-brazil");
    expect(screen.getByText(/São Paulo/i)).toBeInTheDocument();
  });

  it("shows Warehouses to open (P) control", () => {
    renderStudio("p-median-brazil");
    expect(screen.getByText("Warehouses to open (P)")).toBeInTheDocument();
  });

  it("does NOT show Overrides section for Brazil", () => {
    renderStudio("p-median-brazil");
    expect(screen.queryByTestId("button-open-warehouse-table")).not.toBeInTheDocument();
  });

  it("does NOT show Mine capacity factor for Brazil", () => {
    renderStudio("p-median-brazil");
    expect(screen.queryByText("Mine capacity factor")).not.toBeInTheDocument();
  });

  it("does NOT show Ignore capacity toggle for Brazil", () => {
    renderStudio("p-median-brazil");
    expect(screen.queryByText("Ignore capacity")).not.toBeInTheDocument();
  });
});

// ── Brazil Studio — header lab name ───────────────────────────────────────
describe("Studio — Header lab name by active lab (all three labs)", () => {
  it("shows Brazil Capacity · Model Lab when active lab is 3", () => {
    mockUseSearch.mockReturnValue("?scenario=10");
    mockUseListScenarios.mockReturnValue({ data: [brazilScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: brazilScenario } as ReturnType<typeof useGetScenario>);
    renderStudio("p-median-brazil");
    expect(screen.getByText(/Brazil Capacity · Model Lab/)).toBeInTheDocument();
  });
});

// ── Brazil Studio — infeasibility output ──────────────────────────────────
describe("Studio — Brazil infeasibility output banner", () => {
  const brazilInfeasibleScenario = {
    ...brazilScenario,
    result: {
      status: "infeasible",
      objective: 0,
      runTimeSec: 0.1,
      quality: "Infeasible",
      edges: [],
      metrics: { weightedAvgDistance: 0, bandCoverage: [], utilizationByNode: [] },
      details: { openWarehouseIds: [], assignments: [] },
      solverUsed: "CBC (PuLP)",
      infeasibilityReason:
        "Demand region São Paulo (29,029,226) exceeds single-warehouse capacity (20,000,000). Relax single-sourcing to split demand across warehouses.",
    },
  };

  beforeEach(() => {
    mockUseSearch.mockReturnValue("?scenario=10");
    mockUseListScenarios.mockReturnValue({ data: [brazilInfeasibleScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: brazilInfeasibleScenario } as ReturnType<typeof useGetScenario>);
  });

  it("shows Infeasible status badge on output tab", async () => {
    renderStudio("p-median-brazil");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByText("Infeasible")).toBeInTheDocument();
  });

  it("shows infeasibility reason mentioning São Paulo on output tab", async () => {
    renderStudio("p-median-brazil");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getAllByText(/São Paulo/).length).toBeGreaterThan(0);
  });

  it("shows Relax single-sourcing hint in infeasibility reason", async () => {
    renderStudio("p-median-brazil");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByText(/Relax single-sourcing/i)).toBeInTheDocument();
  });
});

// ── New button sends correct modelId + inputs per lab ──────────────────────
describe("Studio — New button sends correct modelId", () => {
  async function clickNew() {
    // "New" button in the header toolbar
    await userEvent.click(screen.getByTestId("button-create-scenario"));
    // fill the name in the dialog
    const input = screen.getByTestId("input-new-scenario-name");
    await userEvent.clear(input);
    await userEvent.type(input, "My New Scenario");
    // click the Create confirm button
    await userEvent.click(screen.getByTestId("button-create-confirm"));
  }

  it("sends modelId p-median-us when active scenario is p-median-us (lab 1)", async () => {
    mockUseListScenarios.mockReturnValue({ data: [pmedianScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: pmedianScenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    await clickNew();
    expect(mockCreateScenario.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ modelId: "p-median-us", inputs: expect.objectContaining({ p: 3 }) }),
      }),
      expect.anything()
    );
  });

  it("sends modelId transport-coal when active scenario is transport-coal (lab 2)", async () => {
    mockUseSearch.mockReturnValue("?scenario=8");
    mockUseListScenarios.mockReturnValue({ data: [transportScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportScenario } as ReturnType<typeof useGetScenario>);
    renderStudio("transport-coal");
    await clickNew();
    expect(mockCreateScenario.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ modelId: "transport-coal" }),
      }),
      expect.anything()
    );
  });

  it("sends modelId p-median-brazil when active scenario is Brazil (lab 3)", async () => {
    mockUseSearch.mockReturnValue("?scenario=10");
    mockUseListScenarios.mockReturnValue({ data: [brazilScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: brazilScenario } as ReturnType<typeof useGetScenario>);
    renderStudio("p-median-brazil");
    await clickNew();
    expect(mockCreateScenario.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ modelId: "p-median-brazil", inputs: expect.objectContaining({ p: 7 }) }),
      }),
      expect.anything()
    );
  });
});

// ── Reset to baseline (D6.1) ────────────────────────────────────────────────
describe("Studio — Reset to baseline", () => {
  const dirtyScenario = {
    ...pmedianScenario,
    inputs: {
      ...pmedianInputs,
      warehouseOverrides: [{ id: "CHI", status: "forced_open" }],
      customerOverrides: [{ id: "C1", status: "excluded" }],
    },
  };

  it("is disabled when there are no overrides", () => {
    mockUseListScenarios.mockReturnValue({ data: [pmedianScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: pmedianScenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    expect(screen.getByTestId("button-reset-baseline")).toBeDisabled();
  });

  it("is enabled and opens a confirm dialog when overrides exist", async () => {
    mockUseListScenarios.mockReturnValue({ data: [dirtyScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: dirtyScenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    expect(screen.getByTestId("button-reset-baseline")).not.toBeDisabled();
    await userEvent.click(screen.getByTestId("button-reset-baseline"));
    expect(screen.getByText("Reset to baseline?")).toBeInTheDocument();
    expect(mockResetToBaseline.mutate).not.toHaveBeenCalled();
  });

  it("cancel closes the dialog without calling the mutation", async () => {
    mockUseListScenarios.mockReturnValue({ data: [dirtyScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: dirtyScenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    await userEvent.click(screen.getByTestId("button-reset-baseline"));
    await userEvent.click(screen.getByTestId("button-reset-cancel"));
    expect(mockResetToBaseline.mutate).not.toHaveBeenCalled();
    expect(screen.queryByText("Reset to baseline?")).not.toBeInTheDocument();
  });

  it("confirm calls the reset mutation with the current scenario id", async () => {
    mockUseListScenarios.mockReturnValue({ data: [dirtyScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: dirtyScenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    await userEvent.click(screen.getByTestId("button-reset-baseline"));
    await userEvent.click(screen.getByTestId("button-reset-confirm"));
    expect(mockResetToBaseline.mutate).toHaveBeenCalledWith(
      { scenarioId: dirtyScenario.id },
      expect.anything()
    );
  });
});

// ── Stale badge (X1.1) ───────────────────────────────────────────────────────
describe("Studio — Stale badge", () => {
  const solvedResult = {
    status: "optimal",
    objective: 1,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [],
    metrics: { weightedAvgDistance: 100, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["CHI"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("shows a Stale badge on the output tab when the scenario is stale", async () => {
    const staleScenario = { ...pmedianScenario, result: solvedResult, stale: true };
    mockUseListScenarios.mockReturnValue({ data: [staleScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: staleScenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByTestId("badge-stale")).toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent(/Stale/);
  });

  it("does NOT show a Stale badge when the scenario is not stale", async () => {
    const freshScenario = { ...pmedianScenario, result: solvedResult, stale: false };
    mockUseListScenarios.mockReturnValue({ data: [freshScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: freshScenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    await userEvent.click(screen.getByText("Output"));
    expect(screen.queryByTestId("badge-stale")).not.toBeInTheDocument();
    expect(screen.getByTestId("status-badge")).toHaveTextContent(/Solved/);
  });
});

// ── Async solve (G3.1) ───────────────────────────────────────────────────────
describe("Studio — Async solve", () => {
  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [pmedianScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: pmedianScenario } as ReturnType<typeof useGetScenario>);
  });

  it("clicking Solve enqueues a job and starts polling with the returned jobId", async () => {
    mockSolveScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (r: { jobId: number }) => void }) => {
      opts.onSuccess({ jobId: 7 });
    });
    renderStudio();

    await userEvent.click(screen.getByTestId("button-solve"));

    expect(mockSolveScenario.mutate).toHaveBeenCalledWith({ scenarioId: 1 }, expect.anything());
    const lastCall = mockUseGetSolveJob.mock.calls[mockUseGetSolveJob.mock.calls.length - 1];
    expect(lastCall[1]).toBe(7);
  });

  it("switches to the output tab once the polled job succeeds", async () => {
    mockSolveScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (r: { jobId: number }) => void }) => {
      opts.onSuccess({ jobId: 7 });
    });
    mockUseGetSolveJob.mockImplementation((_scenarioId: number, jobId: number) =>
      (jobId
        ? { data: { id: 7, status: "succeeded", error: null, resultSummary: null } }
        : { data: undefined }) as unknown as ReturnType<typeof useGetSolveJob>
    );
    renderStudio();

    await userEvent.click(screen.getByTestId("button-solve"));

    expect(await screen.findByTestId("button-tab-output")).toHaveClass("bg-primary");
  });

  it("shows a failure toast and stops solving when the polled job fails", async () => {
    mockSolveScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (r: { jobId: number }) => void }) => {
      opts.onSuccess({ jobId: 7 });
    });
    mockUseGetSolveJob.mockImplementation((_scenarioId: number, jobId: number) =>
      (jobId
        ? { data: { id: 7, status: "failed", error: "Solver timed out", resultSummary: null } }
        : { data: undefined }) as unknown as ReturnType<typeof useGetSolveJob>
    );
    renderStudio();

    await userEvent.click(screen.getByTestId("button-solve"));

    await vi.waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Solve failed",
      description: "Solver timed out",
    })));
    expect(screen.getByTestId("button-solve")).not.toHaveTextContent("Solving...");
  });
});

// ── Quality statement (E3.1) ─────────────────────────────────────────────────
describe("Studio — Quality statement", () => {
  const solvedResult = {
    status: "optimal",
    objective: 1,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [],
    metrics: { weightedAvgDistance: 100, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["CHI"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("shows 'Proven optimal' when the solved scenario's gap is 0", async () => {
    const scenario = { ...pmedianScenario, result: solvedResult, inputs: { ...pmedianInputs, gap: 0 } };
    mockUseListScenarios.mockReturnValue({ data: [scenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByTestId("text-quality-statement")).toHaveTextContent("Proven optimal");
  });

  it("shows the configured-gap statement when the solved scenario's gap is > 0", async () => {
    const scenario = { ...pmedianScenario, result: solvedResult, inputs: { ...pmedianInputs, gap: 0.05 } };
    mockUseListScenarios.mockReturnValue({ data: [scenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByTestId("text-quality-statement")).toHaveTextContent("Within configured gap 5%, limit reached");
  });
});

// ── Client-side distance bands (E1.1) ───────────────────────────────────────
describe("Studio — Client-side distance bands", () => {
  const solvedResult = {
    status: "optimal",
    objective: 1,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [
      { fromId: "CHI", toId: "C1", flow: 50, distance: 150, band: 0 },
      { fromId: "CHI", toId: "C2", flow: 50, distance: 900, band: 3 },
    ],
    metrics: { weightedAvgDistance: 100, bandCoverage: [{ band: 200, percent: 50 }, { band: 400, percent: 50 }, { band: 800, percent: 50 }, { band: 1600, percent: 100 }], utilizationByNode: [] },
    details: { openWarehouseIds: ["CHI"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  beforeEach(() => {
    const scenario = { ...pmedianScenario, result: solvedResult };
    mockUseListScenarios.mockReturnValue({ data: [scenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as ReturnType<typeof useGetScenario>);
  });

  it("moves the band editor to the results panel (output tab), not the left config panel", async () => {
    renderStudio();
    // A previously-solved scenario opens straight on the Output tab.
    expect(screen.getByTestId("button-add-band")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Input"));
    expect(screen.queryByTestId("button-add-band")).not.toBeInTheDocument();
  });

  it("adding a band recomputes coverage instantly with zero network calls", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    renderStudio();
    await userEvent.click(screen.getByText("Output"));

    // Baseline bands are [200,400,800,1600] (pmedianInputs); the 800mi band
    // only covers the 150mi edge (50% of flow) since 900 > 800.
    expect(screen.getByTestId("result-band-800")).toHaveTextContent("50%");

    await userEvent.click(screen.getByTestId("button-add-band"));
    await userEvent.type(screen.getByTestId("input-new-band"), "1000");
    await userEvent.click(screen.getByTestId("button-add-band-confirm"));

    // New band boundary (not present in the server's stale metrics.bandCoverage
    // at all) shows up with correctly recomputed coverage — the 900mi edge is
    // now included (900<=1000), proving this is live client-side computation.
    expect(screen.getByTestId("result-band-1000")).toHaveTextContent("100%");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockUpdateScenario.mutate).not.toHaveBeenCalled();
    expect(mockSolveScenario.mutate).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// ── Auto-show routes on solve success (E4.1) ────────────────────────────────
describe("Studio — Auto-show routes", () => {
  it("turns the Show routes switch on once a solve succeeds", async () => {
    const solvedResult = {
      status: "optimal", objective: 1, runTimeSec: 0.1, quality: "Optimal",
      edges: [{ fromId: "CHI", toId: "C1", flow: 50, distance: 150, band: 0 }],
      metrics: { weightedAvgDistance: 100, bandCoverage: [], utilizationByNode: [] },
      details: { openWarehouseIds: ["CHI"], assignments: [] },
      solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    };
    // Scenario already carries a result — simulates the state after
    // invalidateQueries refetches post-solve (mocked as a no-op here).
    const scenario = { ...pmedianScenario, result: solvedResult };
    mockUseListScenarios.mockReturnValue({ data: [scenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as ReturnType<typeof useGetScenario>);
    mockSolveScenario.mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (r: { jobId: number }) => void }) => {
      opts.onSuccess({ jobId: 7 });
    });
    mockUseGetSolveJob.mockImplementation((_scenarioId: number, jobId: number) =>
      (jobId
        ? { data: { id: 7, status: "succeeded", error: null, resultSummary: null } }
        : { data: undefined }) as unknown as ReturnType<typeof useGetSolveJob>
    );
    renderStudio();

    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByTestId("switch-show-routes")).toHaveAttribute("data-state", "unchecked");

    await userEvent.click(screen.getByTestId("button-solve"));

    await vi.waitFor(() => expect(screen.getByTestId("switch-show-routes")).toHaveAttribute("data-state", "checked"));
  });
});

// ── Map bounds per model (E5.1) ──────────────────────────────────────────────
describe("Studio — Map bounds per model", () => {
  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [pmedianScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: pmedianScenario } as ReturnType<typeof useGetScenario>);
  });

  it("passes the active model's manifest countryBounds through to NetworkMap", () => {
    mockUseListModels.mockReturnValue({
      data: [
        { id: "p-median-us", name: "Al's Athletics", chapter: "Chapter 3", countryBounds: { sw: [25.78, -123.11], ne: [47.67, -71.02] }, capabilities: { supportsP: true, capacityModes: [], demandEditable: true }, inputsSchema: {} },
      ],
    } as ReturnType<typeof useListModels>);
    renderStudio();
    expect(screen.getByTestId("network-map")).toHaveAttribute(
      "data-country-bounds",
      JSON.stringify({ sw: [25.78, -123.11], ne: [47.67, -71.02] }),
    );
  });

  it("renders with no countryBounds attribute when models haven't loaded yet", () => {
    mockUseListModels.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useListModels>);
    renderStudio();
    expect(screen.getByTestId("network-map")).toHaveAttribute("data-country-bounds", "");
  });
});

// ── Constraint chip bar (E2.1) ───────────────────────────────────────────────
describe("Studio — Constraint chip bar", () => {
  it("reflects p, capacity, and override counts from scenario state", () => {
    const scenario = {
      ...pmedianScenario,
      inputs: {
        ...pmedianInputs,
        p: 5,
        capacityMode: "uniform",
        uniformCapacity: 10_000_000,
        warehouseOverrides: [{ id: "CHI", status: "forced_open" }, { id: "LA", status: "inactive" }],
        customerOverrides: [{ id: "C1", status: "excluded" }, { id: "C2", demand: 999, status: "active" }],
      },
    };
    mockUseListScenarios.mockReturnValue({ data: [scenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as ReturnType<typeof useGetScenario>);
    renderStudio();

    expect(screen.getByTestId("chip-p")).toHaveTextContent("p = 5");
    expect(screen.getByTestId("chip-capacity")).toHaveTextContent("Capacity: uniform 10M");
    expect(screen.getByTestId("chip-forced-open")).toHaveTextContent("1 forced open");
    expect(screen.getByTestId("chip-inactive")).toHaveTextContent("1 inactive");
    expect(screen.getByTestId("chip-excluded")).toHaveTextContent("1 customers excluded");
    expect(screen.getByTestId("chip-demand-edited")).toHaveTextContent("demand edited (1)");
  });

  it("clicking the forced-open chip opens the Warehouses table dialog", async () => {
    const scenario = {
      ...pmedianScenario,
      inputs: { ...pmedianInputs, warehouseOverrides: [{ id: "CHI", status: "forced_open" }] },
    };
    mockUseListScenarios.mockReturnValue({ data: [scenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: scenario } as ReturnType<typeof useGetScenario>);
    renderStudio();

    expect(screen.getAllByText("Warehouses")).toHaveLength(1);
    await userEvent.click(screen.getByTestId("chip-forced-open"));
    // The dialog's own "Warehouses" title is now present alongside the button.
    expect(screen.getAllByText("Warehouses").length).toBeGreaterThan(1);
  });

  it("does not render the chip bar for transport-coal scenarios", () => {
    mockUseSearch.mockReturnValue("?scenario=8");
    mockUseListScenarios.mockReturnValue({ data: [transportScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportScenario } as ReturnType<typeof useGetScenario>);
    renderStudio("transport-coal");
    expect(screen.queryByTestId("constraint-chips")).not.toBeInTheDocument();
  });
});

// ── Create-scenario dialog reachable when scenarios list is empty ──────────
describe("Studio — empty scenarios", () => {
  it("opens the create-scenario dialog after clicking 'Create first scenario'", async () => {
    // Zero scenarios → the Studio early-returns from the "No scenarios yet."
    // branch, which previously did not mount the Dialog at all.
    mockUseListScenarios.mockReturnValue({ data: [], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: undefined } as ReturnType<typeof useGetScenario>);
    renderStudio();

    await userEvent.click(screen.getByTestId("button-create-scenario"));

    // The dialog must actually open now that it is mounted in this branch.
    expect(await screen.findByTestId("input-new-scenario-name")).toBeInTheDocument();
    expect(screen.getByText("New scenario")).toBeInTheDocument();
  });
});
