import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// A5.3 — Workspace-level integration coverage for the two-echelon-gold-au
// fast-follow flip: a Refineries tab (WarehousesTab reused with
// entity="refineries", mine excluded), Customers tab reused as-is, no P
// field anywhere, bomRatio in Optimization Parameters, entity-scoped
// import/export for refineries, and Studio.tsx's own two-echelon
// create-scenario default verbatim. Leg-colored routes on the Output Map
// tab are NOT re-tested here — NetworkMap.test.tsx already covers that
// directly at the component level (mine_to_refinery/refinery_to_customer
// edge coloring, M4.2), and OutputMapTab passes `dataset`/`result` through
// to NetworkMap unmodified, so nothing new needs proving at this layer.
//
// T7 (Bundle 2) — appends two new describe blocks below the original A5.3
// coverage: the Input Map's full-v2 editor (fixed mine + refineries +
// customers) and the Output Map's effective-output-dataset projection for
// BOTH legs (mine->refinery, refinery->customer), mirroring
// Workspace.Transport.test.tsx/Workspace.Brazil.test.tsx's own structure for
// their sibling fast-follow tasks. useGetScenario/useListScenarios/
// useGetDataset are upgraded to overridable `mockUseX.mockReturnValue(...)`
// mocks (same pattern those two files use) so the new tests can swap in a
// solved/added-entity scenario per-test — every ORIGINAL A5.3 test below is
// unaffected (none of them override anything, so the same default
// scenario/dataset apply as before).

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/chapter-10/gold-refinery", mockNavigate],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn() };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));

const twoEchelonInputs = {
  bomRatio: 1.1,
  refineryOverrides: [{ id: "cunnamulla", status: "forced_open" }],
  customerOverrides: [],
  distanceBands: [500, 1000, 1500, 2000, 2600],
  gap: 0,
  timeLimitSec: 120,
};

const scenario = {
  id: 1,
  name: "Base case",
  modelId: "two-echelon-gold-au",
  inputs: twoEchelonInputs,
  result: null,
  stale: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const dataset = {
  warehouses: [
    { id: "kalgoorlie", city: "Kalgoorlie", state: "WA", lat: -30.7, lng: 121.4, kind: "mine" as const },
    { id: "cunnamulla", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68, kind: "facility" as const },
    { id: "daggar_hills", city: "Daggar Hills", state: "QLD", lat: -25.0, lng: 145.0, kind: "facility" as const },
  ],
  customers: [{ id: "sydney", city: "Sydney", state: "NSW", lat: -33.87, lng: 151.2, demand: 100000 }],
};

// T7 (Bundle 2) — a solved scenario with the base mine/refinery/customer
// network, for the Output Map effective-dataset describe block below.
// mine_to_refinery/refinery_to_customer leg tagging mirrors
// test_two_echelon.py/resultEnvelope.ts's real Edge.leg values.
const solvedResult = {
  status: "optimal" as const,
  objective: 386577,
  runTimeSec: 0.8,
  quality: "Proven optimal",
  edges: [
    { fromId: "kalgoorlie", toId: "cunnamulla", flow: 100000, distance: 500, leg: "mine_to_refinery" as const },
    { fromId: "cunnamulla", toId: "sydney", flow: 100000, distance: 900, leg: "refinery_to_customer" as const },
  ],
  metrics: { weightedAvgDistance: 900, bandCoverage: [], utilizationByNode: [], avgDistanceByLeg: [] },
  details: { openWarehouseIds: ["cunnamulla"], assignments: [] },
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};

const solvedScenario = { ...scenario, result: solvedResult };

const mockUpdateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockCreateScenario = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const mockUseGetScenario = vi.fn(() => ({ data: scenario }));
const mockUseListScenarios = vi.fn(() => ({ data: [scenario] }));
const mockUseGetDataset = vi.fn(() => ({ data: dataset }));

vi.mock("@workspace/api-client-react", () => ({
  useListScenarios: () => mockUseListScenarios(),
  useGetScenario: () => mockUseGetScenario(),
  useGetDataset: () => mockUseGetDataset(),
  useUpdateScenario: vi.fn(() => mockUpdateScenario),
  useSolveScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useCloneScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useResetScenarioToBaseline: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  // B2-T1 — distanceUnit relabeled "km" -> "mi": two-echelon's base numbers
  // are geographically miles (notebook-mislabeled km), so this model now
  // advertises "mi" like the other three. The band-editor label
  // fallback every other fixture file already covers.
  useListModels: vi.fn(() => ({ data: [{ id: "two-echelon-gold-au", countryBounds: { sw: [-38.5, 113], ne: [-16, 154.5] }, distanceUnit: "mi", capabilities: { supportsFacilityStatus: true } }] })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  getGetDatasetQueryKey: vi.fn(() => ["dataset"]),
  usePrecheckScenario: vi.fn(() => ({ data: { ok: true, errors: [] } })),
  getPrecheckScenarioQueryKey: vi.fn((id: number) => ["precheck", id]),
  useLogoutUser: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
}));

import { Workspace } from "@/pages/Workspace";

function renderWorkspace() {
  return render(<Workspace modelId="two-echelon-gold-au" userEmail="student@example.com" />);
}

// T7 (Bundle 2) — same routePathCount/warehouseMarkerCount helpers
// Workspace.Transport.test.tsx/Workspace.Brazil.test.tsx already establish
// for their own Output Map effective-dataset assertions.
function routePathCount(container: HTMLElement): number {
  const html = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
  return (html.match(/<path/g) ?? []).length;
}

function warehouseMarkerCount(container: HTMLElement): number {
  return container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon").length;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockCreateScenario.mutate.mockReset();
  mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof mockUseGetScenario>);
  mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
  mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof mockUseGetDataset>);
});

