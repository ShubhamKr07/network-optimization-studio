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

  it("calls onLeftClick with the MapEntity on a plain click", () => {
    const onLeftClick = vi.fn();
    const { container } = renderMarkers({ warehouses: [wh({ id: "W1" })], onLeftClick });
    const marker = container.querySelector(".leaflet-marker-icon") as HTMLElement;
    fireEvent.click(marker);
    expect(onLeftClick).toHaveBeenCalledTimes(1);
    expect(onLeftClick.mock.calls[0][0]).toEqual({ kind: "wh", entity: wh({ id: "W1" }) });
  });
});
