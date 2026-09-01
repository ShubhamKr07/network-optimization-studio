import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, fireEvent } from "@testing-library/react";
import { MapContainer, TileLayer } from "react-leaflet";
import { EntityMarkers, warehouseTriangleSvg, customerBubbleSvg } from "@/components/workspace/map/EntityMarkers";
import type { MapWarehouse, MapCustomer } from "@/components/workspace/map/types";

// Real MapContainer + real Marker under jsdom (same pattern NetworkMap.test.tsx
// already relies on for shape/class assertions) rather than a hand-rolled
// react-leaflet mock — Leaflet itself applies real classes (status/marker
// style classes from our own divIcon className, plus its own
// leaflet-marker-draggable when dragging is enabled), so assertions here
// exercise the actual wiring, not a re-implementation of it.
function renderMarkers(props: Partial<ComponentProps<typeof EntityMarkers>> = {}) {
  const defaults: ComponentProps<typeof EntityMarkers> = {
    warehouses: [],
    customers: [],
    toggles: { warehouses: true, customers: true, showInactive: false },
    onLeftClick: vi.fn(),
    onRightClick: vi.fn(),
    onDragEnd: vi.fn(),
    draggableIds: new Set<string>(),
  };
  return render(
    <MapContainer center={[0, 0]} zoom={2}>
      <TileLayer url="https://example.invalid/{z}/{x}/{y}.png" />
      <EntityMarkers {...defaults} {...props} />
    </MapContainer>,
  );
}

const wh = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "W1",
  displayCode: "WH-IL-CHI-01",
  city: "Chicago",
  state: "IL",
  lat: 41.8,
  lng: -87.6,
  capacity: null,
  status: "active",
  isAdded: false,
  ...over,
});

const cs = (over: Partial<MapCustomer> = {}): MapCustomer => ({
  id: "C1",
  displayCode: "CS-IL-CHI-01",
  city: "Chicago",
  state: "IL",
  lat: 41.9,
  lng: -87.7,
  demand: 5000,
  excluded: false,
  isAdded: false,
  ...over,
});

describe("SVG-string icon builders", () => {
  it("warehouseTriangleSvg returns a string (never a React element) for every marker style", () => {
    for (const marker of ["outline", "filled", "dashed"] as const) {
      const svg = warehouseTriangleSvg(marker);
      expect(typeof svg).toBe("string");
      expect(svg).toContain("<svg");
    }
  });

  it("customerBubbleSvg returns a string", () => {
    const svg = customerBubbleSvg(6);
    expect(typeof svg).toBe("string");
    expect(svg).toContain("<circle");
  });

  // R3 regression: --accent-700/--accent-300/--accent-600 (and --demand-*)
  // are already complete colors (index.css's relative-color-syntax output),
  // not shadcn H-S-L channel triples — wrapping one again as
  // `hsl(var(--accent-700))` is an invalid nested color, which SVG silently
  // falls back from (fill -> black, stroke -> none) instead of erroring.
  // Assert the generated markup uses the unwrapped `var(--token)` form and
  // never the invalid nested form, for every marker style/tone.
  it("warehouseTriangleSvg uses var(--accent-700) unwrapped, never hsl(var(--accent-700))", () => {
    // outline/filled both use --accent-700 (stroke-only vs fill+stroke);
    // dashed uses --muted-foreground instead (asserted separately below) —
    // so only assert the presence of --accent-700 where it's actually used.
    for (const marker of ["outline", "filled"] as const) {
      const svg = warehouseTriangleSvg(marker);
      expect(svg).toContain("var(--accent-700)");
      expect(svg).not.toContain("hsl(var(--accent-700))");
    }
    // Every style, including dashed, must never contain the invalid nested form.
    for (const marker of ["outline", "filled", "dashed"] as const) {
      expect(warehouseTriangleSvg(marker)).not.toContain("hsl(var(--accent-700))");
    }
  });

  it("warehouseTriangleSvg's dashed stroke keeps --muted-foreground wrapped (it's a genuine H-S-L channel token, not a complete color)", () => {
    expect(warehouseTriangleSvg("dashed")).toContain("hsl(var(--muted-foreground))");
  });

  it("customerBubbleSvg uses var(--accent-300)/var(--accent-600) unwrapped for the blue tone (default)", () => {
    const svg = customerBubbleSvg(6);
    expect(svg).toContain("var(--accent-300)");
    expect(svg).toContain("var(--accent-600)");
    expect(svg).not.toContain("hsl(var(--accent-300))");
    expect(svg).not.toContain("hsl(var(--accent-600))");
  });

  it("customerBubbleSvg uses var(--demand-300)/var(--demand-600) unwrapped for the green tone", () => {
    const svg = customerBubbleSvg(6, "green");
    expect(svg).toContain("var(--demand-300)");
    expect(svg).toContain("var(--demand-600)");
    expect(svg).not.toContain("--accent-300");
    expect(svg).not.toContain("--accent-600");
  });
});

