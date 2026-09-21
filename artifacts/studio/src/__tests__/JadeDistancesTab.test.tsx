import { cloneElement, useState, type ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AllProviders } from "@/__tests__/helpers/renderWithExportProvider";
// SCN chen-bands-units, Task 14b — this tab's export control now calls
// useExport(), which throws without an ExportProvider (and it already needed
// UnitProvider). AllProviders composes both. Passed as RTL's `wrapper`
// OPTION, never a wrapping element: an element is dropped by `rerender`.
function render(
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) {
  return rtlRender(ui, { wrapper: AllProviders, ...options });
}
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JadeDistancesTab } from "@/components/workspace/tabs/JadeDistancesTab";
import { UnitProvider, useDisplayUnit } from "@/contexts/UnitContext";
import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";

// jade-T15 — Chapter 9 JADE's Distances tab: single `distances.json` covering
// BOTH legs (plant->warehouse, warehouse->customer), a visible Leg column,
// and a (leg,fromId,toId) composite identity — unlike two-echelon-gold-au's
// LegDistancesTab.tsx (leg purely id-space-inferred, no reference matrix at
// all), JADE's distanceOverrideSchema carries an EXPLICIT `leg` field and the
// reference-distances endpoint returns a base×base matrix WITH a `leg` tag
// per pair (jadeInputs.ts / referenceDistances.ts's own header comments).
// This component is the merge of p-median-us's DistancesTab.tsx (base
// reference + editable-override single table, pagination, filters,
// displayCode) and LegDistancesTab.tsx's leg badge — keyed by the triple, not
// the pair.

const plantIds = ["plant-1", "plant-2", "plant-3", "plant-4"];
const warehouseIds = Array.from({ length: 25 }, (_, i) => `wh-${i + 1}`);
const customerIds = Array.from({ length: 100 }, (_, i) => `customer-${i + 1}`);

const overrides = [
  { leg: "plant_to_warehouse" as const, fromId: "plant-1", toId: "wh-1", distance: 120.5 },
  { leg: "warehouse_to_customer" as const, fromId: "wh-1", toId: "customer-1", distance: 340 },
  { leg: "warehouse_to_customer" as const, fromId: "wh-2", toId: "customer-1", distance: 88 },
];

// B7 (JADE Ch.9 Workspace Bundle, spec §10) — the FilterMenu is gated on
// `mergedRowsAll.length > 10` (runtime rule, STRICTLY greater-than); `overrides`
// alone (3 rows) sits below that threshold, so any test exercising the filter
// UI needs the unfiltered merged row count pushed above 10. These 10 filler
// rows are distinct from every row any test below asserts on (unique
// fromId/toId pairs, never colliding with plant-1/wh-1/wh-2/customer-1/
// ap-1234) — 10, not 9, so even a single extra override (resolution #8's
// 1-row `uidOverrides`) still lands at 11 total, past the ">10" boundary.
const filterThresholdFillers = Array.from({ length: 10 }, (_, i) => ({
  leg: "warehouse_to_customer" as const,
  fromId: `wh-${20 + i}`,
  toId: `customer-${50 + i}`,
  distance: 500 + i,
}));

async function openDistanceFilterMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("button-filter-menu-trigger"));
  return user;
}

// 2600 real-shaped base pairs: 4 plants x 25 warehouses (inbound) + 25
// warehouses x 100 customers (outbound) — matches the spec's own count.
function buildReferencePairs() {
  const pairs: {
    fromId: string;
    fromCode: string;
    toId: string;
    toCode: string;
    distance: number;
    leg: "plant_to_warehouse" | "warehouse_to_customer";
  }[] = [];
  for (const p of plantIds) {
    for (const wh of warehouseIds) {
      pairs.push({ fromId: p, fromCode: p, toId: wh, toCode: wh, distance: 100, leg: "plant_to_warehouse" });
    }
  }
  for (const wh of warehouseIds) {
    for (const c of customerIds) {
      pairs.push({ fromId: wh, fromCode: wh, toId: c, toCode: c, distance: 200, leg: "warehouse_to_customer" });
    }
  }
  return pairs;
}
const referencePairs = buildReferencePairs();

function mockReferenceDistancesFetch() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/reference-distances")) {
      return jsonResponse({ pairs: referencePairs, distanceUnit: "mi" });
    }
    throw new Error(`Unhandled fetch in test: ${url}`);
  });
}

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonResponse(body: unknown, contentType = "application/json") {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": contentType } });
}

