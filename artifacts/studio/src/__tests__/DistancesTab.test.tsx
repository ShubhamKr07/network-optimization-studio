import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DistancesTab } from "@/components/workspace/tabs/DistancesTab";

// B5.1 — Distances grid tab: long-format `{fromId, toId, distance}` rows
// (DD-2/B4.1's shape), no fixed baseline to enumerate (unlike Warehouses/
// Customers) — the grid shows exactly the scenario's current
// distanceOverrides array plus an add-row affordance.

const overrides = [
  { fromId: "WH01", toId: "C001", distance: 120.5 },
  { fromId: "WH01", toId: "C002", distance: 340 },
  { fromId: "WH02", toId: "C001", distance: 88 },
];

// B3 (Bundle 2.2) — a 26-warehouse x 200-customer base×base matrix, matching
// p-median-us's real dataset shape (26*200=5200), so the filter-count math in
// the tests below (5200 -> 5000 -> 5174 -> 4975) matches the real dataset's
// arithmetic, not an arbitrary fixture size.
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
const REFERENCE_TOTAL = referencePairs.length; // 5200

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
    queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  fetchMock.mockReset();
  (global.URL.createObjectURL as unknown) = vi.fn(() => "blob:mock");
  (global.URL.revokeObjectURL as unknown) = vi.fn();
});

describe("DistancesTab — rendering", () => {
  it("renders the scenario's current distanceOverrides rows", () => {
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
    expect(screen.getByTestId("input-distance-WH01-C001")).toHaveValue(120.5);
  });

  it("shows an empty message plus the add-row affordance when there are no overrides yet", () => {
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
});

describe("DistancesTab — inline edit", () => {
  it("editing a row's distance value calls onChange with the updated array, leaving other rows untouched", () => {
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
      { fromId: "WH01", toId: "C001", distance: 500 },
      { fromId: "WH01", toId: "C002", distance: 340 },
      { fromId: "WH02", toId: "C001", distance: 88 },
    ]);
  });

  it("removing a row calls onChange with that row dropped", () => {
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
    fireEvent.click(screen.getByTestId("button-remove-distance-WH01-C001"));
    expect(onChange).toHaveBeenCalledWith([
      { fromId: "WH01", toId: "C002", distance: 340 },
      { fromId: "WH02", toId: "C001", distance: 88 },
    ]);
  });
});

describe("DistancesTab — changed-row highlight", () => {
  it("marks a row changed when its distance differs from the saved baseline", () => {
    const edited = [{ fromId: "WH01", toId: "C001", distance: 999 }, overrides[1], overrides[2]];
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={edited}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("badge-distance-changed-WH01-C001")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-distance-changed-WH01-C002")).not.toBeInTheDocument();
  });

  it("marks a brand-new row (absent from the saved baseline) as changed", () => {
    const withNew = [...overrides, { fromId: "WH02", toId: "C002", distance: 42 }];
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={withNew}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("badge-distance-changed-WH02-C002")).toBeInTheDocument();
  });

  it("a row unchanged from the saved baseline has no changed badge", () => {
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={overrides}
        savedDistanceOverrides={overrides}
        warehouseIds={["WH01", "WH02"]}
        customerIds={["C001", "C002"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("badge-distance-changed-WH01-C001")).not.toBeInTheDocument();
  });
});

