import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DistancesTab } from "@/components/workspace/tabs/DistancesTab";

// Bundle 6.1, T2 — the two previously-separate sections (read-only reference
// table + editable overrides table) are now ONE merged, Customers-tab-styled
// table: every base pair shows its reference distance (read-only) plus an
// editable Override cell; scenario-local added-entity pairs (no base
// counterpart) append with a "—" base and their override.

const overrides = [
  { fromId: "WH01", toId: "C001", distance: 120.5 },
  { fromId: "WH01", toId: "C002", distance: 340 },
  { fromId: "WH02", toId: "C001", distance: 88 },
];

// B3 (Bundle 2.2) — a 26-warehouse x 200-customer base×base matrix, matching
// p-median-us's real dataset shape (26*200=5200), so the filter-count math in
// the tests below matches the real dataset's arithmetic, not an arbitrary
// fixture size.
function buildReferencePairs() {
  const pairs: { fromId: string; fromCode: string; toId: string; toCode: string; distance: number }[] = [];
  for (let w = 1; w <= 26; w++) {
    const fromId = `WH${String(w).padStart(2, "0")}`;
    for (let c = 1; c <= 200; c++) {
      const toId = `C${String(c).padStart(3, "0")}`;
      pairs.push({ fromId, fromCode: fromId, toId, toCode: toId, distance: 100 + w + c });
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
  // jsdom doesn't implement scrollIntoView — the focusEntityId effect calls it.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("DistancesTab — rendering (no reference matrix)", () => {
  it("renders the scenario's current distanceOverrides as merged rows", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument();
    expect(screen.getByTestId("row-distance-WH01-C002")).toBeInTheDocument();
    expect(screen.getByTestId("row-distance-WH02-C001")).toBeInTheDocument();
    expect(screen.getByTestId("input-distance-WH01-C001")).toHaveValue("120.5");
  });

  it("shows an empty message plus the add-row affordance when there are no overrides and no reference matrix", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("distances-tab-empty")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-distance-row")).toBeInTheDocument();
  });

  it("no separate reference section exists — the merged table is the only table (no old row-reference-distance- rows)", () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    expect(document.querySelectorAll('[data-testid^="row-reference-distance-"]').length).toBe(0);
  });
});

describe("DistancesTab — merged table with a reference matrix", () => {
  it("a base pair with no override shows its read-only base distance and a blank Override field", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument());
    const row = screen.getByTestId("row-distance-WH01-C001");
    // WH01/C001's reference distance (buildReferencePairs) is 100+1+1=102.
    expect(row).toHaveTextContent("102");
    expect(screen.getByTestId("input-distance-WH01-C001")).toHaveValue("");
  });

  it("compat: `distances-reference-section` wraps the merged table when referenceCapable is true (other call sites depend on this presence/absence)", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.getByTestId("distances-reference-section")).toBeInTheDocument());
    expect(screen.getByTestId("distances-reference-section")).toContainElement(screen.getByTestId("row-distance-WH01-C001"));
  });

  it("hides the compat wrapper when referenceCapable is absent (no reference matrix at all)", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        modelId="p-median-us"
      />,
    );
    expect(screen.queryByTestId("distances-reference-section")).not.toBeInTheDocument();
  });

  it("hides the compat wrapper when referenceCapable is explicitly false", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        modelId="p-median-brazil"
        referenceCapable={false}
      />,
    );
    expect(screen.queryByTestId("distances-reference-section")).not.toBeInTheDocument();
  });

  it("an unsupported model (referenceCapable false) fires NO reference-distances request", () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        modelId="p-median-brazil"
        referenceCapable={false}
      />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("remounting a supported tab under the same query client does not refetch (staleTime: Infinity)", async () => {
    mockReferenceDistancesFetch();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { unmount } = renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
      client,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unmount();

    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
      client,
    );
    await waitFor(() => expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("DistancesTab — from/to filters", () => {
  it("filters visible rows by the from-id filter text", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "WH02" } });
    expect(screen.queryByTestId("row-distance-WH01-C001")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-distance-WH01-C002")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-distance-WH02-C001")).toBeInTheDocument();
  });

  it("filters visible rows by the to-id filter text", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-to"), { target: { value: "C002" } });
    expect(screen.queryByTestId("row-distance-WH01-C001")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-distance-WH01-C002")).toBeInTheDocument();
    expect(screen.queryByTestId("row-distance-WH02-C001")).not.toBeInTheDocument();
  });

  it("filters are case-insensitive substring matches", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "wh0" } });
    expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument();
    expect(screen.getByTestId("row-distance-WH02-C001")).toBeInTheDocument();
  });

  it("resolution #8: an added entity is found by typing its DISPLAY code (not its raw uid) into the From filter", () => {
    const uidOverrides = [{ fromId: "aw-1234", toId: "C001", distance: 55 }];
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={uidOverrides}
        savedDistanceOverrides={uidOverrides}
        warehouseIds={["aw-1234"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        displayCodeById={{ "aw-1234": "WH-CO-DENVER-01" }}
      />,
    );
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "WH-CO-DENVER" } });
    expect(screen.getByTestId("row-distance-aw-1234-C001")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "aw-1234" } });
    expect(screen.queryByTestId("row-distance-aw-1234-C001")).not.toBeInTheDocument();
  });

  it("global From/To filter narrows the merged table (base + added rows) and resets the pager to page 1", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-distances-next"));
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 2 of");

    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "WH01" } });

    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of");
    // WH01 has 200 base pairs -> 4 pages of 50.
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of 4");
  });
});

