import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";
import type { AddedWarehouseInput, MapWarehouse, MapCustomer, PMedianMapInputs } from "@/components/workspace/map/types";

// T8 (Bundle 2.2, A3) — PMedianInputMap now calls `useListModels()`
// internally (to derive `supportsAddedCustomerExclusion`), so every render
// in this file needs SOME mock or a real QueryClientProvider ancestor. An
// empty list is a safe default — every capability lookup resolves to
// `false` (control hidden), matching this file's existing assertions (none
// of which pass `modelId`, so the added-customer status control was never
// meant to show here).
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => ({ data: [] }),
}));

// T8 (Input Map v2) — the pmedian-mode surface under test here composes T4's
// EntityMarkers/MapLegend, T5's inspect card/action menu, T6's edit
// dialogs, and T7's create/move dialogs, all real (not mocked) under jsdom —
// same convention EntityMarkers.test.tsx already establishes ("Real
// MapContainer + real Marker under jsdom ... rather than a hand-rolled
// react-leaflet mock"), since Leaflet's own event wiring (Marker
// bubblingMouseEvents:false, contextmenu stopPropagation) is exactly what
// this integration needs to exercise for real.

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

// T4 (Bundle 2) — MapWarehouse.status is optional now (a hasStatus:false
// role, e.g. a mine, never sets it); AddedWarehouseInput.status stays
// required (it's the persisted shape, still p-median-us-only here). Kept as
// a SEPARATE factory (same default values as addedWh) rather than reusing
// addedWh's return, matching this file's own header-comment distinction
// between view-model and persisted shapes.
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
  // T4/R4 — all optional, undefined `onSave` (every existing call site in
  // this file) means "no Save control wired", matching the codebase's
  // standing capability-gate convention rather than a mode check.
  isDirty?: boolean;
  onSave?: () => void;
  saving?: boolean;
} = {}) {
  const onInputsChange = vi.fn();
  const view = render(
    <InputMapTab
      mode="pmedian"
      warehouses={over.warehouses ?? [baseWh()]}
      customers={over.customers ?? [cs()]}
      inputs={over.inputs ?? makeInputs()}
      onInputsChange={onInputsChange}
      isDirty={over.isDirty}
      onSave={over.onSave}
      saving={over.saving}
    />,
  );
  return { ...view, onInputsChange };
}

describe("InputMapTab — mode dispatch", () => {
  it("pmedian mode renders the real toolbar and MapLegend", () => {
    renderPMedian();
    expect(screen.getByTestId("pmedian-map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
  });
});

describe("InputMapTab — pmedian mode: create", () => {
  it("right-click empty map → Add warehouse here → CreateEntityDialog submit → onInputsChange gains an addedWarehouses row whose id starts with 'aw-'", () => {
    const { container, onInputsChange } = renderPMedian();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));

    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedWarehouses).toHaveLength(1);
    expect(next.addedWarehouses[0].id).toMatch(/^aw-/);
    // Untouched siblings.
    expect(next.warehouseOverrides).toEqual([]);
    expect(next.customerOverrides).toEqual([]);
    expect(next.addedCustomers).toEqual([]);
  });

  it("right-click empty map → Add customer here → CreateEntityDialog submit → onInputsChange gains an addedCustomers row whose id starts with 'ac-'", () => {
    const { container, onInputsChange } = renderPMedian();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-cs"));
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedCustomers).toHaveLength(1);
    expect(next.addedCustomers[0].id).toMatch(/^ac-/);
  });

  it("the '+ Warehouse' pin-mode toggle opens CreateEntityDialog directly on the next map click", () => {
    const { container, onInputsChange } = renderPMedian();
    fireEvent.click(screen.getByTestId("button-input-map-place-wh"));
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 30, clientY: 30 });

    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-submit"));
    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedWarehouses).toHaveLength(1);
  });
});

