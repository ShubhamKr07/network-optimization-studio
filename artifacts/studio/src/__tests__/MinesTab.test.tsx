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
import { MinesTab } from "@/components/workspace/tabs/MinesTab";
import { chooseInputDownload, chooseUpload } from "@/__tests__/helpers/inputTable";

const mines = [
  { id: "M1", city: "Gillette", state: "WY", lat: 44.2911, lng: -105.5022 },
  { id: "M2", city: "Farmington", state: "NM", lat: 36.7281, lng: -108.2187 },
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
    expect(screen.getByText("Gillette")).toBeInTheDocument();
    expect(screen.getByText("WY")).toBeInTheDocument();
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
    rtlRender(
      <ExportProviderTestWrapper value={{ scenarioId: null }}>
        <MinesTab mines={mines} overrides={[]} onChange={vi.fn()} />
      </ExportProviderTestWrapper>,
    );
    // SCU-2.P4 (B2.3/B2.4) — one Download ▾ trigger now carries the disabled state.
    expect(screen.getByTestId("button-download-mines")).toBeDisabled();
    expect(screen.getByTestId("button-import-mines")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=mines&format=csv", async () => {
    fetchMock.mockResolvedValue(new Response("id,capacity\nM1,5000", { status: 200, headers: { "content-type": "text/csv" } }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    rtlRender(
      <QueryClientProvider client={queryClient}>
        <ExportProviderTestWrapper value={{ scenarioId: 7 }}>
          <MinesTab mines={mines} overrides={[]} onChange={vi.fn()} scenarioId={7} />
        </ExportProviderTestWrapper>
      </QueryClientProvider>,
    );

    chooseInputDownload("mines", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/scenarios/7/export");
    expect(String(url)).toContain("entity=mines");
    expect(String(url)).toContain("format=csv");
  });

  it("Upload button opens ImportDialog scoped to entity=mines", async () => {
    renderWithQueryClient(<MinesTab mines={mines} overrides={[]} onChange={vi.fn()} scenarioId={7} />);
    expect(screen.queryByText("Import mines")).not.toBeInTheDocument();
    chooseUpload("mines", "csv");
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

    chooseUpload("mines", "csv");
    const file = new File(["id,capacity\nM1,5000"], "mines.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByTestId("input-import-file-mines"), file);
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onImportApplied).toHaveBeenCalledWith(updatedScenario));
  });
});

