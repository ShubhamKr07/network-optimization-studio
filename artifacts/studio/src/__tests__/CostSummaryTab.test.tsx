import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import * as exportEntity from "@/lib/exportEntity";
import type { Scenario } from "@workspace/api-client-react";
import { UnitProvider } from "@/contexts/UnitContext";
import { ExportProvider } from "@/contexts/ExportContext";
import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";

// SCN chen-bands-units, Task 14b — CostSummaryTab now calls useExport()
// unconditionally. Every one of this file's ~37 call sites was updated
// in-place to inline `<UnitProvider><ExportProvider value={...}>` around its
// own `<CostSummaryTab .../>` (no `rerender()` calls anywhere in this file,
// so no double-wrap remount risk) — `render` is a bare alias, not an
// additional wrapping layer, to avoid nesting a second, redundant
// ExportProvider around every already-wrapped call site.
const render = rtlRender;

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
    // jade-T14 — Chapter 9 JADE has real facility open/closed status (no P).
    { id: "two-echelon-jade-us", distanceUnit: "mi", capabilities: { supportsP: false, supportsFacilityStatus: true } },
    // C4.14 — Chen's Cosmetics: km, real facility status.
    { id: "chens-cosmetics-cn", distanceUnit: "km", capabilities: { supportsP: true, supportsFacilityStatus: true } },
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
    // chen-bands-units, Part D — the pre-existing "382.9 mi" default relied
    // on the now-removed `?? "mi"` fallback; a real caller (Workspace.tsx)
    // always passes `modelId`, so this test does too to keep asserting the
    // SAME rendered text under the new no-fallback contract.
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={result} scenarioId={1} modelId="p-median-us" /></ExportProvider></UnitProvider>);
    expect(screen.getByTestId("cost-summary-value-objective")).toHaveTextContent("29,873,735,731");
    expect(screen.getByTestId("cost-summary-value-weighted-avg-distance")).toHaveTextContent("382.9 mi");
    expect(screen.getByTestId("cost-summary-value-quality")).toHaveTextContent("Proven optimal");
  });

  // chen-bands-units, Part D "No fallback unit — reads": no modelId means
  // the canonical distance unit can never resolve — the cell must show a
  // loading placeholder, NEVER a value guessed under "mi".
  it("shows a distance placeholder — never a value or a guessed 'mi' label — when modelId/canonical unit hasn't resolved", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={result} scenarioId={1} /></ExportProvider></UnitProvider>);
    const cell = screen.getByTestId("cost-summary-value-weighted-avg-distance");
    expect(cell).toHaveTextContent("—");
    expect(cell).not.toHaveTextContent("mi");
    expect(cell).not.toHaveTextContent("382.9");
  });

  it("shows empty state when result is null", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={null} scenarioId={1} /></ExportProvider></UnitProvider>);
    expect(screen.getByTestId("cost-summary-empty")).toBeInTheDocument();
  });

  it("calls downloadEntityExport with entity=costSummary on Download click", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={result} scenarioId={1} /></ExportProvider></UnitProvider>);
    fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));
    expect(spy).toHaveBeenCalledWith(1, "costSummary", "csv", { unit: "mi" });
  });

  // Task 14b — production-control assertions.
  describe("useExport() disabled-reason wiring (Task 14b)", () => {
    it("is disabled with the reason surfaced for a result entity when the displayed entry has no runId", () => {
      render(
        <UnitProvider>
          <ExportProvider value={makeExportProviderValue({ resultDisabledReason: "No run recorded for this entry." })}>
            <CostSummaryTab result={result} scenarioId={1} />
          </ExportProvider>
        </UnitProvider>,
      );
      const button = screen.getByTestId("button-download-cost-summary-csv");
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "No run recorded for this entry.");
    });

    it("forwards runId when an older history entry is displayed", () => {
      const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
      render(
        <UnitProvider>
          <ExportProvider value={makeExportProviderValue({ runId: 8 })}>
            <CostSummaryTab result={result} scenarioId={1} />
          </ExportProvider>
        </UnitProvider>,
      );
      fireEvent.click(screen.getByTestId("button-download-cost-summary-csv"));
      expect(spy).toHaveBeenCalledWith(1, "costSummary", "csv", { unit: "mi", runId: 8 });
    });
  });

  it("uses the model's distanceUnit ('mi') for a two-echelon-gold-au render", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={result} scenarioId={1} modelId="two-echelon-gold-au" /></ExportProvider></UnitProvider>);
    expect(screen.getByTestId("cost-summary-value-weighted-avg-distance")).toHaveTextContent("382.9 mi");
  });

  // Bundle 3, T9 — mono-numbers pass: the numeric objective/distance stats
  // render in the monospace font; the text-valued Quality row doesn't.
  it("renders numeric stats with font-mono, text stats without (Bundle 3, T9)", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={result} scenarioId={1} /></ExportProvider></UnitProvider>);
    expect(screen.getByTestId("cost-summary-value-objective")).toHaveClass("font-mono");
    expect(screen.getByTestId("cost-summary-value-weighted-avg-distance")).toHaveClass("font-mono");
    expect(screen.getByTestId("cost-summary-value-quality")).not.toHaveClass("font-mono");
  });
});

