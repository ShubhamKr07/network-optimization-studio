import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

// Capture every <Tooltip> child rendered by NetworkMap so we can assert that a
// Tooltip (hover label) is rendered for each customer/station marker with the
// expected city/state/demand content. react-leaflet's non-permanent Tooltip
// does not attach its React children to the jsdom document until the marker is
// hovered in a real browser, so we can't read it from container.textContent;
// spying on the Tooltip component verifies the same thing (that NetworkMap
// emits a Tooltip with the right children) without depending on Leaflet DOM
// behavior under jsdom.
const tooltipChildren: React.ReactNode[] = [];
// Capture the props passed to <MapContainer> so we can assert that Leaflet
// interaction options (e.g. boxZoom) are disabled as expected. We wrap the real
// MapContainer (rather than replacing it) so it still provides the Leaflet
// context that descendant hooks (useMap/useMapEvents) rely on under jsdom.
const mapContainerProps: Record<string, unknown>[] = [];
vi.mock("react-leaflet", async () => {
  const actual = await vi.importActual<typeof import("react-leaflet")>("react-leaflet");
  const RealMapContainer = actual.MapContainer;
  return {
    ...actual,
    Tooltip: (props: { children?: React.ReactNode }) => {
      if (props.children) tooltipChildren.push(props.children);
      return null;
    },
    MapContainer: (props: React.ComponentProps<typeof RealMapContainer>) => {
      const { children, ...rest } = props;
      mapContainerProps.push(rest);
      return <RealMapContainer {...props}>{children}</RealMapContainer>;
    },
  };
});

const { NetworkMap } = await import("@/components/NetworkMap");
const { getBandColor } = await import("@/lib/bandPalette");

const dataset = {
  warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
  customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 41, lng: -91, demand: 5000 }],
};

describe("NetworkMap customer/station hover tooltip", () => {
  it("renders a Tooltip for every customer/station marker", () => {
    render(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );

    // The dataset has one customer (no solved result, so no warehouse tooltip is
    // emitted either) -> exactly one Tooltip should have been rendered, and its
    // content should include the customer's city/state and demand, matching the
    // existing warehouse Tooltip's content style (NetworkMap.tsx:372-378).
    expect(tooltipChildren).toHaveLength(1);
    const { container } = render(<>{tooltipChildren[0]}</>);
    const text = container.textContent ?? "";
    expect(text).toContain("Sampleburg, SB");
    expect(text).toContain("5,000");
  });
});