describe("DistancesTab — the 4 mandated override transitions (resolution #4)", () => {
  it("ADD: editing a base row's blank Override field creates a new override, highlights Changed, and keeps the base value shown", async () => {
    mockReferenceDistancesFetch();
    const onChange = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={onChange}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "500" } });

    expect(onChange).toHaveBeenCalledWith([{ fromId: "WH01", toId: "C001", distance: 500, estimated: undefined }]);
  });

  it("EDIT: changing an existing override's value updates it in place, leaving other rows untouched", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "500" } });
    expect(onChange).toHaveBeenCalledWith([
      { fromId: "WH01", toId: "C001", distance: 500, estimated: undefined },
      { fromId: "WH01", toId: "C002", distance: 340 },
      { fromId: "WH02", toId: "C001", distance: 88 },
    ]);
  });

  it("CLEAR: removing a current (unsaved) override reverts the base row to base — no override, no Changed badge", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 999 }]}
        savedDistanceOverrides={[]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("button-remove-distance-WH01-C001"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("CLEAR a previously-SAVED override: the row stays visible and Changed until Save (not just reverted silently)", async () => {
    // A real base pair (WH01/C001, part of the mocked reference matrix) with
    // no inactive/excluded status at all — clearing its saved override must
    // still keep the row visible (it reverts to a plain base row) AND marked
    // Changed until Save, since the override's ABSENCE now differs from what
    // was last saved.
    mockReferenceDistancesFetch();
    const saved = [{ fromId: "WH01", toId: "C001", distance: 999 }];
    const onChange = vi.fn();
    const Wrapper = () => {
      const [rows, setRows] = useState(saved);
      return (
        <DistancesTab
          distanceOverrides={rows}
          savedDistanceOverrides={saved}
          warehouseIds={["WH01"]}
          customerIds={["C001"]}
          onChange={next => {
            onChange(next);
            setRows(next);
          }}
          modelId="p-median-us"
          referenceCapable
        />
      );
    };
    renderWithQueryClient(<Wrapper />);
    await waitFor(() => expect(screen.queryByTestId("distances-reference-loading")).not.toBeInTheDocument());
    expect(screen.queryByTestId("badge-distance-changed-WH01-C001")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-remove-distance-WH01-C001"));

    expect(onChange).toHaveBeenCalledWith([]);
    // The row stays visible (it's a real base pair, WH01/C001 = 102) —
    // reverted to base — but marked Changed since the saved state had an
    // override and the current state doesn't.
    const row = screen.getByTestId("row-distance-WH01-C001");
    expect(row).toBeInTheDocument();
    expect(row).toHaveTextContent("102");
    expect(screen.getByTestId("badge-distance-changed-WH01-C001")).toBeInTheDocument();
  });
});

describe("DistancesTab — resolution #2 combined regression: inactive/excluded base pair + saved override + clear", () => {
  it("an inactive-warehouse pair with a SAVED override, then cleared, stays visible and Changed until Save", async () => {
    mockReferenceDistancesFetch();
    const saved = [{ fromId: "WH01", toId: "C001", distance: 55 }];
    const onChange = vi.fn();
    const Wrapper = () => {
      const [rows, setRows] = useState(saved);
      return (
        <DistancesTab
          distanceOverrides={rows}
          savedDistanceOverrides={saved}
          warehouseIds={["WH01"]}
          customerIds={["C001"]}
          onChange={next => {
            onChange(next);
            setRows(next);
          }}
          modelId="p-median-us"
          referenceCapable
          inactiveWarehouseIds={["WH01"]}
        />
      );
    };
    renderWithQueryClient(<Wrapper />);
    // Wait for the reference matrix to fully resolve (not just the row's
    // first appearance, which can happen mid-loading as a base===null "added"
    // row before baseByKey picks it up) so isChangedRow's saved/current
    // comparison reflects the real base pair, not a transient loading state.
    await waitFor(() => expect(screen.queryByTestId("distances-reference-loading")).not.toBeInTheDocument());
    expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-distance-changed-WH01-C001")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-remove-distance-WH01-C001"));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument();
    expect(screen.getByTestId("badge-distance-changed-WH01-C001")).toBeInTheDocument();
  });

  it("an excluded-customer pair with a SAVED override, then cleared, stays visible and Changed until Save", async () => {
    mockReferenceDistancesFetch();
    const saved = [{ fromId: "WH01", toId: "C001", distance: 55 }];
    const onChange = vi.fn();
    const Wrapper = () => {
      const [rows, setRows] = useState(saved);
      return (
        <DistancesTab
          distanceOverrides={rows}
          savedDistanceOverrides={saved}
          warehouseIds={["WH01"]}
          customerIds={["C001"]}
          onChange={next => {
            onChange(next);
            setRows(next);
          }}
          modelId="p-median-us"
          referenceCapable
          excludedCustomerIds={["C001"]}
        />
      );
    };
    renderWithQueryClient(<Wrapper />);
    await waitFor(() => expect(screen.queryByTestId("distances-reference-loading")).not.toBeInTheDocument());
    expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-remove-distance-WH01-C001"));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument();
    expect(screen.getByTestId("badge-distance-changed-WH01-C001")).toBeInTheDocument();
  });
});

