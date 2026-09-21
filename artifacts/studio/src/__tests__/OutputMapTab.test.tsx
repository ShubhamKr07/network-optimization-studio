import type { ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, fireEvent, screen, waitFor } from "@testing-library/react";
import { UnitProvider } from "@/contexts/UnitContext";
import { OutputMapTab } from "@/components/workspace/tabs/OutputMapTab";

// chen-bands-units, Part D — OutputMapTab reads the display-unit preference
// via useDisplayUnit(), which throws outside a UnitProvider. Shadowing
// `render` keeps all 43 existing call sites byte-identical instead of
// wrapping each one, the same pattern AppShell.test.tsx's renderShell uses.
const render = (ui: ReactElement) => rtlRender(<UnitProvider>{ui}</UnitProvider>);
import { getBandColor } from "@/lib/bandPalette";
import { INBOUND_LEG_COLOR, OUTBOUND_LEG_COLOR } from "@/lib/legPalette";
import * as copyMapToClipboard from "@/lib/copyMapToClipboard";

vi.mock("@/lib/copyMapToClipboard", () => ({
  copyMapToClipboard: vi.fn(),
  downloadMapAsPng: vi.fn(),
  isClipboardImageWriteSupported: vi.fn(),
}));

// T9 (workspace-fixups-2, item 4) — same "capture every <Tooltip> child"
// convention NetworkMap.test.tsx itself already establishes (react-leaflet's
// non-permanent Tooltip never attaches its children to the jsdom document
// until hovered in a real browser, so reading it off `container.textContent`
// doesn't work — spying on the Tooltip component verifies the SAME emitted
// content without depending on Leaflet DOM hover behavior under jsdom). Real
// MapContainer is still used underneath (only Tooltip is swapped), matching
// every other test in this file's "no react-leaflet mocking" convention as
// closely as this one addition allows.
const tooltipChildren: React.ReactNode[] = [];
vi.mock("react-leaflet", async () => {
  const actual = await vi.importActual<typeof import("react-leaflet")>("react-leaflet");
  return {
    ...actual,
    Tooltip: (props: { children?: React.ReactNode }) => {
      if (props.children) tooltipChildren.push(props.children);
      return null;
    },
  };
});

// B2.1-T2 — distanceUnit is sourced from GET /api/models (via
// useListModels), same convention ServiceStatsTab.test.tsx already uses.
// "two-echelon-fake-km" is a fictional entry (no real model uses "km" yet)
// solely to prove the overlay actually reads the resolved unit rather than
// hardcoding "mi".
const mockUseListModels = vi.fn(() => ({
  data: [
    { id: "p-median-us", distanceUnit: "mi" },
    { id: "two-echelon-fake-km", distanceUnit: "km" },
  ],
}));
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => mockUseListModels(),
}));

// A3.1 — Output Map tab. Renders the REAL NetworkMap (no react-leaflet
// mocking, same convention NetworkMap.test.tsx already uses) so assertions
// reflect actual rendered Leaflet DOM: warehouse markers land in
// `.leaflet-marker-pane`, customer CircleMarkers in `.leaflet-overlay-pane`
// (SVG paths), and routes in the dedicated named `.leaflet-route-pane`
// (NetworkMap.tsx's own Pane name="routePane").

const dataset = {
  warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
  customers: [
    { id: "C1", city: "Nearburg", state: "SB", lat: 40.5, lng: -90.5, demand: 100 },
    { id: "C2", city: "Farburg", state: "SB", lat: 45, lng: -95, demand: 200 },
  ],
};

// C1 is close (short distance -> band 0), C2 is far (long distance -> a
// later band) under bands=[250,500,750] so the two edges land in visibly
// different bands, letting the color-by-band assertions distinguish
// "plain" (identical color) from "colored" (different colors).
const result = {
  status: "optimal" as const,
  objective: 1,
  runTimeSec: 0.1,
  quality: "Optimal",
  edges: [
    { fromId: "W1", toId: "C1", flow: 50, distance: 100 },
    { fromId: "W1", toId: "C2", flow: 50, distance: 900 },
  ],
  metrics: { weightedAvgDistance: 500, bandCoverage: [], utilizationByNode: [] },
  details: { openWarehouseIds: ["W1"], assignments: [] },
  solverUsed: "CBC (PuLP)",
  infeasibilityReason: null,
};