// chen-bands-units, Task 12 — every JadeDistancesTab render now needs a
// UnitProvider ancestor. Default `canonicalUnit` to "mi"
// (two-echelon-jade-us's real canonical unit) at this single render seam
// unless a test's own JSX already sets it explicitly, and use RTL's
// `wrapper` option (not a JSX-wrapping element, lost across `rerender()`)
// for the provider tree itself.
function withDefaultUnit(ui: ReactElement): ReactElement {
  const existing = (ui.props as { canonicalUnit?: unknown }).canonicalUnit;
  return cloneElement(ui, { canonicalUnit: existing !== undefined ? existing : "mi" } as Record<string, unknown>);
}
function renderWithQueryClient(ui: React.ReactElement, queryClient?: QueryClient) {
  const client =
    queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Providers = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <UnitProvider><ExportProvider value={makeExportProviderValue()}>{children}</ExportProvider></UnitProvider>
    </QueryClientProvider>
  );
  return render(withDefaultUnit(ui), { wrapper: Providers });
}

beforeEach(() => {
  fetchMock.mockReset();
  (global.URL.createObjectURL as unknown) = vi.fn(() => "blob:mock");
  (global.URL.revokeObjectURL as unknown) = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("JadeDistancesTab — rendering (no reference matrix)", () => {
  it("renders the scenario's current distanceOverrides as merged rows, keyed by (leg,fromId,toId)", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toBeInTheDocument();
    expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-1-customer-1")).toBeInTheDocument();
    expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-2-customer-1")).toBeInTheDocument();
    expect(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1")).toHaveValue("120.5");
  });

  it("shows an empty message plus the add-row affordance when there are no overrides and no reference matrix", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("jade-distances-tab-empty")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-jadedistance-row")).toBeInTheDocument();
  });
});

describe("JadeDistancesTab — Leg column", () => {
  it("shows a Plant → Warehouse badge for an inbound-leg row and a Warehouse → Customer badge for an outbound-leg row", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("badge-leg-plant_to_warehouse-plant-1-wh-1")).toHaveTextContent("Plant → Warehouse");
    expect(screen.getByTestId("badge-leg-warehouse_to_customer-wh-1-customer-1")).toHaveTextContent(
      "Warehouse → Customer",
    );
  });
});

describe("JadeDistancesTab — From/To city, state labels (locationById)", () => {
  it("shows 'City, ST' as the primary From/To label with the id retained as a sub-label", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        locationById={{ "plant-1": { city: "Detroit", state: "MI" }, "wh-1": { city: "Phoenix", state: "AZ" } }}
      />,
    );
    const row = screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1");
    // primary label = "City, ST" for both From (plant-1) and To (wh-1)
    expect(within(row).getByText("Detroit, MI")).toBeInTheDocument();
    expect(within(row).getByText("Phoenix, AZ")).toBeInTheDocument();
    // the id stays visible as a sub-label (the unambiguous join key)
    expect(within(row).getByText("plant-1")).toBeInTheDocument();
    expect(within(row).getByText("wh-1")).toBeInTheDocument();
  });

  it("falls back to the id when a row's endpoint has no known location", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        locationById={{ "plant-1": { city: "Detroit", state: "MI" } }}
      />,
    );
    const row = screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1");
    // wh-1 has no location entry → shows the id with no "City, ST" line
    expect(within(row).getByText("Detroit, MI")).toBeInTheDocument();
    expect(within(row).getByText("wh-1")).toBeInTheDocument();
    expect(within(row).queryByText(/, AZ/)).not.toBeInTheDocument();
  });

  it("filters From by the city label, not just the id", async () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[...overrides, ...filterThresholdFillers]}
        savedDistanceOverrides={[...overrides, ...filterThresholdFillers]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        locationById={{ "plant-1": { city: "Detroit", state: "MI" }, "wh-1": { city: "Phoenix", state: "AZ" } }}
      />,
    );
    const user = await openDistanceFilterMenu();
    await user.type(screen.getByTestId("input-filter-from"), "Detroit");
    expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toBeInTheDocument();
    expect(screen.queryByTestId("row-jadedistance-warehouse_to_customer-wh-1-customer-1")).not.toBeInTheDocument();
  });
});

