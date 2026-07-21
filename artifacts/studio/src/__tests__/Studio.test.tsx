import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Hoist stable mocks before vi.mock hoisting ────────────────────────────────
const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

// ── Mock wouter ───────────────────────────────────────────────────────────────
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/", mockNavigate],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

// ── Mock React Query ──────────────────────────────────────────────────────────
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

// ── Mock NetworkMap & ObjectiveBar (heavy deps) ───────────────────────────────
vi.mock("@/components/NetworkMap", () => ({
  NetworkMap: () => <div data-testid="network-map" />,
}));
vi.mock("@/components/ObjectiveBar", () => ({
  ObjectiveBar: () => <div data-testid="objective-bar" />,
}));
vi.mock("@/components/BrazilMap", () => ({
  BrazilMap: () => <div data-testid="brazil-map" />,
}));

// ── Shared scenario fixtures ──────────────────────────────────────────────────
const pmedianScenario = {
  id: 1,
  name: "3 Warehouses",
  problemType: "p_median",
  pValue: 3,
  distanceBands: [200, 400, 800, 1600],
  solver: "cbc",
  gap: 0,
  timeLimitSec: 120,
  capacityMode: "uniform",
  uniformCapacity: null,
  warehouseStatuses: [],
  capacityFactor: 1.0,
  singleSource: false,
  capacityInactive: false,
  result: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const transportScenario = {
  ...pmedianScenario,
  id: 8,
  name: "Coal Base Case",
  problemType: "transport",
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

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(),
  useGetDataset: vi.fn(),
  useGetScenario: vi.fn(),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => mockSolveScenario),
  useCloneScenario: vi.fn(() => mockCloneScenario),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useDeleteScenario: vi.fn(() => mockDeleteScenario),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
}));

import { useSearch } from "wouter";
import { useListScenarios, useGetDataset, useGetScenario } from "@workspace/api-client-react";
import { Studio } from "@/pages/Studio";

const mockUseListScenarios = vi.mocked(useListScenarios);
const mockUseGetDataset = vi.mocked(useGetDataset);
const mockUseGetScenario = vi.mocked(useGetScenario);
const mockUseSearch = vi.mocked(useSearch);

function renderStudio(problemType: "p_median" | "transport" | "capacitated_pmedian" = "p_median") {
  return render(<Studio problemType={problemType} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNavigate.mockReset();
  mockUseGetDataset.mockReturnValue({ data: dataset, isLoading: false } as ReturnType<typeof useGetDataset>);
  mockUseSearch.mockReturnValue("?scenario=1");
});

// ── P-Median rendering ────────────────────────────────────────────────────────

describe("Studio — P-Median scenario", () => {
  beforeEach(() => {
    // activeModelIndex=1 → activeModelType=p_median → labScenarios filtered to p_median
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

  it("shows Warehouse status section in configure panel", () => {
    renderStudio();
    expect(screen.getByText("Warehouse status")).toBeInTheDocument();
  });

  it("does NOT show Mine capacity factor for p_median", () => {
    renderStudio();
    expect(screen.queryByText("Mine capacity factor")).not.toBeInTheDocument();
  });

  it("does NOT show Single-source toggle for p_median", () => {
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
    // activeModelIndex=2 → activeModelType=transport → labScenarios filtered to transport
    // useSearch returns "?scenario=8" to match the transport scenario ID directly
    mockUseSearch.mockReturnValue("?scenario=8");
    mockUseListScenarios.mockReturnValue({ data: [transportScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportScenario } as ReturnType<typeof useGetScenario>);
  });

  it("renders the transport scenario name", () => {
    renderStudio("transport");
    expect(screen.getAllByText("Coal Base Case").length).toBeGreaterThan(0);
  });

  it("shows transport header subtitle", () => {
    renderStudio("transport");
    expect(screen.getByText(/Ch 5/i)).toBeInTheDocument();
    expect(screen.getByText(/coal mines/i)).toBeInTheDocument();
  });

  it("shows Mine capacity factor slider", () => {
    renderStudio("transport");
    expect(screen.getByText("Mine capacity factor")).toBeInTheDocument();
  });

  it("shows Single-source toggle", () => {
    renderStudio("transport");
    expect(screen.getByText("Single-source")).toBeInTheDocument();
  });

  it("shows Ignore capacity toggle", () => {
    renderStudio("transport");
    expect(screen.getByText("Ignore capacity")).toBeInTheDocument();
  });

  it("does NOT show Warehouse status section for transport", () => {
    renderStudio("transport");
    expect(screen.queryByText("Warehouse status")).not.toBeInTheDocument();
  });

  it("does NOT show Number of warehouses (P-value) for transport", () => {
    renderStudio("transport");
    expect(screen.queryByText(/Number of warehouses/i)).not.toBeInTheDocument();
  });

  it("shows transport constraints in constraints panel", () => {
    renderStudio("transport");
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
      openWarehouseIds: [],
      assignments: [
        { customerId: "STN1", warehouseId: "PRB", distanceMi: 1071, band: 2, flowTons: 7000000, flowFraction: 1.0 },
        { customerId: "STN2", warehouseId: "ILL", distanceMi: 400, band: 0, flowTons: 3500000, flowFraction: 0.5 },
      ],
      objective: 50840650000,
      weightedAvgDistanceMi: 696.4,
      bandCoverage: [],
      utilization: [],
      runTimeSec: 0.3,
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
    renderStudio("transport");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByText(/Flow assignments/i)).toBeInTheDocument();
  });

  it("renders mine → station flow rows", async () => {
    renderStudio("transport");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByText(/PRB.*STN1/)).toBeInTheDocument();
  });

  it("shows weighted avg distance in summary", async () => {
    renderStudio("transport");
    await userEvent.click(screen.getByText("Output"));
    const distanceEl = screen.getByTestId("result-weighted-avg-distance");
    expect(distanceEl).toHaveTextContent("696.4");
    expect(distanceEl).toHaveTextContent("miles");
  });

  it("does NOT show warehouse utilization bars for transport", async () => {
    renderStudio("transport");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.queryByText("Open warehouses · utilization")).not.toBeInTheDocument();
  });

  it("does NOT show band coverage for transport", async () => {
    renderStudio("transport");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.queryByText("Demand served within band")).not.toBeInTheDocument();
  });
});