// jade-T14 — Chapter 9 JADE inbound/outbound cost split (single-scenario view)
describe("CostSummaryTab — Chapter 9 JADE inbound/outbound cost split", () => {
  const jadeResult = {
    status: "optimal" as const, objective: 254060828.6157, runTimeSec: 1.2, quality: "Proven optimal",
    edges: [],
    metrics: { weightedAvgDistance: 500, inboundCost: 100000000, outboundCost: 154060828 },
    details: {}, solverUsed: "CBC", infeasibilityReason: null,
  };

  it("shows Inbound cost and Outbound cost rows when the metrics carry them", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={jadeResult} scenarioId={1} modelId="two-echelon-jade-us" /></ExportProvider></UnitProvider>);
    expect(screen.getByTestId("cost-summary-value-inbound-cost")).toHaveTextContent("100,000,000");
    expect(screen.getByTestId("cost-summary-value-outbound-cost")).toHaveTextContent("154,060,828");
  });

  it("places Inbound/Outbound cost rows between Objective and Weighted avg. distance", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={jadeResult} scenarioId={1} modelId="two-echelon-jade-us" /></ExportProvider></UnitProvider>);
    const list = screen.getByTestId("cost-summary-list");
    const labels = [...list.querySelectorAll("dt")].map(dt => dt.textContent);
    expect(labels).toEqual(["Objective", "Inbound cost", "Outbound cost", "Weighted avg. distance", "Runtime", "Quality", "Solver"]);
  });

  it("does not show Inbound/Outbound cost rows for a model whose envelope omits them (no regression)", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={result} scenarioId={1} modelId="p-median-us" /></ExportProvider></UnitProvider>);
    expect(screen.queryByTestId("cost-summary-value-inbound-cost")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cost-summary-value-outbound-cost")).not.toBeInTheDocument();
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
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2, unsolved, stale]} /></ExportProvider></UnitProvider>);
    expect(screen.getByTestId("cost-summary-compare-toggle-3").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("cost-summary-compare-hint-3")).toHaveTextContent("(solve first)");
    expect(screen.getByTestId("cost-summary-compare-toggle-4").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("cost-summary-compare-hint-4")).toHaveTextContent("(solve first)");
    expect(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")).not.toBeDisabled();
  });

  it("cross-model selection is impossible — scenarios from another model never appear as toggles", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2, otherModel]} /></ExportProvider></UnitProvider>);
    expect(screen.queryByTestId("cost-summary-compare-toggle-5")).not.toBeInTheDocument();
  });

  it("selecting 2 scenarios shows scalar rows (objective/distance/runtime/quality) per column", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} /></ExportProvider></UnitProvider>);
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
      render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={twoEchelonS1.result} scenarioId={1} modelId="two-echelon-gold-au" scenarios={[twoEchelonS1, twoEchelonS2]} /></ExportProvider></UnitProvider>);
      fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
      expect(screen.getByText("Weighted avg. distance (km)")).toBeInTheDocument();
    } finally {
      mockUseListModels.mockReset();
      if (defaultImpl) mockUseListModels.mockImplementation(defaultImpl);
    }
  });

  it("no aggregate-utilization cell is rendered in compare mode (removed, T3)", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} /></ExportProvider></UnitProvider>);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("cost-summary-compare-utilization-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cost-summary-compare-utilization-2")).not.toBeInTheDocument();
    expect(screen.queryByText("Aggregate utilization")).not.toBeInTheDocument();
  });

  // ── T5 (B5) — open-facility set by city ──────────────────────────────

  it("the city-list row appears immediately after Weighted avg. distance, and the old count row is gone (not duplicated)", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} /></ExportProvider></UnitProvider>);
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
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} /></ExportProvider></UnitProvider>);
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
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={t1.result} scenarioId={1} modelId="transport-coal" scenarios={[t1, t2]} /></ExportProvider></UnitProvider>);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("cost-summary-compare-open-facilities-cities-1")).not.toBeInTheDocument();
  });

  it("resolves an added p-median warehouse's city from that column's own inputs.addedWarehouses", () => {
    const added = scenario({
      id: 20, name: "Added WH", modelId: "p-median-us",
      inputs: { addedWarehouses: [{ id: "aw-1", city: "Newtown", state: "PA", lat: 0, lng: 0, status: "active", displayCode: "AW1" }] },
      result: { ...result, edges: [{ fromId: "aw-1", toId: "C9", flow: 1, distance: 10 }] },
    });
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={added.result} scenarioId={20} modelId="p-median-us" scenarios={[added, s2]} /></ExportProvider></UnitProvider>);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-20")).toHaveTextContent("Newtown - PA");
  });

  it("falls back to the raw facility id when it can't be resolved against either the base dataset or added inputs", () => {
    const unknownFacility = scenario({
      id: 40, name: "Unknown facility", modelId: "p-median-us",
      result: { ...result, edges: [{ fromId: "WH-GHOST", toId: "C1", flow: 1, distance: 5 }] },
    });
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={unknownFacility.result} scenarioId={40} modelId="p-median-us" scenarios={[unknownFacility, s2]} /></ExportProvider></UnitProvider>);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-40")).toHaveTextContent("WH-GHOST");
  });

  it("falls back to the raw facility id before the dataset has resolved (e.g. p-median-brazil, not mocked here)", () => {
    // mockUseGetDataset only has fixture rows for p-median-us/two-echelon;
    // p-median-brazil resolves to `{data: undefined}`, standing in for
    // "dataset not loaded yet" — the row must still render ids, never blank.
    const brazilS1 = withModel(s1, "p-median-brazil");
    const brazilS2 = withModel(s2, "p-median-brazil");
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={brazilS1.result} scenarioId={1} modelId="p-median-brazil" scenarios={[brazilS1, brazilS2]} /></ExportProvider></UnitProvider>);
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
      render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={g1.result} scenarioId={10} modelId="two-echelon-gold-au" scenarios={[g1, g2]} /></ExportProvider></UnitProvider>);
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
      render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={addedRef.result} scenarioId={30} modelId="two-echelon-gold-au" scenarios={[addedRef, g2]} /></ExportProvider></UnitProvider>);
      fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-11").querySelector("input")!);
      expect(screen.getByTestId("cost-summary-compare-open-facilities-cities-30")).toHaveTextContent("Toowoomba - QLD");
    });
  });

  // jade-T14 — Chapter 9 JADE's open-facility set uses the authoritative
  // metrics.openFacilityIds (incl. a zero-flow open warehouse), not edges.
  describe("two-echelon-jade-us", () => {
    const j1 = scenario({
      id: 50, name: "JADE A", modelId: "two-echelon-jade-us",
      result: {
        ...result,
        objective: 254060828.6157,
        metrics: { weightedAvgDistance: 500, openFacilityIds: ["wh-11", "wh-14"] },
        edges: [
          { fromId: "plant-1", toId: "wh-11", flow: 900, distance: 200, leg: "plant_to_warehouse" as const, productId: "product-1" },
          { fromId: "wh-11", toId: "customer-1", flow: 900, distance: 42.1, leg: "warehouse_to_customer" as const },
          // wh-14 is open (in metrics.openFacilityIds) but has zero outbound
          // edges — it must still appear in the city list.
        ],
      },
    });
    const j2 = scenario({
      id: 51, name: "JADE B", modelId: "two-echelon-jade-us",
      result: { ...result, objective: 260000000, metrics: { weightedAvgDistance: 520, openFacilityIds: ["wh-11"] }, edges: [] },
    });

    it("uses metrics.openFacilityIds (not derived edges), including a zero-flow open warehouse, and excludes the plant", () => {
      render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={j1.result} scenarioId={50} modelId="two-echelon-jade-us" scenarios={[j1, j2]} /></ExportProvider></UnitProvider>);
      fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-51").querySelector("input")!);
      const cities = screen.getByTestId("cost-summary-compare-open-facilities-cities-50");
      expect(cities).not.toHaveTextContent("plant-1");
      // Dataset not mocked for this modelId -> falls back to raw ids (still
      // proves both wh-11 AND the zero-flow wh-14 are present).
      expect(cities).toHaveTextContent("wh-11");
      expect(cities).toHaveTextContent("wh-14");
    });

    // T11 (workspace-fixups-2, item 2, "CostSummary compare is per-scenario"
    // — Codex round-3 P1, CRITICAL). `locationById`'s mere PRESENCE still
    // selects the identity-chip layout (JADE-only, per Workspace.tsx's own
    // gate) but its VALUES are no longer read — a real bug the old
    // single-active-map design had: two compare columns can share an
    // added-facility canonical id while storing DIFFERENT locations/display
    // codes, and looking every column up through one shared map would show
    // one column's data in another column's cell.
    it("resolves the identity-chip layout's values from each column's OWN dataset/inputs, not from locationById's own values", () => {
      render(
        <UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab
          result={j1.result}
          scenarioId={50}
          modelId="two-echelon-jade-us"
          scenarios={[j1, j2]}
          // Deliberately WRONG values — if the component still read this
          // map's contents, the assertions below would see these instead.
          locationById={{ "wh-11": { city: "WRONG-FROM-PROP", state: "XX" }, "wh-14": { city: "ALSO-WRONG", state: "XX" } }}
        /></ExportProvider></UnitProvider>,
      );
      fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-51").querySelector("input")!);
      const cities = screen.getByTestId("cost-summary-compare-open-facilities-cities-50");
      // No dataset mocked for two-echelon-jade-us and j1's `inputs` carries
      // no `addedWarehouses` for wh-11/wh-14 — the per-scenario identity has
      // no entry for either, so both fall back to their raw ids, proving the
      // WRONG values from the `locationById` prop were never used.
      expect(cities).not.toHaveTextContent("WRONG-FROM-PROP");
      expect(cities).not.toHaveTextContent("ALSO-WRONG");
      expect(cities).toHaveTextContent("wh-11");
      expect(cities).toHaveTextContent("wh-14");
    });

    // The literal T11 DoD test: two compare columns sharing an
    // added-facility CANONICAL id, each storing a DIFFERENT location/display
    // code on that id (e.g. cloned scenarios later edited independently) —
    // each column must show its OWN city/state/displayId, never the other
    // column's.
    it("two compare columns sharing an added-facility id show EACH column's own city/state/displayId", () => {
      const jadeA = scenario({
        id: 70, name: "JADE Added A", modelId: "two-echelon-jade-us",
        inputs: { addedWarehouses: [{ id: "aw-shared", city: "Allentown", state: "PA", displayCode: "WH-A", status: "active" }] },
        result: { ...result, metrics: { weightedAvgDistance: 500, openFacilityIds: ["aw-shared"] }, edges: [] },
      });
      const jadeB = scenario({
        id: 71, name: "JADE Added B", modelId: "two-echelon-jade-us",
        inputs: { addedWarehouses: [{ id: "aw-shared", city: "Denver", state: "CO", displayCode: "WH-B", status: "active" }] },
        result: { ...result, metrics: { weightedAvgDistance: 520, openFacilityIds: ["aw-shared"] }, edges: [] },
      });
      render(
        <UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab
          result={jadeA.result}
          scenarioId={70}
          modelId="two-echelon-jade-us"
          scenarios={[jadeA, jadeB]}
          locationById={{}}
        /></ExportProvider></UnitProvider>,
      );
      fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-71").querySelector("input")!);
      const colA = screen.getByTestId("cost-summary-compare-open-facilities-cities-70");
      const colB = screen.getByTestId("cost-summary-compare-open-facilities-cities-71");
      expect(colA).toHaveTextContent("Allentown, PA");
      expect(colA).toHaveTextContent("WH-A");
      expect(colA).not.toHaveTextContent("Denver");
      expect(colB).toHaveTextContent("Denver, CO");
      expect(colB).toHaveTextContent("WH-B");
      expect(colB).not.toHaveTextContent("Allentown");
    });

    it("falls back to the pre-existing city-resolution rendering when locationById is absent (other-model default, no regression)", () => {
      render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={j1.result} scenarioId={50} modelId="two-echelon-jade-us" scenarios={[j1, j2]} /></ExportProvider></UnitProvider>);
      fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-51").querySelector("input")!);
      const cities = screen.getByTestId("cost-summary-compare-open-facilities-cities-50");
      expect(cities).toHaveTextContent("wh-11");
      expect(cities).not.toHaveTextContent("Allentown");
    });
  });

  it("shows per-band coverage rows when all selected scenarios share identical bands", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} /></ExportProvider></UnitProvider>);
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
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2DifferentBands]} /></ExportProvider></UnitProvider>);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("cost-summary-compare-band-200-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-bands-note")).toBeInTheDocument();
  });

  it("disables all toggles with a return-to-latest hint while browsing result history", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} isBrowsingHistory /></ExportProvider></UnitProvider>);
    expect(screen.getByTestId("cost-summary-history-hint")).toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-toggle-1").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")).toBeDisabled();
  });

  it("hides Download CSV in compare mode", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} /></ExportProvider></UnitProvider>);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-2").querySelector("input")!);
    expect(screen.queryByTestId("button-download-cost-summary-csv")).not.toBeInTheDocument();
  });

  it("1 selected renders the normal single-scenario summary, including Download CSV", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={s1.result} scenarioId={1} modelId="p-median-us" scenarios={[s1, s2]} /></ExportProvider></UnitProvider>);
    expect(screen.getByTestId("cost-summary-list")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-cost-summary-csv")).toBeInTheDocument();
    expect(screen.queryByTestId("cost-summary-compare-table")).not.toBeInTheDocument();
  });
});

