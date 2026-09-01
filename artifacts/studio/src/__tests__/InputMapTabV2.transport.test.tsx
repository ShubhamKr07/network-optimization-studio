import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";
import type { MapWarehouse, MapCustomer } from "@/components/workspace/map/types";
import type { TransportMapInputs } from "@/components/workspace/tabs/InputMapTab";

// T6 (Bundle 2) — transport-coal's full-v2 Input Map editor. Same
// composition/real-jsdom convention InputMapTabV2.test.tsx already
// establishes for "pmedian" mode (T4's EntityMarkers/MapLegend, T5's inspect
// card/action menu, T6's edit dialogs, T7's create/move dialogs, all real,
// none mocked) — this file proves the SAME contract holds for "transport"
// mode's own mutators/role wiring (MINE_ROLE/STATION_ROLE, no status, no
// distanceOverrides — laneCostOverrides instead).

const baseMine = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "MN1",
  displayCode: "MN1",
  city: "Beckley",
  state: "WV",
  lat: 37.8,
  lng: -81.2,
  capacity: null,
  // Deliberately no `status` — mines are hasStatus:false (MINE_ROLE).
  isAdded: false,
  ...over,
});

const addedMine = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "am-1",
  displayCode: "MN-NV-RENO-01",
  city: "Reno",
  state: "NV",
  lat: 39.5,
  lng: -119.8,
  capacity: null,
  isAdded: true,
  ...over,
});

const baseStation = (over: Partial<MapCustomer> = {}): MapCustomer => ({
  id: "ST1",
  displayCode: "ST1",
  city: "Newark",
  state: "NJ",
  lat: 40.7,
  lng: -74.2,
  demand: 500,
  excluded: false,
  isAdded: false,
  ...over,
});

function makeInputs(over: Partial<TransportMapInputs> = {}): TransportMapInputs {
  return {
    addedMines: [],
    addedStations: [],
    laneCostOverrides: [],
    mineCapacities: {},
    stationDemands: {},
    ...over,
  };
}

function renderTransport(over: {
  mines?: MapWarehouse[];
  stations?: MapCustomer[];
  inputs?: TransportMapInputs;
  isDirty?: boolean;
  onSave?: () => void;
  saving?: boolean;
} = {}) {
  const onInputsChange = vi.fn();
  const view = render(
    <InputMapTab
      mode="transport"
      mines={over.mines ?? [baseMine()]}
      stations={over.stations ?? [baseStation()]}
      inputs={over.inputs ?? makeInputs()}
      onInputsChange={onInputsChange}
      isDirty={over.isDirty}
      onSave={over.onSave}
      saving={over.saving}
    />,
  );
  return { ...view, onInputsChange };
}

describe("InputMapTab — transport mode dispatch", () => {
  it("renders the transport toolbar and MapLegend, not the pmedian toolbar", () => {
    renderTransport();
    expect(screen.getByTestId("transport-map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("pmedian-map-toolbar")).not.toBeInTheDocument();
  });
});

describe("InputMapTab — transport mode: R3/R7 N/A (supportsFacilityStatus:false)", () => {
  it("renders no status legend row and no 'Show inactive' toggle", () => {
    renderTransport();
    expect(screen.queryByTestId("legend-status-active")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legend-status-forced_open")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legend-status-inactive")).not.toBeInTheDocument();
    expect(screen.queryByTestId("toggle-layer-show-inactive")).not.toBeInTheDocument();
  });

  it("a mine marker carries no status-* class (plain outline triangle)", () => {
    const { container } = renderTransport();
    const marker = container.querySelector(".leaflet-marker-icon")!;
    expect(marker.className).toContain("marker-outline");
    expect(marker.className).not.toMatch(/status-\w/);
  });
});

describe("InputMapTab — transport mode: create", () => {
  it("right-click empty map → Add warehouse here → CreateEntityDialog submit → onInputsChange gains an addedMines row, no status field", () => {
    const { container, onInputsChange } = renderTransport();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));

    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("New mine");
    // MINE_ROLE.hasStatus:false — no status radio group at all.
    expect(screen.queryByTestId("create-entity-status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as TransportMapInputs;
    expect(next.addedMines).toHaveLength(1);
    expect(next.addedMines[0].id).toMatch(/^am-/);
    expect(next.addedMines[0]).not.toHaveProperty("status");
    // Untouched siblings.
    expect(next.addedStations).toEqual([]);
    expect(next.laneCostOverrides).toEqual([]);
    expect(next.mineCapacities).toEqual({});
    expect(next.stationDemands).toEqual({});
  });

  it("right-click empty map → Add customer here → onInputsChange gains an addedStations row", () => {
    const { container, onInputsChange } = renderTransport();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-cs"));
    expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("New station");
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const next = onInputsChange.mock.calls[0][0] as TransportMapInputs;
    expect(next.addedStations).toHaveLength(1);
    expect(next.addedStations[0].id).toMatch(/^as-/);
  });

  it("the '+ Mine' pin-mode toggle opens CreateEntityDialog directly on the next map click", () => {
    const { container, onInputsChange } = renderTransport();
    fireEvent.click(screen.getByTestId("button-input-map-place-wh"));
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 30, clientY: 30 });

    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-submit"));
    const next = onInputsChange.mock.calls[0][0] as TransportMapInputs;
    expect(next.addedMines).toHaveLength(1);
  });
});

