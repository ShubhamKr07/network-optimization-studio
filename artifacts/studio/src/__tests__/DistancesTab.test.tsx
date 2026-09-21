import { cloneElement, useState, type ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
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
import { DistancesTab } from "@/components/workspace/tabs/DistancesTab";
import { UnitProvider, useDisplayUnit } from "@/contexts/UnitContext";
import { makeExportProviderValue } from "@/__tests__/helpers/renderWithExportProvider";
import { ExportProvider } from "@/contexts/ExportContext";

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

// chen-bands-units, Task 12 — every DistancesTab render now needs a
// UnitProvider ancestor (useDistanceDraft/useDisplayUnit throw without one).
// Rather than touching every one of this file's ~50 `<DistancesTab .../>`
// call sites individually, default `canonicalUnit` to "mi" (p-median-us's
// real canonical unit) HERE, at the single render seam, unless a given
// test's own JSX already sets it explicitly (e.g. the new disabled-until-
// resolved test passes `canonicalUnit={null}`, which must win).
function withDefaultUnit(ui: ReactElement): ReactElement {
  const existing = (ui.props as { canonicalUnit?: unknown }).canonicalUnit;
  return cloneElement(ui, { canonicalUnit: existing !== undefined ? existing : "mi" } as Record<string, unknown>);
}

// The wrapper is passed as RTL's own `wrapper` OPTION (not a JSX element
// wrapping `ui` directly) so that this same provider tree is automatically
// reapplied by the returned `rerender()` too — a plain wrapping element is
// otherwise lost on `rerender`, per T11's own documented finding.
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

    // chen-bands-units, Task 12 — commit now happens on blur/Enter, not on
    // every keystroke (the draft-contract's whole point: a value must sit in
    // a raw-string draft long enough to survive a mid-edit unit toggle). An
    // explicit blur after the keystroke is the mechanical update every
    // edit/add test in this file needs.
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "500" } });
    fireEvent.blur(screen.getByTestId("input-distance-WH01-C001"));

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
    fireEvent.blur(screen.getByTestId("input-distance-WH01-C001"));
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
          canonicalUnit="mi"
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
          canonicalUnit="mi"
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
          canonicalUnit="mi"
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
    fireEvent.blur(screen.getByTestId("input-distance-aw-1234-C001"));
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
    fireEvent.blur(screen.getByTestId("input-distance-WH01-C001"));
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
    fireEvent.blur(screen.getByTestId("input-distance-WH01-C001"));
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
          canonicalUnit="mi"
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
    // `rerender` re-applies the SAME `wrapper` (QueryClientProvider +
    // UnitProvider) `renderWithQueryClient` supplied above — no manual
    // provider JSX needed here, unlike before Task 12 (a plain wrapping
    // element, rather than RTL's `wrapper` option, would be lost on
    // rerender). `canonicalUnit` must be set explicitly again since this
    // bypasses `withDefaultUnit`'s injection.
    rerender(
      <DistancesTab
        distanceOverrides={many}
        savedDistanceOverrides={many}
        warehouseIds={many.map(o => o.fromId)}
        customerIds={many.map(o => o.toId)}
        onChange={vi.fn()}
        focusEntityId={target.toId}
        canonicalUnit="mi"
      />,
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

// ch4-tab-city-labels — Chen (chens-cosmetics-cn) city label. Chen's dataset
// carries `state: ""` for every row (China, no province backfill in scope) —
// the primary label must render city-only, never a trailing ", ".
describe("DistancesTab — Chen city-only label (locationById, state: \"\")", () => {
  it("shows the city as the primary label with the id kept as a mono sub-label, and no trailing comma/space", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
        locationById={{
          WH01: { city: "Guangzhou", state: "" },
          C001: { city: "Shenzhen", state: "" },
        }}
      />,
    );
    const row = screen.getByTestId("row-distance-WH01-C001");
    expect(row).toHaveTextContent("Guangzhou");
    expect(row).toHaveTextContent("WH01");
    expect(row).toHaveTextContent("Shenzhen");
    expect(row).toHaveTextContent("C001");
    expect(row.textContent).not.toMatch(/Guangzhou,/);
    expect(row.textContent).not.toMatch(/Shenzhen,/);
  });

  it("falls back to unchanged ID-only rendering when locationById is absent (p-median-us/brazil default, no regression)", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    const row = screen.getByTestId("row-distance-WH01-C001");
    expect(row).toHaveTextContent("WH01");
    expect(row).toHaveTextContent("C001");
    expect(row).not.toHaveTextContent("Guangzhou");
  });
});

