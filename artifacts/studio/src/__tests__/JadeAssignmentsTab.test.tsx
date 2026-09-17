import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JadeAssignmentsTab } from "@/components/workspace/tabs/JadeAssignmentsTab";
import * as exportEntity from "@/lib/exportEntity";
import { bandLabel } from "@/lib/bands";

// B2 (JADE Ch.9 Workspace Bundle, spec §5a) — Chapter 9 JADE's product-level
// Customer Assignments table. Separate component from the shared
// `AssignmentsTab.tsx` (untouched by this task).

const dataset = {
  warehouses: [
    { id: "wh-11", city: "Chicago", state: "IL", lat: 1, lng: 1 },
    { id: "wh-14", city: "Dallas", state: "TX", lat: 2, lng: 2 },
  ],
  customers: [
    { id: "customer-1", city: "Los Angeles", state: "CA", lat: 3, lng: 3, demand: 100 },
    { id: "customer-2", city: "New York City", state: "NY", lat: 4, lng: 4, demand: 200 },
  ],
  products: [
    { id: "product-1", name: "Product Family 1" },
    { id: "product-2", name: "Product Family 2" },
  ],
};

function makeResult(assignments: Array<{ customerId: string; warehouseId: string; productId: string; distanceMi: number; flow?: number }>) {
  return {
    status: "optimal" as const,
    objective: 100,
    runTimeSec: 0.5,
    quality: "Proven optimal",
    edges: [],
    metrics: {},
    details: { assignments },
    solverUsed: "CBC",
    infeasibilityReason: null,
  };
}

const bands = [250, 500, 750, 1000];

const twoRowsResult = makeResult([
  { customerId: "customer-1", warehouseId: "wh-11", productId: "product-1", distanceMi: 42.1, flow: 500 },
  { customerId: "customer-2", warehouseId: "wh-14", productId: "product-2", distanceMi: 1200, flow: 300 },
]);