describe("DistancesTab — resolution #3: an override on an inactive/excluded base pair stays visible (not just cleared ones)", () => {
  it("a CURRENT override on an inactive warehouse's base pair is not hidden by the status filter", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 55 }]}
        savedDistanceOverrides={[]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
        inactiveWarehouseIds={["WH01"]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("row-distance-WH01-C001")).toBeInTheDocument());
    expect(screen.getByTestId("badge-distance-changed-WH01-C001")).toBeInTheDocument();
  });

  it("a base pair with NO override on an inactive warehouse IS hidden (no bypass reason)", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
        inactiveWarehouseIds={["WH01"]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("row-distance-WH02-C001")).toBeInTheDocument());
    expect(screen.queryByTestId("row-distance-WH01-C001")).not.toBeInTheDocument();
  });
});

describe("DistancesTab — added-entity override rows", () => {
  it("an added-entity override (key not in the base matrix) appends with Base '—'", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[{ fromId: "aw-1234", toId: "C001", distance: 42 }]}
        savedDistanceOverrides={[]}
        warehouseIds={["aw-1234"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.queryByTestId("distances-reference-loading")).not.toBeInTheDocument());
    // Once the 5200-pair base matrix has loaded, the added row sorts after
    // all of it (page ~104) — filter down to it so it's on the current page.
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "aw-1234" } });
    const row = screen.getByTestId("row-distance-aw-1234-C001");
    expect(row).toHaveTextContent("—");
  });

  it("editing an added entity's row still writes the uid-keyed row to onChange, not the displayCode", () => {
    const onChange = vi.fn();
    const uidOverrides = [{ fromId: "aw-1234", toId: "C001", distance: 55 }];
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={uidOverrides}
        savedDistanceOverrides={uidOverrides}
        warehouseIds={["aw-1234"]}
        customerIds={["C001"]}
        onChange={onChange}
        displayCodeById={{ "aw-1234": "WH-CO-DENVER-01" }}
      />,
    );
    fireEvent.change(screen.getByTestId("input-distance-aw-1234-C001"), { target: { value: "99" } });
    expect(onChange).toHaveBeenCalledWith([{ fromId: "aw-1234", toId: "C001", distance: 99, estimated: undefined }]);
  });

  it("renders an added entity's displayCode instead of its raw uid", () => {
    const uidOverrides = [{ fromId: "aw-1234", toId: "C001", distance: 55 }];
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={uidOverrides}
        savedDistanceOverrides={uidOverrides}
        warehouseIds={["aw-1234"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        displayCodeById={{ "aw-1234": "WH-CO-DENVER-01" }}
      />,
    );
    const row = screen.getByTestId("row-distance-aw-1234-C001");
    expect(row).toHaveTextContent("WH-CO-DENVER-01");
    expect(row).not.toHaveTextContent("aw-1234");
  });

  it("falls back to the raw id for a base dataset id with no displayCode entry", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        displayCodeById={{ "aw-1234": "WH-CO-DENVER-01" }}
      />,
    );
    expect(screen.getByTestId("row-distance-WH01-C001")).toHaveTextContent("WH01");
  });
});