// T11 (workspace-fixups-2, item 2) — the `identityById` compatibility
// resolver + the `>10` UPGRADE rule for a table that previously had NO
// location source at all (p-median-us/brazil's own DistancesTab path, unlike
// Chen's already-rich `locationById` path exercised above).
describe("DistancesTab — T11 identityById upgrade (item 2)", () => {
  function buildRows(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      fromId: `WH${String(i + 1).padStart(2, "0")}`,
      toId: `C${String(i + 1).padStart(3, "0")}`,
      distance: 100 + i,
    }));
  }

  it("no-regression: with identityById UNSET, an 11-row table (past the >10 threshold) stays bare-id, byte-unchanged", () => {
    const rows = buildRows(11);
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={rows}
        warehouseIds={rows.map(r => r.fromId)}
        customerIds={rows.map(r => r.toId)}
        onChange={vi.fn()}
      />,
    );
    const row = screen.getByTestId("row-distance-WH01-C001");
    expect(row).toHaveTextContent("WH01");
    expect(row).toHaveTextContent("C001");
  });

  it("does NOT upgrade at exactly 10 rows (boundary) even with identityById present", () => {
    const rows = buildRows(10);
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={rows}
        warehouseIds={rows.map(r => r.fromId)}
        customerIds={rows.map(r => r.toId)}
        onChange={vi.fn()}
        identityById={{
          WH01: { city: "Newtown", state: "PA", displayId: "WH-A" },
          C001: { city: "Fairfax", state: "VA", displayId: "C-A" },
        }}
      />,
    );
    const row = screen.getByTestId("row-distance-WH01-C001");
    expect(row).not.toHaveTextContent("Newtown");
    expect(row).toHaveTextContent("WH-A");
  });

  it("upgrades to the stacked City/State + mono display-id cell once the unfiltered row count exceeds 10 AND identityById is provided, reflecting a LIVE (unsaved) add/move", () => {
    const rows = buildRows(11);
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={rows}
        warehouseIds={rows.map(r => r.fromId)}
        customerIds={rows.map(r => r.toId)}
        onChange={vi.fn()}
        // Simulates Workspace.tsx's `inputIdentityById` — the LIVE draft, so
        // an entity just added/moved shows its current location immediately.
        identityById={{
          WH01: { city: "Newtown", state: "PA", displayId: "WH-A" },
          C001: { city: "Fairfax", state: "VA", displayId: "C-A" },
        }}
      />,
    );
    const row = screen.getByTestId("row-distance-WH01-C001");
    expect(row).toHaveTextContent("Newtown, PA");
    expect(row).toHaveTextContent("WH-A");
    expect(row).toHaveTextContent("Fairfax, VA");
    expect(row).toHaveTextContent("C-A");
    // The raw ids are no longer shown once a display code is known.
    expect(row).not.toHaveTextContent("WH01");
    expect(row).not.toHaveTextContent("C001");
  });

  it("a lookup miss (id not in identityById) falls back to the existing displayCodeById/canonical-id source, not blank", () => {
    const rows = buildRows(11);
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={rows}
        savedDistanceOverrides={rows}
        warehouseIds={rows.map(r => r.fromId)}
        customerIds={rows.map(r => r.toId)}
        onChange={vi.fn()}
        identityById={{ WH01: { city: "Newtown", state: "PA", displayId: "WH-A" } }}
      />,
    );
    // C001 has no identityById entry — falls back to the bare id (no crash,
    // no blank cell).
    const row = screen.getByTestId("row-distance-WH01-C001");
    expect(row).toHaveTextContent("C001");
  });
});

// chen-bands-units, Task 12 — the display-unit draft contract, exercised
// directly against this component's Override cell and add-row field (not
// re-testing useDistanceDraft's own grammar/toggle unit tests, which live in
// T10's hook test file — these assert THIS component wires the hook
// correctly end to end).
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