function routePaneHtml(container: HTMLElement): string {
  return container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
}

// react-leaflet's SVG renderer keeps an empty `<g>` layer-group in the pane
// even with zero Polylines rendered — "no routes" means zero <path>
// elements, not an empty string.
function routePathCount(container: HTMLElement): number {
  return (routePaneHtml(container).match(/<path/g) ?? []).length;
}

function warehouseMarkerCount(container: HTMLElement): number {
  return container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon").length;
}

function customerMarkerCount(container: HTMLElement): number {
  // Customer CircleMarkers render as SVG <path class="leaflet-interactive">
  // inside the default overlay pane — a distinct DOM area from both the
  // marker pane (warehouses) and the named routePane (lanes).
  return container.querySelectorAll(".leaflet-overlay-pane path.leaflet-interactive").length;
}

describe("OutputMapTab — layer toggles", () => {
  it("all three layers (Warehouses/Customers/Lanes) and Color-by-band are ON by default", () => {
    const { getByTestId } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />,
    );
    expect(getByTestId("checkbox-toggle-warehouses")).toHaveAttribute("aria-checked", "true");
    expect(getByTestId("checkbox-toggle-customers")).toHaveAttribute("aria-checked", "true");
    expect(getByTestId("checkbox-toggle-lanes")).toHaveAttribute("aria-checked", "true");
    expect(getByTestId("checkbox-color-lanes-band")).toHaveAttribute("aria-checked", "true");
  });

  it("unchecking Warehouses removes warehouse markers but leaves customer markers and lanes untouched", () => {
    const { getByTestId, container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />,
    );
    expect(warehouseMarkerCount(container)).toBe(1);
    expect(customerMarkerCount(container)).toBe(2);
    expect(routePathCount(container)).toBe(2);

    fireEvent.click(getByTestId("checkbox-toggle-warehouses"));

    expect(warehouseMarkerCount(container)).toBe(0);
    expect(customerMarkerCount(container)).toBe(2);
    // Lanes must survive hiding the warehouse MARKER — NetworkMap still
    // resolves route endpoints against the full dataset regardless of the
    // marker-visibility toggle (this is exactly why dataset-filtering was
    // rejected in favor of the showWarehouseMarkers prop).
    expect(routePathCount(container)).toBe(2);
  });

  it("unchecking Customers removes customer markers but leaves warehouse markers and lanes untouched", () => {
    const { getByTestId, container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />,
    );
    fireEvent.click(getByTestId("checkbox-toggle-customers"));

    expect(customerMarkerCount(container)).toBe(0);
    expect(warehouseMarkerCount(container)).toBe(1);
    expect(routePathCount(container)).toBe(2);
  });

  it("unchecking Lanes removes routes but leaves both marker layers untouched", () => {
    const { getByTestId, container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />,
    );
    fireEvent.click(getByTestId("checkbox-toggle-lanes"));

    expect(routePathCount(container)).toBe(0);
    expect(warehouseMarkerCount(container)).toBe(1);
    expect(customerMarkerCount(container)).toBe(2);
  });

  it("all three layers can be independently re-enabled after being turned off", () => {
    const { getByTestId, container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />,
    );
    fireEvent.click(getByTestId("checkbox-toggle-warehouses"));
    fireEvent.click(getByTestId("checkbox-toggle-customers"));
    fireEvent.click(getByTestId("checkbox-toggle-lanes"));
    expect(warehouseMarkerCount(container)).toBe(0);
    expect(customerMarkerCount(container)).toBe(0);
    expect(routePathCount(container)).toBe(0);

    fireEvent.click(getByTestId("checkbox-toggle-warehouses"));
    fireEvent.click(getByTestId("checkbox-toggle-customers"));
    fireEvent.click(getByTestId("checkbox-toggle-lanes"));
    expect(warehouseMarkerCount(container)).toBe(1);
    expect(customerMarkerCount(container)).toBe(2);
    expect(routePathCount(container)).toBe(2);
  });
});

