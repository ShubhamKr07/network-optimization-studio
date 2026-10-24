import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, within, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { JadeFlowsTab } from "@/components/workspace/tabs/JadeFlowsTab";
import { bandLabel, bandRangeLabel } from "@/lib/bands";
import { UnitProvider, useDisplayUnit } from "@/contexts/UnitContext";
import { ExportProvider } from "@/contexts/ExportContext";
import { AllProviders, makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";

// JadeFlowsTab now calls useDisplayUnit() unconditionally — every render
// needs a UnitProvider ancestor. Shadowing `render` keeps every existing
// call site (incl. `rerender`, which reuses the same tree) byte-identical,
// same pattern as AppShell.test.tsx's renderShell.
function render(ui: ReactElement) {
  // SCU-2.P3.5 — JadeFlowsTab reads useExport() for its download guard.
  return rtlRender(ui, { wrapper: AllProviders });
}

// jsdom does not implement URL.createObjectURL/revokeObjectURL at all, so
// vi.spyOn (which requires the property to already exist as a function)
// throws "does not exist" without this. Stub them once at module load
// (mirrors copyMapToClipboard.test.ts's own precedent) so the per-test
// vi.spyOn(URL, ...) calls below have something to wrap.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = vi.fn();
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = vi.fn();
}

// B3 (JADE Ch.9 Workspace Bundle, spec §5b) — Chapter 9 JADE's Flows tab:
// two inner tabs (Plant -> Warehouse aggregated, Warehouse -> Customer),
// each with its own FilterMenu + client-side per-leg CSV. Separate component
// from the shared `FlowsTab.tsx` (untouched by this task).

const dataset = {
  plants: [
    { id: "plant-1", city: "Bethlehem", state: "PA", lat: 1, lng: 1 },
    { id: "plant-2", city: "Houston", state: "TX", lat: 2, lng: 2 },
  ],
  warehouses: [
    { id: "wh-11", city: "Chicago", state: "IL", lat: 3, lng: 3 },
    { id: "wh-14", city: "Dallas", state: "TX", lat: 4, lng: 4 },
  ],
  customers: [
    { id: "customer-1", city: "Los Angeles", state: "CA", lat: 5, lng: 5, demand: 100 },
    { id: "customer-2", city: "New York City", state: "NY", lat: 6, lng: 6, demand: 200 },
  ],
};

const bands = [250, 500, 750, 1000];

function makeResult(edges: Array<{ fromId: string; toId: string; flow: number; distance: number; leg: "plant_to_warehouse" | "warehouse_to_customer"; productId?: string }>) {
  return {
    status: "optimal" as const,
    objective: 100,
    runTimeSec: 0.5,
    quality: "Proven optimal",
    edges,
    metrics: {},
    details: {},
    solverUsed: "CBC",
    infeasibilityReason: null,
  };
}

