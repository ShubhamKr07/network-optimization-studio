import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import * as exportEntity from "@/lib/exportEntity";
import type { Scenario } from "@workspace/api-client-react";

// R6+R8 — distanceUnit + the supportsP capability flag are both sourced from
// GET /api/models (via useListModels), same pattern ServiceStatsTab.test.tsx
// already established for this suite of Workspace-tab tests.
// T5 (B5) — supportsFacilityStatus mirrors real capability values: true for
// p-median-us/brazil AND two-echelon (all three have a real open/closed
// facility concept), false for transport-coal (every mine "opens" — no
// facility-location concept at all). This is intentionally NOT the same
// gate as supportsP (two-echelon has no P but does have facility status).
const mockUseListModels = vi.fn(() => ({
  data: [
    { id: "p-median-us", distanceUnit: "mi", capabilities: { supportsP: true, supportsFacilityStatus: true } },
    { id: "p-median-brazil", distanceUnit: "mi", capabilities: { supportsP: true, supportsFacilityStatus: true } },
    { id: "transport-coal", distanceUnit: "mi", capabilities: { supportsP: false, supportsFacilityStatus: false } },
    // Bundle 2 (B2-T1) relabels two-echelon-gold-au "km" -> "mi" (its base
    // numbers are geographically miles; zero data change).
    { id: "two-echelon-gold-au", distanceUnit: "mi", capabilities: { supportsP: false, supportsFacilityStatus: true } },
  ],
}));

// T5 (B5) — base facility id -> city/state for the new city-list row. Only
// p-median-us's dataset is populated with fixture rows matching the
// scenario fixtures' edge ids (WH1/WH2) below; other models default to an
// empty dataset (exercises the "dataset not loaded / unknown id" fallback).
const mockUseGetDataset = vi.fn((params?: { modelId?: string }) => {
  if (params?.modelId === "p-median-us") {
    return {
      data: {
        warehouses: [
          { id: "WH1", city: "Chicago", state: "IL", lat: 0, lng: 0 },
          { id: "WH2", city: "Dallas", state: "TX", lat: 0, lng: 0 },
        ],
        customers: [],
      },
    };
  }
  if (params?.modelId === "two-echelon-gold-au") {
    return {
      data: {
        warehouses: [
          { id: "MINE1", city: "Kalgoorlie", state: "WA", lat: 0, lng: 0, kind: "mine" },
          { id: "REF1", city: "Daggar Hills", state: "QLD", lat: 0, lng: 0, kind: "facility" },
        ],
        customers: [],
      },
    };
  }
  return { data: undefined };
});
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => mockUseListModels(),
  useGetDataset: (params?: { modelId?: string }) => mockUseGetDataset(params),
  getGetDatasetQueryKey: (params?: { modelId?: string }) => ["dataset", params],
}));

import { CostSummaryTab } from "@/components/workspace/tabs/CostSummaryTab";

const result = {
  status: "optimal" as const, objective: 29873735731, runTimeSec: 0.45, quality: "Proven optimal",
  edges: [], metrics: { weightedAvgDistance: 382.9 }, details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

function scenario(overrides: Partial<Scenario>): Scenario {
  return {
    id: 1,
    name: "Scenario",
    modelId: "p-median-us",
    inputs: {},
    result: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    stale: false,
    ...overrides,
  } as Scenario;
}

// Test-only helper for "same scenario, different model" fixtures (the
// facility-location-rows-absent tests below) — a plain object spread widens
// `modelId` back to `string`, so this goes through the same `as Scenario`
// cast `scenario()` above uses.
function withModel(s: Scenario, modelId: Scenario["modelId"]): Scenario {
  return { ...s, modelId } as Scenario;
}

describe("CostSummaryTab — single-scenario view (unchanged)", () => {
  it("renders objective, weighted avg distance, runtime, quality, and solver", () => {
    render(<CostSummaryTab result={result} scenarioId={1} />);
    expect(screen.getByTestId("cost-summary-value-objective")).toHaveTextContent("29,873,735,731");
    expect(screen.getByTestId("cost-summary-value-weighted-avg-distance")).toHaveTextContent("382.9 mi");
    expect(screen.getByTestId("cost-summary-value-quality")).toHaveTextContent("Proven optimal");
  });

  it("shows empty state when result is null", () => {
    render(<CostSummaryTab result={null} scenarioId={1} />);
    expect(screen.getByTestId("cost-summary-empty")).toBeInTheDocument();
  });

  it("calls downloadEntityExport with entity=costSummary on Download click", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<CostSummaryTab result={result} scenarioId={1} />);
    fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));
    expect(spy).toHaveBeenCalledWith(1, "costSummary", "csv");
  });

  it("uses the model's distanceUnit ('mi') for a two-echelon-gold-au render", () => {
    render(<CostSummaryTab result={result} scenarioId={1} modelId="two-echelon-gold-au" />);
    expect(screen.getByTestId("cost-summary-value-weighted-avg-distance")).toHaveTextContent("382.9 mi");
  });

  // Bundle 3, T9 — mono-numbers pass: the numeric objective/distance stats
  // render in the monospace font; the text-valued Quality row doesn't.
  it("renders numeric stats with font-mono, text stats without (Bundle 3, T9)", () => {
    render(<CostSummaryTab result={result} scenarioId={1} />);
    expect(screen.getByTestId("cost-summary-value-objective")).toHaveClass("font-mono");
    expect(screen.getByTestId("cost-summary-value-weighted-avg-distance")).toHaveClass("font-mono");
    expect(screen.getByTestId("cost-summary-value-quality")).not.toHaveClass("font-mono");
  });
});