describe("OutputMapTab — lane coloring (plain vs distance band)", () => {
  it("colors the two lanes differently by distance band when Color-by-band is ON (default)", () => {
    const { container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />,
    );
    const html = routePaneHtml(container);
    // 100mi edge -> band 0. 900mi edge exceeds every boundary in
    // [250,500,750] (3 bands, indices 0-2) -> jade-B1's all-site overflow
    // fix resolves it to the distinct OVERFLOW color (-1), never folded into
    // the last real band (index 2) — a real behavior change from the old
    // assignBand-folding this test previously asserted.
    expect(html.toLowerCase()).toContain(getBandColor(0).toLowerCase());
    expect(html.toLowerCase()).toContain(getBandColor(-1).toLowerCase());
    expect(html.toLowerCase()).not.toContain(getBandColor(2).toLowerCase());
  });

  it("colors every lane identically (band-0 color) when Color-by-band is turned OFF, regardless of each edge's real distance", () => {
    const { getByTestId, container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />,
    );
    fireEvent.click(getByTestId("checkbox-color-lanes-band"));

    const html = routePaneHtml(container);
    // Both edges (100mi and 900mi — normally different bands) must render
    // the SAME uniform color, and NOT the "should be different" overflow
    // color a non-empty-bands render would produce.
    expect(html.toLowerCase()).not.toContain(getBandColor(-1).toLowerCase());
    expect(routePathCount(container)).toBe(2);
  });

  it("applies DD-5's default 250/500/750 bands for lane coloring when the scenario hasn't configured its own (bands=[])", () => {
    const { container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[]} />,
    );
    const html = routePaneHtml(container);
    // Same 100mi/900mi edges as above still resolve to different bands under
    // the DD-5 default [250,500,750] (900mi overflows it), proving the
    // fallback was applied rather than the empty array silently collapsing
    // every edge to band 0.
    expect(html.toLowerCase()).toContain(getBandColor(0).toLowerCase());
    expect(html.toLowerCase()).toContain(getBandColor(-1).toLowerCase());
  });

  it("the Color-by-band checkbox is disabled once Lanes itself is off", () => {
    const { getByTestId } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />,
    );
    fireEvent.click(getByTestId("checkbox-toggle-lanes"));
    expect(getByTestId("checkbox-color-lanes-band")).toBeDisabled();
  });
});

describe("OutputMapTab — result gating", () => {
  it("shows a 'no result yet' hint and renders no routes when result is null (pre-solve / inactive tab)", () => {
    const { getByTestId, container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={null} bands={[250, 500, 750]} />,
    );
    expect(getByTestId("output-map-no-result")).toBeInTheDocument();
    expect(routePathCount(container)).toBe(0);
    // Markers still render — the input network stays visible without a result.
    expect(warehouseMarkerCount(container)).toBe(1);
    expect(customerMarkerCount(container)).toBe(2);
  });

  it("does NOT show the 'no result yet' hint once a result is supplied", () => {
    const { queryByTestId } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />,
    );
    expect(queryByTestId("output-map-no-result")).not.toBeInTheDocument();
  });
});