const jadeResult = makeResult([
  // plant-1 -> wh-11 across two products — must aggregate into ONE row,
  // flow summed 1000 + 400 = 1400, distance identical (293.66, in-range: Band 2).
  { fromId: "plant-1", toId: "wh-11", flow: 1000, distance: 293.66, leg: "plant_to_warehouse", productId: "product-1" },
  { fromId: "plant-1", toId: "wh-11", flow: 400, distance: 293.66, leg: "plant_to_warehouse", productId: "product-2" },
  // plant-2 -> wh-14, single product, overflow distance (> 1000).
  { fromId: "plant-2", toId: "wh-14", flow: 300, distance: 1200, leg: "plant_to_warehouse", productId: "product-1" },
  // Outbound: one row per customer, no productId, already aggregated at the envelope layer.
  { fromId: "wh-11", toId: "customer-1", flow: 500, distance: 42.1, leg: "warehouse_to_customer" },
  { fromId: "wh-14", toId: "customer-2", flow: 300, distance: 1200, leg: "warehouse_to_customer" },
]);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("JadeFlowsTab", () => {
  it("shows an empty-state message when result is null", () => {
    render(<JadeFlowsTab result={null} />);
    expect(screen.getByTestId("jade-flows-empty")).toBeInTheDocument();
  });

  it("defaults to the Plant -> Warehouse inner tab", () => {
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
    expect(screen.getByTestId("jade-flows-pw-table")).toBeInTheDocument();
    expect(screen.getByTestId("jade-flows-wc-table")).not.toBeVisible(); // SCU-2.P3.6: kept mounted, hidden
  });

  it("switches to the Warehouse -> Customer inner tab on click", async () => {
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.getByTestId("jade-flows-wc-table")).toBeInTheDocument();
    expect(screen.getByTestId("jade-flows-pw-table")).not.toBeVisible(); // SCU-2.P3.5: kept mounted (filters survive a leg switch), hidden
  });

  describe("Plant -> Warehouse", () => {
    it("renders exact columns in order: Plant, Warehouse, Distance, Flow, Distance Band", () => {
      render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
      const headers = within(screen.getByTestId("jade-flows-pw-table"))
        .getAllByRole("columnheader")
        .map(h => h.textContent);
      expect(headers).toEqual(["Plant", "Warehouse", "Distance", "Flow", "Distance Band"]);
    });

    it("aggregates edges across productId into one row per (plant, warehouse) pair — no per-product duplication", () => {
      render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
      const rows = screen.getAllByTestId(/^jade-flow-pw-row-/);
      expect(rows).toHaveLength(2); // plant-1/wh-11 (aggregated) + plant-2/wh-14
      const aggregatedRow = screen.getByTestId("jade-flow-pw-row-plant-1-wh-11");
      expect(aggregatedRow).toHaveTextContent("1,400"); // 1000 + 400, toLocaleString
    });

    it("does not show Product or Transport Cost columns", () => {
      render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
      const headers = within(screen.getByTestId("jade-flows-pw-table"))
        .getAllByRole("columnheader")
        .map(h => h.textContent)
        .join(" ");
      expect(headers).not.toMatch(/product/i);
      expect(headers).not.toMatch(/transport cost/i);
    });

    it("renders plant/warehouse names via dataset city/state", () => {
      render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
      const row = screen.getByTestId("jade-flow-pw-row-plant-1-wh-11");
      expect(row).toHaveTextContent("Bethlehem, PA");
      expect(row).toHaveTextContent("Chicago, IL");
    });

    it("falls back to the raw id when dataset can't resolve it", () => {
      const unresolvedResult = makeResult([
        { fromId: "unknown-plant", toId: "unknown-wh", flow: 10, distance: 10, leg: "plant_to_warehouse" },
      ]);
      render(<JadeFlowsTab result={unresolvedResult} dataset={dataset} bands={bands} />);
      const row = screen.getByTestId("jade-flow-pw-row-unknown-plant-unknown-wh");
      expect(row).toHaveTextContent("unknown-plant");
      expect(row).toHaveTextContent("unknown-wh");
    });

    it("formats Distance with .toFixed(1) and the distanceUnit suffix", () => {
      render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
      const row = screen.getByTestId("jade-flow-pw-row-plant-1-wh-11");
      expect(row).toHaveTextContent("293.7 mi");
    });

    // chen-bands-units, Part D "No fallback unit — reads": no `distanceUnit`
    // passed means the canonical unit is unresolved — the Distance cell must
    // show a loading placeholder, never a guessed "mi".
    it("shows a Distance placeholder — never a value or a guessed 'mi' — when distanceUnit is not resolved", () => {
      render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
      const row = screen.getByTestId("jade-flow-pw-row-plant-1-wh-11");
      expect(row).not.toHaveTextContent("293.7 mi");
      expect(row).not.toHaveTextContent("293.7");
      expect(row).toHaveTextContent("—");
    });

    it("Distance Band matches the shared bandLabel helper, for both an in-range and an overflow distance", () => {
      render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
      const inRangeRow = screen.getByTestId("jade-flow-pw-row-plant-1-wh-11"); // 293.66 mi
      const overflowRow = screen.getByTestId("jade-flow-pw-row-plant-2-wh-14"); // 1200 mi > 1000
      expect(inRangeRow).toHaveTextContent(bandLabel(293.66, bands));
      expect(overflowRow).toHaveTextContent(bandLabel(1200, bands));
      expect(overflowRow).toHaveTextContent("Overflow");
    });
  });

  describe("Warehouse -> Customer", () => {
    async function renderOnWc() {
      const user = userEvent.setup();
      render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
      await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
      return user;
    }

    it("renders exact columns in order: Warehouse, Customer, Distance, Flows, Distance Band — 'Flows' label exact", async () => {
      await renderOnWc();
      const headers = within(screen.getByTestId("jade-flows-wc-table"))
        .getAllByRole("columnheader")
        .map(h => h.textContent);
      expect(headers).toEqual(["Warehouse", "Customer", "Distance", "Flows", "Distance Band"]);
      expect(headers[3]).toBe("Flows");
    });

    it("renders one row per customer edge, already aggregated at the envelope layer", async () => {
      await renderOnWc();
      const rows = screen.getAllByTestId(/^jade-flow-wc-row-/);
      expect(rows).toHaveLength(2);
      expect(screen.getByTestId("jade-flow-wc-row-wh-11-customer-1")).toBeInTheDocument();
      expect(screen.getByTestId("jade-flow-wc-row-wh-14-customer-2")).toBeInTheDocument();
    });

    it("renders warehouse/customer names via dataset city/state", async () => {
      await renderOnWc();
      const row = screen.getByTestId("jade-flow-wc-row-wh-11-customer-1");
      expect(row).toHaveTextContent("Chicago, IL");
      expect(row).toHaveTextContent("Los Angeles, CA");
    });

    it("Distance Band matches the shared bandLabel helper, for both an in-range and an overflow distance", async () => {
      await renderOnWc();
      const inRangeRow = screen.getByTestId("jade-flow-wc-row-wh-11-customer-1"); // 42.1 mi
      const overflowRow = screen.getByTestId("jade-flow-wc-row-wh-14-customer-2"); // 1200 mi > 1000
      expect(inRangeRow).toHaveTextContent(bandLabel(42.1, bands));
      expect(overflowRow).toHaveTextContent(bandLabel(1200, bands));
      expect(overflowRow).toHaveTextContent("Overflow");
    });
  });

  it("falls back to DEFAULT_DISTANCE_BANDS when bands is empty/absent", () => {
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} />);
    // DEFAULT_DISTANCE_BANDS = [250, 500, 750]; 293.66 mi -> Band 2.
    const row = screen.getByTestId("jade-flow-pw-row-plant-1-wh-11");
    expect(row).toHaveTextContent("Band 2");
  });

  describe("Per-inner-tab FilterMenu visibility (>10 rule, independent per tab)", () => {
    function manyPwEdges(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        fromId: `plant-${i}`,
        toId: `wh-${i}`,
        flow: 10 + i,
        distance: 100 + i,
        leg: "plant_to_warehouse" as const,
      }));
    }
    function fewWcEdges(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        fromId: `wh-${i}`,
        toId: `customer-${i}`,
        flow: 10 + i,
        distance: 100 + i,
        leg: "warehouse_to_customer" as const,
      }));
    }

    it("hides the FilterMenu on Plant -> Warehouse when unfiltered row count is <= 10", () => {
      render(<JadeFlowsTab result={makeResult(manyPwEdges(10))} dataset={dataset} bands={bands} />);
      expect(screen.queryByTestId("button-filter-jade-flows-pw")).not.toBeInTheDocument();
    });

    it("shows the FilterMenu on Plant -> Warehouse when unfiltered row count is > 10", () => {
      render(<JadeFlowsTab result={makeResult(manyPwEdges(11))} dataset={dataset} bands={bands} />);
      expect(screen.getByTestId("button-filter-jade-flows-pw")).toBeInTheDocument();
    });

    it("Plant -> Warehouse crossing >10 does NOT show the FilterMenu on the Warehouse -> Customer tab when its own row count stays <= 10", async () => {
      const user = userEvent.setup();
      const result = makeResult([...manyPwEdges(11), ...fewWcEdges(2)]);
      render(<JadeFlowsTab result={result} dataset={dataset} bands={bands} />);
      // Confirm PW is over threshold first.
      expect(screen.getByTestId("button-filter-jade-flows-pw")).toBeInTheDocument();
      await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
      expect(screen.queryByTestId("button-filter-jade-flows-wc")).not.toBeInTheDocument();
    });

    it("filtering via the FilterMenu narrows the visible Plant -> Warehouse rows and updates the count line", async () => {
      const user = userEvent.setup();
      // flow = 10 + i for i in 0..10 -> flows 10..20 (11 rows).
      render(<JadeFlowsTab result={makeResult(manyPwEdges(11))} dataset={dataset} bands={bands} />);
      await user.click(screen.getByTestId("button-filter-jade-flows-pw"));
      const popover = screen.getByTestId("filter-menu-popover");
      // Number filter (inclusive min) on Flow: min=15 excludes flows 10..14
      // (5 rows), leaving 15..20 (6 rows).
      await user.type(within(popover).getByTestId("input-filter-flow-min"), "15");
      expect(screen.getByTestId("text-jadeflows-pw-count")).toHaveTextContent("6 of 11");
    });
  });


  // Workspace fixups bundle (T6, item 2) — the P->W Plant column resolves via
  // the shared `plantIdCityState` helper ("<id> — City, State") against
  // `effectivePlants ?? dataset?.plants ?? []`.
  describe("Item 2: plant id + City, State (effectivePlants)", () => {
    it("P -> W Plant column shows exactly '<id> — <City>, <State>' for a base dataset plant", () => {
      render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
      expect(screen.getByTestId("jade-flow-pw-row-plant-1-wh-11")).toHaveTextContent("plant-1 — Bethlehem, PA");
    });

    it("resolves an added-plant edge via the effectivePlants prop to id + City, State, not the raw id", () => {
      const addedPlantResult = makeResult([
        { fromId: "aw-plant-9", toId: "wh-11", flow: 50, distance: 42.1, leg: "plant_to_warehouse" },
      ]);
      render(
        <JadeFlowsTab
          result={addedPlantResult}
          dataset={dataset}
          bands={bands}
          effectivePlants={[{ id: "aw-plant-9", city: "Denver", state: "CO", lat: 0, lng: 0 }]}
        />,
      );
      const row = screen.getByTestId("jade-flow-pw-row-aw-plant-9-wh-11");
      expect(row).toHaveTextContent("aw-plant-9 — Denver, CO");
    });

    it("falls back to the raw id when effectivePlants is provided but doesn't contain the edge's plant", () => {
      const addedPlantResult = makeResult([
        { fromId: "unresolved-plant", toId: "wh-11", flow: 50, distance: 42.1, leg: "plant_to_warehouse" },
      ]);
      render(
        <JadeFlowsTab
          result={addedPlantResult}
          dataset={dataset}
          bands={bands}
          effectivePlants={[{ id: "aw-plant-9", city: "Denver", state: "CO", lat: 0, lng: 0 }]}
        />,
      );
      expect(screen.getByTestId("jade-flow-pw-row-unresolved-plant-wh-11")).toHaveTextContent("unresolved-plant");
    });

    it("rerendering with the SAME result+dataset+plant id but CHANGED City/State in effectivePlants updates the P -> W label (proves the label-field memo signature, not just plant-id membership)", () => {
      const initialPlants = [
        { id: "plant-1", city: "Bethlehem", state: "PA", lat: 1, lng: 1 },
        { id: "plant-2", city: "Houston", state: "TX", lat: 2, lng: 2 },
      ];
      const { rerender } = render(
        <JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} effectivePlants={initialPlants} />,
      );
      expect(screen.getByTestId("jade-flow-pw-row-plant-1-wh-11")).toHaveTextContent("plant-1 — Bethlehem, PA");

      // Same result/dataset references, same plant-1 id — only City/State changed.
      const movedPlants = [
        { id: "plant-1", city: "Reading", state: "PA", lat: 1, lng: 1 },
        { id: "plant-2", city: "Houston", state: "TX", lat: 2, lng: 2 },
      ];
      rerender(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} effectivePlants={movedPlants} />);
      expect(screen.getByTestId("jade-flow-pw-row-plant-1-wh-11")).toHaveTextContent("plant-1 — Reading, PA");
    });
  });

  // Workspace fixups bundle (T6, item 5) — the Distance Band filter option
  // values (NOT the table cell, which stays "Band N"/"Overflow") become
  // unit-aware ranges, recompute live on a bands/unit change, and clear their
  // own stale selection independently per inner table.
  describe("Item 5: live distance-band range filters (both inner tables)", () => {
    const spreadBands = [250, 500, 750, 1000];

    function bandSpreadPwEdges(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        fromId: `plant-${i}`,
        toId: `wh-${i}`,
        flow: 10 + i,
        distance: 100 + i * 150,
        leg: "plant_to_warehouse" as const,
      }));
    }
    function bandSpreadWcEdges(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        fromId: `wh-${i}`,
        toId: `customer-${i}`,
        flow: 10 + i,
        distance: 100 + i * 150,
        leg: "warehouse_to_customer" as const,
      }));
    }
    // Both helpers above, with bands=[250,500,750,1000], produce the same 5
    // distinct range labels in first-seen order for either leg.
    const expectedRangeLabels = [
      "Band 1: 0 mi - 250 mi",
      "Band 2: 250 mi - 500 mi",
      "Band 3: 500 mi - 750 mi",
      "Band 4: 750 mi - 1,000 mi",
      "Band 5: > 1,000 mi",
    ];

    it("both inner tables' Distance Band filter dropdown lists unit-aware, band-numbered ranges", async () => {
      const user = userEvent.setup();
      const spreadResult = makeResult([...bandSpreadPwEdges(11), ...bandSpreadWcEdges(11)]);
      render(<JadeFlowsTab result={spreadResult} bands={spreadBands} distanceUnit="mi" />);

      await user.click(screen.getByTestId("button-filter-jade-flows-pw"));
      let popover = screen.getByTestId("filter-menu-popover");
      let labels = within(popover)
        .getAllByTestId(/^option-filter-band-/)
        .map(el => el.textContent);
      expect(labels).toEqual(expectedRangeLabels);
      await user.keyboard("{Escape}");

      await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
      await user.click(screen.getByTestId("button-filter-jade-flows-wc"));
      popover = screen.getByTestId("filter-menu-popover");
      labels = within(popover)
        .getAllByTestId(/^option-filter-band-/)
        .map(el => el.textContent);
      expect(labels).toEqual(expectedRangeLabels);
    });

    it("table cells still read 'Band N'/'Overflow' even though the filter options are ranges", () => {
      const spreadResult = makeResult(bandSpreadPwEdges(11));
      render(<JadeFlowsTab result={spreadResult} bands={spreadBands} distanceUnit="mi" />);
      expect(screen.getByTestId("jade-flow-pw-row-plant-0-wh-0")).toHaveTextContent(bandLabel(100, spreadBands));
    });

    it("editing bands re-ranges the filter options live on a rerender, with no re-solve/network call (proves the memo-deps fix)", async () => {
      const user = userEvent.setup();
      const spreadResult = makeResult(bandSpreadPwEdges(11));
      const { rerender } = render(<JadeFlowsTab result={spreadResult} bands={spreadBands} distanceUnit="mi" />);

      // JadeFlowsTab performs no data fetching at all (pure-props component)
      // — there is nothing to spy on for "no network call"; the memo-deps fix
      // is proven by the options actually changing on a plain prop rerender.
      rerender(<JadeFlowsTab result={spreadResult} bands={[1000]} distanceUnit="mi" />);

      await user.click(screen.getByTestId("button-filter-jade-flows-pw"));
      const popover = screen.getByTestId("filter-menu-popover");
      const labels = within(popover)
        .getAllByTestId(/^option-filter-band-/)
        .map(el => el.textContent);
      expect(labels).toEqual(["Band 1: 0 mi - 1,000 mi", "Band 2: > 1,000 mi"]);
    });

    it("selecting a range in EACH inner table, then changing bands, clears only that table's own band filter — non-band filters survive and the two clears are independent", async () => {
      const user = userEvent.setup();
      const spreadResult = makeResult([...bandSpreadPwEdges(11), ...bandSpreadWcEdges(11)]);
      const { rerender } = render(<JadeFlowsTab result={spreadResult} bands={spreadBands} distanceUnit="mi" />);

      // Plant -> Warehouse: select a band range + a non-band (flow) filter.
      await user.click(screen.getByTestId("button-filter-jade-flows-pw"));
      let popover = screen.getByTestId("filter-menu-popover");
      await user.click(
        within(popover).getByTestId(`checkbox-filter-band-${bandRangeLabel(100, spreadBands, "mi")}`),
      );
      await user.type(within(popover).getByTestId("input-filter-flow-min"), "5");
      expect(within(popover).getByTestId("button-clear-filter-band")).toBeInTheDocument();
      expect(within(popover).getByTestId("button-clear-filter-flow")).toBeInTheDocument();
      await user.keyboard("{Escape}");

      // Warehouse -> Customer: select a DIFFERENT band range + a non-band (customer) filter.
      await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
      await user.click(screen.getByTestId("button-filter-jade-flows-wc"));
      popover = screen.getByTestId("filter-menu-popover");
      await user.click(
        within(popover).getByTestId(`checkbox-filter-band-${bandRangeLabel(1600, spreadBands, "mi")}`),
      );
      await user.type(within(popover).getByTestId("input-filter-customer"), "customer-9");
      expect(within(popover).getByTestId("button-clear-filter-band")).toBeInTheDocument();
      expect(within(popover).getByTestId("button-clear-filter-customer")).toBeInTheDocument();
      await user.keyboard("{Escape}");

      // Change bands — both tables' own "band" filter should clear.
      rerender(<JadeFlowsTab result={spreadResult} bands={[1000]} distanceUnit="mi" />);

      // Still on the Warehouse -> Customer tab: band cleared, customer filter survives.
      await user.click(screen.getByTestId("button-filter-jade-flows-wc"));
      popover = screen.getByTestId("filter-menu-popover");
      expect(within(popover).queryByTestId("button-clear-filter-band")).not.toBeInTheDocument();
      expect(within(popover).getByTestId("button-clear-filter-customer")).toBeInTheDocument();
      await user.keyboard("{Escape}");

      // Switch back to Plant -> Warehouse: its own band filter was cleared independently too, flow filter survives.
      await user.click(screen.getByTestId("button-jade-flows-inner-plant-warehouse"));
      await user.click(screen.getByTestId("button-filter-jade-flows-pw"));
      popover = screen.getByTestId("filter-menu-popover");
      expect(within(popover).queryByTestId("button-clear-filter-band")).not.toBeInTheDocument();
      expect(within(popover).getByTestId("button-clear-filter-flow")).toBeInTheDocument();
    });
  });

  // workspace-fixups-2, T10 (item 2) — identityById + the `>10` upgrade
  // rule, applied INDEPENDENTLY per inner table.
  describe("identityById + >10 upgrade rule (workspace-fixups-2, T10, item 2)", () => {
    // aggregatePlantToWarehouse groups by (fromId,toId) — so a helper meant
    // to control the AGGREGATED row count (`pwRows.length`) needs DISTINCT
    // (plant,warehouse) pairs, not distinct productId on the same pair (that
    // would collapse to a single row regardless of `count`). Row index 0 is
    // always the fixed (plant-1, wh-11) pair `identityById` resolves; the
    // rest are distinct filler pairs purely to inflate the row count.
    function manyPwEdgesKnownPlantWarehouse(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        fromId: i === 0 ? "plant-1" : `plant-x-${i}`,
        toId: i === 0 ? "wh-11" : `wh-x-${i}`,
        flow: 10 + i,
        distance: 100 + i,
        leg: "plant_to_warehouse" as const,
        productId: "product-1",
      }));
    }
    function manyWcEdgesKnownWarehouse(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        fromId: "wh-11",
        toId: `customer-${i}`,
        flow: 10 + i,
        distance: 100 + i,
        leg: "warehouse_to_customer" as const,
      }));
    }
    const identityById = {
      "plant-1": { city: "Bethlehem", state: "PA", displayId: "PLANT-1-CODE" },
      "wh-11": { city: "Chicago", state: "IL", displayId: "WH-CHI-01" },
    };

    it("Plant -> Warehouse: at exactly 10 unfiltered rows, keeps the pre-existing single-line label (no mono displayId yet)", () => {
      render(
        <JadeFlowsTab
          result={makeResult(manyPwEdgesKnownPlantWarehouse(10))}
          dataset={dataset}
          bands={bands}
          identityById={identityById}
        />,
      );
      // 10 distinct products on the same (plant,warehouse) pair aggregate into ONE row.
      const row = screen.getByTestId("jade-flow-pw-row-plant-1-wh-11");
      expect(row).toHaveTextContent("Bethlehem, PA");
      expect(row).not.toHaveTextContent("PLANT-1-CODE");
    });

    it("Plant -> Warehouse: at 11 unfiltered rows (crossing the boundary), upgrades to the stacked EntityIdCell with the mono displayId", () => {
      render(
        <JadeFlowsTab
          result={makeResult(manyPwEdgesKnownPlantWarehouse(11))}
          dataset={dataset}
          bands={bands}
          identityById={identityById}
        />,
      );
      const row = screen.getByTestId("jade-flow-pw-row-plant-1-wh-11");
      expect(row).toHaveTextContent("Bethlehem, PA");
      expect(row).toHaveTextContent("PLANT-1-CODE");
      expect(row).toHaveTextContent("Chicago, IL");
      expect(row).toHaveTextContent("WH-CHI-01");
    });

    it("Warehouse -> Customer: independently gated on its OWN row count — stays below its own threshold even while Plant -> Warehouse is above 10", async () => {
      const user = userEvent.setup();
      const result = makeResult([...manyPwEdgesKnownPlantWarehouse(11), ...manyWcEdgesKnownWarehouse(3)]);
      render(<JadeFlowsTab result={result} dataset={dataset} bands={bands} identityById={identityById} />);
      await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
      const row = screen.getByTestId("jade-flow-wc-row-wh-11-customer-0");
      expect(row).toHaveTextContent("Chicago, IL");
      expect(row).not.toHaveTextContent("WH-CHI-01");
    });

    it("Warehouse -> Customer: upgrades once ITS OWN row count exceeds 10, independent of Plant -> Warehouse's count", async () => {
      const user = userEvent.setup();
      const result = makeResult(manyWcEdgesKnownWarehouse(11));
      render(<JadeFlowsTab result={result} dataset={dataset} bands={bands} identityById={identityById} />);
      await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
      const row = screen.getByTestId("jade-flow-wc-row-wh-11-customer-0");
      expect(row).toHaveTextContent("Chicago, IL");
      expect(row).toHaveTextContent("WH-CHI-01");
    });

    it("shows an added CUSTOMER's AND an added FACILITY's display code via identityById once EACH leg's own row count exceeds 10", async () => {
      const user = userEvent.setup();
      // Plant -> Warehouse: 11 distinct-pair rows, one from an added facility (aw-plant-9).
      const pwEdges = [
        { fromId: "aw-plant-9", toId: "wh-11", flow: 50, distance: 42.1, leg: "plant_to_warehouse" as const },
        ...manyPwEdgesKnownPlantWarehouse(10),
      ];
      // Warehouse -> Customer: 11 rows, one to an added customer (ac-9).
      const wcEdges = [
        { fromId: "wh-11", toId: "ac-9", flow: 50, distance: 5, leg: "warehouse_to_customer" as const },
        ...manyWcEdgesKnownWarehouse(10),
      ];
      const result = makeResult([...pwEdges, ...wcEdges]);
      render(
        <JadeFlowsTab
          result={result}
          dataset={dataset}
          bands={bands}
          identityById={{
            "aw-plant-9": { city: "Denver", state: "CO", displayId: "PLANT-CO-DENVER-01" },
            "ac-9": { city: "Boise", state: "ID", displayId: "C-ID-BOISE-01" },
          }}
        />,
      );
      const pwRow = screen.getByTestId("jade-flow-pw-row-aw-plant-9-wh-11");
      expect(pwRow).toHaveTextContent("PLANT-CO-DENVER-01");
      expect(pwRow).not.toHaveTextContent("aw-plant-9");

      await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
      const wcRow = screen.getByTestId("jade-flow-wc-row-wh-11-ac-9");
      expect(wcRow).toHaveTextContent("C-ID-BOISE-01");
      expect(wcRow).not.toHaveTextContent("ac-9");
    });

    it("falls back to the pre-existing single-line label on a lookup miss, even above the 10-row threshold", () => {
      render(
        <JadeFlowsTab
          result={makeResult(manyPwEdgesKnownPlantWarehouse(11))}
          dataset={dataset}
          bands={bands}
          identityById={{ "some-other-id": { city: "X", state: "Y", displayId: "Z" } }}
        />,
      );
      const row = screen.getByTestId("jade-flow-pw-row-plant-1-wh-11");
      expect(row).toHaveTextContent("Bethlehem, PA");
      expect(row).not.toHaveTextContent("some-other-id");
    });

    it("with identityById unset, output is byte-unchanged from before this task at any row count (no-regression)", () => {
      render(<JadeFlowsTab result={makeResult(manyPwEdgesKnownPlantWarehouse(11))} dataset={dataset} bands={bands} />);
      const row = screen.getByTestId("jade-flow-pw-row-plant-1-wh-11");
      expect(row).toHaveTextContent("Bethlehem, PA");
      expect(row).not.toHaveTextContent("PLANT-1-CODE");
    });
  });
});

