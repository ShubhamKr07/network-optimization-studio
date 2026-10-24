import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { Scenario, SolveResult } from "@workspace/api-client-react";
import { UnitProvider } from "@/contexts/UnitContext";
import { ExportProvider } from "@/contexts/ExportContext";
import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import superResultJson from "./fixtures/superResult.json";

// SM-8 — fixture captured from a real solve_super run on
// public/samples/super-model-sample.json (never hand-written).
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => ({ data: [{ id: "super-model", distanceUnit: "mi", capabilities: { supportsP: true, supportsFacilityStatus: true } }] }),
  useGetDataset: () => ({ data: undefined }),
  getGetDatasetQueryKey: (params?: unknown) => ["dataset", params],
}));

import { CostSummaryTab } from "@/components/workspace/tabs/CostSummaryTab";

const result = superResultJson as unknown as SolveResult;
const m = result.metrics as Record<string, number>;
const cents = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const scenario = (id: number): Scenario =>
  ({ id, name: `S${id}`, modelId: "super-model", inputs: {}, result, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", stale: false }) as unknown as Scenario;
const wrap = (ui: React.ReactElement) => render(<UnitProvider><ExportProvider value={makeExportProviderValue()}>{ui}</ExportProvider></UnitProvider>);

describe("CostSummaryTab — super-model", () => {
  it("renders the seven summary lines from the real solve and no generic duplicates", () => {
    wrap(<CostSummaryTab result={result} scenarioId={1} modelId="super-model" />);
    const t = (id: string) => screen.getByTestId(id);
    expect(t("cost-summary-value-objective")).toHaveTextContent("254,060,828");
    expect(t("cost-summary-value-total-cost")).toHaveTextContent(cents(m.totalCost));
    expect(t("cost-summary-value-total-inbound-transportation-cost")).toHaveTextContent(cents(m.inboundCost));
    expect(t("cost-summary-value-total-outbound-transportation-cost")).toHaveTextContent(cents(m.outboundCost));
    expect(t("cost-summary-value-total-plant-variable-cost")).toHaveTextContent(cents(m.plantVariableCost));
    // display rounds only at render: 1229.199777... -> 1229.2 (1-dp formatter)
    expect(t("cost-summary-value-weighted-avg-distance-plant-to-wh")).toHaveTextContent("1229.2");
    expect(t("cost-summary-value-weighted-avg-distance-wh-to-customer")).toHaveTextContent("649.8");
    expect(screen.queryByText("Inbound cost")).not.toBeInTheDocument();
    expect(screen.queryByText("Weighted avg. distance")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cost-summary-rate-ic")).not.toBeInTheDocument();
  });

  it("adds the seven rows per column in compare mode", () => {
    const [a, b] = [scenario(1), scenario(2)];
    wrap(<CostSummaryTab result={a.result} scenarioId={1} modelId="super-model" scenarios={[a, b]} />);
    fireEvent.click(screen.getByTestId("button-toggle-compare"));
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    for (const id of [1, 2]) {
      expect(screen.getByTestId(`cost-summary-compare-total-cost-${id}`)).toHaveTextContent(cents(m.totalCost));
      expect(screen.getByTestId(`cost-summary-compare-dist-plant-wh-${id}`)).toHaveTextContent("1229.2");
    }
    expect(screen.queryByTestId("cost-summary-compare-distance-1")).not.toBeInTheDocument();
  });

  it("compare 'Open facilities' shows city names (not raw ids) from the solved inputs", () => {
    const row = (id: string, city: string, state: string) => ({ id, city, state, lat: 0, lng: 0 });
    const inputs = { plants: [], customers: [], warehouses: [row("wh-11", "Phoenix", "AZ"), row("wh-14", "Denver", "CO")] };
    const [a, b] = [{ ...scenario(1), inputs }, { ...scenario(2), inputs }] as Scenario[];
    wrap(<CostSummaryTab result={a.result} scenarioId={1} modelId="super-model" scenarios={[a, b]} locationById={{}} />);
    fireEvent.click(screen.getByTestId("button-toggle-compare"));
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    const cell = screen.getByTestId("cost-summary-compare-open-facility-1-wh-11");
    expect(cell).toHaveTextContent("Phoenix, AZ");
    expect(screen.getByTestId("cost-summary-compare-open-facility-1-wh-14")).toHaveTextContent("Denver, CO");
  });
});