describe("JadeAssignmentsTab", () => {
  it("shows an empty-state message when result is null", () => {
    render(<JadeAssignmentsTab result={null} />);
    expect(screen.getByTestId("jade-assignments-empty")).toBeInTheDocument();
  });

  it("renders exact columns in order: Product, Customer, Assigned Warehouse, Distance, Distance Band", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={1} />);
    const headers = screen.getAllByRole("columnheader").map(h => h.textContent);
    expect(headers).toEqual(["Product", "Customer", "Assigned Warehouse", "Distance", "Distance Band"]);
  });

  it("renders one product-level row per (product, customer) pair — not aggregated per customer", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={1} />);
    expect(screen.getByTestId("row-jadeassignment-product-1|customer-1")).toBeInTheDocument();
    expect(screen.getByTestId("row-jadeassignment-product-2|customer-2")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^row-jadeassignment-/)).toHaveLength(2);
  });

  it("does not show Demand or Flow columns", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={1} />);
    const headers = screen.getAllByRole("columnheader").map(h => h.textContent);
    expect(headers.join(" ")).not.toMatch(/demand/i);
    expect(headers.join(" ")).not.toMatch(/flow/i);
  });

  it("renders product name via dataset.products id->name lookup", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={1} />);
    const row = screen.getByTestId("row-jadeassignment-product-1|customer-1");
    expect(row).toHaveTextContent("Product Family 1");
  });

  it("renders customer/warehouse city-state labels", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={1} />);
    const row = screen.getByTestId("row-jadeassignment-product-1|customer-1");
    expect(row).toHaveTextContent("Los Angeles - CA");
    expect(row).toHaveTextContent("Chicago - IL");
  });

  it("falls back to the raw id when dataset/displayedInputs can't resolve it", () => {
    const unresolvedResult = makeResult([
      { customerId: "unknown-c", warehouseId: "unknown-w", productId: "unknown-p", distanceMi: 10 },
    ]);
    render(<JadeAssignmentsTab result={unresolvedResult} dataset={dataset} bands={bands} scenarioId={1} />);
    const row = screen.getByTestId("row-jadeassignment-unknown-p|unknown-c");
    expect(row).toHaveTextContent("unknown-p");
    expect(row).toHaveTextContent("unknown-c");
    expect(row).toHaveTextContent("unknown-w");
  });

  it("shows an added warehouse/customer's city/state from displayedInputs snapshot, not raw uid", () => {
    const addedResult = makeResult([
      { customerId: "ac-1", warehouseId: "aw-1", productId: "product-1", distanceMi: 5 },
    ]);
    render(
      <JadeAssignmentsTab
        result={addedResult}
        dataset={dataset}
        bands={bands}
        scenarioId={1}
        displayedInputs={{
          addedWarehouses: [{ id: "aw-1", city: "Denver", state: "CO", displayCode: "WH-CO-DENVER-01" }],
          addedCustomers: [{ id: "ac-1", city: "Boise", state: "ID", displayCode: "C-ID-BOISE-01" }],
        }}
      />,
    );
    const row = screen.getByTestId("row-jadeassignment-product-1|ac-1");
    expect(row).toHaveTextContent("Denver - CO");
    expect(row).toHaveTextContent("Boise - ID");
    expect(row).not.toHaveTextContent("aw-1");
    expect(row).not.toHaveTextContent("ac-1");
  });

  it("formats Distance with .toFixed(1) and the distanceUnit suffix", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} distanceUnit="mi" scenarioId={1} />);
    const row = screen.getByTestId("row-jadeassignment-product-1|customer-1");
    expect(row).toHaveTextContent("42.1 mi");
  });

  it("Distance Band matches the shared bandLabel helper exactly, for both an in-range and an overflow distance", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={1} />);
    const inRangeRow = screen.getByTestId("row-jadeassignment-product-1|customer-1"); // 42.1 mi
    const overflowRow = screen.getByTestId("row-jadeassignment-product-2|customer-2"); // 1200 mi > 1000
    expect(inRangeRow).toHaveTextContent(bandLabel(42.1, bands));
    expect(overflowRow).toHaveTextContent(bandLabel(1200, bands));
    expect(overflowRow).toHaveTextContent("Overflow");
  });

  it("falls back to DEFAULT_DISTANCE_BANDS when bands is empty/absent", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} scenarioId={1} />);
    const row = screen.getByTestId("row-jadeassignment-product-1|customer-1");
    // DEFAULT_DISTANCE_BANDS = [250, 500, 750]; 42.1 mi -> Band 1.
    expect(row).toHaveTextContent("Band 1");
  });

  it("calls downloadEntityExport with entity=assignments when Download CSV is clicked", async () => {
    const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
    const user = userEvent.setup();
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={7} />);
    await user.click(screen.getByTestId("button-download-jadeassignments-csv"));
    expect(spy).toHaveBeenCalledWith(7, "assignments", "csv");
  });

  describe("FilterMenu visibility + count", () => {
    function manyRowsResult(count: number) {
      return makeResult(
        Array.from({ length: count }, (_, i) => ({
          customerId: `customer-${i}`,
          warehouseId: "wh-11",
          productId: "product-1",
          distanceMi: 100 + i,
        })),
      );
    }

    it("hides the FilterMenu when unfiltered row count is <= 10", () => {
      render(<JadeAssignmentsTab result={manyRowsResult(10)} dataset={dataset} bands={bands} scenarioId={1} />);
      expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    });

    it("shows the FilterMenu when unfiltered row count is > 10", () => {
      render(<JadeAssignmentsTab result={manyRowsResult(11)} dataset={dataset} bands={bands} scenarioId={1} />);
      expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    });

    it("shows the '{filteredCount} of {totalCount}' count line, always", () => {
      render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={1} />);
      expect(screen.getByTestId("text-jadeassignments-count")).toHaveTextContent("2 of 2");
    });

    it("filtering via the FilterMenu narrows the visible rows and updates the count line", async () => {
      const user = userEvent.setup();
      render(<JadeAssignmentsTab result={manyRowsResult(11)} dataset={dataset} bands={bands} scenarioId={1} />);
      await user.click(screen.getByTestId("button-filter-menu-trigger"));
      const popover = screen.getByTestId("filter-menu-popover");
      await user.type(within(popover).getByTestId("input-filter-customer"), "customer-1");
      expect(screen.getByTestId("text-jadeassignments-count")).toHaveTextContent("of 11");
      // "customer-1" and "customer-10" both contain the substring "customer-1".
      expect(screen.getByTestId("text-jadeassignments-count").textContent).toMatch(/^[12] of 11$/);
    });
  });
});