describe("JadeDistancesTab — merged table with the reference matrix (2600 pairs)", () => {
  it("loads all 2600 base pairs (100 inbound + 2500 outbound) with a Leg column, paginated at 50/page", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        modelId="two-echelon-jade-us"
        referenceCapable
      />,
    );
    // 2600 / 50 = 52 pages.
    await waitFor(() => expect(screen.getByTestId("jadedistances-page-indicator")).toHaveTextContent("Page 1 of 52"));
    const mountedRows = document.querySelectorAll('[data-testid^="row-jadedistance-"]');
    expect(mountedRows.length).toBe(50);
    // First page is all inbound (plant_to_warehouse) rows.
    expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toBeInTheDocument();
  });

  it("a base pair with no override shows its read-only base distance and a blank Override field", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        modelId="two-echelon-jade-us"
        referenceCapable
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toBeInTheDocument(),
    );
    const row = screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1");
    expect(row).toHaveTextContent("100");
    expect(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1")).toHaveValue("");
  });

  it("an unsupported/unresolved model fires NO reference-distances request", () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        referenceCapable={false}
      />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("JadeDistancesTab — From/To filters (migrated to the shared FilterMenu, B7)", () => {
  it("filters visible rows by the from-id filter text across both legs", async () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[...overrides, ...filterThresholdFillers]}
        savedDistanceOverrides={[...overrides, ...filterThresholdFillers]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    const user = await openDistanceFilterMenu();
    await user.type(screen.getByTestId("input-filter-from"), "wh-2");
    expect(screen.queryByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-jadedistance-warehouse_to_customer-wh-1-customer-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-2-customer-1")).toBeInTheDocument();
  });

  it("filters visible rows by the to-id filter text", async () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[...overrides, ...filterThresholdFillers]}
        savedDistanceOverrides={[...overrides, ...filterThresholdFillers]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    const user = await openDistanceFilterMenu();
    await user.type(screen.getByTestId("input-filter-to"), "wh-1");
    expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toBeInTheDocument();
    expect(screen.queryByTestId("row-jadedistance-warehouse_to_customer-wh-1-customer-1")).not.toBeInTheDocument();
  });

  it("resolution #8: an added entity is found by typing its DISPLAY code (not its raw uid) into the filters", async () => {
    const uidOverrides = [
      { leg: "plant_to_warehouse" as const, fromId: "ap-1234", toId: "wh-1", distance: 55 },
      ...filterThresholdFillers,
    ];
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={uidOverrides}
        savedDistanceOverrides={uidOverrides}
        plantIds={["ap-1234"]}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        displayCodeById={{ "ap-1234": "PL-CO-DENVER-01" }}
      />,
    );
    const user = await openDistanceFilterMenu();
    await user.type(screen.getByTestId("input-filter-from"), "PL-CO-DENVER");
    expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-ap-1234-wh-1")).toBeInTheDocument();

    await user.clear(screen.getByTestId("input-filter-from"));
    await user.type(screen.getByTestId("input-filter-from"), "ap-1234");
    expect(screen.queryByTestId("row-jadedistance-plant_to_warehouse-ap-1234-wh-1")).not.toBeInTheDocument();
  });

  it("page resets to 1 on a filter edit, but NOT while the focus-jump effect is deliberately setting a page", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      leg: "warehouse_to_customer" as const,
      fromId: `wh-${(i % 25) + 1}`,
      toId: `customer-${i + 1}`,
      distance: 100 + i,
    }));
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={many}
        savedDistanceOverrides={many}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={many.map(o => o.toId)}
        onChange={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("button-jadedistances-next"));
    expect(screen.getByTestId("jadedistances-page-indicator")).toHaveTextContent("Page 2 of 3");

    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-from"), "wh-1");
    expect(screen.getByTestId("jadedistances-page-indicator")).toHaveTextContent("Page 1 of");
  });
});

