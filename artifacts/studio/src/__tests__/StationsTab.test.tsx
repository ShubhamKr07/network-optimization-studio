import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor, fireEvent } from "@testing-library/react";
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
import { StationsTab } from "@/components/workspace/tabs/StationsTab";

const stations = [
  { id: "S1", city: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 },
  { id: "S2", city: "Detroit", state: "MI", lat: 42.3314, lng: -83.0458 },
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
    expect(screen.getByText("Chicago")).toBeInTheDocument();
    expect(screen.getByText("IL")).toBeInTheDocument();
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
    rtlRender(
      <ExportProviderTestWrapper value={{ scenarioId: null }}>
        <StationsTab stations={stations} overrides={[]} onChange={vi.fn()} />
      </ExportProviderTestWrapper>,
    );
    expect(screen.getByTestId("button-export-stations-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-stations-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-stations")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=stations&format=csv", async () => {
    fetchMock.mockResolvedValue(new Response("id,demand\nS1,2000", { status: 200, headers: { "content-type": "text/csv" } }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    rtlRender(
      <QueryClientProvider client={queryClient}>
        <ExportProviderTestWrapper value={{ scenarioId: 7 }}>
          <StationsTab stations={stations} overrides={[]} onChange={vi.fn()} scenarioId={7} />
        </ExportProviderTestWrapper>
      </QueryClientProvider>,
    );

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

// Task 30 (B6.1 stage 4) — add/delete added stations, mirroring
// CustomersTab.test.tsx's own add/delete block (demand required, no status
// column) rather than MinesTab's (capacity optional).
describe("StationsTab — add/delete added stations (Task 30)", () => {
  it("does not render an Added stations section when onAddedStationsChange is not wired", () => {
    render(<StationsTab stations={stations} overrides={[]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("added-stations-section")).not.toBeInTheDocument();
  });

  it("shows an empty message when there are no added stations yet", () => {
    render(
      <StationsTab stations={stations} overrides={[]} onChange={vi.fn()} addedStations={[]} onAddedStationsChange={vi.fn()} onDeleteStation={vi.fn()} />,
    );
    expect(screen.getByTestId("added-stations-empty")).toBeInTheDocument();
  });

  // T11 (Step A) — `id` is now a hidden T3 stable uid (`as-<uuid>`), never
  // user-typed; `displayCode` is the human-facing label, auto-filled from
  // City/State via T2's gazetteer, mirroring CustomersTab.tsx's own T9
  // migration exactly.
  it("filling the add-row form and confirming calls onAddedStationsChange with the new entity appended, matching addedStationSchema's shape", async () => {
    const onAddedStationsChange = vi.fn();
    render(
      <StationsTab stations={stations} overrides={[]} onChange={vi.fn()} addedStations={[]} onAddedStationsChange={onAddedStationsChange} onDeleteStation={vi.fn()} />,
    );

    await userEvent.click(screen.getByTestId("button-add-station-row"));
    await userEvent.type(screen.getByTestId("input-new-station-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-station-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-station-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-station-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("input-new-station-demand"), "900000");
    await userEvent.click(screen.getByTestId("button-add-station-confirm"));

    expect(onAddedStationsChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedStationsChange.mock.calls[0][0];
    expect(added).toMatchObject({
      city: "Denver",
      state: "CO",
      lat: 39.74,
      lng: -104.99,
      demand: 900000,
      displayCode: "ST-CO-DENVER-01",
    });
    expect(added.id).toMatch(/^as-/);
  });

  it("rejects an add-row with a blank demand — demand is required, unlike mine capacity", async () => {
    const onAddedStationsChange = vi.fn();
    render(
      <StationsTab stations={stations} overrides={[]} onChange={vi.fn()} addedStations={[]} onAddedStationsChange={onAddedStationsChange} onDeleteStation={vi.fn()} />,
    );

    await userEvent.click(screen.getByTestId("button-add-station-row"));
    await userEvent.type(screen.getByTestId("input-new-station-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-station-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-station-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-station-lng"), "-104.99");
    // Demand left blank on purpose.
    await userEvent.click(screen.getByTestId("button-add-station-confirm"));

    expect(onAddedStationsChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-station-error")).toBeInTheDocument();
  });

  // T11 (Step A) — displayCode is now the user-facing, collision-checked
  // field (the old "ID" input's role), since `id` is a hidden uid that
  // can't meaningfully collide. Mirrors CustomersTab's own T9 test exactly.
  it("rejects an add-row whose displayCode collides with an existing added station's, without calling onAddedStationsChange", async () => {
    const onAddedStationsChange = vi.fn();
    const existing = [{ id: "as-existing", city: "Somewhere", state: "TX", lat: 1, lng: 2, demand: 10, displayCode: "DUPE" }];
    render(
      <StationsTab stations={stations} overrides={[]} onChange={vi.fn()} addedStations={existing} onAddedStationsChange={onAddedStationsChange} onDeleteStation={vi.fn()} />,
    );

    await userEvent.click(screen.getByTestId("button-add-station-row"));
    await userEvent.type(screen.getByTestId("input-new-station-city"), "Chicago");
    await userEvent.type(screen.getByTestId("input-new-station-state"), "IL");
    fireEvent.blur(screen.getByTestId("input-new-station-state"));
    await userEvent.clear(screen.getByTestId("input-new-station-display-code"));
    await userEvent.type(screen.getByTestId("input-new-station-display-code"), "DUPE");
    await userEvent.type(screen.getByTestId("input-new-station-demand"), "500");
    await userEvent.click(screen.getByTestId("button-add-station-confirm"));

    expect(onAddedStationsChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-station-error")).toBeInTheDocument();
  });

  it("renders an added station row with a delete button, and clicking it calls onDeleteStation with its id", async () => {
    const onDeleteStation = vi.fn();
    const added = [{ id: "SNEW", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 900000 }];
    render(
      <StationsTab stations={stations} overrides={[]} onChange={vi.fn()} addedStations={added} onAddedStationsChange={vi.fn()} onDeleteStation={onDeleteStation} />,
    );

    expect(screen.getByTestId("row-added-station-SNEW")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-delete-added-station-SNEW"));
    expect(onDeleteStation).toHaveBeenCalledWith("SNEW");
  });

  it("base-dataset station rows have NO delete affordance", () => {
    render(
      <StationsTab stations={stations} overrides={[]} onChange={vi.fn()} addedStations={[]} onAddedStationsChange={vi.fn()} onDeleteStation={vi.fn()} />,
    );
    expect(screen.queryAllByTestId(/^button-delete-added-station-/).length).toBe(0);
  });

  it("shows a precheck warning chip on an added station missing a lane cost from a mine", () => {
    const added = [{ id: "SNEW", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 900000 }];
    render(
      <StationsTab
        stations={stations}
        overrides={[]}
        onChange={vi.fn()}
        addedStations={added}
        onAddedStationsChange={vi.fn()}
        onDeleteStation={vi.fn()}
        precheckErrors={[{ code: "completeness", message: "M1 missing lane costs to 1 station: SNEW" }]}
      />,
    );
    expect(screen.getByTestId("warning-precheck-added-station-SNEW")).toHaveTextContent("1");
  });

  it("renders the Added stations table with separate City/State/Lat/Lng cells (no Zip column)", () => {
    const added = [{ id: "SNEW", city: "Newtown", state: "NC", lat: 35.5, lng: -80.2, demand: 900000 }];
    render(
      <StationsTab stations={stations} overrides={[]} onChange={vi.fn()} addedStations={added} onAddedStationsChange={vi.fn()} onDeleteStation={vi.fn()} />,
    );
    const row = screen.getByTestId("row-added-station-SNEW");
    expect(row).toHaveTextContent("Newtown");
    expect(row).toHaveTextContent("NC");
    expect(row).toHaveTextContent("35.5000");
    expect(row).toHaveTextContent("-80.2000");
    expect(screen.queryByText("Zip")).not.toBeInTheDocument();
  });
});

// CLEANUP (Workspace fixups 2, item 1) — the Added Entities tab (and its
// the per-model add/base render flags are permanently gone; this tab always
// renders its base table + toolbar TOGETHER WITH its inline "+ Add …"
// add-section in the same tab (the permanent post-revert shape, spec §1).
describe("StationsTab — base table + inline add-section always render together (item 1)", () => {
  const addedStationsProps = {
    addedStations: [],
    onAddedStationsChange: vi.fn(),
    onDeleteStation: vi.fn(),
  };

  it("renders the base table + toolbar AND the inline added section together, with no flag", () => {
    render(
      <StationsTab
        stations={stations}
        overrides={[]}
        onChange={vi.fn()}
        scenarioId={7}
        {...addedStationsProps}
      />,
    );
    expect(screen.getByTestId("stations-tab")).toBeInTheDocument();
    expect(screen.getByTestId("stations-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-export-stations-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-stations")).toBeInTheDocument();
    expect(screen.getByText("S1")).toBeInTheDocument();
    expect(screen.getByTestId("added-stations-section")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-station-row")).toBeInTheDocument();
  });

  it("clicking '+ Add station' opens the add-row form alongside the still-visible base table", async () => {
    render(
      <StationsTab
        stations={stations}
        overrides={[]}
        onChange={vi.fn()}
        {...addedStationsProps}
      />,
    );
    expect(screen.queryByTestId("add-station-row-form")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-station-row"));
    expect(screen.getByTestId("add-station-row-form")).toBeInTheDocument();
    expect(screen.getByTestId("stations-tab")).toBeInTheDocument();
    expect(screen.getByText("S1")).toBeInTheDocument();
  });
});
