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
import type { AddedWarehouseInput, AddedCustomerInput, MapWarehouse, MapCustomer, PMedianMapInputs } from "@/components/workspace/map/types";

// C4.13 — Chen's Cosmetics (chens-cosmetics-cn) is single-echelon
// warehouse→customer like p-median, so it renders the SAME "pmedian" mode
// InputMapTab (Workspace.tsx's fallback branch). These tests prove the
// move/delete client-side reconciliation (D7 stable-id contract + owned
// distanceOverrides purge) runs for a genuinely Chen-shaped scenario:
// `wh-`/`cs-` id namespace, km distances, capacityMode "none". The purge is
// what makes C4.7's added-entity estimator refill correct on the next Save
// (a moved/deleted entity's stale rows must be gone so the server re-estimates).
//
// PMedianInputMap calls `useListModels()` to gate the added-customer exclusion
// control by capability, so it's mocked to return Chen's real manifest
// capability (supportsAddedCustomerExclusion:true, C4.2) — the map + action
// menu are otherwise real (real MapContainer/Marker under jsdom), matching
// InputMapTabV2.test.tsx's convention.
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => ({
    data: [{ id: "chens-cosmetics-cn", capabilities: { supportsAddedCustomerExclusion: true } }],
  }),
}));

const baseWh = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "wh-40",
  displayCode: "wh-40",
  city: "Guangzhou",
  state: "",
  lat: 23.13,
  lng: 113.26,
  capacity: null,
  status: "active",
  isAdded: false,
  ...over,
});

const addedWh = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "aw-cn-1",
  displayCode: "WH-CN-SHENZHEN-01",
  city: "Shenzhen",
  state: "",
  lat: 22.54,
  lng: 114.06,
  capacity: null,
  status: "active",
  isAdded: true,
  ...over,
});

const addedWhInput = (over: Partial<AddedWarehouseInput> = {}): AddedWarehouseInput => ({
  id: "aw-cn-1",
  displayCode: "WH-CN-SHENZHEN-01",
  city: "Shenzhen",
  state: "",
  lat: 22.54,
  lng: 114.06,
  capacity: null,
  status: "active",
  ...over,
});

const baseCs = (over: Partial<MapCustomer> = {}): MapCustomer => ({
  id: "cs-1",
  displayCode: "cs-1",
  city: "Beijing",
  state: "",
  lat: 39.9,
  lng: 116.4,
  demand: 100,
  excluded: false,
  isAdded: false,
  ...over,
});

const addedCs = (over: Partial<MapCustomer> = {}): MapCustomer => ({
  id: "ac-cn-1",
  displayCode: "CS-CN-CHENGDU-01",
  city: "Chengdu",
  state: "",
  lat: 30.57,
  lng: 104.06,
  demand: 200,
  excluded: false,
  isAdded: true,
  ...over,
});