describe("JadeDistancesTab — the 4 override transitions, leg-discriminated", () => {
  it("ADD: editing a base row's blank Override field creates a leg-discriminated override and highlights Changed", async () => {
    mockReferenceDistancesFetch();
    const onChange = vi.fn();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
        modelId="two-echelon-jade-us"
        referenceCapable
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toBeInTheDocument(),
    );

    // chen-bands-units, Task 12 — commit now happens on blur/Enter, not on
    // every keystroke.
    fireEvent.change(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"), {
      target: { value: "500" },
    });
    fireEvent.blur(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"));

    expect(onChange).toHaveBeenCalledWith([
      { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 500, estimated: undefined },
    ]);
  });

  it("EDIT: changing an existing override's value updates it in place, leaving other (leg,fromId,toId) rows untouched", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"), {
      target: { value: "500" },
    });
    fireEvent.blur(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"));
    expect(onChange).toHaveBeenCalledWith([
      { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 500, estimated: undefined },
      { leg: "warehouse_to_customer", fromId: "wh-1", toId: "customer-1", distance: 340 },
      { leg: "warehouse_to_customer", fromId: "wh-2", toId: "customer-1", distance: 88 },
    ]);
  });

  it("CLEAR: removing a current (unsaved) override reverts the base row to base — no override, no Changed badge", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 999 }]}
        savedDistanceOverrides={[]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("button-remove-jadedistance-plant_to_warehouse-plant-1-wh-1"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("CLEAR a previously-SAVED override: the row stays visible and Changed until Save", async () => {
    mockReferenceDistancesFetch();
    const saved: { leg: "plant_to_warehouse" | "warehouse_to_customer"; fromId: string; toId: string; distance: number }[] = [
      { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 999 },
    ];
    const onChange = vi.fn();
    const Wrapper = () => {
      const [rows, setRows] = useState(saved);
      return (
        <JadeDistancesTab
          distanceOverrides={rows}
          savedDistanceOverrides={saved}
          plantIds={plantIds}
          warehouseIds={warehouseIds}
          customerIds={customerIds}
          onChange={next => {
            onChange(next);
            setRows(next);
          }}
          modelId="two-echelon-jade-us"
          referenceCapable
          canonicalUnit="mi"
        />
      );
    };
    renderWithQueryClient(<Wrapper />);
    await waitFor(() => expect(screen.queryByTestId("jadedistances-reference-loading")).not.toBeInTheDocument());
    expect(screen.queryByTestId("badge-jadedistance-changed-plant_to_warehouse-plant-1-wh-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-remove-jadedistance-plant_to_warehouse-plant-1-wh-1"));

    expect(onChange).toHaveBeenCalledWith([]);
    const row = screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1");
    expect(row).toBeInTheDocument();
    expect(row).toHaveTextContent("100");
    expect(screen.getByTestId("badge-jadedistance-changed-plant_to_warehouse-plant-1-wh-1")).toBeInTheDocument();
  });
});

describe("JadeDistancesTab — status filter (inactive warehouse / excluded customer)", () => {
  it("hides an inactive warehouse's pairs on BOTH legs (it's the middle role, adjacent to both) with no override", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        modelId="two-echelon-jade-us"
        referenceCapable
        inactiveWarehouseIds={["wh-1"]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-2")).toBeInTheDocument(),
    );
    // wh-1 is inactive: BOTH its inbound (plant->wh-1) and outbound (wh-1->customer) pairs are hidden...
    expect(screen.queryByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-jadedistance-warehouse_to_customer-wh-1-customer-1")).not.toBeInTheDocument();
    // ...but wh-2 (still active) keeps its pairs.
    expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-2")).toBeInTheDocument();
  });

  it("a current override on an inactive warehouse's pair is not hidden by the status filter", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[{ leg: "warehouse_to_customer", fromId: "wh-1", toId: "customer-1", distance: 55 }]}
        savedDistanceOverrides={[]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        modelId="two-echelon-jade-us"
        referenceCapable
        inactiveWarehouseIds={["wh-1"]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-1-customer-1")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("badge-jadedistance-changed-warehouse_to_customer-wh-1-customer-1"),
    ).toBeInTheDocument();
  });

  it("hides an excluded customer's outbound pair with no override", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        modelId="two-echelon-jade-us"
        referenceCapable
        excludedCustomerIds={["customer-1"]}
      />,
    );
    await waitFor(() => expect(screen.queryByTestId("jadedistances-reference-loading")).not.toBeInTheDocument());
    // Both wh-1|customer-1 (excluded, hidden) and wh-1|customer-2 (kept) sort
    // deep in the 2600-pair merged list — filter down to wh-1's outbound rows
    // so both are on the same (visible) page.
    const user = await openDistanceFilterMenu();
    await user.type(screen.getByTestId("input-filter-from"), "wh-1");
    await user.type(screen.getByTestId("input-filter-to"), "customer-");
    expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-1-customer-2")).toBeInTheDocument();
    expect(screen.queryByTestId("row-jadedistance-warehouse_to_customer-wh-1-customer-1")).not.toBeInTheDocument();
  });
});

