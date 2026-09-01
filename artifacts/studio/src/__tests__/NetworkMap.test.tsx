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

    // One customer + one warehouse -> two Tooltips, regardless of solve/open
    // state (a warehouse's Tooltip used to be gated on isOpen, so an
    // unsolved/"potential" candidate — most markers, especially pre-solve —
    // showed nothing on hover at all).
    expect(tooltipChildren).toHaveLength(2);
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    const customerText = texts.find((t) => t.includes("Sampleburg"));
    const warehouseText = texts.find((t) => t.includes("Testville"));
    expect(customerText).toContain("Sampleburg, SB");
    expect(customerText).toContain("5,000");
    expect(warehouseText).toContain("W1");
    expect(warehouseText).toContain("Testville, TS");
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

  // Regression: the legend had no entry explaining the star icon, and the
  // mine's Tooltip never rendered (gated on isOpen, which is never true for
  // a mine — it's a fixed source, not a facility-location choice the solver
  // ever puts in openWarehouseIds).
  it("shows a 'Mine (fixed)' legend entry when the dataset has a mine, and gives the mine its own hover tooltip", () => {
    const mineDataset = {
      warehouses: [{ id: "M1", city: "Kalgoorlie", state: "WA", lat: -30.75, lng: 121.47, kind: "mine" as const }],
      customers: [],
    };
    const tooltipCountBefore = tooltipChildren.length;
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
    expect(container.textContent).toContain("Mine (fixed)");
    // The mine's own Tooltip (gated on isOpen before this fix — a mine is
    // never in openWarehouseIds, so it never rendered one at all).
    expect(tooltipChildren.length).toBe(tooltipCountBefore + 1);
    const { container: tooltipContainer } = render(<>{tooltipChildren[tooltipChildren.length - 1]}</>);
    expect(tooltipContainer.textContent).toContain("M1");
    expect(tooltipContainer.textContent).toContain("Kalgoorlie, WA");
    expect(tooltipContainer.textContent).toContain("(mine)");
  });

  it("does NOT show a 'Mine (fixed)' legend entry for models with no mine", () => {
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
    expect(container.textContent).not.toContain("Mine (fixed)");
  });
});