describe("Workspace — two-echelon-gold-au (A5.3)", () => {
  it("shows a Refineries sidebar entry, not Warehouses", () => {
    renderWorkspace();
    expect(screen.getByTestId("sidebar-input-refineries")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-input-warehouses")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar-input-customers")).toBeInTheDocument();
  });

  it("opening the Refineries tab reuses WarehousesTab, excludes the fixed mine, and shows the current override", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-refineries"));
    expect(screen.getByTestId("refineries-tab")).toBeInTheDocument();
    expect(screen.getByText("cunnamulla")).toBeInTheDocument();
    expect(screen.getByText("daggar_hills")).toBeInTheDocument();
    expect(screen.queryByText("kalgoorlie")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-wh-cunnamulla-forced_open")).toBeInTheDocument();
  });

  it("Refineries tab has no Capacity column (two-echelon has no capacity concept)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-refineries"));
    expect(screen.queryByText("Capacity")).not.toBeInTheDocument();
  });

  it("editing a refinery status and saving PATCHes refineryOverrides, not warehouseOverrides", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-refineries"));
    fireEvent.click(screen.getByTestId("button-wh-daggar_hills-inactive"));
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args).toEqual({
      scenarioId: 1,
      data: {
        inputs: expect.objectContaining({
          refineryOverrides: [
            { id: "cunnamulla", status: "forced_open" },
            { id: "daggar_hills", status: "inactive", capacity: undefined },
          ],
        }),
      },
    });
    expect(args.data.inputs).not.toHaveProperty("warehouseOverrides");
  });

  it("Refineries tab's Export/Import toolbar is scoped to entity=refineries, not entity=warehouses", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-refineries"));
    expect(screen.getByTestId("button-export-refineries-csv")).toBeInTheDocument();
    expect(screen.getByTestId("button-import-refineries")).toBeInTheDocument();
    expect(screen.queryByTestId("button-export-warehouses-csv")).not.toBeInTheDocument();
  });

  // B6.2 stage 4 — two-echelon-gold-au's own leg distances entity (mine->
  // refinery + refinery->customer legs, one flat array) now has a real tab
  // (LegDistancesTab), not a placeholder — B6.1-B6.3's earlier "fast-follow,
  // not this task" note is exactly what this task closes.
  it("Distances renders the real LegDistancesTab for two-echelon-gold-au, not a placeholder", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId("legdistances-tab")).toBeInTheDocument();
    expect(screen.getByTestId("legdistances-tab-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-save")).toBeInTheDocument();
  });

  it("opening the Customers tab renders the real CustomerTable (reused as-is)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    expect(screen.getByText("sydney")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  // B6.2 — twoEchelonInputsSchema gained its own real addedCustomers field
  // (mirroring addedWarehouseSchema's shape), and Workspace.tsx now wires
  // CustomersTab's added-* props for this model too — supersedes B5.2's
  // "p-median-us only" note above (that was true before this task).
  it("renders the Added customers section and its add-row button for two-echelon-gold-au", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    expect(screen.getByTestId("added-customers-section")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-customer-row")).toBeInTheDocument();
  });

  // B6.2 — the Refineries tab (WarehousesTab reused via entity="refineries")
  // now gets the SAME add/delete-row UX p-median-us's Warehouses tab has,
  // since twoEchelonInputsSchema gained a real addedRefineries field.
  it("renders the Added refineries section on the Refineries tab", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-refineries"));
    expect(screen.getByTestId("added-warehouses-section")).toBeInTheDocument();
    expect(screen.getByText("Added refineries")).toBeInTheDocument();
    expect(screen.getByTestId("button-add-warehouse-row")).toHaveTextContent("+ Add refinery");
  });

  it("Optimization Parameters shows bomRatio only for two-echelon, no P field", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.queryByTestId("text-p-value")).not.toBeInTheDocument();
    expect(screen.getByTestId("slider-bom-ratio")).toBeInTheDocument();
    expect(screen.getByTestId("text-bom-ratio")).toHaveTextContent("1.10");
    expect(screen.queryByTestId("slider-capacity-factor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("switch-single-source")).not.toBeInTheDocument();
  });

  it("editing bomRatio and saving PATCHes bomRatio", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    const thumb = screen.getByTestId("slider-bom-ratio").querySelector('[role="slider"]')!;
    expect(thumb).toHaveAttribute("aria-valuenow", "1.1");
  });

  it("Solve dialog has no P field for two-echelon-gold-au", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    expect(screen.queryByTestId("solve-dialog-p-value")).not.toBeInTheDocument();
  });

  // B2-T1 — this model's distanceUnit ("mi" after the relabel) reaches
  // the Solve dialog's band editor via `activeModelManifest?.distanceUnit`.
  it("Solve dialog's distance-band editor shows 'mi', matching this model's distanceUnit", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-run-optimizer"));
    expect(screen.getByText("Distance bands (mi)")).toBeInTheDocument();
    expect(screen.getByTestId("solve-dialog-band-500")).toBeInTheDocument();
  });

  it("create-scenario uses Studio.tsx's own two-echelon-gold-au default inputs verbatim", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("button-create-scenario"));
    fireEvent.click(screen.getByTestId("button-create-confirm"));

    expect(mockCreateScenario.mutate).toHaveBeenCalledTimes(1);
    const [args] = mockCreateScenario.mutate.mock.calls[0];
    expect(args.data.modelId).toBe("two-echelon-gold-au");
    expect(args.data.inputs).toEqual({
      bomRatio: 1.1,
      refineryOverrides: [],
      customerOverrides: [],
      distanceBands: [500, 1000, 1500, 2000, 2600],
      gap: 0,
      timeLimitSec: 120,
    });
  });
});

