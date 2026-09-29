import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, fireEvent, screen } from "@testing-library/react";
import { UnitProvider } from "@/contexts/UnitContext";

// Same ancestor requirement as InputMapTabV2.test.tsx:10-13 — components
// under this tree read the display-unit preference via useDisplayUnit().
const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(ui, { wrapper: UnitProvider, ...options });

import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";
import type { AddedWarehouseInput, MapWarehouse, MapCustomer, PMedianMapInputs } from "@/components/workspace/map/types";

// Same mock as InputMapTabV2.test.tsx:25-27 — the pmedian arm calls
// useListModels() internally.
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => ({ data: [] }),
}));

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

const baseCs = (over: Partial<MapCustomer> = {}): MapCustomer => ({
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

function basePMedianInputs(over: Partial<PMedianMapInputs> = {}): PMedianMapInputs {
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

// ch5-edit-6 — an added entity, both as the view-model row (isAdded: true,
// what EntityMarkers/draggableIds actually reads) and as the persisted-shape
// row (`inputs.addedWarehouses`) — same fixture shape this file used
// pre-rename. delivery-teaching-us never actually reaches this state (no add
// affordance exists for it), so the `draggableIds` gate is tested against a
// genuinely-present added entity anyway, not an empty list the fix would
// pass vacuously against.
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

const addedWhInput = (over: Partial<AddedWarehouseInput> = {}): AddedWarehouseInput => ({
  id: "aw-1",
  displayCode: "WH-NV-RENO-01",
  city: "Reno",
  state: "NV",
  lat: 39.5,
  lng: -119.8,
  capacity: null,
  status: "active",
  ...over,
});

function renderDeliveryMap(overrides: {
  onInputsChange?: ReturnType<typeof vi.fn>;
  warehouses?: MapWarehouse[];
  customers?: MapCustomer[];
  inputs?: Partial<PMedianMapInputs>;
  onSave?: ReturnType<typeof vi.fn>;
} = {}) {
  const onInputsChange = overrides.onInputsChange ?? vi.fn();
  const result = render(
    <InputMapTab
      mode="pmedian"
      fixedGeography
      warehouses={overrides.warehouses ?? [baseWh()]}
      customers={overrides.customers ?? [baseCs()]}
      inputs={basePMedianInputs(overrides.inputs)}
      countryBounds={{ sw: [24, -125], ne: [50, -66] }}
      onInputsChange={onInputsChange}
      {...(overrides.onSave ? { onSave: overrides.onSave, isDirty: true } : {})}
    />,
  );
  return { onInputsChange, ...result };
}

// §14.5 — the delivery map continues to refuse every GEOMETRY change (add,
// copy, move, delete, coordinates), but status and demand editing are now
// live (Task 9's fully-read-only world is what this suite used to pin —
// these assertions invert, per Task 6's own brief, the same explicit
// inversion Task 7 performs for CostSummaryTab.test.tsx). B1 (review) — the
// finding that mattered here was never "is the control present" (a stub
// onInputsChange makes that trivially true even when broken); every edit
// test below asserts the ACTUAL onInputsChange call and its payload.
describe("InputMapTab pmedian — fixedGeography (delivery-teaching-us, §14.5)", () => {
  // Real testids at 3065c91 — arming chips (place-wh/place-cs), each gated
  // directly on `!fixedGeography` at its own render site (InputMapTab.tsx),
  // so this genuinely exercises the gate. `armed-status-bar`/
  // `button-armed-cancel` are dropped from this table (B1 follow-up): they
  // render only from an `armed` state that Move/Copy alone can set, and
  // Move/Copy are themselves already proven hidden under fixedGeography by
  // "Move/Copy/Delete stay hidden" below — so with no reachable path to
  // `armed`, asserting their absence here was true regardless of the
  // fixedGeography gate, not because of it.
  it.each([
    "button-input-map-place-wh",
    "button-input-map-place-cs",
  ])("still hides %s — geography stays fixed", testid => {
    renderDeliveryMap();
    expect(screen.queryByTestId(testid)).toBeNull();
  });

  // Layers-row Save — §14.5 keeps this hidden even when status/demand edits
  // are live AND a caller wires a real onSave (the exact "future caller
  // mistakenly wires onSave" case the component's own comment names).
  // Passing onSave here is what makes this discriminating: without it, the
  // row passed vacuously (onSave was never supplied, so `onSave &&` alone
  // already hides the button regardless of fixedGeography).
  it("still hides button-save even when onSave is supplied — geography stays fixed", () => {
    renderDeliveryMap({ onSave: vi.fn() });
    expect(screen.queryByTestId("button-save")).toBeNull();
  });

  it("right-click on empty map space does not open the add menu — adding a row is a geometry change", () => {
    const { container } = renderDeliveryMap();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    expect(screen.queryByTestId("map-add-menu")).toBeNull();
    expect(screen.queryByTestId("map-add-menu-wh")).toBeNull();
  });

  it("still renders the map root and legend", () => {
    renderDeliveryMap();
    expect(screen.getByTestId("input-map-tab")).toBeInTheDocument(); // root testid; there is no "input-map"
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
  });

  it("left-clicking a marker shows the details card with a narrowed footer hint (Edit only)", () => {
    const { container } = renderDeliveryMap();
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.click(markers[0]);
    expect(screen.getByTestId("map-details-lat")).toBeInTheDocument();
    expect(screen.getByTestId("map-details-footer")).toHaveTextContent("Right-click for Edit");
    expect(screen.getByTestId("map-details-footer")).not.toHaveTextContent("Move");
  });

  it("right-click on a marker opens the action menu with Edit only — Move/Copy/Delete stay hidden", () => {
    const { container } = renderDeliveryMap();
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    expect(screen.getByTestId("map-action-menu")).toBeInTheDocument();
    expect(screen.getByTestId("map-action-edit")).toBeInTheDocument();
    for (const a of ["move", "copy", "delete"]) {
      expect(screen.queryByTestId(`map-action-${a}`)).toBeNull();
    }
  });

  // B1 — the finding this task exists to close. A control being present
  // (map-action-edit, edit-warehouse-status-*) proves nothing if the
  // caller's `onInputsChange` is a no-op (Workspace.tsx's former
  // PMEDIAN_MAP_READONLY_NOOP) — only asserting the call itself catches
  // that class of bug.
  it("routes a warehouse status edit to onInputsChange with the new status", () => {
    const { container, onInputsChange } = renderDeliveryMap({
      warehouses: [baseWh({ status: "active" })],
      customers: [],
    });
    const marker = container.querySelector(".leaflet-marker-icon")!;
    fireEvent.contextMenu(marker);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("edit-warehouse-dialog")).toBeInTheDocument();
    // capacityModes:[] for delivery-teaching-us — capacityMode="none" on the
    // inputs slice must suppress the capacity field entirely, not just
    // leave it disabled/empty.
    expect(screen.queryByTestId("edit-warehouse-capacity")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("edit-warehouse-status-inactive"));
    fireEvent.click(screen.getByTestId("edit-warehouse-save"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    expect(onInputsChange.mock.calls[0][0].warehouseOverrides).toContainEqual(
      expect.objectContaining({ id: "CHI", status: "inactive" }),
    );
  });

  it("routes a customer demand edit to onInputsChange with the new demand", () => {
    const { container, onInputsChange } = renderDeliveryMap({
      warehouses: [],
      customers: [baseCs({ demand: 100 })],
    });
    const marker = container.querySelector(".leaflet-marker-icon")!;
    fireEvent.contextMenu(marker);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("edit-customer-dialog")).toBeInTheDocument();

    // EditCustomerDialog commits on every keystroke into local component
    // state (`onChange` -> `setDemand`/`onLivePreview`) and only reaches
    // `onInputsChange` via the dialog's own Save button — unlike the
    // draft-until-blur pattern CLAUDE.md's Gotchas warns about elsewhere in
    // this repo, this is a modal Save-button commit (confirmed against
    // EditCustomerDialog.test.tsx's own established interaction pattern:
    // `fireEvent.change` + `fireEvent.click(save)`, never a blur).
    fireEvent.change(screen.getByTestId("edit-customer-demand-input"), { target: { value: "12345" } });
    fireEvent.click(screen.getByTestId("edit-customer-save"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    expect(onInputsChange.mock.calls[0][0].customerOverrides).toContainEqual(
      expect.objectContaining({ id: "C1", demand: 12345 }),
    );
  });

  it("routes a customer exclusion edit to onInputsChange with the new status", () => {
    const { container, onInputsChange } = renderDeliveryMap({
      warehouses: [],
      customers: [baseCs({ excluded: false })],
    });
    const marker = container.querySelector(".leaflet-marker-icon")!;
    fireEvent.contextMenu(marker);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    fireEvent.click(screen.getByTestId("edit-customer-status-excluded"));
    fireEvent.click(screen.getByTestId("edit-customer-save"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    expect(onInputsChange.mock.calls[0][0].customerOverrides).toContainEqual(
      expect.objectContaining({ id: "C1", status: "excluded" }),
    );
  });
});

// InputMapTab.tsx's `draggableIds` — computed from `isAdded`, gated on
// `fixedGeography` explicitly (not left to follow implicitly from
// delivery-teaching-us never populating addedWarehouses/addedCustomers).
// This suite makes an added entity genuinely present via `warehouses` AND
// `inputs.addedWarehouses` (the real data path), so a green result can't be
// explained by the added-entity list being empty.
describe("InputMapTab pmedian — fixedGeography with an added entity present", () => {
  it("no marker is draggable, even though an added warehouse exists in warehouses and inputs.addedWarehouses", () => {
    const { container } = renderDeliveryMap({
      warehouses: [baseWh(), addedWh()],
      inputs: { addedWarehouses: [addedWhInput()] },
    });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    expect(markers.length).toBeGreaterThan(0);
    markers.forEach(marker => {
      expect(marker.className).not.toContain("leaflet-marker-draggable");
    });
  });
});
