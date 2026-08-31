import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";
import type { MapWarehouse, MapCustomer, PMedianMapInputs } from "@/components/workspace/map/types";

// T10 (Input Map v2 QA) — genuinely new coverage on top of InputMapTabV2.
// test.tsx (create/delete/move/edit/copy dispatch) and Workspace.
// InputMapV2.test.tsx (Save reconciliation). Both of those already use a
// real MapContainer/Marker under jsdom, not a react-leaflet mock — the same
// convention this file continues, since the risks below are genuine DOM
// event-wiring behavior (propagation stopping, Escape/focus handling), not
// pixel-level Leaflet rendering that only a real browser can prove. Native
// drag (mousedown→mousemove→mouseup through Leaflet's own Draggable class)
// and pan/zoom-triggered map events are NOT attempted here — those need a
// real browser's layout/event timing and are covered by
// e2e/input-map-v2.spec.ts instead.

const baseWh = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "CHI",
  displayCode: "CHI",
  city: "Chicago",
  state: "IL",
  lat: 41.8,
  lng: -87.6,
  capacity: null,
  status: "active",
  isAdded: false,
  ...over,
});

const addedWh = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "aw-1",
  displayCode: "WH-NV-RENO-01",
  city: "Reno",
  state: "NV",
  lat: 39.5,
  lng: -119.8,
  capacity: null,
  status: "active",
  isAdded: true,
  ...over,
});

const cs = (over: Partial<MapCustomer> = {}): MapCustomer => ({
  id: "C1",
  displayCode: "C1",
  city: "New York",
  state: "NY",
  lat: 40.7,
  lng: -74.0,
  demand: 100,
  excluded: false,
  isAdded: false,
  ...over,
});

function makeInputs(over: Partial<PMedianMapInputs> = {}): PMedianMapInputs {
  return {
    addedWarehouses: [],
    addedCustomers: [],
    warehouseOverrides: [],
    customerOverrides: [],
    distanceOverrides: [],
    capacityMode: "none",
    ...over,
  };
}

function renderPMedian(over: {
  warehouses?: MapWarehouse[];
  customers?: MapCustomer[];
  inputs?: PMedianMapInputs;
} = {}) {
  const onInputsChange = vi.fn();
  const view = render(
    <InputMapTab
      mode="pmedian"
      warehouses={over.warehouses ?? [baseWh()]}
      customers={over.customers ?? [cs()]}
      inputs={over.inputs ?? makeInputs()}
      onInputsChange={onInputsChange}
    />,
  );
  return { ...view, onInputsChange };
}

describe("InputMapTab (pmedian) — right-click propagation", () => {
  it("right-clicking a MARKER opens only the entity action menu, never the empty-space add menu (EntityMarkers stops propagation)", () => {
    const { container } = renderPMedian({ warehouses: [baseWh()] });
    const marker = container.querySelector(".leaflet-marker-icon") as HTMLElement;
    fireEvent.contextMenu(marker);

    expect(screen.getByTestId("map-action-menu")).toBeInTheDocument();
    expect(screen.queryByTestId("map-add-menu")).not.toBeInTheDocument();
  });

  it("right-clicking empty map space still opens the add-entity menu, not the entity action menu", () => {
    const { container } = renderPMedian({ warehouses: [baseWh()] });
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 200, clientY: 200 });

    expect(screen.getByTestId("map-add-menu")).toBeInTheDocument();
    expect(screen.queryByTestId("map-action-menu")).not.toBeInTheDocument();
  });
});

describe("InputMapTab (pmedian) — Escape / keyboard, no mutation on cancel-by-Escape", () => {
  it("Escape closes the action menu without invoking Edit/Move/Copy/Delete, and restores focus to what was focused before it opened", () => {
    const { container, onInputsChange } = renderPMedian({ warehouses: [addedWh()] });
    // Establish a real, meaningful "previously focused" element — the
    // layer-toggle chip, a real focusable button already in this component.
    const toggleButton = screen.getByTestId("toggle-layer-warehouses");
    toggleButton.focus();
    expect(document.activeElement).toBe(toggleButton);

    const marker = container.querySelector(".leaflet-marker-icon") as HTMLElement;
    fireEvent.contextMenu(marker);
    const menu = screen.getByTestId("map-action-menu");
    expect(menu).toBeInTheDocument();
    // MapActionMenu focuses its first item on open.
    expect(document.activeElement).not.toBe(toggleButton);

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByTestId("map-action-menu")).not.toBeInTheDocument();
    expect(onInputsChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(toggleButton);
  });

  it("Escape closes the details card (left-click inspect) without opening anything else, and restores prior focus", () => {
    const { container } = renderPMedian({ warehouses: [baseWh()] });
    const toggleButton = screen.getByTestId("toggle-layer-customers");
    toggleButton.focus();

    const marker = container.querySelector(".leaflet-marker-icon") as HTMLElement;
    fireEvent.click(marker);
    expect(screen.getByTestId("map-details-card")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("map-details-card")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(toggleButton);
  });

  it("Escape (via the dialog's own onOpenChange) cancels CreateEntityDialog without calling onInputsChange", () => {
    const { container, onInputsChange } = renderPMedian();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));
    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId("create-entity-dialog"), { key: "Escape" });

    expect(screen.queryByTestId("create-entity-dialog")).not.toBeInTheDocument();
    expect(onInputsChange).not.toHaveBeenCalled();
  });
});

describe("InputMapTab (pmedian) — base marker action menu never grows a Move/Delete affordance via keyboard nav either", () => {
  it("Tab/ArrowDown cycling through a BASE entity's action menu never focuses a Move or Delete item, because none exist", () => {
    const { container } = renderPMedian({ warehouses: [baseWh()] });
    const marker = container.querySelector(".leaflet-marker-icon") as HTMLElement;
    fireEvent.contextMenu(marker);
    const menu = screen.getByTestId("map-action-menu");

    // Cycle forward through every item — with only 2 actions (Edit, Copy),
    // 4 ArrowDown presses should land back on the first (Edit).
    for (let i = 0; i < 4; i++) fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("map-action-edit"));
    expect(screen.queryByTestId("map-action-move")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-action-delete")).not.toBeInTheDocument();
  });
});
