import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MinesTab } from "@/components/workspace/tabs/MinesTab";

const mines = [
  { id: "M1", city: "Gillette", state: "WY" },
  { id: "M2", city: "Farmington", state: "NM" },
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

describe("MinesTab", () => {
  it("renders the real MineTable with the dataset's mines (not a placeholder)", () => {
    render(<MinesTab mines={mines} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByText("M1")).toBeInTheDocument();
    expect(screen.getByText("Gillette, WY")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("shows an empty state when the dataset has no mines", () => {
    render(<MinesTab mines={[]} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("mines-tab-empty")).toBeInTheDocument();
  });

  it("calls onChange with an upserted capacity override", () => {
    const onChange = vi.fn();
    render(<MinesTab mines={mines} overrides={[]} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("input-mine-capacity-M1"), { target: { value: "5000" } });
    expect(onChange).toHaveBeenCalledWith([{ id: "M1", capacity: 5000 }]);
  });
});

describe("MinesTab — Upload/Download (A5.1)", () => {
  it("Upload/Download are disabled until a scenario is resolved", () => {
    render(<MinesTab mines={mines} overrides={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("button-export-mines-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-mines-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-mines")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=mines&format=csv", async () => {
    fetchMock.mockResolvedValue(new Response("id,capacity\nM1,5000", { status: 200, headers: { "content-type": "text/csv" } }));
    renderWithQueryClient(<MinesTab mines={mines} overrides={[]} onChange={vi.fn()} scenarioId={7} />);

    await userEvent.click(screen.getByTestId("button-export-mines-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/scenarios/7/export");
    expect(String(url)).toContain("entity=mines");
    expect(String(url)).toContain("format=csv");
  });

  it("Upload button opens ImportDialog scoped to entity=mines", async () => {
    renderWithQueryClient(<MinesTab mines={mines} overrides={[]} onChange={vi.fn()} scenarioId={7} />);
    expect(screen.queryByText("Import mines")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-mines"));
    expect(screen.getByText("Import mines")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-mines")).toBeInTheDocument();
  });

  it("a successful import apply calls onImportApplied with the updated scenario", async () => {
    const updatedScenario = { id: 7, name: "S", modelId: "transport-coal", inputs: {}, result: null, createdAt: "x", updatedAt: "x" };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/import")) return jsonResponse({ errors: [], changes: [{ id: "M1", line: 2, before: {}, after: {} }], warnings: [] });
      if (url.endsWith("/import/apply")) return jsonResponse({ applied: 1, errors: [], scenario: updatedScenario });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    const onImportApplied = vi.fn();
    renderWithQueryClient(
      <MinesTab mines={mines} overrides={[]} onChange={vi.fn()} scenarioId={7} onImportApplied={onImportApplied} />,
    );

    await userEvent.click(screen.getByTestId("button-import-mines"));
    const file = new File(["id,capacity\nM1,5000"], "mines.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByTestId("input-import-file-mines"), file);
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onImportApplied).toHaveBeenCalledWith(updatedScenario));
  });
});
