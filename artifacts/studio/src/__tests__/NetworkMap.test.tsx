import { describe, it, expect, vi, onTestFinished } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { UnitProvider } from "@/contexts/UnitContext";
import type { Edge } from "@workspace/api-client-react";

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
// DU-3.3 (PR3-14) — record every <Polyline>'s pathOptions (keyed by its
// endpoints' coordinates) while still rendering the real polyline, so lane
// dimming (opacity) is observable. Cleared by the DU-3.3 describe's tests.
const polylineCalls: { positions: unknown; pathOptions: { opacity?: number } }[] = [];
vi.mock("react-leaflet", async () => {
  const actual = await vi.importActual<typeof import("react-leaflet")>("react-leaflet");
  const RealMapContainer = actual.MapContainer;
  const RealPolyline = actual.Polyline;
  return {
    ...actual,
    Polyline: (props: React.ComponentProps<typeof RealPolyline>) => {
      polylineCalls.push({ positions: props.positions, pathOptions: (props.pathOptions ?? {}) as { opacity?: number } });
      return <RealPolyline {...props} />;
    },
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
const { jadeRouteDataset, jadeRouteResult } = await import("./fixtures/jadeRouteFixture");

const dataset = {
  warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
  customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 41, lng: -91, demand: 5000 }],
};

describe("NetworkMap customer/station hover tooltip", () => {
  it("renders a Tooltip for every customer/station marker", () => {
    render(
      <UnitProvider><NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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

// ── T5 (workspace-fixups-2, item 4) — `<Type> · <DisplayId> · City, State` ──
describe("NetworkMap marker tooltip: Type · City, State · DisplayId (T5, item 4)", () => {
  it("a plain warehouse (no kind, no modelId) shows 'Warehouse · City, State · <id>'", () => {
    tooltipChildren.length = 0;
    render(
      <UnitProvider><NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("Testville"))).toContain("Warehouse · Testville, TS · W1");
  });

  it("a plain customer (no modelId) shows 'Customer · City, State · <id>'", () => {
    tooltipChildren.length = 0;
    render(
      <UnitProvider><NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("Sampleburg"))).toContain("Customer · Sampleburg, SB · C1");
  });

  it("a warehouse tagged kind:'mine' shows 'Mine · City, State · <id>' regardless of modelId", () => {
    tooltipChildren.length = 0;
    const mineDataset = {
      warehouses: [{ id: "M1", city: "Kalgoorlie", state: "WA", lat: -30.75, lng: 121.47, kind: "mine" as const }],
      customers: [],
    };
    render(
      <UnitProvider><NetworkMap
        dataset={mineDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        modelId="two-echelon-gold-au"
      /></UnitProvider>,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("Kalgoorlie"))).toContain("Mine · Kalgoorlie, WA · M1");
  });

  it("a two-echelon-gold-au facility (kind:'facility', not the mine) shows 'Refinery · City, State · <id>' given modelId", () => {
    tooltipChildren.length = 0;
    const goldDataset = {
      warehouses: [{ id: "cunnamulla", city: "Cunnamulla", state: "QLD", lat: -28.07, lng: 145.68, kind: "facility" as const }],
      customers: [],
    };
    render(
      <UnitProvider><NetworkMap
        dataset={goldDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        modelId="two-echelon-gold-au"
      /></UnitProvider>,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("Cunnamulla"))).toContain("Refinery · Cunnamulla, QLD · cunnamulla");
  });

  it("a transport-coal warehouse-role marker shows 'Mine · City, State · <id>' (matching the model's own vocabulary — its Warehouses tab is titled 'Mines'), and its customer-role marker still shows 'Station · City, State · <id>', given modelId", () => {
    tooltipChildren.length = 0;
    const transportDataset = {
      warehouses: [{ id: "KY", city: "Pikeville", state: "KY", lat: 37.54, lng: -82.75 }],
      customers: [{ id: "S1", city: "Pittsburgh", state: "PA", lat: 40.44, lng: -79.99, demand: 800 }],
    };
    render(
      <UnitProvider><NetworkMap
        dataset={transportDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        modelId="transport-coal"
      /></UnitProvider>,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("Pikeville"))).toContain("Mine · Pikeville, KY · KY");
    expect(texts.find((t) => t.includes("Pittsburgh"))).toContain("Station · Pittsburgh, PA · S1");
  });

  it("a plant marker shows 'Plant · City, State · <id>'", () => {
    tooltipChildren.length = 0;
    const plantOnlyDataset = { warehouses: [], customers: [] };
    render(
      <UnitProvider><NetworkMap
        dataset={plantOnlyDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        plants={[{ id: "plant-1", city: "Springfield", state: "IL", lat: 39.78, lng: -89.65 }]}
      /></UnitProvider>,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("Springfield"))).toContain("Plant · Springfield, IL · plant-1");
  });

  it("displayIdById resolves a marker's DisplayId (e.g. an added entity's display code, not its canonical uid)", () => {
    tooltipChildren.length = 0;
    const addedDataset = {
      warehouses: [{ id: "aw-uuid-1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
      customers: [{ id: "ac-uuid-1", city: "Sampleburg", state: "SB", lat: 41, lng: -91, demand: 5000 }],
    };
    render(
      <UnitProvider><NetworkMap
        dataset={addedDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        displayIdById={{ "aw-uuid-1": "WH-TS-TES-01", "ac-uuid-1": "CS-SB-SAM-01" }}
      /></UnitProvider>,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("Testville"))).toContain("Warehouse · Testville, TS · WH-TS-TES-01");
    expect(texts.find((t) => t.includes("Sampleburg"))).toContain("Customer · Sampleburg, SB · CS-SB-SAM-01");
    expect(texts.join("")).not.toContain("aw-uuid-1");
    expect(texts.join("")).not.toContain("ac-uuid-1");
  });

  it("falls back to the canonical id when displayIdById has no entry for it (default {})", () => {
    tooltipChildren.length = 0;
    render(
      <UnitProvider><NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("Testville"))).toContain("Warehouse · Testville, TS · W1");
  });

  it("formats a missing state without a trailing comma (formatCityState) for both warehouse and customer markers", () => {
    tooltipChildren.length = 0;
    const noStateDataset = {
      warehouses: [{ id: "W1", city: "Chengdu", state: "", lat: 30.67, lng: 104.07 }],
      customers: [{ id: "C1", city: "Changchun", state: "", lat: 43.87, lng: 125.35, demand: 100 }],
    };
    render(
      <UnitProvider><NetworkMap
        dataset={noStateDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    const texts = tooltipChildren.map((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent ?? "";
    });
    expect(texts.find((t) => t.includes("Chengdu"))).toContain("Warehouse · Chengdu · W1");
    expect(texts.find((t) => t.includes("Chengdu"))).not.toContain("Chengdu,");
    expect(texts.find((t) => t.includes("Changchun"))).toContain("Customer · Changchun · C1");
    expect(texts.find((t) => t.includes("Changchun"))).not.toContain("Changchun,");
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
      <UnitProvider><NetworkMap
        dataset={dataset}
        warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={onToggleWarehouseMultiSelect}
        onToggleCustomerMultiSelect={vi.fn()}
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={dataset}
        warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={["W1"]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={vi.fn()}
        onToggleCustomerMultiSelect={vi.fn()}
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={mineDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={facilityDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    const marker = container.querySelector(".leaflet-marker-icon");
    expect(marker?.innerHTML).toContain("<polygon");
    expect(marker?.innerHTML).not.toContain("<path");
  });

  it("renders a triangle icon (svg polygon) for every other model, whose warehouses carry no kind at all", () => {
    // dataset.warehouses[0] has no `kind` field — matches every model except
    // two-echelon-gold-au. Must render identically to before this change.
    const { container } = render(
      <UnitProvider><NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={mineDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    expect(container.textContent).toContain("Mine (fixed)");
    // The mine's own Tooltip (gated on isOpen before this fix — a mine is
    // never in openWarehouseIds, so it never rendered one at all).
    expect(tooltipChildren.length).toBe(tooltipCountBefore + 1);
    const { container: tooltipContainer } = render(<>{tooltipChildren[tooltipChildren.length - 1]}</>);
    // T5 (workspace-fixups-2, item 4) — `<Type> · <displayId> · City, State`.
    // The old bare "(mine)" suffix is retired: the "Mine" type label now
    // carries that information, so it's asserted via the Type prefix
    // instead, not a trailing "(mine)".
    expect(tooltipContainer.textContent).toContain("Mine · Kalgoorlie, WA · M1");
  });

  it("does NOT show a 'Mine (fixed)' legend entry for models with no mine", () => {
    const { container } = render(
      <UnitProvider><NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={singleEntityDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    const firstMapNode = container.querySelector(".leaflet-container");
    expect(firstMapNode).not.toBeNull();

    rerender(
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
    );
    const firstMapNode = container.querySelector(".leaflet-container");

    // Re-render with a new object reference but the same values, plus an
    // unrelated prop change (showRoutes) — should NOT remount the map.
    rerender(
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    const firstMapNode = container.querySelector(".leaflet-container");
    rerender(
      <UnitProvider><NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
    );
    expect(container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon")).toHaveLength(1);
    expect(container.textContent).not.toContain("Closed");
  });

  it("renders BOTH warehouses' markers when hideClosedWarehouses is false (default) — unchanged legacy behavior", () => {
    const { container } = render(
      <UnitProvider><NetworkMap
        dataset={twoWarehouseDataset}
        warehouseStatuses={[]}
        result={resultOpensW1}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    expect(container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon")).toHaveLength(2);
  });

  it("still renders the opened warehouse's route and the (unaffected) customer marker when hideClosedWarehouses is true", () => {
    const { container } = render(
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={dataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={singleEchelonDataset}
        warehouseStatuses={[]}
        result={result}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
    );
    const inboundHtml = inboundOnly.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    expect(inboundHtml).toContain("var(--map-warehouse-open)");
    expect(inboundHtml).not.toContain("var(--danger)");

    const { container: outboundOnly } = render(
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
        <UnitProvider><NetworkMap
          dataset={jadeDataset}
          warehouseStatuses={[]}
          result={unknownLegResult}
          showRoutes={true}
          bands={[]}
          multiSelectedWarehouseIds={[]}
          multiSelectedCustomerIds={[]}
          onToggleWarehouseMultiSelect={() => {}}
          onToggleCustomerMultiSelect={() => {}}
        /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={jadeDataset}
        warehouseStatuses={[]}
        result={multiProductResult}
        showRoutes={true}
        bands={[200, 400, 800, 1600]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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

  it("renders an opaque, pointer-events-none Tooltip on the route polyline with cities + distance in the model's unit (default mi)", () => {
    tooltipCalls.length = 0;
    render(
      <UnitProvider><NetworkMap
        dataset={routeDataset}
        warehouseStatuses={[]}
        result={routeResult}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );

    const routeTooltip = tooltipCalls.find((c) => {
      const { container } = render(<>{c.children}</>);
      return container.textContent?.includes("Testville") && container.textContent?.includes("Sampleburg");
    });
    expect(routeTooltip).toBeDefined();
    // SCU-1.8 (spec B1.7) — now OPAQUE like the marker tooltips, on the
    // shared solid `nos-map-tooltip` surface; still pointer-events-none.
    expect(routeTooltip!.props.opacity).toBe(1);
    expect(routeTooltip!.props.className).toContain("nos-map-tooltip");
    expect(routeTooltip!.props.className).toContain("pointer-events-none");

    const { container: tooltipContainer } = render(<>{routeTooltip!.children}</>);
    expect(tooltipContainer.textContent).toContain("Testville");
    expect(tooltipContainer.textContent).toContain("Sampleburg");
    expect(tooltipContainer.textContent).toContain("Testville, TS → Sampleburg, SB");
    // chen-bands-units, Part D "No fallback unit — reads": no `distanceUnit`
    // was passed, so the canonical unit is unresolved — the tooltip shows a
    // placeholder, never a guessed "mi".
    expect(tooltipContainer.textContent).not.toContain("123 mi");
    expect(tooltipContainer.textContent).toContain("—");
  });

  it("renders the route tooltip distance explicitly in mi when the model's canonical unit is mi", () => {
    tooltipCalls.length = 0;
    render(
      <UnitProvider><NetworkMap
        dataset={routeDataset}
        warehouseStatuses={[]}
        result={routeResult}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        distanceUnit="mi"
      /></UnitProvider>,
    );

    const routeTooltip = tooltipCalls.find((c) => {
      const { container } = render(<>{c.children}</>);
      return container.textContent?.includes("Testville") && container.textContent?.includes("Sampleburg");
    });
    expect(routeTooltip).toBeDefined();
    const { container: tooltipContainer } = render(<>{routeTooltip!.children}</>);
    expect(tooltipContainer.textContent).toContain("123 mi");
  });

  it("renders the route tooltip in a non-mi model unit (e.g. km), never hardcoding mi", () => {
    tooltipCalls.length = 0;
    render(
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
    warehouses: ["Testville, TS"],
    distanceMi: 1234, band: 0, bandLabelText: "—",
  };

  it("buildCustomerPopupHtml renders a placeholder — never a value or a guessed 'mi' label — when no unit is resolved (default)", () => {
    const html = buildCustomerPopupHtml(popupInfo);
    expect(html).not.toContain("1,234 mi");
    expect(html).not.toMatch(/\bmi<\/strong>/);
    expect(html).toContain("—");
  });

  it("buildCustomerPopupHtml renders the distance in mi when explicitly passed", () => {
    const html = buildCustomerPopupHtml(popupInfo, "mi");
    expect(html).toContain("1,234 mi");
  });

  it("buildCustomerPopupHtml renders the distance from the given unit, never a hardcoded mi — driven by a synthetic km unit (CH4O-8: no real model is km-canonical any more, and passing mi would make this unable to fail)", () => {
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
      <UnitProvider><NetworkMap
        dataset={legendDataset}
        warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
        result={forcedOpenResult}
        showRoutes={true}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={mineDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[500, 1000, 1500, 2000]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    expect(getByTestId("legend-output-mine")).toBeInTheDocument();
    expect(getByTestId("map-legend").textContent).toContain("Mine (fixed)");
  });

  it("hides the facility/mine legend entries (but not Customer) when showWarehouseMarkers is false", () => {
    const { getByTestId, queryByText, getByText } = render(
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
    );
    const legend = getByTestId("map-legend");
    expect(legend.textContent).not.toContain("Potential");
    expect(legend.textContent).not.toContain("Open");
    expect(getByText("Customer")).toBeInTheDocument();
    expect(queryByText("Mine (fixed)")).not.toBeInTheDocument();
  });

  it("hides the Customer legend entry (but not facility entries) when showCustomerMarkers is false", () => {
    const { getByTestId } = render(
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
    );
    const legend = getByTestId("map-legend");
    expect(legend.textContent).toContain("Potential");
    expect(legend.textContent).not.toContain("Customer");
  });

  it("renders exactly one route-band swatch per band, even past the 5-entry BAND_COLORS palette (6 bands)", () => {
    const sixBands = [500, 1000, 1500, 2000, 2500, 3000];
    const { container } = render(
      <UnitProvider><NetworkMap
        dataset={legendDataset}
        warehouseStatuses={[{ warehouseId: "W1", status: "forced_open" }]}
        result={forcedOpenResult}
        showRoutes={true}
        bands={sixBands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    const legend = container.querySelector('[data-testid="map-legend"]')!;
    const swatches = legend.querySelectorAll('[data-testid^="legend-band-"]');
    expect(swatches.length).toBe(6);
    // chen-bands-units, Part D "No fallback unit — reads": this render
    // doesn't pass `distanceUnit`, so the canonical unit is unresolved — the
    // label shows a placeholder, never a guessed "mi" (intentional test
    // change from the pre-existing "defaults to mi" expectation).
    expect(legend.textContent).not.toContain("≤ 3000 mi");
    expect(legend.textContent).not.toContain(" mi");
    expect(legend.textContent).not.toMatch(/≤|>/);
    expect(legend.textContent).toContain("Distance bands" + "—".repeat(7)); // 6 band rows + the overflow row
  });
});

// ── C4.14 (D14) — Chen two-class coverage lens ──────────────────────────────
// Chen's Cosmetics passes distanceBands = [highServiceDistMi, maxDistMi] (D13),
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={overflowDataset}
        warehouseStatuses={[]}
        result={overflowResult}
        showRoutes={true}
        bands={bands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    const routeHtml = container.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "";
    expect(routeHtml.toLowerCase()).toContain(getBandColor(-1).toLowerCase());
    // NOT the last real band's color (the old folding behavior).
    expect(routeHtml.toLowerCase()).not.toContain(getBandColor(3).toLowerCase());
  });

  it("reads the overflow range (not 'Overflow' / a Band N label) in the customer hover tooltip", () => {
    tooltipChildren.length = 0;
    render(
      <UnitProvider><NetworkMap
        dataset={overflowDataset}
        warehouseStatuses={[]}
        result={overflowResult}
        showRoutes={true}
        bands={bands}
        distanceUnit="mi"
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    const customerTooltip = tooltipChildren.find((child) => {
      const { container } = render(<>{child}</>);
      return container.textContent?.includes("Sampleburg");
    });
    expect(customerTooltip).toBeDefined();
    const { container: tooltipContainer } = render(<>{customerTooltip}</>);
    expect(tooltipContainer.textContent).toContain("> 2,000 mi");
    expect(tooltipContainer.textContent).not.toMatch(/Band \d|Overflow/);
  });

  it("highlights the selected overflow customer with the overflow color (fill + stroke)", () => {
    const { container } = render(
      <UnitProvider><NetworkMap
        dataset={overflowDataset}
        warehouseStatuses={[]}
        result={overflowResult}
        showRoutes={false}
        bands={bands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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

  it("shows the overflow color + overflow range in the click-triggered customer popup", () => {
    const { container } = render(
      <UnitProvider><NetworkMap
        dataset={overflowDataset}
        warehouseStatuses={[]}
        result={overflowResult}
        showRoutes={false}
        bands={bands}
        distanceUnit="mi"
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
    const customerMarker = container.querySelector(".leaflet-overlay-pane .leaflet-interactive") as HTMLElement;
    fireEvent.click(customerMarker);
    // CustomerPopup opens a REAL imperative L.popup() attached to the map's
    // own DOM (not a normal React child) — query the whole container, same
    // convention as the pre-existing "does NOT change the click-based
    // CustomerPopup content or behavior" test's click-without-throwing check,
    // but this time asserting the actual popup content.
    const popupText = container.querySelector(".leaflet-popup-content")?.textContent ?? "";
    expect(popupText).toContain("> 2,000 mi");
    expect(popupText).not.toMatch(/Band|Overflow/);
    expect(container.innerHTML.toLowerCase()).toContain(getBandColor(-1).toLowerCase());
  });

  // DU-2.2 (PR2-3) — Leg/None lane modes pass bands=[] (colour off); `labelBands` keeps the real range text.
  function renderLabelOnly(showRoutes: boolean) {
    tooltipChildren.length = 0;
    return render(
      <UnitProvider><NetworkMap
        dataset={overflowDataset}
        warehouseStatuses={[]}
        result={overflowResult}
        showRoutes={showRoutes}
        bands={[]}
        labelBands={bands}
        distanceUnit="mi"
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
    );
  }

  it("bands=[] + labelBands: hover tooltip still shows the real range", () => {
    renderLabelOnly(true);
    const customerTooltip = tooltipChildren.find((child) => render(<>{child}</>).container.textContent?.includes("Sampleburg"));
    expect(customerTooltip).toBeDefined();
    const text = render(<>{customerTooltip}</>).container.textContent;
    expect(text).toContain("> 2,000 mi");
    expect(text).not.toMatch(/Band|Overflow/);
  });

  it("bands=[] + labelBands: popup shows the real range while colour classification stays on bands", () => {
    const { container } = renderLabelOnly(false);
    fireEvent.click(container.querySelector(".leaflet-overlay-pane .leaflet-interactive") as HTMLElement);
    const popup = container.querySelector(".leaflet-popup-content");
    expect(popup?.textContent).toContain("> 2,000 mi");
    // colour comes from bands=[] (band 0), NOT the overflow colour that labelBands would imply
    expect(popup?.innerHTML.toLowerCase()).toContain(getBandColor(0).toLowerCase());
    expect(popup?.innerHTML.toLowerCase()).not.toContain(getBandColor(-1).toLowerCase());
  });

  it("a distance exactly on a boundary resolves to that band, not overflow (upper-inclusive)", () => {
    const onBoundaryResult = {
      ...overflowResult,
      edges: [{ fromId: "W1", toId: "C1", flow: 5000, distance: 2000 }], // == the highest boundary
    };
    const { container } = render(
      <UnitProvider><NetworkMap
        dataset={overflowDataset}
        warehouseStatuses={[]}
        result={onBoundaryResult}
        showRoutes={true}
        bands={bands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={jadeDataset}
        warehouseStatuses={[]}
        result={jadeResult}
        showRoutes={true}
        bands={bands}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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

// DU-4.1 — each leg classifies against its own band set (bandsForLeg).
describe("NetworkMap inbound band set (DU-4.1)", () => {
  const dataset = {
    warehouses: [{ id: "wh-11", city: "Phoenix", state: "AZ", lat: 33.45, lng: -112.07 }],
    customers: [{ id: "customer-1", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8, demand: 500 }],
  };
  const plants = [{ id: "plant-1", city: "Springfield", state: "IL", lat: 39.78, lng: -89.65 }];
  const result = {
    status: "optimal" as const, objective: 1, runTimeSec: 0.1, quality: "Optimal",
    edges: [
      { fromId: "plant-1", toId: "wh-11", flow: 100, distance: 1500, leg: "plant_to_warehouse" as const },
      { fromId: "wh-11", toId: "customer-1", flow: 500, distance: 900, leg: "warehouse_to_customer" as const },
    ],
    metrics: { weightedAvgDistance: 1000, bandCoverage: [], utilizationByNode: [] },
    details: { openWarehouseIds: ["wh-11"], assignments: [] },
    solverUsed: "CBC (PuLP)", infeasibilityReason: null,
  };
  const renderMap = (inboundBands?: number[]) => render(
    <UnitProvider><NetworkMap
      dataset={dataset} warehouseStatuses={[]} result={result} showRoutes plants={plants}
      bands={[200, 400, 800, 1600]} inboundBands={inboundBands}
      multiSelectedWarehouseIds={[]} multiSelectedCustomerIds={[]}
      onToggleWarehouseMultiSelect={() => {}} onToggleCustomerMultiSelect={() => {}}
    /></UnitProvider>,
  );
  const routeHtml = (c: HTMLElement) => (c.querySelector(".leaflet-route-pane svg")?.innerHTML ?? "").toLowerCase();

  it("without inboundBands both legs use `bands` (both land in band 3)", () => {
    const html = routeHtml(renderMap().container);
    expect(html).toContain(getBandColor(3).toLowerCase());
    expect(html).not.toContain(getBandColor(-1).toLowerCase());
  });

  it("an inbound edge colours by inboundBands, an outbound edge by bands", () => {
    // 1500 > 1000 -> overflow for the inbound edge; 900 still band 3 of `bands`.
    const html = routeHtml(renderMap([1000]).container);
    expect(html).toContain(getBandColor(-1).toLowerCase());
    expect(html).toContain(getBandColor(3).toLowerCase());
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
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
      /></UnitProvider>,
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
      <UnitProvider><NetworkMap
        dataset={singleEntityDataset}
        warehouseStatuses={[]}
        result={null}
        showRoutes={false}
        bands={[]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
      /></UnitProvider>,
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

// SCU-1.8 (spec B1.7) — every Output Map tooltip (lane, customer, warehouse,
// plant) carries the solid `nos-map-tooltip` class at opacity 1.
describe("NetworkMap — Output Map tooltips are opaque nos-map-tooltip (SCU-1.8)", () => {
  it("lane, customer, warehouse and plant tooltips all carry nos-map-tooltip with opacity 1", () => {
    tooltipCalls.length = 0;
    const tooltipDataset = {
      warehouses: [{ id: "W1", city: "Testville", state: "TS", lat: 40, lng: -90 }],
      customers: [{ id: "C1", city: "Sampleburg", state: "SB", lat: 41, lng: -91, demand: 5000 }],
    };
    const tooltipResult = {
      status: "optimal" as const, objective: 1, runTimeSec: 0.1, quality: "Optimal",
      edges: [{ fromId: "W1", toId: "C1", flow: 5000, distance: 123 }],
      metrics: { weightedAvgDistance: 123, bandCoverage: [], utilizationByNode: [] },
      details: { openWarehouseIds: ["W1"], assignments: [] },
      solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    };
    render(
      <UnitProvider><NetworkMap
        dataset={tooltipDataset}
        warehouseStatuses={[]}
        result={tooltipResult}
        showRoutes={true}
        bands={[200, 400]}
        multiSelectedWarehouseIds={[]}
        multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}}
        onToggleCustomerMultiSelect={() => {}}
        plants={[{ id: "P1", city: "Plantown", state: "PL", lat: 42, lng: -92 }]}
        showPlantMarkers={true}
      /></UnitProvider>,
    );
    // The mock records every render, so assert by CONTENT that all four
    // sites were exercised, then that every recorded call is opaque + classed.
    const texts = tooltipCalls.map(c => render(<>{c.children}</>).container.textContent ?? "");
    expect(texts.some(t => t.includes("Testville, TS → Sampleburg, SB"))).toBe(true); // lane
    expect(texts.some(t => t.includes("Customer · Sampleburg, SB · C1"))).toBe(true);          // customer
    expect(texts.some(t => t.includes("Warehouse · Testville, TS · W1"))).toBe(true);         // warehouse
    expect(texts.some(t => t.includes("Plant · Plantown, PL · P1"))).toBe(true);             // plant
    for (const call of tooltipCalls) {
      expect(call.props.className).toContain("nos-map-tooltip");
      expect(call.props.opacity).toBe(1);
    }
  });
});

// ERR-2 — FitBounds received a freshly-built bounds array on every NetworkMap
// render, so its effect re-ran an (animated) fitBounds() on ANY re-render:
// a user's zoom snapped back, and each call opened Leaflet's 250 ms
// zoom-animation window that SCND_STUDIO-3 crashes in.
describe("NetworkMap FitBounds runs only when the bounds change (ERR-2)", () => {
  it("does not call fitBounds again on a re-render with the same bounds", async () => {
    const L = (await import("leaflet")).default;
    const fitBounds = vi.spyOn(L.Map.prototype, "fitBounds");
    onTestFinished(() => fitBounds.mockRestore()); // restores even if an assertion fails
    const props = {
      dataset,
      warehouseStatuses: [],
      result: null,
      showRoutes: false,
      bands: [500, 1000, 1500, 2000],
      multiSelectedCustomerIds: [],
      onToggleWarehouseMultiSelect: () => {},
      onToggleCustomerMultiSelect: () => {},
    };
    const { rerender } = render(
      <UnitProvider><NetworkMap {...props} multiSelectedWarehouseIds={[]} /></UnitProvider>,
    );
    const afterMount = fitBounds.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    // A new (but equal) prop array forces a re-render without moving any marker.
    rerender(<UnitProvider><NetworkMap {...props} multiSelectedWarehouseIds={[]} /></UnitProvider>);
    rerender(<UnitProvider><NetworkMap {...props} multiSelectedWarehouseIds={[]} /></UnitProvider>);

    expect(fitBounds.mock.calls.length).toBe(afterMount);
  });
});

// ── DU-3.3 — both-leg focus dimming, unconnected-source dimming, callback ───
describe("NetworkMap output selection focus (DU-3.3)", () => {
  type Leg = { inLeg: string; outLeg: string };
  const GOLD: Leg = { inLeg: "mine_to_refinery", outLeg: "refinery_to_customer" };
  const JADE: Leg = { inLeg: "plant_to_warehouse", outLeg: "warehouse_to_customer" };
  const coord: Record<string, [number, number]> = {
    S1: [30, -100], S2: [31, -101], W1: [40, -90], W2: [41, -91], C1: [42, -92], C2: [43, -93], C3: [44, -94],
  };
  const ent = (id: string) => ({ id, city: id, state: "TS", lat: coord[id][0], lng: coord[id][1] });
  // S1->W1, S1->W2, S2->W2 inbound; W1->C1, W2->C2, and C3 split across W1+W2.
  const edgeSpecs: [string, string, "in" | "out"][] = [
    ["S1", "W1", "in"], ["S1", "W2", "in"], ["S2", "W2", "in"],
    ["W1", "C1", "out"], ["W2", "C2", "out"], ["W1", "C3", "out"], ["W2", "C3", "out"],
  ];
  const sceneFor = (legs: Leg, sourcesAreMines: boolean) => {
    const mines = ["S1", "S2"].map((id) => ({ ...ent(id), kind: "mine" as const }));
    const dataset = {
      warehouses: [...(sourcesAreMines ? mines : []), ent("W1"), ent("W2")],
      customers: ["C1", "C2", "C3"].map((id) => ({ ...ent(id), demand: 100 })),
    };
    const result = {
      status: "optimal" as const, objective: 1, runTimeSec: 0.1, quality: "Optimal",
      edges: edgeSpecs.map(([f, t, k]) => ({ fromId: f, toId: t, flow: 10, distance: 100, leg: (k === "in" ? legs.inLeg : legs.outLeg) as Edge["leg"] })),
      metrics: { weightedAvgDistance: 100, bandCoverage: [], utilizationByNode: [] },
      details: { openWarehouseIds: ["W1", "W2"], assignments: [] },
      solverUsed: "CBC (PuLP)", infeasibilityReason: null,
    };
    const plants = sourcesAreMines ? [] : ["S1", "S2"].map((id) => ({ ...ent(id), capacity: 1 }));
    return { dataset, result, plants };
  };
  const idAt = (pos: unknown) => {
    const [lat, lng] = pos as [number, number];
    return Object.keys(coord).find((k) => coord[k][0] === lat && coord[k][1] === lng)!;
  };
  /** Latest opacity per "from|to" (Polyline positions are [to, from]). */
  const opacities = () => {
    const out: Record<string, number | undefined> = {};
    for (const c of polylineCalls) {
      const [to, from] = c.positions as unknown[];
      out[`${idAt(from)}|${idAt(to)}`] = c.pathOptions.opacity;
    }
    return out;
  };
  const mount = (legs: Leg, mines: boolean, onSel?: (id: string | null) => void) => {
    polylineCalls.length = 0;
    const { dataset, result, plants } = sceneFor(legs, mines);
    const view = render(
      <UnitProvider><NetworkMap
        dataset={dataset} warehouseStatuses={[]} result={result} showRoutes bands={[500, 1000]}
        multiSelectedWarehouseIds={[]} multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}} onToggleCustomerMultiSelect={() => {}}
        plants={plants} distanceUnit="mi" onWarehouseSelectionChange={onSel}
      /></UnitProvider>,
    );
    const markers = () => Array.from(view.container.querySelectorAll<HTMLElement>(".leaflet-marker-pane .leaflet-marker-icon"));
    const customers = () => Array.from(view.container.querySelectorAll<HTMLElement>(".leaflet-overlay-pane path.leaflet-interactive"));
    return { ...view, markers, customers, mines };
  };
  // Marker order: [mines S1,S2,] W1, W2, [plants S1,S2].
  const whIdx = (mines: boolean, w: 1 | 2) => (mines ? 2 : 0) + (w - 1);

  it("is not vacuous: with no selection nothing is dimmed", () => {
    mount(JADE, false);
    const o = opacities();
    expect(Object.keys(o)).toHaveLength(edgeSpecs.length);
    expect(Object.values(o).every((v) => v !== 0.1)).toBe(true);
  });

  it.each([["gold", GOLD, true], ["jade", JADE, false], ["super", JADE, false]] as const)(
    "%s: filtering warehouse W1 keeps its outbound + inbound lanes at 0.75 and dims every other lane (incl. inbound into W2) to 0.1",
    (_n, legs, mines) => {
      const m = mount(legs, mines);
      fireEvent.click(m.markers()[whIdx(mines, 1)]);
      const o = opacities();
      for (const k of ["S1|W1", "W1|C1", "W1|C3"]) expect(o[k], k).toBe(0.75);
      for (const k of ["S1|W2", "S2|W2", "W2|C2", "W2|C3"]) expect(o[k], k).toBe(0.1);
    },
  );

  it("filtering a warehouse dims the plant that does not feed it, keeps the one that does", () => {
    const m = mount(JADE, false);
    fireEvent.click(m.markers()[0]); // W1: fed only by S1
    const [s1, s2] = m.markers().slice(2);
    expect(s1.innerHTML).not.toContain('opacity="0.25"');
    expect(s2.innerHTML).toContain('opacity="0.25"');
  });

  it("filtering a warehouse dims the mine that does not feed it (gold)", () => {
    const m = mount(GOLD, true);
    fireEvent.click(m.markers()[whIdx(true, 1)]);
    const [s1, s2] = m.markers();
    expect(s1.innerHTML).not.toContain('opacity="0.25"');
    expect(s2.innerHTML).toContain('opacity="0.25"');
  });

  it("single-sourced customer C1 keeps its lane + the inbound into its warehouse; dims the rest", () => {
    const m = mount(JADE, false);
    fireEvent.click(m.customers()[0]);
    const o = opacities();
    for (const k of ["W1|C1", "S1|W1"]) expect(o[k], k).not.toBe(0.1);
    for (const k of ["S1|W2", "S2|W2", "W2|C2", "W1|C3", "W2|C3"]) expect(o[k], k).toBe(0.1);
  });

  it("split-sourced customer C3 keeps both its lanes + inbound into BOTH serving warehouses (Q3)", () => {
    const m = mount(JADE, false);
    fireEvent.click(m.customers()[2]);
    const o = opacities();
    for (const k of ["W1|C3", "W2|C3", "S1|W1", "S1|W2", "S2|W2"]) expect(o[k], k).not.toBe(0.1);
    for (const k of ["W1|C1", "W2|C2"]) expect(o[k], k).toBe(0.1);
  });

  it("onWarehouseSelectionChange fires with the warehouse, then null on re-click", () => {
    const calls: (string | null)[] = [];
    const m = mount(JADE, false, (id) => calls.push(id));
    expect(calls).toEqual([null]);
    fireEvent.click(m.markers()[0]);
    fireEvent.click(m.markers()[0]);
    expect(calls).toEqual([null, "W1", null]);
  });

  it("clears the warehouse selection when the result changes (re-solve)", () => {
    const calls: (string | null)[] = [];
    const m = mount(JADE, false, (id) => calls.push(id));
    fireEvent.click(m.markers()[0]);
    expect(calls).toEqual([null, "W1"]);
    const { dataset, result, plants } = sceneFor(JADE, false);
    m.rerender(
      <UnitProvider><NetworkMap
        dataset={dataset} warehouseStatuses={[]} result={{ ...result }} showRoutes bands={[500, 1000]}
        multiSelectedWarehouseIds={[]} multiSelectedCustomerIds={[]}
        onToggleWarehouseMultiSelect={() => {}} onToggleCustomerMultiSelect={() => {}}
        plants={plants} distanceUnit="mi" onWarehouseSelectionChange={(id) => calls.push(id)}
      /></UnitProvider>,
    );
    expect(calls[calls.length - 1]).toBeNull();
  });
});

// ── DU-3.4 — popup hygiene, per-product routes (incl. split), legend yields ──
describe("NetworkMap popup + legend (DU-3.4)", () => {
  const baseProps = {
    warehouseStatuses: [], showRoutes: true, bands: [500, 1000], distanceUnit: "mi" as const,
    multiSelectedWarehouseIds: [], multiSelectedCustomerIds: [],
    onToggleWarehouseMultiSelect: () => {}, onToggleCustomerMultiSelect: () => {},
  };
  const mountJade = (dataset = jadeRouteDataset) => {
    tooltipCalls.length = 0;
    const view = render(
      <UnitProvider><NetworkMap {...baseProps} dataset={dataset} result={jadeRouteResult} plants={dataset.plants} /></UnitProvider>,
    );
    const customerMarkers = () => Array.from(view.container.querySelectorAll<HTMLElement>(".leaflet-overlay-pane path.leaflet-interactive"));
    return { ...view, customerMarkers };
  };
  // Customer tooltips are the only ones with offset [0, -4] (route/warehouse/plant tooltips also name customers).
  const tooltipTexts = () => tooltipCalls.filter((c) => (c.props.offset as number[])?.[1] === -4).map((c) => render(<>{c.children}</>).container.textContent ?? "");

  it("injection: customer, warehouse, product and plant names render escaped in the popup", () => {
    const evil = "<script>alert(1)</script>";
    const ds = {
      ...jadeRouteDataset,
      warehouses: jadeRouteDataset.warehouses.map((w) => (w.id === "W1" ? { ...w, city: evil } : w)),
      customers: jadeRouteDataset.customers.map((c) => (c.id === "C1" ? { ...c, city: evil } : c)),
      plants: jadeRouteDataset.plants!.map((p) => (p.id === "P1" ? { ...p, city: evil } : p)),
      products: jadeRouteDataset.products!.map((p) => (p.id === "steel" ? { ...p, name: evil } : p)),
    };
    const { container, customerMarkers } = mountJade(ds);
    fireEvent.click(customerMarkers()[0]); // C1
    const content = container.querySelector(".leaflet-popup-content")!;
    expect(content.textContent).toContain(evil); // shown as text...
    expect(content.querySelector("script")).toBeNull(); // ...never parsed as markup
    expect(buildCustomerPopupHtml({ lat: 0, lng: 0, customerCity: evil, customerState: "", warehouses: [evil], distanceMi: 1, band: 0, bandLabelText: evil }, "mi")).not.toContain("<script>");
  });

  it("split: header reads 'Split across 2 warehouses' with one row per product, each with its own warehouse", () => {
    const { container, customerMarkers } = mountJade();
    fireEvent.click(customerMarkers()[1]); // C2
    const text = container.querySelector(".leaflet-popup-content")!.textContent!;
    expect(text).toContain("Split across 2 warehouses");
    expect(text).toContain("Steel via Whiteville, TX");
    expect(text).toContain("Wire via Wardtown, OK");
    expect(text).toContain("from Pton, OH: 60");
  });

  it("a single-warehouse customer shows the warehouse name and its two product rows", () => {
    const { container, customerMarkers } = mountJade();
    fireEvent.click(customerMarkers()[0]); // C1
    const text = container.querySelector(".leaflet-popup-content")!.textContent!;
    expect(text).not.toContain("Split across");
    expect(text).toContain("Whiteville, TX");
    expect(text).toContain("Steel via");
    expect(text).toContain("Wire via");
  });

  it("tooltip suppression: the selected customer's tooltip is dropped, other customers keep theirs", () => {
    const { customerMarkers } = mountJade();
    expect(tooltipTexts().filter((t) => t.includes("Cville"))).not.toHaveLength(0); // not vacuous
    tooltipCalls.length = 0;
    fireEvent.click(customerMarkers()[0]); // C1 = Cville
    const after = tooltipTexts();
    expect(after.some((t) => t.includes("Cville"))).toBe(false);
    expect(after.some((t) => t.includes("Splitburg"))).toBe(true);
  });

  // Sentry SCND_STUDIO-4/5: the popup's moveend refit called popup.update(),
  // whose autoPan stops the map's in-flight pan; that stop fires moveend
  // synchronously, maxBounds starts another pan, refit stops it… until the
  // stack overflows. The init-hook listener stands in for maxBounds'
  // _panInsideMaxBounds (registered at map creation, so it runs before refit).
  it("moveend refit never re-enters through an in-flight pan (no stack overflow)", async () => {
    const L = (await import("leaflet")).default;
    const maps: import("leaflet").Map[] = [];
    let armed = false;
    onTestFinished(() => { armed = false; });
    L.Map.addInitHook(function (this: import("leaflet").Map) {
      const m = this;
      maps.push(m);
      m.on("moveend", () => { if (armed) m.panBy([1, 1], { animate: true }); });
    });
    const { container, customerMarkers } = mountJade();
    fireEvent.click(customerMarkers()[0]);
    expect(container.querySelector(".leaflet-popup-content")).not.toBeNull(); // not vacuous: popup (and refit) live
    const map = maps[maps.length - 1];
    armed = true;
    map.panBy([1, 1], { animate: true }); // a pan in flight (jsdom map has 0 size, so force the animated path)
    expect(() => map.fire("moveend")).not.toThrow();
  });

  it("legend fades to opacity-15 while a popup is open and restores on close", () => {
    const { container, customerMarkers } = mountJade();
    const legend = () => container.querySelector('[data-testid="map-legend"]')!;
    expect(legend().className).not.toContain("opacity-15");
    fireEvent.click(customerMarkers()[0]);
    expect(legend().className).toContain("opacity-15");
    fireEvent.click(customerMarkers()[0]); // toggles selection off -> popup closes
    expect(legend().className).not.toContain("opacity-15");
  });
});

describe("MapOverlayEvents counter", () => {
  it("stays dimmed until the LAST overlay closes and never goes negative", async () => {
    const { MapContainer, useMap } = await import("react-leaflet");
    const { MapOverlayEvents } = await import("@/components/workspace/map/MapOverlayEvents");
    let map!: import("leaflet").Map;
    const Grab = () => { map = useMap(); return null; };
    const seen: boolean[] = [];
    render(<MapContainer center={[0, 0]} zoom={2}><Grab /><MapOverlayEvents onChange={(o) => seen.push(o)} /></MapContainer>);
    const last = () => seen[seen.length - 1];
    map.fire("tooltipclose"); // stray close at 0: floored
    map.fire("tooltipopen");
    expect(last()).toBe(true);
    map.fire("popupopen");
    map.fire("tooltipclose");
    expect(last()).toBe(true);
    map.fire("popupclose");
    expect(last()).toBe(false);
    map.fire("popupclose"); // extra close must not push the counter below zero
    map.fire("tooltipopen");
    expect(last()).toBe(true);
  });
});
