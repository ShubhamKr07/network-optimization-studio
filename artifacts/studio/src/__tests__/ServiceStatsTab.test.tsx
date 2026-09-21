import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as exportEntity from "@/lib/exportEntity";
import { UnitProvider } from "@/contexts/UnitContext";

// chen-bands-units, T13 — ServiceStatsTab now calls `useDisplayUnit()`
// unconditionally (no legacy/new split here — this component always
// derives its unit from the model manifest via `useListModels()`, never
// from a caller-supplied prop), so every render in this file needs a
// `UnitProvider` ancestor. Uses RTL's `wrapper` OPTION (not a wrapping
// element, which is silently dropped by `rerender(...)`).
function render(
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) {
  return rtlRender(ui, { wrapper: AllProviders, ...options });
}

beforeEach(() => {
  window.localStorage.clear();
});

const STORAGE_KEY = "nos:display-unit-pref";

// R9 — distanceUnit is sourced from GET /api/models (via useListModels),
// so this suite mocks it the same way other Workspace-tab tests do
// (e.g. Workspace.OutputMap.test.tsx). B4 extends the mock with
// `capabilities.supportsPlantProductCapability` — the manifest flag the
// Plant Production section + JADE coverage recompute gate on (never on
// `modelId` directly).
const mockUseListModels = vi.fn(() => ({
  data: [
    { id: "p-median-us", distanceUnit: "mi", capabilities: { supportsPlantProductCapability: false } },
    // Bundle 2 (B2-T1) relabels two-echelon-gold-au "km" -> "mi" (its base
    // numbers are geographically miles; zero data change).
    { id: "two-echelon-gold-au", distanceUnit: "mi", capabilities: { supportsPlantProductCapability: false } },
    { id: "two-echelon-jade-us", distanceUnit: "mi", capabilities: { supportsPlantProductCapability: true } },
    // C4.14 — Chen's Cosmetics reports distances in km.
    { id: "chens-cosmetics-cn", distanceUnit: "km", capabilities: { supportsPlantProductCapability: false } },
  ],
}));
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => mockUseListModels(),
}));

import { ServiceStatsTab } from "@/components/workspace/tabs/ServiceStatsTab";

const result = {
  status: "optimal" as const, objective: 100, runTimeSec: 0.5, quality: "Proven optimal",
  edges: [], metrics: { bandCoverage: [{ band: 200, percent: 30 }, { band: 400, percent: 45 }] },
  details: {}, solverUsed: "CBC", infeasibilityReason: null,
};