// Task 30 (B6.1 stage 4) — add/delete added mines, mirroring
// WarehousesTab.test.tsx's own "add/delete added warehouses (B5.2)" block.
describe("MinesTab — add/delete added mines (Task 30)", () => {
  it("does not render an Added mines section when onAddedMinesChange is not wired", () => {
    render(<MinesTab mines={mines} overrides={[]} onChange={vi.fn()} />);
    expect(screen.queryByTestId("added-mines-section")).not.toBeInTheDocument();
  });

  it("shows an empty message when there are no added mines yet", () => {
    render(
      <MinesTab mines={mines} overrides={[]} onChange={vi.fn()} addedMines={[]} onAddedMinesChange={vi.fn()} onDeleteMine={vi.fn()} />,
    );
    expect(screen.getByTestId("added-mines-empty")).toBeInTheDocument();
  });

  // T11 (Step A) — `id` is now a hidden T3 stable uid (`am-<uuid>`), never
  // user-typed; `displayCode` is the human-facing label, auto-filled from
  // City/State via T2's gazetteer, mirroring WarehousesTab.tsx's own T9
  // migration exactly.
  it("filling the add-row form (with a capacity) and confirming calls onAddedMinesChange with the new entity appended, matching addedMineSchema's shape", async () => {
    const onAddedMinesChange = vi.fn();
    render(
      <MinesTab mines={mines} overrides={[]} onChange={vi.fn()} addedMines={[]} onAddedMinesChange={onAddedMinesChange} onDeleteMine={vi.fn()} />,
    );

    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.type(screen.getByTestId("create-entity-capacity"), "5000000");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedMinesChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedMinesChange.mock.calls[0][0];
    expect(added).toMatchObject({
      city: "Denver",
      state: "CO",
      lat: 39.74,
      lng: -104.99,
      capacity: 5000000,
      displayCode: "MN-CO-DENVER-01",
    });
    expect(added.id).toMatch(/^am-/);
  });

  it("filling the add-row form with a BLANK capacity is accepted — blank means unconstrained, not an error", async () => {
    const onAddedMinesChange = vi.fn();
    render(
      <MinesTab mines={mines} overrides={[]} onChange={vi.fn()} addedMines={[]} onAddedMinesChange={onAddedMinesChange} onDeleteMine={vi.fn()} />,
    );

    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    // Capacity left blank on purpose.
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedMinesChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedMinesChange.mock.calls[0][0];
    expect(added).toMatchObject({ city: "Denver", state: "CO", lat: 39.74, lng: -104.99, capacity: null });
    expect(added.id).toMatch(/^am-/);
    expect(screen.queryByTestId("create-entity-error")).not.toBeInTheDocument();
  });

  // T11 (Step A) — displayCode is now the user-facing, collision-checked
  // field (the old "ID" input's role), since `id` is a hidden uid that
  // can't meaningfully collide. Mirrors WarehousesTab's own T9 test exactly.
  it("rejects an add-row whose displayCode collides with an existing added mine's, without calling onAddedMinesChange", async () => {
    const onAddedMinesChange = vi.fn();
    const existing = [{ id: "am-existing", city: "Somewhere", state: "TX", lat: 1, lng: 2, capacity: null, displayCode: "DUPE" }];
    render(
      <MinesTab mines={mines} overrides={[]} onChange={vi.fn()} addedMines={existing} onAddedMinesChange={onAddedMinesChange} onDeleteMine={vi.fn()} />,
    );

    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Chicago");
    await userEvent.type(screen.getByTestId("create-entity-state"), "IL");
    fireEvent.blur(screen.getByTestId("create-entity-state"));
    await userEvent.clear(screen.getByTestId("create-entity-display-code"));
    await userEvent.type(screen.getByTestId("create-entity-display-code"), "DUPE");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedMinesChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toBeInTheDocument();
  });

  it("renders an added mine row with a delete button, and clicking it calls onDeleteMine with its id", async () => {
    const onDeleteMine = vi.fn();
    const added = [{ id: "MNEW", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 5000000 }];
    render(
      <MinesTab mines={mines} overrides={[]} onChange={vi.fn()} addedMines={added} onAddedMinesChange={vi.fn()} onDeleteMine={onDeleteMine} />,
    );

    expect(screen.getByTestId("row-added-mine-MNEW")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-delete-added-mine-MNEW"));
    expect(onDeleteMine).toHaveBeenCalledWith("MNEW");
  });

  it("base-dataset mine rows have NO delete affordance", () => {
    render(
      <MinesTab mines={mines} overrides={[]} onChange={vi.fn()} addedMines={[]} onAddedMinesChange={vi.fn()} onDeleteMine={vi.fn()} />,
    );
    expect(screen.queryAllByTestId(/^button-delete-added-mine-/).length).toBe(0);
  });

  it("shows a precheck warning chip on an added mine with incomplete lane-cost coverage", () => {
    const added = [{ id: "MNEW", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 5000000 }];
    render(
      <MinesTab
        mines={mines}
        overrides={[]}
        onChange={vi.fn()}
        addedMines={added}
        onAddedMinesChange={vi.fn()}
        onDeleteMine={vi.fn()}
        precheckErrors={[{ code: "completeness", message: "MNEW missing lane costs to 2 stations: ST1, ST2" }]}
      />,
    );
    expect(screen.getByTestId("warning-precheck-added-mine-MNEW")).toHaveTextContent("2");
  });

  it("renders the Added mines table with separate City/State/Lat/Lng cells (no Zip column)", () => {
    const added = [{ id: "MNEW", city: "Bristol", state: "VA", lat: 36.6, lng: -82.19, capacity: 5000000 }];
    render(
      <MinesTab mines={mines} overrides={[]} onChange={vi.fn()} addedMines={added} onAddedMinesChange={vi.fn()} onDeleteMine={vi.fn()} />,
    );
    const row = screen.getByTestId("row-added-mine-MNEW");
    expect(row).toHaveTextContent("Bristol");
    expect(row).toHaveTextContent("VA");
    expect(row).toHaveTextContent("36.6000");
    expect(row).toHaveTextContent("-82.1900");
    expect(screen.queryByText("Zip")).not.toBeInTheDocument();
  });
});

// CLEANUP (Workspace fixups 2, item 1) — the Added Entities tab (and its
// the per-model add/base render flags are permanently gone; this tab always
// renders its base table + toolbar TOGETHER WITH its inline "+ Add …"
// add-section in the same tab (the permanent post-revert shape, spec §1).
describe("MinesTab — base table + inline add-section always render together (item 1)", () => {
  const addedMinesProps = {
    addedMines: [],
    onAddedMinesChange: vi.fn(),
    onDeleteMine: vi.fn(),
  };

  it("renders the base table + toolbar AND the inline added section together, with no flag", () => {
    render(
      <MinesTab
        mines={mines}
        overrides={[]}
        onChange={vi.fn()}
        scenarioId={7}
        {...addedMinesProps}
      />,
    );
    expect(screen.getByTestId("mines-tab")).toBeInTheDocument();
    expect(screen.getByTestId("mines-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-mines")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-mines")).toBeInTheDocument();
    expect(screen.getByText("M1")).toBeInTheDocument();
    expect(screen.getByTestId("added-mines-section")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-mine-row")).toBeInTheDocument();
  });

  it("clicking '+ Add mine' opens the add-row form alongside the still-visible base table", async () => {
    render(
      <MinesTab
        mines={mines}
        overrides={[]}
        onChange={vi.fn()}
        {...addedMinesProps}
      />,
    );
    expect(screen.queryByTestId("create-entity-dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-mine-row"));
    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("mines-tab")).toBeInTheDocument();
    expect(screen.getByText("M1")).toBeInTheDocument();
  });
});