// SCU-1.4 — only the TAB-level "Flows" title goes; the segmented control
// (left) and the per-leg sub-table headers stay (spec B1.4).
describe("JadeFlowsTab — no duplicate tab-level title (SCU-1.4)", () => {
  it("renders no tab-level 'Flows' title but keeps the segmented control and the Download button", () => {
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
    expect(screen.queryByText("Flows", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.getByText("Warehouse → Customer")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-jade-flows-pw")).toBeInTheDocument();
  });
});

// SCU-2.P3.5 (spec B2.1/B2.2/B2.4, matrix §2a "JadeFlows P→W") — Plant ->
// Warehouse on DataTable: every testid in the instance map; Download ▾ is
// client-built and is EXACTLY the on-screen table (user decision 2026-10-17).
describe("JadeFlowsTab P→W on DataTable — testid map + client export (SCU-2.P3.5)", () => {
  function captureDownloads() {
    const RealBlob = globalThis.Blob;
    const blobSpy = vi.spyOn(globalThis, "Blob").mockImplementation((parts, opts) => new RealBlob(parts, opts));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    return { names, text: (i: number) => blobSpy.mock.calls[i][0]?.[0] as string };
  }

  it("emits the root, count, row and five cell testids; Download ▾ is last in the toolbar", () => {
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    const root = screen.getByTestId("jade-flows-pw-table");
    const key = "plant-1|wh-11";
    expect(within(root).getByTestId("jade-flow-pw-row-plant-1-wh-11").tagName).toBe("TR");
    for (const col of ["plant", "warehouse", "distance", "flow", "band"]) {
      expect(within(root).getByTestId(`cell-jade-flow-pw-${col}-${key}`).tagName).toBe("TD");
    }
    expect(within(root).getByTestId("text-jadeflows-pw-count")).toHaveTextContent("2 of 2");
    const dl = within(root).getByTestId("button-download-jade-flows-pw");
    expect(dl.parentElement!.lastElementChild).toBe(dl);
    // thead th texts are the e2e contract (jade-ch9-workspace-bundle.spec.ts:407-408)
    expect([...root.querySelectorAll("thead th")].map(th => th.textContent)).toEqual(["Plant", "Warehouse", "Distance", "Flow", "Distance Band"]);
    expect([...root.querySelectorAll("thead th")].map(th => th.classList.contains("text-center"))).toEqual([false, false, true, true, false]);
  });

  // Header/row/value content is pinned by jadeFlowsExport.test.ts; this is the wiring.
  it("CSV and JSON downloads are named jade-flows-plant-warehouse.{csv,json}", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    await user.click(screen.getByTestId("button-download-jade-flows-pw-csv"));
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    await user.click(screen.getByTestId("button-download-jade-flows-pw-json"));
    expect(dl.names).toEqual(["jade-flows-plant-warehouse.csv", "jade-flows-plant-warehouse.json"]);
  });

  it("QFX-2a: the XLSX download is jade-flows-plant-warehouse.xlsx", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    await user.click(screen.getByTestId("button-download-jade-flows-pw-xlsx"));
    await waitFor(() => expect(dl.names).toEqual(["jade-flows-plant-warehouse.xlsx"]));
  });

  it("> 50 rows: pager with jade-flows-pw literals, and the download still carries ALL rows", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    const edges = Array.from({ length: 51 }, (_, i) => ({
      fromId: `plant-${i + 1}`, toId: "wh-11", flow: 1, distance: 10, leg: "plant_to_warehouse" as const, productId: "product-1",
    }));
    render(<JadeFlowsTab result={makeResult(edges)} dataset={dataset} bands={bands} distanceUnit="mi" />);
    expect(screen.getByTestId("jade-flows-pw-page-indicator")).toHaveTextContent("Page 1 of 2");
    expect(screen.getAllByTestId(/^jade-flow-pw-row-/)).toHaveLength(50);
    await user.click(screen.getByTestId("button-jade-flows-pw-next"));
    expect(screen.getByTestId("jade-flow-pw-row-plant-51-wh-11")).toBeInTheDocument();
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    await user.click(screen.getByTestId("button-download-jade-flows-pw-csv"));
    expect(dl.text(0).split("\n")).toHaveLength(1 + 51);
  });

  it("Download ▾ is disabled with the export reason while browsing an unaddressable history entry, and while the unit loads", () => {
    const { unmount } = rtlRender(
      <UnitProvider>
        <ExportProvider value={makeExportProviderValue({ resultDisabledReason: "This result predates run history." })}>
          <JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />
        </ExportProvider>
      </UnitProvider>,
    );
    const dl = screen.getByTestId("button-download-jade-flows-pw");
    expect(dl).toBeDisabled();
    expect(dl).toHaveAttribute("title", "This result predates run history.");
    unmount();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
    expect(screen.getByTestId("button-download-jade-flows-pw")).toBeDisabled();
  });

  it("switching legs closes an open Download ▾ (no portaled menu left) and focus is on the leg control", async () => {
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-download-jade-flows-pw"));
    expect(screen.getByTestId("button-download-jade-flows-pw-csv")).toBeInTheDocument();
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.queryByTestId("button-download-jade-flows-pw-csv")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
  });
});

