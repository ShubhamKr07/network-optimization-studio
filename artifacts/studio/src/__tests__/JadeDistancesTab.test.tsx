import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JadeDistancesTab } from "@/components/workspace/tabs/JadeDistancesTab";

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

function renderWithQueryClient(ui: React.ReactElement, queryClient?: QueryClient) {
  const client =
    queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
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

  it("filters From by the city label, not just the id", () => {
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
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "Detroit" } });
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

describe("JadeDistancesTab — From/To filters", () => {
  it("filters visible rows by the from-id filter text across both legs", () => {
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
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "wh-2" } });
    expect(screen.queryByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-jadedistance-warehouse_to_customer-wh-1-customer-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-jadedistance-warehouse_to_customer-wh-2-customer-1")).toBeInTheDocument();
  });

  it("filters visible rows by the to-id filter text", () => {
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
    fireEvent.change(screen.getByTestId("input-filter-to"), { target: { value: "wh-1" } });
    expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-plant-1-wh-1")).toBeInTheDocument();
    expect(screen.queryByTestId("row-jadedistance-warehouse_to_customer-wh-1-customer-1")).not.toBeInTheDocument();
  });

  it("resolution #8: an added entity is found by typing its DISPLAY code (not its raw uid) into the filters", () => {
    const uidOverrides = [{ leg: "plant_to_warehouse" as const, fromId: "ap-1234", toId: "wh-1", distance: 55 }];
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
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "PL-CO-DENVER" } });
    expect(screen.getByTestId("row-jadedistance-plant_to_warehouse-ap-1234-wh-1")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "ap-1234" } });
    expect(screen.queryByTestId("row-jadedistance-plant_to_warehouse-ap-1234-wh-1")).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByTestId("input-jadedistance-plant_to_warehouse-plant-1-wh-1"), {
      target: { value: "500" },
    });

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
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "wh-1" } });
    fireEvent.change(screen.getByTestId("input-filter-to"), { target: { value: "customer-" } });
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
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "aw-1234" } });
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
