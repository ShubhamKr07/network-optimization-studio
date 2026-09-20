import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JadeFlowsTab } from "@/components/workspace/tabs/JadeFlowsTab";
import { bandLabel, bandRangeLabel } from "@/lib/bands";

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
    expect(screen.queryByTestId("jade-flows-wc-table")).not.toBeInTheDocument();
  });

  it("switches to the Warehouse -> Customer inner tab on click", async () => {
    const user = userEvent.setup();
    render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} />);
    await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
    expect(screen.getByTestId("jade-flows-wc-table")).toBeInTheDocument();
    expect(screen.queryByTestId("jade-flows-pw-table")).not.toBeInTheDocument();
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
      expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    });

    it("shows the FilterMenu on Plant -> Warehouse when unfiltered row count is > 10", () => {
      render(<JadeFlowsTab result={makeResult(manyPwEdges(11))} dataset={dataset} bands={bands} />);
      expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    });

    it("Plant -> Warehouse crossing >10 does NOT show the FilterMenu on the Warehouse -> Customer tab when its own row count stays <= 10", async () => {
      const user = userEvent.setup();
      const result = makeResult([...manyPwEdges(11), ...fewWcEdges(2)]);
      render(<JadeFlowsTab result={result} dataset={dataset} bands={bands} />);
      // Confirm PW is over threshold first.
      expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
      await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
      expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    });

    it("filtering via the FilterMenu narrows the visible Plant -> Warehouse rows and updates the count line", async () => {
      const user = userEvent.setup();
      // flow = 10 + i for i in 0..10 -> flows 10..20 (11 rows).
      render(<JadeFlowsTab result={makeResult(manyPwEdges(11))} dataset={dataset} bands={bands} />);
      await user.click(screen.getByTestId("button-filter-menu-trigger"));
      const popover = screen.getByTestId("filter-menu-popover");
      // Number filter (inclusive min) on Flow: min=15 excludes flows 10..14
      // (5 rows), leaving 15..20 (6 rows).
      await user.type(within(popover).getByTestId("input-filter-flow-min"), "15");
      expect(screen.getByTestId("text-jadeflows-pw-count")).toHaveTextContent("6 of 11");
    });
  });

  describe("Per-leg client-side CSV download", () => {
    // jsdom's Blob polyfill has no `.text()`/`.arrayBuffer()` — spy on the
    // `Blob` constructor itself and read back the parts array
    // `downloadClientCsv` passed it (`new Blob([text], ...)`, so
    // `calls[0][0][0]` is the exact joined CSV string) instead.
    it("Plant -> Warehouse 'Download CSV' produces a client-side CSV of exactly that leg's on-screen columns", async () => {
      // Capture the real constructor before spying, and delegate through it
      // in the mock implementation — spying on a class constructor with no
      // implementation throws ("cannot be invoked without 'new'") under this
      // vitest/tinyspy version.
      const RealBlob = globalThis.Blob;
      const blobSpy = vi.spyOn(globalThis, "Blob").mockImplementation((parts, opts) => new RealBlob(parts, opts));
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const user = userEvent.setup();
      render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);

      await user.click(screen.getByTestId("button-download-jade-flows-pw-csv"));

      expect(blobSpy).toHaveBeenCalledTimes(1);
      const text = blobSpy.mock.calls[0][0]?.[0] as string;
      const lines = text.split("\n");
      expect(lines[0]).toBe("Plant,Warehouse,Distance,Flow,Distance Band");
      expect(lines).toHaveLength(3); // header + 2 aggregated rows
      // Values containing a comma (e.g. "plant-1 — Bethlehem, PA") are CSV-quoted.
      // Item 2: the Plant column is "<id> — City, State", not just "City, State".
      expect(text).toContain('"plant-1 — Bethlehem, PA","Chicago, IL",293.7 mi,1400,Band 2');
      expect(text).not.toMatch(/product/i);
    });

    it("Warehouse -> Customer 'Download CSV' produces a client-side CSV with the exact 'Flows' header, independent of the P->W CSV", async () => {
      const RealBlob = globalThis.Blob;
      const blobSpy = vi.spyOn(globalThis, "Blob").mockImplementation((parts, opts) => new RealBlob(parts, opts));
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const user = userEvent.setup();
      render(<JadeFlowsTab result={jadeResult} dataset={dataset} bands={bands} distanceUnit="mi" />);
      await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));

      await user.click(screen.getByTestId("button-download-jade-flows-wc-csv"));

      expect(blobSpy).toHaveBeenCalledTimes(1);
      const text = blobSpy.mock.calls[0][0]?.[0] as string;
      const lines = text.split("\n");
      expect(lines[0]).toBe("Warehouse,Customer,Distance,Flows,Distance Band");
      expect(lines).toHaveLength(3); // header + 2 rows
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
      "Band 4: 750 mi - 1000 mi",
      "Band 5: > 1000 mi",
    ];

    it("both inner tables' Distance Band filter dropdown lists unit-aware, band-numbered ranges", async () => {
      const user = userEvent.setup();
      const spreadResult = makeResult([...bandSpreadPwEdges(11), ...bandSpreadWcEdges(11)]);
      render(<JadeFlowsTab result={spreadResult} bands={spreadBands} distanceUnit="mi" />);

      await user.click(screen.getByTestId("button-filter-menu-trigger"));
      let popover = screen.getByTestId("filter-menu-popover");
      let labels = within(popover)
        .getAllByTestId(/^option-filter-band-/)
        .map(el => el.textContent);
      expect(labels).toEqual(expectedRangeLabels);
      await user.keyboard("{Escape}");

      await user.click(screen.getByTestId("button-jade-flows-inner-warehouse-customer"));
      await user.click(screen.getByTestId("button-filter-menu-trigger"));
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

      await user.click(screen.getByTestId("button-filter-menu-trigger"));
      const popover = screen.getByTestId("filter-menu-popover");
      const labels = within(popover)
        .getAllByTestId(/^option-filter-band-/)
        .map(el => el.textContent);
      expect(labels).toEqual(["Band 1: 0 mi - 1000 mi", "Band 2: > 1000 mi"]);
    });

    it("selecting a range in EACH inner table, then changing bands, clears only that table's own band filter — non-band filters survive and the two clears are independent", async () => {
      const user = userEvent.setup();
      const spreadResult = makeResult([...bandSpreadPwEdges(11), ...bandSpreadWcEdges(11)]);
      const { rerender } = render(<JadeFlowsTab result={spreadResult} bands={spreadBands} distanceUnit="mi" />);

      // Plant -> Warehouse: select a band range + a non-band (flow) filter.
      await user.click(screen.getByTestId("button-filter-menu-trigger"));
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
      await user.click(screen.getByTestId("button-filter-menu-trigger"));
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
      await user.click(screen.getByTestId("button-filter-menu-trigger"));
      popover = screen.getByTestId("filter-menu-popover");
      expect(within(popover).queryByTestId("button-clear-filter-band")).not.toBeInTheDocument();
      expect(within(popover).getByTestId("button-clear-filter-customer")).toBeInTheDocument();
      await user.keyboard("{Escape}");

      // Switch back to Plant -> Warehouse: its own band filter was cleared independently too, flow filter survives.
      await user.click(screen.getByTestId("button-jade-flows-inner-plant-warehouse"));
      await user.click(screen.getByTestId("button-filter-menu-trigger"));
      popover = screen.getByTestId("filter-menu-popover");
      expect(within(popover).queryByTestId("button-clear-filter-band")).not.toBeInTheDocument();
      expect(within(popover).getByTestId("button-clear-filter-flow")).toBeInTheDocument();
    });
  });
});