// SCU-2.P3.6 (spec B2.1/B2.2/B2.4, matrix §2a "JadeFlows W→C") — Warehouse ->
// Customer on DataTable: every testid in the instance map, pager > 50,
// Download ▾ = exactly the on-screen table (user decision 2026-10-17).
describe("JadeFlowsTab W→C on DataTable — testid map + client export (SCU-2.P3.6)", () => {
  function captureDownloads() {
    const RealBlob = globalThis.Blob;
    const blobSpy = vi.spyOn(globalThis, "Blob").mockImplementation((parts, opts) => new RealBlob(parts, opts));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    return { names, text: (i: number) => blobSpy.mock.calls[i][0]?.[0] as string };
  }
  const manyWc = (n: number) =>
    makeResult(Array.from({ length: n }, (_, i) => ({ fromId: "wh-11", toId: `customer-${i + 1}`, flow: i + 1, distance: 10, leg: "warehouse_to_customer" as const })));

  it("emits the root, count, row and five cell testids once the leg is shown; Download ▾ last", async () => {
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    const root = screen.getByTestId("jade-flows-wc-table");
    expect(root).toBeVisible();
    const key = "wh-11|customer-1";
    expect(within(root).getByTestId("jade-flow-wc-row-wh-11-customer-1").tagName).toBe("TR");
    for (const col of ["warehouse", "customer", "distance", "flow", "band"]) {
      expect(within(root).getByTestId(`cell-jade-flow-wc-${col}-${key}`).tagName).toBe("TD");
    }
    expect(within(root).getByTestId("text-jadeflows-wc-count")).toHaveTextContent("2 of 2");
    const dl = within(root).getByTestId("button-download-jade-flows-wc");
    expect(dl.parentElement!.lastElementChild).toBe(dl);
    expect([...root.querySelectorAll("thead th")].map(th => th.textContent)).toEqual(["Warehouse", "Customer", "Distance", "Flows", "Distance Band"]);
    expect([...root.querySelectorAll("thead th")].map(th => th.classList.contains("text-center"))).toEqual([false, false, true, true, false]);
  });

  it("CSV and JSON downloads are named jade-flows-warehouse-customer.{csv,json}", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc-csv"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc-json"));
    expect(dl.names).toEqual(["jade-flows-warehouse-customer.csv", "jade-flows-warehouse-customer.json"]);
  });

  it("> 50 rows: pager with jade-flows-wc literals; the download carries ALL rows", async () => {
    const dl = captureDownloads();
    const user = userEvent.setup();
    render(<JadeFlowsTab result={manyWc(51)} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.getByTestId("jade-flows-wc-page-indicator")).toHaveTextContent("Page 1 of 2");
    await user.click(screen.getByTestId("button-jade-flows-wc-next"));
    expect(screen.getByTestId("jade-flow-wc-row-wh-11-customer-51")).toBeInTheDocument();
    expect(screen.getByTestId("button-jade-flows-wc-prev")).not.toBeDisabled();
    await user.click(screen.getByTestId("button-download-jade-flows-wc"));
    await user.click(screen.getByTestId("button-download-jade-flows-wc-csv"));
    expect(dl.text(0).split("\n")).toHaveLength(1 + 51);
  });

  it("Download ▾ is disabled with the export reason while browsing an unaddressable history entry", async () => {
    const user = userEvent.setup();
    rtlRender(
      <UnitProvider>
        <ExportProvider value={makeExportProviderValue({ resultDisabledReason: "This result predates run history." })}>
          <JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />
        </ExportProvider>
      </UnitProvider>,
    );
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.getByTestId("button-download-jade-flows-wc")).toBeDisabled();
    expect(screen.getByTestId("button-download-jade-flows-wc")).toHaveAttribute("title", "This result predates run history.");
  });

  it("a filter on one leg survives switching to the other leg and back", async () => {
    const user = userEvent.setup();
    render(<JadeFlowsTab result={manyWc(12)} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    await user.click(screen.getByTestId("button-filter-jade-flows-wc"));
    await user.type(screen.getByTestId("input-filter-flow-min"), "11");
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("text-jadeflows-wc-count")).toHaveTextContent("2 of 12");
    await user.click(screen.getByTestId("button-jade-flows-inner-plant-warehouse"));
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.getByTestId("text-jadeflows-wc-count")).toHaveTextContent("2 of 12");
  });

  it("switching legs closes an open filter menu (no portaled popover left) and focus is on the leg control", async () => {
    const user = userEvent.setup();
    render(<JadeFlowsTab result={manyWc(12)} dataset={dataset} bands={bands} distanceUnit="mi" />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    await user.click(screen.getByTestId("button-filter-jade-flows-wc"));
    expect(screen.getByTestId("filter-menu-popover")).toBeInTheDocument();
    await user.click(screen.getByTestId("button-jade-flows-inner-plant-warehouse"));
    expect(screen.queryByTestId("filter-menu-popover")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("button-jade-flows-inner-plant-warehouse"));
  });
});