describe("JadeDistancesTab — added-entity override rows", () => {
  it("an added-entity override (key not in the base matrix) appends with Base '—'", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[{ leg: "warehouse_to_customer", fromId: "aw-1234", toId: "customer-1", distance: 42 }]}
        savedDistanceOverrides={[]}
        plantIds={plantIds}
        warehouseIds={["aw-1234", ...warehouseIds]}
        customerIds={customerIds}
        onChange={vi.fn()}
        modelId="two-echelon-jade-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.queryByTestId("jadedistances-reference-loading")).not.toBeInTheDocument());
    const user = await openDistanceFilterMenu();
    await user.type(screen.getByTestId("input-filter-from"), "aw-1234");
    const row = screen.getByTestId("row-jadedistance-warehouse_to_customer-aw-1234-customer-1");
    expect(row).toHaveTextContent("—");
  });

  it("renders an added entity's displayCode instead of its raw uid, and edits still write the uid-keyed row", () => {
    const onChange = vi.fn();
    const uidOverrides = [{ leg: "warehouse_to_customer" as const, fromId: "aw-1234", toId: "customer-1", distance: 55 }];
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={uidOverrides}
        savedDistanceOverrides={uidOverrides}
        plantIds={plantIds}
        warehouseIds={["aw-1234"]}
        customerIds={customerIds}
        onChange={onChange}
        displayCodeById={{ "aw-1234": "WH-CO-DENVER-01" }}
      />,
    );
    const row = screen.getByTestId("row-jadedistance-warehouse_to_customer-aw-1234-customer-1");
    expect(row).toHaveTextContent("WH-CO-DENVER-01");
    expect(row).not.toHaveTextContent("aw-1234");

    fireEvent.change(screen.getByTestId("input-jadedistance-warehouse_to_customer-aw-1234-customer-1"), {
      target: { value: "99" },
    });
    fireEvent.blur(screen.getByTestId("input-jadedistance-warehouse_to_customer-aw-1234-customer-1"));
    expect(onChange).toHaveBeenCalledWith([
      { leg: "warehouse_to_customer", fromId: "aw-1234", toId: "customer-1", distance: 99, estimated: undefined },
    ]);
  });

  it("falls back to the raw id for a base dataset id with no displayCode entry", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        displayCodeById={{ "aw-1234": "WH-CO-DENVER-01" }}
      />,
    );
    expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toHaveTextContent("plant-1");
  });
});

describe("JadeDistancesTab — estimated rows", () => {
  it("shows an Estimated chip on a row flagged estimated:true and drops it on edit (confirm-on-edit)", () => {
    const onChange = vi.fn();
    const estimatedOverrides = [
      { leg: "plant_to_warehouse" as const, fromId: "plant-1", toId: "wh-1", distance: 120.5, estimated: true },
      overrides[1],
      overrides[2],
    ];
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={estimatedOverrides}
        savedDistanceOverrides={estimatedOverrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("badge-jadedistance-estimated-plant_to_warehouse-plant-1-wh-1")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"), {
      target: { value: "500" },
    });
    fireEvent.blur(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"));
    const [updated] = onChange.mock.calls[0];
    const editedRow = updated.find((o: { fromId: string; toId: string }) => o.fromId === "plant-1" && o.toId === "wh-1");
    expect(editedRow.distance).toBe(500);
    expect(editedRow.estimated).toBeFalsy();
  });
});

describe("JadeDistancesTab — invalid input handling", () => {
  it("typing 0 sets aria-invalid + shows the inline error and does NOT call onChange", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"), {
      target: { value: "0" },
    });
    expect(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("typing a malformed value ('12abc') does NOT call onChange (whole-value Number(), not parseFloat's numeric-prefix)", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"), {
      target: { value: "12abc" },
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("JadeDistancesTab — load/error states", () => {
  it("loading: base cells show a spinner, error: base cells show 'unavailable', override rows stay editable in both", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[{ leg: "warehouse_to_customer", fromId: "aw-1234", toId: "customer-1", distance: 42 }]}
        savedDistanceOverrides={[]}
        plantIds={plantIds}
        warehouseIds={["aw-1234"]}
        customerIds={customerIds}
        onChange={vi.fn()}
        modelId="two-echelon-jade-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.getByTestId("jadedistances-reference-error")).toBeInTheDocument());
    const row = screen.getByTestId("row-jadedistance-warehouse_to_customer-aw-1234-customer-1");
    expect(row).toHaveTextContent("unavailable");
    expect(screen.getByTestId("input-jadedistance-warehouse_to_customer-aw-1234-customer-1")).not.toBeDisabled();
  });
});

describe("JadeDistancesTab — add row (explicit Leg select, since leg is not inferred for JADE)", () => {
  it("adding a new row via the form (choosing a Leg) produces a new leg-tagged distanceOverrides entry", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-jadedistance-row"));
    fireEvent.change(screen.getByTestId("select-new-jadedistance-leg"), {
      target: { value: "warehouse_to_customer" },
    });
    await userEvent.type(screen.getByTestId("input-new-jadedistance-from"), "wh-3");
    await userEvent.type(screen.getByTestId("input-new-jadedistance-to"), "customer-3");
    await userEvent.type(screen.getByTestId("input-new-jadedistance-value"), "77");
    await userEvent.click(screen.getByTestId("button-add-jadedistance-confirm"));

    expect(onChange).toHaveBeenCalledWith([
      ...overrides,
      { leg: "warehouse_to_customer", fromId: "wh-3", toId: "customer-3", distance: 77 },
    ]);
  });

  it("rejects an add with a missing id or non-positive distance, without calling onChange", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-jadedistance-row"));
    await userEvent.type(screen.getByTestId("input-new-jadedistance-to"), "customer-3");
    await userEvent.type(screen.getByTestId("input-new-jadedistance-value"), "77");
    await userEvent.click(screen.getByTestId("button-add-jadedistance-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-jadedistance-error")).toBeInTheDocument();
  });

  it("rejects an add that duplicates an existing (leg,fromId,toId) triple", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-jadedistance-row"));
    fireEvent.change(screen.getByTestId("select-new-jadedistance-leg"), {
      target: { value: "plant_to_warehouse" },
    });
    await userEvent.type(screen.getByTestId("input-new-jadedistance-from"), "plant-1");
    await userEvent.type(screen.getByTestId("input-new-jadedistance-to"), "wh-1");
    await userEvent.type(screen.getByTestId("input-new-jadedistance-value"), "77");
    await userEvent.click(screen.getByTestId("button-add-jadedistance-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-jadedistance-error")).toBeInTheDocument();
  });
});