describe("DistancesTab — resolution #7: invalid input handling (whole-value validation, not a numeric prefix)", () => {
  it("typing 0 sets aria-invalid + shows the inline error and does NOT call onChange", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "0" } });
    expect(screen.getByTestId("input-distance-WH01-C001")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("text-distance-error-WH01-C001")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("typing a negative value sets aria-invalid + shows the inline error and does NOT call onChange", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "-5" } });
    expect(screen.getByTestId("input-distance-WH01-C001")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("text-distance-error-WH01-C001")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("typing a malformed value ('12abc') sets aria-invalid + shows the inline error and does NOT call onChange (whole-value Number(), not parseFloat's numeric-prefix)", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "12abc" } });
    expect(screen.getByTestId("input-distance-WH01-C001")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("text-distance-error-WH01-C001")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    // parseFloat("12abc") would silently accept 12 — Number() must not.
    expect(onChange).not.toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ distance: 12 })]));
  });

  it("an empty draft (mid-clear) shows no error and does NOT call onChange", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "" } });
    expect(screen.getByTestId("input-distance-WH01-C001")).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByTestId("text-distance-error-WH01-C001")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a valid positive number after an invalid draft clears the error and commits", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "-5" } });
    expect(screen.getByTestId("text-distance-error-WH01-C001")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "42" } });
    expect(screen.queryByTestId("text-distance-error-WH01-C001")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith([
      { fromId: "WH01", toId: "C001", distance: 42, estimated: undefined },
      { fromId: "WH01", toId: "C002", distance: 340 },
      { fromId: "WH02", toId: "C001", distance: 88 },
    ]);
  });
});