// ── T6/R7 — effective dataset (added entities) + hideClosedWarehouses ─────
describe("OutputMapTab — R7 output effective dataset + hide closed WHs", () => {
  const twoWarehouseDataset = {
    warehouses: [
      { id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 },
      { id: "W2", city: "Elsewhere", state: "TS", lat: 42, lng: -92 },
    ],
    customers: [{ id: "C1", city: "Nearburg", state: "SB", lat: 40.5, lng: -90.5, demand: 100 }],
  };
  const resultOpensW1Only = {
    ...result,
    edges: [{ fromId: "W1", toId: "C1", flow: 100, distance: 100 }],
    details: { openWarehouseIds: ["W1"], assignments: [] },
  };

  it("hideClosedWarehouses omits the closed candidate's marker but leaves the opened one and its route", () => {
    const { container } = render(
      <OutputMapTab
        dataset={twoWarehouseDataset}
        warehouseStatuses={[]}
        result={resultOpensW1Only}
        bands={[250, 500, 750]}
        hideClosedWarehouses
      />,
    );
    expect(warehouseMarkerCount(container)).toBe(1);
    expect(routePathCount(container)).toBe(1);
  });

  it("without hideClosedWarehouses (default), both warehouses' markers still render — unaffected legacy behavior", () => {
    const { container } = render(
      <OutputMapTab
        dataset={twoWarehouseDataset}
        warehouseStatuses={[]}
        result={resultOpensW1Only}
        bands={[250, 500, 750]}
      />,
    );
    expect(warehouseMarkerCount(container)).toBe(2);
  });

  it("an added warehouse the solver opened renders on the map, along with its route to an added customer", () => {
    const addedResult = {
      ...result,
      edges: [{ fromId: "W-ADDED", toId: "C-ADDED", flow: 100, distance: 100 }],
      details: { openWarehouseIds: ["W-ADDED"], assignments: [] },
    };
    const { container } = render(
      <OutputMapTab
        dataset={dataset}
        warehouseStatuses={[]}
        result={addedResult}
        bands={[250, 500, 750]}
        hideClosedWarehouses
        addedWarehouses={[{ id: "W-ADDED", city: "New Town", state: "NT", lat: 39, lng: -89 }]}
        addedCustomers={[{ id: "C-ADDED", city: "New Burg", state: "NB", lat: 39.5, lng: -89.5, demand: 50 }]}
      />,
    );
    // Base warehouse W1 is closed (not in openWarehouseIds) so it's hidden;
    // only the added, opened warehouse renders — exactly one marker.
    expect(warehouseMarkerCount(container)).toBe(1);
    // Base customers (C1, C2) plus the added one — customers are never
    // filtered by open/closed.
    expect(customerMarkerCount(container)).toBe(3);
    // The route only renders at all if NetworkMap can resolve BOTH endpoints
    // (W-ADDED, C-ADDED) via dataset.warehouses.find()/dataset.customers.find()
    // — proving both added entities actually landed in the effective dataset,
    // not just that some marker count happens to match.
    expect(routePathCount(container)).toBe(1);
  });

  it("an added warehouse that the solver did NOT open stays hidden under hideClosedWarehouses", () => {
    const { container } = render(
      <OutputMapTab
        dataset={twoWarehouseDataset}
        warehouseStatuses={[]}
        result={resultOpensW1Only}
        bands={[250, 500, 750]}
        hideClosedWarehouses
        addedWarehouses={[{ id: "W-ADDED-CLOSED", city: "Ghost Town", state: "GT", lat: 39, lng: -89 }]}
      />,
    );
    // Only W1 (opened) shows — W2 (closed, base) and W-ADDED-CLOSED (closed, added) are both hidden.
    expect(warehouseMarkerCount(container)).toBe(1);
  });
});

describe("OutputMapTab — copy/download", () => {
  it("shows the Copy to clipboard button when the Clipboard API is supported", () => {
    vi.mocked(copyMapToClipboard.isClipboardImageWriteSupported).mockReturnValue(true);
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />);
    expect(screen.getByTestId("button-copy-map-clipboard")).toBeInTheDocument();
  });

  it("hides the Copy to clipboard button when the Clipboard API is unsupported", () => {
    vi.mocked(copyMapToClipboard.isClipboardImageWriteSupported).mockReturnValue(false);
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />);
    expect(screen.queryByTestId("button-copy-map-clipboard")).not.toBeInTheDocument();
  });

  it("always shows the Download PNG button regardless of Clipboard API support", () => {
    vi.mocked(copyMapToClipboard.isClipboardImageWriteSupported).mockReturnValue(false);
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />);
    expect(screen.getByTestId("button-download-map-png")).toBeInTheDocument();
  });

  it("calls copyMapToClipboard with the map container node when Copy is clicked", async () => {
    vi.mocked(copyMapToClipboard.isClipboardImageWriteSupported).mockReturnValue(true);
    vi.mocked(copyMapToClipboard.copyMapToClipboard).mockResolvedValue("copied");
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />);
    fireEvent.click(screen.getByTestId("button-copy-map-clipboard"));
    await waitFor(() => expect(copyMapToClipboard.copyMapToClipboard).toHaveBeenCalledTimes(1));
  });

  it("calls downloadMapAsPng when Download PNG is clicked", async () => {
    vi.mocked(copyMapToClipboard.downloadMapAsPng).mockResolvedValue(undefined);
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />);
    fireEvent.click(screen.getByTestId("button-download-map-png"));
    await waitFor(() => expect(copyMapToClipboard.downloadMapAsPng).toHaveBeenCalledTimes(1));
  });
});

