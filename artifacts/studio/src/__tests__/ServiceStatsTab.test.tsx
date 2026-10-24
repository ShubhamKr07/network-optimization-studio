import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as exportEntity from "@/lib/exportEntity";
import { UnitProvider } from "@/contexts/UnitContext";
import { ExportProvider } from "@/contexts/ExportContext";
import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { chooseDownload } from "@/__tests__/helpers/downloadMenu";

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

// SCU-1.2 — the percent cell alone (the last span of a band row: label, bar div,
// percent). Row text concatenates label + percent ("200–400 mi15%"), so a
// bare toHaveTextContent("0%") would also match "10%"/"100%".
// DU-2.2: the label cell now nests BandLabel's spans, so the percent cell is the row's LAST span.
const percentOf = (testId: string) => { const spans = screen.getByTestId(testId).querySelectorAll("span"); return spans[spans.length - 1]?.textContent; };

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
    // C4.14 / CH4O-8 — Al's Athletics Max Coverage reports distances in
    // miles (§2.1); it was this repo's only km model.
    { id: "max-coverage-us", distanceUnit: "mi", capabilities: { supportsPlantProductCapability: false } },
    // Task 12 (Chapter 5, delivery-teaching-us) — R7 row 28's guard.
    { id: "delivery-teaching-us", distanceUnit: "mi", capabilities: { supportsPlantProductCapability: false } },
    // CH4O-8 — a FICTIONAL km-canonical model. Every real model is "mi"-
    // canonical now (max-coverage-us was the last km one), so the only way to
    // keep covering the cross-unit display path is a synthetic entry. Same
    // precedent as OutputMapTab.test.tsx's "two-echelon-fake-km". Without it
    // the Part D conversion test below would run canonical==display and become
    // an assertion that cannot fail.
    { id: "synthetic-km-model", distanceUnit: "km", capabilities: { supportsPlantProductCapability: false } },
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
    // frozen cumulative [200:30, 400:45] -> exclusive 30 / 15 / overflow 55
    expect(percentOf("service-stats-band-200")).toBe("30%");
    expect(percentOf("service-stats-band-400")).toBe("15%");
    expect(percentOf("service-stats-band--1")).toBe("55%");
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
    chooseDownload("button-download-service-stats", "button-download-service-stats-csv");
    expect(spy).toHaveBeenCalledWith(1, "serviceStats", "csv", { unit: "mi" });
  });

  // Task 14b — production-control assertions.
  describe("useExport() disabled-reason wiring (Task 14b)", () => {
    it("is disabled with the reason surfaced for a result entity when the displayed entry has no runId", () => {
      rtlRender(
        <UnitProvider>
          <ExportProvider value={makeExportProviderValue({ resultDisabledReason: "No run recorded for this entry." })}>
            <ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />
          </ExportProvider>
        </UnitProvider>,
      );
      const button = screen.getByTestId("button-download-service-stats");
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "No run recorded for this entry.");
    });

    it("forwards runId when an older history entry is displayed", () => {
      const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
      rtlRender(
        <UnitProvider>
          <ExportProvider value={makeExportProviderValue({ runId: 5 })}>
            <ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />
          </ExportProvider>
        </UnitProvider>,
      );
      chooseDownload("button-download-service-stats", "button-download-service-stats-csv");
      expect(spy).toHaveBeenCalledWith(1, "serviceStats", "csv", { unit: "mi", runId: 5 });
    });
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
  // never assume a unit, ever (a scenario in a non-mi unit transiently
  // rendered as "mi" is a correct number under a WRONG unit, reading as fact).
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
    const spans = row.querySelectorAll("span");
    const bandCell = spans[0];
    const percentCell = spans[spans.length - 1];
    expect(bandCell).toHaveClass("font-mono");
    expect(percentCell).toHaveClass("font-mono");
  });

  // jade-T14 / SCU-1.2 (deviation 1) — JADE's frozen bandCoverage is
  // EXCLUSIVE (solve.py:1320-1327, :1381-1385). Fixture = a real local run of
  // test_jade.GROUND_TRUTH_INPUTS with bands [200,400,800,1200]: it sums to
  // 101, so the residual rule takes 1 from the largest row (31 -> 30).
  describe("Chapter 9 JADE — exclusive frozen coverage + explicit overflow row", () => {
    const jadeResult = {
      ...result,
      metrics: {
        bandCoverage: [
          { band: 200, percent: 21 },
          { band: 400, percent: 12 },
          { band: 800, percent: 31 },
          { band: 1200, percent: 25 },
          { band: -1, percent: 12 },
        ],
      },
    };

    it("renders the exclusive shares at every boundary (not re-differenced)", () => {
      render(<ServiceStatsTab result={jadeResult} scenarioId={1} modelId="two-echelon-jade-us" />);
      expect(percentOf("service-stats-band-200")).toBe("21%");
      expect(percentOf("service-stats-band-400")).toBe("12%");
      expect(percentOf("service-stats-band-800")).toBe("30%");
      expect(percentOf("service-stats-band-1200")).toBe("25%");
    });

    it("renders a separately labelled '> 1200 mi' overflow row, not folded into the 1200 row", () => {
      render(<ServiceStatsTab result={jadeResult} scenarioId={1} modelId="two-echelon-jade-us" />);
      const overflowRow = screen.getByTestId("service-stats-band--1");
      expect(overflowRow).toHaveTextContent("> 1,200 mi");
      expect(percentOf("service-stats-band--1")).toBe("12%");
      expect(screen.getByTestId("service-stats-band-1200")).toHaveTextContent("800–1,200 mi");
    });

    it("always renders the overflow row, at 0% when nothing exceeds the last boundary", () => {
      render(<ServiceStatsTab result={{ ...result, metrics: { bandCoverage: [{ band: 200, percent: 30 }, { band: 400, percent: 100 }] } }} scenarioId={1} modelId="p-median-us" />);
      expect(percentOf("service-stats-band--1")).toBe("0%");
    });
  });

  // CH4O-10 (decisions 5-8) — the coverage KPI block (Coverage %, Covered
  // demand, Uncovered %, Avg service distance) that used to live here moved
  // to Solution Summary (CostSummaryTab.test.tsx). After the move this
  // block is absent for EVERY result, not just non-Chapter-4 ones -- a
  // strictly stronger claim than the one this replaces (which only checked
  // a non-Chen model never got it).
  describe("Solution Summary move — no coverage KPI block here (CH4O-10)", () => {
    const ch4Result = {
      status: "optimal" as const, objective: 66.6667, runTimeSec: 0.3, quality: "optimal",
      edges: [],
      // band at 450 matches the high-service cutoff this fixture's sibling
      // in CostSummaryTab.test.tsx uses, so "the band graph stays" is proven
      // against the SAME cutoff the moved KPI rows now describe.
      metrics: { weightedAvgDistance: 812.4, bandCoverage: [{ band: 450, percent: 66 }, { band: 5000, percent: 100 }] },
      details: { objective: "coverage", coveragePct: 66.6667, coveredDemand: 131645389, uncoveredPct: 33.3333 },
      solverUsed: "CBC", infeasibilityReason: null,
    };

    it("renders no coverage KPI block at all", () => {
      render(<ServiceStatsTab result={ch4Result} scenarioId={1} modelId="max-coverage-us" />);
      expect(screen.queryByTestId("service-stats-coverage-kpis")).not.toBeInTheDocument();
      expect(screen.getByTestId("service-stats-band-450")).toBeInTheDocument(); // band graph stays
    });

    it("still renders the existing band rows (unaffected by the KPI block's removal)", () => {
      render(<ServiceStatsTab result={ch4Result} scenarioId={1} modelId="max-coverage-us" />);
      expect(screen.getByTestId("service-stats-band-450")).toHaveTextContent("66%");
      expect(percentOf("service-stats-band-5000")).toBe("34%");
    });

    it("renders no coverage KPI block for a non-Chapter-4 model either (no regression)", () => {
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

  // B4 (spec §2 R2-3/§6) — JADE two-leg band-coverage recompute: exclusive,
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

    it("recomputes exclusive coverage from live bands over warehouse_to_customer edges only, excluding inbound flow", () => {
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
      expect(percentOf("service-stats-band-100")).toBe("10%");
      expect(percentOf("service-stats-band-300")).toBe("20%");
      expect(percentOf("service-stats-band-600")).toBe("30%");
      expect(percentOf("service-stats-band-1000")).toBe("0%");
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
      expect(overflowRow).toHaveTextContent("> 1,000 mi");
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
      expect(percentOf("service-stats-band-200")).toBe("30%");
      expect(percentOf("service-stats-band-400")).toBe("15%");
    });

    it("JADE itself keeps the frozen bars when presentationBands is not wired yet", () => {
      render(<ServiceStatsTab result={result} scenarioId={1} modelId="two-echelon-jade-us" />);
      expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("30%");
    });
  });

  // SSC-T1 (spec §4/§5) — non-JADE ServiceStats live coverage: the 4
  // distance-band models (us/brazil/transport/gold-au) now recompute live
  // from presentationBands the same way JADE already does, generalized
  // off the JADE-only gate. max-coverage-us stays frozen.
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
      expect(percentOf("service-stats-band-100")).toBe("10%");
      expect(percentOf("service-stats-band-300")).toBe("20%");
      expect(percentOf("service-stats-band-600")).toBe("30%");
      expect(percentOf("service-stats-band-1000")).toBe("0%");
      const overflowRow = screen.getByTestId("service-stats-band--1");
      expect(overflowRow).toHaveTextContent("> 1,000 mi");
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
      expect(percentOf("service-stats-band-300")).toBe("90%");
      expect(percentOf("service-stats-band--1")).toBe("0%");
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
    // mi-labelled as of CH4O-8). CH4O-10 moved Chen's SEPARATE
    // `details.coveragePct` KPI block to Solution Summary entirely — this
    // test now only concerns which source the band-coverage BARS read from.
    it("max-coverage-us now computes bandCoverage LIVE once presentationBands is wired (Part A guard deleted)", () => {
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
          modelId="max-coverage-us"
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
      expect(overflowRow).toHaveTextContent("> 30 mi");
      expect(overflowRow).toHaveTextContent("100%");
      expect(screen.queryByTestId("service-stats-band-600")).not.toBeInTheDocument();
      // CH4O-10 — the coverage-% KPI block no longer lives in this
      // component at all (moved to Solution Summary).
      expect(screen.queryByTestId("service-stats-coverage-pct")).not.toBeInTheDocument();
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
      expect(percentOf("service-stats-band-300")).toBe("90%");
    });
  });
});