describe("InputMapTab — pmedian mode: delete", () => {
  it("deletes an added warehouse: row AND its distanceOverrides (by id) are gone, override arrays untouched", () => {
    const inputs = makeInputs({
      addedWarehouses: [addedWhInput()],
      warehouseOverrides: [{ id: "CHI", status: "forced_open", capacity: null }],
      customerOverrides: [{ id: "C1", status: "active", demand: 250 }],
      distanceOverrides: [
        { fromId: "aw-1", toId: "C1", distance: 500, estimated: true },
        { fromId: "CHI", toId: "C1", distance: 100 },
      ],
    });
    const { container, onInputsChange } = renderPMedian({ warehouses: [baseWh(), addedWh()], inputs });

    const markers = container.querySelectorAll(".leaflet-marker-icon");
    // Base warehouse, then added warehouse, then customer — matches
    // pmedianMapWarehouses' [...base, ...added] projection order, warehouses
    // rendered before customers by EntityMarkers.
    fireEvent.contextMenu(markers[1]);
    expect(screen.getByTestId("map-action-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-action-delete")); // first click arms the confirm
    fireEvent.click(screen.getByTestId("map-action-delete")); // second click confirms

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedWarehouses).toEqual([]);
    expect(next.distanceOverrides).toEqual([{ fromId: "CHI", toId: "C1", distance: 100 }]);
    // Untouched.
    expect(next.warehouseOverrides).toEqual([{ id: "CHI", status: "forced_open", capacity: null }]);
    expect(next.customerOverrides).toEqual([{ id: "C1", status: "active", demand: 250 }]);
  });
});

describe("InputMapTab — pmedian mode: move", () => {
  it("moving an added entity keeps its id unchanged, updates displayCode/coords, clears its own distanceOverrides, and leaves override arrays untouched", () => {
    const inputs = makeInputs({
      addedWarehouses: [addedWhInput()],
      warehouseOverrides: [{ id: "CHI", status: "inactive", capacity: null }],
      distanceOverrides: [
        { fromId: "aw-1", toId: "C1", distance: 500, estimated: true },
        { fromId: "CHI", toId: "C1", distance: 100 },
      ],
    });
    const { container, onInputsChange } = renderPMedian({ warehouses: [baseWh(), addedWh()], inputs });

    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    expect(screen.getByTestId("armed-status-bar")).toBeInTheDocument();

    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 10, clientY: 10 });
    expect(screen.getByTestId("move-confirm-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-confirm-confirm"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedWarehouses).toHaveLength(1);
    expect(next.addedWarehouses[0].id).toBe("aw-1"); // D7 — id never changes on move
    expect(next.addedWarehouses[0].lat).not.toBe(addedWh().lat);
    expect(next.addedWarehouses[0].lng).not.toBe(addedWh().lng);
    expect(next.distanceOverrides).toEqual([{ fromId: "CHI", toId: "C1", distance: 100 }]);
    expect(next.warehouseOverrides).toEqual([{ id: "CHI", status: "inactive", capacity: null }]);
  });

  it("Escape cancels an armed Move without calling onInputsChange", () => {
    const inputs = makeInputs({ addedWarehouses: [addedWhInput()] });
    const { container, onInputsChange } = renderPMedian({ warehouses: [baseWh(), addedWh()], inputs });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    expect(screen.getByTestId("armed-status-bar")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("armed-status-bar")).not.toBeInTheDocument();
    expect(onInputsChange).not.toHaveBeenCalled();
  });
});