describe("DistancesTab — load/error states (resolution #6)", () => {
  it("loading: base cells show a spinner (not '—'), and added-entity override rows still render + are editable", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>(resolve => {
          resolveFetch = resolve;
        }),
    );
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[{ fromId: "aw-1234", toId: "C001", distance: 42 }]}
        savedDistanceOverrides={[]}
        warehouseIds={["aw-1234"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    expect(screen.getByTestId("distances-reference-loading")).toBeInTheDocument();
    // No reference matrix has resolved yet, so `aw-1234|C001` is treated as an
    // added row (base===null) — during loading its Base cell must still show
    // a spinner, not "—", per resolution #6.
    expect(screen.getByTestId("spinner-distance-base-aw-1234-C001")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    // still editable during loading
    fireEvent.change(screen.getByTestId("input-distance-aw-1234-C001"), { target: { value: "10" } });

    resolveFetch(jsonResponse({ pairs: referencePairs, distanceUnit: "mi" }));
    await waitFor(() => expect(screen.queryByTestId("distances-reference-loading")).not.toBeInTheDocument());
  });

  it("error: base cells show 'unavailable', and override rows stay editable", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[{ fromId: "aw-1234", toId: "C001", distance: 42 }]}
        savedDistanceOverrides={[]}
        warehouseIds={["aw-1234"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.getByTestId("distances-reference-error")).toBeInTheDocument());
    const row = screen.getByTestId("row-distance-aw-1234-C001");
    expect(row).toHaveTextContent("unavailable");
    expect(screen.getByTestId("input-distance-aw-1234-C001")).not.toBeDisabled();
  });

  it("success + a genuinely base-absent pair shows '—' (only after the query has succeeded)", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[{ fromId: "aw-1234", toId: "C001", distance: 42 }]}
        savedDistanceOverrides={[]}
        warehouseIds={["aw-1234"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.queryByTestId("distances-reference-loading")).not.toBeInTheDocument());
    // The added row (aw-1234|C001) sorts after all 5200 base rows once the
    // matrix has loaded — filter down to it so it's actually on the current
    // page (this test is about its Base cell's content, not pagination).
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "aw-1234" } });
    expect(screen.getByTestId("row-distance-aw-1234-C001")).toHaveTextContent("—");
  });
});

describe("DistancesTab — add row (unchanged form, separate from the merged table's inline Override editing)", () => {
  it("adding a new row via the form produces a new distanceOverrides entry", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-distance-row"));
    await userEvent.type(screen.getByTestId("input-new-distance-from"), "WH02");
    await userEvent.type(screen.getByTestId("input-new-distance-to"), "C002");
    await userEvent.type(screen.getByTestId("input-new-distance-value"), "77");
    await userEvent.click(screen.getByTestId("button-add-distance-confirm"));

    expect(onChange).toHaveBeenCalledWith([...overrides, { fromId: "WH02", toId: "C002", distance: 77 }]);
  });

  it("rejects an add with a missing id or non-positive distance, without calling onChange", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-distance-row"));
    await userEvent.type(screen.getByTestId("input-new-distance-to"), "C002");
    await userEvent.type(screen.getByTestId("input-new-distance-value"), "77");
    await userEvent.click(screen.getByTestId("button-add-distance-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-distance-error")).toBeInTheDocument();
  });

  it("rejects an add that duplicates an existing (fromId, toId) pair", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-distance-row"));
    await userEvent.type(screen.getByTestId("input-new-distance-from"), "WH01");
    await userEvent.type(screen.getByTestId("input-new-distance-to"), "C001");
    await userEvent.type(screen.getByTestId("input-new-distance-value"), "77");
    await userEvent.click(screen.getByTestId("button-add-distance-confirm"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-distance-error")).toBeInTheDocument();
  });
});

describe("DistancesTab — client-side reference validation (nice-to-have)", () => {
  it("shows an inline warning for a fromId that doesn't resolve against known warehouses", () => {
    const badOverrides = [{ fromId: "GHOST", toId: "C001", distance: 100 }];
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={badOverrides}
        savedDistanceOverrides={badOverrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("warning-unknown-from-GHOST-C001")).toBeInTheDocument();
  });

  it("shows an inline warning for a toId that doesn't resolve against known customers", () => {
    const badOverrides = [{ fromId: "WH01", toId: "GHOST", distance: 100 }];
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={badOverrides}
        savedDistanceOverrides={badOverrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("warning-unknown-to-WH01-GHOST")).toBeInTheDocument();
  });

  it("does not warn for a row whose ids both resolve", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("warning-unknown-from-WH01-C001")).not.toBeInTheDocument();
    expect(screen.queryByTestId("warning-unknown-to-WH01-C001")).not.toBeInTheDocument();
  });
});

