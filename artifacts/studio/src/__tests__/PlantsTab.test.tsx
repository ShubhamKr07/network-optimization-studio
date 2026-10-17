import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
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
import { PlantsTab } from "@/components/workspace/tabs/PlantsTab";
import { chooseInputDownload, chooseUpload } from "@/__tests__/helpers/inputTable";

// T11 (Chapter 9 JADE) — a plant has neither status nor capacity of its
// own (spec §6): all of a plant's editable behavior lives in the
// Capability Matrix tab. This tab is read-only for base plants + an
// add/delete row UX for scenario-local added plants (geometry only).
const plants = [
  { id: "plant-1", name: "Plant One", city: "Daggar Hills", state: "QLD", lat: -25.0, lng: 143.0 },
  { id: "plant-2", name: "Plant Two", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68 },
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

describe("PlantsTab", () => {
  it("renders the base plants read-only, with id/city/state/lat/lng and NO status/capacity column", () => {
    render(<PlantsTab plants={plants} />);
    expect(screen.getByTestId("plants-tab")).toBeInTheDocument();
    expect(screen.getByText("Daggar Hills")).toBeInTheDocument();
    expect(screen.getByText("Cunnamulla")).toBeInTheDocument();
    expect(screen.getAllByText("QLD").length).toBeGreaterThan(0);
    expect(screen.queryByText("Capacity")).not.toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });

  it("shows an empty state when the dataset has no plants", () => {
    render(<PlantsTab plants={[]} />);
    expect(screen.getByTestId("plants-tab-empty")).toBeInTheDocument();
  });

  it("does not render an Added plants section when the added-entity capability isn't wired", () => {
    render(<PlantsTab plants={plants} />);
    expect(screen.queryByTestId("added-plants-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-add-plant-row")).not.toBeInTheDocument();
  });

  it("shows an empty message when there are no added plants yet", () => {
    render(
      <PlantsTab plants={plants} addedPlants={[]} onAddedPlantsChange={vi.fn()} onDeletePlant={vi.fn()} />,
    );
    expect(screen.getByTestId("added-plants-empty")).toBeInTheDocument();
  });

  it("filling the add-row form and confirming calls onAddedPlantsChange with a new geometry-only plant (ap- uid, no status/capacity)", async () => {
    const onAddedPlantsChange = vi.fn();
    render(
      <PlantsTab plants={plants} addedPlants={[]} onAddedPlantsChange={onAddedPlantsChange} onDeletePlant={vi.fn()} />,
    );

    await userEvent.click(screen.getByTestId("button-add-plant-row"));
    await userEvent.type(screen.getByTestId("create-entity-city"), "Denver");
    await userEvent.type(screen.getByTestId("create-entity-state"), "CO");
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedPlantsChange).toHaveBeenCalledTimes(1);
    const [added] = onAddedPlantsChange.mock.calls[0][0];
    expect(added).toMatchObject({ city: "Denver", state: "CO", lat: 39.74, lng: -104.99 });
    expect(added.id).toMatch(/^ap-/);
    expect(added).not.toHaveProperty("status");
    expect(added).not.toHaveProperty("capacity");
  });

  it("rejects an add-row missing city or state, without calling onAddedPlantsChange", async () => {
    const onAddedPlantsChange = vi.fn();
    render(
      <PlantsTab plants={plants} addedPlants={[]} onAddedPlantsChange={onAddedPlantsChange} onDeletePlant={vi.fn()} />,
    );
    await userEvent.click(screen.getByTestId("button-add-plant-row"));
    await userEvent.type(screen.getByTestId("create-entity-lat"), "39.74");
    await userEvent.type(screen.getByTestId("create-entity-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onAddedPlantsChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-entity-error")).toBeInTheDocument();
  });

  it("renders an added plant row with a delete button, and clicking it calls onDeletePlant with its id", async () => {
    const onDeletePlant = vi.fn();
    const added = [{ id: "ap-new-1", city: "Denver", state: "CO", lat: 39.74, lng: -104.99 }];
    render(
      <PlantsTab plants={plants} addedPlants={added} onAddedPlantsChange={vi.fn()} onDeletePlant={onDeletePlant} />,
    );
    expect(screen.getByTestId("row-added-plant-ap-new-1")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-delete-added-plant-ap-new-1"));
    expect(onDeletePlant).toHaveBeenCalledWith("ap-new-1");
  });

  it("base plant rows have no delete affordance", () => {
    render(
      <PlantsTab plants={plants} addedPlants={[]} onAddedPlantsChange={vi.fn()} onDeletePlant={vi.fn()} />,
    );
    expect(screen.queryAllByTestId(/^button-delete-added-plant-/).length).toBe(0);
  });
});

describe("PlantsTab — Upload/Download", () => {
  it("Upload/Download are disabled until a scenario is resolved", () => {
    rtlRender(
      <ExportProviderTestWrapper value={{ scenarioId: null }}>
        <PlantsTab plants={plants} />
      </ExportProviderTestWrapper>,
    );
    // SCU-2.P4 (B2.3/B2.4) — one Download ▾ trigger now carries the disabled state.
    expect(screen.getByTestId("button-download-plants")).toBeDisabled();
    expect(screen.getByTestId("button-import-plants")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=plants&format=csv", async () => {
    fetchMock.mockResolvedValue(new Response("id,city\nplant-1,Daggar Hills", { status: 200, headers: { "content-type": "text/csv" } }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    rtlRender(
      <QueryClientProvider client={queryClient}>
        <ExportProviderTestWrapper value={{ scenarioId: 7 }}>
          <PlantsTab plants={plants} scenarioId={7} />
        </ExportProviderTestWrapper>
      </QueryClientProvider>,
    );

    chooseInputDownload("plants", "csv");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/scenarios/7/export");
    expect(String(url)).toContain("entity=plants");
    expect(String(url)).toContain("format=csv");
  });

  it("Upload button opens ImportDialog scoped to entity=plants", async () => {
    renderWithQueryClient(<PlantsTab plants={plants} scenarioId={7} />);
    expect(screen.queryByText("Import plants")).not.toBeInTheDocument();
    chooseUpload("plants", "csv");
    expect(screen.getByText("Import plants")).toBeInTheDocument();
    expect(screen.getByTestId("input-import-file-plants")).toBeInTheDocument();
  });

  it("a successful import apply calls onImportApplied with the updated scenario", async () => {
    const updatedScenario = { id: 7, name: "S", modelId: "two-echelon-jade-us", inputs: {}, result: null, createdAt: "x", updatedAt: "x" };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/import")) return jsonResponse({ errors: [], changes: [{ id: "plant-1", line: 2, before: {}, after: {} }], warnings: [] });
      if (url.endsWith("/import/apply")) return jsonResponse({ applied: 1, errors: [], scenario: updatedScenario });
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    const onImportApplied = vi.fn();
    renderWithQueryClient(<PlantsTab plants={plants} scenarioId={7} onImportApplied={onImportApplied} />);

    chooseUpload("plants", "csv");
    const file = new File(["id,city\nplant-1,Daggar Hills"], "plants.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByTestId("input-import-file-plants"), file);
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onImportApplied).toHaveBeenCalledWith(updatedScenario));
  });
});

// CLEANUP (Workspace fixups 2, item 1) — the Added Entities tab (and its
// the per-model add/base render flags are permanently gone; this tab always
// renders its base table + toolbar TOGETHER WITH its inline "+ Add …"
// add-section in the same tab (the permanent post-revert shape, spec §1).
describe("PlantsTab — base table + inline add-section always render together (item 1)", () => {
  const addedPlantsProps = {
    addedPlants: [],
    onAddedPlantsChange: vi.fn(),
    onDeletePlant: vi.fn(),
  };

  it("renders the base table + toolbar AND the inline added section together, with no flag", () => {
    render(
      <PlantsTab
        plants={plants}
        scenarioId={7}
        {...addedPlantsProps}
      />,
    );
    expect(screen.getByTestId("plants-tab")).toBeInTheDocument();
    expect(screen.getByTestId("plants-tab-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("button-download-plants")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-plants")).toBeInTheDocument();
    expect(screen.getByText("Daggar Hills")).toBeInTheDocument();
    expect(screen.getByTestId("added-plants-section")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-plant-row")).toBeInTheDocument();
  });

  it("clicking '+ Add plant' opens the add-row form alongside the still-visible base table", async () => {
    render(
      <PlantsTab
        plants={plants}
        {...addedPlantsProps}
      />,
    );
    expect(screen.queryByTestId("create-entity-dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-add-plant-row"));
    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("plants-tab")).toBeInTheDocument();
    expect(screen.getByText("Daggar Hills")).toBeInTheDocument();
  });
});

// B7 (JADE Ch.9 Workspace Bundle, spec §10) — base plants and "Added plants"
// stay TWO SEPARATE physical tables, each with its OWN FilterMenu, shown at
// runtime only when ITS OWN unfiltered row count exceeds 10 — independent of
// the other table's count.
describe("PlantsTab — FilterMenu, two independent tables (B7)", () => {
  const fourPlants = [
    { id: "plant-1", name: "Plant One", city: "Daggar Hills", state: "QLD", lat: -25.0, lng: 143.0 },
    { id: "plant-2", name: "Plant Two", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68 },
    { id: "plant-3", name: "Plant Three", city: "Brisbane", state: "QLD", lat: -27.47, lng: 153.03 },
    { id: "plant-4", name: "Plant Four", city: "Toowoomba", state: "QLD", lat: -27.56, lng: 151.95 },
  ];
  const manyAddedPlants = Array.from({ length: 11 }, (_, i) => ({
    id: `ap-${i + 1}`,
    city: `AddedCity${i + 1}`,
    state: "CO",
    lat: 39 + i,
    lng: -105 - i,
  }));

  it("base plants table (4 rows) hides its FilterMenu", () => {
    render(<PlantsTab plants={fourPlants} addedPlants={[]} onAddedPlantsChange={vi.fn()} onDeletePlant={vi.fn()} />);
    const toolbar = screen.getByTestId("plants-tab-toolbar");
    expect(within(toolbar).queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
  });

  // SCU-2.P4.12 (spec B2.2, user decision 2026-10-17) — base and added plants
  // now share ONE FilterMenu in the toolbar (there used to be two). It shows
  // once base + added rows exceed 10, and filters both sections.
  it("4 base + 11 added plants: ONE FilterMenu, in the toolbar (none in the added section)", () => {
    render(
      <PlantsTab
        plants={fourPlants}
        addedPlants={manyAddedPlants}
        onAddedPlantsChange={vi.fn()}
        onDeletePlant={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("button-filter-menu-trigger")).toHaveLength(1);
    expect(within(screen.getByTestId("plants-tab-toolbar")).getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
    expect(within(screen.getByTestId("added-plants-section")).queryByTestId("button-filter-menu-trigger")).not.toBeInTheDocument();
  });

  it("the shared filter narrows base AND added rows together", async () => {
    render(
      <PlantsTab
        plants={fourPlants}
        addedPlants={manyAddedPlants}
        onAddedPlantsChange={vi.fn()}
        onDeletePlant={vi.fn()}
      />,
    );
    const addedSection = screen.getByTestId("added-plants-section");
    expect(within(addedSection).getAllByTestId(/^row-added-plant-/).length).toBe(11);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("button-filter-menu-trigger"));
    await user.type(screen.getByTestId("input-filter-city"), "AddedCity1");

    // "AddedCity1" matches AddedCity1 and AddedCity10/11 (substring) — 3 rows.
    expect(within(screen.getByTestId("added-plants-section")).getAllByTestId(/^row-added-plant-/).length).toBe(3);
    // ...and the base plants (no match) are filtered out too — one menu, both sections.
    expect(screen.queryByText("Daggar Hills")).not.toBeInTheDocument();
  });

  // T8 (Workspace fixups 2, item 3) — PlantsTab already mounts the base
  // table's FilterMenu inside its own toolbar row (`ml-auto` sibling of the
  // Download/Upload buttons); this locks that placement in as a regression
  // guard once the base table has >10 rows.
  it("base plants table with >10 rows: the FilterMenu trigger is inside the SAME toolbar row as the Import/Export buttons", () => {
    const manyPlants = Array.from({ length: 12 }, (_, i) => ({
      id: `plant-${i + 1}`,
      name: `Plant ${i + 1}`,
      city: `City${i + 1}`,
      state: "QLD",
      lat: -25 - i,
      lng: 143 + i,
    }));
    render(<PlantsTab plants={manyPlants} />);
    const toolbar = screen.getByTestId("plants-tab-toolbar");
    expect(within(toolbar).getByTestId("button-download-plants")).toBeInTheDocument();
    expect(within(toolbar).getByTestId("button-import-plants")).toBeInTheDocument();
    expect(within(toolbar).getByTestId("button-filter-menu-trigger")).toBeInTheDocument();
  });
});