// ── Studio header labels by active lab ─────────────────────────────────────────

describe("Studio — Header lab name by active lab", () => {
  it("shows Al's Athletics · Model Lab when active lab is 1 (p_median)", () => {
    mockUseListScenarios.mockReturnValue({ data: [pmedianScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: pmedianScenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    expect(screen.getByText(/Al's Athletics · Model Lab/)).toBeInTheDocument();
  });

  it("shows Coal Transport LP · Model Lab when active lab is 2 (transport)", () => {
    mockUseSearch.mockReturnValue("?scenario=8");
    mockUseListScenarios.mockReturnValue({ data: [transportScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportScenario } as ReturnType<typeof useGetScenario>);
    renderStudio("transport");
    expect(screen.getByText(/Coal Transport LP · Model Lab/)).toBeInTheDocument();
  });
});

// ── Lab-based auto-redirect ─────────────────────────────────────────────────
// The chapter route (App.tsx) now supplies problemType as a real prop, so
// these can test "redirect to the scenario matching the active lab" properly
// again — restored now that B1.1 gives Studio an explicit "which lab" signal.

describe("Studio — Lab-based scenario redirect", () => {
  const pmedianWith5 = { ...pmedianScenario, id: 5 };
  const transportWith8 = { ...transportScenario, id: 8 };
  const multiScenarios = [pmedianWith5, transportWith8];

  beforeEach(() => {
    mockUseSearch.mockReturnValue("");
    mockUseGetScenario.mockReturnValue({ data: undefined } as ReturnType<typeof useGetScenario>);
  });

  it("redirects to first p-median scenario when lab is p_median and URL has no scenario", () => {
    mockUseListScenarios.mockReturnValue({ data: multiScenarios, isLoading: false } as ReturnType<typeof useListScenarios>);
    renderStudio("p_median");
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=5", { replace: true });
  });

  it("redirects to first transport scenario when lab is transport and URL has no scenario", () => {
    mockUseListScenarios.mockReturnValue({ data: multiScenarios, isLoading: false } as ReturnType<typeof useListScenarios>);
    renderStudio("transport");
    expect(mockNavigate).toHaveBeenCalledWith("/?scenario=8", { replace: true });
  });

  it("does NOT redirect when no scenario matches the active lab (stays at current URL)", () => {
    // Only p_median available, but the active lab is transport → no matching scenario → no navigate
    mockUseListScenarios.mockReturnValue({ data: [pmedianWith5], isLoading: false } as ReturnType<typeof useListScenarios>);
    renderStudio("transport");
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining("/?scenario="), expect.anything());
  });

  it("does NOT redirect when a valid ?scenario= matching the active lab is already in the URL", () => {
    mockUseSearch.mockReturnValue("?scenario=5");
    mockUseGetScenario.mockReturnValue({ data: pmedianWith5 } as ReturnType<typeof useGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: multiScenarios, isLoading: false } as ReturnType<typeof useListScenarios>);
    renderStudio("p_median");
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ── Brazil scenario fixture ────────────────────────────────────────────────
const brazilScenario = {
  id: 10,
  name: "Brazil Base — 20M cap",
  problemType: "capacitated_pmedian",
  pValue: 5,
  warehouseCapacity: 20000000,
  singleSource: true,
  distanceBands: [500, 1000, 2000, 4000],
  solver: "cbc",
  gap: 0,
  timeLimitSec: 120,
  capacityMode: "uniform",
  uniformCapacity: null,
  warehouseStatuses: [],
  capacityFactor: 1.0,
  capacityInactive: false,
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
    renderStudio("capacitated_pmedian");
    expect(screen.getByText(/Brazil Capacity · Model Lab/)).toBeInTheDocument();
  });

  it("shows Brazil subtitle in header (Ch 5 · capacitated p-median)", () => {
    renderStudio("capacitated_pmedian");
    expect(screen.getByText(/Ch 5.*capacitated p-median.*Brazil/i)).toBeInTheDocument();
  });

  it("renders BrazilMap component instead of NetworkMap for Brazil scenario", () => {
    renderStudio("capacitated_pmedian");
    expect(screen.getByTestId("brazil-map")).toBeInTheDocument();
    expect(screen.queryByTestId("network-map")).not.toBeInTheDocument();
  });

  it("shows Single-source toggle in configure panel for Brazil", () => {
    renderStudio("capacitated_pmedian");
    expect(screen.getByText("Single-source")).toBeInTheDocument();
  });

  it("shows São Paulo capacity hint in configure panel when singleSource=true", () => {
    renderStudio("capacitated_pmedian");
    expect(screen.getByText(/São Paulo/i)).toBeInTheDocument();
  });

  it("shows Warehouses to open (P) control", () => {
    renderStudio("capacitated_pmedian");
    expect(screen.getByText("Warehouses to open (P)")).toBeInTheDocument();
  });

  it("does NOT show Warehouse status section for Brazil", () => {
    renderStudio("capacitated_pmedian");
    expect(screen.queryByText("Warehouse status")).not.toBeInTheDocument();
  });

  it("does NOT show Mine capacity factor for Brazil", () => {
    renderStudio("capacitated_pmedian");
    expect(screen.queryByText("Mine capacity factor")).not.toBeInTheDocument();
  });

  it("does NOT show Ignore capacity toggle for Brazil", () => {
    renderStudio("capacitated_pmedian");
    expect(screen.queryByText("Ignore capacity")).not.toBeInTheDocument();
  });
});

// ── Brazil Studio — header lab name ───────────────────────────────────────
describe("Studio — Header lab name by active lab (all three labs)", () => {
  it("shows Brazil Capacity · Model Lab when active lab is 3", () => {
    mockUseSearch.mockReturnValue("?scenario=10");
    mockUseListScenarios.mockReturnValue({ data: [brazilScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: brazilScenario } as ReturnType<typeof useGetScenario>);
    renderStudio("capacitated_pmedian");
    expect(screen.getByText(/Brazil Capacity · Model Lab/)).toBeInTheDocument();
  });
});

// ── Brazil Studio — infeasibility output ──────────────────────────────────
describe("Studio — Brazil infeasibility output banner", () => {
  const brazilInfeasibleScenario = {
    ...brazilScenario,
    result: {
      status: "infeasible",
      openWarehouseIds: [],
      assignments: [],
      objective: 0,
      weightedAvgDistanceMi: 0,
      bandCoverage: [],
      utilization: [],
      runTimeSec: 0.1,
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
    renderStudio("capacitated_pmedian");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByText("Infeasible")).toBeInTheDocument();
  });

  it("shows infeasibility reason mentioning São Paulo on output tab", async () => {
    renderStudio("capacitated_pmedian");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getAllByText(/São Paulo/).length).toBeGreaterThan(0);
  });

  it("shows Relax single-sourcing hint in infeasibility reason", async () => {
    renderStudio("capacitated_pmedian");
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByText(/Relax single-sourcing/i)).toBeInTheDocument();
  });
});

// Brazil-lab auto-redirect coverage ("redirect to Brazil scenario when that
// lab is active", "empty state when no Brazil scenarios exist for the active
// lab") required an external lab-selection signal (previously
// GamificationContext) that A3.2 removes — see the note above the p_median/
// transport redirect tests. This coverage returns once B1.1's chapter routing
// supplies an explicit "which lab" signal again.

// ── New button sends correct problemType per lab ───────────────────────────────
describe("Studio — New button sends correct problemType", () => {
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

  it("sends problemType p_median when active scenario is p_median (lab 1)", async () => {
    mockUseListScenarios.mockReturnValue({ data: [pmedianScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: pmedianScenario } as ReturnType<typeof useGetScenario>);
    renderStudio();
    await clickNew();
    expect(mockCreateScenario.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ problemType: "p_median", pValue: 3 }),
      }),
      expect.anything()
    );
  });

  it("sends problemType transport when active scenario is transport (lab 2)", async () => {
    mockUseSearch.mockReturnValue("?scenario=8");
    mockUseListScenarios.mockReturnValue({ data: [transportScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportScenario } as ReturnType<typeof useGetScenario>);
    renderStudio("transport");
    await clickNew();
    expect(mockCreateScenario.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ problemType: "transport", pValue: 1 }),
      }),
      expect.anything()
    );
  });

  it("sends problemType capacitated_pmedian when active scenario is Brazil (lab 3)", async () => {
    mockUseSearch.mockReturnValue("?scenario=10");
    mockUseListScenarios.mockReturnValue({ data: [brazilScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: brazilScenario } as ReturnType<typeof useGetScenario>);
    renderStudio("capacitated_pmedian");
    await clickNew();
    expect(mockCreateScenario.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ problemType: "capacitated_pmedian", pValue: 7 }),
      }),
      expect.anything()
    );
  });
});
