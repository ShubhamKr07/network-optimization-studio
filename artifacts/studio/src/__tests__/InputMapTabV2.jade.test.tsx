import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, fireEvent, screen } from "@testing-library/react";
import { UnitProvider } from "@/contexts/UnitContext";

// chen-bands-units, Part D — components rendered inside this tree now read the
// display-unit preference via useDisplayUnit(), which throws without a
// provider. main.tsx already wraps the real app (T10); these tests render the
// component directly, so they need the same ancestor. RTL's `wrapper` option is
// used rather than a wrapping element so `rerender` keeps the provider too.
const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(ui, { wrapper: UnitProvider, ...options });

import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";
import type { MapWarehouse, MapCustomer, MapPlant } from "@/components/workspace/map/types";
import type { JadeMapInputs } from "@/components/workspace/tabs/InputMapTab";

// jade-T12 (Chapter 9 JADE) — JadeInputMap now calls `useListModels()`
// internally (to derive `supportsAddedCustomerExclusion`), same as
// InputMapTabV2.twoEchelon.test.tsx's own identical mock.
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => ({ data: [] }),
}));

// jade-T12 — two-echelon-jade-us's full-v2 Input Map editor: the FIRST mode
// with THREE interactive entity kinds (plants join warehouses/customers).
// Same real-jsdom composition convention InputMapTabV2.twoEchelon.test.tsx
// establishes (T4's EntityMarkers/MapLegend, T5's inspect card/action menu,
// T6's edit dialogs, T7's create/move dialogs, all real, none mocked) —
// this file proves the same contract holds for "jade" mode's own
// mutators/role wiring (JADE_WAREHOUSE_ROLE — hasStatus:true, no capacity
// at all — PLANT_ROLE — no status, no value field — default CUSTOMER_ROLE),
// PLUS the plant delete/copy reconciliation (fix #5).

const PRODUCTS = [
  { id: "product-1", name: "Product 1" },
  { id: "product-2", name: "Product 2" },
  { id: "product-3", name: "Product 3" },
  { id: "product-4", name: "Product 4" },
];

const basePlant = (over: Partial<MapPlant> = {}): MapPlant => ({
  id: "plant-1",
  displayCode: "PL-KY-ASHLAND-01",
  city: "Ashland",
  state: "KY",
  lat: 38.45,
  lng: -82.67,
  isAdded: false,
  ...over,
});

const addedPlant = (over: Partial<MapPlant> = {}): MapPlant => ({
  id: "ap-1",
  displayCode: "PL-TX-DALLAS-01",
  city: "Dallas",
  state: "TX",
  lat: 32.78,
  lng: -96.8,
  isAdded: true,
  ...over,
});

const baseWarehouse = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "wh-8",
  displayCode: "WH-GA-ATLANTA-01",
  city: "Atlanta",
  state: "GA",
  lat: 33.75,
  lng: -84.39,
  status: "active",
  isAdded: false,
  ...over,
});

const addedWarehouse = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "aw-1",
  displayCode: "WH-CA-FRESNO-01",
  city: "Fresno",
  state: "CA",
  lat: 36.74,
  lng: -119.77,
  status: "active",
  isAdded: true,
  ...over,
});

const baseCustomer = (over: Partial<MapCustomer> = {}): MapCustomer => ({
  id: "customer-76",
  displayCode: "CS-OH-AKRON-01",
  city: "Akron",
  state: "OH",
  lat: 41.04,
  lng: -81.52,
  demand: 6479,
  excluded: false,
  isAdded: false,
  ...over,
});

function makeInputs(over: Partial<JadeMapInputs> = {}): JadeMapInputs {
  return {
    addedPlants: [],
    addedWarehouses: [],
    addedCustomers: [],
    warehouseOverrides: [],
    customerOverrides: [],
    plantProductCapability: [],
    distanceOverrides: [],
    ...over,
  };
}

