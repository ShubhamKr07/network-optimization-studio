import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CustomersTab } from "@/components/workspace/tabs/CustomersTab";

const customers = [
  { id: "C1", city: "New York", state: "NY", lat: 40.71, lng: -74.0, demand: 100 },
  { id: "C2", city: "Boston", state: "MA", lat: 42.36, lng: -71.06, demand: 50 },
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

describe("CustomersTab", () => {
  it("renders the real CustomerTable with the dataset's customers (not a placeholder)", () => {
    render(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByText("C1")).toBeInTheDocument();
    expect(screen.getByText("New York")).toBeInTheDocument();
    expect(screen.getByText("NY")).toBeInTheDocument();
    expect(screen.getByText("C2")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("calls onChange with an upserted override when demand is edited", () => {
    const onChange = vi.fn();
    render(<CustomersTab customers={customers} overrides={[]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("input-customer-demand-C1"), { target: { value: "250" } });
    expect(onChange).toHaveBeenCalledWith([{ id: "C1", status: "active", demand: 250 }]);
  });

  it("calls onChange when a status button is clicked", () => {
    const onChange = vi.fn();
    render(<CustomersTab customers={customers} overrides={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-customer-C1-excluded"));
    expect(onChange).toHaveBeenCalledWith([{ id: "C1", status: "excluded", demand: undefined }]);
  });

  it("shows an empty state when the dataset has no customers", () => {
    render(<CustomersTab customers={[]} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("customers-tab-empty")).toBeInTheDocument();
  });
});

// B5.2 — add/delete row for scenario-local addedCustomers (B1.1), plus
// inline precheck warning chips (B2.1's GET /scenarios/:id/precheck).
// addedCustomerSchema has no `status` field (see precheck.ts's own comment:
// "v1 has no way to add a customer and mark it excluded in the same
// breath") — an added customer row has no status toggle, only demand.
describe("CustomersTab — add/delete added customers (B5.2)", () => {
  // Fix — code review found WarehousesTab's addedSection is gated
  // (`entity === "warehouses"`) but CustomersTab's had no equivalent gate,
  // so two-echelon-gold-au (which at the time reused CustomersTab without
  // the added-* props — see Workspace.tsx's conditional prop spread)
  // silently rendered a live-looking "+ Add customer" affordance that did
  // nothing: clicking Add called `onAddedCustomersChange?.(...)` (undefined
  // there, so it short-circuited) but `resetAddForm()` still ran
  // unconditionally afterward, clearing the form as if the add had
  // succeeded — the student sees no error and nothing was added. B6.2 gave
  // two-echelon-gold-au its own real addedCustomers field and Workspace.tsx
  // now wires these props for it too (this capability is no longer
  // p-median-us-only) — this test now covers the generic "capability not
  // wired at all" case, not a specific model.
  it("renders NO Added customers section when the added-customers capability isn't wired at all (capability-gated, not model-gated)", () => {
    render(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("added-customers-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("added-customers-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-add-customer-row")).not.toBeInTheDocument();
  });

  it("shows an empty message when there are no added customers yet", () => {
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
      />,
    );
    expect(screen.getByTestId("added-customers-empty")).toBeInTheDocument();
  });

  it("filling the add-row form and confirming calls onAddedCustomersChange with the new entity appended, matching addedCustomerSchema's shape (id is now a hidden T3 uid, not user-typed)", async () => {
    const onAddedCustomersChange = vi.fn();
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={onAddedCustomersChange}
        onDeleteCustomer={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("input-new-customer-demand"), "500");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    // T9 — same identity model as WarehousesTab: `id` is a T3 stable uid
    // (matches CreateEntityDialog), asserted by shape, not an exact string.
    // Denver/CO is a real gazetteer hit, so a display code auto-fills too.
    expect(onAddedCustomersChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedCustomersChange.mock.calls[0][0];
    expect(added).toMatchObject({
      city: "Denver",
      state: "CO",
      lat: 39.74,
      lng: -104.99,
      demand: 500,
      displayCode: "CS-CO-DENVER-01",
    });
    expect(added.id).toMatch(/^ac-/);
  });

  it("rejects an add-row missing city or state, without calling onAddedCustomersChange", async () => {
    const onAddedCustomersChange = vi.fn();
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={onAddedCustomersChange}
        onDeleteCustomer={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("input-new-customer-demand"), "500");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-customer-error")).toBeInTheDocument();
  });

  // T9 (team-lead decision) — mirrors WarehousesTab's own T9 collision test
  // exactly: `id` is a hidden uid now, displayCode is the collision-checked
  // user-facing field.
  it("rejects an add-row whose displayCode collides with an existing added customer's, without calling onAddedCustomersChange", async () => {
    const onAddedCustomersChange = vi.fn();
    const existing = [{ id: "ac-existing", city: "Somewhere", state: "TX", lat: 1, lng: 2, demand: 10, displayCode: "DUPE" }];
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={existing}
        onAddedCustomersChange={onAddedCustomersChange}
        onDeleteCustomer={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Boston");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "MA");
    fireEvent.blur(screen.getByTestId("input-new-customer-state"));
    await userEvent.clear(screen.getByTestId("input-new-customer-display-code"));
    await userEvent.type(screen.getByTestId("input-new-customer-display-code"), "DUPE");
    await userEvent.type(screen.getByTestId("input-new-customer-demand"), "500");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-customer-error")).toBeInTheDocument();
  });

  it("renders an added customer row with a delete button, and clicking it calls onDeleteCustomer with its id", async () => {
    const onDeleteCustomer = vi.fn();
    const added = [{ id: "NEWC", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, demand: 500 }];
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={added}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={onDeleteCustomer}
      />,
    );

    expect(screen.getByTestId("row-added-customer-NEWC")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-delete-added-customer-NEWC"));
    expect(onDeleteCustomer).toHaveBeenCalledWith("NEWC");
  });

  it("base-dataset customer rows have NO delete affordance — only the status toggle", () => {
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
      />,
    );
    expect(screen.queryAllByTestId(/^button-delete-added-customer-/).length).toBe(0);
  });

  it("shows a precheck warning chip on an added customer with incomplete distance coverage", () => {
    const added = [{ id: "NEWC", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, demand: 500 }];
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={added}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
        precheckErrors={[{ code: "completeness", message: "CHI missing distances to 1 customer: NEWC" }]}
      />,
    );
    expect(screen.getByTestId("warning-precheck-added-customer-NEWC")).toHaveTextContent("1");
  });

  it("does not show a precheck warning chip on a complete added customer", () => {
    const added = [{ id: "NEWC", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, demand: 500 }];
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={added}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
        precheckErrors={[]}
      />,
    );
    expect(screen.queryByTestId("warning-precheck-added-customer-NEWC")).not.toBeInTheDocument();
  });

  it("renders the Added customers table with separate City/State/Lat/Lng cells (no Zip column)", () => {
    const added = [{ id: "NEWC", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, demand: 500 }];
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={added}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
      />,
    );
    const row = screen.getByTestId("row-added-customer-NEWC");
    expect(row).toHaveTextContent("Denver");
    expect(row).toHaveTextContent("CO");
    expect(row).toHaveTextContent("39.7400");
    expect(row).toHaveTextContent("-104.9900");
    expect(screen.queryByText("Zip")).not.toBeInTheDocument();
  });
});

// T9 — grid-mirror: the add-row form auto-fills lat/lng + a display code
// from City+State (T2's gazetteer + T3's nextDisplayCode), mirroring
// WarehousesTab.tsx's own T9 coverage exactly.
describe("CustomersTab — add-row grid-mirror auto-fill (T9)", () => {
  it("blurring City+State (both non-empty, a gazetteer hit) auto-fills Lat/Lng and a display code", async () => {
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Boston");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "MA");
    fireEvent.blur(screen.getByTestId("input-new-customer-state"));

    expect(screen.getByTestId("input-new-customer-lat")).toHaveValue(42.338551);
    expect(screen.getByTestId("input-new-customer-lng")).toHaveValue(-71.018253);
    expect(screen.getByTestId("input-new-customer-display-code")).toHaveValue("CS-MA-BOSTON-01");
  });

  it("a manual edit to the auto-filled Lat cell sticks — a later City/State blur does not re-overwrite it", async () => {
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Boston");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "MA");
    fireEvent.blur(screen.getByTestId("input-new-customer-state"));
    expect(screen.getByTestId("input-new-customer-lat")).toHaveValue(42.338551);

    await userEvent.clear(screen.getByTestId("input-new-customer-lat"));
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "1.2345");
    expect(screen.getByTestId("input-new-customer-lat")).toHaveValue(1.2345);

    fireEvent.blur(screen.getByTestId("input-new-customer-state"));
    expect(screen.getByTestId("input-new-customer-lat")).toHaveValue(1.2345);
  });

  it("a gazetteer miss (unknown city/state) leaves Lat/Lng blank for manual entry, and no display code is assigned", async () => {
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Nowheresville");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "ZZ");
    fireEvent.blur(screen.getByTestId("input-new-customer-state"));

    expect(screen.getByTestId("input-new-customer-lat")).toHaveValue(null);
    expect(screen.getByTestId("input-new-customer-lng")).toHaveValue(null);
    expect(screen.getByTestId("input-new-customer-display-code")).toHaveValue("");
  });
});

describe("CustomersTab — Upload/Download (A1.3)", () => {
  it("Upload/Download are disabled until a scenario is resolved", () => {
    render(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("button-export-customers-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-customers-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-customers")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=customers&format=csv", async () => {
    fetchMock.mockResolvedValue(new Response("id,demand\nC1,100", { status: 200, headers: { "content-type": "text/csv" } }));
    renderWithQueryClient(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} scenarioId={7} />);

    await userEvent.click(screen.getByTestId("button-export-customers-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/scenarios/7/export");
    expect(String(url)).toContain("entity=customers");
    expect(String(url)).toContain("format=csv");
  });

  it("Download JSON triggers the export fetch scoped to entity=customers&format=json", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ customers: [] }));
    renderWithQueryClient(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} scenarioId={7} />);

    await userEvent.click(screen.getByTestId("button-export-customers-json"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("entity=customers");
    expect(String(url)).toContain("format=json");
  });

  it("Upload button opens ImportDialog scoped to entity=customers", async () => {
    renderWithQueryClient(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} scenarioId={7} />);

    expect(screen.queryByText("Import customers")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("button-import-customers"));

    expect(screen.getByText("Import customers")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-customers")).toBeInTheDocument();
  });

  it("a successful import apply calls onImportApplied with the updated scenario", async () => {
    const updatedScenario = { id: 7, name: "S", modelId: "p-median-us", inputs: {}, result: null, createdAt: "x", updatedAt: "x" };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/import")) return jsonResponse({ errors: [], changes: [{ id: "C1", line: 2, before: {}, after: {} }], warnings: [] });
      if (url.endsWith("/import/apply")) return jsonResponse({ applied: 1, errors: [], scenario: updatedScenario });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    const onImportApplied = vi.fn();
    renderWithQueryClient(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        scenarioId={7}
        onImportApplied={onImportApplied}
      />,
    );

    await userEvent.click(screen.getByTestId("button-import-customers"));
    const file = new File(["id,demand\nC1,250"], "customers.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByTestId("input-import-file-customers"), file);
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onImportApplied).toHaveBeenCalledWith(updatedScenario));
  });
});

// Phase 3.2, Task 4 — Input Map click-to-place prefill.
describe("CustomersTab — Input Map prefill (Phase 3.2, Task 4)", () => {
  it("opens the add-row form and prefills Lat/Lng when prefillCoords is set", () => {
    const onPrefillConsumed = vi.fn();
    render(
      <CustomersTab
        customers={[]} overrides={[]} onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
        prefillCoords={{ lat: 40.1234, lng: -75.5678 }}
        onPrefillConsumed={onPrefillConsumed}
      />
    );
    expect(screen.getByTestId("input-new-customer-lat")).toHaveValue(40.1234);
    expect(screen.getByTestId("input-new-customer-lng")).toHaveValue(-75.5678);
    expect(onPrefillConsumed).toHaveBeenCalledTimes(1);
  });

  it("does not open the add-row form or call onPrefillConsumed when prefillCoords is null", () => {
    const onPrefillConsumed = vi.fn();
    render(
      <CustomersTab
        customers={customers} overrides={[]} onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={vi.fn()}
        onDeleteCustomer={vi.fn()}
        prefillCoords={null}
        onPrefillConsumed={onPrefillConsumed}
      />
    );
    expect(screen.queryByTestId("add-customer-row-form")).not.toBeInTheDocument();
    expect(onPrefillConsumed).not.toHaveBeenCalled();
  });
});