describe("ServiceStatsTab", () => {
  it("renders one bar per band with its exclusive percent", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("30%");
    expect(screen.getByTestId("service-stats-band-400")).toHaveTextContent("45%");
  });

  it("shows a no-bands message when bandCoverage is absent", () => {
    render(<ServiceStatsTab result={{ ...result, metrics: {} }} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-no-bands")).toBeInTheDocument();
  });

  it("shows empty state when result is null", () => {
    render(<ServiceStatsTab result={null} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-empty")).toBeInTheDocument();
  });

  it("calls downloadEntityExport with entity=serviceStats on Download click", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    fireEvent.click(screen.getByTestId("button-download-service-stats-csv"));
    expect(spy).toHaveBeenCalledWith(1, "serviceStats", "csv");
  });

  it("labels the chart as demand-weighted (R9)", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    expect(
      screen.getByText("Percent of demand served within the selected distance bands")
    ).toBeInTheDocument();
  });

  it("uses the model's distanceUnit ('mi') on p-median-us band labels", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("≤ 200 mi");
  });

  it("uses the model's distanceUnit ('mi') on a two-echelon-gold-au render", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="two-echelon-gold-au" />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("≤ 200 mi");
  });

  // chen-bands-units, T13, Step 3b — DELIBERATE behavior change: the `?? "mi"`
  // fallback this test used to assert is gone. No modelId (or an
  // unresolved manifest) means the canonical unit is unauthoritative, so
  // this now renders the disabled placeholder instead of guessing "mi" —
  // never assume a unit, ever (a Chen (km) scenario transiently rendered
  // as "mi" is a correct number under a WRONG unit, which reads as fact).
  it("renders the unit-pending placeholder when modelId is not provided (canonical unit unresolved), no fallback", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} />);
    expect(screen.getByTestId("service-stats-unit-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("service-stats-band-200")).not.toBeInTheDocument();
  });

  // Bundle 3, T9 — mono-numbers pass: band/percent cells are numeric and
  // must render in the monospace font, distinct from prose/labels.
  it("renders the band and percent cells with font-mono (Bundle 3, T9)", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    const row = screen.getByTestId("service-stats-band-200");
    const [bandCell, percentCell] = row.querySelectorAll("span");
    expect(bandCell).toHaveClass("font-mono");
    expect(percentCell).toHaveClass("font-mono");
  });

  // jade-T14 — model-integration-precheck.md Gate 4: an explicit, separately
  // labelled overflow row (band: -1), never folded into the last boundary.
  describe("Chapter 9 JADE — cumulative coverage + explicit overflow row", () => {
    const jadeResult = {
      ...result,
      metrics: {
        bandCoverage: [
          { band: 200, percent: 10 },
          { band: 400, percent: 30 },
          { band: 800, percent: 60 },
          { band: 1600, percent: 85 },
          { band: -1, percent: 15 },
        ],
      },
    };

    it("renders cumulative coverage at all four boundaries", () => {
      render(<ServiceStatsTab result={jadeResult} scenarioId={1} modelId="two-echelon-jade-us" />);
      expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("10%");
      expect(screen.getByTestId("service-stats-band-400")).toHaveTextContent("30%");
      expect(screen.getByTestId("service-stats-band-800")).toHaveTextContent("60%");
      expect(screen.getByTestId("service-stats-band-1600")).toHaveTextContent("85%");
    });

    it("renders a separately labelled '> 1600 mi' overflow row, not folded into the 1600 row", () => {
      render(<ServiceStatsTab result={jadeResult} scenarioId={1} modelId="two-echelon-jade-us" />);
      const overflowRow = screen.getByTestId("service-stats-band--1");
      expect(overflowRow).toHaveTextContent("> 1600 mi");
      expect(overflowRow).toHaveTextContent("15%");
      // The 1600-boundary row is untouched by the overflow (85%, not 100%).
      expect(screen.getByTestId("service-stats-band-1600")).toHaveTextContent("≤ 1600 mi");
      expect(screen.getByTestId("service-stats-band-1600")).not.toHaveTextContent("100%");
    });

    it("does not render an overflow row when bandCoverage has no band: -1 entry (no regression)", () => {
      render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
      expect(screen.queryByTestId("service-stats-band--1")).not.toBeInTheDocument();
    });
  });

  // C4.14 (D14) — Chen coverage KPI summary block (from envelope `details`),
  // gated on the presence of `details.coveragePct`, never a modelId ternary.
  describe("Chen's Cosmetics — coverage KPIs (C4.14)", () => {
    const chenResult = {
      status: "optimal" as const, objective: 66.6667, runTimeSec: 0.3, quality: "optimal",
      edges: [],
      metrics: { weightedAvgDistance: 812.4, bandCoverage: [{ band: 600, percent: 66 }, { band: 5000, percent: 100 }] },
      details: { objective: "coverage", coveragePct: 66.6667, coveredDemand: 131645389, uncoveredPct: 33.3333 },
      solverUsed: "CBC", infeasibilityReason: null,
    };

    it("renders Coverage %, Covered demand, Uncovered %, and Avg service distance (km) from details", () => {
      render(<ServiceStatsTab result={chenResult} scenarioId={1} modelId="chens-cosmetics-cn" />);
      expect(screen.getByTestId("service-stats-coverage-pct")).toHaveTextContent("66.67 %");
      expect(screen.getByTestId("service-stats-covered-demand")).toHaveTextContent("131,645,389");
      expect(screen.getByTestId("service-stats-uncovered-pct")).toHaveTextContent("33.33 %");
      expect(screen.getByTestId("service-stats-avg-service-distance")).toHaveTextContent("812.4 km");
    });

    it("still renders the existing band rows below the KPI block", () => {
      render(<ServiceStatsTab result={chenResult} scenarioId={1} modelId="chens-cosmetics-cn" />);
      expect(screen.getByTestId("service-stats-band-600")).toHaveTextContent("66%");
      expect(screen.getByTestId("service-stats-band-5000")).toHaveTextContent("100%");
    });

    it("does NOT render the coverage KPI block for a non-Chen model (no details.coveragePct)", () => {
      render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
      expect(screen.queryByTestId("service-stats-coverage-kpis")).not.toBeInTheDocument();
    });
  });

  // B4 (JADE Ch.9 Workspace bundle, spec §6) — Plant Production section:
  // the full effective plants × products grid, left-joined to aggregated
  // inbound production. All fixtures below use 4 plants × 4 products = 16
  // rows, matching the real JADE dataset shape (grounding fact: 4 diagonal
  // cells capacity 210,000,000, 12 off-diagonal cells capacity 0).
  describe("Chapter 9 JADE — Plant Production section", () => {
    const plants = [
      { id: "p1", name: "Plant One", city: "A", state: "AA", lat: 0, lng: 0 },
      { id: "p2", name: "Plant Two", city: "B", state: "BB", lat: 0, lng: 0 },
      { id: "p3", name: "Plant Three", city: "C", state: "CC", lat: 0, lng: 0 },
      { id: "p4", name: "Plant Four", city: "D", state: "DD", lat: 0, lng: 0 },
    ];
    const products = [
      { id: "product-1", name: "Product 1" },
      { id: "product-2", name: "Product 2" },
      { id: "product-3", name: "Product 3" },
      { id: "product-4", name: "Product 4" },
    ];
    // 4 diagonal cells enabled (base capacity 210,000,000), 12 off-diagonal
    // cells disabled (base capacity 0) — matches the real dataset's own
    // 16-cell matrix shape exactly (§1 grounding facts).
    const baseCapabilities = plants.flatMap((plant, pi) =>
      products.map((product, ki) => ({
        plantId: plant.id,
        productId: product.id,
        capacity: pi === ki ? 210_000_000 : 0,
      })),
    );
    // Enables one base off-diagonal cell (p1 can now also make product-2) —
    // proves the JADE_ENABLED_CAPACITY fallback (210,000,000), not the
    // base cell's own (zero) capacity.
    const capabilityOverrides = [{ plantId: "p1", productId: "product-2", enabled: true }];
    // Inbound (plant_to_warehouse) edges feed "Actual production"; a
    // warehouse_to_customer edge (no productId) must never be summed in.
    const edges = [
      { fromId: "p1", toId: "w1", leg: "plant_to_warehouse" as const, productId: "product-1", flow: 500, distance: 100 },
      { fromId: "p1", toId: "w2", leg: "plant_to_warehouse" as const, productId: "product-1", flow: 300, distance: 150 },
      { fromId: "p2", toId: "w1", leg: "plant_to_warehouse" as const, productId: "product-2", flow: 200, distance: 120 },
      { fromId: "w1", toId: "c1", leg: "warehouse_to_customer" as const, flow: 9999, distance: 50 },
    ];
    const jadeResult = { ...result, edges, metrics: {} };

    function renderJade() {
      return render(
        <ServiceStatsTab
          result={jadeResult}
          scenarioId={1}
          modelId="two-echelon-jade-us"
          effectivePlants={plants}
          products={products}
          baseCapabilities={baseCapabilities}
          capabilityOverrides={capabilityOverrides}
        />,
      );
    }

    it("renders the full 16-row plants × products grid, dropping nothing", () => {
      renderJade();
      const rows = screen.getAllByTestId(/^row-plant-production-/);
      expect(rows).toHaveLength(16);
    });

    it("shows a zero-production row for an enabled cell with no inbound flow (p3/product-3)", () => {
      renderJade();
      const row = screen.getByTestId("row-plant-production-p3-product-3");
      expect(row).toHaveTextContent("p3 — C, CC");
      expect(row).toHaveTextContent("Product 3");
      expect(row).toHaveTextContent("0"); // actual
      expect(row).toHaveTextContent("210,000,000"); // capacity
      expect(row).toHaveTextContent("210,000,000"); // remaining == capacity - 0
    });

    it("shows a disabled row with capacity 0 and remaining '—' (p2/product-1, no override)", () => {
      renderJade();
      const row = screen.getByTestId("row-plant-production-p2-product-1");
      expect(row).toHaveTextContent("0"); // capacity
      expect(row).toHaveTextContent("—"); // remaining, not a number
    });

    it("computes actual production summed across multiple inbound edges for the same (plant, product)", () => {
      renderJade();
      const row = screen.getByTestId("row-plant-production-p1-product-1");
      expect(row).toHaveTextContent("800"); // 500 + 300
      expect(row).toHaveTextContent("210,000,000"); // base diagonal capacity
      expect(row).toHaveTextContent("209,999,200"); // 210,000,000 - 800
    });

    it("uses the JADE_ENABLED_CAPACITY fallback (210,000,000) for an enabled base off-diagonal override, not the base cell's own 0 capacity", () => {
      renderJade();
      const row = screen.getByTestId("row-plant-production-p1-product-2");
      expect(row).toHaveTextContent("210,000,000"); // capacity, from the override
      expect(row).toHaveTextContent("0"); // no inbound edges for (p1, product-2)
    });

    it("never sums a warehouse_to_customer edge into actual production", () => {
      renderJade();
      // If the outbound edge (flow 9999) leaked into (p1, product-1)'s
      // actual, it would show 500+300+9999=10799, not 800.
      const row = screen.getByTestId("row-plant-production-p1-product-1");
      expect(row).not.toHaveTextContent("10,799");
      expect(row).not.toHaveTextContent("10799");
    });

    it("shows the Plant Production filter menu at 16 rows", async () => {
      renderJade();
      expect(screen.getByTestId("plant-production-section")).toBeInTheDocument();
      const trigger = screen.getByTestId("button-filter-menu-trigger");
      expect(trigger).toBeInTheDocument();
      const user = userEvent.setup();
      await user.click(trigger);
      expect(screen.getByTestId("text-filter-count")).toHaveTextContent("16 of 16");
    });

    it("hides the section entirely when the JADE snapshot props are not wired (optional-props pattern)", () => {
      render(<ServiceStatsTab result={jadeResult} scenarioId={1} modelId="two-echelon-jade-us" />);
      expect(screen.queryByTestId("plant-production-section")).not.toBeInTheDocument();
    });

    it("hides the section for a non-JADE model even if the snapshot props are (mistakenly) passed", () => {
      render(
        <ServiceStatsTab
          result={jadeResult}
          scenarioId={1}
          modelId="p-median-us"
          effectivePlants={plants}
          products={products}
          baseCapabilities={baseCapabilities}
          capabilityOverrides={capabilityOverrides}
        />,
      );
      expect(screen.queryByTestId("plant-production-section")).not.toBeInTheDocument();
    });
  });

  // workspace-fixups item 2 (spec §2) — Plant Production plant cell shows
  // "<id> — City, State" (T2's plantIdCityState helper), never `name`, for
  // both a base plant and a plant sourced from an added plant already
  // present in the passed `effectivePlants` snapshot.
  describe("Plant Production plant label — id + City, State (workspace-fixups item 2)", () => {
    const products = [{ id: "product-1", name: "Product 1" }];
    const baseCapabilities = [{ plantId: "p1", productId: "product-1", capacity: 210_000_000 }];

    it("renders '<id> — City, State' for a base plant, ignoring its name field", () => {
      const plants = [{ id: "p1", name: "Plant One", city: "Springfield", state: "IL", lat: 0, lng: 0 }];
      render(
        <ServiceStatsTab
          result={{ ...result, edges: [], metrics: {} }}
          scenarioId={1}
          modelId="two-echelon-jade-us"
          effectivePlants={plants}
          products={products}
          baseCapabilities={baseCapabilities}
          capabilityOverrides={[]}
        />,
      );
      const row = screen.getByTestId("row-plant-production-p1-product-1");
      expect(row).toHaveTextContent("p1 — Springfield, IL");
      expect(row).not.toHaveTextContent("Plant One");
    });

    it("renders '<id> — City, State' for a plant sourced from an added plant already in effectivePlants", () => {
      // An added plant carries a scenario-local id (e.g. "aw-" prefixed,
      // matching this codebase's addedWarehouses/addedPlants id convention)
      // and no `name` at all — proving the label doesn't depend on `name`
      // being present.
      const addedPlant = { id: "aw-plant-1", city: "Reno", state: "NV", lat: 0, lng: 0 };
      const overrides = [{ plantId: "aw-plant-1", productId: "product-1", capacity: 210_000_000 }];
      render(
        <ServiceStatsTab
          result={{ ...result, edges: [], metrics: {} }}
          scenarioId={1}
          modelId="two-echelon-jade-us"
          effectivePlants={[addedPlant]}
          products={products}
          baseCapabilities={overrides}
          capabilityOverrides={[]}
        />,
      );
      const row = screen.getByTestId("row-plant-production-aw-plant-1-product-1");
      expect(row).toHaveTextContent("aw-plant-1 — Reno, NV");
    });
  });

  // workspace-fixups-2, T10 (item 2) — identityById + the `>10` upgrade rule
  // for the Plant Production plant cell.
  describe("Plant Production identityById + >10 upgrade rule (workspace-fixups-2, T10, item 2)", () => {
    const products = [{ id: "product-1", name: "Product 1" }];
    const baseCapabilities = [{ plantId: "p1", productId: "product-1", capacity: 210_000_000 }];
    const identityById = { p1: { city: "Reno", state: "NV", displayId: "PLANT-NV-RENO-01" } };

    it("at exactly 1 (<=10) unfiltered row, keeps the pre-existing '<id> — City, State' label — identityById does not upgrade it", () => {
      const plants = [{ id: "p1", name: "Plant One", city: "Springfield", state: "IL", lat: 0, lng: 0 }];
      render(
        <ServiceStatsTab
          result={{ ...result, edges: [], metrics: {} }}
          scenarioId={1}
          modelId="two-echelon-jade-us"
          effectivePlants={plants}
          products={products}
          baseCapabilities={baseCapabilities}
          capabilityOverrides={[]}
          identityById={identityById}
        />,
      );
      const row = screen.getByTestId("row-plant-production-p1-product-1");
      expect(row).toHaveTextContent("p1 — Springfield, IL");
      expect(row).not.toHaveTextContent("PLANT-NV-RENO-01");
    });

    it("at 16 (>10) unfiltered rows, upgrades the plant cell with an identityById entry to the stacked EntityIdCell", () => {
      const plants = [
        { id: "p1", name: "Plant One", city: "Springfield", state: "IL", lat: 0, lng: 0 },
        { id: "p2", name: "Plant Two", city: "B", state: "BB", lat: 0, lng: 0 },
        { id: "p3", name: "Plant Three", city: "C", state: "CC", lat: 0, lng: 0 },
        { id: "p4", name: "Plant Four", city: "D", state: "DD", lat: 0, lng: 0 },
      ];
      const fourProducts = [
        { id: "product-1", name: "Product 1" },
        { id: "product-2", name: "Product 2" },
        { id: "product-3", name: "Product 3" },
        { id: "product-4", name: "Product 4" },
      ];
      const sixteenCellCapabilities = plants.flatMap((plant, pi) =>
        fourProducts.map((product, ki) => ({
          plantId: plant.id,
          productId: product.id,
          capacity: pi === ki ? 210_000_000 : 0,
        })),
      );
      render(
        <ServiceStatsTab
          result={{ ...result, edges: [], metrics: {} }}
          scenarioId={1}
          modelId="two-echelon-jade-us"
          effectivePlants={plants}
          products={fourProducts}
          baseCapabilities={sixteenCellCapabilities}
          capabilityOverrides={[]}
          identityById={identityById}
        />,
      );
      expect(screen.getAllByTestId(/^row-plant-production-/)).toHaveLength(16);
      const row = screen.getByTestId("row-plant-production-p1-product-1");
      expect(row).toHaveTextContent("Reno, NV");
      expect(row).toHaveTextContent("PLANT-NV-RENO-01");
      // A row for a plant with NO identityById entry (p2) still falls back
      // to the pre-existing string label unaffected.
      const otherRow = screen.getByTestId("row-plant-production-p2-product-2");
      expect(otherRow).toHaveTextContent("p2 — B, BB");
    });

    it("with identityById unset, output is byte-unchanged from before this task at any row count (no-regression)", () => {
      const plants = [{ id: "p1", name: "Plant One", city: "Springfield", state: "IL", lat: 0, lng: 0 }];
      render(
        <ServiceStatsTab
          result={{ ...result, edges: [], metrics: {} }}
          scenarioId={1}
          modelId="two-echelon-jade-us"
          effectivePlants={plants}
          products={products}
          baseCapabilities={baseCapabilities}
          capabilityOverrides={[]}
        />,
      );
      const row = screen.getByTestId("row-plant-production-p1-product-1");
      expect(row).toHaveTextContent("p1 — Springfield, IL");
    });
  });

  // B4 (spec §2 R2-3/§6) — JADE two-leg band-coverage recompute: cumulative,
  // over warehouse_to_customer edges ONLY, from the live `presentationBands`
  // instead of the frozen result.metrics.bandCoverage.
  describe("Chapter 9 JADE — coverage recompute from live bands, warehouse_to_customer only", () => {
    // Deliberately huge/near distance so that if this inbound edge were
    // wrongly included, band-100's percent and the overall total would be
    // wildly different from the hand-computed expectation below.
    const inboundEdge = { fromId: "p1", toId: "w1", leg: "plant_to_warehouse" as const, productId: "product-1", flow: 99_999, distance: 10 };
    const outboundEdges = [
      { fromId: "w1", toId: "c1", leg: "warehouse_to_customer" as const, flow: 100, distance: 50 },
      { fromId: "w1", toId: "c2", leg: "warehouse_to_customer" as const, flow: 200, distance: 250 },
      { fromId: "w2", toId: "c3", leg: "warehouse_to_customer" as const, flow: 300, distance: 550 },
      { fromId: "w2", toId: "c4", leg: "warehouse_to_customer" as const, flow: 400, distance: 1500 },
    ];
    // Frozen server-side bandCoverage deliberately uses different percents
    // at the SAME boundaries, so a passing test proves the live recompute
    // path (not the frozen one) actually rendered.
    const jadeResult = {
      ...result,
      edges: [inboundEdge, ...outboundEdges],
      metrics: {
        bandCoverage: [
          { band: 100, percent: 99 },
          { band: 300, percent: 99 },
          { band: 600, percent: 99 },
          { band: 1000, percent: 99 },
        ],
      },
    };
    const editedBands = [100, 300, 600, 1000];

    it("recomputes cumulative coverage from live bands over warehouse_to_customer edges only, excluding inbound flow", () => {
      render(
        <ServiceStatsTab
          result={jadeResult}
          scenarioId={1}
          modelId="two-echelon-jade-us"
          presentationBands={editedBands}
        />,
      );
      // totalFlow = 100+200+300+400 = 1000 (outbound only — the 99,999-flow
      // inbound edge at distance 10 is excluded, or band-100 would read ~99%).
      expect(screen.getByTestId("service-stats-band-100")).toHaveTextContent("10%");
      expect(screen.getByTestId("service-stats-band-300")).toHaveTextContent("30%");
      expect(screen.getByTestId("service-stats-band-600")).toHaveTextContent("60%");
      expect(screen.getByTestId("service-stats-band-1000")).toHaveTextContent("60%");
    });

    it("renders a distinct overflow row above the highest edited boundary", () => {
      render(
        <ServiceStatsTab
          result={jadeResult}
          scenarioId={1}
          modelId="two-echelon-jade-us"
          presentationBands={editedBands}
        />,
      );
      const overflowRow = screen.getByTestId("service-stats-band--1");
      expect(overflowRow).toHaveTextContent("> 1000 mi");
      expect(overflowRow).toHaveTextContent("40%"); // 400/1000
    });

    it("does NOT use the frozen result.metrics.bandCoverage percents once presentationBands is wired", () => {
      render(
        <ServiceStatsTab
          result={jadeResult}
          scenarioId={1}
          modelId="two-echelon-jade-us"
          presentationBands={editedBands}
        />,
      );
      expect(screen.getByTestId("service-stats-band-100")).not.toHaveTextContent("99%");
    });
  });

  // Regression: a model with no presentationBands wired at all (any
  // pre-existing call site, or JADE before INT wired it) must keep
  // reading the frozen result.metrics.bandCoverage exactly as before.
  describe("Frozen-coverage regression — presentationBands absent", () => {
    it("a model with no presentationBands prop reads the frozen bars", () => {
      render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
      expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("30%");
      expect(screen.getByTestId("service-stats-band-400")).toHaveTextContent("45%");
    });

    it("JADE itself keeps the frozen bars when presentationBands is not wired yet", () => {
      render(<ServiceStatsTab result={result} scenarioId={1} modelId="two-echelon-jade-us" />);
      expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("30%");
    });
  });

  // SSC-T1 (spec §4/§5) — non-JADE ServiceStats live coverage: the 4
  // distance-band models (us/brazil/transport/gold-au) now recompute live
  // from presentationBands the same way JADE already does, generalized
  // off the JADE-only gate. chens-cosmetics-cn stays frozen.
  describe("SSC-T1 — non-JADE distance-band models recompute live", () => {
    it("a single-echelon model (no leg on any edge) recomputes over ALL edges and shows the overflow row", () => {
      const singleEchelonEdges = [
        { fromId: "w1", toId: "c1", flow: 100, distance: 50 },
        { fromId: "w1", toId: "c2", flow: 200, distance: 250 },
        { fromId: "w2", toId: "c3", flow: 300, distance: 550 },
        { fromId: "w2", toId: "c4", flow: 400, distance: 1500 },
      ];
      render(
        <ServiceStatsTab
          result={{ ...result, edges: singleEchelonEdges }}
          scenarioId={1}
          modelId="p-median-us"
          presentationBands={[100, 300, 600, 1000]}
        />,
      );
      // totalFlow = 100+200+300+400 = 1000, all edges included (no leg to
      // filter on for a single-echelon model).
      expect(screen.getByTestId("service-stats-band-100")).toHaveTextContent("10%");
      expect(screen.getByTestId("service-stats-band-300")).toHaveTextContent("30%");
      expect(screen.getByTestId("service-stats-band-600")).toHaveTextContent("60%");
      expect(screen.getByTestId("service-stats-band-1000")).toHaveTextContent("60%");
      const overflowRow = screen.getByTestId("service-stats-band--1");
      expect(overflowRow).toHaveTextContent("> 1000 mi");
      expect(overflowRow).toHaveTextContent("40%"); // the 1500-distance edge (400/1000)
    });

    it("two-echelon-gold-au recomputes over refinery_to_customer edges ONLY, excluding an inbound mine_to_refinery edge", () => {
      const inboundEdge = { fromId: "m1", toId: "r1", leg: "mine_to_refinery" as const, flow: 99_999, distance: 10 };
      const outboundEdges = [
        { fromId: "r1", toId: "c1", leg: "refinery_to_customer" as const, flow: 100, distance: 50 },
        { fromId: "r1", toId: "c2", leg: "refinery_to_customer" as const, flow: 900, distance: 250 },
      ];
      render(
        <ServiceStatsTab
          result={{ ...result, edges: [inboundEdge, ...outboundEdges] }}
          scenarioId={1}
          modelId="two-echelon-gold-au"
          presentationBands={[100, 300]}
        />,
      );
      // totalFlow = 100+900 = 1000 (outbound only) — if the 99,999-flow
      // inbound edge leaked in, band-100 would read close to 100%.
      expect(screen.getByTestId("service-stats-band-100")).toHaveTextContent("10%");
      expect(screen.getByTestId("service-stats-band-300")).toHaveTextContent("100%");
      expect(screen.queryByTestId("service-stats-band--1")).not.toBeInTheDocument();
    });

    it("an edited boundary reclassifies the bars with no network call (same rendered props, different bands)", () => {
      const edges = [
        { fromId: "w1", toId: "c1", flow: 100, distance: 50 },
        { fromId: "w1", toId: "c2", flow: 100, distance: 250 },
      ];
      const { rerender } = render(
        <ServiceStatsTab
          result={{ ...result, edges }}
          scenarioId={1}
          modelId="p-median-us"
          presentationBands={[100]}
        />,
      );
      // Only the 50-distance edge is within 100 -> 50%.
      expect(screen.getByTestId("service-stats-band-100")).toHaveTextContent("50%");

      // Widen the boundary to 300 — a pure prop change, no fetch/mutation.
      rerender(
        <ServiceStatsTab
          result={{ ...result, edges }}
          scenarioId={1}
          modelId="p-median-us"
          presentationBands={[300]}
        />,
      );
      expect(screen.getByTestId("service-stats-band-300")).toHaveTextContent("100%");
    });

    // chen-bands-units, Part A — REVERSES the prior "stays frozen" contract:
    // the deliberate Chen guard (`&& !showCoverageKpis`) is deleted, so once
    // a caller wires `presentationBands` for Chen, it computes live from
    // `edges` exactly like its five siblings (cumulative + overflow,
    // km-labelled). Chen's SEPARATE `details.coveragePct` KPI block above
    // is untouched — this only concerns which source the band-coverage
    // BARS below it read from.
    it("chens-cosmetics-cn now computes bandCoverage LIVE once presentationBands is wired (Part A guard deleted)", () => {
      const chenResult = {
        status: "optimal" as const, objective: 66.6667, runTimeSec: 0.3, quality: "optimal",
        edges: [{ fromId: "w1", toId: "c1", flow: 100, distance: 50 }],
        metrics: { weightedAvgDistance: 812.4, bandCoverage: [{ band: 600, percent: 66 }, { band: 5000, percent: 100 }] },
        details: { objective: "coverage", coveragePct: 66.6667, coveredDemand: 131645389, uncoveredPct: 33.3333 },
        solverUsed: "CBC", infeasibilityReason: null,
      };
      render(
        <ServiceStatsTab
          result={chenResult}
          scenarioId={1}
          modelId="chens-cosmetics-cn"
          presentationBands={[10, 20, 30]}
        />,
      );
      // Live recompute over the ONE edge (distance 50, flow 100) against the
      // wired bands [10,20,30] — none of the 3 real boundaries capture it
      // (50 > 30), so all three read 0% and the flow surfaces as an
      // Overflow row instead. NOT the frozen 66%/100% from
      // result.metrics.bandCoverage.
      expect(screen.getByTestId("service-stats-band-10")).toHaveTextContent("0%");
      expect(screen.getByTestId("service-stats-band-20")).toHaveTextContent("0%");
      expect(screen.getByTestId("service-stats-band-30")).toHaveTextContent("0%");
      const overflowRow = screen.getByTestId("service-stats-band--1");
      expect(overflowRow).toHaveTextContent("> 30 km");
      expect(overflowRow).toHaveTextContent("100%");
      expect(screen.queryByTestId("service-stats-band-600")).not.toBeInTheDocument();
      // Chen's separate coverage-% KPI block is untouched by this change.
      expect(screen.getByTestId("service-stats-coverage-pct")).toHaveTextContent("66.67 %");
    });

    it("JADE (two-echelon-jade-us) is unchanged — still warehouse_to_customer edges only", () => {
      const inboundEdge = { fromId: "p1", toId: "w1", leg: "plant_to_warehouse" as const, productId: "product-1", flow: 99_999, distance: 10 };
      const outboundEdges = [
        { fromId: "w1", toId: "c1", leg: "warehouse_to_customer" as const, flow: 100, distance: 50 },
        { fromId: "w1", toId: "c2", leg: "warehouse_to_customer" as const, flow: 900, distance: 250 },
      ];
      render(
        <ServiceStatsTab
          result={{ ...result, edges: [inboundEdge, ...outboundEdges] }}
          scenarioId={1}
          modelId="two-echelon-jade-us"
          presentationBands={[100, 300]}
        />,
      );
      expect(screen.getByTestId("service-stats-band-100")).toHaveTextContent("10%");
      expect(screen.getByTestId("service-stats-band-300")).toHaveTextContent("100%");
    });
  });
});

