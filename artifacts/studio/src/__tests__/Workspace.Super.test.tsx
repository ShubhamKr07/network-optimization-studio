import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { UnitProvider } from "@/contexts/UnitContext";

// chen-bands-units, Part D — components rendered inside this tree now read the
// display-unit preference via useDisplayUnit(), which throws without a
// provider. main.tsx already wraps the real app (T10); these tests render the
// component directly, so they need the same ancestor. RTL's `wrapper` option is
// used rather than a wrapping element so `rerender` keeps the provider too.
const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(ui, { wrapper: UnitProvider, ...options });


// jade-T15.5 — Workspace-level integration coverage for the Chapter 9 JADE
// (two-echelon-jade-us) fast-follow flip: the tab registry (Plants,
// Capability Matrix, alongside the reused Warehouses/Customers/Distances/
// Optimization Parameters components), the effective-row projection built
// for the Input Map + Capability Matrix (Gate 6.5 — base ⊕ overrides ∪
// added), and Save reconciliation (the server's normalizeAddedEntityDistances-
// augmented `inputs` must be adopted so a newly-estimated distance row
// persists and the scenario isn't immediately re-flagged dirty). Mirrors
// Workspace.TwoEchelon.test.tsx's own structure for its sibling fast-follow
// task. Full tab-mount/gating coverage (every Inputs/Outputs entry opens
// real content, not a placeholder) lives in Workspace.TabCoverage.test.tsx's
// own two-echelon-jade-us describe block — not duplicated here.

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("wouter", () => ({
  useSearch: vi.fn(() => "?scenario=1"),
  useLocation: () => ["/super-model", mockNavigate],
}));

const mockQueryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn(), fetchQuery: vi.fn(() => Promise.resolve({ ok: true, errors: [] })) };
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => mockQueryClient),
}));


import fs from "node:fs";
import path from "node:path";
const sample = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/samples/super-model-sample.json"), "utf8"));
const scenario = {
  id: 1, name: "Super base", modelId: "super-model", inputs: sample, result: null, stale: false,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};
const dataset = { warehouses: [], customers: [], plants: [], products: [] };

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
  // chen-bands-units, T14 - field-scoped distanceBands PATCH. Minimal mock;
  // only Workspace.test.tsx asserts on its call args (Save-bands routing).
  useUpdateDistanceBands: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useSolveScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useCreateScenario: vi.fn(() => mockCreateScenario),
  useCloneScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteScenario: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useGetSolveJob: vi.fn(() => ({ data: undefined })),
  useGetReferenceDistances: vi.fn(() => ({ data: undefined })),
  getGetReferenceDistancesQueryKey: vi.fn((id: string) => ["reference-distances", id]),
  useListModels: vi.fn(() => ({
    data: [
      {
        id: "super-model",
        countryBounds: { sw: [25.78, -122.69], ne: [47.61, -71.05] },
        distanceUnit: "mi",
        capabilities: {
          supportsP: true,
          capacityModes: [],
          demandEditable: false,
          outputGrids: ["openWarehouses", "assignments", "flows", "costSummary"],
          supportsFacilityStatus: true,
        },
      },
    ],
  })),
  getGetScenarioQueryKey: vi.fn((id: number) => ["scenarios", id]),
  getListScenariosQueryKey: vi.fn(() => ["scenarios"]),
  getGetSolveJobQueryKey: vi.fn((scenarioId: number, jobId: number) => ["solve-jobs", scenarioId, jobId]),
  getGetDatasetQueryKey: vi.fn(() => ["dataset"]),
  useFetchScenarioRoadDistances: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false })),
  RoadDistancesErrorCode: { road_distances_unavailable: "road_distances_unavailable", road_distances_quota: "road_distances_quota",
    road_distances_failed: "road_distances_failed", road_distances_unroutable: "road_distances_unroutable", road_distances_busy: "road_distances_busy" },
  useImportScenarioNetwork: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false })),
  exportScenarioNetwork: vi.fn(),
  usePrecheckScenario: vi.fn(() => ({ data: { ok: true, errors: [] } })),
  getPrecheckScenarioQueryKey: vi.fn((id: number) => ["precheck", id]),
  useLogoutUser: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
}));