describe("InputMapTab — pmedian mode: base vs added action menu", () => {
  it("a BASE entity's action menu has Edit/Copy only — no Delete or Move", () => {
    const { container } = renderPMedian({ warehouses: [baseWh()] });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    expect(screen.getByTestId("map-action-menu")).toBeInTheDocument();
    expect(screen.getByTestId("map-action-edit")).toBeInTheDocument();
    expect(screen.getByTestId("map-action-copy")).toBeInTheDocument();
    expect(screen.queryByTestId("map-action-delete")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-action-move")).not.toBeInTheDocument();
  });

  it("an ADDED entity's action menu has all four actions", () => {
    const { container } = renderPMedian({ warehouses: [addedWh()] });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    expect(screen.getByTestId("map-action-edit")).toBeInTheDocument();
    expect(screen.getByTestId("map-action-move")).toBeInTheDocument();
    expect(screen.getByTestId("map-action-copy")).toBeInTheDocument();
    expect(screen.getByTestId("map-action-delete")).toBeInTheDocument();
  });
});

describe("InputMapTab — pmedian mode: edit", () => {
  it("editing a BASE warehouse's status writes into warehouseOverrides, not addedWarehouses", () => {
    const { container, onInputsChange } = renderPMedian({ warehouses: [baseWh()] });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("edit-warehouse-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("edit-warehouse-status-forced_open"));
    fireEvent.click(screen.getByTestId("edit-warehouse-save"));

    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.warehouseOverrides).toEqual([{ id: "CHI", status: "forced_open", capacity: undefined }]);
    expect(next.addedWarehouses).toEqual([]);
  });

  it("editing an ADDED warehouse's status mutates its own row, not warehouseOverrides", () => {
    const inputs = makeInputs({ addedWarehouses: [addedWhInput()] });
    const { container, onInputsChange } = renderPMedian({ warehouses: [addedWh()], inputs });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    fireEvent.click(screen.getByTestId("edit-warehouse-status-inactive"));
    fireEvent.click(screen.getByTestId("edit-warehouse-save"));

    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedWarehouses[0]).toMatchObject({ id: "aw-1", status: "inactive" });
    expect(next.warehouseOverrides).toEqual([]);
  });

  it("editing a customer's demand preserves the existing override status", () => {
    const inputs = makeInputs({ customerOverrides: [{ id: "C1", status: "excluded", demand: null }] });
    const { container, onInputsChange } = renderPMedian({ warehouses: [], customers: [cs({ excluded: true })], inputs });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("edit-customer-dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("edit-customer-demand-input"), { target: { value: "300" } });
    fireEvent.click(screen.getByTestId("edit-customer-save"));

    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.customerOverrides).toEqual([{ id: "C1", status: "excluded", demand: 300 }]);
  });
});

describe("InputMapTab — pmedian mode: copy", () => {
  it("copying a BASE warehouse produces a brand-new added row, and the base row is unaffected", () => {
    const { container, onInputsChange } = renderPMedian({ warehouses: [baseWh({ capacity: 5000 })] });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-copy"));
    expect(screen.getByTestId("armed-status-bar")).toBeInTheDocument();

    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 15, clientY: 15 });
    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedWarehouses).toHaveLength(1);
    expect(next.addedWarehouses[0].id).toMatch(/^aw-/);
    expect(next.addedWarehouses[0].id).not.toBe("CHI");
  });
});

// T4/R4 — Save relocated into the Layers row, capability-gated on `onSave`
// being wired (not on `mode` alone) — Workspace.tsx.test coverage proves the
// end-to-end wiring/gating against a real toolbar suppression; this file
// proves the component's own contract in isolation.
describe("InputMapTab — pmedian mode: R4 Save-in-Layers", () => {
  it("renders no Save control when onSave isn't wired (every other existing caller in this file)", () => {
    renderPMedian();
    expect(screen.queryByTestId("button-save")).not.toBeInTheDocument();
  });

  it("renders Save inside the Layers row, disabled, when onSave is wired but nothing is dirty", () => {
    renderPMedian({ onSave: vi.fn(), isDirty: false });
    const toolbar = screen.getByTestId("pmedian-map-toolbar");
    const saveButton = screen.getByTestId("button-save");
    expect(toolbar).toContainElement(saveButton);
    expect(saveButton).toBeDisabled();
    expect(screen.queryByTestId("text-unsaved-changes")).not.toBeInTheDocument();
  });

  it("shows 'Unsaved changes' and an enabled Save while dirty, and calls onSave on click", () => {
    const onSave = vi.fn();
    renderPMedian({ onSave, isDirty: true });
    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
    const saveButton = screen.getByTestId("button-save");
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("disables Save (and shows 'Saving…') while a save is in flight, even though dirty", () => {
    renderPMedian({ onSave: vi.fn(), isDirty: true, saving: true });
    const saveButton = screen.getByTestId("button-save");
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveTextContent("Saving…");
  });
});