function renderJade(over: {
  plants?: MapPlant[];
  warehouses?: MapWarehouse[];
  customers?: MapCustomer[];
  inputs?: JadeMapInputs;
  isDirty?: boolean;
  onSave?: () => void;
  saving?: boolean;
} = {}) {
  const onInputsChange = vi.fn();
  const view = render(
    <InputMapTab
      mode="jade"
      products={PRODUCTS}
      plants={over.plants ?? [basePlant()]}
      warehouses={over.warehouses ?? [baseWarehouse()]}
      customers={over.customers ?? [baseCustomer()]}
      inputs={over.inputs ?? makeInputs()}
      onInputsChange={onInputsChange}
      isDirty={over.isDirty}
      onSave={over.onSave}
      saving={over.saving}
    />,
  );
  return { ...view, onInputsChange };
}

describe("InputMapTab — jade mode dispatch (full editor, not legacy/placeholder)", () => {
  it("renders the jade toolbar and MapLegend, not any other mode's toolbar", () => {
    renderJade();
    expect(screen.getByTestId("jade-map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("pmedian-map-toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("transport-map-toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("two-echelon-map-toolbar")).not.toBeInTheDocument();
  });

  it("renders Plants/Warehouses/Customers layer toggles and +Plant/+Warehouse/+Customer add-on-map buttons", () => {
    renderJade();
    expect(screen.getByTestId("toggle-layer-plants")).toHaveTextContent("Plants");
    expect(screen.getByTestId("toggle-layer-warehouses")).toHaveTextContent("Warehouses");
    expect(screen.getByTestId("toggle-layer-customers")).toHaveTextContent("Customers");
    expect(screen.getByTestId("button-input-map-place-pl")).toHaveTextContent("+ Plant");
    expect(screen.getByTestId("button-input-map-place-wh")).toHaveTextContent("+ Warehouse");
    expect(screen.getByTestId("button-input-map-place-cs")).toHaveTextContent("+ Customer");
  });

  it("renders one marker per plant/warehouse/customer — all three kinds, real EntityMarkers, none mocked", () => {
    const { container } = renderJade();
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    expect(markers).toHaveLength(3);
    expect(container.querySelector(".pl-marker")).not.toBeNull();
    expect(container.querySelector(".wh-marker")).not.toBeNull();
    expect(container.querySelector(".cs-marker")).not.toBeNull();
  });

  it("shows the plant legend row plus the warehouse status legend (JADE warehouses DO have status)", () => {
    renderJade();
    expect(screen.getByTestId("legend-plant")).toBeInTheDocument();
    expect(screen.getByTestId("legend-status-active")).toBeInTheDocument();
  });
});

describe("InputMapTab — jade mode: create a plant", () => {
  it("right-click empty map → Add plant here → CreateEntityDialog submit → onInputsChange gains an addedPlants row minting an 'ap-'/'PL-' identity, NO status/capacity field", () => {
    const { container, onInputsChange } = renderJade();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-pl"));

    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("New plant");
    // PLANT_ROLE has no status/capacity/demand field at all.
    expect(screen.queryByTestId("create-entity-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-entity-capacity")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-entity-demand")).not.toBeInTheDocument();
    expect(screen.getByTestId("create-entity-display-code")).toHaveTextContent(/^PL-/);
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as JadeMapInputs;
    expect(next.addedPlants).toHaveLength(1);
    expect(next.addedPlants[0].id).toMatch(/^ap-/);
    expect(next.addedPlants[0].displayCode).toMatch(/^PL-/);
    // Untouched siblings.
    expect(next.addedWarehouses).toEqual([]);
    expect(next.addedCustomers).toEqual([]);
    expect(next.plantProductCapability).toEqual([]);
    expect(next.distanceOverrides).toEqual([]);
  });

  it("a created added plant starts with NO plantProductCapability entries at all — every product defaults disabled (spec §6)", () => {
    const { container, onInputsChange } = renderJade();
    fireEvent.click(screen.getByTestId("button-input-map-place-pl"));
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 30, clientY: 30 });
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const next = onInputsChange.mock.calls[0][0] as JadeMapInputs;
    expect(next.addedPlants).toHaveLength(1);
    expect(next.plantProductCapability).toEqual([]);
  });

  it("the '+ Plant' pin-mode toggle opens CreateEntityDialog directly on the next map click", () => {
    const { container, onInputsChange } = renderJade();
    fireEvent.click(screen.getByTestId("button-input-map-place-pl"));
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 30, clientY: 30 });

    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-submit"));
    const next = onInputsChange.mock.calls[0][0] as JadeMapInputs;
    expect(next.addedPlants).toHaveLength(1);
  });
});