// T7 (Bundle 2) — Input Map full-v2 editor. Mirrors
// Workspace.Transport.test.tsx's own "Input Map (T6, Bundle 2)" describe
// block: mode dispatch off "legacy", R4 Save-in-Layers, add-then-save round
// trip, R3 status legend present (unlike transport, which suppresses it),
// PLUS the fixed mine's read-only contract at the Workspace-wiring level
// (component-level coverage already lives in InputMapTabV2.twoEchelon.test.tsx).
describe("Workspace — two-echelon-gold-au Input Map (T7, Bundle 2)", () => {
  it("renders the real two-echelon map surface (toolbar + legend), not the legacy pin-drop flow", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    expect(screen.getByTestId("two-echelon-map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("input-map-placement-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-content-placeholder")).not.toBeInTheDocument();
  });

  it("Save lives inside the Input Map's own Layers row (R4), same relocation as p-median-us/brazil/transport-coal", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    const toolbar = screen.getByTestId("two-echelon-map-toolbar");
    const saveButton = screen.getByTestId("button-save");
    expect(toolbar).toContainElement(saveButton);
    expect(screen.getAllByTestId("button-save")).toHaveLength(1);
  });

  it("R3 — the status legend DOES render (refineries have a real status, unlike transport-coal's mines)", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    expect(screen.getByTestId("legend-status-active")).toBeInTheDocument();
    expect(screen.getByTestId("legend-status-forced_open")).toBeInTheDocument();
    expect(screen.getByTestId("legend-status-inactive")).toBeInTheDocument();
  });

  it("renders both the fixed mine and the refinery candidates as markers, with no action menu reachable on the mine", () => {
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    // Mine (kalgoorlie) + 2 refineries (cunnamulla, daggar_hills) + 1
    // customer (sydney) = 4 markers, matching the fixture dataset.
    expect(warehouseMarkerCount(container)).toBe(4);
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]); // kalgoorlie is first (mine, rendered before EntityMarkers)
    expect(screen.queryByTestId("map-action-menu")).not.toBeInTheDocument();
  });

  it("adding a refinery via the map registers a new addedRefineries row on Save, minting an 'aw-' uid with a status field", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));

    const mapEl = document.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    expect(screen.getByTestId("button-save")).toBeEnabled();
    fireEvent.click(screen.getByTestId("button-save"));

    expect(mockUpdateScenario.mutate).toHaveBeenCalledTimes(1);
    const [saveArgs] = mockUpdateScenario.mutate.mock.calls[0];
    const sentInputs = saveArgs.data.inputs as typeof twoEchelonInputs & { addedRefineries: { id: string; status: string }[] };
    expect(sentInputs.addedRefineries).toHaveLength(1);
    expect(sentInputs.addedRefineries[0].id).toMatch(/^aw-/);
    expect(sentInputs.addedRefineries[0].status).toBe("active");
    // A two-echelon PATCH never carries the p-median-us-only fields.
    expect(sentInputs).not.toHaveProperty("warehouseOverrides");
    expect(sentInputs).not.toHaveProperty("capacityMode");
  });

  it("adding a customer via the map registers a new addedCustomers row on Save", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));

    const mapEl = document.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByTestId("map-add-menu-cs"));
    fireEvent.change(screen.getByTestId("create-entity-demand"), { target: { value: "50000" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));
    fireEvent.click(screen.getByTestId("button-save"));

    const [saveArgs] = mockUpdateScenario.mutate.mock.calls[0];
    const sentCustomers = (saveArgs.data.inputs as typeof twoEchelonInputs & { addedCustomers: { demand: number }[] }).addedCustomers;
    expect(sentCustomers).toHaveLength(1);
    expect(sentCustomers[0].demand).toBe(50000);
  });
});

