import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";
import type { MapWarehouse, MapCustomer } from "@/components/workspace/map/types";
import type { TwoEchelonMapInputs } from "@/components/workspace/tabs/InputMapTab";

// T7 (Bundle 2) — two-echelon-gold-au's full-v2 Input Map editor. Same
// composition/real-jsdom convention InputMapTabV2.test.tsx/
// InputMapTabV2.transport.test.tsx already establish for "pmedian"/
// "transport" mode (T4's EntityMarkers/MapLegend, T5's inspect card/action
// menu, T6's edit dialogs, T7's create/move dialogs, all real, none mocked)
// — this file proves the SAME contract holds for "twoEchelon" mode's own
// mutators/role wiring (REFINERY_ROLE — hasStatus:true, capacityMode="none"
// — default CUSTOMER_ROLE, refineryOverrides/customerOverrides/
// distanceOverrides, no capacityMode field at all), PLUS the fixed mine's
// read-only-context contract (Step 1) and R3/R7 status behavior (Step 2).

const baseMine = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "kalgoorlie",
  displayCode: "kalgoorlie",
  city: "Kalgoorlie",
  state: "WA",
  lat: -30.7,
  lng: 121.4,
  isAdded: false,
  ...over,
});

const baseRefinery = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "cunnamulla",
  displayCode: "cunnamulla",
  city: "Cunnamulla",
  state: "QLD",
  lat: -28.07,
  lng: 145.68,
  status: "active",
  isAdded: false,
  ...over,
});

const addedRefinery = (over: Partial<MapWarehouse> = {}): MapWarehouse => ({
  id: "aw-1",
  displayCode: "WH-QLD-BRISBANE-01",
  city: "Brisbane",
  state: "QLD",
  lat: -27.47,
  lng: 153.03,
  status: "active",
  isAdded: true,
  ...over,
});

const baseCustomer = (over: Partial<MapCustomer> = {}): MapCustomer => ({
  id: "sydney",
  displayCode: "sydney",
  city: "Sydney",
  state: "NSW",
  lat: -33.87,
  lng: 151.2,
  demand: 100000,
  excluded: false,
  isAdded: false,
  ...over,
});

function makeInputs(over: Partial<TwoEchelonMapInputs> = {}): TwoEchelonMapInputs {
  return {
    addedRefineries: [],
    addedCustomers: [],
    refineryOverrides: [],
    customerOverrides: [],
    distanceOverrides: [],
    ...over,
  };
}

