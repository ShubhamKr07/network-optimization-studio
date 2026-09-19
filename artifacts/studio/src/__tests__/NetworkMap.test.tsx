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
// B2.2-T4 (A4) — full props per Tooltip render, so route-hover-tooltip tests
// can assert `opacity`/`className` (translucent, pointer-events-none)
// alongside content, not just content the way the pre-existing marker-hover
// tests above do.
const tooltipCalls: { props: Record<string, unknown>; children: React.ReactNode }[] = [];
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
    Tooltip: (props: { children?: React.ReactNode } & Record<string, unknown>) => {
      if (props.children) tooltipChildren.push(props.children);
      tooltipCalls.push({ props, children: props.children });
      return null;
    },
    MapContainer: (props: React.ComponentProps<typeof RealMapContainer>) => {
      const { children, ...rest } = props;
      mapContainerProps.push(rest);
      return <RealMapContainer {...props}>{children}</RealMapContainer>;
    },
  };
});

const { NetworkMap, buildCustomerPopupHtml } = await import("@/components/NetworkMap");
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
    // The multi-select ring uses a distinct stroke token (--map-ring-multiselect,
    // violet) from the existing single-select highlight ring
    // (--map-ring-select, amber) so a student can tell the two selection
    // modes apart at a glance.
    expect(container.innerHTML).toContain("var(--map-ring-multiselect)");
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