// jade-T15.6 — per-leg lane visibility toggles. Two-echelon models
// (two-echelon-gold-au, two-echelon-jade-us) tag each edge with a `leg`;
// this suite proves the toggle checkboxes are derived from the RESULT's
// distinct leg values (never a modelId check) and actually control
// NetworkMap's visibleLegs prop, observed via real rendered route DOM (same
// convention as the rest of this file — no react-leaflet mocking).
describe("OutputMapTab — per-leg lane visibility toggles (jade-T15.6)", () => {
  // Two-echelon dataset: a "plant" folded into warehouses (matching
  // Workspace.tsx's own documented jadePlantsAsWarehouseCandidates fold —
  // NetworkMap resolves an inbound leg's fromId/toId both against
  // dataset.warehouses).
  const twoLegDataset = {
    warehouses: [
      { id: "P1", city: "Plantville", state: "PL", lat: 34, lng: -112 },
      { id: "W1", city: "Warehouseburg", state: "WB", lat: 35, lng: -111 },
    ],
    customers: [{ id: "C1", city: "Customerton", state: "CT", lat: 36, lng: -110, demand: 100 }],
  };
  const twoLegResult = {
    status: "optimal" as const,
    objective: 1,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [
      { fromId: "P1", toId: "W1", leg: "plant_to_warehouse" as const, flow: 50, distance: 100 },
      { fromId: "W1", toId: "C1", leg: "warehouse_to_customer" as const, flow: 50, distance: 200 },
    ],
    metrics: { weightedAvgDistance: 150, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["W1"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("renders one human-labeled checkbox per distinct leg, both checked by default", () => {
    const { container } = render(
      <OutputMapTab dataset={twoLegDataset} warehouseStatuses={[]} result={twoLegResult} bands={[250, 500, 750]} />,
    );
    const plantToWarehouse = screen.getByTestId("checkbox-toggle-leg-plant_to_warehouse");
    const warehouseToCustomer = screen.getByTestId("checkbox-toggle-leg-warehouse_to_customer");
    expect(plantToWarehouse).toHaveAttribute("aria-checked", "true");
    expect(warehouseToCustomer).toHaveAttribute("aria-checked", "true");
    // Labels derived from the leg string itself (generic "_to_" split +
    // capitalize), never a modelId/leg-string allowlist keyed to JADE.
    expect(screen.getByText("Plant → Warehouse")).toBeInTheDocument();
    expect(screen.getByText("Warehouse → Customer")).toBeInTheDocument();
    expect(routePathCount(container)).toBe(2);
  });

  it("unchecking one leg's toggle hides only that leg's route (visibleLegs excludes it)", () => {
    const { container } = render(
      <OutputMapTab dataset={twoLegDataset} warehouseStatuses={[]} result={twoLegResult} bands={[250, 500, 750]} />,
    );
    // jade-B1 — "Color lanes: Distance band" is ON by default, which (per
    // the leg-vs-band coloring fix) now makes band colors win over leg
    // colors. Turn it off so this test can keep identifying the surviving
    // route by its LEG color (the thing this test is actually about —
    // visibility filtering, not color-mode selection).
    fireEvent.click(screen.getByTestId("checkbox-color-lanes-band"));
    fireEvent.click(screen.getByTestId("checkbox-toggle-leg-plant_to_warehouse"));

    expect(screen.getByTestId("checkbox-toggle-leg-plant_to_warehouse")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("checkbox-toggle-leg-warehouse_to_customer")).toHaveAttribute("aria-checked", "true");
    // Exactly one route remains — the plant_to_warehouse (inbound) polyline
    // is gone (proven by color, not just count: inbound color absent,
    // outbound color still present).
    expect(routePathCount(container)).toBe(1);
    const html = routePaneHtml(container);
    expect(html.toLowerCase()).not.toContain(INBOUND_LEG_COLOR.toLowerCase());
    expect(html.toLowerCase()).toContain(OUTBOUND_LEG_COLOR.toLowerCase());
  });

  it("re-checking a leg's toggle restores its route", () => {
    const { container } = render(
      <OutputMapTab dataset={twoLegDataset} warehouseStatuses={[]} result={twoLegResult} bands={[250, 500, 750]} />,
    );
    fireEvent.click(screen.getByTestId("checkbox-toggle-leg-plant_to_warehouse"));
    expect(routePathCount(container)).toBe(1);
    fireEvent.click(screen.getByTestId("checkbox-toggle-leg-plant_to_warehouse"));
    expect(routePathCount(container)).toBe(2);
  });

  it("renders no per-leg toggles for a single-echelon (legless) result — unchanged behavior", () => {
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />);
    expect(screen.queryByTestId(/^checkbox-toggle-leg-/)).not.toBeInTheDocument();
  });

  it("renders no per-leg toggles pre-solve (result is null)", () => {
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={null} bands={[250, 500, 750]} />);
    expect(screen.queryByTestId(/^checkbox-toggle-leg-/)).not.toBeInTheDocument();
  });
});

// B2.1-T2, item 2 — floating objective + weighted-avg-distance overlay.
// `result` here is `displayedResult` at the call site (Workspace.tsx), so
// this overlay follows the result-history stepper automatically — no extra
// wiring needed in this component beyond rendering the prop it already has.
describe("OutputMapTab — floating metric overlay (B2.1 item 2)", () => {
  it("shows the formatted objective and weighted-avg-distance (with the model's unit) once a result is set", () => {
    render(
      <OutputMapTab
        dataset={dataset}
        warehouseStatuses={[]}
        result={{ ...result, objective: 1234567, metrics: { ...result.metrics, weightedAvgDistance: 412.345 } }}
        bands={[250, 500, 750]}
        modelId="p-median-us"
      />,
    );
    const overlay = screen.getByTestId("output-map-metric-overlay");
    expect(overlay).toHaveTextContent("1,234,567");
    expect(overlay).toHaveTextContent("412.3 mi");
  });

  it("uses the resolved model's distanceUnit ('km'), not a hardcoded 'mi'", () => {
    render(
      <OutputMapTab
        dataset={dataset}
        warehouseStatuses={[]}
        result={{ ...result, metrics: { ...result.metrics, weightedAvgDistance: 500 } }}
        bands={[250, 500, 750]}
        modelId="two-echelon-fake-km"
      />,
    );
    expect(screen.getByTestId("output-map-metric-overlay")).toHaveTextContent("500.0 km");
  });

  // chen-bands-units, Part D "No fallback unit — reads". This test previously
  // asserted a "500.0 mi" default when modelId was absent. That expectation
  // encoded the very fallback this bundle deletes: Chen is a km model, so
  // guessing "mi" renders a CORRECT number under a WRONG unit, which a student
  // reads as fact. With no modelId the canonical unit is unresolved, so the
  // overlay must show a placeholder and no unit label at all.
  it("renders a placeholder, never a guessed 'mi', when modelId is not provided", () => {
    render(
      <OutputMapTab
        dataset={dataset}
        warehouseStatuses={[]}
        result={{ ...result, metrics: { ...result.metrics, weightedAvgDistance: 500 } }}
        bands={[250, 500, 750]}
      />,
    );
    const overlay = screen.getByTestId("output-map-metric-overlay");
    expect(overlay).toHaveTextContent("—");
    expect(overlay).not.toHaveTextContent("mi");
    expect(overlay).not.toHaveTextContent("km");
    expect(overlay).not.toHaveTextContent("500.0");
  });

  it("is absent when result is null (pre-solve / inactive tab)", () => {
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={null} bands={[250, 500, 750]} />);
    expect(screen.queryByTestId("output-map-metric-overlay")).not.toBeInTheDocument();
  });
});