function renderTwoEchelon(over: {
  mine?: MapWarehouse | null;
  refineries?: MapWarehouse[];
  customers?: MapCustomer[];
  inputs?: TwoEchelonMapInputs;
  isDirty?: boolean;
  onSave?: () => void;
  saving?: boolean;
} = {}) {
  const onInputsChange = vi.fn();
  const view = render(
    <InputMapTab
      mode="twoEchelon"
      mine={over.mine === undefined ? baseMine() : over.mine}
      refineries={over.refineries ?? [baseRefinery()]}
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

describe("InputMapTab — twoEchelon mode dispatch", () => {
  it("renders the two-echelon toolbar and MapLegend, not the pmedian/transport toolbar", () => {
    renderTwoEchelon();
    expect(screen.getByTestId("two-echelon-map-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("pmedian-map-toolbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("transport-map-toolbar")).not.toBeInTheDocument();
  });

  it("renders 'Refineries'/'Customers' layer toggles and '+ Refinery'/'+ Customer' add-on-map buttons", () => {
    renderTwoEchelon();
    expect(screen.getByTestId("toggle-layer-warehouses")).toHaveTextContent("Refineries");
    expect(screen.getByTestId("toggle-layer-customers")).toHaveTextContent("Customers");
    expect(screen.getByTestId("button-input-map-place-wh")).toHaveTextContent("+ Refinery");
    expect(screen.getByTestId("button-input-map-place-cs")).toHaveTextContent("+ Customer");
  });
});

// Step 1 — the fixed mine is read-only context: rendered, but excluded from
// EVERY edit affordance. Confirmed the negative way (no action menu opens on
// right-click) AND the positive way (a refinery right next to it DOES open
// one) so the assertion actually exercises the distinction, not just "no
// menu ever renders in this test".
describe("InputMapTab — twoEchelon mode: fixed mine has zero edit affordances (Step 1)", () => {
  it("renders both the mine marker and the refinery marker", () => {
    const { container } = renderTwoEchelon({ customers: [] });
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // Mine (bare Marker, default icon) + refinery (EntityMarkers triangle).
    expect(markers).toHaveLength(2);
  });

  it("right-clicking the mine marker opens NO action menu", () => {
    const { container } = renderTwoEchelon();
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // JSX order: mine marker first, then EntityMarkers' refinery.
    fireEvent.contextMenu(markers[0]);
    expect(screen.queryByTestId("map-action-menu")).not.toBeInTheDocument();
  });

  it("left-clicking the mine marker opens NO details card", () => {
    const { container } = renderTwoEchelon();
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    fireEvent.click(markers[0]);
    expect(screen.queryByTestId("map-details-card")).not.toBeInTheDocument();
  });

  it("right-clicking the REFINERY marker (not the mine) DOES open an action menu", () => {
    const { container } = renderTwoEchelon();
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]);
    expect(screen.getByTestId("map-action-menu")).toBeInTheDocument();
  });

  it("the mine is never draggable, unlike an added refinery", () => {
    const { container } = renderTwoEchelon({ refineries: [baseRefinery(), addedRefinery()] });
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // Mine marker (index 0) carries no leaflet drag handle class; the added
    // refinery (index 2 — base refinery is index 1) does. Leaflet's
    // draggable Marker adds "leaflet-marker-draggable" to the icon element.
    expect(markers[0].className).not.toContain("leaflet-marker-draggable");
    expect(markers[2].className).toContain("leaflet-marker-draggable");
  });

  it("renders with no mine at all (defensive — dataset hasn't resolved one yet)", () => {
    const { container } = renderTwoEchelon({ mine: null, customers: [] });
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    expect(markers).toHaveLength(1); // refinery only
  });
});

// Step 2 — R3 (status markers) applies to refineries (supportsFacilityStatus
// true, unlike transport's mines): the status legend renders, and a
// forced-open refinery paints with the forced-open marker class.
describe("InputMapTab — twoEchelon mode: R3 status markers/legend on refineries", () => {
  it("renders the status legend rows (unlike transport mode, which suppresses them)", () => {
    renderTwoEchelon();
    expect(screen.getByTestId("legend-status-active")).toBeInTheDocument();
    expect(screen.getByTestId("legend-status-forced_open")).toBeInTheDocument();
    expect(screen.getByTestId("legend-status-inactive")).toBeInTheDocument();
  });

  it("a forced-open refinery paints with the forced-open marker style, the mine stays a plain default marker", () => {
    const { container } = renderTwoEchelon({ refineries: [baseRefinery({ status: "forced_open" })] });
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    expect(markers[1].className).toContain("status-forced_open");
    expect(markers[0].className).not.toMatch(/status-\w/);
  });
});

describe("InputMapTab — twoEchelon mode: create", () => {
  it("right-click empty map → Add warehouse here → CreateEntityDialog submit → onInputsChange gains an addedRefineries row minting an 'aw-' uid (DD-7), with a status field", () => {
    const { container, onInputsChange } = renderTwoEchelon();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-wh"));

    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("New refinery");
    // REFINERY_ROLE.hasStatus:true — the status radio group DOES show.
    expect(screen.getByTestId("create-entity-status")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as TwoEchelonMapInputs;
    expect(next.addedRefineries).toHaveLength(1);
    // DD-7 — refineries reuse uidKind "wh" -> "aw-", never a new "ar-" prefix.
    expect(next.addedRefineries[0].id).toMatch(/^aw-/);
    expect(next.addedRefineries[0].id).not.toMatch(/^ar-/);
    expect(next.addedRefineries[0].status).toBe("active");
    // Untouched siblings.
    expect(next.addedCustomers).toEqual([]);
    expect(next.refineryOverrides).toEqual([]);
    expect(next.customerOverrides).toEqual([]);
    expect(next.distanceOverrides).toEqual([]);
  });

  it("right-click empty map → Add customer here → onInputsChange gains an addedCustomers row minting an 'ac-' uid", () => {
    const { container, onInputsChange } = renderTwoEchelon();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.contextMenu(mapEl, { clientX: 50, clientY: 40 });
    fireEvent.click(screen.getByTestId("map-add-menu-cs"));
    expect(screen.getByTestId("create-entity-dialog")).toHaveTextContent("New customer");
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const next = onInputsChange.mock.calls[0][0] as TwoEchelonMapInputs;
    expect(next.addedCustomers).toHaveLength(1);
    expect(next.addedCustomers[0].id).toMatch(/^ac-/);
  });

  it("the '+ Refinery' pin-mode toggle opens CreateEntityDialog directly on the next map click", () => {
    const { container, onInputsChange } = renderTwoEchelon();
    fireEvent.click(screen.getByTestId("button-input-map-place-wh"));
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 30, clientY: 30 });

    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-submit"));
    const next = onInputsChange.mock.calls[0][0] as TwoEchelonMapInputs;
    expect(next.addedRefineries).toHaveLength(1);
  });
});

