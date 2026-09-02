import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { InputMapTab } from "@/components/workspace/tabs/InputMapTab";
import type { MapCustomer, PMedianMapInputs } from "@/components/workspace/map/types";
import type { TwoEchelonMapInputs } from "@/components/workspace/tabs/InputMapTab";

// T8 (Bundle 2.2, A3) — integration coverage for customer Active/Excluded
// flowing all the way through InputMapTab's own mutators (dialogs alone are
// covered by EditCustomerDialog.test.tsx/CreateEntityDialog.test.tsx). The
// model list below intentionally includes all three p-median-family
// capability values so a single mock covers every scenario in this file —
// p-median-us/two-echelon-gold-au true, p-median-brazil explicitly false
// (Bundle 2.2, T0/T1's own capability-gate contract).
const mockModels = [
  { id: "p-median-us", capabilities: { supportsAddedCustomerExclusion: true } },
  { id: "p-median-brazil", capabilities: { supportsAddedCustomerExclusion: false } },
  { id: "two-echelon-gold-au", capabilities: { supportsAddedCustomerExclusion: true } },
];
vi.mock("@workspace/api-client-react", () => ({
  useListModels: () => ({ data: mockModels }),
}));

const cs = (over: Partial<MapCustomer> = {}): MapCustomer => ({
  id: "C1",
  displayCode: "C1",
  city: "New York",
  state: "NY",
  lat: 40.7,
  lng: -74.0,
  demand: 1000,
  excluded: false,
  isAdded: false,
  ...over,
});

function makePMedianInputs(over: Partial<PMedianMapInputs> = {}): PMedianMapInputs {
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
  customers?: MapCustomer[];
  inputs?: PMedianMapInputs;
  modelId?: string;
} = {}) {
  const onInputsChange = vi.fn();
  const view = render(
    <InputMapTab
      mode="pmedian"
      warehouses={[]}
      customers={over.customers ?? [cs()]}
      inputs={over.inputs ?? makePMedianInputs()}
      onInputsChange={onInputsChange}
      modelId={over.modelId}
    />,
  );
  return { ...view, onInputsChange };
}

function makeTwoEchelonInputs(over: Partial<TwoEchelonMapInputs> = {}): TwoEchelonMapInputs {
  return {
    addedRefineries: [],
    addedCustomers: [],
    refineryOverrides: [],
    customerOverrides: [],
    distanceOverrides: [],
    ...over,
  };
}

function renderTwoEchelon(over: { customers?: MapCustomer[]; inputs?: TwoEchelonMapInputs } = {}) {
  const onInputsChange = vi.fn();
  const view = render(
    <InputMapTab
      mode="twoEchelon"
      mine={null}
      refineries={[]}
      customers={over.customers ?? [cs()]}
      inputs={over.inputs ?? makeTwoEchelonInputs()}
      onInputsChange={onInputsChange}
    />,
  );
  return { ...view, onInputsChange };
}

describe("InputMapTab — pmedian mode: base customer Active/Excluded", () => {
  it("editing a BASE customer (no existing override) to Excluded writes a customerOverrides entry with demand preserved", () => {
    const { container, onInputsChange } = renderPMedian({ customers: [cs({ demand: 1000 })] });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    fireEvent.click(screen.getByTestId("edit-customer-status-excluded"));
    fireEvent.click(screen.getByTestId("edit-customer-save"));

    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.customerOverrides).toEqual([{ id: "C1", status: "excluded", demand: 1000 }]);
  });

  it("reverting a BASE customer's status back to Active with unchanged demand removes the now-no-op override", () => {
    const inputs = makePMedianInputs({ customerOverrides: [{ id: "C1", status: "excluded", demand: 1000 }] });
    const { container, onInputsChange } = renderPMedian({
      customers: [cs({ demand: 1000, excluded: true })],
      inputs,
    });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    // Pre-selected Excluded (entity.excluded=true) — flip back to Active,
    // demand left untouched (still 1000, same as the stored override).
    fireEvent.click(screen.getByTestId("edit-customer-status-active"));
    fireEvent.click(screen.getByTestId("edit-customer-save"));

    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.customerOverrides).toEqual([]);
  });
});