// ── jade-B1 (#3 three weighted-average distances) ──────────────────────────
describe("OutputMapTab — three weighted-average distance lines (jade-B1 #3)", () => {
  const twoLegResult = {
    ...result,
    edges: [
      { fromId: "plant-1", toId: "W1", flow: 100, distance: 1500, leg: "plant_to_warehouse" as const },
      { fromId: "W1", toId: "C1", flow: 100, distance: 900, leg: "warehouse_to_customer" as const },
    ],
    metrics: {
      ...result.metrics,
      weightedAvgDistance: 1200,
      avgDistanceByLeg: [
        { leg: "plant_to_warehouse", avgDistance: 1500, totalFlow: 100 },
        { leg: "warehouse_to_customer", avgDistance: 900, totalFlow: 100 },
      ],
    },
  };

  // `modelId` is required now: without it the canonical unit is unresolved and
  // every distance renders as a placeholder (Part D, no fallback unit). This
  // test is about the three labelled LINES, so it resolves a real unit rather
  // than weakening its own value assertions.
  it("shows three labelled avg-distance lines (per-leg x2 + overall) for a two-echelon result", () => {
    render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={twoLegResult} bands={[250, 500, 750]} modelId="p-median-us" />,
    );
    const overlay = screen.getByTestId("output-map-metric-overlay");
    // Per-leg lines, labelled via legLabel() (never a hardcoded JADE-only string).
    expect(overlay).toHaveTextContent("Plant → Warehouse avg distance:");
    expect(overlay).toHaveTextContent("1500.0 mi");
    expect(overlay).toHaveTextContent("Warehouse → Customer avg distance:");
    expect(overlay).toHaveTextContent("900.0 mi");
    // Overall line.
    expect(overlay).toHaveTextContent("Overall avg distance:");
    expect(overlay).toHaveTextContent("1200.0 mi");
    // The old single "Weighted avg distance:" line is replaced, not duplicated.
    expect(overlay.textContent).not.toContain("Weighted avg distance:");
  });

  it("shows a single 'Weighted avg distance' line for a single-leg/no-leg model (unchanged behavior)", () => {
    render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />,
    );
    const overlay = screen.getByTestId("output-map-metric-overlay");
    expect(overlay).toHaveTextContent("Weighted avg distance:");
    expect(overlay.textContent).not.toContain("Plant → Warehouse avg distance:");
    expect(overlay.textContent).not.toContain("Overall avg distance:");
  });
});