describe("DistancesTab — add row", () => {
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

// Followup — displayCodeById: added-entity uids show their human-readable
// displayCode in the From/To columns; base ids (never present in the map)
// keep showing the raw id. The underlying stored row (and what onChange
// receives on edit) always stays keyed by the uid — displayCodeById only
// affects what's rendered.
describe("DistancesTab — displayCodeById (Followup)", () => {
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
    expect(onChange).toHaveBeenCalledWith([{ fromId: "aw-1234", toId: "C001", distance: 99 }]);
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
    fetchMock.mockResolvedValue(new Response("fromId,toId,distance\nWH01,C001,120.5", { status: 200, headers: { "content-type": "text/csv" } }));
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

// B3 (Bundle 2.2) — read-only base×base reference-distance section, above
// the editable overrides grid. `modelId`/`referenceCapable`/the
// `inactiveWarehouseIds`/`excludedCustomerIds` filter props are all new and
// OPTIONAL — T9 wires the real localInputs-derived values at the
// Workspace.tsx call site; this file only proves the component's own
// contract.
describe("DistancesTab — reference distances (B3)", () => {
  // jsdom reports offsetHeight:0 for every element by default, which would
  // make the virtualizer compute an empty visible range and mount zero
  // rows — give the scroll container (and everything else, harmlessly) a
  // real measured height so a bounded, nonzero window of rows renders.
  let originalOffsetHeight: PropertyDescriptor | undefined;
  beforeEach(() => {
    originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 220 });
  });
  afterEach(() => {
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
  });

  it("hides the reference section when referenceCapable is absent (back-compat default)", () => {
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

  it("hides the reference section when referenceCapable is explicitly false", () => {
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

  it("renders the reference section when referenceCapable is true", async () => {
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
    expect(screen.getByTestId("distances-reference-section")).toBeInTheDocument();
    expect(screen.getByText("Base distances (reference)")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("distances-reference-total")).toHaveTextContent(String(REFERENCE_TOTAL)));
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
    await waitFor(() => expect(screen.getByTestId("distances-reference-total")).toHaveTextContent(String(REFERENCE_TOTAL)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("client-side filter: total starts at the full base matrix", async () => {
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
    await waitFor(() => expect(screen.getByTestId("distances-reference-total")).toHaveTextContent(String(REFERENCE_TOTAL)));
  });

  it("client-side filter: one inactive base warehouse drops its 200 pairs (5200 -> 5000)", async () => {
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
        inactiveWarehouseIds={["WH01"]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("distances-reference-total")).toHaveTextContent("5000"));
    expect(fetchMock).toHaveBeenCalledTimes(1); // filter is instant client-side, no refetch
  });

  it("client-side filter: one excluded base customer drops its 26 pairs (5200 -> 5174)", async () => {
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
        excludedCustomerIds={["C001"]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("distances-reference-total")).toHaveTextContent("5174"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("client-side filter: an inactive warehouse AND an excluded customer together (5200 -> 4975)", async () => {
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
        inactiveWarehouseIds={["WH01"]}
        excludedCustomerIds={["C001"]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("distances-reference-total")).toHaveTextContent("4975"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("added entities never appear in the reference section (base-only, DD-1)", async () => {
    mockReferenceDistancesFetch();
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[]}
        savedDistanceOverrides={[]}
        warehouseIds={["WH01", "aw-1234"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.getByTestId("distances-reference-total")).toHaveTextContent(String(REFERENCE_TOTAL)));
    expect(screen.queryByTestId(/row-reference-distance-aw-1234-/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="row-reference-distance-aw-1234-"]').length).toBe(0);
  });

  it("a base×base distanceOverrides entry does not change the reference baseline distance value", async () => {
    mockReferenceDistancesFetch();
    // WH01/C001's reference distance (from buildReferencePairs) is 100+1+1=102.
    // An override for the exact same pair, at a very different value, must
    // not leak into the read-only reference row.
    renderWithQueryClient(
      <DistancesTab
        distanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 999999 }]}
        savedDistanceOverrides={[{ fromId: "WH01", toId: "C001", distance: 999999 }]}
        warehouseIds={["WH01"]}
        customerIds={["C001"]}
        onChange={vi.fn()}
        modelId="p-median-us"
        referenceCapable
      />,
    );
    await waitFor(() => expect(screen.getByTestId("distances-reference-total")).toHaveTextContent(String(REFERENCE_TOTAL)));
    const row = document.querySelector('[data-testid="row-reference-distance-WH01-C001"]');
    expect(row).toBeTruthy();
    expect(row).toHaveTextContent("102");
    expect(row).not.toHaveTextContent("999999");
  });

  it("virtualization: only a windowed subset of reference rows is mounted in the DOM (not all 5200)", async () => {
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
    await waitFor(() => expect(screen.getByTestId("distances-reference-total")).toHaveTextContent(String(REFERENCE_TOTAL)));
    const mountedRows = document.querySelectorAll('[data-testid^="row-reference-distance-"]');
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThan(REFERENCE_TOTAL);
  });
});
