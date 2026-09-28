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
import type { MapWarehouse, MapCustomer, PMedianMapInputs } from "@/components/workspace/map/types";

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

describe("InputMapTab pmedian — readOnly (delivery-teaching-us)", () => {
  function renderReadOnly() {
    return render(
      <InputMapTab
        mode="pmedian"
        readOnly
        warehouses={[baseWh({ id: "W1", displayCode: "W1", city: "Los Angeles", state: "CA", lat: 34.05, lng: -118.24 })]}
        customers={[baseCs({ id: "C2", displayCode: "C2", city: "Chicago", state: "IL", lat: 41.88, lng: -87.63, demand: 1000 })]}
        inputs={basePMedianInputs()}
        countryBounds={{ sw: [24, -125], ne: [50, -66] }}
        onInputsChange={() => {
          throw new Error("read-only map must never call onInputsChange");
        }}
      />,
    );
  }

  // Real testids at 3065c91 — arming chips, Layers-row Save. Asserting the
  // tab list alone would pass against a map a student can still drag a
  // warehouse on, which is why every affordance is named individually.
  it.each([
    "button-input-map-place-wh",
    "button-input-map-place-cs", // InputMapTab.tsx:833,836
    "armed-status-bar",
    "button-armed-cancel", // :840,844
    "button-save", // :868 (Layers-row Save)
  ])("does not render %s", testid => {
    renderReadOnly();
    expect(screen.queryByTestId(testid)).toBeNull();
  });

  it("right-click does not open the add menu", () => {
    const { container } = renderReadOnly();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    expect(screen.queryByTestId("map-add-menu")).toBeNull();
    expect(screen.queryByTestId("map-add-menu-wh")).toBeNull();
  });

  it("clicking a marker shows the details card but not the action menu", () => {
    const { container } = renderReadOnly();
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.click(markers[0]);
    expect(screen.getByTestId("map-details-lat")).toBeInTheDocument(); // MapDetailsCard.tsx:114 (read-only card)

    fireEvent.contextMenu(markers[0]);
    expect(screen.queryByTestId("map-action-menu")).toBeNull();
    for (const a of ["edit", "move", "copy", "delete"]) {
      expect(screen.queryByTestId(`map-action-${a}`)).toBeNull();
    }
  });

  it("still renders the map root and legend", () => {
    renderReadOnly();
    expect(screen.getByTestId("input-map-tab")).toBeInTheDocument(); // root testid (:817); there is no "input-map"
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
  });
});