describe("JadeDistancesTab — client-side reference validation (nice-to-have), leg-scoped", () => {
  it("shows an inline warning for a plant_to_warehouse fromId that doesn't resolve against known plants", () => {
    const badOverrides = [{ leg: "plant_to_warehouse" as const, fromId: "GHOST", toId: "wh-1", distance: 100 }];
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={badOverrides}
        savedDistanceOverrides={badOverrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("warning-unknown-from-plant_to_warehouse-GHOST-wh-1")).toBeInTheDocument();
  });

  it("does not warn for a row whose ids both resolve for their leg", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("warning-unknown-from-plant_to_warehouse-plant-1-wh-1"),
    ).not.toBeInTheDocument();
  });
});

describe("JadeDistancesTab — Upload/Download (wired to T7's legDistances entity)", () => {
  it("Upload/Download are disabled until a scenario is resolved", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("button-export-legdistances-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-legdistances-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-legdistances")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=legDistances&format=csv", async () => {
    fetchMock.mockResolvedValue(
      new Response("template_version,from_id,to_id,distance\n1,plant-1,wh-1,120.5", {
        status: 200,
        headers: { "content-type": "text/csv" },
      }),
    );
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        scenarioId={7}
      />,
    );

    await userEvent.click(screen.getByTestId("button-export-legdistances-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/scenarios/7/export");
    expect(String(url)).toContain("entity=legDistances");
    expect(String(url)).toContain("format=csv");
  });

  it("Upload button opens ImportDialog scoped to entity=legDistances", async () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        scenarioId={7}
      />,
    );

    expect(screen.queryByText("Import legDistances")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-legdistances"));
    expect(screen.getByText("Import legDistances")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-legDistances")).toBeInTheDocument();
  });

  it("a successful import apply calls onImportApplied with the updated scenario", async () => {
    const updatedScenario = {
      id: 7,
      name: "S",
      modelId: "two-echelon-jade-us",
      inputs: {},
      result: null,
      createdAt: "x",
      updatedAt: "x",
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/import")) {
        return jsonResponse({
          errors: [],
          changes: [{ id: "plant-1|wh-1", line: 2, before: {}, after: {} }],
          warnings: [],
        });
      }
      if (url.endsWith("/import/apply")) return jsonResponse({ applied: 1, errors: [], scenario: updatedScenario });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    const onImportApplied = vi.fn();
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        scenarioId={7}
        onImportApplied={onImportApplied}
      />,
    );

    await userEvent.click(screen.getByTestId("button-import-legdistances"));
    const file = new File(["template_version,from_id,to_id,distance\n1,plant-1,wh-1,120.5"], "legDistances.csv", {
      type: "text/csv",
    });
    await userEvent.upload(screen.getByTestId("input-import-file-legDistances"), file);
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onImportApplied).toHaveBeenCalledWith(updatedScenario));
  });
});

describe("JadeDistancesTab — pagination", () => {
  it("paginates at 50 rows per page, Prev disabled on page 1, Next advances", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      leg: "warehouse_to_customer" as const,
      fromId: `wh-${(i % 25) + 1}`,
      toId: `customer-${i + 1}`,
      distance: 100 + i,
    }));
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={many}
        savedDistanceOverrides={many}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={many.map(o => o.toId)}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("jadedistances-page-indicator")).toHaveTextContent("Page 1 of 3");
    expect(screen.getByTestId("button-jadedistances-prev")).toBeDisabled();

    await userEvent.click(screen.getByTestId("button-jadedistances-next"));

    expect(screen.getByTestId("jadedistances-page-indicator")).toHaveTextContent("Page 2 of 3");
  });
});