describe("DistancesTab — chen-bands-units Task 12: display-unit draft contract", () => {
  // These tests genuinely call `setPref` (via ToggleUnitButton), which
  // persists to localStorage — reset it so no test outside this block
  // (rendered through the plain "mi"-defaulting `renderWithQueryClient`)
  // ever inherits a forced km/mi preference from here.
  afterEach(() => {
    window.localStorage.removeItem("nos:display-unit-pref");
  });

  it("a display-unit entry commits the correct CANONICAL value (typing 500 under a forced mi display in a km-canonical model stores 804.672)", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <DistancesTab
        distanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        savedDistanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "500" } });
    fireEvent.blur(screen.getByTestId("input-distance-WH01-C001"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "WH01", toId: "C001", distance: 804.672, estimated: undefined }]);
  });

  it("an incomplete draft ('5.') never commits, even on blur", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <DistancesTab
        distanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        savedDistanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={onChange}
        canonicalUnit="mi"
      />,
    );
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "5." } });
    fireEvent.blur(screen.getByTestId("input-distance-WH01-C001"));
    expect(onChange).not.toHaveBeenCalled();
    // Reverts to the stored value, not left showing the incomplete "5.".
    expect(screen.getByTestId("input-distance-WH01-C001")).toHaveValue("10");
  });

  it("a unit toggle mid-edit converts a complete draft in place and visibly discards an incomplete one", () => {
    renderWithToggle(
      <DistancesTab
        distanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        savedDistanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        canonicalUnit="km"
      />,
    );
    // pref starts "auto" -> effective unit "km" -> field shows "10".
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    // 20 km -> mi, rounded to 4dp.
    expect(screen.getByTestId("input-distance-WH01-C001")).toHaveValue("12.4274");

    // Now an incomplete draft, toggled again — discarded, reverts to the
    // STORED value (10 km) rendered in the now-current display unit (mi).
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "5." } });
    fireEvent.click(screen.getByTestId("toggle-unit-km"));
    expect(screen.getByTestId("input-distance-WH01-C001")).toHaveValue("10");
  });

  it("repeated toggling introduces no drift — the eventually-committed value equals the original conversion exactly", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <DistancesTab
        distanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        savedDistanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.change(screen.getByTestId("input-distance-WH01-C001"), { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("toggle-unit-km"));
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("toggle-unit-auto"));
    fireEvent.blur(screen.getByTestId("input-distance-WH01-C001"));
    // The anchor (20 canonical km) is fixed at first keystroke and re-projected
    // on every toggle, never re-derived from the displayed string — four
    // toggles later it still commits exactly 20, not a drifted value.
    expect(onChange).toHaveBeenCalledWith([{ fromId: "WH01", toId: "C001", distance: 20, estimated: undefined }]);
  });

  it("the add-row form converts too — asserts the stored CANONICAL value, not the typed text", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <DistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("button-add-distance-row"));
    fireEvent.change(screen.getByTestId("input-new-distance-from"), { target: { value: "WH01" } });
    fireEvent.change(screen.getByTestId("input-new-distance-to"), { target: { value: "C001" } });
    fireEvent.change(screen.getByTestId("input-new-distance-value"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("button-add-distance-confirm"));
    expect(onChange).toHaveBeenCalledWith([{ fromId: "WH01", toId: "C001", distance: 804.672 }]);
  });

  it("the editor is disabled and commits nothing while the canonical unit is unresolved (no fallback)", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <DistancesTab
        distanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        savedDistanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={onChange}
        canonicalUnit={null}
      />,
    );
    const input = screen.getByTestId("input-distance-WH01-C001");
    expect(input).toBeDisabled();
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggling units never mutates the parent onChange payload by itself (no write on toggle alone)", () => {
    const onChange = vi.fn();
    renderWithToggle(
      <DistancesTab
        distanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        savedDistanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 10 }]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={onChange}
        canonicalUnit="km"
      />,
    );
    fireEvent.click(screen.getByTestId("toggle-unit-mi"));
    fireEvent.click(screen.getByTestId("toggle-unit-km"));
    fireEvent.click(screen.getByTestId("toggle-unit-auto"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