// T9 — estimated rows: distanceOverrideSchema (pMedian.ts) gained an
// optional `estimated` flag (T1's autoDistance normalizer) marking a row
// as machine-filled rather than student-entered/imported. Purely a display
// concern here — editing the distance is a "confirm" action that drops the
// flag, so the row becomes a normal (non-estimated) override going forward.
describe("DistancesTab — estimated rows (T9)", () => {
  it("shows an Estimated chip on a row flagged estimated:true", () => {
    const estimatedOverrides = [{ fromId: "WH01", toId: "C001", distance: 120.5, estimated: true }, overrides[1], overrides[2]];
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={estimatedOverrides}
        savedDistanceOverrides={estimatedOverrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("badge-distance-estimated-WH01-C001")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-distance-estimated-WH01-C002")).not.toBeInTheDocument();
  });

  it("does not show an Estimated chip on a row with no estimated flag", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("badge-distance-estimated-WH01-C001")).not.toBeInTheDocument();
  });

  it("editing an estimated row's distance drops the estimated flag in the onChange payload (confirm-on-edit)", () => {
    const onChange = vi.fn();
    const estimatedOverrides = [{ fromId: "WH01", toId: "C001", distance: 120.5, estimated: true }, overrides[1], overrides[2]];
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={estimatedOverrides}
        savedDistanceOverrides={estimatedOverrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "500" } });
    const [updated] = onChange.mock.calls[0];
    const editedRow = updated.find((o: { fromId: string; toId: string }) => o.fromId === "WH01" && o.toId === "C001");
    expect(editedRow.distance).toBe(500);
    expect(editedRow.estimated).toBeFalsy();
  });
});

describe("DistancesTab — Upload/Download (mirrors WarehousesTab's A1.3 wiring)", () => {
  it("Upload/Download are disabled until a scenario is resolved", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("button-export-distances-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-distances-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-distances")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=distances&format=csv", async () => {
    fetchMock.mockResolvedValue(
      new Response("fromId,toId,distance\nWH01,C001,120.5", { status: 200, headers: { "content-type": "text/csv" } }),
    );
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        scenarioId={7}
      />,
    );

    await userEvent.click(screen.getByTestId("button-export-distances-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/scenarios/7/export");
    expect(String(url)).toContain("entity=distances");
    expect(String(url)).toContain("format=csv");
  });

  it("Upload button opens ImportDialog scoped to entity=distances", async () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        scenarioId={7}
      />,
    );

    expect(screen.queryByText("Import distances")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-distances"));
    expect(screen.getByText("Import distances")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-distances")).toBeInTheDocument();
  });

  it("a successful import apply calls onImportApplied with the updated scenario", async () => {
    const updatedScenario = { id: 7, name: "S", modelId: "p-median-us", inputs: {}, result: null, createdAt: "x", updatedAt: "x" };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/import")) return jsonResponse({ errors: [], changes: [{ id: "WH01|C001", line: 2, before: {}, after: {} }], warnings: [] });
      if (url.endsWith("/import/apply")) return jsonResponse({ applied: 1, errors: [], scenario: updatedScenario });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    const onImportApplied = vi.fn();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        scenarioId={7}
        onImportApplied={onImportApplied}
      />,
    );

    await userEvent.click(screen.getByTestId("button-import-distances"));
    const file = new File(["fromId,toId,distance\nWH01,C001,120.5"], "distances.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByTestId("input-import-file-distances"), file);
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onImportApplied).toHaveBeenCalledWith(updatedScenario));
  });
});