describe("NetworkMap multi-select", () => {
  it("calls onToggleWarehouseMultiSelect on shift-click without triggering the single-select filter", () => {
    const onToggleWarehouseMultiSelect = vi.fn();
    const dataset = {
      warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
      customers: [],
    };
    render(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={onToggleWarehouseMultiSelect}
        onToggleCustomerMultiSelect={vi.fn()}
      />,
    );
    const marker = document.querySelector(".leaflet-marker-icon") as HTMLElement;
    fireEvent.click(marker, { shiftKey: true });
    expect(onToggleWarehouseMultiSelect).toHaveBeenCalledWith("W1");
  });

  it("renders a distinct highlight ring for warehouses in multiSelectedWarehouseIds", () => {
    const dataset = {
      warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
      customers: [],
    };
    const { container } = render(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={["W1"]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={vi.fn()}
        onToggleCustomerMultiSelect={vi.fn()}
      />,
    );
    // The multi-select ring uses a distinct stroke color (#7C3AED, violet) from
    // the existing single-select highlight ring (#FCD34D, amber) so a student
    // can tell the two selection modes apart at a glance.
    expect(container.innerHTML).toContain("#7C3AED");
  });
});

// ── Marker icon shape by kind (mine=star, facility/undefined=triangle) ─────
describe("NetworkMap warehouse icon shape by kind", () => {
  it("renders a star icon (svg path) for a warehouse tagged kind: 'mine'", () => {
    const mineDataset = {
      warehouses: [{ id: "M1", city: "Kalgoorlie", state: "WA", lat: -30.75, lng: 121.47, kind: "mine" as const }],
      customers: [],
    };
    const { container } = render(
      <NetworkMap
        dataset={mineDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const marker = container.querySelector(".leaflet-marker-icon");
    expect(marker?.innerHTML).toContain("<path");
    expect(marker?.innerHTML).not.toContain("<polygon");
  });

  it("renders a triangle icon (svg polygon) for a warehouse tagged kind: 'facility'", () => {
    const facilityDataset = {
      warehouses: [{ id: "R1", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68, kind: "facility" as const }],
      customers: [],
    };
    const { container } = render(
      <NetworkMap
        dataset={facilityDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const marker = container.querySelector(".leaflet-marker-icon");
    expect(marker?.innerHTML).toContain("<polygon");
    expect(marker?.innerHTML).not.toContain("<path");
  });

  it("renders a triangle icon (svg polygon) for every other model, whose warehouses carry no kind at all", () => {
    // dataset.warehouses[0] has no `kind` field — matches every model except
    // two-echelon-gold-au. Must render identically to before this change.
    const { container } = render(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const marker = container.querySelector(".leaflet-marker-icon");
    expect(marker?.innerHTML).toContain("<polygon");
    expect(marker?.innerHTML).not.toContain("<path");
  });
});

describe("NetworkMap MapContainer boxZoom", () => {
  it("disables Leaflet's boxZoom so it doesn't collide with shift-click multi-select", () => {
    render(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );

    expect(mapContainerProps.length).toBeGreaterThan(0);
    expect(mapContainerProps[mapContainerProps.length - 1].boxZoom).toBe(false);
  });
});

// ── Edge coloring keys off `leg` (M4.2 / row q) ─────────────────────────────
// Two-echelon edges carry a `leg` field; the map must style mine→refinery
// edges green (#16A34A) and refinery→customer edges red (#DC2626). When an
// edge has NO leg (every single-echelon model), the map must fall back to
// the band-color behavior unchanged. NetworkMap passes the resolved color
// to react-leaflet's <Polyline pathOptions={{color}}>; under jsdom react-leaflet
// serializes that into a stroke attribute on the rendered <path>, which is
// readable from container.innerHTML — same assertion style the multi-select
// ring test above uses.
describe("NetworkMap edge coloring by leg (M4.2)", () => {
  it("renders a mine_to_refinery edge green and a refinery_to_customer edge red", () => {
    // NetworkMap resolves each edge's endpoints as fromId→warehouse and
    // toId→customer, so a two-echelon refinery node must appear in BOTH
    // arrays (it is the `toId` of the mine→refinery leg and the `fromId`
    // of the refinery→customer leg) for both polylines to render.
    const twoEchelonDataset = {
      warehouses: [
        { id: "kalgoorlie", city: "Kalgoorlie", state: "WA", lat: -30.75, lng: 121.47 },
        { id: "cunnamulla", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68 },
      ],
      customers: [
        { id: "cunnamulla", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68, demand: 1000 },
        { id: "sydney", city: "Sydney", state: "NSW", lat: -33.87, lng: 151.21, demand: 740000 },
      ],
    };
    const result = {
      status: "optimal" as const,
      objective: 386577,
      runTimeSec: 0.1,
      quality: "Optimal",
      edges: [
        { fromId: "kalgoorlie", toId: "cunnamulla", flow: 8140000, distance: 1465, leg: "mine_to_refinery" as const },
        { fromId: "cunnamulla", toId: "sydney", flow: 740000, distance: 1000, leg: "refinery_to_customer" as const },
      ],
      metrics: { weightedAvgDistance: 1100, bandCoverage: [], utilizationByNode: [] },
      details: { openWarehouseIds: ["cunnamulla"], assignments: [] },
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: null,
    };
    const { container } = render(
      <NetworkMap
        dataset={twoEchelonDataset}
        warehouseStatuses={[]}
        result={result}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000, 2600]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    // Isolate the route-pane SVG so the assertion reflects the polylines'
    // strokes, not the band-legend swatches (which always paint Band 1 =
    // #16A34A and, with 5 bands, Band 5 = #DC2626 regardless of edges).
    const routeSvg = container.querySelector(".leaflet-route-pane svg");
    const routeHtml = routeSvg?.innerHTML ?? "";
    // mine→refinery leg = green (#16A34A), refinery→customer leg = red (#DC2626).
    expect(routeHtml).toContain("#16A34A");
    expect(routeHtml).toContain("#DC2626");
  });

  it("falls back to band coloring for an edge with no leg field (single-echelon models)", () => {
    // An edge with no `leg` must resolve to getBandColor(assignBand(distance,
    // bands)) — never to the leg colors. With bands=[500,1000,1500,2000] and a
    // 900mi edge, assignBand returns the index of the first boundary the
    // distance fits under (1000 → index 1) → getBandColor(1). Asserting the
    // polyline carries the band color AND that it carries NEITHER leg color
    // proves the fallback path, not just "some color was set".
    const singleEchelonDataset = {
      warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
      customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 41, lng: -91, demand: 5000 }],
    };
    const result = {
      status: "optimal" as const,
      objective: 1,
      runTimeSec: 0.1,
      quality: "Optimal",
      edges: [{ fromId: "W1", toId: "C1", flow: 50, distance: 900 }],  // no leg field
      metrics: { weightedAvgDistance: 900, bandCoverage: [], utilizationByNode: [] },
      details: { openWarehouseIds: ["W1"], assignments: [] },
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: null,
    };
    const { container } = render(
      <NetworkMap
        dataset={singleEchelonDataset}
        warehouseStatuses={[]}
        result={result}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    // Isolate the route-pane SVG: the legend swatches in the results overlay
    // always paint Band 1 (#16A34A) regardless of the edges, so asserting
    // against container.innerHTML would conflate the legend with the polyline.
    // The route pane holds only the rendered <Polyline> strokes.
    const routeSvg = container.querySelector(".leaflet-route-pane svg");
    const routeHtml = routeSvg?.innerHTML ?? "";
    const fullHtml = container.innerHTML;
    // getBandColor(1) is the band palette color NetworkMap resolves for a
    // 900mi edge under [500,1000,1500,2000] — read it from the same source
    // the component uses, then assert it appears on the rendered polyline.
    const bandColor = getBandColor(1);
    expect(routeHtml.toLowerCase()).toContain(bandColor.toLowerCase());
    // Must NOT have keyed off a leg: the route polyline must carry NEITHER
    // leg color. (Checked on the route pane only — the legend always shows
    // #16A34A as Band 1, which is unrelated to the polyline's leg.)
    expect(routeHtml).not.toContain("#16A34A");
    expect(routeHtml).not.toContain("#DC2626");
    // Sanity: the full DOM still renders the band legend.
    expect(fullHtml).toContain("#16A34A");
  });
});