// SM-9 — spy on the props Workspace hands the Output Map (real component still renders).
const mapProps = vi.hoisted(() => ({ current: null as null | { warehouseStatuses: { warehouseId: string; status: string }[] } }));
vi.mock("@/components/workspace/tabs/OutputMapTab", async importOriginal => {
  const real = await importOriginal<typeof import("@/components/workspace/tabs/OutputMapTab")>();
  return { ...real, OutputMapTab: (p: React.ComponentProps<typeof real.OutputMapTab>) => { mapProps.current = p as never; return <real.OutputMapTab {...p} />; } };
});

import { Workspace } from "@/pages/Workspace";

function renderWorkspace() {
  return render(<Workspace modelId="super-model" userEmail="student@example.com" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateScenario.mutate.mockReset();
  mockUseGetScenario.mockReturnValue({ data: scenario } as unknown as ReturnType<typeof mockUseGetScenario>);
  mockUseListScenarios.mockReturnValue({ data: [scenario] } as unknown as ReturnType<typeof mockUseListScenarios>);
  mockUseGetDataset.mockReturnValue({ data: dataset } as unknown as ReturnType<typeof mockUseGetDataset>);
});

const rowCount = (table: string) => document.querySelectorAll(`[data-testid^="super-row-${table}-"]`).length;