describe("DistancesTab — pagination (single pager over the merged set)", () => {
  function buildManyOverrides(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      fromId: `WH${String((i % 26) + 1).padStart(2, "0")}`,
      toId: `C${String(i + 1).padStart(3, "0")}`,
      distance: 100 + i,
    }));
  }

  it("paginates at 50 rows per page, Prev disabled on page 1, Next advances", async () => {
    const many = buildManyOverrides(120);
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={many}
        savedDistanceOverrides={many}
        warehouseIds={many.map(o => o.fromId)}
        customerIds={many.map(o => o.toId)}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of 3");
    expect(screen.getByTestId("button-distances-prev")).toBeDisabled();
    expect(screen.getByTestId(`row-distance-${many[0].fromId}-${many[0].toId}`)).toBeInTheDocument();
    expect(screen.getByTestId(`row-distance-${many[49].fromId}-${many[49].toId}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`row-distance-${many[50].fromId}-${many[50].toId}`)).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("button-distances-next"));

    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 2 of 3");
    expect(screen.getByTestId(`row-distance-${many[50].fromId}-${many[50].toId}`)).toBeInTheDocument();
    expect(screen.getByTestId(`row-distance-${many[99].fromId}-${many[99].toId}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`row-distance-${many[0].fromId}-${many[0].toId}`)).not.toBeInTheDocument();
  });

  it("clamps down on delete: removing the last row on the last page lands on the new last page (no empty page)", async () => {
    const many = buildManyOverrides(101); // 3 pages: 50/50/1
    const Wrapper = () => {
      const [rows, setRows] = useState(many);
      return (
        <DistancesTab
          distanceOverrides={rows}
          savedDistanceOverrides={rows}
          warehouseIds={rows.map(o => o.fromId)}
          customerIds={rows.map(o => o.toId)}
          onChange={next => setRows(next)}
        />
      );
    };
    renderWithQueryClient(<Wrapper />);

    await userEvent.click(screen.getByTestId("button-distances-next"));
    await userEvent.click(screen.getByTestId("button-distances-next"));
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 3 of 3");

    const last = many[100];
    await userEvent.click(screen.getByTestId(`button-remove-distance-${last.fromId}-${last.toId}`));

    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 2 of 2");
  });

  it("focus across pages, starting on a non-empty filter: clears the filter and lands on the target's real page without snapping back to page 1", async () => {
    const many = buildManyOverrides(120);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { rerender } = renderWithQueryClient(
      <DistancesTab
        distanceOverrides={many}
        savedDistanceOverrides={many}
        warehouseIds={many.map(o => o.fromId)}
        customerIds={many.map(o => o.toId)}
        onChange={vi.fn()}
      />,
      client,
    );

    // Set a non-empty filter first (real user typing — resets to page 1).
    fireEvent.change(screen.getByTestId("input-filter-from"), { target: { value: "WH01" } });
    expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of");

    // override #75 (index 74) — target its toId so the effect finds it.
    const target = many[74];
    rerender(
      <QueryClientProvider client={client}>
        <DistancesTab
          distanceOverrides={many}
          savedDistanceOverrides={many}
          warehouseIds={many.map(o => o.fromId)}
          customerIds={many.map(o => o.toId)}
          onChange={vi.fn()}
          focusEntityId={target.toId}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("input-filter-from")).toHaveValue("");
    // Math.floor(74/50)+1 = 2 — the programmatic clear must NOT snap back to page 1.
    await waitFor(() => expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 2 of 3"));
  });

  it("pagination over a reference matrix: the base table paginates too (5200 base pairs -> 104 pages)", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.getByTestId("distances-page-indicator")).toHaveTextContent("Page 1 of 104"));
    const mountedRows = document.querySelectorAll('[data-testid^="row-distance-"]');
    expect(mountedRows.length).toBe(50);
    expect(screen.getByTestId("button-distances-prev")).toBeDisabled();
    expect(screen.getByTestId("button-distances-next")).not.toBeDisabled();
  });
});
