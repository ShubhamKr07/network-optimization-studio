import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { OutputMapTab } from "@/components/workspace/tabs/OutputMapTab";
import { getBandColor } from "@/lib/bandPalette";
import * as copyMapToClipboard from "@/lib/copyMapToClipboard";

vi.mock("@/lib/copyMapToClipboard", () => ({
  copyMapToClipboard: vi.fn(),
  downloadMapAsPng: vi.fn(),
  isClipboardImageWriteSupported: vi.fn(),
}));

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
    // [250,500,750] (3 bands, indices 0-2) -> assignBand returns the last
    // index, 2 -> distinct palette colors from band 0.
    expect(html.toLowerCase()).toContain(getBandColor(0).toLowerCase());
    expect(html.toLowerCase()).toContain(getBandColor(2).toLowerCase());
  });

  it("colors every lane identically (band-0 color) when Color-by-band is turned OFF, regardless of each edge's real distance", () => {
    const { getByTestId, container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[250, 500, 750]} />,
    );
    fireEvent.click(getByTestId("checkbox-color-lanes-band"));

    const html = routePaneHtml(container);
    // Both edges (100mi and 900mi — normally different bands) must render
    // the SAME uniform color, and NOT the "should be different" band-2 color.
    expect(html.toLowerCase()).not.toContain(getBandColor(2).toLowerCase());
    expect(routePathCount(container)).toBe(2);
  });

  it("applies DD-5's default 250/500/750 bands for lane coloring when the scenario hasn't configured its own (bands=[])", () => {
    const { container } = render(
      <OutputMapTab dataset={dataset} warehouseStatuses={[]} result={result} bands={[]} />,
    );
    const html = routePaneHtml(container);
    // Same 100mi/900mi edges as above still resolve to different bands under
    // the DD-5 default [250,500,750], proving the fallback was applied
    // rather than the empty array silently collapsing every edge to band 0.
    expect(html.toLowerCase()).toContain(getBandColor(0).toLowerCase());
    expect(html.toLowerCase()).toContain(getBandColor(2).toLowerCase());
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

  it("defaults to 'mi' when modelId is not provided", () => {
    render(
      <OutputMapTab
        dataset={dataset}
        warehouseStatuses={[]}
        result={{ ...result, metrics: { ...result.metrics, weightedAvgDistance: 500 } }}
        bands={[250, 500, 750]}
      />,
    );
    expect(screen.getByTestId("output-map-metric-overlay")).toHaveTextContent("500.0 mi");
  });

  it("is absent when result is null (pre-solve / inactive tab)", () => {
    render(<OutputMapTab dataset={dataset} warehouseStatuses={[]} result={null} bands={[250, 500, 750]} />);
    expect(screen.queryByTestId("output-map-metric-overlay")).not.toBeInTheDocument();
  });
});
