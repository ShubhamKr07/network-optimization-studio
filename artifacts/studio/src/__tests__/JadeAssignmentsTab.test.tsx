import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { JadeAssignmentsTab } from "@/components/workspace/tabs/JadeAssignmentsTab";
import * as exportEntity from "@/lib/exportEntity";
import { bandLabel } from "@/lib/bands";
import { UnitProvider } from "@/contexts/UnitContext";
import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";

// JadeAssignmentsTab now calls useDisplayUnit() unconditionally — every
// render needs a UnitProvider ancestor. Shadowing `render` keeps every
// existing call site (incl. `rerender`, which reuses the same tree) byte-
// identical, same pattern as AppShell.test.tsx's renderShell.
function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: AllProviders });
}

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

  // chen-bands-units, Part D "No fallback unit — reads": no `distanceUnit`
  // passed means the canonical unit is unresolved — the Distance cell must
  // show a loading placeholder, never a guessed "mi" (JADE's own canonical
  // unit is genuinely "mi", but the value must still be threaded, not
  // defaulted).
  it("shows a Distance placeholder — never a value or a guessed 'mi' — when distanceUnit is not resolved", () => {
    render(<JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={1} />);
    const row = screen.getByTestId("row-jadeassignment-product-1|customer-1");
    expect(row).not.toHaveTextContent("42.1 mi");
    expect(row).not.toHaveTextContent("42.1");
    expect(row).toHaveTextContent("—");
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
    // T14b — download()'s scenarioId comes from the ExportProvider context,
    // not this component's own `scenarioId` prop (which stays for other,
    // non-export purposes) — supply it via the provider, not the prop, to
    // exercise the real call path.
    rtlRender(
      <UnitProvider>
        <ExportProvider value={makeExportProviderValue({ scenarioId: 7 })}>
          <JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={7} />
        </ExportProvider>
      </UnitProvider>,
    );
    await user.click(screen.getByTestId("button-download-jadeassignments-csv"));
    expect(spy).toHaveBeenCalledWith(7, "assignments", "csv", { unit: "mi" });
  });

  // Task 14b — production-control assertions.
  describe("useExport() disabled-reason wiring (Task 14b)", () => {
    it("is disabled with the reason surfaced for a result entity when the displayed entry has no runId", () => {
      rtlRender(
        <UnitProvider>
          <ExportProvider value={makeExportProviderValue({ resultDisabledReason: "No run recorded for this entry." })}>
            <JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={1} />
          </ExportProvider>
        </UnitProvider>,
      );
      const button = screen.getByTestId("button-download-jadeassignments-csv");
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "No run recorded for this entry.");
    });

    it("forwards runId when an older history entry is displayed", async () => {
      const spy = vi.spyOn(exportEntity, "downloadEntityExport").mockResolvedValue();
      const user = userEvent.setup();
      rtlRender(
        <UnitProvider>
          <ExportProvider value={makeExportProviderValue({ runId: 11 })}>
            <JadeAssignmentsTab result={twoRowsResult} dataset={dataset} bands={bands} scenarioId={1} />
          </ExportProvider>
        </UnitProvider>,
      );
      await user.click(screen.getByTestId("button-download-jadeassignments-csv"));
      expect(spy).toHaveBeenCalledWith(1, "assignments", "csv", { unit: "mi", runId: 11 });
    });
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

  // T7 (Workspace fixups bundle, item 5) — the Distance Band filter's option
  // values are unit-aware ranges (bandRangeLabel), not opaque "Band N"
  // labels, and stay live when bands/unit change post-mount.
  describe("Distance Band range filter (T7)", () => {
    // 11 rows spanning every bucket of bands=[250,500,750,1000]: two rows
    // per bucket (boundary-inclusive) plus one overflow row, so the select
    // filter's distinct-value list exercises all 5 range labels. Products
    // alternate so a non-band filter (Product) can be exercised alongside it.
    function variedRowsResult() {
      return makeResult(
        Array.from({ length: 11 }, (_, i) => ({
          customerId: `customer-${i}`,
          warehouseId: "wh-11",
          productId: i < 6 ? "product-1" : "product-2",
          distanceMi: 100 + i * 100, // 100..1100
        })),
      );
    }

    it("lists unit-aware ranges in the Distance Band filter, not 'Band N'/'Overflow'", async () => {
      const user = userEvent.setup();
      render(<JadeAssignmentsTab result={variedRowsResult()} dataset={dataset} bands={bands} distanceUnit="mi" scenarioId={1} />);
      await user.click(screen.getByTestId("button-filter-menu-trigger"));
      const popover = screen.getByTestId("filter-menu-popover");
      const select = within(popover).getByTestId("select-filter-band");

      expect(within(select).getByTestId("option-filter-band-Band 1: 0 mi - 250 mi")).toBeInTheDocument();
      expect(within(select).getByTestId("option-filter-band-Band 2: 250 mi - 500 mi")).toBeInTheDocument();
      expect(within(select).getByTestId("option-filter-band-Band 3: 500 mi - 750 mi")).toBeInTheDocument();
      expect(within(select).getByTestId("option-filter-band-Band 4: 750 mi - 1000 mi")).toBeInTheDocument();
      expect(within(select).getByTestId("option-filter-band-Band 5: > 1000 mi")).toBeInTheDocument();

      expect(within(select).queryByTestId("option-filter-band-Band 1")).not.toBeInTheDocument();
      expect(within(select).queryByTestId("option-filter-band-Overflow")).not.toBeInTheDocument();
    });

    it("rerendering with changed bands updates the filter options live, with no network call", async () => {
      const user = userEvent.setup();
      const fetchSpy = vi.spyOn(global, "fetch");
      const { rerender } = render(
        <JadeAssignmentsTab result={variedRowsResult()} dataset={dataset} bands={bands} distanceUnit="mi" scenarioId={1} />,
      );
      await user.click(screen.getByTestId("button-filter-menu-trigger"));
      const popover = screen.getByTestId("filter-menu-popover");
      expect(within(popover).getByTestId("option-filter-band-Band 1: 0 mi - 250 mi")).toBeInTheDocument();

      fetchSpy.mockClear();
      // `render`'s `wrapper: AllProviders` option is reapplied automatically
      // by RTL on every `rerender` call — re-wrapping manually here would
      // insert an EXTRA UnitProvider/ExportProvider layer between the
      // existing ones and JadeAssignmentsTab, changing the tree shape at that
      // position and forcing React to unmount+remount the subtree (losing
      // the already-open filter-menu popover this test still references).
      rerender(
        <JadeAssignmentsTab result={variedRowsResult()} dataset={dataset} bands={[500]} distanceUnit="mi" scenarioId={1} />,
      );

      expect(within(popover).getByTestId("option-filter-band-Band 1: 0 mi - 500 mi")).toBeInTheDocument();
      expect(within(popover).getByTestId("option-filter-band-Band 2: > 500 mi")).toBeInTheDocument();
      expect(within(popover).queryByTestId("option-filter-band-Band 1: 0 mi - 250 mi")).not.toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("selecting a band range then editing bands clears only the band filter, leaving a non-band filter active", async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <JadeAssignmentsTab result={variedRowsResult()} dataset={dataset} bands={bands} distanceUnit="mi" scenarioId={1} />,
      );
      await user.click(screen.getByTestId("button-filter-menu-trigger"));
      const popover = screen.getByTestId("filter-menu-popover");

      // Activate a Product filter (non-band) — 6 rows are product-1.
      await user.click(within(popover).getByTestId("checkbox-filter-product-Product Family 1"));
      // Activate a band-range filter — "Band 1: 0 mi - 250 mi" matches 2 of those 6 rows.
      await user.click(within(popover).getByTestId("checkbox-filter-band-Band 1: 0 mi - 250 mi"));
      expect(screen.getByTestId("text-jadeassignments-count")).toHaveTextContent("2 of 11");

      // Edit the live distance bands — simulates the band editor changing
      // boundaries out from under an already-mounted table. Same reasoning
      // as the sibling test above: no manual provider re-wrap here, the
      // `wrapper: AllProviders` option already reapplies on rerender.
      rerender(
        <JadeAssignmentsTab result={variedRowsResult()} dataset={dataset} bands={[500]} distanceUnit="mi" scenarioId={1} />,
      );

      // Band filter cleared (its checkbox unchecked, count reflects only the
      // surviving Product filter: all 6 product-1 rows), Product filter intact.
      expect(screen.getByTestId("text-jadeassignments-count")).toHaveTextContent("6 of 11");
      expect(within(popover).getByTestId("checkbox-filter-band-Band 1: 0 mi - 500 mi")).not.toBeChecked();
      expect(within(popover).getByTestId("checkbox-filter-product-Product Family 1")).toBeChecked();
    });
  });

  // workspace-fixups-2, T10 (item 2) — identityById + the `>10` upgrade rule.
  describe("identityById + >10 upgrade rule (workspace-fixups-2, T10, item 2)", () => {
    function manyRowsWithKnownWarehouse(count: number) {
      return makeResult(
        Array.from({ length: count }, (_, i) => ({
          customerId: `customer-${i}`,
          warehouseId: "wh-11",
          productId: "product-1",
          distanceMi: 100 + i,
        })),
      );
    }
    const identityById = {
      "wh-11": { city: "Chicago", state: "IL", displayId: "WH-CHI-01" },
    };

    it("at exactly 10 unfiltered rows (the boundary), keeps the pre-existing single-line label — no mono displayId sub-label yet", () => {
      render(
        <JadeAssignmentsTab
          result={manyRowsWithKnownWarehouse(10)}
          dataset={dataset}
          bands={bands}
          scenarioId={1}
          identityById={identityById}
        />,
      );
      const row = screen.getByTestId("row-jadeassignment-product-1|customer-0");
      // Pre-existing format uses " - " (cityStateLabel), never a comma.
      expect(row).toHaveTextContent("Chicago - IL");
      expect(row).not.toHaveTextContent("WH-CHI-01");
    });

    it("at 11 unfiltered rows (crossing the boundary), upgrades the warehouse cell to the stacked EntityIdCell with the mono displayId", () => {
      render(
        <JadeAssignmentsTab
          result={manyRowsWithKnownWarehouse(11)}
          dataset={dataset}
          bands={bands}
          scenarioId={1}
          identityById={identityById}
        />,
      );
      const row = screen.getByTestId("row-jadeassignment-product-1|customer-0");
      // Upgraded format uses formatCityState (a comma), plus the mono id.
      expect(row).toHaveTextContent("Chicago, IL");
      expect(row).toHaveTextContent("WH-CHI-01");
    });

    it("shows an added CUSTOMER's AND an added FACILITY's display code via identityById once the row count exceeds 10", () => {
      const rows = Array.from({ length: 11 }, (_, i) => ({
        customerId: i === 0 ? "ac-9" : `customer-${i}`,
        warehouseId: i === 0 ? "aw-9" : "wh-11",
        productId: "product-1",
        distanceMi: 100 + i,
      }));
      render(
        <JadeAssignmentsTab
          result={makeResult(rows)}
          dataset={dataset}
          bands={bands}
          scenarioId={1}
          identityById={{
            "ac-9": { city: "Boise", state: "ID", displayId: "C-ID-BOISE-01" },
            "aw-9": { city: "Denver", state: "CO", displayId: "WH-CO-DENVER-01" },
          }}
        />,
      );
      const row = screen.getByTestId("row-jadeassignment-product-1|ac-9");
      expect(row).toHaveTextContent("C-ID-BOISE-01");
      expect(row).not.toHaveTextContent("ac-9");
      expect(row).toHaveTextContent("WH-CO-DENVER-01");
      expect(row).not.toHaveTextContent("aw-9");
    });

    it("falls back to the pre-existing single-line label on a lookup miss (identityById has no entry), even above the 10-row threshold", () => {
      render(
        <JadeAssignmentsTab
          result={manyRowsWithKnownWarehouse(11)}
          dataset={dataset}
          bands={bands}
          scenarioId={1}
          identityById={{ "some-other-id": { city: "X", state: "Y", displayId: "Z" } }}
        />,
      );
      const row = screen.getByTestId("row-jadeassignment-product-1|customer-0");
      expect(row).toHaveTextContent("Chicago - IL");
    });

    it("with identityById unset, output is byte-unchanged from before this task at any row count (no-regression)", () => {
      render(
        <JadeAssignmentsTab result={manyRowsWithKnownWarehouse(11)} dataset={dataset} bands={bands} scenarioId={1} />,
      );
      const row = screen.getByTestId("row-jadeassignment-product-1|customer-0");
      expect(row).toHaveTextContent("Chicago - IL");
    });
  });
});
