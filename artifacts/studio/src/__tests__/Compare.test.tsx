import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  useSearch: vi.fn(() => ""),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock("@/components/OverlayMap", () => ({
  OverlayMap: () => <div data-testid="overlay-map" />,
}));

const metrics = [
  {
    scenarioId: 1,
    name: "2 Warehouses",
    openSites: ["Chicago"],
    weightedAvgDistanceMi: 500,
    objective: 200000,
    bandDemandPercent: [],
    avgUtilization: 50,
    solverStatus: "optimal",
  },
  {
    scenarioId: 2,
    name: "3 Warehouses",
    openSites: ["Chicago", "Atlanta"],
    weightedAvgDistanceMi: 400,
    objective: 150000,
    bandDemandPercent: [],
    avgUtilization: 60,
    solverStatus: "optimal",
  },
];

const mockCompareScenarios = {
  mutate: vi.fn((_vars: unknown, opts: { onSuccess: (res: { scenarios: typeof metrics }) => void }) => {
    opts.onSuccess({ scenarios: metrics });
  }),
  isPending: false,
};

const baseInputs = { p: 3, distanceBands: [200], capacityMode: "none", uniformCapacity: null, warehouseOverrides: [], customerOverrides: [], gap: 0, timeLimitSec: 120 };

const scenario1 = {
  id: 1, name: "2 Warehouses", modelId: "p-median-us", inputs: baseInputs,
  result: {
    status: "optimal", objective: 1, runTimeSec: 0.1, quality: "Optimal",
    edges: [], metrics: { weightedAvgDistance: 500, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["CHI"], assignments: [] },
    solverUsed: "CBC (PuLP)", infeasibilityReason: null,
  },
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", stale: true,
};
const scenario2 = {
  id: 2, name: "3 Warehouses", modelId: "p-median-us", inputs: { ...baseInputs, p: 4 },
  result: {
    status: "optimal", objective: 1, runTimeSec: 0.1, quality: "Optimal",
    edges: [], metrics: { weightedAvgDistance: 400, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["CHI", "ATL"], assignments: [] },
    solverUsed: "CBC (PuLP)", infeasibilityReason: null,
  },
  createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", stale: false,
};

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: vi.fn(() => ({ data: [scenario1, scenario2], isLoading: false })),
  useGetDataset: vi.fn(() => ({ data: { warehouses: [], customers: [] }, isLoading: false })),
  useGetScenario: vi.fn(() => ({ data: undefined })),
  useCompareScenarios: vi.fn(() => mockCompareScenarios),
}));

import { Compare } from "@/pages/Compare";

describe("Compare — stale badge (X1.1)", () => {
  it("shows a Stale badge for a stale scenario's column and not for a fresh one", () => {
    render(<Compare />);
    expect(screen.getByTestId("badge-stale-1")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-stale-2")).not.toBeInTheDocument();
  });
});
