import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { AllProviders, ExportProviderTestWrapper } from "@/__tests__/helpers/renderWithExportProvider";
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

// T5 (Bundle 2, Step 2b) — demandEditable:false (p-median-brazil's
// textbook-fixed region demand) threaded straight through to CustomerTable;
// the "Added customers" section is NEVER gated by it (a new region has no
// textbook demand to protect).
describe("CustomersTab — demandEditable (T5, Bundle 2, Step 2b)", () => {
  it("omitting demandEditable defaults to editable — today's exact behavior, unchanged", () => {
    render(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("input-customer-demand-C1")).toBeEnabled();
  });

  it("demandEditable=false disables the BASE-row demand field in the grid", () => {
    render(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} demandEditable={false} />);
    expect(screen.getByTestId("input-customer-demand-C1")).toBeDisabled();
  });

  it("demandEditable=false still leaves an ADDED customer's demand field editable", async () => {
    const onAddedCustomersChange = vi.fn();
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        demandEditable={false}
        addedCustomers={[{ id: "ac-1", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, demand: 500 }]}
        onAddedCustomersChange={onAddedCustomersChange}
        onDeleteCustomer={vi.fn()}
      />,
    );
    const addedDemandInput = screen.getByTestId("input-added-customer-demand-ac-1");
    expect(addedDemandInput).toBeEnabled();
    fireEvent.change(addedDemandInput, { target: { value: "600" } });
    expect(onAddedCustomersChange).toHaveBeenCalledWith([{ id: "ac-1", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, demand: 600 }]);
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
    // T14b — the export buttons' disabled state now comes from the
    // ExportProvider context (scenarioId: null -> "Loading…"), not this
    // component's own scenarioId prop; Import still reads the prop directly.
    rtlRender(
      <ExportProviderTestWrapper value={{ scenarioId: null }}>
        <CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} />
      </ExportProviderTestWrapper>,
    );
    expect(screen.getByTestId("button-export-customers-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-customers-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-customers")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=customers&format=csv", async () => {
    fetchMock.mockResolvedValue(new Response("id,demand\nC1,100", { status: 200, headers: { "content-type": "text/csv" } }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    rtlRender(
      <QueryClientProvider client={queryClient}>
        <ExportProviderTestWrapper value={{ scenarioId: 7 }}>
          <CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} scenarioId={7} />
        </ExportProviderTestWrapper>
      </QueryClientProvider>,
    );

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

// CLEANUP (Workspace fixups 2, item 1) — the Added Entities tab (and its
// the per-model add/base render flags are permanently gone; this tab always
// renders its base table + toolbar TOGETHER WITH its inline "+ Add …"
// add-section in the same tab (the permanent post-revert shape, spec §1).
describe("CustomersTab — base table + inline add-section always render together (item 1)", () => {
  const addedCustomersProps = {
    addedCustomers: [],
    onAddedCustomersChange: vi.fn(),
    onDeleteCustomer: vi.fn(),
  };

  it("renders the base table + toolbar AND the inline added section together, with no flag", () => {
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        scenarioId={7}
        {...addedCustomersProps}
      />,
    );
    expect(screen.getByTestId("customers-tab")).toBeInTheDocument();
    expect(screen.getByTestId("customers-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-customers-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-customers")).toBeInTheDocument();
    expect(screen.getByText("C1")).toBeInTheDocument();
    expect(screen.getByTestId("added-customers-section")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-customer-row")).toBeInTheDocument();
  });

  it("clicking '+ Add customer' opens the add-row form alongside the still-visible base table", async () => {
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        {...addedCustomersProps}
      />,
    );
    expect(screen.queryByTestId("add-customer-row-form")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    expect(screen.getByTestId("add-customer-row-form")).toBeInTheDocument();
    expect(screen.getByTestId("customers-tab")).toBeInTheDocument();
    expect(screen.getByText("C1")).toBeInTheDocument();
  });
});

// T11 (Chapter 9 JADE) — per-product demand editing. productMode only turns
// on when BOTH `products` (non-empty) AND `onProductOverridesChange` are
// wired — mirrors every other tab's "gate on the actual capability, not
// just a truthy prop" fix (WarehousesTab/CustomersTab's own established
// pattern for addedWarehouses/addedCustomers).
describe("CustomersTab — per-product demand (Chapter 9 JADE, T11)", () => {
  const products = [
    { id: "product-1", name: "Copper" },
    { id: "product-2", name: "Aluminum" },
  ];
  const jadeCustomers = [
    { id: "customer-1", city: "Phoenix", state: "AZ", lat: 33.45, lng: -112.07, demand: 30, demands: { "product-1": 10, "product-2": 20 } },
    { id: "customer-2", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8, demand: 15, demands: { "product-1": 5, "product-2": 10 } },
  ];

  it("does not switch into product mode when products is omitted (every non-JADE model unaffected)", () => {
    render(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("customer-product-table")).not.toBeInTheDocument();
    expect(screen.getByText("C1")).toBeInTheDocument();
  });

  it("does not switch into product mode when products is set but onProductOverridesChange isn't wired (defensive, capability-gated)", () => {
    render(<CustomersTab customers={jadeCustomers} overrides={[]} onChange={vi.fn()} products={products} />);
    expect(screen.queryByTestId("customer-product-table")).not.toBeInTheDocument();
  });

  it("renders one demand column per product, seeded from base Customer.demands, when the full capability is wired", () => {
    render(
      <CustomersTab
        customers={jadeCustomers}
        overrides={[]}
        onChange={vi.fn()}
        products={products}
        productOverrides={[]}
        onProductOverridesChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("customer-product-table")).toBeInTheDocument();
    expect(screen.getByText("Copper")).toBeInTheDocument();
    expect(screen.getByText("Aluminum")).toBeInTheDocument();
    expect(screen.getByTestId("input-customer-demand-customer-1-product-1")).toHaveValue(10);
    expect(screen.getByTestId("input-customer-demand-customer-1-product-2")).toHaveValue(20);
    // Legacy scalar "Demand" column/input is NOT rendered in product mode.
    expect(screen.queryByTestId("input-customer-demand-customer-1")).not.toBeInTheDocument();
  });

  it("editing one product's demand cell calls onProductOverridesChange with a sparse per-product override, leaving the other product's demand untouched", () => {
    const onProductOverridesChange = vi.fn();
    render(
      <CustomersTab
        customers={jadeCustomers}
        overrides={[]}
        onChange={vi.fn()}
        products={products}
        productOverrides={[]}
        onProductOverridesChange={onProductOverridesChange}
      />,
    );
    fireEvent.change(screen.getByTestId("input-customer-demand-customer-1-product-1"), { target: { value: "99" } });
    expect(onProductOverridesChange).toHaveBeenCalledWith([
      { id: "customer-1", status: "active", demands: { "product-1": 99 } },
    ]);
  });

  it("Active/Excluded status toggle still works in product mode, via the productOverrides callback", () => {
    const onProductOverridesChange = vi.fn();
    render(
      <CustomersTab
        customers={jadeCustomers}
        overrides={[]}
        onChange={vi.fn()}
        products={products}
        productOverrides={[]}
        onProductOverridesChange={onProductOverridesChange}
      />,
    );
    fireEvent.click(screen.getByTestId("button-customer-customer-1-excluded"));
    expect(onProductOverridesChange).toHaveBeenCalledWith([{ id: "customer-1", status: "excluded", demands: undefined }]);
  });

  it("the Added customers section renders one demand input per product (not a single scalar Demand field) in product mode", async () => {
    const onAddedCustomersChange = vi.fn();
    render(
      <CustomersTab
        customers={jadeCustomers}
        overrides={[]}
        onChange={vi.fn()}
        products={products}
        productOverrides={[]}
        onProductOverridesChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={onAddedCustomersChange}
        onDeleteCustomer={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    expect(screen.queryByTestId("input-new-customer-demand")).not.toBeInTheDocument();
    expect(screen.getByTestId("input-new-customer-demand-product-1")).toBeInTheDocument();
    expect(screen.getByTestId("input-new-customer-demand-product-2")).toBeInTheDocument();

    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-customer-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("input-new-customer-demand-product-1"), "40");
    await userEvent.type(screen.getByTestId("input-new-customer-demand-product-2"), "60");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedCustomersChange.mock.calls[0][0];
    expect(added).toMatchObject({
      city: "Denver",
      state: "CO",
      demands: { "product-1": 40, "product-2": 60 },
      demand: 100,
    });
  });

  it("a blank product demand cell on the add-row form defaults to 0, not a blocking error", async () => {
    const onAddedCustomersChange = vi.fn();
    render(
      <CustomersTab
        customers={jadeCustomers}
        overrides={[]}
        onChange={vi.fn()}
        products={products}
        productOverrides={[]}
        onProductOverridesChange={vi.fn()}
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
    await userEvent.type(screen.getByTestId("input-new-customer-demand-product-1"), "40");
    // product-2 left blank
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedCustomersChange.mock.calls[0][0];
    expect(added.demands).toEqual({ "product-1": 40, "product-2": 0 });
    expect(added.demand).toBe(40);
  });

  it("an added customer row in product mode renders one demand column per product, and editing one cell recomputes the scalar demand sum", () => {
    const onAddedCustomersChange = vi.fn();
    const added = [
      { id: "ac-jade-1", city: "Denver", state: "CO", lat: 39.74, lng: -104.99, demand: 40, demands: { "product-1": 40, "product-2": 0 } },
    ];
    render(
      <CustomersTab
        customers={jadeCustomers}
        overrides={[]}
        onChange={vi.fn()}
        products={products}
        productOverrides={[]}
        onProductOverridesChange={vi.fn()}
        addedCustomers={added}
        onAddedCustomersChange={onAddedCustomersChange}
        onDeleteCustomer={vi.fn()}
      />,
    );
    expect(screen.getByTestId("input-added-customer-demand-ac-jade-1-product-1")).toHaveValue(40);
    expect(screen.getByTestId("input-added-customer-demand-ac-jade-1-product-2")).toHaveValue(0);
    fireEvent.change(screen.getByTestId("input-added-customer-demand-ac-jade-1-product-2"), { target: { value: "25" } });
    const [nextAdded] = onAddedCustomersChange.mock.calls[0][0];
    expect(nextAdded).toMatchObject({ demands: { "product-1": 40, "product-2": 25 }, demand: 65 });
  });
});

// Chen's Cosmetics (chens-cosmetics-cn) — a China dataset where every
// customer row has `state: ""`. `hasStateColumn` is gated on DATA PRESENCE
// by the caller (Workspace.tsx), not modelId — this component just respects
// the prop.
describe("CustomersTab — hasStateColumn (Chen's Cosmetics, no state data)", () => {
  it("omitting hasStateColumn (default true) keeps the State column — unchanged behavior", () => {
    render(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByText("State")).toBeInTheDocument();
    expect(screen.getByText("NY")).toBeInTheDocument();
  });

  it("hasStateColumn=false drops the State column header and cells from the base table", () => {
    render(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} hasStateColumn={false} />);
    expect(screen.queryByText("State")).not.toBeInTheDocument();
    expect(screen.queryByText("NY")).not.toBeInTheDocument();
    // City still renders.
    expect(screen.getByText("New York")).toBeInTheDocument();
  });

  it("hasStateColumn=false hides the State input in the add-row form", async () => {
    const onAddedCustomersChange = vi.fn();
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={onAddedCustomersChange}
        onDeleteCustomer={vi.fn()}
        hasStateColumn={false}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    expect(screen.queryByTestId("input-new-customer-state")).not.toBeInTheDocument();
  });

  it("hasStateColumn=false: add-row succeeds with city+lat+lng+demand only (no state), state stored as empty string", async () => {
    const onAddedCustomersChange = vi.fn();
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={onAddedCustomersChange}
        onDeleteCustomer={vi.fn()}
        hasStateColumn={false}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-city"), "Shanghai");
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "31.23");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "121.47");
    await userEvent.type(screen.getByTestId("input-new-customer-demand"), "500");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedCustomersChange.mock.calls[0][0];
    expect(added).toMatchObject({ city: "Shanghai", state: "", lat: 31.23, lng: 121.47, demand: 500 });
  });

  it("hasStateColumn=false: leaving City blank still rejects the add-row (city-only requirement)", async () => {
    const onAddedCustomersChange = vi.fn();
    render(
      <CustomersTab
        customers={customers}
        overrides={[]}
        onChange={vi.fn()}
        addedCustomers={[]}
        onAddedCustomersChange={onAddedCustomersChange}
        onDeleteCustomer={vi.fn()}
        hasStateColumn={false}
      />,
    );
    await userEvent.click(screen.getByTestId("button-add-customer-row"));
    await userEvent.type(screen.getByTestId("input-new-customer-lat"), "31.23");
    await userEvent.type(screen.getByTestId("input-new-customer-lng"), "121.47");
    await userEvent.click(screen.getByTestId("button-add-customer-confirm"));

    expect(onAddedCustomersChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-customer-error")).toHaveTextContent("City is required.");
  });
});

// B7 (JADE Ch.9 Workspace Bundle, spec §10) — opt-in `enableFilters` gate on
// the shared A3 FilterMenu. Defaults `false`: every test above (every
// existing caller) omits the prop and must see zero behavior change.
describe("CustomersTab — enableFilters (B7, opt-in shared FilterMenu)", () => {
  const manyCustomers = Array.from({ length: 12 }, (_, i) => ({
    id: `C${i + 1}`,
    city: `City${i + 1}`,
    state: "NY",
    lat: 40 + i,
    lng: -74 - i,
    demand: 100 + i,
  }));

  it("omitting enableFilters never renders the FilterMenu trigger, even with >10 rows", () => {
    render(<CustomersTab customers={manyCustomers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
  });

  it("enableFilters=true hides the FilterMenu at <=10 rows", () => {
    render(<CustomersTab customers={customers} overrides={[]} onChange={vi.fn()} enableFilters />);
    expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
  });

  it("enableFilters=true shows the FilterMenu and narrows the base table once rows exceed 10", async () => {
    render(<CustomersTab customers={manyCustomers} overrides={[]} onChange={vi.fn()} enableFilters />);
    expect(screen.getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    expect(screen.getByText("City5")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-city"), "City5");

    expect(screen.getByText("City5")).toBeInTheDocument();
    expect(screen.queryByText("City1")).not.toBeInTheDocument();
  });
});

// T8 (Workspace fixups 2, item 3) — the FilterMenu must sit on the SAME
// header row as the Import/Export toolbar (CustomersTab already mounts it
// there — `toolbar`'s own `flex items-center gap-1.5 mb-2` div — this locks
// that placement in as a regression guard). Non-JADE tabs (enableFilters
// omitted) still render no FilterMenu at all.
describe("CustomersTab — FilterMenu placement (T8, item 3)", () => {
  const manyCustomers = Array.from({ length: 12 }, (_, i) => ({
    id: `C${i + 1}`,
    city: `City${i + 1}`,
    state: "NY",
    lat: 40 + i,
    lng: -74 - i,
    demand: 100 + i,
  }));

  it("JADE-enabled tab: the FilterMenu trigger is inside the SAME toolbar row as the Import/Export buttons", () => {
    render(<CustomersTab customers={manyCustomers} overrides={[]} onChange={vi.fn()} enableFilters />);
    const toolbar = screen.getByTestId("customers-tab-toolbar");
    expect(toolbar).toContainElement(screen.getByTestId("button-export-customers-csv"));
    expect(toolbar).toContainElement(screen.getByTestId("button-import-customers"));
    expect(toolbar).toContainElement(screen.getByTestId("button-filter-menu-trigger"));
  });

  it("non-JADE tab (enableFilters omitted): no FilterMenu anywhere, even with >10 rows", () => {
    render(<CustomersTab customers={manyCustomers} overrides={[]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
    expect(screen.getByTestId("customers-tab-toolbar")).toBeInTheDocument();
  });
});