// C4.14 (D14) — Chen mode-aware objective + incompatible-mode compare restriction.
describe("CostSummaryTab — Chen mode-aware objective + compare restriction (C4.14)", () => {
  const coverageResult = {
    status: "optimal" as const, objective: 66.6667, runTimeSec: 0.3, quality: "optimal",
    edges: [], metrics: { weightedAvgDistance: 812.4, bandCoverage: [] },
    details: { objective: "coverage", coveragePct: 66.6667 }, solverUsed: "CBC", infeasibilityReason: null,
  };
  const minDistanceResult = {
    status: "optimal" as const, objective: 131645389, runTimeSec: 0.4, quality: "optimal",
    edges: [], metrics: { weightedAvgDistance: 640.2, bandCoverage: [] },
    details: { objective: "min_distance" }, solverUsed: "CBC", infeasibilityReason: null,
  };
  const coverageA = scenario({ id: 60, name: "Coverage A", modelId: "chens-cosmetics-cn", result: coverageResult });
  const coverageB = scenario({ id: 61, name: "Coverage B", modelId: "chens-cosmetics-cn", result: { ...coverageResult, objective: 70.0 } });
  const minDist = scenario({ id: 62, name: "Min-Dist", modelId: "chens-cosmetics-cn", result: minDistanceResult });

  it("single-scenario: a coverage solve shows a % objective", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={coverageResult} scenarioId={60} modelId="chens-cosmetics-cn" /></ExportProvider></UnitProvider>);
    expect(screen.getByTestId("cost-summary-value-objective")).toHaveTextContent("66.67 %");
  });

  it("single-scenario: a min-distance solve shows a demand-km objective", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={minDistanceResult} scenarioId={62} modelId="chens-cosmetics-cn" /></ExportProvider></UnitProvider>);
    expect(screen.getByTestId("cost-summary-value-objective")).toHaveTextContent("demand-km");
  });

  it("with a coverage anchor selected, a different-mode (min-distance) scenario is DISABLED with a hint; a same-mode one is enabled", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={coverageA.result} scenarioId={60} modelId="chens-cosmetics-cn" scenarios={[coverageA, coverageB, minDist]} /></ExportProvider></UnitProvider>);
    // Same mode (coverage) — selectable.
    expect(screen.getByTestId("cost-summary-compare-toggle-61").querySelector("input")).not.toBeDisabled();
    // Different mode (min_distance) — blocked with a mode hint (NOT a solve-first hint; it IS solved).
    expect(screen.getByTestId("cost-summary-compare-toggle-62").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("cost-summary-compare-mode-hint-62")).toHaveTextContent("different objective");
    expect(screen.queryByTestId("cost-summary-compare-hint-62")).not.toBeInTheDocument();
  });

  it("two SAME-mode coverage scenarios compare together (mode-aware % in each column)", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={coverageA.result} scenarioId={60} modelId="chens-cosmetics-cn" scenarios={[coverageA, coverageB, minDist]} /></ExportProvider></UnitProvider>);
    fireEvent.click(screen.getByTestId("cost-summary-compare-toggle-61").querySelector("input")!);
    expect(screen.getByTestId("cost-summary-compare-table")).toBeInTheDocument();
    expect(screen.getByTestId("cost-summary-compare-objective-60")).toHaveTextContent("66.67 %");
    expect(screen.getByTestId("cost-summary-compare-objective-61")).toHaveTextContent("70.00 %");
  });

  it("with a min-distance anchor, coverage scenarios are the ones blocked (symmetry)", () => {
    render(<UnitProvider><ExportProvider value={makeExportProviderValue()}><CostSummaryTab result={minDist.result} scenarioId={62} modelId="chens-cosmetics-cn" scenarios={[minDist, coverageA, coverageB]} /></ExportProvider></UnitProvider>);
    expect(screen.getByTestId("cost-summary-compare-toggle-60").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("cost-summary-compare-mode-hint-60")).toHaveTextContent("different objective");
  });
});