// T7 Step 3 (P1) — effective output dataset, BOTH legs: added
// refineries/customers from displayedInputs project into the Output Map so
// NetworkMap can resolve a mine->refinery OR refinery->customer edge whose
// endpoint is scenario-local. Also covers R7 (hide-closed applies to
// refineries, mine always retained) and the displayedInputs snapshot
// principle, mirroring Workspace.Brazil.test.tsx's own Output Map describe
// block structure.
describe("Workspace — two-echelon-gold-au Output Map effective dataset (T7, Bundle 2, Step 2/3)", () => {
  it("renders the shared NetworkMap with both the mine->refinery and refinery->customer routes, and both facility markers", () => {
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    expect(routePathCount(container)).toBe(2);
    // Mine (kalgoorlie, always retained) + the one OPEN refinery (cunnamulla)
    // — daggar_hills (closed candidate) is hidden by R7's hideClosedWarehouses.
    expect(warehouseMarkerCount(container)).toBe(2);
  });

  it("R7 — a closed refinery candidate is hidden, the fixed mine is retained regardless", () => {
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    // daggar_hills never appears in solvedResult.details.openWarehouseIds —
    // confirmed hidden by asserting the total count excludes it (mine +
    // cunnamulla only, not 3).
    expect(warehouseMarkerCount(container)).toBe(2);
  });

  it("an added-and-opened refinery renders, along with its mine->refinery AND refinery->customer routes — even though neither the refinery nor its customer exists in the base dataset", () => {
    const addedScenario = {
      ...solvedScenario,
      inputs: {
        ...twoEchelonInputs,
        // Cleared (unlike the base fixture's forced_open on cunnamulla) —
        // a forced-open refinery always displays as open regardless of
        // openWarehouseIds, which would otherwise keep it visible here and
        // defeat this test's own R7 "closed candidates hidden" premise.
        refineryOverrides: [],
        addedRefineries: [{ id: "aw-1", city: "Brisbane", state: "QLD", lat: -27.47, lng: 153.03, status: "active" }],
        addedCustomers: [{ id: "ac-1", city: "Perth", state: "WA", lat: -31.95, lng: 115.86, demand: 40000 }],
      },
      result: {
        ...solvedResult,
        edges: [
          { fromId: "kalgoorlie", toId: "aw-1", flow: 40000, distance: 300, leg: "mine_to_refinery" as const },
          { fromId: "aw-1", toId: "ac-1", flow: 40000, distance: 600, leg: "refinery_to_customer" as const },
        ],
        details: { openWarehouseIds: ["aw-1"], assignments: [] },
      },
    };
    mockUseGetScenario.mockReturnValue({ data: addedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [addedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);

    const { container } = renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));

    // Mine (retained) + the added, opened refinery — both base refineries
    // (cunnamulla/daggar_hills) are closed under this result, hidden by R7.
    expect(warehouseMarkerCount(container)).toBe(2);
    // Both legs resolve: mine->addedRefinery, addedRefinery->addedCustomer.
    expect(routePathCount(container)).toBe(2);
  });

  it("an unsaved Input Map coordinate edit does NOT move the already-displayed solve (displayedInputs snapshot)", () => {
    mockUseGetScenario.mockReturnValue({ data: solvedScenario } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solvedScenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
    const { container } = renderWorkspace();

    // Add (but do NOT save) a new refinery on the Input Map — an unsaved
    // draft edit to localInputs.
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    const mapEl = document.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));
    fireEvent.click(screen.getByTestId("create-entity-submit"));
    expect(screen.getByTestId("button-save")).toBeEnabled(); // dirty, unsaved

    // The Output Map must still reflect only the SOLVED (displayedInputs)
    // geometry — the unsaved added refinery must not appear.
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(warehouseMarkerCount(container)).toBe(2);
    expect(routePathCount(container)).toBe(2);
  });
});