describe("InputMapTab — pmedian mode: ADDED customer Active/Excluded (capability-gated)", () => {
  it("with modelId='p-median-us' (supportsAddedCustomerExclusion=true), creating a customer as Excluded writes status into the new addedCustomers row", () => {
    const { container, onInputsChange } = renderPMedian({ modelId: "p-median-us" });
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(screen.getByTestId("button-input-map-place-cs"));
    fireEvent.click(mapEl, { clientX: 20, clientY: 20 });

    expect(screen.getByTestId("create-entity-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("create-entity-cs-status")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-cs-status-excluded"));
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedCustomers).toHaveLength(1);
    expect(next.addedCustomers[0]).toMatchObject({ status: "excluded" });
  });

  it("with modelId='p-median-us', creating a customer without touching status defaults to active", () => {
    const { container, onInputsChange } = renderPMedian({ modelId: "p-median-us" });
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(screen.getByTestId("button-input-map-place-cs"));
    fireEvent.click(mapEl, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedCustomers[0]).toMatchObject({ status: "active" });
  });

  it("with modelId='p-median-us', editing an existing ADDED customer to Excluded mutates its own addedCustomers row", () => {
    const inputs = makePMedianInputs({
      addedCustomers: [{ id: "ac-1", displayCode: "AC1", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, demand: 500 }],
    });
    const { container, onInputsChange } = renderPMedian({
      customers: [cs({ id: "ac-1", displayCode: "AC1", isAdded: true, demand: 500, excluded: false })],
      inputs,
      modelId: "p-median-us",
    });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    fireEvent.click(screen.getByTestId("edit-customer-status-excluded"));
    fireEvent.click(screen.getByTestId("edit-customer-save"));

    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedCustomers).toHaveLength(1);
    expect(next.addedCustomers[0]).toMatchObject({ id: "ac-1", status: "excluded", demand: 500 });
  });

  it("Brazil-negative — with modelId='p-median-brazil' (supportsAddedCustomerExclusion=false), an ADDED customer's status control is hidden and no status key is ever created", () => {
    const inputs = makePMedianInputs({
      addedCustomers: [{ id: "ac-1", displayCode: "AC1", city: "Reno", state: "NV", lat: 39.5, lng: -119.8, demand: 500 }],
    });
    const { container, onInputsChange } = renderPMedian({
      customers: [cs({ id: "ac-1", displayCode: "AC1", isAdded: true, demand: 500, excluded: false })],
      inputs,
      modelId: "p-median-brazil",
    });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    expect(screen.queryByTestId("edit-customer-status")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("edit-customer-demand-input"), { target: { value: "600" } });
    fireEvent.click(screen.getByTestId("edit-customer-save"));

    const next = onInputsChange.mock.calls[0][0] as PMedianMapInputs;
    expect(next.addedCustomers[0]).not.toHaveProperty("status");
    expect(next.addedCustomers[0].demand).toBe(600);
  });
});

describe("InputMapTab — twoEchelon mode: ADDED customer Active/Excluded", () => {
  it("two-echelon-gold-au supports added-customer exclusion unconditionally (no modelId prop needed) — creating a customer as Excluded writes status", () => {
    const { container, onInputsChange } = renderTwoEchelon();
    const mapEl = container.querySelector(".leaflet-container") as HTMLElement;
    fireEvent.click(screen.getByTestId("button-input-map-place-cs"));
    fireEvent.click(mapEl, { clientX: 20, clientY: 20 });

    expect(screen.getByTestId("create-entity-cs-status")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-entity-cs-status-excluded"));
    fireEvent.click(screen.getByTestId("create-entity-submit"));

    const next = onInputsChange.mock.calls[0][0] as TwoEchelonMapInputs;
    expect(next.addedCustomers[0]).toMatchObject({ status: "excluded" });
  });

  it("editing an existing ADDED two-echelon customer to Excluded mutates its own addedCustomers row", () => {
    const inputs = makeTwoEchelonInputs({
      addedCustomers: [{ id: "ac-1", displayCode: "AC1", city: "Brisbane", state: "QLD", lat: -27.47, lng: 153.03, demand: 900 }],
    });
    const { container, onInputsChange } = renderTwoEchelon({
      customers: [cs({ id: "ac-1", displayCode: "AC1", isAdded: true, demand: 900, excluded: false })],
      inputs,
    });
    const markers = container.querySelectorAll(".leaflet-marker-icon");
    fireEvent.contextMenu(markers[0]);
    fireEvent.click(screen.getByTestId("map-action-edit"));
    fireEvent.click(screen.getByTestId("edit-customer-status-excluded"));
    fireEvent.click(screen.getByTestId("edit-customer-save"));

    const next = onInputsChange.mock.calls[0][0] as TwoEchelonMapInputs;
    expect(next.addedCustomers[0]).toMatchObject({ id: "ac-1", status: "excluded", demand: 900 });
  });
});