// B7 (JADE Ch.9 Workspace Bundle, spec §10) — the FilterMenu's own runtime
// visibility rule: hidden at an unfiltered merged-row count <=10, shown >10.
describe("JadeDistancesTab — FilterMenu visibility threshold (B7)", () => {
  it("hides the FilterMenu when the unfiltered merged row count is <=10", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
  });

  it("shows the FilterMenu once the unfiltered merged row count exceeds 10", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={[...overrides, ...filterThresholdFillers]}
        savedDistanceOverrides={[...overrides, ...filterThresholdFillers]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
  });
});

// B7 — the focus/filter-reset handling preserved from the pre-migration
// free-text filters: the post-Save precheck toast's "jump to it" action
// clears any active filter so the target row can't stay hidden, then jumps
// to the page containing it.
describe("JadeDistancesTab — focus/filter-reset handling preserved (B7)", () => {
  it("clears an active filter and jumps to the target row's page when focusEntityId is set", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      leg: "warehouse_to_customer" as const,
      fromId: `wh-${(i % 25) + 1}`,
      toId: `customer-${i + 1}`,
      distance: 100 + i,
    }));
    const Wrapper = () => {
      const [focusEntityId, setFocusEntityId] = useState<string | null>(null);
      return (
        <>
          <button data-testid="trigger-focus" onClick={() => setFocusEntityId("customer-115")}>
            focus
          </button>
          <JadeDistancesTab
            distanceOverrides={many}
            savedDistanceOverrides={many}
            plantIds={plantIds}
            warehouseIds={warehouseIds}
            customerIds={many.map(o => o.toId)}
            onChange={vi.fn()}
            focusEntityId={focusEntityId}
            canonicalUnit="mi"
          />
        </>
      );
    };
    renderWithQueryClient(<Wrapper />);

    // Apply a To filter that unambiguously excludes the eventual focus
    // target — "customer-2" matches customer-2/20-29 but not "customer-115"
    // (no substring overlap), unlike "customer-1" which would (it's a
    // prefix of "customer-115" too).
    const user = await openDistanceFilterMenu();
    await user.type(screen.getByTestId("input-filter-to"), "customer-2");
    expect(screen.queryByTestId("row-jadedistance-warehouse_to_customer-wh-15-customer-115")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("trigger-focus"));

    // The filter is cleared (the trigger badge disappears) and the page
    // jumps to wherever "customer-115" (idx 114, page 3 at 50/page) lives.
    expect(screen.queryByTestId("text-filter-active-count")).not.toBeInTheDocument();
    expect(screen.getByTestId("jadedistances-page-indicator")).toHaveTextContent("Page 3 of 3");
  });
});

// T11 (workspace-fixups-2, item 2) — `identityById` compatibility resolver.
// This table is ALREADY rich (JADE always passes `locationById`), so there
// is no `>10` upgrade gate here — `identityById`, when present, simply takes
// precedence over the existing `locationById`/`displayCodeById` sources.
describe("JadeDistancesTab — T11 identityById compatibility resolver (item 2)", () => {
  it("no-regression: with identityById UNSET, the existing locationById-driven rendering is byte-unchanged", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        locationById={{ "plant-1": { city: "Detroit", state: "MI" }, "wh-1": { city: "Phoenix", state: "AZ" } }}
      />,
    );
    const row = screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1");
    expect(row).toHaveTextContent("Detroit, MI");
    expect(row).toHaveTextContent("Phoenix, AZ");
    expect(row).toHaveTextContent("plant-1");
    expect(row).toHaveTextContent("wh-1");
  });

  it("identityById takes precedence over locationById/displayCodeById when both are present", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        locationById={{ "plant-1": { city: "Detroit", state: "MI" } }}
        displayCodeById={{ "plant-1": "OLD-CODE" }}
        identityById={{ "plant-1": { city: "Scranton", state: "PA", displayId: "PL-NEW" } }}
      />,
    );
    const row = screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1");
    expect(row).toHaveTextContent("Scranton, PA");
    expect(row).toHaveTextContent("PL-NEW");
    expect(row).not.toHaveTextContent("Detroit");
    expect(row).not.toHaveTextContent("OLD-CODE");
  });

  it("falls back to locationById/displayCodeById for an id absent from identityById (lookup miss)", () => {
    renderWithQueryClient(
      <JadeDistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        locationById={{ "wh-1": { city: "Phoenix", state: "AZ" } }}
        identityById={{ "plant-1": { city: "Scranton", state: "PA", displayId: "PL-NEW" } }}
      />,
    );
    const row = screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1");
    // plant-1 resolved from identityById; wh-1 has no identityById entry so
    // falls back to locationById, not blank.
    expect(row).toHaveTextContent("Scranton, PA");
    expect(row).toHaveTextContent("Phoenix, AZ");
  });
});