// chen-bands-units, T13, Part D — ServiceStatsTab's own display-unit
// contract: every band boundary/distance/unit label routes through
// `useDisplayUnit()`; the `OVERFLOW_BAND = -1` row is a categorical
// sentinel and is NEVER itself converted (only the real boundary distance
// shown alongside it, `maxBoundary`, converts).
describe("ServiceStatsTab — Part D display-unit contract", () => {
  it("renders boundaries in the display unit; the -1 overflow row is never converted", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    const jadeResult = {
      ...result,
      metrics: {
        bandCoverage: [
          { band: 600, percent: 66 },
          { band: -1, percent: 15 },
        ],
      },
    };
    render(<ServiceStatsTab result={jadeResult} scenarioId={1} modelId="chens-cosmetics-cn" />);
    // 600 km displayed in mi: 600 / 1.609344 = 372.8227 (rounded to 4dp).
    expect(screen.getByTestId("service-stats-band-600")).toHaveTextContent("≤ 372.8227 mi");
    const overflowRow = screen.getByTestId("service-stats-band--1");
    // The overflow row's shown boundary (600, the max REAL boundary) is
    // converted exactly the same way — never the literal sentinel `-1`
    // itself (that would produce a nonsense negative distance).
    expect(overflowRow).toHaveTextContent("> 372.8227 mi");
    expect(overflowRow).not.toHaveTextContent("-1");
    expect(overflowRow).toHaveTextContent("15%");
  });

  it("renders a disabled placeholder and computes nothing until the Chen manifest resolves", () => {
    // A modelId that isn't in the mocked models list at all — the same
    // "unresolved" state as a manifest still loading.
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="not-a-real-model"  />);
    expect(screen.getByTestId("service-stats-unit-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("service-stats-band-200")).not.toBeInTheDocument();
  });
});
