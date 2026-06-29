import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mock wouter ───────────────────────────────────────────────────────────────
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: vi.fn(() => ["/", vi.fn()]),
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
  capacityFactor: 1.0,
  singleSource: false,
  capacityInactive: false,
};

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

const dataset = {
  warehouses: [{ id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 }],
  customers: [{ id: "C1", lat: 40.71, lng: -74.00, demand: 100 }],
};

// ── Mock API client hooks ─────────────────────────────────────────────────────
const mockUpdateScenario = { mutateAsync: vi.fn() };
const mockSolveScenario = { mutateAsync: vi.fn(), isPending: false };
const mockCloneScenario = { mutateAsync: vi.fn() };
const mockCreateScenario = { mutateAsync: vi.fn() };
const mockDeleteScenario = { mutateAsync: vi.fn() };

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

import { useListScenarios, useGetDataset, useGetScenario } from "@workspace/api-client-react";
import { Studio } from "@/pages/Studio";

const mockUseListScenarios = vi.mocked(useListScenarios);
const mockUseGetDataset = vi.mocked(useGetDataset);
const mockUseGetScenario = vi.mocked(useGetScenario);

function renderStudio() {
  return render(<Studio />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseGetDataset.mockReturnValue({ data: dataset, isLoading: false } as ReturnType<typeof useGetDataset>);
});

// ── P-Median rendering ────────────────────────────────────────────────────────

describe("Studio — P-Median scenario", () => {
  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [pmedianScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: pmedianScenario } as ReturnType<typeof useGetScenario>);
  });

  it("renders without crashing", () => {
    renderStudio();
    // Scenario name appears in both sidebar and header — check at least one exists
    expect(screen.getAllByText("3 Warehouses").length).toBeGreaterThan(0);
  });

  it("shows P-Median header subtitle", () => {
    renderStudio();
    // The subtitle "Ch 3 · p-median · facility location" appears in the header
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
    mockUseListScenarios.mockReturnValue({ data: [transportScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportScenario } as ReturnType<typeof useGetScenario>);
  });

  it("renders the transport scenario name", () => {
    renderStudio();
    expect(screen.getAllByText("Coal Base Case").length).toBeGreaterThan(0);
  });

  it("shows transport header subtitle", () => {
    renderStudio();
    expect(screen.getByText(/Ch 5/i)).toBeInTheDocument();
    expect(screen.getByText(/coal mines/i)).toBeInTheDocument();
  });

  it("shows Mine capacity factor slider", () => {
    renderStudio();
    expect(screen.getByText("Mine capacity factor")).toBeInTheDocument();
  });

  it("shows Single-source toggle", () => {
    renderStudio();
    expect(screen.getByText("Single-source")).toBeInTheDocument();
  });

  it("shows Ignore capacity toggle", () => {
    renderStudio();
    expect(screen.getByText("Ignore capacity")).toBeInTheDocument();
  });

  it("does NOT show Warehouse status section for transport", () => {
    renderStudio();
    expect(screen.queryByText("Warehouse status")).not.toBeInTheDocument();
  });

  it("does NOT show Number of warehouses (P-value) for transport", () => {
    renderStudio();
    expect(screen.queryByText(/Number of warehouses/i)).not.toBeInTheDocument();
  });

  it("shows transport constraints in constraints panel", () => {
    renderStudio();
    expect(screen.getByText(/C1 Meet all station demand/)).toBeInTheDocument();
    expect(screen.getByText(/C2 Mine capacity limits/)).toBeInTheDocument();
  });
});

// ── Transport scenario results ─────────────────────────────────────────────────

describe("Studio — Transport scenario (output tab)", () => {
  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [transportSolvedScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: transportSolvedScenario } as ReturnType<typeof useGetScenario>);
  });

  it("shows flow table header on output tab", async () => {
    renderStudio();
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByText(/Flow assignments/i)).toBeInTheDocument();
  });

  it("renders mine → station flow rows", async () => {
    renderStudio();
    await userEvent.click(screen.getByText("Output"));
    expect(screen.getByText(/PRB.*STN1/)).toBeInTheDocument();
  });

  it("shows weighted avg distance in summary", async () => {
    renderStudio();
    await userEvent.click(screen.getByText("Output"));
    // Distance and unit are in separate spans: "696.4" + "miles"
    const distanceEl = screen.getByTestId("result-weighted-avg-distance");
    expect(distanceEl).toHaveTextContent("696.4");
    expect(distanceEl).toHaveTextContent("miles");
  });

  it("does NOT show warehouse utilization bars for transport", async () => {
    renderStudio();
    await userEvent.click(screen.getByText("Output"));
    expect(screen.queryByText("Open warehouses · utilization")).not.toBeInTheDocument();
  });

  it("does NOT show band coverage for transport", async () => {
    renderStudio();
    await userEvent.click(screen.getByText("Output"));
    expect(screen.queryByText("Demand served within band")).not.toBeInTheDocument();
  });
});

// ── Problem type dropdown ──────────────────────────────────────────────────────

describe("Studio — Problem type dropdown", () => {
  beforeEach(() => {
    mockUseListScenarios.mockReturnValue({ data: [pmedianScenario], isLoading: false } as ReturnType<typeof useListScenarios>);
    mockUseGetScenario.mockReturnValue({ data: pmedianScenario } as ReturnType<typeof useGetScenario>);
  });

  it("includes Transportation LP option in problem type list", () => {
    renderStudio();
    // Open the problem-type select using its data-testid
    const trigger = screen.getByTestId("select-problem-type");
    fireEvent.click(trigger);
    // Radix renders options into document.body portal after click
    expect(document.body.textContent).toContain("Transportation LP (Chapter 5)");
  });
});
