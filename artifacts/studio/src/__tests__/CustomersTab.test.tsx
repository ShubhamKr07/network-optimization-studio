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
    expect(screen.getByText("New York, NY")).toBeInTheDocument();
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
