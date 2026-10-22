import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, act } from "@testing-library/react";
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
  usePrecheckScenario: vi.fn(() => ({ data: { ok: true, errors: [] } })),
  getPrecheckScenarioQueryKey: vi.fn((id: number) => ["precheck", id]),
  useLogoutUser: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  getGetCurrentAuthUserQueryKey: vi.fn(() => ["getCurrentAuthUser"]),
}));

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
  it("renders the nine sidebar input entries", () => {
    renderWorkspace();
    for (const id of ["products", "plants", "warehouses", "customers", "plantProducts", "demand", "distances", "transportCosts", "optimization-parameters"]) {
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
    expect(document.querySelectorAll('[data-testid^="super-row-demand-"][data-testid$="|product-1"]').length).toBe(0);
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
});
