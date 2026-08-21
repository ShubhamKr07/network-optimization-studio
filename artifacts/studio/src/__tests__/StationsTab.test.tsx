import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StationsTab } from "@/components/workspace/tabs/StationsTab";

const stations = [
  { id: "S1", city: "Chicago", state: "IL" },
  { id: "S2", city: "Detroit", state: "MI" },
];

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

describe("StationsTab", () => {
  it("renders the real StationTable with the dataset's stations (not a placeholder)", () => {
    render(<StationsTab stations={stations} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByText("S1")).toBeInTheDocument();
    expect(screen.getByText("Chicago, IL")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("shows an empty state when the dataset has no stations", () => {
    render(<StationsTab stations={[]} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("stations-tab-empty")).toBeInTheDocument();
  });

  it("calls onChange with an upserted demand override", () => {
    const onChange = vi.fn();
    render(<StationsTab stations={stations} overrides={[]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("input-station-demand-S1"), { target: { value: "2000" } });
    expect(onChange).toHaveBeenCalledWith([{ id: "S1", demand: 2000 }]);
  });
});

describe("StationsTab — Upload/Download (A5.1)", () => {
  it("Upload/Download are disabled until a scenario is resolved", () => {
    render(<StationsTab stations={stations} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("button-export-stations-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-stations-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-stations")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=stations&format=csv", async () => {
    fetchMock.mockResolvedValue(new Response("id,demand\nS1,2000", { status: 200, headers: { "content-type": "text/csv" } }));
    renderWithQueryClient(<StationsTab stations={stations} overrides={[]} onChange={vi.fn()} scenarioId={7} />);

    await userEvent.click(screen.getByTestId("button-export-stations-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/scenarios/7/export");
    expect(String(url)).toContain("entity=stations");
    expect(String(url)).toContain("format=csv");
  });

  it("Upload button opens ImportDialog scoped to entity=stations", async () => {
    renderWithQueryClient(<StationsTab stations={stations} overrides={[]} onChange={vi.fn()} scenarioId={7} />);
    expect(screen.queryByText("Import stations")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-stations"));
    expect(screen.getByText("Import stations")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-stations")).toBeInTheDocument();
  });

  it("a successful import apply calls onImportApplied with the updated scenario", async () => {
    const updatedScenario = { id: 7, name: "S", modelId: "transport-coal", inputs: {}, result: null, createdAt: "x", updatedAt: "x" };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/import")) return jsonResponse({ errors: [], changes: [{ id: "S1", line: 2, before: {}, after: {} }], warnings: [] });
      if (url.endsWith("/import/apply")) return jsonResponse({ applied: 1, errors: [], scenario: updatedScenario });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    const onImportApplied = vi.fn();
    renderWithQueryClient(
      <StationsTab stations={stations} overrides={[]} onChange={vi.fn()} scenarioId={7} onImportApplied={onImportApplied} />,
    );

    await userEvent.click(screen.getByTestId("button-import-stations"));
    const file = new File(["id,demand\nS1,2000"], "stations.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByTestId("input-import-file-stations"), file);
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onImportApplied).toHaveBeenCalledWith(updatedScenario));
  });
});