// Task 12 (Chapter 5, delivery-teaching-us), R7 row 28's guard — spec §5.7
// pins 2 dp for this model only; the other five models' bars stay integers.
describe("ServiceStatsTab — delivery-teaching-us band precision (Task 12)", () => {
  // flows 1 and 2 across a 400 boundary: 1/(1+2) = 33.33%, not 33%.
  const nonIntegerEdges = [
    { fromId: "W1", toId: "C1", flow: 1, distance: 100 },
    { fromId: "W2", toId: "C2", flow: 2, distance: 900 },
  ];

  it("shows 33.33% (2 dp) for delivery-teaching-us", () => {
    render(
      <ServiceStatsTab
        result={{ ...result, edges: nonIntegerEdges }}
        scenarioId={1}
        modelId="delivery-teaching-us"
        presentationBands={[400, 1600]}
      />,
    );
    expect(screen.getByTestId("service-stats-band-400")).toHaveTextContent("33.33%");
  });

  it("a sibling model with the SAME edges/bands still shows 33% (integer, unchanged)", () => {
    render(
      <ServiceStatsTab
        result={{ ...result, edges: nonIntegerEdges }}
        scenarioId={1}
        modelId="p-median-us"
        presentationBands={[400, 1600]}
      />,
    );
    expect(screen.getByTestId("service-stats-band-400")).toHaveTextContent("33%");
    expect(screen.getByTestId("service-stats-band-400")).not.toHaveTextContent("33.33%");
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
    // CH4O-8 — drives the FICTIONAL km-canonical model, not max-coverage-us:
    // that model is "mi"-canonical now, so with pref "mi" the conversion would
    // be the identity and this test could not fail.
    render(<ServiceStatsTab result={jadeResult} scenarioId={1} modelId="synthetic-km-model" />);
    // 600 km displayed in mi: 600 / 1.609344 = 372.8227 (rounded to 4dp).
    expect(screen.getByTestId("service-stats-band-600")).toHaveTextContent("≤ 372.82 mi");
    const overflowRow = screen.getByTestId("service-stats-band--1");
    // The overflow row's shown boundary (600, the max REAL boundary) is
    // converted exactly the same way — never the literal sentinel `-1`
    // itself (that would produce a nonsense negative distance).
    expect(overflowRow).toHaveTextContent("> 372.82 mi");
    expect(overflowRow).not.toHaveTextContent("-1");
    expect(percentOf("service-stats-band--1")).toBe("34%");
  });

  it("renders a disabled placeholder and computes nothing until the Chen manifest resolves", () => {
    // A modelId that isn't in the mocked models list at all — the same
    // "unresolved" state as a manifest still loading.
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="not-a-real-model"  />);
    expect(screen.getByTestId("service-stats-unit-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("service-stats-band-200")).not.toBeInTheDocument();
  });
});

// SCU-1.2 (review fold 2) — LIVE exclusive rows from populated edges: every
// edge classified by assignBandOrOverflow, rows + always-present overflow,
// range labels; two-echelon excludes the inbound leg yet shows real
// (non-zero) overflow from the outbound leg.
describe("ServiceStatsTab — live exclusive rows from populated edges (SCU-1.2)", () => {
  const ids = (bands: string[]) => bands.map(b => `service-stats-band-${b}`);

  it("single-echelon: boundary-equal and zero-distance edges land low; overflow carries the far edge", () => {
    const edges = [
      { fromId: "w1", toId: "c1", flow: 250, distance: 0 },
      { fromId: "w1", toId: "c2", flow: 250, distance: 200 },
      { fromId: "w2", toId: "c3", flow: 300, distance: 350 },
      { fromId: "w2", toId: "c4", flow: 200, distance: 5000 },
    ];
    render(<ServiceStatsTab result={{ ...result, edges }} scenarioId={1} modelId="p-median-us" presentationBands={[200, 400, 800]} />);
    const rows = ids(["200", "400", "800", "-1"]);
    expect(rows.map(percentOf)).toEqual(["50%", "30%", "0%", "20%"]);
    expect(rows.map(id => screen.getByTestId(id).querySelector("span")!.textContent)).toEqual(["≤ 200 mi", "200–400 mi", "400–800 mi", "> 800 mi"]);
  });

  it("two-echelon: the inbound mine_to_refinery leg is excluded; outbound rows + non-zero overflow", () => {
    const edges = [
      { fromId: "m1", toId: "r1", leg: "mine_to_refinery" as const, flow: 99_999, distance: 10 },
      { fromId: "r1", toId: "c1", leg: "refinery_to_customer" as const, flow: 100, distance: 50 },
      { fromId: "r1", toId: "c2", leg: "refinery_to_customer" as const, flow: 900, distance: 250 },
      { fromId: "r1", toId: "c3", leg: "refinery_to_customer" as const, flow: 300, distance: 2000 },
    ];
    render(<ServiceStatsTab result={{ ...result, edges }} scenarioId={1} modelId="two-echelon-gold-au" presentationBands={[100, 300]} />);
    // outbound total 1300: 100/1300 -> 8, 900/1300 -> 69, 300/1300 -> 23 (sum 100; computed)
    expect(ids(["100", "300", "-1"]).map(percentOf)).toEqual(["8%", "69%", "23%"]);
  });
});

describe("ServiceStatsTab — no duplicate title (SCU-1.4)", () => {
  it("renders no 'Service Stats' title and keeps Download right-aligned", () => {
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    expect(screen.queryByText("Service Stats")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-download-service-stats").closest("div.border-b")).toHaveClass("justify-end");
  });
});

// SCU-2.P3.9 (spec B2.1/B2.2/B2.4, matrix §2a "ServiceStats Plant
// Production") — Plant Production on DataTable + the tab-level Download ▾.
// Own fixture (4 plants × 4 products = 16 rows, the real JADE shape).
describe("ServiceStatsTab Plant Production on DataTable — testid map (SCU-2.P3.9)", () => {
  const plants = ["p1", "p2", "p3", "p4"].map((id, i) => ({ id, name: `Plant ${i + 1}`, city: `City${i + 1}`, state: "ST", lat: 0, lng: 0 }));
  const products = ["product-1", "product-2", "product-3", "product-4"].map((id, i) => ({ id, name: `Product ${i + 1}` }));
  const baseCapabilities = plants.flatMap((pl, pi) => products.map((pr, ki) => ({ plantId: pl.id, productId: pr.id, capacity: pi === ki ? 1000 : 0 })));
  const jade = {
    ...result,
    metrics: {},
    edges: [{ fromId: "p1", toId: "w1", leg: "plant_to_warehouse" as const, productId: "product-1", flow: 400, distance: 10 }],
  };
  const renderJade = () =>
    render(
      <ServiceStatsTab result={jade} scenarioId={1} modelId="two-echelon-jade-us" effectivePlants={plants} products={products} baseCapabilities={baseCapabilities} />,
    );

  it("section root contains the title, filter trigger and the exact thead contract", () => {
    renderJade();
    const section = screen.getByTestId("plant-production-section");
    expect(section).toHaveTextContent("Plant Production");
    expect(section).toContainElement(screen.getByTestId("button-filter-menu-trigger"));
    const heads = [...section.querySelectorAll("thead th")];
    expect(heads.map(h => h.textContent)).toEqual(["Plant", "Product", "Actual production", "Enabled capacity", "Remaining capacity"]);
    expect(heads.map(h => h.classList.contains("text-center"))).toEqual([false, false, true, true, true]);
  });

  it("emits row-plant-production-{plant}-{product} on 16 <tr>s; remaining '—' for a disabled cell", () => {
    renderJade();
    expect(screen.getAllByTestId(/^row-plant-production-/)).toHaveLength(16);
    expect(screen.getByTestId("row-plant-production-p1-product-1").tagName).toBe("TR");
    expect(screen.getByTestId("row-plant-production-p1-product-1")).toHaveTextContent("600");
    expect(screen.getByTestId("row-plant-production-p1-product-2")).toHaveTextContent("—");
  });

  it("filter keys are today's (plant/product select, actual/capacity range) plus the derived remaining range", async () => {
    const user = userEvent.setup();
    renderJade();
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    for (const id of ["select-filter-plant", "select-filter-product", "input-filter-actual-min", "input-filter-capacity-min", "input-filter-remaining-min"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    await user.click(screen.getByTestId("checkbox-filter-plant-p1 — City1, ST"));
    expect(screen.getByTestId("text-filter-count")).toHaveTextContent("4 of 16");
    expect(screen.getAllByTestId(/^row-plant-production-/)).toHaveLength(4);
  });

  it("the tab-level states stay outside DataTable: service-stats-empty, -unit-pending, -no-bands", () => {
    const a = render(<ServiceStatsTab result={null} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-empty")).toBeInTheDocument();
    a.unmount();
    const b = render(<ServiceStatsTab result={result} scenarioId={1} modelId="model-not-in-manifest" />);
    expect(screen.getByTestId("service-stats-unit-pending")).toBeInTheDocument();
    b.unmount();
    render(<ServiceStatsTab result={{ ...result, metrics: {} }} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-no-bands")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-service-stats")).toBeInTheDocument();
  });

  it("tab-level Download ▾ offers CSV and JSON through the server serviceStats export", () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    render(<ServiceStatsTab result={result} scenarioId={1} modelId="p-median-us" />);
    chooseDownload("button-download-service-stats", "button-download-service-stats-json");
    expect(spy).toHaveBeenCalledWith(1, "serviceStats", "json", { unit: "mi" });
    spy.mockRestore();
  });
});

// SCU-2.P3.9 (user decision 2026-10-17) — band labels round like every other
// displayed distance (formatDistanceDisplay, ≤ 2 dp): a mi-canonical model
// shown in km reads "≤ 321.87 km", never "0–321.8688 km"; mi stays exact.
describe("ServiceStatsTab — band labels round in km and mi (SCU-2.P3.9)", () => {
  const banded = { ...result, metrics: { bandCoverage: [{ band: 200, percent: 30 }, { band: 400, percent: 45 }] } };

  it("km display: converted boundaries print at most 2 dp", () => {
    window.localStorage.setItem(STORAGE_KEY, "km");
    render(<ServiceStatsTab result={banded} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("≤ 321.87 km");
    expect(screen.getByTestId("service-stats-band-400")).toHaveTextContent("321.87–643.74 km");
    expect(screen.getByTestId("service-stats-band--1")).toHaveTextContent("> 643.74 km");
    expect(screen.getByTestId("service-stats-band-200")).not.toHaveTextContent("321.8688");
  });

  it("mi display: whole-number boundaries are unchanged", () => {
    window.localStorage.setItem(STORAGE_KEY, "mi");
    render(<ServiceStatsTab result={banded} scenarioId={1} modelId="p-median-us" />);
    expect(screen.getByTestId("service-stats-band-200")).toHaveTextContent("≤ 200 mi");
    expect(screen.getByTestId("service-stats-band--1")).toHaveTextContent("> 400 mi");
  });
});

// DU-2.2 (PR2-2) — `b.band` is a boundary VALUE; the BandLabel index is its position among the sorted
// boundaries (overflow -> OVERFLOW_BAND). 4 boundaries + overflow: every row's text AND swatch colour.
describe("ServiceStatsTab — BandLabel index from boundary values (DU-2.2)", () => {
  it("4 boundaries + overflow: range text and band colour per row", () => {
    const four = {
      ...result,
      metrics: { bandCoverage: [
        { band: 200, percent: 10 }, { band: 400, percent: 20 }, { band: 800, percent: 30 },
        { band: 1600, percent: 20 }, { band: -1, percent: 20 },
      ] },
    };
    // JADE's frozen shape is exclusive: rows kept as-is, explicit -1 row is the overflow.
    render(<ServiceStatsTab result={four} scenarioId={1} modelId="two-echelon-jade-us" />);
    const expected: [string, string, string][] = [
      ["200", "≤ 200 mi", "var(--band-0)"],
      ["400", "200–400 mi", "var(--band-1)"],
      ["800", "400–800 mi", "var(--band-2)"],
      ["1600", "800–1,600 mi", "var(--band-3)"],
      ["-1", "> 1,600 mi", "var(--band-overflow)"],
    ];
    for (const [id, text, colour] of expected) {
      const row = screen.getByTestId(`service-stats-band-${id}`);
      expect(row.querySelector("span")!.textContent).toBe(text);
      expect(row.querySelector("[data-band-swatch]")).toHaveStyle({ backgroundColor: colour });
    }
  });
});