// chen-bands-units, Task 12 — the display-unit draft contract, exercised
// directly against this component's Override cell and add-row field.
function ToggleUnitButton({ to }: { to: "auto" | "km" | "mi" }) {
  const { setPref } = useDisplayUnit();
  return (
    <button data-testid={`toggle-unit-${to}`} onClick={() => setPref(to)}>
      toggle {to}
    </button>
  );
}
function renderWithToggle(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UnitProvider><ExportProvider value={makeExportProviderValue()}>
        <ToggleUnitButton to="km" />
        <ToggleUnitButton to="mi" />
        <ToggleUnitButton to="auto" />
        {ui}
      </ExportProvider></UnitProvider>
    </QueryClientProvider>,
  );
}

describe("JadeDistancesTab — chen-bands-units Task 12: display-unit draft contract", () => {
  afterEach(() => {
    window.localStorage.removeItem("nos:display-unit-pref");
  });

  const singleOverride = [{ leg: "plant_to_warehouse" as const, fromId: "plant-1", toId: "wh-1", distance: 10 }];

  it("a display-unit entry commits the correct CANONICAL value (typing 500 under a forced mi display in a km-canonical model stores 804.672)", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <JadeDistancesTab
        distanceOverrides={singleOverride}
        savedDistanceOverrides={singleOverride}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.change(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"), {
      target: { value: "500" },
    });
    fireEvent.blur(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"));
    expect(onChange).toHaveBeenCalledWith([
      { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 804.672, estimated: undefined },
    ]);
  });

  it("an incomplete draft ('5.') never commits, even on blur", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <JadeDistancesTab
        distanceOverrides={singleOverride}
        savedDistanceOverrides={singleOverride}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
        canonicalUnit="mi"
      />,
    );
    fireEvent.change(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"), {
      target: { value: "5." },
    });
    fireEvent.blur(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1")).toHaveValue("10");
  });

  it("a unit toggle mid-edit converts a complete draft in place and visibly discards an incomplete one", () => {
    renderWithToggle(
      <JadeDistancesTab
        distanceOverrides={singleOverride}
        savedDistanceOverrides={singleOverride}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={vi.fn()}
        canonicalUnit="km"
      />,
    );
    fireEvent.change(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    expect(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1")).toHaveValue("12.4274");

    fireEvent.change(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"), {
      target: { value: "5." },
    });
    fireEvent.click(screen.getByTestId("toggle-unit-km"));
    expect(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1")).toHaveValue("10");
  });

  it("repeated toggling introduces no drift in the eventually-committed value", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <JadeDistancesTab
        distanceOverrides={singleOverride}
        savedDistanceOverrides={singleOverride}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.change(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("toggle-unit-km"));
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("toggle-unit-auto"));
    fireEvent.blur(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"));
    expect(onChange).toHaveBeenCalledWith([
      { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 20, estimated: undefined },
    ]);
  });

  it("the add-row form converts too — asserts the stored CANONICAL value, not the typed text", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <JadeDistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("button-add-jadedistance-row"));
    fireEvent.change(screen.getByTestId("select-new-jadedistance-leg"), {
      target: { value: "plant_to_warehouse" },
    });
    fireEvent.change(screen.getByTestId("input-new-jadedistance-from"), { target: { value: "plant-1" } });
    fireEvent.change(screen.getByTestId("input-new-jadedistance-to"), { target: { value: "wh-1" } });
    fireEvent.change(screen.getByTestId("input-new-jadedistance-value"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("button-add-jadedistance-confirm"));
    expect(onChange).toHaveBeenCalledWith([{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-1", distance: 804.672 }]);
  });

  it("the editor is disabled and commits nothing while the canonical unit is unresolved (no fallback)", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <JadeDistancesTab
        distanceOverrides={singleOverride}
        savedDistanceOverrides={singleOverride}
        plantIds={plantIds}
        warehouseIds={warehouseIds}
        customerIds={customerIds}
        onChange={onChange}
        canonicalUnit={null}
      />,
    );
    const input = screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1");
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