describe("InputMapTab — jade mode: copy a plant", () => {
  it("copy-plant (armed copy → click) shows the (copy) title and submits geometry only — no products enabled from a copy", () => {
    const { container, onInputsChange } = renderJade({ plants: [basePlant()] });
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // Plants render first (EntityMarkers' own order) — index 0.
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-copy"));
    expect(screen.getByTestId("armed-status-bar")).toBeInTheDocument();

    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 15, clientY: 15 });
    expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("(copy)");
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const next = onInputsChange.mock.calls[0][0] as JadeMapInputs;
    expect(next.addedPlants).toHaveLength(1);
    // Copying a BASE plant (which itself may have base capability cells)
    // still yields an added plant with zero capability overrides — the
    // added plant has no base-matrix row of its own, so it defaults off.
    expect(next.plantProductCapability).toEqual([]);
  });
});

describe("InputMapTab — jade mode: delete a plant (fix #5 reconciliation)", () => {
  it("deleting an added plant removes its own row, its plantProductCapability overrides, and its plant->warehouse distance rows — leaves other plants'/warehouses'/customers' overrides untouched", () => {
    const inputs = makeInputs({
      addedPlants: [{ id: "ap-1", displayCode: "PL-TX-DALLAS-01", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8 }],
      plantProductCapability: [
        { plantId: "ap-1", productId: "product-1", enabled: true },
        { plantId: "ap-1", productId: "product-2", enabled: true },
        { plantId: "plant-1", productId: "product-1", enabled: true }, // a DIFFERENT plant's override — must survive
      ],
      warehouseOverrides: [{ id: "wh-8", status: "forced_open" }],
      customerOverrides: [{ id: "customer-76", status: "active", demands: { "product-1": 100 } }],
      distanceOverrides: [
        { leg: "plant_to_warehouse", fromId: "ap-1", toId: "wh-8", distance: 500 },
        { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-8", distance: 398.9 }, // survives
        { leg: "warehouse_to_customer", fromId: "wh-8", toId: "customer-76", distance: 622.1 }, // survives
      ],
    });
    const { container, onInputsChange } = renderJade({ plants: [basePlant(), addedPlant()], inputs });

    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // Plants render first: base plant (0), added plant (1).
    fireEvent.contextMenu(markers[1]);
    expect(screen.getByTestId("map-action-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-action-delete"));
    fireEvent.click(screen.getByTestId("map-action-delete")); // confirm

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as JadeMapInputs;
    expect(next.addedPlants).toEqual([]);
    // The deleted plant's OWN capability overrides are gone...
    expect(next.plantProductCapability).toEqual([{ plantId: "plant-1", productId: "product-1", enabled: true }]);
    // ...and its OWN distance rows are gone, but a sibling plant's and the
    // warehouse->customer row survive untouched.
    expect(next.distanceOverrides).toEqual([
      { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-8", distance: 398.9 },
      { leg: "warehouse_to_customer", fromId: "wh-8", toId: "customer-76", distance: 622.1 },
    ]);
    // warehouseOverrides/customerOverrides are never touched by a plant delete.
    expect(next.warehouseOverrides).toEqual([{ id: "wh-8", status: "forced_open" }]);
    expect(next.customerOverrides).toEqual([{ id: "customer-76", status: "active", demands: { "product-1": 100 } }]);
  });
});

describe("InputMapTab — jade mode: move a plant (never re-keys the id)", () => {
  it("moving an added plant keeps its id unchanged, updates coords, clears only its own distance rows", () => {
    const inputs = makeInputs({
      addedPlants: [{ id: "ap-1", displayCode: "PL-TX-DALLAS-01", city: "Dallas", state: "TX", lat: 32.78, lng: -96.8 }],
      distanceOverrides: [
        { leg: "plant_to_warehouse", fromId: "ap-1", toId: "wh-8", distance: 500 },
        { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-8", distance: 398.9 },
      ],
    });
    const { container, onInputsChange } = renderJade({ plants: [basePlant(), addedPlant()], inputs });

    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    expect(screen.getByTestId("armed-status-bar")).toBeInTheDocument();

    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 10, clientY: 10 });
    expect(screen.getByTestId("move-confirm-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-confirm-confirm"));

    const next = onInputsChange.mock.calls[0][0] as JadeMapInputs;
    expect(next.addedPlants).toHaveLength(1);
    expect(next.addedPlants[0].id).toBe("ap-1"); // never re-keyed
    expect(next.addedPlants[0].lat).not.toBe(addedPlant().lat);
    expect(next.distanceOverrides).toEqual([{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-8", distance: 398.9 }]);
  });
});

describe("InputMapTab — jade mode: edit a plant (no-op — nothing to edit here)", () => {
  it("opens a geometry-only inspect card via EditWarehouseDialog (PLANT_ROLE) with no Status/Capacity field, and Save writes nothing meaningful", () => {
    const { container, onInputsChange } = renderJade({ plants: [basePlant()] });
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("edit-warehouse-dialog")).toHaveTextContent("Edit plant");
    expect(screen.queryByTestId("edit-warehouse-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edit-warehouse-capacity")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("edit-warehouse-save"));
    // A BASE plant has no override array to write into at all — no crash,
    // no spurious onInputsChange call with a meaningless patch.
    expect(onInputsChange).not.toHaveBeenCalled();
  });
});

describe("InputMapTab — jade mode: warehouse create/edit/delete/move (JADE_WAREHOUSE_ROLE — status only, no capacity)", () => {
  it("creating a warehouse shows Status but no Capacity field, and mints an 'aw-' id", () => {
    const { container, onInputsChange } = renderJade();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));
    expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("New warehouse");
    expect(screen.getByTestId("create-entity-status")).toBeInTheDocument();
    expect(screen.queryByTestId("create-entity-capacity")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const next = onInputsChange.mock.calls[0][0] as JadeMapInputs;
    expect(next.addedWarehouses).toHaveLength(1);
    expect(next.addedWarehouses[0].id).toMatch(/^aw-/);
    expect(next.addedWarehouses[0].status).toBe("active");
    expect(next.addedWarehouses[0]).not.toHaveProperty("capacity");
  });

  it("editing a BASE warehouse's status writes into warehouseOverrides, no Capacity field shown", () => {
    const { container, onInputsChange } = renderJade({ warehouses: [baseWarehouse()] });
    // Plant (0) then warehouse (1).
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("edit-warehouse-dialog")).toHaveTextContent("Edit warehouse");
    expect(screen.getByTestId("edit-warehouse-status")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-warehouse-capacity")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("edit-warehouse-status-inactive"));
    fireEvent.click(screen.getByTestId("edit-warehouse-save"));

    const next = onInputsChange.mock.calls[0][0] as JadeMapInputs;
    expect(next.warehouseOverrides).toEqual([{ id: "wh-8", status: "inactive" }]);
    expect(next.addedWarehouses).toEqual([]);
  });

  it("deletes an added warehouse: row AND its distance rows (either leg) are gone", () => {
    const inputs = makeInputs({
      addedWarehouses: [{ id: "aw-1", displayCode: "WH-CA-FRESNO-01", city: "Fresno", state: "CA", lat: 36.74, lng: -119.77, status: "active" }],
      distanceOverrides: [
        { leg: "plant_to_warehouse", fromId: "plant-1", toId: "aw-1", distance: 300 },
        { leg: "warehouse_to_customer", fromId: "aw-1", toId: "customer-76", distance: 400 },
        { leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-8", distance: 398.9 },
      ],
    });
    const { container, onInputsChange } = renderJade({ warehouses: [baseWarehouse(), addedWarehouse()], inputs });
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // Plant(0), base wh(1), added wh(2).
    fireEvent.contextMenu(markers[2]);
    fireEvent.click(screen.getByTestId("map-action-delete"));
    fireEvent.click(screen.getByTestId("map-action-delete"));

    const next = onInputsChange.mock.calls[0][0] as JadeMapInputs;
    expect(next.addedWarehouses).toEqual([]);
    expect(next.distanceOverrides).toEqual([{ leg: "plant_to_warehouse", fromId: "plant-1", toId: "wh-8", distance: 398.9 }]);
  });
});

describe("InputMapTab — jade mode: customer edit writes an even per-product split", () => {
  it("editing a BASE customer's total demand writes a customerOverrides row with `demands` split evenly across all 4 products", () => {
    const { container, onInputsChange } = renderJade({ customers: [baseCustomer()] });
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // Plant(0), warehouse(1), customer(2).
    fireEvent.contextMenu(markers[2]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("edit-customer-dialog")).toHaveTextContent("Edit customer");
    fireEvent.change(screen.getByTestId("edit-customer-demand-input"), { target: { value: "8000" } });
    fireEvent.click(screen.getByTestId("edit-customer-save"));

    const next = onInputsChange.mock.calls[0][0] as JadeMapInputs;
    expect(next.customerOverrides).toHaveLength(1);
    const override = next.customerOverrides[0];
    expect(override.id).toBe("customer-76");
    expect(override.status).toBe("active");
    expect(Object.keys(override.demands ?? {}).sort()).toEqual(["product-1", "product-2", "product-3", "product-4"]);
    expect(Object.values(override.demands ?? {}).every((v) => v === 2000)).toBe(true);
  });

  it("creating a customer via the map produces an addedCustomers row with `demand` (sum) AND `demands` (even split), matching jadeInputsSchema's REQUIRED-COMPLETE addedCustomers[].demands", () => {
    const { container, onInputsChange } = renderJade();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-cs"));
    fireEvent.change(screen.getByTestId("create-entity-demand"), { target: { value: "4000" } });
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const next = onInputsChange.mock.calls[0][0] as JadeMapInputs;
    expect(next.addedCustomers).toHaveLength(1);
    const row = next.addedCustomers[0];
    expect(row.demand).toBe(4000);
    expect(Object.keys(row.demands ?? {}).sort()).toEqual(["product-1", "product-2", "product-3", "product-4"]);
    expect(Object.values(row.demands ?? {}).every((v) => v === 1000)).toBe(true);
  });
});

describe("InputMapTab — jade mode: R4 Save-in-Layers", () => {
  it("renders no Save control when onSave isn't wired", () => {
    renderJade();
    expect(screen.queryByTestId("button-save")).not.toBeInTheDocument();
  });

  it("shows 'Unsaved changes' and an enabled Save while dirty, inside the jade toolbar, and calls onSave on click", () => {
    const onSave = vi.fn();
    renderJade({ onSave, isDirty: true });
    const toolbar = screen.getByTestId("jade-map-toolbar");
    const saveButton = screen.getByTestId("button-save");
    expect(toolbar).toContainElement(saveButton);
    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