const addedCsInput = (over: Partial<AddedCustomerInput> = {}): AddedCustomerInput => ({
  id: "ac-cn-1",
  displayCode: "CS-CN-CHENGDU-01",
  city: "Chengdu",
  state: "",
  lat: 30.57,
  lng: 104.06,
  demand: 200,
  status: "active",
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

function renderChen(over: { warehouses?: MapWarehouse[]; customers?: MapCustomer[]; inputs?: PMedianMapInputs } = {}) {
  const onInputsChange = vi.fn();
  const view = render(
    <InputMapTab
      mode="pmedian"
      modelId="chens-cosmetics-cn"
      warehouses={over.warehouses ?? [baseWh()]}
      customers={over.customers ?? [baseCs()]}
      inputs={over.inputs ?? makeInputs()}
      onInputsChange={onInputsChange}
    />,
  );
  return { ...view, onInputsChange };
}

describe("InputMapTab — Chen (chens-cosmetics-cn) move reconciliation (C4.13)", () => {
  it("move-wh: moving an added warehouse keeps its id, updates coords, purges its own distanceOverrides, leaves unrelated rows + override arrays untouched", () => {
    const inputs = makeInputs({
      addedWarehouses: [addedWhInput()],
      warehouseOverrides: [{ id: "wh-40", status: "inactive", capacity: null }],
      distanceOverrides: [
        { fromId: "aw-cn-1", toId: "cs-1", distance: 500, estimated: true },
        { fromId: "wh-40", toId: "cs-1", distance: 100 },
      ],
    });
    const { container, onInputsChange } = renderChen({ warehouses: [baseWh(), addedWh()], customers: [baseCs()], inputs });

    // Marker order = [...warehouses, ...customers]; index 1 is the added wh.
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    expect(screen.getByTestId("armed-status-bar")).toBeInTheDocument();

    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 12, clientY: 12 });
    expect(screen.getByTestId("move-confirm-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-confirm-confirm"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedWarehouses).toHaveLength(1);
    expect(next.addedWarehouses[0].id).toBe("aw-cn-1"); // D7 — id never changes on move
    expect(next.addedWarehouses[0].lat).not.toBe(addedWh().lat);
    expect(next.addedWarehouses[0].lng).not.toBe(addedWh().lng);
    // The moved warehouse's own distance row is purged; the unrelated
    // wh-40->cs-1 row survives for C4.7 to leave alone on the next Save.
    expect(next.distanceOverrides).toEqual([{ fromId: "wh-40", toId: "cs-1", distance: 100 }]);
    expect(next.warehouseOverrides).toEqual([{ id: "wh-40", status: "inactive", capacity: null }]);
  });

  it("move-cs: moving an added customer keeps its id, updates coords, purges rows referencing it as toId, leaves unrelated rows + override arrays untouched", () => {
    const inputs = makeInputs({
      addedCustomers: [addedCsInput()],
      customerOverrides: [{ id: "cs-1", status: "active", demand: 250 }],
      distanceOverrides: [
        { fromId: "wh-40", toId: "ac-cn-1", distance: 800, estimated: true },
        { fromId: "wh-40", toId: "cs-1", distance: 100 },
      ],
    });
    const { container, onInputsChange } = renderChen({ warehouses: [baseWh()], customers: [addedCs()], inputs });

    // Marker order = [...warehouses, ...customers]; index 1 is the added cs.
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    expect(screen.getByTestId("armed-status-bar")).toBeInTheDocument();

    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 20, clientY: 20 });
    expect(screen.getByTestId("move-confirm-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-confirm-confirm"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedCustomers).toHaveLength(1);
    expect(next.addedCustomers[0].id).toBe("ac-cn-1"); // D7 — id never changes on move
    expect(next.addedCustomers[0].lat).not.toBe(addedCs().lat);
    expect(next.addedCustomers[0].lng).not.toBe(addedCs().lng);
    // The moved customer's own distance row (referenced as toId) is purged;
    // the unrelated wh-40->cs-1 row survives.
    expect(next.distanceOverrides).toEqual([{ fromId: "wh-40", toId: "cs-1", distance: 100 }]);
    expect(next.customerOverrides).toEqual([{ id: "cs-1", status: "active", demand: 250 }]);
  });
});

describe("InputMapTab — Chen (chens-cosmetics-cn) delete reconciliation (C4.13)", () => {
  it("delete-wh: deleting an added warehouse removes the row AND its distanceOverrides, override arrays untouched", () => {
    const inputs = makeInputs({
      addedWarehouses: [addedWhInput()],
      warehouseOverrides: [{ id: "wh-40", status: "forced_open", capacity: null }],
      customerOverrides: [{ id: "cs-1", status: "active", demand: 250 }],
      distanceOverrides: [
        { fromId: "aw-cn-1", toId: "cs-1", distance: 500, estimated: true },
        { fromId: "wh-40", toId: "cs-1", distance: 100 },
      ],
    });
    const { container, onInputsChange } = renderChen({ warehouses: [baseWh(), addedWh()], customers: [baseCs()], inputs });

    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]); // added warehouse
    fireEvent.click(screen.getByTestId("map-action-delete")); // arm
    fireEvent.click(screen.getByTestId("map-action-delete")); // confirm

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedWarehouses).toEqual([]);
    expect(next.distanceOverrides).toEqual([{ fromId: "wh-40", toId: "cs-1", distance: 100 }]);
    expect(next.warehouseOverrides).toEqual([{ id: "wh-40", status: "forced_open", capacity: null }]);
    expect(next.customerOverrides).toEqual([{ id: "cs-1", status: "active", demand: 250 }]);
  });

  it("delete-cs: deleting an added customer removes the row AND its distanceOverrides (by toId), override arrays untouched", () => {
    const inputs = makeInputs({
      addedCustomers: [addedCsInput()],
      customerOverrides: [{ id: "cs-1", status: "active", demand: 250 }],
      distanceOverrides: [
        { fromId: "wh-40", toId: "ac-cn-1", distance: 800, estimated: true },
        { fromId: "wh-40", toId: "cs-1", distance: 100 },
      ],
    });
    const { container, onInputsChange } = renderChen({ warehouses: [baseWh()], customers: [addedCs()], inputs });

    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]); // added customer
    fireEvent.click(screen.getByTestId("map-action-delete")); // arm
    fireEvent.click(screen.getByTestId("map-action-delete")); // confirm

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedCustomers).toEqual([]);
    expect(next.distanceOverrides).toEqual([{ fromId: "wh-40", toId: "cs-1", distance: 100 }]);
    expect(next.customerOverrides).toEqual([{ id: "cs-1", status: "active", demand: 250 }]);
  });
});
