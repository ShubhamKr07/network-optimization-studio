import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JadeFlowsTab } from "@/components/workspace/tabs/JadeFlowsTab";
import { bandLabel } from "@/lib/bands";

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
      // Values containing a comma (e.g. "Bethlehem, PA") are CSV-quoted.
      expect(text).toContain('"Bethlehem, PA","Chicago, IL",293.7 mi,1400,Band 2');
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
});
