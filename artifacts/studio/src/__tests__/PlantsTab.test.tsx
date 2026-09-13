import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlantsTab } from "@/components/workspace/tabs/PlantsTab";

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
    await userEvent.type(screen.getByTestId("input-new-plant-city"), "Denver");
    await userEvent.type(screen.getByTestId("input-new-plant-state"), "CO");
    await userEvent.type(screen.getByTestId("input-new-plant-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-plant-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("button-add-plant-confirm"));

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
    await userEvent.type(screen.getByTestId("input-new-plant-lat"), "39.74");
    await userEvent.type(screen.getByTestId("input-new-plant-lng"), "-104.99");
    await userEvent.click(screen.getByTestId("button-add-plant-confirm"));

    expect(onAddedPlantsChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-add-plant-error")).toBeInTheDocument();
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
    render(<PlantsTab plants={plants} />);
    expect(screen.getByTestId("button-export-plants-csv")).toBeDisabled();
    expect(screen.getByTestId("button-export-plants-json")).toBeDisabled();
    expect(screen.getByTestId("button-import-plants")).toBeDisabled();
  });

  it("Download CSV triggers the export fetch scoped to entity=plants&format=csv", async () => {
    fetchMock.mockResolvedValue(new Response("id,city\nplant-1,Daggar Hills", { status: 200, headers: { "content-type": "text/csv" } }));
    renderWithQueryClient(<PlantsTab plants={plants} scenarioId={7} />);

    await userEvent.click(screen.getByTestId("button-export-plants-csv"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/scenarios/7/export");
    expect(String(url)).toContain("entity=plants");
    expect(String(url)).toContain("format=csv");
  });

  it("Upload button opens ImportDialog scoped to entity=plants", async () => {
    renderWithQueryClient(<PlantsTab plants={plants} scenarioId={7} />);
    expect(screen.queryByText("Import plants")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-import-plants"));
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

    await userEvent.click(screen.getByTestId("button-import-plants"));
    const file = new File(["id,city\nplant-1,Daggar Hills"], "plants.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByTestId("input-import-file-plants"), file);
    await waitFor(() => expect(screen.getByTestId("button-import-confirm")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("button-import-confirm"));

    await waitFor(() => expect(onImportApplied).toHaveBeenCalledWith(updatedScenario));
  });
});

describe("PlantsTab — Input Map prefill (Phase 3.2, Task 4 pattern)", () => {
  it("opens the add-row form and prefills Lat/Lng when prefillCoords is set", () => {
    const onPrefillConsumed = vi.fn();
    render(
      <PlantsTab
        plants={[]}
        addedPlants={[]}
        onAddedPlantsChange={vi.fn()}
        onDeletePlant={vi.fn()}
        prefillCoords={{ lat: 40.1234, lng: -75.5678 }}
        onPrefillConsumed={onPrefillConsumed}
      />,
    );
    expect(screen.getByTestId("input-new-plant-lat")).toHaveValue(40.1234);
    expect(screen.getByTestId("input-new-plant-lng")).toHaveValue(-75.5678);
    expect(onPrefillConsumed).toHaveBeenCalledTimes(1);
  });

  it("does not open the add-row form or call onPrefillConsumed when prefillCoords is null", () => {
    const onPrefillConsumed = vi.fn();
    render(
      <PlantsTab
        plants={plants}
        addedPlants={[]}
        onAddedPlantsChange={vi.fn()}
        onDeletePlant={vi.fn()}
        prefillCoords={null}
        onPrefillConsumed={onPrefillConsumed}
      />,
    );
    expect(screen.queryByTestId("add-plant-row-form")).not.toBeInTheDocument();
    expect(onPrefillConsumed).not.toHaveBeenCalled();
  });
});