// ── jade-B1 (#8 timing overlay) ─────────────────────────────────────────────
describe("OutputMapTab — timing overlay (jade-B1 #8)", () => {
  it("renders the frozen total + queued/active split when the `timing` prop is provided", () => {
    render(
      <OutputMapTab
        dataset={dataset}
        warehouseStatuses={[]}
        result={result}
        bands={[250, 500, 750]}
        timing={{ totalSec: 12.4, queuedSec: 2.1, activeSec: 10.3 }}
      />,
    );
    const timing = screen.getByTestId("output-map-timing");
    expect(timing).toHaveTextContent("12.4s");
    expect(timing).toHaveTextContent("2.1s");
    expect(timing).toHaveTextContent("10.3s");
  });

  it("renders nothing (suppressed) when the `timing` prop is absent", () => {
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />);
    expect(screen.queryByTestId("output-map-timing")).not.toBeInTheDocument();
  });

  it("is suppressed even with a result, if timing is explicitly absent (not just pre-solve)", () => {
    render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} timing={undefined} />,
    );
    expect(screen.queryByTestId("output-map-timing")).not.toBeInTheDocument();
  });
});

// ── jade-B1 (#2) — Plants layer toggle ──────────────────────────────────────
describe("OutputMapTab — Plants layer toggle (jade-B1 #2)", () => {
  const plants = [{ id: "plant-1", city: "Springfield", state: "IL", lat: 39.78, lng: -89.65 }];

  it("does NOT show a Plants checkbox when there are no plants", () => {
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />);
    expect(screen.queryByTestId("checkbox-toggle-plants")).not.toBeInTheDocument();
  });

  it("shows a Plants checkbox (checked by default) and renders a plant marker when plants are supplied", () => {
    const { container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} plants={plants} />,
    );
    expect(screen.getByTestId("checkbox-toggle-plants")).toHaveAttribute("aria-checked", "true");
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    const plantMarker = Array.from(markers).find((m) => m.innerHTML.includes("<rect"));
    expect(plantMarker).toBeDefined();
  });

  it("unchecking Plants hides the plant marker", () => {
    const { container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} plants={plants} />,
    );
    fireEvent.click(screen.getByTestId("checkbox-toggle-plants"));
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    const plantMarker = Array.from(markers).find((m) => m.innerHTML.includes("<rect"));
    expect(plantMarker).toBeUndefined();
    // Warehouse marker (a <polygon>) still renders — only the plant layer toggled.
    expect(warehouseMarkerCount(container)).toBe(1);
  });
});

