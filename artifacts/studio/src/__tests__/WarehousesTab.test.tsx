import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WarehousesTab } from "@/components/workspace/tabs/WarehousesTab";

const warehouses = [
  { id: "CHI", city: "Chicago", state: "IL", lat: 41.88, lng: -87.62 },
  { id: "LA", city: "Los Angeles", state: "CA", lat: 34.05, lng: -118.24 },
];

// A1.3 — mock at the global.fetch level (this repo's established convention,
// see ImportDialog.test.tsx), not the generated hooks, so real React Query
// mutation/query state transitions are exercised for both the import
// preview->apply flow and the export download.
const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function jsonResponse(body: unknown, contentType = "application/json") {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": contentType } });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  fetchMock.mockReset();
  (global.URL.createObjectURL as unknown) = vi.fn(() => "blob:mock");
  (global.URL.revokeObjectURL as unknown) = vi.fn();
});

describe("WarehousesTab", () => {
  it("renders the real WarehouseTable with the dataset's warehouses (not a placeholder)", () => {
    render(<WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
    expect(screen.getByText("CHI")).toBeInTheDocument();
    expect(screen.getByText("Chicago")).toBeInTheDocument();
    expect(screen.getByText("IL")).toBeInTheDocument();
    expect(screen.getByText("LA")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("applies DD-6's label mapping (Potential / Fixed-Open / Inactive), not the raw enum", () => {
    render(<WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
    expect(screen.getAllByText("Potential").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fixed-Open").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Forced open")).not.toBeInTheDocument();
  });

  it("calls onChange with an upserted override when a status button is clicked", () => {
    const onChange = vi.fn();
    render(<WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-wh-CHI-forced_open"));
    expect(onChange).toHaveBeenCalledWith([{ id: "CHI", status: "forced_open", capacity: undefined }]);
  });

  it("shows the Capacity column only when capacityMode is per_wh", () => {
    const { rerender } = render(
      <WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />,
    );
    expect(screen.queryByText("Capacity")).not.toBeInTheDocument();
    rerender(<WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="per_wh" onChange={vi.fn()} />);
    expect(screen.getByText("Capacity")).toBeInTheDocument();
  });

  it("filters out mine-kind candidates (not a facility-location choice)", () => {
    const withMine = [...warehouses, { id: "MINE1", city: "Kalgoorlie", state: "WA", lat: -30.7, lng: 121.4, kind: "mine" as const }];
    render(<WarehousesTab warehouses={withMine} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
    expect(screen.queryByText("MINE1")).not.toBeInTheDocument();
  });

  it("shows an empty state when the dataset has no warehouse candidates", () => {
    render(<WarehousesTab warehouses={[]} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
    expect(screen.getByTestId("warehouses-tab-empty")).toBeInTheDocument();
  });
});

describe("WarehousesTab — Upload/Download (A1.3)", () => {
  it("Upload/Download are disabled until a scenario is resolved", () => {
    render(<WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} />);
    expect(screen.getByTestId("button-export-warehouses-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-warehouses-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-warehouses")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=warehouses&format=csv", async () => {
    fetchMock.mockResolvedValue(new Response("id,status\nCHI,active", { status: 200, headers: { "content-type": "text/csv" } }));
    renderWithQueryClient(
      <WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} scenarioId={7} />,
    );

    await userEvent.click(screen.getByTestId("button-export-warehouses-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/scenarios/7/export");
    expect(String(url)).toContain("entity=warehouses");
    expect(String(url)).toContain("format=csv");
  });

  it("Download JSON triggers the export fetch scoped to entity=warehouses&format=json", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ warehouses: [] }));
    renderWithQueryClient(
      <WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} scenarioId={7} />,
    );

    await userEvent.click(screen.getByTestId("button-export-warehouses-json"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("entity=warehouses");
    expect(String(url)).toContain("format=json");
  });

  it("Upload button opens ImportDialog scoped to entity=warehouses", async () => {
    renderWithQueryClient(
      <WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} scenarioId={7} />,
    );

    expect(screen.queryByText("Import warehouses")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("button-import-warehouses"));

    expect(screen.getByText("Import warehouses")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-warehouses")).toBeInTheDocument();
  });

  it("a successful import apply calls onImportApplied with the updated scenario", async () => {
    const updatedScenario = { id: 7, name: "S", modelId: "p-median-us", inputs: {}, result: null, createdAt: "x", updatedAt: "x" };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/import")) return jsonResponse({ errors: [], changes: [{ id: "CHI", line: 2, before: {}, after: {} }], warnings: [] });
      if (url.endsWith("/import/apply")) return jsonResponse({ applied: 1, errors: [], scenario: updatedScenario });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    const onImportApplied = vi.fn();
    renderWithQueryClient(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        scenarioId={7}
        onImportApplied={onImportApplied}
      />,
    );

    await userEvent.click(screen.getByTestId("button-import-warehouses"));
    const file = new File(["id,status\nCHI,active"], "warehouses.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByTestId("input-import-file-warehouses"), file);
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onImportApplied).toHaveBeenCalledWith(updatedScenario));
  });
});

// B5.2 — add/delete row for scenario-local addedWarehouses (B1.1), plus
// inline precheck warning chips (B2.1's GET /scenarios/:id/precheck).
describe("WarehousesTab — add/delete added warehouses (B5.2)", () => {
  it("does not render an Added warehouses section when the added-entity capability isn't wired (matches how any model without addedWarehouses/addedRefineries wired renders this tab)", () => {
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("added-warehouses-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-add-warehouse-row")).not.toBeInTheDocument();
  });

  it("shows an empty message when there are no added warehouses yet", () => {
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        addedWarehouses={[]}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
      />,
    );
    expect(screen.getByTestId("added-warehouses-empty")).toBeInTheDocument();
  });

  it("filling the add-row form and confirming calls onAddedWarehousesChange with the new entity appended, matching addedWarehouseSchema's shape (id is now a hidden T3 uid, not user-typed)", async () => {
    const onAddedWarehousesChange = vi.fn();
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        addedWarehouses={[]}
        onAddedWarehousesChange={onAddedWarehousesChange}
        onDeleteWarehouse={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    // T9 — Denver/CO is a real gazetteer hit, so the blur off the State
    // field (triggered by userEvent.type's own focus-shift to the Lat
    // field) auto-fills a display code alongside lat/lng — the student's
    // manually-typed lat/lng below still win (see the "grid-mirror" describe
    // block for the dedicated auto-fill coverage). `id` is a T3 stable uid
    // (matches CreateEntityDialog's identity model) — asserted by shape,
    // not an exact string, since it's randomly generated.
    expect(onAddedWarehousesChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedWarehousesChange.mock.calls[0][0];
    expect(added).toMatchObject({
      city: "Denver",
      state: "CO",
      lat: 39.74,
      lng: -104.99,
      capacity: null,
      status: "active",
      displayCode: "WH-CO-DENVER-01",
    });
    expect(added.id).toMatch(/^aw-/);
  });

  it("rejects an add-row missing city or state, without calling onAddedWarehousesChange", async () => {
    const onAddedWarehousesChange = vi.fn();
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        addedWarehouses={[]}
        onAddedWarehousesChange={onAddedWarehousesChange}
        onDeleteWarehouse={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    expect(onAddedWarehousesChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-warehouse-error")).toBeInTheDocument();
  });

  it("renders an added warehouse row with a delete button, and clicking it calls onDeleteWarehouse with its id", async () => {
    const onDeleteWarehouse = vi.fn();
    const added = [{ id: "NEWWH", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, capacity: null, status: "active" as const }];
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        addedWarehouses={added}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={onDeleteWarehouse}
      />,
    );

    expect(screen.getByTestId("row-added-warehouse-NEWWH")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-delete-added-warehouse-NEWWH"));
    expect(onDeleteWarehouse).toHaveBeenCalledWith("NEWWH");
  });

  it("base-dataset warehouse rows have NO delete affordance — only the status toggle", () => {
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        addedWarehouses={[]}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("button-delete-added-warehouse-CHI")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-delete-added-warehouse-LA")).not.toBeInTheDocument();
    // The only "delete"-shaped affordance anywhere is scoped to entities
    // actually present in addedWarehouses — none exist here.
    expect(screen.queryAllByTestId(/^button-delete-added-warehouse-/).length).toBe(0);
  });

  it("shows a precheck warning chip on an added warehouse with incomplete distance coverage", () => {
    const added = [{ id: "NEWWH", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, capacity: null, status: "active" as const }];
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        addedWarehouses={added}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
        precheckErrors={[{ code: "completeness", message: "NEWWH missing distances to 2 customers: C1, C2" }]}
      />,
    );
    expect(screen.getByTestId("warning-precheck-added-warehouse-NEWWH")).toHaveTextContent("2");
  });

  it("does not show a precheck warning chip on a complete added warehouse", () => {
    const added = [{ id: "NEWWH", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, capacity: null, status: "active" as const }];
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        addedWarehouses={added}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
        precheckErrors={[]}
      />,
    );
    expect(screen.queryByTestId("warning-precheck-added-warehouse-NEWWH")).not.toBeInTheDocument();
  });

  it("renders the Added warehouses table with separate City/State/Lat/Lng cells (no Zip column)", () => {
    const added = [{ id: "NEWWH", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, capacity: null, status: "active" as const }];
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        addedWarehouses={added}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
      />,
    );
    const row = screen.getByTestId("row-added-warehouse-NEWWH");
    expect(row).toHaveTextContent("Denver");
    expect(row).toHaveTextContent("CO");
    expect(row).toHaveTextContent("39.7400");
    expect(row).toHaveTextContent("-104.9900");
    expect(screen.queryByText("Zip")).not.toBeInTheDocument();
  });
});

// T9 — grid-mirror: the add-row form auto-fills lat/lng + a display code
// from City+State (T2's gazetteer + T3's nextDisplayCode), mirroring
// CreateEntityDialog's (T7) map-click flow — but additively, alongside the
// existing required "ID" input (the real join key), not replacing it.
describe("WarehousesTab — add-row grid-mirror auto-fill (T9)", () => {
  it("blurring City+State (both non-empty, a gazetteer hit) auto-fills Lat/Lng and a display code", async () => {
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        addedWarehouses={[]}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "CO");
    fireEvent.blur(screen.getByTestId("input-new-warehouse-state"));

    expect(screen.getByTestId("input-new-warehouse-lat")).toHaveValue(39.76185);
    expect(screen.getByTestId("input-new-warehouse-lng")).toHaveValue(-104.881105);
    expect(screen.getByTestId("input-new-warehouse-display-code")).toHaveValue("WH-CO-DENVER-01");
  });

  it("a manual edit to the auto-filled Lat cell sticks — a later City/State blur does not re-overwrite it", async () => {
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        addedWarehouses={[]}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "CO");
    fireEvent.blur(screen.getByTestId("input-new-warehouse-state"));
    expect(screen.getByTestId("input-new-warehouse-lat")).toHaveValue(39.76185);

    // Manual focus+edit ungreys the cell and stops future auto-fills.
    await userEvent.clear(screen.getByTestId("input-new-warehouse-lat"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-lat"), "1.2345");
    expect(screen.getByTestId("input-new-warehouse-lat")).toHaveValue(1.2345);

    // Re-triggering the City/State blur (e.g. a further edit to State) must
    // not clobber the student's manual lat value.
    fireEvent.blur(screen.getByTestId("input-new-warehouse-state"));
    expect(screen.getByTestId("input-new-warehouse-lat")).toHaveValue(1.2345);
  });

  it("a gazetteer miss (unknown city/state) leaves Lat/Lng blank for manual entry, and no display code is assigned", async () => {
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        addedWarehouses={[]}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Nowheresville");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "ZZ");
    fireEvent.blur(screen.getByTestId("input-new-warehouse-state"));

    expect(screen.getByTestId("input-new-warehouse-lat")).toHaveValue(null);
    expect(screen.getByTestId("input-new-warehouse-lng")).toHaveValue(null);
    expect(screen.getByTestId("input-new-warehouse-display-code")).toHaveValue("");
  });
});

// A5.3 — two-echelon-gold-au reuses this exact component (WarehouseTable +
// toolbar) as its Refineries tab via the `entity` prop, rather than forking a
// new component — `dataset.warehouses` already carries the refinery
// candidates (the mine-kind row is filtered out above regardless of entity).
describe("WarehousesTab — entity=refineries reuse (A5.3)", () => {
  it("uses refineries-scoped testids and empty-state copy when entity=refineries", () => {
    render(<WarehousesTab warehouses={[]} overrides={[]} capacityMode="none" onChange={vi.fn()} entity="refineries" />);
    expect(screen.getByTestId("refineries-tab-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("warehouses-tab-empty")).not.toBeInTheDocument();
  });

  it("Download CSV is scoped to entity=refineries, not entity=warehouses", async () => {
    fetchMock.mockResolvedValue(new Response("id,status\nR1,active", { status: 200, headers: { "content-type": "text/csv" } }));
    renderWithQueryClient(
      <WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} scenarioId={7} entity="refineries" />,
    );

    await userEvent.click(screen.getByTestId("button-export-refineries-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("entity=refineries");
  });

  it("Upload button opens ImportDialog scoped to entity=refineries", async () => {
    renderWithQueryClient(
      <WarehousesTab warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()} scenarioId={7} entity="refineries" />,
    );
    expect(screen.queryByText("Import refineries")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-refineries"));
    expect(screen.getByText("Import refineries")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-refineries")).toBeInTheDocument();
  });

  // B6.2 — the Refineries tab now gains the SAME add/delete-row UX
  // p-median-us's Warehouses tab already has, since TwoEchelonInputs gained
  // its own addedRefineries field. Workspace.tsx binds this same
  // addedWarehouses/onAddedWarehousesChange/onDeleteWarehouse prop trio to
  // inputs.addedRefineries for this reuse — capacityMode stays "none" for
  // refineries (this model has no per-refinery capacity concept), so the
  // capacity column/input never renders regardless of entity.
  it("renders the Added refineries section with refinery-worded copy when onAddedWarehousesChange is wired for entity=refineries", () => {
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        entity="refineries"
        addedWarehouses={[]}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
      />,
    );
    expect(screen.getByTestId("added-warehouses-section")).toBeInTheDocument();
    expect(screen.getByText("Added refineries")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-warehouse-row")).toHaveTextContent("+ Add refinery");
  });

  it("adding a refinery row calls onAddedWarehousesChange with a status but no capacity field set (capacityMode=none)", async () => {
    const onAddedWarehousesChange = vi.fn();
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        entity="refineries"
        addedWarehouses={[]}
        onAddedWarehousesChange={onAddedWarehousesChange}
        onDeleteWarehouse={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId("button-add-warehouse-row"));
    await userEvent.type(screen.getByTestId("input-new-warehouse-city"), "Kalgoorlie West");
    await userEvent.type(screen.getByTestId("input-new-warehouse-state"), "WA");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lat"), "-30.8");
    await userEvent.type(screen.getByTestId("input-new-warehouse-lng"), "121.3");
    // No capacity input rendered at all under capacityMode="none".
    expect(screen.queryByTestId("input-new-warehouse-capacity")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-warehouse-confirm"));

    // T9 — "Kalgoorlie West"/WA is a gazetteer miss (US-only gazetteer, this
    // is an Australian city) — no display code gets auto-assigned, and the
    // student's manually-typed lat/lng are left exactly as entered. `id` is
    // a T3 stable uid, asserted by shape rather than an exact string.
    expect(onAddedWarehousesChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedWarehousesChange.mock.calls[0][0];
    expect(added).toMatchObject({
      city: "Kalgoorlie West",
      state: "WA",
      lat: -30.8,
      lng: 121.3,
      capacity: null,
      status: "active",
    });
    expect(added.id).toMatch(/^aw-/);
    expect(added.displayCode).toBeUndefined();
  });

  it("deleting an added refinery row calls onDeleteWarehouse with its id", async () => {
    const onDeleteWarehouse = vi.fn();
    const added = [{ id: "ref-new-1", city: "Kalgoorlie West", state: "WA", lat: -30.8, lng: 121.3, capacity: null, status: "active" as const }];
    render(
      <WarehousesTab
        warehouses={warehouses}
        overrides={[]}
        capacityMode="none"
        onChange={vi.fn()}
        entity="refineries"
        addedWarehouses={added}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={onDeleteWarehouse}
      />,
    );
    expect(screen.getByTestId("row-added-warehouse-ref-new-1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-delete-added-warehouse-ref-new-1"));
    expect(onDeleteWarehouse).toHaveBeenCalledWith("ref-new-1");
  });
});

// Phase 3.2, Task 4 — Input Map click-to-place prefill.
describe("WarehousesTab — Input Map prefill (Phase 3.2, Task 4)", () => {
  it("opens the add-row form and prefills Lat/Lng when prefillCoords is set", () => {
    const onPrefillConsumed = vi.fn();
    render(
      <WarehousesTab
        warehouses={[]} overrides={[]} capacityMode="none" onChange={vi.fn()}
        addedWarehouses={[]}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
        prefillCoords={{ lat: 40.1234, lng: -75.5678 }}
        onPrefillConsumed={onPrefillConsumed}
      />
    );
    expect(screen.getByTestId("input-new-warehouse-lat")).toHaveValue(40.1234);
    expect(screen.getByTestId("input-new-warehouse-lng")).toHaveValue(-75.5678);
    expect(onPrefillConsumed).toHaveBeenCalledTimes(1);
  });

  it("does not open the add-row form or call onPrefillConsumed when prefillCoords is null", () => {
    const onPrefillConsumed = vi.fn();
    render(
      <WarehousesTab
        warehouses={warehouses} overrides={[]} capacityMode="none" onChange={vi.fn()}
        addedWarehouses={[]}
        onAddedWarehousesChange={vi.fn()}
        onDeleteWarehouse={vi.fn()}
        prefillCoords={null}
        onPrefillConsumed={onPrefillConsumed}
      />
    );
    expect(screen.queryByTestId("add-warehouse-row-form")).not.toBeInTheDocument();
    expect(onPrefillConsumed).not.toHaveBeenCalled();
  });
});