// ── Map bounds: resolving countryBounds after initial mount ────────────────
// Regression test for: Chapter 10 (Australia-bounded) showing the continental
// US map. react-leaflet's MapContainer applies center/maxBounds/minZoom only
// at construction — they're not reactive. GET /api/models (source of
// countryBounds) and GET /dataset are independent queries with no guaranteed
// ordering, so NetworkMap can mount before countryBounds resolves, baking
// FALLBACK_BOUNDS (continental US) into an immutable Leaflet maxBounds that a
// later FitBounds() call can't override (maxBoundsViscosity=1.0 clamps the
// view back to the stale bounds). The fix keys <MapContainer> on the
// resolved bounds so React fully remounts it once real bounds arrive.
//
// jade-B1 (#2, spec §3 "Bounds constraint") — bounds now derive PRIMARILY
// from the union of rendered marker coordinates (Tier 1), which are already
// present at first mount for every real caller (dataset is a required prop),
// so the original two-query race is structurally moot whenever there are
// >=2 real marker coords: the map is correctly bounded on the very first
// mount, no remount needed. countryBounds only matters as the LAST-resort
// Tier-3 fallback (spec's degenerate-bounds guard) — exercised below with a
// single-total-entity dataset, where both Tier 1 and Tier 2 are degenerate.
describe("NetworkMap remounts on bounds resolution (jade-B1 union-bounds)", () => {
  const singleEntityDataset = {
    warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
    customers: [],
  };

  it("replaces the Leaflet map DOM node when a degenerate dataset's manifest countryBounds changes from undefined to a real value (Tier-3 fallback)", () => {
    const { container, rerender } = render(
      <NetworkMap
        dataset={singleEntityDataset}
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
        dataset={singleEntityDataset}
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

  it("does NOT remount when countryBounds is unchanged across renders (2+ real marker coords already determine the union)", () => {
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

  it("does NOT remount when an unrelated layer toggle changes but the rendered-marker union stays the same (>=2 coords both times)", () => {
    // dataset (module-level, top of file) has 1 warehouse + 1 customer —
    // toggling showCustomerMarkers off would drop below 2 rendered coords
    // and correctly trigger the degenerate-guard fallback (a real bounds
    // CHANGE, tested separately below); toggling something that does NOT
    // affect the rendered union (hideClosedWarehouses, with no result so
    // isOpen is always false and there's no mine) must not remount.
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
    rerender(
      <NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
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
// edges green (var(--map-warehouse-open)) and refinery→customer edges red
// (var(--danger)). When an edge has NO leg (every single-echelon model), the map must fall back to
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
        // jade-B1 (#1 leg-vs-band coloring resolution) — bands=[] is the
        // shared "Color lanes: Distance band" OFF signal (same encoding
        // OutputMapTab already uses for the "Plain" lane mode): leg colors
        // win only when bands is empty. Non-empty bands now means BAND
        // colors win even for a two-echelon edge — asserted in its own
        // dedicated describe block below.
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    // Isolate the route-pane SVG so the assertion reflects the polylines'
    // strokes, not the band-legend swatches.
    const routeSvg = container.querySelector(".leaflet-route-pane svg");
    const routeHtml = routeSvg?.innerHTML ?? "";
    // mine→refinery leg = var(--map-warehouse-open), refinery→customer leg = var(--danger).
    expect(routeHtml).toContain("var(--map-warehouse-open)");
    expect(routeHtml).toContain("var(--danger)");
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
        // bands=[] -> "Color lanes: Distance band" OFF -> leg colors (see
        // the comment on the sibling test above).
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const routeSvg = container.querySelector(".leaflet-route-pane svg");
    const routeHtml = routeSvg?.innerHTML ?? "";
    // Both edges must render — previously only the refinery_to_customer
    // (var(--danger)) line appeared; the mine_to_refinery
    // (var(--map-warehouse-open)) line was silently dropped.
    expect(routeHtml).toContain("var(--map-warehouse-open)");
    expect(routeHtml).toContain("var(--danger)");
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
    // always paint Band 1 (getBandColor(0)) regardless of the edges, so
    // asserting against container.innerHTML would conflate the legend with
    // the polyline. The route pane holds only the rendered <Polyline> strokes.
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
    // getBandColor(0) as Band 1, which is unrelated to the polyline's leg.)
    expect(routeHtml).not.toContain("var(--map-warehouse-open)");
    expect(routeHtml).not.toContain("var(--danger)");
    // Sanity: the full DOM still renders the band legend.
    expect(fullHtml).toContain(getBandColor(0));
  });
});

// ── jade-T13 — JADE's two legs (plant_to_warehouse / warehouse_to_customer),
// leg layer toggles, unknown-leg neutral fallback, and per-product inbound
// edge coalescing ───────────────────────────────────────────────────────────
describe("NetworkMap JADE leg coloring + layer toggles (jade-T13)", () => {
  const jadeDataset = {
    // "warehouses" doubles as the generic facility array — plants and
    // JADE's actual warehouses are both facility-role entities as far as
    // NetworkMap's route lookup (dataset.warehouses.find) is concerned,
    // mirroring how two-echelon-gold-au's mine/refinery share `warehouses`.
    warehouses: [
      { id: "plant-1", city: "Springfield", state: "IL", lat: 39.78, lng: -89.65 },
      { id: "wh-11", city: "Phoenix", state: "AZ", lat: 33.45, lng: -112.07 },
      { id: "wh-14", city: "New York", state: "NY", lat: 40.71, lng: -74.01 },
    ],
    customers: [
      { id: "customer-1", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8, demand: 500 },
    ],
  };

  const jadeResult = {
    status: "optimal" as const,
    objective: 254060828.6157,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [
      { fromId: "plant-1", toId: "wh-11", flow: 100, distance: 1500, leg: "plant_to_warehouse" as const, productId: "product-1" },
      { fromId: "wh-11", toId: "customer-1", flow: 500, distance: 900, leg: "warehouse_to_customer" as const },
    ],
    metrics: { weightedAvgDistance: 1000, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["wh-11"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("renders plant_to_warehouse (inbound) and warehouse_to_customer (outbound) with distinct colors", () => {
    const { container } = render(
      <NetworkMap
        dataset={jadeDataset}
        warehouseStatuses={[]}
        result={jadeResult}
        showRoutes={true}
        // jade-B1 (#1 leg-vs-band coloring resolution) — bands=[] is the
        // "Color lanes: Distance band" OFF signal, so leg colors win here;
        // the ON case (non-empty bands -> band colors win even for a
        // two-echelon edge) is asserted in its own describe block below.
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const routeSvg = container.querySelector(".leaflet-route-pane svg");
    const routeHtml = routeSvg?.innerHTML ?? "";
    // Inbound (plant_to_warehouse) shares mine_to_refinery's color; outbound
    // (warehouse_to_customer) shares refinery_to_customer's color — same
    // semantic-role classification, distinct from each other.
    expect(routeHtml).toContain("var(--map-warehouse-open)");
    expect(routeHtml).toContain("var(--danger)");
  });

  it("toggling a leg layer off hides only that leg's routes (visibleLegs prop)", () => {
    const { container: inboundOnly } = render(
      <NetworkMap
        dataset={jadeDataset}
        warehouseStatuses={[]}
        result={jadeResult}
        showRoutes={true}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        visibleLegs={["plant_to_warehouse"]}
      />,
    );
    const inboundHtml = inboundOnly.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    expect(inboundHtml).toContain("var(--map-warehouse-open)");
    expect(inboundHtml).not.toContain("var(--danger)");

    const { container: outboundOnly } = render(
      <NetworkMap
        dataset={jadeDataset}
        warehouseStatuses={[]}
        result={jadeResult}
        showRoutes={true}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        visibleLegs={["warehouse_to_customer"]}
      />,
    );
    const outboundHtml = outboundOnly.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    expect(outboundHtml).toContain("var(--danger)");
    expect(outboundHtml).not.toContain("var(--map-warehouse-open)");
  });

  it("renders an unknown leg value with the neutral fallback color, never throws", () => {
    // An unrecognized leg value follows the "usual" facility->demand shape
    // (fromId=warehouse, toId=customer) — a genuinely unknown/future leg has
    // no known role semantics to special-case an inbound-style lookup for,
    // so this exercises exactly the entity-lookup path every single-echelon
    // model already uses, plus the neutral fallback color.
    const unknownLegResult = {
      ...jadeResult,
      edges: [
        { fromId: "wh-11", toId: "customer-1", flow: 100, distance: 900, leg: "some_future_leg" as unknown as "plant_to_warehouse" },
      ],
    };
    let container: HTMLElement;
    expect(() => {
      ({ container } = render(
        <NetworkMap
          dataset={jadeDataset}
          warehouseStatuses={[]}
          result={unknownLegResult}
          showRoutes={true}
          bands={[]}
          multiSelectedWarehouseIds={[]}
          multiSelectedCustomerIds={[]}
          onToggleWarehouseMultiSelect={() => {}}
          onToggleCustomerMultiSelect={() => {}}
        />,
      ));
    }).not.toThrow();
    const routeHtml = container!.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    expect(routeHtml).toContain("var(--map-default-stroke)");
    expect(routeHtml).not.toContain("var(--map-warehouse-open)");
    expect(routeHtml).not.toContain("var(--danger)");
  });

  it("coalesces per-product inbound edges sharing (leg,fromId,toId) into a single line with summed flow", () => {
    const multiProductResult = {
      ...jadeResult,
      edges: [
        { fromId: "plant-1", toId: "wh-11", flow: 100, distance: 1500, leg: "plant_to_warehouse" as const, productId: "product-1" },
        { fromId: "plant-1", toId: "wh-11", flow: 250, distance: 1500, leg: "plant_to_warehouse" as const, productId: "product-2" },
        { fromId: "wh-11", toId: "customer-1", flow: 500, distance: 900, leg: "warehouse_to_customer" as const },
      ],
    };
    const { container } = render(
      <NetworkMap
        dataset={jadeDataset}
        warehouseStatuses={[]}
        result={multiProductResult}
        showRoutes={true}
        bands={[200, 400, 800, 1600]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const routeSvg = container.querySelector(".leaflet-route-pane svg");
    const routeHtml = routeSvg?.innerHTML ?? "";
    // Two distinct (leg,fromId,toId) groups exist here: the two
    // plant-1->wh-11 product edges collapse into ONE line, plus the one
    // wh-11->customer-1 line — 2 <path> elements total, not 3.
    const pathCount = (routeHtml.match(/<path/g) ?? []).length;
    expect(pathCount).toBe(2);
  });
});

// ── B2.2-T4 (A4) — route hover tooltip, model-unit-aware ────────────────────
describe("NetworkMap route hover tooltip (A4)", () => {
  const routeDataset = {
    warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
    customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 41, lng: -91, demand: 5000 }],
  };
  const routeResult = {
    status: "optimal" as const,
    objective: 1,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [{ fromId: "W1", toId: "C1", flow: 5000, distance: 123 }],
    metrics: { weightedAvgDistance: 123, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["W1"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("renders a translucent, pointer-events-none Tooltip on the route polyline with cities + distance in the model's unit (default mi)", () => {
    tooltipCalls.length = 0;
    render(
      <NetworkMap
        dataset={routeDataset}
        warehouseStatuses={[]}
        result={routeResult}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );

    const routeTooltip = tooltipCalls.find((c) => {
      const { container } = render(<>{c.children}</>);
      return container.textContent?.includes("Testville") && container.textContent?.includes("Sampleburg");
    });
    expect(routeTooltip).toBeDefined();
    // translucent (opacity < 1) and pointer-events-none, distinct from the
    // fully-opaque marker Tooltips (opacity={1}) elsewhere in this file.
    expect(routeTooltip!.props.opacity).toBeLessThan(1);
    expect(routeTooltip!.props.className).toContain("pointer-events-none");

    const { container: tooltipContainer } = render(<>{routeTooltip!.children}</>);
    expect(tooltipContainer.textContent).toContain("Testville");
    expect(tooltipContainer.textContent).toContain("Sampleburg");
    expect(tooltipContainer.textContent).toContain("Testville → Sampleburg");
    expect(tooltipContainer.textContent).toContain("123 mi");
  });

  it("renders the route tooltip in a non-mi model unit (e.g. km), never hardcoding mi", () => {
    tooltipCalls.length = 0;
    render(
      <NetworkMap
        dataset={routeDataset}
        warehouseStatuses={[]}
        result={routeResult}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        distanceUnit="km"
      />,
    );

    const routeTooltip = tooltipCalls.find((c) => {
      const { container } = render(<>{c.children}</>);
      return container.textContent?.includes("Testville") && container.textContent?.includes("Sampleburg");
    });
    expect(routeTooltip).toBeDefined();
    const { container: tooltipContainer } = render(<>{routeTooltip!.children}</>);
    expect(tooltipContainer.textContent).toContain("123 km");
    expect(tooltipContainer.textContent).not.toContain("123 mi");
  });

  it("does NOT change the click-based CustomerPopup content or behavior", () => {
    const { container } = render(
      <NetworkMap
        dataset={routeDataset}
        warehouseStatuses={[]}
        result={routeResult}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        distanceUnit="km"
      />,
    );
    const customerMarker = container.querySelector(".leaflet-interactive");
    expect(customerMarker).not.toBeNull();
    fireEvent.click(customerMarker!);
    // Popup click path is unaffected by the new hover Tooltip — it still
    // opens via Leaflet's imperative L.popup() API (asserted elsewhere by
    // this being reachable without throwing); no snapshot of popup markup
    // needed here since CustomerPopup itself was not touched by this task.
    expect(container).toBeDefined();
  });

  // C4.11 — CustomerPopup's distance line follows the active model's unit.
  // The popup markup is built by the pure, exported buildCustomerPopupHtml so
  // the unit is verifiable without driving Leaflet's imperative L.popup()
  // through jsdom.
  const popupInfo = {
    lat: 41, lng: -91,
    customerCity: "Sampleburg", customerState: "SB",
    warehouseCity: "Testville", warehouseState: "TS",
    distanceMi: 1234, band: 0, bandLabelText: "Band 1",
  };

  it("buildCustomerPopupHtml renders the distance in mi by default", () => {
    const html = buildCustomerPopupHtml(popupInfo);
    expect(html).toContain("1,234 mi");
  });

  it("buildCustomerPopupHtml renders the distance in km (never mi) for a Chen scenario", () => {
    const html = buildCustomerPopupHtml(popupInfo, "km");
    expect(html).toContain("1,234 km");
    expect(html).not.toContain("1,234 mi");
    expect(html).not.toMatch(/\bmi<\/strong>/);
  });
});

// ── Bundle 6.1 (T1) — shared MapLegend, Output variant ──────────────────────
// NetworkMap now renders the shared <MapLegend variant="output" corner="br">
// in place of its old inline legend block. These tests cover the resolutions
// the plan review called out: #7 (Output shows "Open", never a separate
// "Forced Open" entry, and the marker→legend mapping matches getStatus),
// #3 (the layer toggles gate their own legend entries independently), and
// #5 (route-band swatches use getBandColor, which doesn't clamp the SWATCH
// COUNT — only the color — past 5 bands).
describe("NetworkMap Output legend (Bundle 6.1 T1)", () => {
  const legendDataset = {
    warehouses: [
      { id: "W1", city: "Forced", state: "TS", lat: 40, lng: -90 },
      { id: "W2", city: "Potential", state: "TS", lat: 41, lng: -91 },
    ],
    customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 40.5, lng: -90.5, demand: 5000 }],
  };
  // W1 is forced_open in warehouseStatuses AND is the warehouse the solver
  // actually opened (in openWarehouseIds) — exactly the case getStatus
  // resolves to "open" for a forced-open facility in a solved result.
  const forcedOpenResult = {
    status: "optimal" as const,
    objective: 1,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [{ fromId: "W1", toId: "C1", flow: 5000, distance: 50 }],
    metrics: { weightedAvgDistance: 50, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["W1"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("shows 'Open' (not a separate 'Forced Open' entry) for a solved result with a forced-open facility — the marker→legend mapping matches getStatus", () => {
    const { container, getByTestId } = render(
      <NetworkMap
        dataset={legendDataset}
        warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
        result={forcedOpenResult}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const legend = getByTestId("map-legend");
    expect(legend.textContent).toContain("Open");
    expect(legend.textContent).not.toContain("Forced Open");
    expect(legend.textContent).not.toContain("Fixed-Open");
    // W1's rendered marker actually resolves to the "open" fill (getStatus:
    // result present + W1 in openWarehouseIds -> "open"), matching the
    // legend's single "Open" entry — not a distinct forced-open state.
    const markerSvg = container.querySelector(".leaflet-marker-pane .leaflet-marker-icon")?.innerHTML ?? "";
    expect(markerSvg).toContain("var(--map-warehouse-open)");
  });

  it("shows a Mine entry when the dataset has a mine (parity with the pre-existing 'Mine (fixed)' behavior)", () => {
    const mineDataset = {
      warehouses: [{ id: "M1", city: "Kalgoorlie", state: "WA", lat: -30.75, lng: 121.47, kind: "mine" as const }],
      customers: [],
    };
    const { getByTestId } = render(
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
    expect(getByTestId("legend-output-mine")).toBeInTheDocument();
    expect(getByTestId("map-legend").textContent).toContain("Mine (fixed)");
  });

  it("hides the facility/mine legend entries (but not Customer) when showWarehouseMarkers is false", () => {
    const { getByTestId, queryByText, getByText } = render(
      <NetworkMap
        dataset={legendDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        showWarehouseMarkers={false}
      />,
    );
    const legend = getByTestId("map-legend");
    expect(legend.textContent).not.toContain("Potential");
    expect(legend.textContent).not.toContain("Open");
    expect(getByText("Customer")).toBeInTheDocument();
    expect(queryByText("Mine (fixed)")).not.toBeInTheDocument();
  });

  it("hides the Customer legend entry (but not facility entries) when showCustomerMarkers is false", () => {
    const { getByTestId } = render(
      <NetworkMap
        dataset={legendDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        showCustomerMarkers={false}
      />,
    );
    const legend = getByTestId("map-legend");
    expect(legend.textContent).toContain("Potential");
    expect(legend.textContent).not.toContain("Customer");
  });

  it("renders exactly one route-band swatch per band, even past the 5-entry BAND_COLORS palette (6 bands)", () => {
    const sixBands = [500, 1000, 1500, 2000, 2500, 3000];
    const { container } = render(
      <NetworkMap
        dataset={legendDataset}
        warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
        result={forcedOpenResult}
        showRoutes={true}
        bands={sixBands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const legend = container.querySelector('[data-testid="map-legend"]')!;
    const swatches = legend.querySelectorAll('[data-testid^="legend-band-"]');
    expect(swatches.length).toBe(6);
    // Labeled by upper bound, not the old ordinal "Band N" — default unit
    // "mi" since this render doesn't pass distanceUnit.
    expect(legend.textContent).toContain("≤ 3000 mi");
  });
});

// ── C4.14 (D14) — Chen two-class coverage lens ──────────────────────────────
// Chen's Cosmetics passes distanceBands = [highServiceDistKm, maxDistKm] (D13),
// so the SHARED band-coloring path already produces exactly a two-class lens:
// a warehouse→customer route with distance ≤ high sits in band 0 (covered,
// getBandColor(0)), and one with high < distance ≤ max sits in band 1
// (uncovered, getBandColor(1)) — computed CLIENT-SIDE from result.edges, no
// re-solve. This also proves Chen does NOT gain the two-echelon/JADE leg
// coloring (Chen edges carry no `leg`), the coal/gold-specific branch a
// Gate-1 mapped audit must confirm Chen was NOT added to.
describe("NetworkMap Chen two-class coverage lens (C4.14)", () => {
  const chenDataset = {
    warehouses: [
      { id: "wh-23", city: "Chengdu", state: "", lat: 30.67, lng: 104.07 },
      { id: "wh-15", city: "Changchun", state: "", lat: 43.87, lng: 125.35 },
    ],
    customers: [
      { id: "cs-near", city: "Nearby", state: "", lat: 30.9, lng: 104.3, demand: 1000 },
      { id: "cs-far", city: "Faraway", state: "", lat: 41.15, lng: 80.25, demand: 2000 },
    ],
  };
  // Two-class bands: [high=600, max=5000].
  const chenBands = [600, 5000];
  const chenResult = {
    status: "optimal" as const,
    objective: 66.67,
    runTimeSec: 0.3,
    quality: "optimal",
    edges: [
      // distance 400 <= 600  -> covered   -> band 0 -> getBandColor(0)
      { fromId: "wh-23", toId: "cs-near", flow: 1000, distance: 400 },
      // 600 < 2544 <= 5000   -> uncovered -> band 1 -> getBandColor(1)
      { fromId: "wh-15", toId: "cs-far", flow: 2000, distance: 2544 },
    ],
    metrics: {
      weightedAvgDistance: 1500,
      bandCoverage: [{ band: 600, percent: 33 }, { band: 5000, percent: 100 }],
      utilizationByNode: [],
    },
    details: { objective: "coverage", openWarehouseIds: ["wh-23", "wh-15"] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("colors a ≤high route as covered (band 0) and a high<d≤max route as uncovered (band 1), client-side", () => {
    const { container } = render(
      <NetworkMap
        dataset={chenDataset}
        warehouseStatuses={[]}
        result={chenResult}
        showRoutes={true}
        bands={chenBands}
        countryBounds={{ sw: [18, 73.9], ne: [49.4, 133] }}
        distanceUnit="km"
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const routeHtml = (container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "").toLowerCase();
    const covered = getBandColor(0).toLowerCase();
    const uncovered = getBandColor(1).toLowerCase();
    expect(covered).not.toBe(uncovered);
    expect(routeHtml).toContain(covered);
    expect(routeHtml).toContain(uncovered);
    // Exactly two route polylines rendered.
    expect((routeHtml.match(/<path/g) ?? []).length).toBe(2);
  });

  it("does NOT gain the coal/gold/JADE leg coloring — Chen edges carry no `leg`", () => {
    const { container } = render(
      <NetworkMap
        dataset={chenDataset}
        warehouseStatuses={[]}
        result={chenResult}
        showRoutes={true}
        bands={chenBands}
        distanceUnit="km"
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const routeHtml = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    // Leg colors (two-echelon inbound/outbound) must be absent on Chen routes.
    expect(routeHtml).not.toContain("var(--map-warehouse-open)");
    expect(routeHtml).not.toContain("var(--danger)");
  });
});

// ── jade-B1 (#1 all-site overflow) — overflow consistent across lane,
// customer highlight, popup, and tooltip for a single overflow customer;
// on-boundary still resolves to the real band, not overflow ────────────────
describe("NetworkMap all-site overflow consistency (jade-B1 #1)", () => {
  const overflowDataset = {
    warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
    customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 41, lng: -91, demand: 5000 }],
  };
  const bands = [500, 1000, 1500, 2000];
  const overflowDistance = 2500; // beyond every boundary in `bands`
  const overflowResult = {
    status: "optimal" as const,
    objective: 1,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [{ fromId: "W1", toId: "C1", flow: 5000, distance: overflowDistance }],
    metrics: { weightedAvgDistance: overflowDistance, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["W1"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("colors the lane with the distinct overflow color, not the last band's color", () => {
    const { container } = render(
      <NetworkMap
        dataset={overflowDataset}
        warehouseStatuses={[]}
        result={overflowResult}
        showRoutes={true}
        bands={bands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const routeHtml = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    expect(routeHtml.toLowerCase()).toContain(getBandColor(-1).toLowerCase());
    // NOT the last real band's color (the old folding behavior).
    expect(routeHtml.toLowerCase()).not.toContain(getBandColor(3).toLowerCase());
  });

  it("reads 'Overflow' (not a Band N label) in the customer hover tooltip", () => {
    tooltipChildren.length = 0;
    render(
      <NetworkMap
        dataset={overflowDataset}
        warehouseStatuses={[]}
        result={overflowResult}
        showRoutes={true}
        bands={bands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const customerTooltip = tooltipChildren.find((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent?.includes("Sampleburg");
    });
    expect(customerTooltip).toBeDefined();
    const { container: tooltipContainer } = render(<>{customerTooltip}</>);
    expect(tooltipContainer.textContent).toContain("Overflow");
    expect(tooltipContainer.textContent).not.toMatch(/Band \d/);
  });

  it("highlights the selected overflow customer with the overflow color (fill + stroke)", () => {
    const { container } = render(
      <NetworkMap
        dataset={overflowDataset}
        warehouseStatuses={[]}
        result={overflowResult}
        showRoutes={false}
        bands={bands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    // showRoutes=false -> the customer CircleMarker is the only
    // .leaflet-interactive element (no route polylines to collide with).
    const customerMarker = container.querySelector(".leaflet-overlay-pane .leaflet-interactive") as HTMLElement;
    expect(customerMarker).not.toBeNull();
    fireEvent.click(customerMarker);
    // isCustomerSelected -> fillColor/color both resolve via
    // getBandColor(assignmentBand), which for this overflow distance is the
    // overflow color, not the (unused, 4-boundary) last-band color.
    const overlayHtml = container.querySelector(".leaflet-overlay-pane")?.innerHTML ?? "";
    expect(overlayHtml.toLowerCase()).toContain(getBandColor(-1).toLowerCase());
  });

  it("shows the overflow color + 'Overflow' label in the click-triggered customer popup", () => {
    const { container } = render(
      <NetworkMap
        dataset={overflowDataset}
        warehouseStatuses={[]}
        result={overflowResult}
        showRoutes={false}
        bands={bands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const customerMarker = container.querySelector(".leaflet-overlay-pane .leaflet-interactive") as HTMLElement;
    fireEvent.click(customerMarker);
    // CustomerPopup opens a REAL imperative L.popup() attached to the map's
    // own DOM (not a normal React child) — query the whole container, same
    // convention as the pre-existing "does NOT change the click-based
    // CustomerPopup content or behavior" test's click-without-throwing check,
    // but this time asserting the actual popup content.
    expect(container.innerHTML).toContain("Overflow");
    expect(container.innerHTML).not.toMatch(/Band \d/);
    expect(container.innerHTML.toLowerCase()).toContain(getBandColor(-1).toLowerCase());
  });

  it("a distance exactly on a boundary resolves to that band, not overflow (upper-inclusive)", () => {
    const onBoundaryResult = {
      ...overflowResult,
      edges: [{ fromId: "W1", toId: "C1", flow: 5000, distance: 2000 }], // == the highest boundary
    };
    const { container } = render(
      <NetworkMap
        dataset={overflowDataset}
        warehouseStatuses={[]}
        result={onBoundaryResult}
        showRoutes={true}
        bands={bands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const routeHtml = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    // Band index 3 (the 4th/last boundary, 2000) — NOT the overflow color.
    expect(routeHtml.toLowerCase()).toContain(getBandColor(3).toLowerCase());
    expect(routeHtml.toLowerCase()).not.toContain(getBandColor(-1).toLowerCase());
  });
});

// ── jade-B1 (#1 leg-vs-band coloring resolution) — band coloring wins for a
// two-echelon edge once "Color lanes: Distance band" is ON (bands
// non-empty); leg colors are the OFF-only fallback (already covered above,
// in the jade-T13 describe block, via bands=[]) ────────────────────────────
describe("NetworkMap band coloring overrides leg coloring when bands is non-empty (jade-B1 fix)", () => {
  const jadeDataset = {
    warehouses: [
      { id: "plant-1", city: "Springfield", state: "IL", lat: 39.78, lng: -89.65 },
      { id: "wh-11", city: "Phoenix", state: "AZ", lat: 33.45, lng: -112.07 },
    ],
    customers: [
      { id: "customer-1", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8, demand: 500 },
    ],
  };
  const jadeResult = {
    status: "optimal" as const,
    objective: 1,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [
      { fromId: "plant-1", toId: "wh-11", flow: 100, distance: 1500, leg: "plant_to_warehouse" as const },
      { fromId: "wh-11", toId: "customer-1", flow: 500, distance: 900, leg: "warehouse_to_customer" as const },
    ],
    metrics: { weightedAvgDistance: 1000, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["wh-11"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("uses distance-band colors, not leg colors, for both legs when bands is non-empty (Color-by-band ON)", () => {
    const bands = [200, 400, 800, 1600];
    const { container } = render(
      <NetworkMap
        dataset={jadeDataset}
        warehouseStatuses={[]}
        result={jadeResult}
        showRoutes={true}
        bands={bands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const routeHtml = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    // Neither leg color appears — this is the fix: the "leg color wins for
    // JADE; band toggle inert" bug is gone.
    expect(routeHtml).not.toContain("var(--map-warehouse-open)");
    expect(routeHtml).not.toContain("var(--danger)");
    // Both edges' real band colors DO appear (1500mi and 900mi both fall
    // under the 1600 boundary -> index 3 for both under this band set).
    expect(routeHtml.toLowerCase()).toContain(getBandColor(3).toLowerCase());
  });
});

// ── jade-B1 (#2) — plant markers + inbound-route connection to plant
// coords ─────────────────────────────────────────────────────────────────
describe("NetworkMap plant markers (jade-B1 #2)", () => {
  const jadePlantDataset = {
    warehouses: [{ id: "wh-11", city: "Phoenix", state: "AZ", lat: 33.45, lng: -112.07 }],
    customers: [{ id: "customer-1", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8, demand: 500 }],
  };
  const plants = [{ id: "plant-1", city: "Springfield", state: "IL", lat: 39.78, lng: -89.65 }];
  const plantResult = {
    status: "optimal" as const,
    objective: 1,
    runTimeSec: 0.1,
    quality: "Optimal",
    edges: [
      { fromId: "plant-1", toId: "wh-11", flow: 100, distance: 1500, leg: "plant_to_warehouse" as const },
      { fromId: "wh-11", toId: "customer-1", flow: 500, distance: 900, leg: "warehouse_to_customer" as const },
    ],
    metrics: { weightedAvgDistance: 1000, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["wh-11"], assignments: [] },
    solverUsed: "CBC (PuLP)",
    infeasibilityReason: null,
  };

  it("renders a plant marker (square icon, not the triangle/star warehouse icons) at its own coordinates, plus a Tooltip", () => {
    tooltipChildren.length = 0;
    const { container } = render(
      <NetworkMap
        dataset={jadePlantDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        plants={plants}
      />,
    );
    // 1 warehouse (triangle) + 1 plant (factory silhouette) marker.
    // T3 — plantSquareSvg is now a filled factory silhouette (saw-tooth
    // roofline polygon + window-pane rects) on the dedicated `--map-plant`
    // token, distinct from the warehouse triangle's `--map-warehouse`
    // family, so identity is asserted via token rather than "no polygon"
    // (both shapes legitimately use <polygon> now).
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    expect(markers.length).toBe(2);
    const plantMarker = Array.from(markers).find((m) => m.innerHTML.includes("var(--map-plant)"));
    expect(plantMarker).toBeDefined();
    expect(plantMarker?.innerHTML).not.toContain("var(--map-warehouse)");
    const plantTooltip = tooltipChildren.find((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent?.includes("Springfield");
    });
    expect(plantTooltip).toBeDefined();
  });

  it("does NOT render plant markers when showPlantMarkers is false, but the inbound route still draws (plants remain authoritative for endpoint resolution)", () => {
    const { container } = render(
      <NetworkMap
        dataset={jadePlantDataset}
        warehouseStatuses={[]}
        result={plantResult}
        showRoutes={true}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        plants={plants}
        showPlantMarkers={false}
      />,
    );
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // Only the 1 warehouse marker — the plant marker is suppressed.
    expect(markers.length).toBe(1);
    // Both routes still draw (2 <path> elements) — plant_to_warehouse's
    // fromId resolves against the `plants` prop regardless of the marker
    // toggle (mirrors showWarehouseMarkers/showCustomerMarkers' own
    // "gate rendering only, never route lookups" contract).
    const routeHtml = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    const pathCount = (routeHtml.match(/<path/g) ?? []).length;
    expect(pathCount).toBe(2);
  });

  it("renders the plant_to_warehouse route connecting to the plant's own coordinates even when the plant is NOT folded into dataset.warehouses (the real, un-folded shape)", () => {
    const { container } = render(
      <NetworkMap
        dataset={jadePlantDataset}
        warehouseStatuses={[]}
        result={plantResult}
        showRoutes={true}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        plants={plants}
      />,
    );
    // dataset.warehouses has NO "plant-1" entry at all — the fromId lookup
    // MUST resolve via the `plants` prop for the inbound route to draw.
    const routeHtml = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    const pathCount = (routeHtml.match(/<path/g) ?? []).length;
    expect(pathCount).toBe(2);
  });

  it("falls back to dataset.warehouses when a caller still folds plants there and passes no `plants` prop (pre-INT compatibility)", () => {
    const foldedDataset = {
      warehouses: [
        { id: "plant-1", city: "Springfield", state: "IL", lat: 39.78, lng: -89.65 },
        { id: "wh-11", city: "Phoenix", state: "AZ", lat: 33.45, lng: -112.07 },
      ],
      customers: [{ id: "customer-1", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8, demand: 500 }],
    };
    const { container } = render(
      <NetworkMap
        dataset={foldedDataset}
        warehouseStatuses={[]}
        result={plantResult}
        showRoutes={true}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        // no `plants` prop at all -> defaults to []
      />,
    );
    const routeHtml = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    const pathCount = (routeHtml.match(/<path/g) ?? []).length;
    expect(pathCount).toBe(2);
  });
});

// ── jade-B1 (#2) — union-of-rendered-markers bounds + degenerate-bounds
// guard (review R-plan-4) ───────────────────────────────────────────────────
describe("NetworkMap union bounds + degenerate-bounds guard (jade-B1 #2)", () => {
  const farPlant = [{ id: "plant-far", city: "Farplantville", state: "AK", lat: 64.2, lng: -149.5 }];
  const closeDataset = {
    warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
    customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 40.5, lng: -90.5, demand: 100 }],
  };

  it("expands maxBounds to include a plant far outside the other markers' area", () => {
    const { container } = render(
      <NetworkMap
        dataset={closeDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        plants={farPlant}
      />,
    );
    const lastProps = mapContainerProps[mapContainerProps.length - 1];
    const maxBounds = lastProps.maxBounds as [[number, number], [number, number]];
    // The plant's own lat (64.2) must fall within the fitted maxBounds —
    // proves the union (not just the two close-together warehouse/customer
    // coords) drove maxBounds.
    expect(maxBounds[0][0]).toBeLessThanOrEqual(64.2);
    expect(maxBounds[1][0]).toBeGreaterThanOrEqual(64.2);
  });

  it("falls back to all-effective-entity coords (padded, non-degenerate) when every marker layer is toggled off", () => {
    const { container } = render(
      <NetworkMap
        dataset={closeDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        showWarehouseMarkers={false}
        showCustomerMarkers={false}
      />,
    );
    const lastProps = mapContainerProps[mapContainerProps.length - 1];
    const maxBounds = lastProps.maxBounds as [[number, number], [number, number]];
    // Finite, non-degenerate (real span on both axes) — falls back to the
    // full closeDataset union (W1 at 40/-90, C1 at 40.5/-90.5) rather than
    // collapsing to a zero-area box or NaN.
    expect(Number.isFinite(maxBounds[0][0])).toBe(true);
    expect(Number.isFinite(maxBounds[1][0])).toBe(true);
    expect(maxBounds[1][0] - maxBounds[0][0]).toBeGreaterThan(0);
    expect(maxBounds[1][1] - maxBounds[0][1]).toBeGreaterThan(0);
    // Still encloses both real entities.
    expect(maxBounds[0][0]).toBeLessThanOrEqual(40);
    expect(maxBounds[1][0]).toBeGreaterThanOrEqual(40.5);
    void container;
  });

  it("falls back to a padded, non-degenerate box for a single-total-entity dataset with no countryBounds (manifest fallback tier)", () => {
    const singleEntityDataset = {
      warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
      customers: [],
    };
    render(
      <NetworkMap
        dataset={singleEntityDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      />,
    );
    const lastProps = mapContainerProps[mapContainerProps.length - 1];
    const maxBounds = lastProps.maxBounds as [[number, number], [number, number]];
    expect(Number.isFinite(maxBounds[0][0])).toBe(true);
    expect(Number.isFinite(maxBounds[1][0])).toBe(true);
    // Non-zero-area on both axes — the "always PAD" requirement.
    expect(maxBounds[1][0] - maxBounds[0][0]).toBeGreaterThan(0);
    expect(maxBounds[1][1] - maxBounds[0][1]).toBeGreaterThan(0);
  });
});