// SCU-2.R4 (decision B) — both legs' Distance range filters the DISPLAYED unit
// and resets when the unit toggles.
describe("JadeFlowsTab — Distance range filter follows the display unit (SCU-2.R4)", () => {
  function PrefToggle() {
    const u = useDisplayUnit();
    return <button data-testid="toggle-pref-mi" onClick={() => u.setPref("mi")}>mi</button>;
  }
  const pw = makeResult(
    Array.from({ length: 12 }, (_, i) => ({ fromId: `plant-${i + 1}`, toId: "wh-11", flow: 1, distance: 100 + i, leg: "plant_to_warehouse" as const, productId: "product-1" })),
  );
  const wc = makeResult(
    Array.from({ length: 12 }, (_, i) => ({ fromId: "wh-11", toId: `customer-${i + 1}`, flow: 1, distance: 100 + i, leg: "warehouse_to_customer" as const })),
  );
  for (const [short, result, trigger, rowRe] of [
    ["pw", pw, "button-filter-jade-flows-pw", /^jade-flow-pw-row-/],
    ["wc", wc, "button-filter-jade-flows-wc", /^jade-flow-wc-row-/],
  ] as const) {
    it(`${short}: max=170 km matches the 6 rows whose km cell is <= 170; toggling to mi clears the range`, async () => {
      window.localStorage.setItem("nos:display-unit-pref", "km");
      try {
        render(<><PrefToggle /><JadeFlowsTab result={result} dataset={dataset} bands={bands} distanceUnit="mi" /></>);
        if (short === "wc") await userEvent.setup().click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
        fireEvent.click(screen.getByTestId(trigger));
        fireEvent.change(screen.getByTestId("input-filter-distance-max"), { target: { value: "170" } });
        expect(screen.getAllByTestId(rowRe)).toHaveLength(6);
        fireEvent.click(screen.getByTestId("toggle-pref-mi"));
        expect(screen.getAllByTestId(rowRe)).toHaveLength(12);
      } finally {
        window.localStorage.removeItem("nos:display-unit-pref");
      }
    });
  }
});