describe("InputMapTab — twoEchelon mode: delete", () => {
  it("deletes an added refinery: row AND its distanceOverrides (by id) are gone, refineryOverrides/customerOverrides untouched", () => {
    const inputs = makeInputs({
      addedRefineries: [{ id: "aw-1", displayCode: "WH-QLD-BRISBANE-01", city: "Brisbane", state: "QLD", lat: -27.47, lng: 153.03, status: "active" }],
      refineryOverrides: [{ id: "cunnamulla", status: "forced_open" }],
      customerOverrides: [{ id: "sydney", demand: 90000, status: "active" }],
      distanceOverrides: [
        { fromId: "kalgoorlie", toId: "aw-1", distance: 500 },
        { fromId: "aw-1", toId: "sydney", distance: 900 },
        { fromId: "kalgoorlie", toId: "cunnamulla", distance: 400 },
      ],
    });
    const { container, onInputsChange } = renderTwoEchelon({ refineries: [baseRefinery(), addedRefinery()], inputs });

    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // Mine (0), base refinery (1), added refinery (2) — matches
    // twoEchelonMapRefineries' [...base, ...added] projection order.
    fireEvent.contextMenu(markers[2]);
    expect(screen.getByTestId("map-action-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("map-action-delete"));
    fireEvent.click(screen.getByTestId("map-action-delete"));

    expect(onInputsChange).toHaveBeenCalledTimes(1);
    const next = onInputsChange.mock.calls[0][0] as TwoEchelonMapInputs;
    expect(next.addedRefineries).toEqual([]);
    expect(next.distanceOverrides).toEqual([{ fromId: "kalgoorlie", toId: "cunnamulla", distance: 400 }]);
    expect(next.refineryOverrides).toEqual([{ id: "cunnamulla", status: "forced_open" }]);
    expect(next.customerOverrides).toEqual([{ id: "sydney", demand: 90000, status: "active" }]);
  });
});

describe("InputMapTab — twoEchelon mode: move", () => {
  it("moving an added refinery keeps its id unchanged, updates coords, clears its own distanceOverrides", () => {
    const inputs = makeInputs({
      addedRefineries: [{ id: "aw-1", displayCode: "WH-QLD-BRISBANE-01", city: "Brisbane", state: "QLD", lat: -27.47, lng: 153.03, status: "active" }],
      distanceOverrides: [
        { fromId: "kalgoorlie", toId: "aw-1", distance: 500 },
        { fromId: "kalgoorlie", toId: "cunnamulla", distance: 400 },
      ],
    });
    const { container, onInputsChange } = renderTwoEchelon({ refineries: [baseRefinery(), addedRefinery()], inputs });

    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    fireEvent.contextMenu(markers[2]);
    fireEvent.click(screen.getByTestId("map-action-move"));
    expect(screen.getByTestId("armed-status-bar")).toBeInTheDocument();

    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(mapEl, { clientX: 10, clientY: 10 });
    expect(screen.getByTestId("move-confirm-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("move-confirm-confirm"));

    const next = onInputsChange.mock.calls[0][0] as TwoEchelonMapInputs;
    expect(next.addedRefineries).toHaveLength(1);
    expect(next.addedRefineries[0].id).toBe("aw-1"); // D7 — id never changes on move
    expect(next.addedRefineries[0].lat).not.toBe(addedRefinery().lat);
    expect(next.distanceOverrides).toEqual([{ fromId: "kalgoorlie", toId: "cunnamulla", distance: 400 }]);
  });
});

describe("InputMapTab — twoEchelon mode: edit", () => {
  it("editing a BASE refinery's status writes into refineryOverrides, not addedRefineries, and shows NO Capacity field (capacityMode='none')", () => {
    const { container, onInputsChange } = renderTwoEchelon({ refineries: [baseRefinery()] });
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("edit-warehouse-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("edit-warehouse-dialog")).toHaveTextContent("Edit refinery");
    expect(screen.getByTestId("edit-warehouse-status")).toBeInTheDocument();
    // Refineries have no capacity concept at all — capacityMode="none"
    // suppresses REFINERY_ROLE's own Capacity field.
    expect(screen.queryByTestId("edit-warehouse-capacity")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("edit-warehouse-status-inactive"));
    fireEvent.click(screen.getByTestId("edit-warehouse-save"));

    const next = onInputsChange.mock.calls[0][0] as TwoEchelonMapInputs;
    expect(next.refineryOverrides).toEqual([{ id: "cunnamulla", status: "inactive" }]);
    expect(next.addedRefineries).toEqual([]);
  });

  it("editing an ADDED refinery's status mutates its own row, not refineryOverrides", () => {
    const inputs = makeInputs({ addedRefineries: [{ id: "aw-1", displayCode: "WH-QLD-BRISBANE-01", city: "Brisbane", state: "QLD", lat: -27.47, lng: 153.03, status: "active" }] });
    const { container, onInputsChange } = renderTwoEchelon({ refineries: [addedRefinery()], inputs });
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    fireEvent.contextMenu(markers[1]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    fireEvent.click(screen.getByTestId("edit-warehouse-status-forced_open"));
    fireEvent.click(screen.getByTestId("edit-warehouse-save"));

    const next = onInputsChange.mock.calls[0][0] as TwoEchelonMapInputs;
    expect(next.addedRefineries[0]).toMatchObject({ id: "aw-1", status: "forced_open" });
    expect(next.refineryOverrides).toEqual([]);
  });

  it("editing a customer's demand writes into customerOverrides (base) via EditCustomerDialog", () => {
    const { container, onInputsChange } = renderTwoEchelon({ refineries: [], customers: [baseCustomer()] });
    const markers = container.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon");
    // Mine (0), then the one customer (1) — no refineries in this render.
    fireEvent.contextMenu(markers[1]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.getByTestId("edit-customer-dialog")).toHaveTextContent("Edit customer");
    fireEvent.change(screen.getByTestId("edit-customer-demand-input"), { target: { value: "120000" } });
    fireEvent.click(screen.getByTestId("edit-customer-save"));

    const next = onInputsChange.mock.calls[0][0] as TwoEchelonMapInputs;
    expect(next.customerOverrides).toEqual([{ id: "sydney", status: "active", demand: 120000 }]);
  });
});

describe("InputMapTab — twoEchelon mode: R4 Save-in-Layers", () => {
  it("renders no Save control when onSave isn't wired", () => {
    renderTwoEchelon();
    expect(screen.queryByTestId("button-save")).not.toBeInTheDocument();
  });

  it("shows 'Unsaved changes' and an enabled Save while dirty, inside the two-echelon toolbar, and calls onSave on click", () => {
    const onSave = vi.fn();
    renderTwoEchelon({ onSave, isDirty: true });
    const toolbar = screen.getByTestId("two-echelon-map-toolbar");
    const saveButton = screen.getByTestId("button-save");
    expect(toolbar).toContainElement(saveButton);
    expect(screen.getByTestId("text-unsaved-changes")).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