// ── Map bounds fix: resolving countryBounds after initial mount ────────────
// Regression test for: Chapter 10 (Australia-bounded) showing the continental
// US map. react-leaflet's MapContainer applies center/maxBounds/minZoom only
// at construction — they're not reactive. GET /api/models (source of
// countryBounds) and GET /dataset are independent queries with no guaranteed
// ordering, so NetworkMap can mount before countryBounds resolves, baking
// FALLBACK_BOUNDS (continental US) into an immutable Leaflet maxBounds that a
// later FitBounds() call can't override (maxBoundsViscosity=1.0 clamps the
// view back to the stale bounds). The fix keys <MapContainer> on the
// resolved bounds so React fully remounts it once real bounds arrive.
describe("NetworkMap remounts on countryBounds resolution", () => {
  it("replaces the Leaflet map DOM node when countryBounds changes from undefined to a real value", () => {
    const { container, rerender } = render(
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
    const firstMapNode = container.querySelector(".leaflet-container");
    expect(firstMapNode).not.toBeNull();

    rerender(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        countryBounds={{ sw: [-38.5, 113.0], ne: [-16.0, 154.5] }}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const secondMapNode = container.querySelector(".leaflet-container");
    expect(secondMapNode).not.toBeNull();
    // A genuinely new Leaflet instance was mounted (not just re-propped) —
    // this is what actually applies the real maxBounds, unlike a plain
    // prop update to an already-mounted MapContainer.
    expect(secondMapNode).not.toBe(firstMapNode);
  });

  it("does NOT remount when countryBounds is unchanged across renders", () => {
    const bounds = { sw: [-38.5, 113.0], ne: [-16.0, 154.5] };
    const { container, rerender } = render(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        countryBounds={bounds}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const firstMapNode = container.querySelector(".leaflet-container");

    // Re-render with a new object reference but the same values, plus an
    // unrelated prop change (showRoutes) — should NOT remount the map.
    rerender(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        countryBounds={{ sw: [-38.5, 113.0], ne: [-16.0, 154.5] }}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const secondMapNode = container.querySelector(".leaflet-container");
    expect(secondMapNode).toBe(firstMapNode);
  });
});

// ── T6/R7 — hideClosedWarehouses (Output Map only) ─────────────────────────
describe("NetworkMap hideClosedWarehouses", () => {
  const twoWarehouseDataset = {
    warehouses: [
      { id: "W1", city: "Opened", state: "TS", lat: 40, lng: -90 },
      { id: "W2", city: "Closed", state: "TS", lat: 41, lng: -91 },
    ],
    customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 40.5, lng: -90.5, demand: 100 }],
  };
  const resultOpensW1 = {
    status: "optimal" as const,
    objective: 1,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [{ fromId: "W1", toId: "C1", flow: 100, distance: 50 }],
    metrics: { weightedAvgDistance: 50, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["W1"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("renders only the opened warehouse's marker when hideClosedWarehouses is true", () => {
    const { container } = render(
      <NetworkMap
        dataset={twoWarehouseDataset}
        warehouseStatuses={[]}
        result={resultOpensW1}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        hideClosedWarehouses
      />,
    );
    expect(container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon")).toHaveLength(1);
    expect(container.textContent).not.toContain("Closed");
  });

  it("renders BOTH warehouses' markers when hideClosedWarehouses is false (default) — unchanged legacy behavior", () => {
    const { container } = render(
      <NetworkMap
        dataset={twoWarehouseDataset}
        warehouseStatuses={[]}
        result={resultOpensW1}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    expect(container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon")).toHaveLength(2);
  });

  it("still renders the opened warehouse's route and the (unaffected) customer marker when hideClosedWarehouses is true", () => {
    const { container } = render(
      <NetworkMap
        dataset={twoWarehouseDataset}
        warehouseStatuses={[]}
        result={resultOpensW1}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        hideClosedWarehouses
      />,
    );
    const routeHtml = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    expect((routeHtml.match(/<path/g) ?? []).length).toBe(1);
    expect(container.querySelectorAll(".leaflet-overlay-pane path.leaflet-interactive")).toHaveLength(1);
  });

  // R7 (Bundle 2, Task T4) — a fixed mine (kind: "mine") is retained
  // regardless of open/closed status; a genuinely closed candidate (a
  // refinery here, standing in for any non-mine warehouse-role row) is
  // still hidden exactly as before.
  it("retains a fixed mine's marker even when hideClosedWarehouses is true and the mine is not open, while still hiding a genuinely closed warehouse", () => {
    const mineDataset = {
      warehouses: [
        { id: "MINE1", city: "Kalgoorlie", state: "WA", lat: -30.75, lng: 121.47, kind: "mine" as const },
        { id: "W2", city: "Closed", state: "TS", lat: 41, lng: -91 },
      ],
      customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 40.5, lng: -90.5, demand: 100 }],
    };
    const resultNoOpens = {
      status: "optimal" as const,
      objective: 1,
      runTimeSec: 0.1,
      quality: "Optimal",
      edges: [],
      metrics: { weightedAvgDistance: 0, bandCoverage: [], utilizationByNode: [] },
      details: { openWarehouseIds: [], assignments: [] },
      solverUsed: "CBC (PuLP)",
      infeasibilityReason: null,
    };
    const { container } = render(
      <NetworkMap
        dataset={mineDataset}
        warehouseStatuses={[]}
        result={resultNoOpens}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        hideClosedWarehouses
      />,
    );
    // Exactly the mine's marker survives — the closed W2 candidate is
    // filtered out entirely (its Tooltip content, mocked elsewhere in this
    // file via `tooltipChildren`, never even mounts for a filtered-out
    // marker, so a count of 1 is the real assertion here, not text content).
    expect(container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon")).toHaveLength(1);
    expect(container.textContent).not.toContain("Closed");
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
    // A mine_to_refinery edge's toId is the refinery — a warehouse-role
    // entity — so the refinery is duplicated into `customers` here too, to
    // exercise the fromId/toId resolution regardless of which array it
    // happens to also be findable in. The real-shape regression (refinery
    // present ONLY in `warehouses`, not duplicated into `customers`) is
    // covered separately below — that's the case that actually caught the
    // bug (dataset.customers.find() always failed for a mine_to_refinery
    // edge's toId, silently dropping the polyline).
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

  // Regression: the real two-echelon-gold-au dataset does NOT duplicate the
  // refinery id into `customers` — mines and refineries live only in
  // `warehouses`. A mine_to_refinery edge's toId (the refinery) resolved
  // via dataset.customers.find(), which always returned undefined for this
  // shape, silently dropping the mine→refinery polyline from the map (it
  // never appeared at all, not even in a wrong color).
  it("renders the mine→refinery route even when the refinery is NOT duplicated into dataset.customers (the real dataset shape)", () => {
    const realShapeDataset = {
      warehouses: [
        { id: "kalgoorlie", city: "Kalgoorlie", state: "WA", lat: -30.75, lng: 121.47, kind: "mine" as const },
        { id: "cunnamulla", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68, kind: "facility" as const },
      ],
      customers: [
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
        dataset={realShapeDataset}
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
    const routeSvg = container.querySelector(".leaflet-route-pane svg");
    const routeHtml = routeSvg?.innerHTML ?? "";
    // Both edges must render — previously only the refinery_to_customer
    // (red) line appeared; the mine_to_refinery (green) line was silently
    // dropped.
    expect(routeHtml).toContain("#16A34A");
    expect(routeHtml).toContain("#DC2626");
    // A real <path> element per edge (not just a color mentioned somewhere
    // else, e.g. the legend) — exactly 2 route polylines.
    const pathCount = (routeHtml.match(/<path/g) ?? []).length;
    expect(pathCount).toBe(2);
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
