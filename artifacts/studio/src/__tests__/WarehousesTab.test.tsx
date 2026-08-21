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
    expect(screen.getByText("Chicago, IL")).toBeInTheDocument();
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
});