// ── T9 (workspace-fixups-2, item 4) — forward-only: OutputMapTab has no
// opinion on where displayIdById/modelId come from (INT wires them from the
// solved-snapshot outputIdentityById), it just passes them straight through
// to NetworkMap's own already-tested resolution logic. These tests prove the
// FORWARDING wire, not NetworkMap's own label/lookup behavior (already
// covered by NetworkMap.test.tsx).
describe("OutputMapTab — forwards displayIdById/modelId to NetworkMap (T9)", () => {
  it("an added output warehouse/customer/plant marker shows its forwarded display code, not the raw uid", () => {
    tooltipChildren.length = 0;
    render(
      <OutputMapTab
        dataset={dataset}
        warehouseStatuses={[]}
        result={result}
        bands={[250, 500, 750]}
        addedWarehouses={[{ id: "aw-uuid-1", city: "New Town", state: "NT", lat: 39, lng: -89 }]}
        addedCustomers={[{ id: "ac-uuid-1", city: "New Burg", state: "NB", lat: 39.5, lng: -89.5, demand: 50 }]}
        plants={[{ id: "pl-uuid-1", city: "Springfield", state: "IL", lat: 39.78, lng: -89.65 }]}
        displayIdById={{
          "aw-uuid-1": "WH-NT-NEW-01",
          "ac-uuid-1": "CS-NB-NEW-01",
          "pl-uuid-1": "PL-IL-SPR-01",
        }}
      />,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("New Town"))).toContain("WH-NT-NEW-01");
    expect(texts.some((t) => t.includes("aw-uuid-1"))).toBe(false);
    expect(texts.find((t) => t.includes("New Burg"))).toContain("CS-NB-NEW-01");
    expect(texts.some((t) => t.includes("ac-uuid-1"))).toBe(false);
    expect(texts.find((t) => t.includes("Springfield"))).toContain("PL-IL-SPR-01");
    expect(texts.some((t) => t.includes("pl-uuid-1"))).toBe(false);
  });

  it("falls back to the raw id when displayIdById has no entry (default {})", () => {
    tooltipChildren.length = 0;
    render(
      <OutputMapTab
        dataset={dataset}
        warehouseStatuses={[]}
        result={result}
        bands={[250, 500, 750]}
      />,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("Testville"))).toContain("Warehouse · W1 · Testville, TS");
  });

  it("forwards modelId so a two-echelon-gold-au facility marker labels 'Refinery'", () => {
    tooltipChildren.length = 0;
    const goldDataset = {
      warehouses: [{ id: "cunnamulla", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68, kind: "facility" as const }],
      customers: [],
    };
    render(
      <OutputMapTab
        dataset={goldDataset}
        warehouseStatuses={[]}
        result={null}
        bands={[250, 500, 750]}
        modelId="two-echelon-gold-au"
      />,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("Cunnamulla"))).toContain("Refinery · cunnamulla · Cunnamulla, QLD");
  });
});