describe("InputMapTab — transport mode: delete", () => {
  it("deletes an added mine: row AND its laneCostOverrides (by id) are gone, mineCapacities/stationDemands untouched", () => {
    const inputs = makeInputs({
      addedMines: [{ id: "am-1", displayCode: "MN-NV-RENO-01", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, capacity: null }],
      mineCapacities: { MN1: 5000 },
      stationDemands: { ST1: 900 },
      laneCostOverrides: [
        { fromId: "am-1", toId: "ST1", cost: 50 },
        { fromId: "MN1", toId: "ST1", cost: 10 },
      ],
    });
    const { container, onInputsChange } = renderTransport({ mines: [baseMine(), addedMine()], inputs });

    const markers = container.querySelectorAll(".leaflet-marker-icon");
    // Base mine, then added mine, then station — matches transportMapMines'
    // [...base, ...added] projection order.
    fireEvent.contextMenu(markers[1]);
    expect(screen.getByTestId("map-action-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-action-delete"));
    fireEvent.click(screen.getByTestId("map-action-delete"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as TransportMapInputs;
    expect(next.addedMines).toEqual([]);
    expect(next.laneCostOverrides).toEqual([{ fromId: "MN1", toId: "ST1", cost: 10 }]);
    expect(next.mineCapacities).toEqual({ MN1: 5000 });
    expect(next.stationDemands).toEqual({ ST1: 900 });
  });
});

describe("InputMapTab — transport mode: move", () => {
  it("moving an added mine keeps its id unchanged, updates coords, clears its own laneCostOverrides", () => {
    const inputs = makeInputs({
      addedMines: [{ id: "am-1", displayCode: "MN-NV-RENO-01", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, capacity: null }],
      laneCostOverrides: [
        { fromId: "am-1", toId: "ST1", cost: 50 },
        { fromId: "MN1", toId: "ST1", cost: 10 },
      ],
    });
    const { container, onInputsChange } = renderTransport({ mines: [baseMine(), addedMine()], inputs });

    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    expect(screen.getByTestId("armed-status-bar")).toBeInTheDocument();

    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 10, clientY: 10 });
    expect(screen.getByTestId("move-confirm-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-confirm-confirm"));

    const next = onInputsChange.mock.calls[0][0] as TransportMapInputs;
    expect(next.addedMines).toHaveLength(1);
    expect(next.addedMines[0].id).toBe("am-1"); // D7 — id never changes on move
    expect(next.addedMines[0].lat).not.toBe(addedMine().lat);
    expect(next.laneCostOverrides).toEqual([{ fromId: "MN1", toId: "ST1", cost: 10 }]);
  });
});

describe("InputMapTab — transport mode: edit", () => {
  it("editing a BASE mine's capacity writes into mineCapacities, not addedMines", () => {
    const { container, onInputsChange } = renderTransport({ mines: [baseMine()] });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("edit-warehouse-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("edit-warehouse-dialog")).toHaveTextContent("Edit mine");
    // MINE_ROLE.hasStatus:false — no status radio group in the edit dialog either.
    expect(screen.queryByTestId("edit-warehouse-status")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("edit-warehouse-capacity"), { target: { value: "8000" } });
    fireEvent.click(screen.getByTestId("edit-warehouse-save"));

    const next = onInputsChange.mock.calls[0][0] as TransportMapInputs;
    expect(next.mineCapacities).toEqual({ MN1: 8000 });
    expect(next.addedMines).toEqual([]);
  });

  it("editing an ADDED mine's capacity mutates its own row, not mineCapacities", () => {
    const inputs = makeInputs({ addedMines: [{ id: "am-1", displayCode: "MN-NV-RENO-01", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, capacity: null }] });
    const { container, onInputsChange } = renderTransport({ mines: [addedMine()], inputs });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    fireEvent.change(screen.getByTestId("edit-warehouse-capacity"), { target: { value: "3000" } });
    fireEvent.click(screen.getByTestId("edit-warehouse-save"));

    const next = onInputsChange.mock.calls[0][0] as TransportMapInputs;
    expect(next.addedMines[0]).toMatchObject({ id: "am-1", capacity: 3000 });
    expect(next.mineCapacities).toEqual({});
  });

  it("editing a station's demand writes into stationDemands (base) via EditCustomerDialog, labeled 'station'", () => {
    const { container, onInputsChange } = renderTransport({ mines: [], stations: [baseStation()] });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("edit-customer-dialog")).toHaveTextContent("Edit station");
    fireEvent.change(screen.getByTestId("edit-customer-demand-input"), { target: { value: "700" } });
    fireEvent.click(screen.getByTestId("edit-customer-save"));

    const next = onInputsChange.mock.calls[0][0] as TransportMapInputs;
    expect(next.stationDemands).toEqual({ ST1: 700 });
  });
});

describe("InputMapTab — transport mode: R4 Save-in-Layers", () => {
  it("renders no Save control when onSave isn't wired", () => {
    renderTransport();
    expect(screen.queryByTestId("button-save")).not.toBeInTheDocument();
  });

  it("shows 'Unsaved changes' and an enabled Save while dirty, inside the transport toolbar, and calls onSave on click", () => {
    const onSave = vi.fn();
    renderTransport({ onSave, isDirty: true });
    const toolbar = screen.getByTestId("transport-map-toolbar");
    const saveButton = screen.getByTestId("button-save");
    expect(toolbar).toContainElement(saveButton);
    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