describe("EntityMarkers", () => {
  it("renders one marker per active/forced_open warehouse plus one per customer", () => {
    const { container } = renderMarkers({
      warehouses: [wh({ id: "W1" }), wh({ id: "W2", status: "forced_open" })],
      customers: [cs({ id: "C1" }), cs({ id: "C2" }), cs({ id: "C3" })],
    });
    expect(container.querySelectorAll(".leaflet-marker-icon").length).toBe(5);
  });

  it("an active warehouse's divIcon carries the outline class, not filled", () => {
    const { container } = renderMarkers({ warehouses: [wh({ id: "W1", status: "active" })] });
    const marker = container.querySelector(".leaflet-marker-icon")!;
    expect(marker.className).toContain("marker-outline");
    expect(marker.className).toContain("status-active");
    expect(marker.className).not.toContain("marker-filled");
  });

  it("a forced_open warehouse's divIcon carries the filled class", () => {
    const { container } = renderMarkers({ warehouses: [wh({ id: "W1", status: "forced_open" })] });
    const marker = container.querySelector(".leaflet-marker-icon")!;
    expect(marker.className).toContain("marker-filled");
    expect(marker.className).not.toContain("marker-outline");
  });

  it("an inactive warehouse is hidden unless toggles.showInactive is true, and then carries the dashed class", () => {
    const { container: hidden } = renderMarkers({
      warehouses: [wh({ id: "W1", status: "inactive" })],
      toggles: { warehouses: true, customers: true, showInactive: false },
    });
    expect(hidden.querySelectorAll(".leaflet-marker-icon").length).toBe(0);

    const { container: shown } = renderMarkers({
      warehouses: [wh({ id: "W1", status: "inactive" })],
      toggles: { warehouses: true, customers: true, showInactive: true },
    });
    const marker = shown.querySelector(".leaflet-marker-icon")!;
    expect(marker.className).toContain("marker-dashed");
    expect(marker.className).toContain("status-inactive");
  });

  // T4 (Bundle 2) — R3 capability gate seam: a role with no status field
  // (transport-coal mines) never sets MapWarehouse.status at all. Confirms
  // this degrades to a plain outline triangle with no status-* class, and
  // is never hidden by the showInactive filter (which has nothing to key
  // off) — the seam supportsFacilityStatus:false callers (T6) rely on.
  it("a warehouse-role row with no status (hasStatus:false role, e.g. a mine) renders a plain outline triangle with no status-* class, and is never hidden by showInactive", () => {
    const { container } = renderMarkers({
      warehouses: [wh({ id: "M1", status: undefined })],
      toggles: { warehouses: true, customers: true, showInactive: false },
    });
    const marker = container.querySelector(".leaflet-marker-icon")!;
    expect(marker.className).toContain("marker-outline");
    expect(marker.className).not.toMatch(/status-\w/);
  });

  it("an excluded customer carries a distinct dim class but still renders as a marker", () => {
    const { container } = renderMarkers({ customers: [cs({ id: "C1", excluded: true })] });
    const marker = container.querySelector(".leaflet-marker-icon")!;
    expect(marker.className).toContain("cs-excluded");
  });

  it("a non-excluded customer does not carry the dim class", () => {
    const { container } = renderMarkers({ customers: [cs({ id: "C1", excluded: false })] });
    const marker = container.querySelector(".leaflet-marker-icon")!;
    expect(marker.className).not.toContain("cs-excluded");
  });

  it("the divIcon html is a string for both warehouse and customer markers (not a stray [object Object])", () => {
    const { container } = renderMarkers({
      warehouses: [wh({ id: "W1" })],
      customers: [cs({ id: "C1" })],
    });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    markers.forEach((marker) => {
      expect(marker.innerHTML).not.toContain("[object Object]");
      expect(marker.querySelector("svg")).not.toBeNull();
    });
  });

  it("an id present in draggableIds is draggable (Leaflet applies leaflet-marker-draggable)", () => {
    const { container } = renderMarkers({
      warehouses: [wh({ id: "W1", isAdded: true })],
      draggableIds: new Set(["W1"]),
    });
    const marker = container.querySelector(".leaflet-marker-icon")!;
    expect(marker.className).toContain("leaflet-marker-draggable");
  });

  it("an id absent from draggableIds is not draggable", () => {
    const { container } = renderMarkers({
      warehouses: [wh({ id: "W1", isAdded: false })],
      draggableIds: new Set<string>(),
    });
    const marker = container.querySelector(".leaflet-marker-icon")!;
    expect(marker.className).not.toContain("leaflet-marker-draggable");
  });

  it("toggles.warehouses=false hides warehouses but leaves customers rendered", () => {
    const { container } = renderMarkers({
      warehouses: [wh({ id: "W1" })],
      customers: [cs({ id: "C1" })],
      toggles: { warehouses: false, customers: true, showInactive: false },
    });
    expect(container.querySelectorAll(".leaflet-marker-icon").length).toBe(1);
    expect(container.querySelector(".wh-marker")).toBeNull();
    expect(container.querySelector(".cs-marker")).not.toBeNull();
  });

  it("warehouse markers get an elevated zIndexOffset so they win hit-testing over overlapping customer bubbles; customers stay at the default", () => {
    // Defect B regression guard: a customer's demand-radius bubble can
    // overlap a warehouse triangle at default zoom, and Leaflet hit-tests
    // by paint order (last-drawn wins) absent an explicit z-index — so
    // warehouses must always sit above customers regardless of render
    // order. Leaflet writes the resolved z-index (latitude-based draw
    // order + zIndexOffset) onto the marker icon element's own inline
    // style, so we can assert the real, wired-up value here rather than
    // just the offset we passed in.
    const { container } = renderMarkers({
      warehouses: [wh({ id: "W1", lat: 41.8, lng: -87.6 })],
      customers: [cs({ id: "C1", lat: 41.8, lng: -87.6 })],
    });
    const whMarker = container.querySelector(".wh-marker") as HTMLElement;
    const csMarker = container.querySelector(".cs-marker") as HTMLElement;
    const whZIndex = Number(whMarker.style.zIndex);
    const csZIndex = Number(csMarker.style.zIndex);
    expect(whZIndex).toBeGreaterThan(csZIndex);
    // The gap should reflect the 1000 offset, not just Leaflet's small
    // per-marker latitude tiebreak (a handful of units at most).
    expect(whZIndex - csZIndex).toBeGreaterThanOrEqual(900);
  });

  it("calls onLeftClick with the MapEntity on a plain click", () => {
    const onLeftClick = vi.fn();
    const { container } = renderMarkers({ warehouses: [wh({ id: "W1" })], onLeftClick });
    const marker = container.querySelector(".leaflet-marker-icon") as HTMLElement;
    fireEvent.click(marker);
    expect(onLeftClick).toHaveBeenCalledTimes(1);
    expect(onLeftClick.mock.calls[0][0]).toEqual({ kind: "wh", entity: wh({ id: "W1" }) });
  });

  // R1 — supply blue / demand green.
  describe("demand tone (R1)", () => {
    it("customer bubbles are green (var(--demand-*)) for p-median-us, the default modelId", () => {
      const { container } = renderMarkers({ customers: [cs({ id: "C1" })] });
      const svg = container.querySelector(".cs-marker svg")!;
      expect(svg.outerHTML).toContain("var(--demand-300)");
    });

    it("customer bubbles are green (var(--demand-*)) for every other modelId too (R1 fast-follow — no more blue branch)", () => {
      const { container } = renderMarkers({ customers: [cs({ id: "C1" })], modelId: "transport-coal" });
      const svg = container.querySelector(".cs-marker svg")!;
      expect(svg.outerHTML).toContain("var(--demand-300)");
      expect(svg.outerHTML).not.toContain("--accent-300");
    });

    it("warehouse triangles stay blue (var(--accent-700)) regardless of modelId", () => {
      const { container } = renderMarkers({ warehouses: [wh({ id: "W1" })], modelId: "transport-coal" });
      const svg = container.querySelector(".wh-marker svg")!;
      expect(svg.outerHTML).toContain("var(--accent-700)");
    });
  });

  // R2 — discrete quintile demand-bubble sizing, computed from the full
  // `customers` population this component already receives (base + added +
  // excluded — nothing is filtered out of the array before this loop runs).
  describe("quintile bubble sizing (R2)", () => {
    it("two customers in the same quintile bucket render the same bubble size; a customer in a higher bucket renders larger", () => {
      // 10 customers spanning a wide demand range -> multiple distinct buckets.
      const population = [100, 500, 1000, 2000, 3000, 5000, 8000, 12000, 20000, 50000].map((demand, i) =>
        cs({ id: `C${i}`, demand }),
      );
      const { container } = renderMarkers({ customers: population });
      const svgs = Array.from(container.querySelectorAll(".cs-marker svg"));
      expect(svgs.length).toBe(10);
      const widths = svgs.map((svg) => Number(svg.getAttribute("width")));
      // Smallest demand (100) must not be larger than the largest (50000).
      expect(widths[0]).toBeLessThanOrEqual(widths[widths.length - 1]);
      // At least two distinct sizes actually appear across this spread.
      expect(new Set(widths).size).toBeGreaterThan(1);
    });

    it("an excluded customer is IN the quintile scale (sized by its own bucket, not fixed-size) and still carries the dim class", () => {
      // The excluded customer has the largest demand in the population — its
      // bubble must be sized at the top bucket, not some fixed/default size.
      const population = [
        cs({ id: "C1", demand: 100, excluded: false }),
        cs({ id: "C2", demand: 500, excluded: false }),
        cs({ id: "C3", demand: 50000, excluded: true }),
      ];
      const { container } = renderMarkers({ customers: population });
      const excludedMarker = container.querySelector(".cs-excluded") as HTMLElement;
      const otherMarkers = Array.from(container.querySelectorAll(".cs-marker:not(.cs-excluded)"));
      expect(excludedMarker.className).toContain("cs-excluded");
      const excludedWidth = Number(excludedMarker.querySelector("svg")!.getAttribute("width"));
      const otherWidths = otherMarkers.map((m) => Number(m.querySelector("svg")!.getAttribute("width")));
      expect(excludedWidth).toBeGreaterThan(Math.max(...otherWidths));
    });

    it("an excluded customer's (large) demand shifts the thresholds for everyone else too — the population includes it, unfiltered", () => {
      // demand=400 sits above p80 (bucket 4) in the 4-customer population,
      // but drops to bucket 3 once the huge excluded 5th customer is folded
      // into the threshold math (verified by hand: p80 without the outlier
      // is 340; with it, p60 is 340 and p80 balloons to ~200320).
      const withHugeExcluded = [
        cs({ id: "C1", demand: 100 }),
        cs({ id: "C2", demand: 200 }),
        cs({ id: "C3", demand: 300 }),
        cs({ id: "C4", demand: 400 }),
        cs({ id: "C5", demand: 1000000, excluded: true }),
      ];
      const withoutIt = withHugeExcluded.slice(0, 4);
      const { container: withHuge } = renderMarkers({ customers: withHugeExcluded });
      const { container: without } = renderMarkers({ customers: withoutIt });
      // C4 (demand=400) is the last non-excluded customer in render order in
      // both populations, so it's the last ".cs-marker" node in each case.
      const markerWithHuge = Array.from(withHuge.querySelectorAll(".cs-marker"))[3];
      const markerWithout = Array.from(without.querySelectorAll(".cs-marker"))[3];
      const widthHuge = Number(markerWithHuge.querySelector("svg")!.getAttribute("width"));
      const widthNoHuge = Number(markerWithout.querySelector("svg")!.getAttribute("width"));
      expect(widthHuge).not.toBe(widthNoHuge);
    });
  });
});