describe("Workspace — super-model input tabs (SM-7)", () => {
  it("renders the ten sidebar input entries", () => {
    renderWorkspace();
    for (const id of ["input-map", "products", "plants", "warehouses", "customers", "plantProducts", "demand", "distances", "transportCosts", "optimization-parameters"]) {
      expect(screen.getByTestId(`sidebar-input-${id}`)).toBeInTheDocument();
    }
  });

  it("plantProducts tab shows the sample's 16 rows", () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-plantProducts"));
    expect(rowCount("plantProducts")).toBe(16);
  });

  it("deleting product-1 states the referencing count and cascades on confirm", () => {
    renderWorkspace();
    const refs = sample.plantProducts.filter((r: { productId: string }) => r.productId === "product-1").length
      + sample.demand.filter((r: { productId: string }) => r.productId === "product-1").length;
    fireEvent.click(screen.getByTestId("sidebar-input-products"));
    fireEvent.click(screen.getByTestId("super-products-product-1-delete"));
    expect(screen.getByTestId("super-delete-count")).toHaveTextContent(`This also deletes ${refs} referencing row(s).`);
    fireEvent.click(screen.getByTestId("super-delete-confirm-button"));
    expect(rowCount("products")).toBe(3);
    fireEvent.click(screen.getByTestId("sidebar-input-plantProducts"));
    expect(rowCount("plantProducts")).toBe(12);
    fireEvent.click(screen.getByTestId("sidebar-input-demand"));
    const demandRowIds = [...document.querySelectorAll('[data-testid^="super-row-demand-"]')].map(e => e.getAttribute("data-testid")!);
    expect(demandRowIds.filter(t => t.endsWith(',"product-1"]'))).toHaveLength(0);
  });

  it("SM2-2: deleting a customer on the map uses the cascade confirmation with its row count, and Save shows", () => {
    const { container } = renderWorkspace();
    const refs = sample.demand.filter((r: { customerId: string }) => r.customerId === "customer-1").length
      + sample.distanceOverrides.filter((r: { toId: string }) => r.toId === "customer-1").length;
    const cs = container.querySelectorAll('[data-testid="input-map-tab"] .leaflet-marker-icon.cs-marker');
    fireEvent.contextMenu(cs[0]);
    fireEvent.click(screen.getByTestId("map-action-delete"));   // one click: the D3 dialog is the only confirmation
    expect(screen.getByTestId("super-delete-count")).toHaveTextContent(`This also deletes ${refs} referencing row(s).`);
    fireEvent.click(screen.getByTestId("super-delete-confirm-button"));
    expect(screen.getByTestId("button-save")).not.toBeDisabled();
  });

  it("Optimization Parameters has no band editor, and Save sends no distanceBands", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.queryByTestId("distance-bands-editor")).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid*="band"]')).toBeNull();
    // make the draft dirty, then Save
    fireEvent.click(screen.getByTestId("sidebar-input-products"));
    fireEvent.change(screen.getByTestId("super-products-product-1-name"), { target: { value: "Renamed" } });
    await act(async () => { fireEvent.click(screen.getByTestId("button-save")); });
    expect(mockUpdateScenario.mutate).toHaveBeenCalled();
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args.data.inputs).not.toHaveProperty("distanceBands");
    expect(args.data.inputs.products[0].name).toBe("Renamed");
  });

  it("SM2-10: Save never sends roadDistances (server-written; at the caps it would exceed the body limit)", async () => {
    const withRoad = { ...scenario, inputs: { ...sample, distanceMethod: "road", roadDistances: { fetchedAt: "2026-10-23T00:00:00.000Z", profile: "driving-hgv", coords: {}, pairs: [] } } };
    mockUseGetScenario.mockReturnValue({ data: withRoad } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [withRoad] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-products"));
    fireEvent.change(screen.getByTestId("super-products-product-1-name"), { target: { value: "Renamed" } });
    await act(async () => { fireEvent.click(screen.getByTestId("button-save")); });
    const [args] = mockUpdateScenario.mutate.mock.calls[0];
    expect(args.data.inputs).not.toHaveProperty("roadDistances");
    expect(args.data.inputs.distanceMethod).toBe("road");
  });

  it("SM2-10: method road shows the fetch action; it is disabled while unsaved", () => {
    const road = { ...scenario, inputs: { ...sample, distanceMethod: "road" } };
    mockUseGetScenario.mockReturnValue({ data: road } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [road] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId("super-road-fetch")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("sidebar-input-products"));
    fireEvent.change(screen.getByTestId("super-products-product-1-name"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId("super-road-fetch")).toBeDisabled();
  });

  it("SM2-10: the fetch action is unavailable while browsing an older result (history view)", () => {
    const base = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/superResult.json"), "utf8"));
    const road = { ...scenario, inputs: { ...sample, distanceMethod: "road" }, result: { ...base } };
    mockUseGetScenario.mockReturnValue({ data: road } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [road] } as unknown as ReturnType<typeof mockUseListScenarios>);
    const { rerender } = renderWorkspace();
    const next = { ...road, result: { ...base } };   // new result reference: history appends
    mockUseGetScenario.mockReturnValue({ data: next } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [next] } as unknown as ReturnType<typeof mockUseListScenarios>);
    rerender(<Workspace modelId="super-model" userEmail="student@example.com" />);
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    expect(screen.getByTestId("super-road-fetch")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("button-result-back"));
    expect(screen.getByTestId("super-road-fetch")).toBeDisabled();
  });

  it("SM2-10: opening the fetch action shows the privacy notice", () => {
    const road = { ...scenario, inputs: { ...sample, distanceMethod: "road" } };
    mockUseGetScenario.mockReturnValue({ data: road } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [road] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-distances"));
    fireEvent.click(screen.getByTestId("super-road-fetch"));
    expect(screen.getByTestId("super-road-privacy")).toHaveTextContent("OpenRouteService");
  });

  it("SM-8: solved scenario opens the output map and a city-labelled open-warehouses grid built from inputs", () => {
    const solved = { ...scenario, result: JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/superResult.json"), "utf8")) };
    mockUseGetScenario.mockReturnValue({ data: solved } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solved] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    expect(screen.getByTestId("output-map-tab")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("sidebar-output-open-warehouses"));
    expect(screen.getByText(/Phoenix/)).toBeInTheDocument();
  });

  it("SM-9: Output Map styles forced_open / inactive warehouses from the super warehouse rows", () => {
    const inputs = { ...sample, warehouses: sample.warehouses.map((w: { id: string }, i: number) => (i === 1 ? { ...w, status: "inactive" } : w)) };
    const solved = { ...scenario, inputs, result: JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/superResult.json"), "utf8")) };
    mockUseGetScenario.mockReturnValue({ data: solved } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [solved] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-output-output-map"));
    const statuses = mapProps.current!.warehouseStatuses;
    expect(statuses).toContainEqual({ warehouseId: "wh-11", status: "forced_open" });
    expect(statuses).toContainEqual({ warehouseId: inputs.warehouses[1].id, status: "inactive" });
    expect(statuses.every(s => s.status !== "active")).toBe(true);
  });

  it("SM-9: header has import/export; Optimization Parameters shows the readiness panel", () => {
    renderWorkspace();
    expect(screen.getByTestId("super-header-import")).toBeInTheDocument();
    expect(screen.getByTestId("super-header-export")).toBeInTheDocument();
    expect(screen.getByTestId("super-header-export-csv")).toBeInTheDocument();
    expect(screen.getByTestId("super-header-export-xlsx")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("sidebar-input-optimization-parameters"));
    expect(screen.getByTestId("super-readiness-ok")).toBeInTheDocument();
  });

  it("SM-9: an empty scenario shows the empty state on every input tab", () => {
    const empty = { ...scenario, inputs: { ...sample, products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [] } };
    mockUseGetScenario.mockReturnValue({ data: empty } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [empty] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-customers"));
    expect(screen.getByTestId("super-download-sample")).toBeInTheDocument();
    expect(screen.getByTestId("super-download-template")).toBeInTheDocument();
  });

  it("SM-13: an empty scenario opens on the import prompt with no sidebar click", () => {
    const empty = { ...scenario, inputs: { ...sample, products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [] } };
    mockUseGetScenario.mockReturnValue({ data: empty } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [empty] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    expect(screen.getByTestId("super-open-import")).toBeInTheDocument();
  });

  it("SM2-1: a non-empty scenario opens on the Input Map", () => {
    renderWorkspace();
    expect(screen.getByTestId("super-map-toolbar")).toBeInTheDocument();
  });
  it("SM2-1: an empty scenario's Input Map shows the map, not the import prompt", () => {
    const empty = { ...scenario, inputs: { ...sample, products: [], plants: [], warehouses: [], customers: [], plantProducts: [], demand: [], distanceOverrides: [] } };
    mockUseGetScenario.mockReturnValue({ data: empty } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [empty] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    expect(screen.getByTestId("super-open-import")).toBeInTheDocument(); // SM-13 unchanged
    fireEvent.click(screen.getByTestId("sidebar-input-input-map"));
    expect(screen.getByTestId("super-map-toolbar")).toBeInTheDocument();
    expect(screen.queryByTestId("super-empty-state")).not.toBeInTheDocument();
  });
  it("SM2-1: a successful import switches to the Input Map", async () => {
    const { useImportScenarioNetwork } = await import("@workspace/api-client-react");
    vi.mocked(useImportScenarioNetwork).mockReturnValue({
      mutate: (_v: unknown, o: { onSuccess: (r: { scenario: typeof scenario }) => void }) => o.onSuccess({ scenario }),
      reset: vi.fn(), isPending: false, isError: false,
    } as never);
    renderWorkspace();
    fireEvent.click(screen.getByTestId("sidebar-input-products"));
    fireEvent.click(screen.getByTestId("super-header-import"));
    fireEvent.click(screen.getByTestId("super-import-mode-merge"));
    fireEvent.change(screen.getByTestId("super-import-file"), { target: { files: [new File(["{}"], "n.json", { type: "application/json" })] } });
    await waitFor(() => expect(screen.getByTestId("super-import-confirm")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("super-import-confirm"));
    await waitFor(() => expect(screen.getByTestId("super-map-toolbar")).toBeInTheDocument());
  });

  it("SM-9: Replace still needs the overwrite confirmation when every row was deleted locally but not saved", async () => {
    // A tiny SAVED scenario (one row per entity table) keeps this to ~4 UI deletions; the
    // behaviour under test (saved rows exist, local draft is empty) does not depend on size.
    const tiny = {
      ...scenario,
      inputs: {
        ...sample,
        products: sample.products.slice(0, 1), plants: sample.plants.slice(0, 1),
        warehouses: sample.warehouses.slice(0, 1), customers: sample.customers.slice(0, 1),
        plantProducts: [], demand: [], distanceOverrides: [],
      },
    };
    mockUseGetScenario.mockReturnValue({ data: tiny } as unknown as ReturnType<typeof mockUseGetScenario>);
    mockUseListScenarios.mockReturnValue({ data: [tiny] } as unknown as ReturnType<typeof mockUseListScenarios>);
    renderWorkspace();
    for (const table of ["products", "plants", "warehouses", "customers"]) {
      fireEvent.click(screen.getByTestId(`sidebar-input-${table}`));
      let btn: Element | null;
      while ((btn = document.querySelector(`[data-testid^="super-${table}-"][data-testid$="-delete"]`))) {
        fireEvent.click(btn);
        fireEvent.click(screen.getByTestId("super-delete-confirm-button"));
      }
    }
    // local draft is now empty (empty-state panel is shown) but the SAVED scenario still has rows
    expect(screen.getByTestId("super-empty-state")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("super-header-import"));
    fireEvent.click(screen.getByTestId("super-import-mode-replace"));
    fireEvent.change(screen.getByTestId("super-import-file"), { target: { files: [new File(["{}"], "n.json", { type: "application/json" })] } });
    await waitFor(() => expect(screen.getByTestId("super-import-confirm")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("super-import-confirm"));
    expect(screen.getByTestId("super-import-confirm-overwrite")).toBeInTheDocument();
  });
});