describe("CostSummaryTab — R6+R8 multi-scenario compare", () => {
  const s1 = scenario({
    id: 1, name: "Baseline", modelId: "p-median-us",
    result: { ...result, objective: 100, metrics: { weightedAvgDistance: 300, bandCoverage: [{ band: 200, percent: 40 }, { band: 400, percent: 80 }], utilizationByNode: [{ warehouseId: "WH1", city: "A", utilization: 50 }, { warehouseId: "WH2", city: "B", utilization: 90 }] }, edges: [{ fromId: "WH1", toId: "C1", flow: 1, distance: 100 }, { fromId: "WH2", toId: "C2", flow: 1, distance: 100 }] },
  });
  const s2 = scenario({
    id: 2, name: "Alt P", modelId: "p-median-us",
    result: { ...result, objective: 120, metrics: { weightedAvgDistance: 250, bandCoverage: [{ band: 200, percent: 60 }, { band: 400, percent: 90 }], utilizationByNode: [{ warehouseId: "WH1", city: "A", utilization: 70 }] }, edges: [{ fromId: "WH1", toId: "C1", flow: 1, distance: 100 }] },
  });
  const unsolved = scenario({ id: 3, name: "Unsolved", modelId: "p-median-us", result: null });
  const stale = scenario({ id: 4, name: "Stale", modelId: "p-median-us", result: { ...result }, stale: true });
  const otherModel = scenario({ id: 5, name: "Other model scenario", modelId: "transport-coal", result: { ...result } });

  it("only enables solved + non-stale scenarios for compare, others show a solve-first hint", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2, unsolved, stale]} />);
    expect(screen.getByTestId("cost-summary-compare-toggle-3").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("cost-summary-compare-hint-3")).toHaveTextContent("(solve first)");
    expect(screen.getByTestId("cost-summary-compare-toggle-4").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("cost-summary-compare-hint-4")).toHaveTextContent("(solve first)");
    expect(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")).not.toBeDisabled();
  });

  it("cross-model selection is impossible — scenarios from another model never appear as toggles", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2, otherModel]} />);
    expect(screen.queryByTestId("cost-summary-compare-toggle-5")).not.toBeInTheDocument();
  });

  it("selecting 2 scenarios shows scalar rows (objective/distance/runtime/quality) per column", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-table")).toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-objective-1")).toHaveTextContent("100");
    expect(screen.getByTestId("cost-summary-compare-objective-2")).toHaveTextContent("120");
    expect(screen.getByTestId("cost-summary-compare-distance-1")).toHaveTextContent("300.0");
    expect(screen.getByTestId("cost-summary-compare-distance-2")).toHaveTextContent("250.0");
    expect(screen.getByTestId("cost-summary-compare-runtime-1")).toHaveTextContent("0.45s");
    expect(screen.getByTestId("cost-summary-compare-quality-2")).toHaveTextContent("Proven optimal");
  });

  it("shows the unit in the weighted-distance row heading, not hardcoded", () => {
    // Every real model is "mi" post-B2-T1, so to prove the heading reflects
    // the model's REPORTED distanceUnit (not a hardcoded "mi"), override the
    // mock with a synthetic "km" model for this test, then restore the
    // default (no afterEach resets this shared mock).
    const defaultImpl = mockUseListModels.getMockImplementation();
    mockUseListModels.mockReturnValue({
      data: [{ id: "two-echelon-gold-au", distanceUnit: "km", capabilities: { supportsP: false, supportsFacilityStatus: false } }],
    });
    try {
      const twoEchelonS1 = withModel(s1, "two-echelon-gold-au");
      const twoEchelonS2 = withModel(s2, "two-echelon-gold-au");
      render(<CostSummaryTab result={twoEchelonS1.result} scenarioId={1} modelId="two-echelon-gold-au" scenarios={[twoEchelonS1, twoEchelonS2]} />);
      fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
      expect(screen.getByText("Weighted avg. distance (km)")).toBeInTheDocument();
    } finally {
      mockUseListModels.mockReset();
      if (defaultImpl) mockUseListModels.mockImplementation(defaultImpl);
    }
  });

  it("no aggregate-utilization cell is rendered in compare mode (removed, T3)", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("cost-summary-compare-utilization-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cost-summary-compare-utilization-2")).not.toBeInTheDocument();
    expect(screen.queryByText("Aggregate utilization")).not.toBeInTheDocument();
  });

  // ── T5 (B5) — open-facility set by city ──────────────────────────────

  it("the city-list row appears immediately after Weighted avg. distance, and the old count row is gone (not duplicated)", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    const table = screen.getByTestId("cost-summary-compare-table");
    const rowLabels = [...table.querySelectorAll("tbody tr")].map(tr => tr.querySelector("td")?.textContent);
    const distanceIdx = rowLabels.findIndex(l => l?.startsWith("Weighted avg. distance"));
    const facilitiesIdx = rowLabels.findIndex(l => l === "Open facilities");
    expect(distanceIdx).toBeGreaterThanOrEqual(0);
    expect(facilitiesIdx).toBe(distanceIdx + 1);
    // Old count-row testid must be gone entirely (replaced, not duplicated).
    expect(screen.queryByTestId("cost-summary-compare-open-facilities-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-1")).toBeInTheDocument();
  });

  it("resolves base facility ids to their dataset city names, hyphen-separated from state (T3)", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    // s1 opens WH1 (Chicago - IL) + WH2 (Dallas - TX); s2 opens WH1 only.
    expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-1")).toHaveTextContent("Chicago - IL");
    expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-1")).toHaveTextContent("Dallas - TX");
    expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-2")).toHaveTextContent("Chicago - IL");
    expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-2")).not.toHaveTextContent("Dallas - TX");
  });

  it("gates the city-list row independently on supportsFacilityStatus, not supportsP (absent for transport-coal)", () => {
    const t1 = withModel(s1, "transport-coal");
    const t2 = withModel(s2, "transport-coal");
    render(<CostSummaryTab result={t1.result} scenarioId={1} modelId="transport-coal" scenarios={[t1, t2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("cost-summary-compare-open-facilities-cities-1")).not.toBeInTheDocument();
  });

  it("resolves an added p-median warehouse's city from that column's own inputs.addedWarehouses", () => {
    const added = scenario({
      id: 20, name: "Added WH", modelId: "p-median-us",
      inputs: { addedWarehouses: [{ id: "aw-1", city: "Newtown", state: "PA", lat: 0, lng: 0, status: "active", displayCode: "AW1" }] },
      result: { ...result, edges: [{ fromId: "aw-1", toId: "C9", flow: 1, distance: 10 }] },
    });
    render(<CostSummaryTab result={added.result} scenarioId={20} modelId="p-median-us" scenarios={[added, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-20")).toHaveTextContent("Newtown - PA");
  });

  it("falls back to the raw facility id when it can't be resolved against either the base dataset or added inputs", () => {
    const unknownFacility = scenario({
      id: 40, name: "Unknown facility", modelId: "p-median-us",
      result: { ...result, edges: [{ fromId: "WH-GHOST", toId: "C1", flow: 1, distance: 5 }] },
    });
    render(<CostSummaryTab result={unknownFacility.result} scenarioId={40} modelId="p-median-us" scenarios={[unknownFacility, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-40")).toHaveTextContent("WH-GHOST");
  });

  it("falls back to the raw facility id before the dataset has resolved (e.g. p-median-brazil, not mocked here)", () => {
    // mockUseGetDataset only has fixture rows for p-median-us/two-echelon;
    // p-median-brazil resolves to `{data: undefined}`, standing in for
    // "dataset not loaded yet" — the row must still render ids, never blank.
    const brazilS1 = withModel(s1, "p-median-brazil");
    const brazilS2 = withModel(s2, "p-median-brazil");
    render(<CostSummaryTab result={brazilS1.result} scenarioId={1} modelId="p-median-brazil" scenarios={[brazilS1, brazilS2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-1")).toHaveTextContent("WH1");
  });

  describe("two-echelon-gold-au", () => {
    const g1 = scenario({
      id: 10, name: "Gold A", modelId: "two-echelon-gold-au",
      result: {
        ...result,
        objective: 500,
        metrics: { weightedAvgDistance: 400 },
        edges: [
          { fromId: "MINE1", toId: "REF1", flow: 1, distance: 50, leg: "mine_to_refinery" as const },
          { fromId: "REF1", toId: "C1", flow: 1, distance: 100, leg: "refinery_to_customer" as const },
        ],
      },
    });
    const g2 = scenario({
      id: 11, name: "Gold B", modelId: "two-echelon-gold-au",
      result: {
        ...result,
        objective: 520,
        metrics: { weightedAvgDistance: 420 },
        edges: [
          { fromId: "MINE1", toId: "REF1", flow: 1, distance: 50, leg: "mine_to_refinery" as const },
          { fromId: "REF1", toId: "C2", flow: 1, distance: 90, leg: "refinery_to_customer" as const },
        ],
      },
    });

    it("gets exactly one city-list row (fixed mine excluded) and no aggregate-utilization row", () => {
      render(<CostSummaryTab result={g1.result} scenarioId={10} modelId="two-echelon-gold-au" scenarios={[g1, g2]} />);
      fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-11").querySelector("input")!);
      expect(screen.queryAllByText("Open facilities")).toHaveLength(1);
      expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-10")).toHaveTextContent("Daggar Hills - QLD");
      expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-10")).not.toHaveTextContent("Kalgoorlie");
      expect(screen.queryByTestId("cost-summary-compare-utilization-10")).not.toBeInTheDocument();
    });

    it("resolves an added refinery's city from that column's own inputs.addedRefineries", () => {
      const addedRef = scenario({
        id: 30, name: "Added Refinery", modelId: "two-echelon-gold-au",
        inputs: { addedRefineries: [{ id: "aw-2", city: "Toowoomba", state: "QLD", lat: 0, lng: 0, status: "active", displayCode: "AR1" }] },
        result: {
          ...result,
          edges: [
            { fromId: "MINE1", toId: "aw-2", flow: 1, distance: 20, leg: "mine_to_refinery" as const },
            { fromId: "aw-2", toId: "C1", flow: 1, distance: 30, leg: "refinery_to_customer" as const },
          ],
        },
      });
      render(<CostSummaryTab result={addedRef.result} scenarioId={30} modelId="two-echelon-gold-au" scenarios={[addedRef, g2]} />);
      fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-11").querySelector("input")!);
      expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-30")).toHaveTextContent("Toowoomba - QLD");
    });
  });

  it("shows per-band coverage rows when all selected scenarios share identical bands", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-band-200-1")).toHaveTextContent("40%");
    expect(screen.getByTestId("cost-summary-compare-band-200-2")).toHaveTextContent("60%");
    expect(screen.queryByTestId("cost-summary-compare-bands-note")).not.toBeInTheDocument();
  });

  it("shows a per-scenario note instead of band rows when bands differ", () => {
    const s2DifferentBands: Scenario = {
      ...s2,
      result: { ...s2.result!, metrics: { ...s2.result!.metrics, bandCoverage: [{ band: 500, percent: 60 }] } },
    };
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2DifferentBands]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("cost-summary-compare-band-200-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-bands-note")).toBeInTheDocument();
  });

  it("disables all toggles with a return-to-latest hint while browsing result history", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} isBrowsingHistory />);
    expect(screen.getByTestId("cost-summary-history-hint")).toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-toggle-1").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")).toBeDisabled();
  });

  it("hides Download CSV in compare mode", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("button-download-cost-summary-csv")).not.toBeInTheDocument();
  });

  it("1 selected renders the normal single-scenario summary, including Download CSV", () => {
    render(<CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} />);
    expect(screen.getByTestId("cost-summary-list")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-cost-summary-csv")).toBeInTheDocument();
    expect(screen.queryByTestId("cost-summary-compare-table")).not.toBeInTheDocument();
  });
});
